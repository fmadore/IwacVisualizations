'use strict';

// The laïcité orchestrator's state rules and view lifecycle (laicite.js,
// controls.js).
//
// Two things here are invisible in a screenshot until they have already
// gone wrong for a reader:
//
//   1. The store reducer. Every cross-field rule — one country moves all
//      four country keys, a corpus resets its outlet, a map frame and a map
//      country exclude each other — used to live inline in render(), where
//      nothing could reach it. It is `L.laiciteReducer` now, a pure function,
//      tested as one.
//
//   2. The parked map. The map view is built once and re-attached on every
//      later visit (a WebGL context is expensive, and browsers cap them).
//      It was parked as `parked.map` while draw()'s disposal guard checked
//      `parked.places`, so leaving the map ran `disposeWithin` over it —
//      `map.remove()` — and coming back re-attached a dead, blank canvas.
//      The test drives the real orchestrator map → overview → map and
//      asserts on which nodes were handed to `disposeWithin`.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');

/* ------------------------------------------------------------------ */
/*  A DOM small enough to read (same shape as laicite-update.test.js)  */
/* ------------------------------------------------------------------ */

function makeElement(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        className: '',
        children: [],
        style: {},
        dataset: {},
        hidden: false,
        textContent: '',
        parentNode: null,
        attrs: {},
        appendChild(child) {
            if (child.parentNode && child.parentNode !== el) {
                const siblings = child.parentNode.children;
                siblings.splice(siblings.indexOf(child), 1);
            }
            child.parentNode = el;
            el.children.push(child);
            return child;
        },
        setAttribute(name, value) { el.attrs[name] = String(value); },
        getAttribute(name) { return el.attrs[name] ?? null; },
        addEventListener() {},
        querySelector() { return null; },
        contains() { return false; },
    };
    Object.defineProperty(el, 'innerHTML', {
        get() { return ''; },
        set(value) {
            if (value !== '') return;
            el.children.forEach((c) => { c.parentNode = null; });
            el.children.length = 0;
        },
    });
    return el;
}

function walk(el, out = []) {
    out.push(el);
    for (const child of el.children) walk(child, out);
    return out;
}

/* ------------------------------------------------------------------ */
/*  Loading                                                            */
/* ------------------------------------------------------------------ */

function load(files, context) {
    for (const rel of files) {
        vm.runInContext(readFileSync(join(ROOT, rel), 'utf8'), context, { filename: rel });
    }
}

/** controls.js alone: the reducer and the view keys, no DOM needed. */
function loadReducer() {
    const ns = { panels: {} };
    const context = { console: { warn() {} }, window: { IWACVis: ns } };
    context.window.window = context.window;
    vm.createContext(context);
    load(['asset/js/charts/laicite/controls.js'], context);
    return ns.laicite;
}

/**
 * The real orchestrator over the real store, with every view builder
 * stubbed: what is under test is draw()'s bookkeeping, not the views.
 */
function loadOrchestrator() {
    const disposed = [];
    const mapBuilds = [];
    let boot = null;
    let store = null;

    const P = {
        el(tag, className, text) {
            const node = makeElement(tag || 'div');
            if (className) node.className = className;
            if (text != null) node.textContent = String(text);
            return node;
        },
        t(key) { return key; },
        formatNumber(n) { return String(n); },
        isCompact() { return false; },
        emptyChartOption() { return {}; },
        buildLoadingState() { return P.el('div', 'iwac-vis-loading'); },
        fetchJSON(url) {
            const name = url.split('/').pop();
            if (name === 'laicite-places.json') {
                return Promise.resolve({ places: [{ name: 'Lomé', items: 3 }] });
            }
            return Promise.resolve(null);
        },
        bootBlock(cfg) { boot = cfg; },
    };

    const ns = {
        panels: P,
        chartOptions: {},
        registerChart() { return null; },
        disposeWithin(node) { disposed.push(node); },
    };

    const context = {
        console: { warn() {}, error() {} },
        Promise,
        URL,
        URLSearchParams,
        setTimeout: (fn) => { fn(); return 0; },
        window: { IWACVis: ns, setTimeout: (fn) => { fn(); return 0; } },
    };
    context.window.window = context.window;
    vm.createContext(context);
    load([
        'asset/js/charts/shared/store.js',
        'asset/js/charts/laicite/helpers.js',
        'asset/js/charts/laicite/research.js',
        'asset/js/charts/laicite/controls.js',
    ], context);

    const L = ns.laicite;
    const node = (cls) => () => P.el('div', cls);
    Object.assign(L, {
        buildFrameColorMap: () => ({}),
        buildMetricCards: node('metrics'),
        buildAuthorityLink: () => null,
        createConcordance: () => ({
            host: P.el('div', 'kwic-host'),
            render() {},
            availableSubsets: () => ['articles'],
            countriesFor: () => [],
        }),
        createControls: (ctx) => {
            store = ctx.store;
            return { mount() {}, sync() {} };
        },
        buildVenn: node('venn'),
        buildSubsetTable: node('subsets'),
        buildResearch: () => ({ root: P.el('div', 'coverage'), update() {} }),
        buildVideos: node('videos'),
        buildRightsNote: node('rights'),
        buildFrameLegend: node('frames'),
        buildMap: () => {
            const built = {
                root: P.el('div', 'map-view'),
                mounts: 0,
                updates: 0,
                mount() { built.mounts++; },
                update() { built.updates++; },
                resize() {},
            };
            mapBuilds.push(built);
            return built;
        },
    });

    load(['asset/js/charts/laicite.js'], context);

    const container = P.el('div', 'iwac-vis-laicite');
    container.dataset.siteBase = '/s/test';
    boot.render(container, [
        { frame_order: [], countries: ['Togo'] },   // metadata
        null, null, null, null,                     // trends, documents, events, concordance
    ], { dataBase: '/files/' });

    const viewHost = walk(container).find((n) => n.className === 'iwac-vis-laicite-viewhost');
    return { store: () => store, viewHost, disposed, mapBuilds };
}

/** Let the store's microtask flush and any fetch chain run to the end. */
function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

/* ------------------------------------------------------------------ */
/*  The reducer                                                        */
/* ------------------------------------------------------------------ */

test('one country key moves all four, with each view\'s own empty value', () => {
    const L = loadReducer();
    const reduce = L.laiciteReducer(['Togo', 'Bénin']);

    const st = { mapCountry: 'Togo' };
    assert.deepEqual({ ...reduce(st, ['mapCountry']) },
        { mapFrame: '', trendsCountry: 'Togo', kwicCountry: 'Togo', arenaCountry: 'Togo' });

    const cleared = reduce({ kwicCountry: '' }, ['kwicCountry']);
    assert.equal(cleared.trendsCountry, null, 'the timeline spells "all" as null');
    assert.equal(cleared.mapCountry, '', 'the selects spell "all" as an empty string');
});

test('a country the dossier does not hold stays where it was picked', () => {
    const L = loadReducer();
    const reduce = L.laiciteReducer(['Togo']);
    const extra = reduce({ arenaCountry: 'Ghana' }, ['arenaCountry']);
    assert.ok(!('trendsCountry' in extra) && !('mapCountry' in extra),
        'an unknown value would narrow the other views to nothing');
});

test('a new corpus resets the outlet, unless the same patch names one', () => {
    const L = loadReducer();
    const reduce = L.laiciteReducer([]);
    assert.equal(reduce({ trendsSubset: 'publications' }, ['trendsSubset']).trendsOutlet, '');
    // A URL carrying `subset` and `outlet` hydrates both in one patch; the
    // outlet it names must survive the corpus it arrives with.
    const both = reduce({ trendsSubset: 'publications', trendsOutlet: 'Al Islam' },
        ['trendsSubset', 'trendsOutlet']);
    assert.ok(!('trendsOutlet' in both), 'the outlet from the URL was wiped on load');
});

test('scope, concordance corpus and map frame each clear their dependant', () => {
    const L = loadReducer();
    const reduce = L.laiciteReducer(['Togo']);
    assert.equal(reduce({ colScope: 'by_decade' }, ['colScope']).colSlice, null);
    assert.equal(reduce({ kwicSubset: 'documents' }, ['kwicSubset']).kwicCountry, '');
    assert.equal(reduce({ mapFrame: 'ecole' }, ['mapFrame']).mapCountry, '');
    assert.ok(!('mapCountry' in reduce({ mapFrame: '' }, ['mapFrame'])),
        'clearing the frame must not clear the country');
});

test('the country keys are the four views that filter by country', () => {
    const L = loadReducer();
    assert.deepEqual([...L.COUNTRY_KEYS],
        ['trendsCountry', 'kwicCountry', 'arenaCountry', 'mapCountry']);
});

/* ------------------------------------------------------------------ */
/*  The parked map                                                     */
/* ------------------------------------------------------------------ */

test('the parked map survives a trip to another view and comes back alive', async () => {
    const h = loadOrchestrator();
    const store = h.store();
    assert.ok(store, 'the controls never received the store');

    store.patch({ view: 'map' });
    await settle();
    assert.equal(h.mapBuilds.length, 1, 'the map view was not built');
    const map = h.mapBuilds[0];
    assert.equal(map.mounts, 1);
    assert.ok(h.viewHost.children.includes(map.root), 'the map is not on screen');

    store.patch({ view: 'overview' });
    await settle();
    assert.ok(!h.disposed.includes(map.root),
        'leaving the map disposed its parked root — map.remove() on a view that comes back');
    assert.ok(!h.viewHost.children.includes(map.root));

    store.patch({ view: 'map' });
    await settle();
    assert.equal(h.mapBuilds.length, 1, 'the map was rebuilt instead of re-attached');
    assert.ok(h.viewHost.children.includes(map.root), 'the same root did not come back');
    assert.equal(map.mounts, 1, 'a re-attached map must not be mounted a second time');
    assert.ok(map.updates >= 1, 're-attaching must repaint it from the current state');
    assert.ok(!h.disposed.includes(map.root));
});

test('views that are not parked are still released when the reader leaves', async () => {
    const h = loadOrchestrator();
    const store = h.store();
    const overview = h.viewHost.children.slice();
    assert.ok(overview.length > 0, 'the overview did not render');

    store.patch({ view: 'map' });
    await settle();
    // Every overview node went through disposeWithin: the fix exempts the
    // parked roots, not everything.
    overview.forEach((node) => {
        assert.ok(h.disposed.includes(node), `${node.className} was not released`);
    });
});

/* ------------------------------------------------------------------ */
/*  Plurals and percentages, against the real catalogues               */
/* ------------------------------------------------------------------ */

/** iwac-i18n.js + the block catalogue + helpers, in one locale. */
function loadLocale(locale) {
    const context = {
        console,
        Intl,
        navigator: { language: locale },
        document: {
            documentElement: { lang: locale, getAttribute: (n) => (n === 'lang' ? locale : null) },
            querySelector: () => null,
        },
        window: {},
    };
    context.window.IWACVis = {};
    context.window.window = context.window;
    vm.createContext(context);
    load(['asset/js/iwac-i18n.js'], context);
    const ns = context.window.IWACVis;
    ns.locale = locale;
    ns.panels = {
        t: (k, v) => ns.t(k, v),
        formatNumber: (n) => ns.formatNumber(n),
        formatPercent: (v, d) => ns.formatPercent(v, d),
        formatDecimal: (v, d) => ns.formatDecimal(v, d),
    };
    load(['asset/js/charts/laicite/i18n.js', 'asset/js/charts/laicite/helpers.js'], context);
    return ns;
}

test('a single hidden record reads in the singular, in both languages', () => {
    const en = loadLocale('en');
    assert.equal(en.t('laicite.concordance_strict_hidden', { count: 1 }),
        '1 record hidden by the strict filter.');
    assert.equal(en.t('laicite.concordance_strict_hidden', { count: 2 }),
        '2 records hidden by the strict filter.');
    const fr = loadLocale('fr');
    assert.equal(fr.t('laicite.concordance_count', { count: 1 }), '1 ligne');
    assert.equal(fr.t('laicite.concordance_count', { count: 0 }), '0 ligne',
        'French puts zero with the singular');
    assert.equal(fr.t('laicite.concordance_count', { count: 1200 }).replace(/\s/g, ' '), '1 200 lignes',
        'the count is still written with the locale separator');
});

test('every _one variant has its plural beside it, in both catalogues', () => {
    const src = readFileSync(join(ROOT, 'asset/js/charts/laicite/i18n.js'), 'utf8');
    const [en, fr] = src.split("ns.addTranslations('fr'");
    for (const part of [en, fr]) {
        const ones = [...part.matchAll(/'([\w.]+)_one'/g)].map((m) => m[1]);
        assert.ok(ones.length >= 10);
        ones.forEach((key) => {
            assert.ok(part.includes(`'${key}'`), `${key}_one has no plural form to fall back to`);
        });
    }
});

test('percentages follow the page locale', () => {
    const en = loadLocale('en');
    const fr = loadLocale('fr');
    assert.equal(en.laicite.formatPercent(12.5), '12.5%');
    assert.equal(fr.laicite.formatPercent(12.5).replace(/\s/g, ' '), '12,5 %',
        'the French site printed "12.5%"');
    assert.equal(en.laicite.formatPercent(null), '—');
    assert.equal(fr.laicite.formatDecimal(87.25).replace(/\s/g, ' '), '87,3');
    assert.equal(en.laicite.formatDecimal(40), '40', 'prose shares carry no trailing zero');
});
