'use strict';

// C.scaryTerms race mode — the bar chart race that did not race
// (asset/js/charts/shared/chart-options-hbar.js, Tier 8 / E2).
//
// A bar race is ECharts' `realtimeSort`: EVERY term against a FIXED
// category axis, ECharts doing the ranking, each bar animating to its new
// row. Slicing the top ten per frame and re-supplying the axis — what this
// used to do — animates bar lengths in fixed slots while the labels swap
// instantly, which is a bar chart that changes.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, 'asset', 'js', ...parts), 'utf8');

function load() {
    const context = {
        console,
        document: { createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { add() {} }, style: {} }) },
        window: { IWACVis: { t: (k) => k, formatNumber: String, locale: 'en' } },
    };
    vm.createContext(context);
    for (const f of ['panels.js', 'responsive.js', 'chart-options.js', 'chart-options-bar.js', 'chart-options-hbar.js']) {
        vm.runInContext(read('charts', 'shared', f), context, { filename: f });
    }
    return context.window.IWACVis;
}

// `C.scaryTerms` wraps its option in responsive media rules, so the option
// proper is `baseOption` whenever any rule applies.
const base = (opt) => opt.baseOption || opt;

const ENTRIES = [['djihadiste', 40], ['salafiste', 30], ['radical', 20], ['intégriste', 10]];
const COLORS = { djihadiste: '#a', salafiste: '#b', radical: '#c', 'intégriste': '#d' };

test('race mode turns on realtimeSort and bounds the visible rows', () => {
    const C = load().chartOptions;
    const opt = base(C.scaryTerms({ entries: ENTRIES, termColors: COLORS, race: true, visibleBars: 3, tickMs: 1000 }));
    assert.equal(opt.series[0].realtimeSort, true);
    assert.equal(opt.yAxis.max, 2, 'n - 1, or every term draws and there is no podium');
    assert.equal(opt.yAxis.inverse, true, 'the longest bar belongs at the top');
    assert.equal(opt.series[0].label.valueAnimation, true);
    assert.equal(opt.xAxis.max, 'dataMax', 'adaptive per frame — a pinned max made early years slivers');
});

test('the animation timings are the frame interval, and linear', () => {
    const C = load().chartOptions;
    const opt = base(C.scaryTerms({ entries: ENTRIES, race: true, visibleBars: 3, tickMs: 1000 }));
    // One frame finishes just before the next arrives.
    assert.equal(opt.animationDurationUpdate, 900);
    assert.equal(opt.series[0].animationDurationUpdate, 900);
    assert.equal(opt.animationEasingUpdate, 'linear');
    assert.equal(opt.series[0].animationEasingUpdate, 'linear');
    assert.equal(opt.animationDuration, 0, 'the first frame must not grow from nothing');
    // The axis reorder is its own, shorter animation.
    assert.equal(opt.yAxis.animationDurationUpdate, 300);
});

test('a non-race chart keeps the plain sorted-bar behaviour', () => {
    const C = load().chartOptions;
    const opt = base(C.scaryTerms({ entries: ENTRIES, termColors: COLORS }));
    assert.equal(opt.series[0].realtimeSort, undefined);
    assert.equal(opt.yAxis.max, undefined, 'every bar shows when there is no race');
    assert.equal(opt.series[0].label.valueAnimation, undefined);
    assert.equal(opt.series[0].animationEasingUpdate, 'cubicOut');
    assert.equal(opt.xAxis.max, undefined);
});

test('items carry a name and a colour, so a merged frame keeps both', () => {
    const C = load().chartOptions;
    const items = C.scaryTermItems(ENTRIES, COLORS);
    assert.deepEqual(items.map((d) => d.name), ENTRIES.map((e) => e[0]));
    assert.deepEqual(items.map((d) => d.value), [40, 30, 20, 10]);
    assert.deepEqual(items.map((d) => d.itemStyle.color), ['#a', '#b', '#c', '#d']);
    // The option builder uses the same items, so a merge cannot diverge.
    const opt = base(C.scaryTerms({ entries: ENTRIES, termColors: COLORS, race: true, visibleBars: 3 }));
    assert.deepEqual(
        opt.series[0].data.map((d) => [d.name, d.value, d.itemStyle.color]),
        items.map((d) => [d.name, d.value, d.itemStyle.color])
    );
});

test('race frames share one term order, so the axis can stay fixed', () => {
    const context = {
        console,
        document: { createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { add() {} }, style: {} }) },
        window: { IWACVis: { t: (k) => k, formatNumber: String, locale: 'en' } },
    };
    vm.createContext(context);
    vm.runInContext(read('charts', 'shared', 'panels.js'), context, { filename: 'panels.js' });
    vm.runInContext(read('charts', 'scary-terms', 'helpers.js'), context, { filename: 'helpers.js' });
    const S = context.window.IWACVis.scaryTerms;

    // Snapshots are sorted by value, and the ranking changes between them.
    const snapshots = [
        [['a', 5], ['b', 3]],
        [['b', 9], ['a', 6]],
    ];
    const { terms, frames } = S.buildRaceFrames(snapshots);
    // Ordered by FINAL total, so the axis reads sensibly before frame one.
    assert.deepEqual(terms, ['b', 'a']);
    // Every frame is in that same order — the ranking is ECharts' job now.
    assert.deepEqual(frames, [[3, 5], [9, 6]]);
});

test('a term absent from an early frame counts zero, not undefined', () => {
    const context = {
        console,
        document: { createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { add() {} }, style: {} }) },
        window: { IWACVis: { t: (k) => k, formatNumber: String, locale: 'en' } },
    };
    vm.createContext(context);
    vm.runInContext(read('charts', 'shared', 'panels.js'), context, { filename: 'panels.js' });
    vm.runInContext(read('charts', 'scary-terms', 'helpers.js'), context, { filename: 'helpers.js' });
    const S = context.window.IWACVis.scaryTerms;
    const { terms, frames } = S.buildRaceFrames([[['a', 2]], [['a', 4], ['b', 1]]]);
    assert.deepEqual(terms, ['a', 'b']);
    assert.deepEqual(frames, [[2, 0], [4, 1]]);
});
