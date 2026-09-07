#!/usr/bin/env node
/**
 * Guard: nothing may touch the MapLibre global without awaiting it.
 *
 * WHY THIS EXISTS
 * ---------------
 * MapLibre has been ESM-only since v6, so it cannot ride the classic script
 * chain. `view/common/iwac-assets.phtml` `import()`s it in PARALLEL with that
 * chain and publishes the promise as `window.IWACVisLazy.mjsP`; every consumer
 * is supposed to await it through `P.whenMaplibre()` / `P.withMaplibre()` /
 * `P.deferMaplibre()` (asset/js/charts/shared/panels-map.js).
 *
 * Before v1.52.0 the loader SERIALIZED that import ahead of the whole chain, so
 * a panel could read `maplibregl` synchronously and get away with it. v1.52.0
 * de-serialized the loader and converted the eight files named `*map*.js` — and
 * missed `entity-networks/graph.js`, a MapLibre consumer that is not named like
 * a map. `P.createIwacMap` returned null, the orchestrator read the null as
 * "no map library", and the co-occurrence panel painted a permanent "Map
 * library unavailable" over a graph that would have drawn a second later.
 *
 * It shipped because it is a RACE: a warm cache lets the import win and every
 * smoke test passes. A race that only fails on a cold cache is exactly what a
 * static guard is for. Four more files (index-overview/keywords-attention.js,
 * laicite/map.js, scary-terms/map.js, references-overview.js) were in the same
 * state and were converted alongside it in v1.54.0.
 *
 * WHAT IS CHECKED
 * ---------------
 * For every non-minified file under `asset/js/`, with comments and string
 * literals removed so class names like `'maplibregl-ctrl'` and `@param
 * {maplibregl.Map}` are not mistaken for code:
 *
 *   1. A file that CONSTRUCTS a map — calls `P.createIwacMap(` — must also
 *      call one of the three gates in the same file.
 *   2. A file that reads the `maplibregl` GLOBAL — `new maplibregl.X`,
 *      `maplibregl.Y(...)`, `typeof maplibregl` — must do the same.
 *
 * EXEMPTIONS ARE EARNED, NOT LISTED
 * ---------------------------------
 * There is no path allowlist. A file is exempt only if it DEFINES part of the
 * gate machinery it would otherwise have to call:
 *
 *   - defines `P.whenMaplibre` / `P.withMaplibre` / `P.deferMaplibre` — it IS
 *     the gate (shared/panels-map.js);
 *   - defines `P.createIwacMap` / `P.createIwacPopup` — it is the wrapper that
 *     owns the `typeof maplibregl === 'undefined'` fallback every gated caller
 *     relies on (shared/maplibre.js).
 *
 * Helpers that only ever receive an already-live map (shared/choropleth.js,
 * shared/map-popup.js, shared/panel-toolbar.js) need no exemption at all: they
 * never construct one, so they never trip either rule. If one of them ever
 * starts constructing, the guard fires — which is the point.
 *
 * WHAT IS DELIBERATELY NOT CHECKED
 * --------------------------------
 * The d3 force-graph modules (shared/graph-force.js, graph-canvas.js,
 * graph-panel.js, entity-graph.js) read a `d3` global synchronously and that is
 * CORRECT: the d3-force UMD builds are pushed into the same ordered `$scripts`
 * list as the module's own JS and injected with `async = false`, so they are
 * guaranteed to have executed first. That asymmetry — d3 ordered, MapLibre not
 * — is the whole reason this bug class exists on one and not the other, so it
 * is asserted here rather than assumed (`checkLoaderAsymmetry`).
 *
 * THE BASEMAP LITERALS (M14)
 * --------------------------
 * The Carto style / glyph URLs are also checked here, because they are a
 * MapLibre fact and this is the MapLibre gate. They lived in three places —
 * `iwac-theme.js`, `P.setMapTheme` (which re-implemented `getBasemapStyle`
 * instead of calling it) and `P.createIwacMap`'s fallback for a
 * `getBasemapStyle` that cannot be absent — so a change to one silently left
 * two behind. `IWACVis.BASEMAP` in `iwac-theme.js` is now the only place a
 * `cartocdn` URL may appear in JavaScript, and the partial's `preconnect`
 * hosts must be exactly that object's origins: a hint for a host nothing
 * fetches is dead weight, and a fetch with no hint is the cold connection the
 * hint exists to remove.
 *
 * SEED VERIFICATION
 * -----------------
 * `--self-test` runs the analyzer over a synthetic file reproducing the
 * pre-fix entity-networks shape and fails if it is NOT reported. It runs on
 * every `npm run lint:maplibre`, so the guard is proved to be able to fail.
 */
'use strict';

const { readFileSync, readdirSync, statSync } = require('fs');
const { join, relative } = require('path');

const ROOT = join(__dirname, '..');
const JS_ROOT = join(ROOT, 'asset', 'js');
const PARTIAL = join(ROOT, 'view', 'common', 'iwac-assets.phtml');

const GATES = /\bP\.(whenMaplibre|withMaplibre|deferMaplibre)\s*\(/;
const DEFINES_GATE = /\bP\.(whenMaplibre|withMaplibre|deferMaplibre)\s*=/;
const DEFINES_WRAPPER = /\bP\.(createIwacMap|createIwacPopup)\s*=/;
const CREATES_MAP = /\bP\.createIwacMap\s*\(/;
const READS_GLOBAL = /(?:\bnew\s+maplibregl\b|\bmaplibregl\s*[.[]|\btypeof\s+maplibregl\b)/;

/** The one file allowed to name a basemap host, and the object that must own it. */
const BASEMAP_OWNER = 'asset/js/iwac-theme.js';
const BASEMAP_HOST = /https:\/\/[a-z.]*cartocdn\.com/g;
const BASEMAP_DECL = /ns\.BASEMAP\s*=\s*\{([\s\S]*?)\}/;

/**
 * `IWACVis.BASEMAP`'s origins must be exactly what the partial preconnects to:
 * a hint for a host nothing fetches is dead weight, and a fetch with no hint is
 * the cold connection the hint exists to remove.
 *
 * Returns a list of problems, empty when the two agree.
 */
function checkBasemapOrigins() {
    const problems = [];
    const owner = readFileSync(join(ROOT, BASEMAP_OWNER), 'utf8');
    const decl = owner.match(BASEMAP_DECL);
    if (!decl) {
        return [`${BASEMAP_OWNER}: no ns.BASEMAP object — the basemap URLs must live there`];
    }
    const origins = new Set(decl[1].match(BASEMAP_HOST) || []);
    if (!origins.size) problems.push(`${BASEMAP_OWNER}: ns.BASEMAP names no cartocdn host`);

    const partial = readFileSync(PARTIAL, 'utf8');
    const hinted = new Set(
        (partial.match(/'(https:\/\/[a-z.]*cartocdn\.com)'/g) || [])
            .map((m) => m.slice(1, -1))
    );
    for (const o of origins) {
        if (!hinted.has(o)) {
            problems.push(
                `view/common/iwac-assets.phtml: no preconnect for ${o}, `
                + 'which ns.BASEMAP fetches from'
            );
        }
    }
    for (const h of hinted) {
        if (!origins.has(h)) {
            problems.push(
                `view/common/iwac-assets.phtml: preconnects to ${h}, `
                + 'which ns.BASEMAP never fetches'
            );
        }
    }
    return problems;
}

/**
 * Strip comments and string/template literals so only executable code is
 * matched. Deliberately simple: the sources are hand-written ES5 with no
 * regex literals containing quotes, and a false NEGATIVE here would be a
 * missed violation, so the scanner errs toward keeping code.
 */
function codeOnly(source) {
    let out = '';
    let i = 0;
    const n = source.length;
    while (i < n) {
        const c = source[i];
        const next = source[i + 1];
        if (c === '/' && next === '/') {
            while (i < n && source[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && next === '*') {
            i += 2;
            while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            i++;
            while (i < n && source[i] !== quote) {
                if (source[i] === '\\') i++;
                i++;
            }
            i++;
            out += ' ';
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

function walk(dir, out) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (path.endsWith('.js') && !path.endsWith('.min.js')) out.push(path);
    }
    return out;
}

/**
 * @param {string} label   what to call the file in a message
 * @param {string} source  raw file contents
 * @returns {{label: string, reason: string}|null} a violation, or null
 */
function analyze(label, source) {
    const code = codeOnly(source);

    // Infrastructure: the gate itself, and the wrapper that owns the
    // "MapLibre is not here" fallback. Both must be free to touch the global.
    if (DEFINES_GATE.test(code) || DEFINES_WRAPPER.test(code)) return null;

    if (GATES.test(code)) return null;

    if (CREATES_MAP.test(code)) {
        return {
            label,
            reason: 'calls P.createIwacMap() without awaiting P.whenMaplibre() / '
                + 'P.withMaplibre() / P.deferMaplibre()',
        };
    }
    if (READS_GLOBAL.test(code)) {
        return {
            label,
            reason: 'reads the `maplibregl` global without awaiting P.whenMaplibre() / '
                + 'P.withMaplibre() / P.deferMaplibre()',
        };
    }
    return null;
}

/**
 * Assert the loading asymmetry the rules above depend on: MapLibre travels as
 * the parallel ESM payload (`$lazyMjs`), d3 rides the ordered classic chain
 * (`$scripts`). If MapLibre ever joined `$scripts`, or d3 left it, the reason
 * one needs a gate and the other does not would have changed silently.
 */
function checkLoaderAsymmetry() {
    const partial = readFileSync(PARTIAL, 'utf8');
    const problems = [];
    if (/\$scripts\[\]\s*=\s*\$cdnMaplibreJs/.test(partial)) {
        problems.push('iwac-assets.phtml pushes $cdnMaplibreJs into the ordered $scripts '
            + 'chain — an ES module cannot execute as a classic <script>');
    }
    if (!/\$lazyMjs\s*=\s*\$cdnMaplibreJs/.test(partial)) {
        problems.push('iwac-assets.phtml no longer hands $cdnMaplibreJs to $lazyMjs — '
            + 'P.whenMaplibre() resolves off that promise');
    }
    if (!/\$scripts\[\]\s*=\s*\$d3Script/.test(partial)) {
        problems.push('iwac-assets.phtml no longer pushes the d3 CDN builds into the '
            + 'ordered $scripts chain — the force-graph modules read `d3` '
            + 'synchronously and would need a gate of their own');
    }
    return problems;
}

/** Seed verification: the analyzer must reject the shape that shipped broken. */
const SEED = `
(function () {
    'use strict';
    var P = window.IWACVis.panels;
    function create(container, opts) {
        var map = P.createIwacMap(container, { center: [0, 0] });
        if (!map) return null;
        return { map: map };
    }
    window.IWACVis.entityNetworks = { graph: { create: create } };
})();
`;

/** …and must not reject the shape that fixes it. */
const SEED_FIXED = `
(function () {
    'use strict';
    var P = window.IWACVis.panels;
    function create(container, opts) {
        return P.deferMaplibre(container, function () {
            return P.createIwacMap(container, { center: [0, 0] });
        }, ['setData']);
    }
    window.IWACVis.entityNetworks = { graph: { create: create } };
})();
`;

/** A comment / class-name mention of maplibregl must NOT be a violation. */
const SEED_PROSE = `
(function () {
    /** @param {maplibregl.Map} map — receives a live map, never builds one. */
    function decorate(map) {
        var c = document.createElement('div');
        c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        map.getContainer().appendChild(c);
    }
    window.decorate = decorate;
})();
`;

function selfTest() {
    const failures = [];
    if (!analyze('seed:synchronous-consumer', SEED)) {
        failures.push('the guard did NOT flag a synchronous P.createIwacMap consumer');
    }
    if (analyze('seed:gated-consumer', SEED_FIXED)) {
        failures.push('the guard flagged a correctly gated consumer');
    }
    if (analyze('seed:prose-only', SEED_PROSE)) {
        failures.push('the guard flagged a file whose only `maplibregl` is a comment '
            + 'and a CSS class name');
    }
    return failures;
}

const seedFailures = selfTest();
if (seedFailures.length) {
    console.error('\n✗ maplibre gate guard: self-test failed — the guard cannot be trusted\n');
    for (const f of seedFailures) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
}

if (process.argv.includes('--self-test')) {
    console.log('✓ maplibre gate guard: self-test passed');
    process.exit(0);
}

const violations = [];
for (const path of walk(JS_ROOT, [])) {
    const found = analyze(relative(ROOT, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
    if (found) violations.push(found);
}
const loaderProblems = checkLoaderAsymmetry();

// M14: one source of truth for the basemap endpoints. Kept apart from the gate
// violations because the two failures call for different fixes.
const basemapProblems = checkBasemapOrigins();
for (const path of walk(JS_ROOT, [])) {
    const label = relative(ROOT, path).replaceAll('\\', '/');
    if (label === BASEMAP_OWNER) continue;
    const hits = readFileSync(path, 'utf8').match(BASEMAP_HOST);
    if (hits) {
        basemapProblems.push(
            `${label}: names a basemap host (${[...new Set(hits)].join(', ')})`
        );
    }
}

if (violations.length || loaderProblems.length || basemapProblems.length) {
    console.error('');
}

if (basemapProblems.length) {
    console.error('✗ maplibre gate guard: the basemap URLs have more than one home\n');
    for (const p of basemapProblems) console.error(`  ${p}`);
    console.error(
        '\n  They live in IWACVis.BASEMAP (asset/js/iwac-theme.js) and nowhere else:'
        + '\n  call ns.getBasemapStyle(mode) for a style URL, read ns.BASEMAP.glyphs'
        + '\n  for the font endpoint, and keep the partial\'s preconnect hosts equal'
        + '\n  to that object\'s origins.\n'
    );
}

if (violations.length || loaderProblems.length) {
    console.error('✗ maplibre gate guard: MapLibre is imported in parallel, not in order\n');
    for (const v of violations) {
        console.error(`  ${v.label}`);
        console.error(`    ${v.reason}`);
    }
    for (const p of loaderProblems) console.error(`  ${p}`);
    console.error(
        '\n  MapLibre 6 is ESM-only, so the loader import()s it alongside the classic'
        + '\n  script chain — the global is routinely absent when a panel renders. Wrap'
        + '\n  the map creation in P.withMaplibre(host, build) (render-once panels) or'
        + '\n  P.deferMaplibre(host, factory, methods) (panels that hand a live'
        + '\n  controller to a toolbar or sidebar). See asset/js/charts/shared/panels-map.js.\n'
    );
}

if (violations.length || loaderProblems.length || basemapProblems.length) {
    process.exit(1);
}

console.log(
    '✓ maplibre gate guard: every MapLibre consumer awaits the import, '
    + 'basemap URLs live in one place (self-test passed)'
);
