'use strict';

// Guards for the three things v1.52.0 made shared rather than per-chart:
//
//   1. the SERIES palette, which the theme now owns (`--series-1 … -20`) and
//      this module consumes instead of carrying its own array literal;
//   2. the country → slot and item-type → `--type-*` colour grammars, which
//      every chart that encodes those categories must read from one place —
//      the dashboard previously ran four contradictory country grammars in
//      one scroll because each builder made its own arrangement with ECharts'
//      default per-series cycling;
//   3. `P.buildWindowDisclosure`, the "showing 20 of 82" note that turned the
//      Gantt's silent truncation into a stated, escapable one.
//
// These run the real sources in a vm against a fake DOM, the same way
// panels.test.js does, so a regression fails here rather than on the site.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'tokens.json'), 'utf8'));

const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const I18N = read('asset', 'js', 'iwac-i18n.js');
const PANELS = read('asset', 'js', 'charts', 'shared', 'panels.js');
const CONTROLS = read('asset', 'js', 'charts', 'shared', 'panels-controls.js');
const PANELS_MAP = read('asset', 'js', 'charts', 'shared', 'panels-map.js');
const CHART_OPTIONS = read('asset', 'js', 'charts', 'shared', 'chart-options.js');

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.attributes = {};
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.hidden = false;
        this.listeners = {};
    }

    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name]; }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    click() { for (const fn of this.listeners.click || []) fn({}); }
}

/**
 * Boot the shared modules in one vm context.
 *
 * `readColorVar` is the seam every colour lookup goes through, so the fake
 * simply answers with the token NAME. That keeps the assertions about which
 * token a chart reads — which is the whole contract — instead of about hex
 * values the theme is free to change.
 */
function loadModules(options = {}) {
    const palette = options.palette
        || TOKENS.series[options.theme === 'dark' ? 'dark' : 'light'];
    const context = {
        console: { warn() {}, error() {} },
        Intl,
        document: {
            createElement: (tag) => new FakeElement(tag),
            // iwac-i18n reads the site language off <html lang>.
            documentElement: { getAttribute: () => options.locale || 'en' },
        },
        setTimeout,
        clearTimeout,
        window: {
            IWACVis: {
                readColorVar: (name) => name,
                getSeriesColor: (slot) => palette[
                    ((Number(slot) % palette.length) + palette.length) % palette.length
                ],
            },
            IWACVisLazy: options.lazy,
        },
    };
    context.window.window = context.window;
    vm.createContext(context);
    // The REAL dictionary, not a stub: half of what these controls promise is
    // that the strings they render exist in both languages and interpolate the
    // numbers they claim to.
    vm.runInContext(I18N, context, { filename: 'iwac-i18n.js' });
    vm.runInContext(PANELS, context, { filename: 'panels.js' });
    vm.runInContext(CONTROLS, context, { filename: 'panels-controls.js' });
    vm.runInContext(PANELS_MAP, context, { filename: 'panels-map.js' });
    vm.runInContext(CHART_OPTIONS, context, { filename: 'chart-options.js' });
    return {
        context,
        P: context.window.IWACVis.panels,
        C: context.window.IWACVis.chartOptions,
    };
}

/* ------------------------------------------------------------------ */
/*  The published series contract                                      */
/* ------------------------------------------------------------------ */

test('the module consumes the theme series scale rather than its own literals', () => {
    const source = read('asset', 'js', 'iwac-theme.js');
    assert.doesNotMatch(source, /PALETTE_REST/,
        'the old module-owned palette array is gone — the theme publishes `series`');
    // Slots 3-20 are read live so a divergent dark scale needs no module change.
    assert.match(source, /readColorVar\('--series-' \+ \(i \+ 1\)\)/,
        'series slots must be read from CSS, not baked from the fallback array');
    // …and the two leads stay on the admin-tunable brand tokens.
    assert.match(source, /var palette = \[tokens\.primary, tokens\.secondary\]/,
        'slots 0 and 1 must come from the live --primary / --secondary reads');
});

test('country slots are fixed, shared, and independent of chart order', () => {
    const { C } = loadModules();
    const light = TOKENS.series.light;

    // The published table in chart-options.js, asserted rather than described.
    assert.equal(C._countrySlot('Bénin'), 0);
    assert.equal(C._countrySlot('Burkina Faso'), 1);
    assert.equal(C._countrySlot("Côte d'Ivoire"), 2);
    assert.equal(C._countrySlot('Niger'), 3);
    assert.equal(C._countrySlot('Nigeria'), 4);
    assert.equal(C._countrySlot('Togo'), 5);
    assert.equal(C._countrySlot('Sénégal'), 6);

    assert.equal(C._countryColor('Burkina Faso'), light[1]);
    // Asking in a different order must not move anything: the defect this
    // replaces was exactly a colour that depended on where a country sorted.
    assert.equal(C._countryColor('Togo'), light[5]);
    assert.equal(C._countryColor('Bénin'), light[0]);
});

test('accented and unaccented spellings of one country share a colour', () => {
    const { C } = loadModules();
    for (const [a, b] of [['Benin', 'Bénin'], ['Senegal', 'Sénégal'], ["Cote d'Ivoire", "Côte d'Ivoire"]]) {
        assert.equal(C._countryColor(a), C._countryColor(b),
            `${a} and ${b} are the same country — the bundles spell it both ways`);
    }
});

test('an unknown country takes a free slot instead of colliding with Bénin', () => {
    const { C } = loadModules();
    const unknown = C._countryColor('Ghana');
    assert.notEqual(unknown, C._countryColor('Bénin'));
    assert.equal(unknown, C._countryColor('Ghana'), 'and it must be stable within the page');
});

test('the dark scale flows through without a module change', () => {
    const { C } = loadModules({ theme: 'dark' });
    // Contract v1 diverges only in the two lead slots; the assertion is that
    // the module reads whatever the theme publishes, not that they differ.
    assert.equal(C._countryColor('Bénin'), TOKENS.series.dark[0]);
    assert.equal(C._countryColor('Burkina Faso'), TOKENS.series.dark[1]);
});

test('item types are painted from the theme --type-* map, not the series scale', () => {
    const { C } = loadModules();
    // Re-homed into this realm: the map is built inside the vm, so its
    // prototype is the vm's and deepEqual would reject an identical object.
    assert.deepEqual({ ...C.typeColors() }, {
        article: '--type-article',
        publication: '--type-publication',
        document: '--type-document',
        audiovisual: '--type-audiovisual',
        reference: '--type-reference',
        // The pipeline calls it `image`; the theme names the token after what
        // the thing is.
        image: '--type-photograph',
    });
    for (const token of Object.values(C.typeColors())) {
        assert.ok(TOKENS.names.includes(token), `${token} is not a published theme token`);
    }
});

/* ------------------------------------------------------------------ */
/*  Windowed-chart disclosure                                          */
/* ------------------------------------------------------------------ */

test('a windowed chart states the window and offers a way out', () => {
    const { P } = loadModules();
    const toggles = [];
    const d = P.buildWindowDisclosure({
        windowSize: 20,
        total: 82,
        noteKey: 'gantt_window_note',
        allKey: 'gantt_window_all',
        showAllKey: 'gantt_show_all',
        showTopKey: 'gantt_show_top',
        onToggle: (expanded) => toggles.push(expanded),
    });

    const [text, button] = d.root.children;
    assert.equal(d.root.hidden, false);
    assert.match(text.textContent, /20.*82/, 'the count must name both numbers');
    assert.equal(text.getAttribute('role'), 'status',
        'the count changes when a facet narrows the data — it has to be announced');
    assert.equal(button.getAttribute('aria-expanded'), 'false');

    button.click();
    assert.deepEqual(toggles, [true]);
    assert.equal(d.isExpanded(), true);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.match(text.textContent, /82/);
});

test('the disclosure and the chart descriptions are French on the French site', () => {
    const { P, context } = loadModules({ locale: 'fr' });
    const d = P.buildWindowDisclosure({
        windowSize: 20, total: 82,
        noteKey: 'gantt_window_note', showAllKey: 'gantt_show_all', onToggle() {},
    });
    const [text, button] = d.root.children;
    assert.match(text.textContent, /journaux/, 'the count fell back to English');
    assert.match(button.textContent, /Afficher/);

    // The chart text alternative is the only thing a screen reader gets, and
    // it was English on the FR site for as long as ECharts generated it.
    const t = context.window.IWACVis.t;
    for (const key of ['chart_aria_plain', 'chart_aria_single', 'chart_aria_summary', 'chart_aria_zoom']) {
        assert.notEqual(t(key), key, `${key} has no French translation`);
    }
    assert.match(t('chart_aria_summary', { title: 'Couverture', series: 3, points: 12 }),
        /^Couverture : graphique de 3 séries et 12 valeurs\.$/);
});

test('nothing is hidden, nothing is said', () => {
    const { P } = loadModules();
    const d = P.buildWindowDisclosure({ windowSize: 20, total: 6, onToggle() {} });
    assert.equal(d.root.hidden, true,
        'a disclosure that fires on a 6-row chart trains the reader to ignore it');
    assert.equal(d.root.children[0].textContent, '');
});

test('narrowing past the window collapses an expanded chart', () => {
    const { P } = loadModules();
    const d = P.buildWindowDisclosure({ windowSize: 20, total: 82, onToggle() {} });
    d.root.children[1].click();
    assert.equal(d.isExpanded(), true);

    // A country facet leaves 4 newspapers: staying "expanded" would strand a
    // 2,000px panel holding four bars.
    assert.equal(d.update(4), false);
    assert.equal(d.root.hidden, true);
});

/* ------------------------------------------------------------------ */
/*  MapLibre readiness                                                 */
/* ------------------------------------------------------------------ */

test('whenMaplibre resolves off the published import promise', async () => {
    const namespace = { Map() {} };
    const { P, context } = loadModules({
        lazy: { mjsP: Promise.resolve(namespace) },
    });
    // The loader publishes the global when the import settles; the gate must
    // not resolve before then.
    context.window.maplibregl = namespace;
    context.maplibregl = namespace;
    assert.equal(await P.whenMaplibre(), namespace);
});

test('whenMaplibre rejects when the page never armed an import', async () => {
    const { P } = loadModules({ lazy: undefined });
    await assert.rejects(() => P.whenMaplibre(), /MapLibre was not requested/,
        'a map panel must show "unavailable", not spin forever');
});

test('whenMaplibre rejects when the import failed', async () => {
    const { P } = loadModules({
        lazy: { mjsP: Promise.reject(new Error('CDN unreachable')) },
    });
    await assert.rejects(() => P.whenMaplibre(), /CDN unreachable/);
});
