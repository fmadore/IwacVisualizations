'use strict';

// C.landscape — the UMAP scatter option three views share
// (asset/js/charts/shared/chart-options-special.js).
//
// The option's invariants are what a reader relies on and what the three
// callers used to get by copying: hidden value axes (UMAP coordinates are
// not a measure), pan/zoom on both axes that never filters points away,
// one series per bucket in the caller's order with `[x, y, i]` data so a
// tooltip and a click both resolve through the index, a legend of the
// buckets only, and per-caller knobs (point size, opacity, progressive
// rendering, a colour per bucket, an overlay) that do not leak into each
// other.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, 'asset', 'js', ...parts), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));

function load() {
    const context = {
        console,
        document: { createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { add() {} }, style: {} }) },
        window: { IWACVis: { t: (k) => k, formatNumber: String, locale: 'en' } },
    };
    vm.createContext(context);
    vm.runInContext(read('charts', 'shared', 'panels.js'), context, { filename: 'panels.js' });
    vm.runInContext(read('charts', 'shared', 'chart-options.js'), context, { filename: 'chart-options.js' });
    vm.runInContext(read('charts', 'shared', 'chart-options-special.js'), context, { filename: 'chart-options-special.js' });
    return context.window.IWACVis.chartOptions;
}

const PTS = { x: [0.1, 0.2, 0.3, 0.4], y: [1, 2, 3, 4], title: ['A', 'B <b>', 'C', 'D'] };
const GROUPED = { groups: { Togo: [0, 2], Benin: [1], Other: [3] }, order: ['Benin', 'Togo', 'Other'] };

test('one scatter series per bucket, in order, carrying [x, y, index] data', () => {
    const C = load();
    const opt = C.landscape(PTS, GROUPED);
    assert.deepEqual(opt.series.map((s) => s.name), ['Benin', 'Togo', 'Other']);
    assert.deepEqual(plain(opt.series[1].data), [[0.1, 1, 0], [0.3, 3, 2]]);
    assert.ok(opt.series.every((s) => s.type === 'scatter' && s.symbolSize === 4 && s.itemStyle.opacity === 0.6));
    assert.ok(opt.series.every((s) => s.emphasis.itemStyle.opacity === 1));
    assert.ok(opt.series.every((s) => !('progressive' in s)), 'progressive rendering is opt-in');
    assert.deepEqual(plain(opt.legend.data), ['Benin', 'Togo', 'Other']);
    assert.equal(opt.animation, false);
});

test('the axes are hidden value axes and the inside zoom never filters points', () => {
    const C = load();
    const opt = C.landscape(PTS, GROUPED);
    for (const axis of [opt.xAxis, opt.yAxis]) {
        assert.equal(axis.type, 'value');
        assert.equal(axis.show, false);
        assert.equal(axis.scale, true);
    }
    assert.deepEqual(plain(opt.dataZoom), [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
    ]);
});

test('the tooltip is the point title, escaped, plus the caller\'s bits', () => {
    const C = load();
    const opt = C.landscape(PTS, GROUPED, { tooltipBits: (i) => (i === 1 ? ['Bénin', '1975'] : []) });
    assert.equal(opt.tooltip.trigger, 'item');
    assert.equal(opt.tooltip.confine, true);
    assert.equal(opt.tooltip.formatter({ data: [0.2, 2, 1] }), '<strong>B &lt;b&gt;</strong><br>Bénin · 1975');
    assert.equal(opt.tooltip.formatter({ data: [0.1, 1, 0] }), '<strong>A</strong>');
    const bare = C.landscape(PTS, GROUPED);
    assert.equal(bare.tooltip.formatter({ data: [0.3, 3, 2] }), '<strong>C</strong>');
});

test('per-caller knobs: size, opacity, progressive rendering, a colour per bucket, an overlay', () => {
    const C = load();
    const overlay = { name: '__labels__', type: 'scatter', silent: true, data: [] };
    const opt = C.landscape(PTS, GROUPED, {
        symbolSize: 7,
        opacity: 0.75,
        progressive: 2500,
        progressiveThreshold: 3000,
        seriesColor: (name) => (name === 'Togo' ? '#0a0' : null),
        extraSeries: [overlay, null],
    });
    assert.ok(opt.series.slice(0, 3).every((s) => s.symbolSize === 7 && s.itemStyle.opacity === 0.75));
    assert.ok(opt.series.slice(0, 3).every((s) => s.progressive === 2500 && s.progressiveThreshold === 3000));
    assert.equal(opt.series[1].itemStyle.color, '#0a0');
    assert.equal('color' in opt.series[0].itemStyle, false, 'buckets without a colour take the palette');
    assert.equal(opt.series.length, 4);
    assert.equal(opt.series[3], overlay);
    assert.deepEqual(plain(opt.legend.data), ['Benin', 'Togo', 'Other'], 'the overlay never grows a legend entry');

    const one = C.landscape(PTS, GROUPED, { progressive: 2000 });
    assert.equal(one.series[0].progressiveThreshold, 2000, 'a threshold defaults to the progressive count');
});
