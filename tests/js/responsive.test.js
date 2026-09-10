'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function responsive() {
    const context = { window: { IWACVis: { panels: {} } } };
    vm.runInNewContext(readFileSync(join(__dirname, '../../asset/js/charts/shared/responsive.js'), 'utf8'), context);
    return context.window.IWACVis.responsive;
}

test('media fallback restores only overridden layout properties without copying data or selection', () => {
    const R = responsive();
    const base = { grid: { left: 64, top: 48 },
        yAxis: [{ nameGap: 50 }, { nameGap: 60 }],
        dataZoom: [{ bottom: 8, height: 18, start: 20, end: 70 }],
        legend: { selected: { Togo: false } }, series: [{ data: [1, 2] }] };
    const rules = [{ query: { maxWidth: 640 }, option: {
        grid: { left: 42 }, yAxis: [{ nameGap: 28, axisLabel: { fontSize: 9 } }, { nameGap: 28 }],
        dataZoom: [{ bottom: 4, height: 14 }]
    } }];
    const before = JSON.stringify({ base, rules });
    const result = R.withMedia(base, rules);
    assert.deepEqual(JSON.parse(JSON.stringify(result.media[1])), { option: {
        grid: { left: 64 }, yAxis: [{ nameGap: 50, axisLabel: { fontSize: null } }, { nameGap: 60 }],
        dataZoom: [{ bottom: 8, height: 18 }]
    } });
    assert.equal(JSON.stringify({ base, rules }), before, 'caller-owned options stay unchanged');
});

test('media fallbacks combine presets and respect an explicit caller fallback', () => {
    const R = responsive();
    const base = { grid: { left: 60 }, yAxis: { axisLabel: { width: 180 } } };
    const result = R.withMedia(base, R.gridMedia, R.labelMedia());
    assert.equal(result.media.length, 3);
    assert.equal(result.media[2].option.grid.left, 60);
    assert.equal(result.media[2].option.yAxis.axisLabel.width, 180);
    const fallback = { option: { grid: { left: 80 } } };
    const explicit = R.withMedia(base, R.gridMedia, [fallback]);
    assert.equal(explicit.media.length, 2);
    assert.equal(explicit.media[1], fallback);
    assert.equal(R.withMedia(base, {}), base);
});
