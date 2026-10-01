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
test('deep links isolate instances, accept native anchors and ignore stale IDs', () => {
    const ids = ['intro', 'first'];
    const link = model.fragment('history', 'first', 'block-2');
    assert.equal(model.linkedEvent(link, 'history', 'block-1', ids, true), null);
    assert.equal(model.linkedEvent(link, 'history', 'block-2', ids, false), 'first');
    assert.equal(model.linkedEvent('#timeline=history&slide=first', 'history', 'block-2', ids, false), null);
    assert.equal(model.linkedEvent('#block-2-first', 'history', 'block-2', ids, false), 'first');
    assert.equal(model.linkedEvent('#timeline=history&slide=missing', 'history', 'block-1', ids, true), null);
});
