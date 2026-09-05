'use strict';

// Two contracts of dashboard-core that no screenshot can show and that the
// v1.59.0 audit found broken:
//
//   1. Describing a chart for assistive technology costs NOTHING extra. The
//      previous implementation re-described after every `setOption` with a
//      deep `getOption()` clone and a second, synchronous `setOption`, so one
//      render was four update passes and the `lazyUpdate` callers never got
//      their deferred frame. The description now rides inside the caller's
//      own option: one native call, the caller's second argument untouched,
//      `getOption()` never consulted.
//
//   2. Charts inside a subtree a block throws away are released with it
//      (`disposeWithin`), while a chart whose host is merely parked outside
//      the document is NOT — the laïcité dossier re-attaches its trends
//      panel between views, and disposing it in the meantime would blank it.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const CORE = readFileSync(join(ROOT, 'asset', 'js', 'dashboard-core.js'), 'utf8');

class MutationObserverStub {
    observe() {}
    disconnect() {}
}

function element(overrides = {}) {
    const attrs = {};
    return Object.assign({
        attrs,
        isConnected: true,
        parentElement: null,
        children: [],
        setAttribute(name, value) { attrs[name] = value; },
        getAttribute(name) { return attrs[name]; },
        addEventListener() {},
        closest() { return null; },
    }, overrides);
}

function loadCore() {
    const instances = [];
    const context = {
        console: { warn() {}, error() {} },
        setTimeout,
        clearTimeout,
        MutationObserver: MutationObserverStub,
        document: {
            currentScript: null,
            readyState: 'complete',
            body: { getAttribute: () => null, appendChild() {}, removeChild() {} },
            querySelector: () => null,
            createElement: () => ({ style: {} }),
            addEventListener() {},
        },
        echarts: {
            init(el) {
                const calls = [];
                let disposed = false;
                const instance = {
                    el,
                    calls,
                    setOption(option, arg) { calls.push([option, arg]); },
                    isDisposed() { return disposed; },
                    dispose() { disposed = true; },
                    resize() {},
                    getDom() { return el; },
                    getOption() { throw new Error('getOption() must not be consulted to describe a chart'); },
                };
                instances.push(instance);
                return instance;
            },
        },
        window: {
            IWACVis: {
                t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
            },
            addEventListener() {},
        },
    };
    context.window.document = context.document;
    vm.createContext(context);
    vm.runInContext(CORE, context, { filename: 'dashboard-core.js' });
    return { ns: context.window.IWACVis, instances };
}

test('a chart is described inside its own setOption — one pass, arguments intact', () => {
    const { ns } = loadCore();
    const el = element();

    const instance = ns.registerChart(el, (host, chart) => {
        chart.setOption({ title: { text: 'Items per year' }, series: [{ type: 'bar', data: [1, 2, 3] }] }, true);
    });

    assert.equal(instance.calls.length, 1, 'the render is exactly one native setOption');
    const [option, arg] = instance.calls[0];
    assert.equal(arg, true, 'the caller\'s notMerge flag passes through');
    const description = 'chart_aria_single:{"title":"Items per year","points":3}';
    // JSON round-trip: the option was built inside the vm realm, whose Object
    // prototype is not this realm's, and strict deep equality compares those.
    assert.deepEqual(JSON.parse(JSON.stringify(option.aria)), { enabled: true, label: { enabled: true, description } });
    assert.equal(el.attrs['aria-label'], description, 'the host carries the name (role=img prunes the inner div)');
    assert.equal(el.attrs.role, 'img');
    assert.equal(el.attrs.tabindex, '0');

    // The object form — the five lazyUpdate callers — is passed through as
    // given, and a full rebuild is re-described from the new series.
    instance.setOption({ series: [{ data: [4] }, { data: [5, 6] }] }, { notMerge: true, lazyUpdate: true });
    assert.deepEqual(JSON.parse(JSON.stringify(instance.calls[1][1])), { notMerge: true, lazyUpdate: true });
    assert.equal(
        instance.calls[1][0].aria.label.description,
        'chart_aria_summary:{"title":"Chart","series":2,"points":3}'
    );

    // A partial merge that carries no data keeps the description it has.
    instance.setOption({ legend: [{ show: false }] });
    assert.equal(instance.calls[2][0].aria.label.description, instance.calls[1][0].aria.label.description);
    assert.equal(instance.calls.length, 3, 'no follow-up pass was added to any of the three');

    // The R.withMedia form describes and labels the base option.
    instance.setOption({ baseOption: { series: [{ data: [1] }] }, media: [] }, true);
    assert.equal(instance.calls[3][0].baseOption.aria.label.description, 'chart_aria_single:{"title":"Chart","points":1}');
});

test('a dataZoom window is announced with its keyboard hint', () => {
    const { ns } = loadCore();
    const el = element();
    const instance = ns.registerChart(el, (host, chart) => {
        chart.setOption({
            series: [{ data: [1, 2] }],
            dataZoom: [{ type: 'slider', start: 0, end: 100 }],
        }, true);
    });
    assert.equal(
        instance.calls[0][0].aria.label.description,
        'chart_aria_single:{"title":"Chart","points":2} chart_aria_zoom'
    );
});

test('disposeWithin releases the charts of a discarded subtree and nothing else', () => {
    const { ns } = loadCore();
    const inside = element();
    const outside = element();
    const mapHost = element();
    const root = {
        contains: (node) => node === inside || node === mapHost,
    };

    const a = ns.registerChart(inside, () => {});
    const b = ns.registerChart(outside, () => {});
    let removed = false;
    const map = { remove() { removed = true; this._removed = true; }, _removed: false };
    ns.registerMap(map, mapHost);
    assert.equal(ns._charts.length, 3);

    assert.equal(ns.disposeWithin(root), 2);
    assert.equal(a.isDisposed(), true, 'the chart inside the root is disposed');
    assert.equal(b.isDisposed(), false, 'the chart outside it is untouched');
    assert.equal(removed, true, 'the map inside it gives its WebGL context back');
    assert.equal(ns._charts.length, 1);
    assert.equal(ns._charts[0].el, outside);
    assert.equal(ns.getLiveChart(inside), null);
    assert.equal(ns.getLiveChart(outside), b);
});

test('pruneCharts keeps a live chart whose host is merely parked outside the document', () => {
    const { ns } = loadCore();
    const parked = element({ isConnected: false });
    const chart = ns.registerChart(parked, () => {});
    ns.pruneCharts();
    assert.equal(chart.isDisposed(), false);
    assert.equal(ns.getLiveChart(parked), chart);

    chart.dispose();
    ns.pruneCharts();
    assert.equal(ns._charts.length, 0, 'a disposed chart is forgotten');
});
