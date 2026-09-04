'use strict';

// The newspaper Gantt has TWO ways to see more rows, and for one release they
// contradicted each other.
//
// The disclosure button widens the view correctly: it drops the zoom and the
// caller grows the host to match (`C.ganttHeight`). The ECharts zoom under the
// chart did the same widening WITHOUT telling the caller, so dragging its
// slider to full travel put all 84 press runs into a box built for 20 — about
// 3px a row, `interval: 0` still demanding every label, and 84 newspaper names
// stacked into one unreadable smear down the axis. A reader could also land
// there by accident: `dataZoom-inside` binds the wheel by default, so scrolling
// the PAGE with the pointer over the panel zoomed the rows instead.
//
// The contract that fixes it is small and entirely invisible in a screenshot,
// which is why it is asserted here rather than left to the next reviewer:
//
//   the zoom SCROLLS the window, it never resizes it past `windowSize`,
//   and it never binds the wheel.
//
// Everything else about the panel can change; if that stops holding, the
// squashed axis comes straight back.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const SOURCES = [
    ['iwac-i18n.js', read('asset', 'js', 'iwac-i18n.js')],
    ['panels.js', read('asset', 'js', 'charts', 'shared', 'panels.js')],
    ['chart-options.js', read('asset', 'js', 'charts', 'shared', 'chart-options.js')],
    ['chart-options-special.js', read('asset', 'js', 'charts', 'shared', 'chart-options-special.js')],
];

function load() {
    const context = {
        console: { warn() {}, error() {} },
        Intl,
        setTimeout,
        clearTimeout,
        document: {
            createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
            documentElement: { getAttribute: () => 'en' },
            body: { appendChild() {}, removeChild() {} },
        },
        echarts: {
            init: () => ({ setOption() {}, dispose() {} }),
            color: {
                parse: () => [0, 0, 0, 1],
                modifyAlpha: (c, a) => `alpha(${c},${a})`,
            },
        },
        window: {
            IWACVis: {
                readColorVar: (name) => name,
                getPalette: () => ['#111111', '#222222', '#333333'],
                getChartTokens: () => ({ border: '#cccccc' }),
                getSeriesColor: () => '#111111',
            },
        },
    };
    context.window.window = context.window;
    context.globalThis = context;
    vm.createContext(context);
    for (const [filename, src] of SOURCES) vm.runInContext(src, context, { filename });
    return context.window.IWACVis.chartOptions;
}

/** `rows` press runs, shaped the way the coverage bundle ships them. */
function coverage(rows) {
    return Array.from({ length: rows }, (unused, i) => ({
        name: 'Paper ' + i,
        country: 'Burkina Faso',
        type: 'article',
        year_min: 1960 + i,
        year_max: 2020,
        total: rows - i,
    }));
}

const WINDOW = 20;
const ROWS = 84;

test('the windowed Gantt caps its zoom at the row count the host was built for', () => {
    const C = load();
    const opt = C.gantt(coverage(ROWS), { windowSize: WINDOW });
    assert.equal(opt.dataZoom.length, 2, 'a windowed Gantt keeps a slider and an inside zoom');
    for (const zoom of opt.dataZoom) {
        assert.equal(zoom.maxValueSpan, WINDOW,
            `${zoom.type} zoom may widen the window to ${zoom.maxValueSpan} rows — the host `
            + `is only ever sized for ${WINDOW}`);
    }
});

test('the windowed Gantt does not bind the wheel', () => {
    const C = load();
    const opt = C.gantt(coverage(ROWS), { windowSize: WINDOW });
    const inside = opt.dataZoom.find((z) => z.type === 'inside');
    // Both default to true in ECharts, and both steal a page scroll that was
    // never aimed at the chart.
    assert.equal(inside.zoomOnMouseWheel, false);
    assert.equal(inside.moveOnMouseWheel, false);
});

test('the expanded Gantt drops the zoom entirely', () => {
    const C = load();
    const opt = C.gantt(coverage(ROWS), { windowSize: WINDOW, expanded: true });
    // Length, not deepEqual: the option is built inside a vm context, so its
    // arrays carry that realm's prototype and a strict deep compare of two
    // empty arrays fails on identity alone.
    assert.equal(opt.dataZoom.length, 0,
        'expanded means every row is drawn — a zoom on top of that can only hide some again');
});

test('a Gantt that fits its window is not zoomed at all', () => {
    const C = load();
    const opt = C.gantt(coverage(WINDOW), { windowSize: WINDOW });
    assert.equal(opt.dataZoom.length, 0);
});

test('every row keeps its label, with a floor under the ones that collide', () => {
    const C = load();
    const label = C.gantt(coverage(ROWS), { windowSize: WINDOW }).yAxis.axisLabel;
    // `interval: 0` is the promise (name every visible row); `hideOverlap` is
    // the floor under it (drop the ones that collide rather than smear them).
    // Neither is safe alone: interval alone gives the smear, hideOverlap alone
    // lets ECharts thin labels it was never asked to thin.
    assert.equal(label.interval, 0);
    assert.equal(label.hideOverlap, true);
});

test('a Gantt row band is tall enough to hold a newspaper title', () => {
    const C = load();
    // Measured as the marginal cost of one more row, so the floor clamp does
    // not enter the arithmetic. (Passing `floor: 0` would not avoid it —
    // `floor || 320` reads 0 as "unset".) Both counts here clear the floor.
    const pitch = (rows) => C.ganttHeight(rows + 1) - C.ganttHeight(rows);
    assert.equal(pitch(WINDOW), pitch(ROWS), 'the pitch must not depend on the row count');
    assert.ok(pitch(ROWS) >= 14,
        `a ${pitch(ROWS)}px row band cannot hold an 11px newspaper title without touching`);
});

// `ganttHeight` was never the broken part — it always returned a uniform
// pitch. What broke was that the collapsed branch did not CALL it: every
// caller wrote `isExpanded() ? C.ganttHeight(n) + 'px' : ''`, handing the
// collapsed view back to the panel's CSS floor. So the panel's 20 rows got
// whatever 320px of min-height left over (~11px each, under an 11px font)
// while the expanded view got the pitch above — the two states silently
// disagreed about how tall a row is.
//
// No unit test of `C.gantt` can see that, because it lives in the callers. So
// this reads them: three panels share the Gantt, and each must size its host
// from the row count in BOTH states.
const GANTT_CALLERS = [
    ['collection-overview/gantt.js', 'asset/js/charts/collection-overview/gantt.js'],
    ['index-overview/activity-gantt.js', 'asset/js/charts/index-overview/activity-gantt.js'],
    ['periodicals-overview.js', 'asset/js/charts/periodicals-overview.js'],
];

for (const [label, path] of GANTT_CALLERS) {
    test(`${label} sizes its Gantt host from the row count in both states`, () => {
        const src = read(...path.split('/'));
        const at = src.indexOf('function applyHeight');
        assert.notEqual(at, -1, `no applyHeight found in ${path} — has it been renamed?`);
        // To the closing brace at the function's own indent. The bodies are
        // short and brace-free apart from the ternary, so this is enough.
        const close = src.indexOf('\n        }', at);
        assert.notEqual(close, -1, `applyHeight in ${path} is not closed at its own indent`);
        const fn = src.slice(at, close);
        assert.ok(/C\.ganttHeight\(/.test(fn),
            `${path} must derive its host height from C.ganttHeight`);
        assert.ok(!/:\s*''/.test(fn),
            `${path} still falls back to the CSS floor when collapsed — that is the `
            + 'decoupling that squashed 84 rows into a box built for 20');
        assert.ok(/Math\.min\(/.test(fn),
            `${path} must clamp the collapsed height to the window size, not the full row count`);
    });
}

test('ganttHeight still clamps to the panel floor for a narrow facet', () => {
    const C = load();
    // A country facet can leave four newspapers. Sizing strictly by row count
    // would hand back a stub shorter than the panel it sits in.
    assert.equal(C.ganttHeight(4), 320);
    assert.ok(C.ganttHeight(ROWS) > 320);
});
