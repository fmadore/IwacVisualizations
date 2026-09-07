'use strict';

// P.linkFacet — one country across a block (Tier 8 / S4).
//
// Five collection-overview panels each built their own Country facet, so
// picking Bénin on the timeline left the Gantt, the languages bar and the
// word cloud on "all countries": the same choice made five times, and any
// two panels free to disagree about what they were showing.
//
// The subtle part is the loop guard. A facet bar's `setActive` fires its own
// `onChange`, so a panel applying a value that came FROM the store would
// publish it straight back — and with two linked panels that is a ping-pong.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...p) => readFileSync(join(ROOT, 'asset', 'js', ...p), 'utf8');

function load() {
    const context = {
        console,
        setTimeout,
        Promise,
        clearTimeout,
        document: {
            createElement: () => ({
                setAttribute() {}, appendChild() {}, addEventListener() {},
                classList: { add() {} }, style: {}, dataset: {},
            }),
        },
        window: { IWACVis: { t: (k, p) => (p && p.value ? k + ':' + p.value : k), locale: 'en' } },
    };
    vm.createContext(context);
    for (const f of ['panels.js', 'store.js', 'panels-controls.js']) {
        vm.runInContext(read('charts', 'shared', f), context, { filename: f });
    }
    return context.window.IWACVis.panels;
}

/** A panel that holds one country and records what it was told to show. */
function fakePanel(P, store, log, name) {
    let current = null;
    const link = P.linkFacet({
        store,
        read: () => current,
        apply: (country) => {
            current = country;
            log.push(`${name} shows ${country || 'all'}`);
            // A real facet bar fires onChange from setActive; this is the
            // ping-pong the guard exists to stop.
            link.publish(current);
        },
    });
    return {
        pick(country) { current = country; link.publish(country); },
        get current() { return current; },
    };
}

test('a pick in one panel reaches the others, once', () => {
    const P = load();
    const store = P.createStore({ country: null });
    const log = [];
    const timeline = fakePanel(P, store, log, 'timeline');
    const gantt = fakePanel(P, store, log, 'gantt');
    const cloud = fakePanel(P, store, log, 'cloud');

    timeline.pick('Bénin');
    store.flush();

    assert.equal(gantt.current, 'Bénin');
    assert.equal(cloud.current, 'Bénin');
    assert.equal(timeline.current, 'Bénin');
    // Each of the two listeners moved exactly once — no ping-pong.
    assert.deepEqual(log, ['gantt shows Bénin', 'cloud shows Bénin']);
});

test('clearing propagates the same way', () => {
    const P = load();
    const store = P.createStore({ country: null });
    const log = [];
    const a = fakePanel(P, store, log, 'a');
    const b = fakePanel(P, store, log, 'b');
    a.pick('Togo');
    store.flush();
    log.length = 0;

    store.patch({ country: null });
    store.flush();
    assert.equal(a.current, null);
    assert.equal(b.current, null);
});

test('a panel joining late adopts what the block already holds', async () => {
    const P = load();
    const store = P.createStore({ country: 'Niger' });
    const log = [];
    // A lazily-rendered panel — the map, the word cloud — is built after the
    // reader has already picked. It must open on the selection, not on "all".
    const late = fakePanel(P, store, log, 'late');
    // The adopt is a microtask: `apply` typically reaches for the object
    // linkFacet is still returning, so it cannot run synchronously.
    assert.equal(late.current, null, 'not before the caller has its handle');
    await Promise.resolve();
    assert.equal(late.current, 'Niger');
});

test('no store means no linking, and no crash', () => {
    const P = load();
    const link = P.linkFacet({ read: () => null, apply: () => {} });
    link.publish('Togo');   // must not throw
    assert.equal(typeof link.publish, 'function');
});

test('a panel that supplies no read/apply is inert', () => {
    const P = load();
    const store = P.createStore({ country: null });
    const link = P.linkFacet({ store });
    link.publish('Togo');
    store.flush();
    assert.equal(store.state.country, null, 'an inert link must not write to the block');
});
