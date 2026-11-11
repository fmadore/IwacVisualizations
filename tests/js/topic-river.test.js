'use strict';

// The "topics over time" river is drawn by two blocks — the Topic Explorer
// and the Periodicals Overview — through C.topicRiver, with the long tail
// folded by C.foldTopicTail. Both used to carry their own copy of each.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

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
        window: { IWACVis: { readColorVar: (name) => name, getChartTokens: () => ({}) } },
    };
    context.window.window = context.window;
    context.globalThis = context;
    vm.createContext(context);
    for (const parts of [['iwac-i18n.js'], ['charts', 'shared', 'panels.js'], ['charts', 'shared', 'chart-options.js']]) {
        vm.runInContext(read('asset', 'js', ...parts), context, { filename: parts.join('/') });
    }
    return context.window.IWACVis.chartOptions;
}

const defs = (n, years) => Array.from({ length: n }, (unused, i) => ({
    topicId: i, name: 'T' + i, values: Array.from({ length: years }, (u, y) => i + y),
}));

test('a river that fits keeps every band, untouched', () => {
    const C = load();
    const list = defs(C.RIVER_TOP, 3);
    assert.equal(C.foldTopicTail(list, 3), list);
});

test('the tail past RIVER_TOP folds into one summed "Other topics" band', () => {
    const C = load();
    const list = defs(C.RIVER_TOP + 3, 2);
    const folded = C.foldTopicTail(list, 2);
    assert.equal(folded.length, C.RIVER_TOP + 1);
    const other = folded[folded.length - 1];
    assert.equal(other.topicId, null, 'the folded band opens no topic');
    // Bands 12, 13, 14: values i + y.
    assert.deepEqual(Array.from(other.values), [12 + 13 + 14, 13 + 14 + 15]);
    assert.equal(list.length, C.RIVER_TOP + 3, 'the input list is not mutated');
});

test('the river plots through the caller and keeps the axis at 100', () => {
    const C = load();
    const opt = C.topicRiver({
        years: ['2000', '2001'],
        defs: defs(2, 2),
        plot: (d, i) => d.values[i] * 10,
        legend: { top: 0 },
    });
    assert.equal(opt.yAxis.max, 100);
    assert.equal(opt.series.length, 2);
    assert.deepEqual(Array.from(opt.series[1].data), [10, 20]);
    assert.ok(opt.series.every((s) => s.stack === opt.series[0].stack), 'one stack');
    assert.deepEqual(Array.from(opt.xAxis.data), ['2000', '2001']);
});
