'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({ window: { IWACVis: {} }, URLSearchParams });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../asset/js/charts/timeline/model.js'), 'utf8'), context);
const model = context.window.IWACVis.timelineModel;

test('timeline calendar bounds retain partial precision and years below 100', () => {
    assert.equal(new Date(model.bound('0099', false)).toISOString(), '0099-01-01T00:00:00.000Z');
    assert.equal(new Date(model.bound('2000-02', true)).toISOString(), '2000-02-29T00:00:00.000Z');
    assert.equal(new Date(model.bound('1970', true)).toISOString(), '1970-12-31T00:00:00.000Z');
});
test('timeline overlapping ranges and duplicate dates get separate lanes', () => {
    const result = model.layout([
        { id: 'range', start: '1970', end: '1980', order: 0 },
        { id: 'one', start: '1975', order: 1 },
        { id: 'two', start: '1975', order: 2 }
    ], 800, 88);
    assert.equal(result.lanes, 3);
    assert.ok(result.positions[0].endX > result.positions[0].x);
    assert.equal(result.positions[1].x, result.positions[2].x);
});
test('timeline scale gives a crowded span room and keeps dates in order', () => {
    // Ten events in two years, then two lone ones decades apart: the shape of
    // the intégrisme exhibit, which stacked ten lanes deep on a linear scale.
    const crowded = ['1994-01', '1994-02', '1994-03', '1994-05', '1994-07', '1994-09', '1994-11', '1995-01', '1995-02', '1995-03']
        .map((start, order) => ({ id: 'e' + order, start, order }));
    const events = [{ id: 'early', start: '1960-01-01', order: 10 }, ...crowded, { id: 'late', start: '2016-03-13', order: 11 }];
    const result = model.layout(events, 1700, 176);
    assert.ok(result.lanes <= 2, `${result.lanes} lanes`);
    const xs = result.positions.map((p) => p.x);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
    assert.equal(xs[0], 0);
    assert.ok(xs.at(-1) <= 1700 - 176 + 0.001);
    // The empty 1960s–1990s keep more room than one month of the cluster.
    assert.ok(xs[1] - xs[0] > xs[2] - xs[1]);
});
test('timeline scale shrinks its fixed shares on a narrow track', () => {
    const events = Array.from({ length: 12 }, (_, i) => ({ id: 'e' + i, start: `2000-0${(i % 9) + 1}`, order: i }));
    const result = model.layout(events, 600, 176);
    assert.ok(result.positions.every((p) => p.x >= 0 && p.x <= 600 - 176 + 0.001));
});
test('timeline year labels never collide and prefer round years', () => {
    const events = [{ id: 'a', start: '1985', end: '1991', order: 0 }, { id: 'b', start: '1994-06', order: 1 }, { id: 'c', start: '2016', order: 2 }];
    const layout = model.layout(events, 1200, 176);
    const ticks = model.ticks(layout, 64);
    assert.ok(ticks.some((t) => t.year === 1990) && ticks.some((t) => t.year === 2000));
    ticks.forEach((t, i) => { if (i) assert.ok(t.x - ticks[i - 1].x >= 64, `${ticks[i - 1].year}→${t.year}`); });
});
test('deep links isolate instances, accept native anchors and ignore stale IDs', () => {
    const ids = ['intro', 'first'];
    const link = model.fragment('history', 'first', 'block-2');
    assert.equal(model.linkedEvent(link, 'history', 'block-1', ids, true), null);
    assert.equal(model.linkedEvent(link, 'history', 'block-2', ids, false), 'first');
    assert.equal(model.linkedEvent('#timeline=history&slide=first', 'history', 'block-2', ids, false), null);
    assert.equal(model.linkedEvent('#block-2-first', 'history', 'block-2', ids, false), 'first');
    assert.equal(model.linkedEvent('#timeline=history&slide=missing', 'history', 'block-1', ids, true), null);
});
