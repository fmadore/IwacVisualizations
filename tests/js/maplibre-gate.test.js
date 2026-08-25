'use strict';

/**
 * Regression cover for the v1.53.0 "Map library unavailable" bug.
 *
 * MapLibre 6 is ESM-only, so the loader import()s it in PARALLEL with the
 * classic script chain. `entity-networks/graph.js` read `maplibregl`
 * synchronously at chart boot, `P.createIwacMap` returned null, and the
 * orchestrator painted a PERMANENT error banner over a panel that would have
 * drawn a second later. Warm caches let the import win, so it passed every
 * smoke test and failed on production.
 *
 * These tests hold the import pending on purpose — the deterministic version
 * of the race — and assert the panel waits instead of giving up.
 */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, 'asset', 'js', 'charts', ...parts), 'utf8');

const PANELS_SOURCE = read('shared', 'panels.js');
const PANELS_MAP_SOURCE = read('shared', 'panels-map.js');
const GRAPH_SOURCE = read('entity-networks', 'graph.js');

class FakeElement {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.attributes = {};
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.style = {};
        this.parentNode = null;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
    }

    removeChild(child) {
        this.children = this.children.filter((c) => c !== child);
        child.parentNode = null;
        return child;
    }

    /** Class names present anywhere in this element's subtree. */
    classes() {
        const out = [];
        const walk = (el) => {
            if (el.className) out.push(...String(el.className).split(/\s+/).filter(Boolean));
            el.children.forEach(walk);
        };
        this.children.forEach(walk);
        return out;
    }
}

/** Boot panels.js + panels-map.js with MapLibre still importing. */
function loadGate({ maplibre = 'pending' } = {}) {
    let resolveImport;
    let rejectImport;
    const mjsP =
        maplibre === 'none'
            ? null
            : new Promise((resolve, reject) => {
                resolveImport = resolve;
                rejectImport = reject;
            });
    if (mjsP) mjsP.catch(() => {});

    const context = {
        console: { log() {}, warn() {}, error() {} },
        document: { createElement: (tag) => new FakeElement(tag) },
        fetch: () => Promise.reject(new Error('unexpected fetch')),
        setTimeout,
        clearTimeout,
        Promise,
        window: {
            IWACVis: { locale: 'en', t: (key) => key, formatNumber: String },
            IWACVisLazy: mjsP ? { mjsP } : undefined,
        },
    };
    context.window.window = context.window;
    vm.createContext(context);
    vm.runInContext(PANELS_SOURCE, context, { filename: 'panels.js' });
    vm.runInContext(PANELS_MAP_SOURCE, context, { filename: 'panels-map.js' });

    return {
        context,
        P: context.window.IWACVis.panels,
        ns: context.window.IWACVis,
        el: () => new FakeElement('div'),
        land(namespace = {}) {
            context.maplibregl = namespace;
            context.window.maplibregl = namespace;
            resolveImport(namespace);
            return mjsP.then(() => flush());
        },
        fail(err = new Error('CDN down')) {
            rejectImport(err);
            return mjsP.catch(() => flush());
        },
    };
}

/** Drain the microtask queue a few times over. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('whenMaplibre resolves off the loader promise instead of the global', async () => {
    const gate = loadGate();
    let settled = null;
    gate.P.whenMaplibre().then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });

    await flush();
    assert.equal(settled, null, 'must not settle while the import is in flight');

    await gate.land({ Map: function () {} });
    assert.equal(settled, 'resolved');
});

test('whenMaplibre rejects when the page never armed the import', async () => {
    const gate = loadGate({ maplibre: 'none' });
    await assert.rejects(gate.P.whenMaplibre(), /not requested/);
});

test('withMaplibre shows the spinner while importing, never the error banner', async () => {
    const gate = loadGate();
    const host = gate.el();
    let built = 0;

    gate.P.withMaplibre(host, () => { built++; return true; });
    await flush();

    assert.equal(built, 0);
    assert.ok(host.classes().includes('iwac-vis-loading'), 'expected the map spinner');
    assert.ok(!host.classes().includes('iwac-vis-error'), 'a pending import is not a failure');

    await gate.land({});
    assert.equal(built, 1);
    assert.ok(!host.classes().includes('iwac-vis-loading'), 'spinner must be cleared');
    assert.ok(!host.classes().includes('iwac-vis-error'));
});

test('withMaplibre shows the error banner when the import genuinely fails', async () => {
    const gate = loadGate();
    const host = gate.el();
    let built = 0;

    gate.P.withMaplibre(host, () => { built++; });
    await gate.fail();

    assert.equal(built, 0);
    assert.ok(host.classes().includes('iwac-vis-error'), 'a failed import IS an error');
    assert.ok(!host.classes().includes('iwac-vis-loading'));
});

test('deferMaplibre replays queued calls into the controller, in order', async () => {
    const gate = loadGate();
    const host = gate.el();
    const calls = [];

    const facade = gate.P.deferMaplibre(host, () => ({
        setData: (d) => calls.push(['setData', d]),
        resize: () => calls.push(['resize']),
    }), ['setData', 'resize']);

    assert.ok(facade, 'a controller must come back synchronously — callers wire it into handlers');
    facade.setData('global');
    facade.resize();
    await flush();
    assert.deepEqual(calls, [], 'nothing can run before the library lands');
    assert.equal(facade.target(), null);

    await gate.land({});
    assert.deepEqual(calls, [['setData', 'global'], ['resize']]);
    assert.ok(facade.target(), 'the real controller is reachable once it exists');

    facade.setData('later');
    assert.deepEqual(calls.at(-1), ['setData', 'later'], 'later calls pass straight through');
});

test('deferMaplibre drops queued calls and shows the banner on import failure', async () => {
    const gate = loadGate();
    const host = gate.el();
    let factoryRuns = 0;

    const facade = gate.P.deferMaplibre(host, () => { factoryRuns++; return {}; }, ['setData']);
    facade.setData('global');
    await gate.fail();

    assert.equal(factoryRuns, 0);
    assert.equal(facade.target(), null);
    assert.ok(host.classes().includes('iwac-vis-error'));
});

/* ------------------------------------------------------------------ */
/*  The actual regression: the entity-networks graph                    */
/* ------------------------------------------------------------------ */

function fakeMap() {
    return {
        handlers: {},
        on(type, a, b) { (this.handlers[type] ||= []).push(b || a); return this; },
        off() { return this; },
        getLayer: () => null,
        getSource: () => null,
        isStyleLoaded: () => false,
        getCanvas: () => ({ style: {} }),
        easeTo() {},
        resize() {},
        queryRenderedFeatures: () => [],
    };
}

/** Boot entity-networks/graph.js on top of a gate whose import is pending. */
function loadGraph() {
    const gate = loadGate();
    const created = [];
    gate.P.createIwacMap = (container, config) => {
        created.push({ container, config });
        return fakeMap();
    };
    gate.P.createIwacPopup = () => ({
        setLngLat() { return this; },
        setDOMContent() { return this; },
        addTo() { return this; },
        remove() { return this; },
    });
    gate.P.attachFeatureStateHover = () => () => {};
    gate.P.normalizeColorForMapLibre = (c) => c;
    gate.ns.getChartTokens = () => ({});
    gate.ns.getPalette = () => ['#ce4115'];

    vm.runInContext(GRAPH_SOURCE, gate.context, { filename: 'entity-networks/graph.js' });
    return { gate, created, graph: gate.ns.entityNetworks.graph };
}

const GLOBAL_DATA = {
    types: ['Personnes'],
    weightMin: 2,
    nodes: [{ id: 1, label: 'A', type: 0, count: 3, degree: 1, strength: 1, lng: 0, lat: 0, rank: 0 }],
    edges: [],
};

test('entity-networks graph waits for MapLibre instead of declaring it unavailable', async () => {
    const { gate, created, graph } = loadGraph();
    const host = gate.el();

    const controller = graph.create(host, { mode: 'abstract', onSelect() {} });

    // The pre-fix contract was `create() -> null`, which the orchestrator read
    // as "no map library" and turned into a permanent error banner.
    assert.ok(controller, 'create() must return a controller even before MapLibre lands');
    controller.setData(GLOBAL_DATA);
    await flush();

    assert.equal(created.length, 0, 'no map may be built before the import settles');
    assert.ok(host.classes().includes('iwac-vis-loading'), 'the panel shows its loading state');
    assert.ok(
        !host.classes().includes('iwac-vis-error'),
        'a pending import must never paint "Map library unavailable"'
    );

    await gate.land({});

    assert.equal(created.length, 1, 'the map is built once the library lands');
    assert.equal(created[0].config.styleMode, 'graph', 'abstract mode keeps the blank graph canvas');
    assert.ok(!host.classes().includes('iwac-vis-error'));
    assert.ok(!host.classes().includes('iwac-vis-loading'));
    assert.ok(controller.target(), 'the queued setData had a controller to replay into');
});

test('entity-networks graph still surfaces a genuine MapLibre failure', async () => {
    const { gate, created, graph } = loadGraph();
    const host = gate.el();

    const controller = graph.create(host, { mode: 'abstract', onSelect() {} });
    controller.setData(GLOBAL_DATA);
    await gate.fail();

    assert.equal(created.length, 0);
    assert.equal(controller.target(), null);
    assert.ok(
        host.classes().includes('iwac-vis-error'),
        'the error banner is reserved for an import that actually failed'
    );
});
