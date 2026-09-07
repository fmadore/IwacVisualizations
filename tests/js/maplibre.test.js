'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative, sep } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const MAPLIBRE_SOURCE = readFileSync(
    join(ROOT, 'asset', 'js', 'charts', 'shared', 'maplibre.js'),
    'utf8'
);

class FakePopup {
    constructor(options) {
        this.options = { ...options };
        this.listeners = {};
        this.content = null;
        this.element = null;
        this.map = null;
        this.maxWidthCalls = [];
        this.paddingCalls = [];
    }

    on(type, handler) {
        (this.listeners[type] ||= []).push(handler);
        return { unsubscribe: () => this.off(type, handler) };
    }

    off(type, handler) {
        this.listeners[type] = (this.listeners[type] || []).filter((fn) => fn !== handler);
        return this;
    }

    fire(type) {
        for (const handler of this.listeners[type] || []) handler({ type, target: this });
    }

    isOpen() {
        return Boolean(this.map);
    }

    getElement() {
        return this.element;
    }

    setLngLat(value) {
        this.lngLat = value;
        return this;
    }

    setDOMContent(value) {
        this.content = value;
        if (this.map && !this.element) this.element = { style: {} };
        return this;
    }

    setHTML(value) {
        return this.setDOMContent({ html: value });
    }

    setText(value) {
        return this.setDOMContent({ text: value });
    }

    setMaxWidth(value) {
        this.options.maxWidth = value;
        this.maxWidthCalls.push(value);
        return this;
    }

    setPadding(value) {
        this.options.padding = value;
        this.paddingCalls.push(value);
    }

    addTo(map) {
        if (this.map) this.remove();
        this.map = map;
        if (this.content) this.element = { style: {} };
        this.fire('open');
        return this;
    }

    remove() {
        this.map = null;
        this.element = null;
        this.fire('close');
        return this;
    }
}

function loadMaplibre() {
    const context = {
        console,
        document: {
            createElement() {
                return { getContext: () => null };
            },
            getElementById() {
                return null;
            },
        },
        maplibregl: { Popup: FakePopup },
        window: { IWACVis: { panels: {} } },
    };
    vm.createContext(context);
    vm.runInContext(MAPLIBRE_SOURCE, context, { filename: 'maplibre.js' });
    return context.window.IWACVis.panels;
}

test('the shared popup factory stacks the IWAC class and keeps caller options', () => {
    const P = loadMaplibre();
    const plain = P.createIwacPopup();
    assert.equal(plain.options.className, 'iwac-vis-maplibre-popup');
    assert.equal(plain.options.maxWidth, '320px');
    // JSON round-trip: maplibre.js runs in a vm context, so its object
    // literals carry that realm's prototype and fail a strict deep compare.
    assert.deepEqual(
        JSON.parse(JSON.stringify(plain.options.padding)),
        { top: 16, right: 16, bottom: 16, left: 16 }
    );

    const custom = P.createIwacPopup({ className: 'preview', maxWidth: '240px', closeButton: false });
    assert.equal(custom.options.className, 'iwac-vis-maplibre-popup preview');
    assert.equal(custom.options.maxWidth, '240px', 'a caller may ask for a narrower popup');
    assert.equal(custom.options.closeButton, false);
});

test('the popup patches addTo, and only addTo', () => {
    // The bounds are container queries in iwac-maplibre.css (M19); the one
    // override left tells MapLibre the width the CSS produced, so its anchor
    // arithmetic matches the box it draws. If the content setters or the two
    // option setters come back, ~150 lines of hand-rolled measurement and a
    // per-popup `resize` listener have come back with them.
    const P = loadMaplibre();
    const popup = P.createIwacPopup();
    assert.equal(Object.prototype.hasOwnProperty.call(popup, 'addTo'), true);
    for (const method of ['setDOMContent', 'setHTML', 'setText', 'setMaxWidth', 'setPadding']) {
        assert.equal(
            Object.prototype.hasOwnProperty.call(popup, method), false,
            `${method} is overridden on the instance`
        );
    }
});

test('the map host is a size container and the popup bounds are map-relative', () => {
    // The guarantees the deleted JS enforced, now expressed once in CSS:
    // half the map's height minus MapLibre's 10px tip (so one of the
    // top/bottom anchors always fits) and two thirds of its width (the same
    // guarantee for left/centre/right).
    const css = readFileSync(join(ROOT, 'asset', 'css', 'iwac-maplibre.css'), 'utf8');
    assert.match(css, /\.iwac-vis-map\s*\{[^}]*container-type:\s*size/,
        '.iwac-vis-map must be a size container for cqh/cqw to resolve');
    assert.match(css, /container-name:\s*iwac-map/);
    // Half the map's height minus the 10px tip; two thirds of its width.
    // Both computed off the map's USABLE box — the container minus the
    // anchor inset MapLibre keeps on each side.
    assert.match(css, /100cqh - 2 \* var\(--iwac-vis-popup-edge\)\) \/ 2 - 10px/);
    assert.match(css, /100cqw - 2 \* var\(--iwac-vis-popup-edge\)\) \* 2 \/ 3/);
    // min-width carries the same cap: a min beats a max, so a 200px floor
    // on a narrow map would otherwise reopen the overflow.
    assert.match(css, /min-width: min\(\s*200px,\s*calc\(\(100cqw/);
    // And nothing sets the retired per-popup custom properties any more.
    assert.doesNotMatch(css, /--iwac-vis-popup-(content|body|inner)/);
});

test('every module popup goes through the shared factory', () => {
    const assetRoot = join(ROOT, 'asset', 'js');
    const files = [];
    function walk(dir) {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else if (path.endsWith('.js') && !path.endsWith('.min.js')) files.push(path);
        }
    }
    walk(assetRoot);

    const directConstructors = files
        .filter((path) => /new\s+maplibregl\.Popup\s*\(/.test(readFileSync(path, 'utf8')))
        .map((path) => relative(ROOT, path).replaceAll('\\', '/'));

    assert.deepEqual(directConstructors, ['asset/js/charts/shared/maplibre.js']);
});

test('a theme swap carries the module\'s own sources and rebuilds its layers', () => {
    const P = loadMaplibre();
    // Positron and dark-matter declare the same source ids as each other; what
    // a panel added is exactly what is in the outgoing style and not the
    // incoming one.
    const previous = {
        sources: {
            carto: { type: 'vector', url: 'https://basemaps.example/tiles.json' },
            'spatial-places': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
            'net-edges': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [{ id: 'background' }, { id: 'spatial-place-circles' }],
    };
    const next = {
        version: 8,
        glyphs: 'https://tiles.basemaps.example/fonts/{fontstack}/{range}.pbf',
        sources: { carto: { type: 'vector', url: 'https://basemaps.example/dark.json' } },
        layers: [{ id: 'background' }],
    };

    const merged = P.carryOwnSources(previous, next);

    assert.deepEqual(
        Object.keys(merged.sources).sort(),
        ['carto', 'net-edges', 'spatial-places']
    );
    // The BASEMAP's version of a shared id wins — the point is a new basemap.
    assert.equal(merged.sources.carto.url, 'https://basemaps.example/dark.json');
    // Layers are NOT carried: onStyleReady re-adds them, which is where their
    // paint is re-resolved against the new theme's tokens.
    assert.deepEqual(merged.layers, next.layers);
    assert.equal(merged.glyphs, next.glyphs);
    // The inputs are left alone.
    assert.equal(Object.keys(next.sources).length, 1);
});

test('carry-over ignores non-geojson leftovers and no-ops on a first load', () => {
    const P = loadMaplibre();
    const next = { sources: { carto: { type: 'vector' } }, layers: [] };
    // No previous style: the very first setStyle has nothing to carry.
    assert.equal(P.carryOwnSources(undefined, next), next);
    // A leftover that is not inline GeoJSON belongs to a basemap, not to us.
    const stale = { sources: { 'old-raster': { type: 'raster' } }, layers: [] };
    assert.equal(P.carryOwnSources(stale, next), next);
});

test('every module source is inline GeoJSON, which is what carry-over assumes', () => {
    const files = [];
    (function walk(dir) {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (name.endsWith('.js') && !name.endsWith('.min.js')) files.push(full);
        }
    })(join(ROOT, 'asset', 'js'));

    const offenders = [];
    for (const path of files) {
        const source = readFileSync(path, 'utf8');
        // `addSource(id, { type: 'x'` — capture the declared type.
        for (const m of source.matchAll(/addSource\([^,]+,\s*\{\s*(?:\n\s*)?type:\s*'([a-z-]+)'/g)) {
            if (m[1] !== 'geojson') offenders.push(`${relative(ROOT, path)}: ${m[1]}`);
        }
    }
    assert.deepEqual(offenders, [],
        'P.carryOwnSources only carries geojson sources; a source of another '
        + 'type would silently be dropped on every theme swap');
});

test('a consumer that adds a source unguarded would throw once it survives a swap', () => {
    // The M17 class of bug: with sources carried across the swap, an
    // `addSource` that is not behind a `getSource` guard runs a second time on
    // an id that already exists.
    const files = [];
    (function walk(dir) {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (name.endsWith('.js') && !name.endsWith('.min.js')) files.push(full);
        }
    })(join(ROOT, 'asset', 'js'));

    const unguarded = [];
    for (const path of files) {
        const label = relative(ROOT, path).split(sep).join('/');
        // maplibre.js's own doc comment shows the unguarded form as an example.
        if (label === 'asset/js/charts/shared/maplibre.js') continue;
        const lines = readFileSync(path, 'utf8').split('\n');
        lines.forEach((line, i) => {
            if (!/\.addSource\(/.test(line)) return;
            const window = lines.slice(Math.max(0, i - 6), i).join('\n');
            if (!/getSource\(/.test(window)) unguarded.push(`${label}:${i + 1}`);
        });
    }
    assert.deepEqual(unguarded, []);
});
