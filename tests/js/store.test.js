'use strict';

// The block state store and its URL binding (asset/js/charts/shared/store.js).
//
// What these lock in is the contract the controls rows are built on:
//
//   * the object handed to createStore IS the state — the blocks keep their
//     `state.view` references, so a store that copied would silently split
//     the block from its controls;
//   * a keyed subscription wakes only for its keys, and a burst of patches
//     in one tick notifies once — that is what lets "a change of view
//     remounts, anything else syncs" be expressed as two subscriptions;
//   * the reducer's cross-field rules apply once and never re-enter;
//   * the URL binding writes block-prefixed params, omits defaults, rejects
//     values the block does not offer, and never throws when history is
//     unavailable (a sandboxed embed frame).

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const STORE = readFileSync(join(ROOT, 'asset', 'js', 'charts', 'shared', 'store.js'), 'utf8');

/** A window with a real URL and a history that records what was written. */
function fakeWindow(href) {
    const win = {
        location: { href: href || 'https://islam.zmo.de/s/westafrica/page/laicite' },
        history: {
            state: null,
            writes: [],
            replaceState(state, title, url) { this.writes.push(['replace', url]); win.location.href = url; },
            pushState(state, title, url) { this.writes.push(['push', url]); win.location.href = url; },
        },
        listeners: {},
        addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
        removeEventListener() {},
    };
    return win;
}

function load(options = {}) {
    const warnings = [];
    const context = {
        console: { warn: (...a) => warnings.push(a), error: (...a) => warnings.push(a) },
        setTimeout,
        clearTimeout,
        Promise,
        URL,
        URLSearchParams,
        navigator: {},
        window: options.window || fakeWindow(),
    };
    context.window.IWACVis = {
        panels: {
            t: (k) => k,
            el(tag, cls, text) {
                const attrs = {};
                return {
                    tag, className: cls || '', textContent: text || '', attrs,
                    classList: { add() {}, remove() {}, toggle() {} },
                    setAttribute(n, v) { attrs[n] = v; },
                    addEventListener(name, fn) { this['on' + name] = fn; },
                };
            },
        },
    };
    vm.createContext(context);
    vm.runInContext(STORE, context, { filename: 'store.js' });
    return { P: context.window.IWACVis.panels, win: context.window, warnings };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// Values built inside the vm realm carry that realm's prototypes, which
// strict deep equality rejects; a JSON round-trip compares structure only.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('the state object handed in is the store state, mutated in place', async () => {
    const { P } = load();
    const state = { view: 'overview', country: null };
    const store = P.createStore(state);
    store.patch({ view: 'trends' });
    assert.equal(store.state, state);
    assert.equal(state.view, 'trends', 'a block reading its own state object sees the patch');
});

test('keyed subscriptions wake only for their keys; a burst notifies once', async () => {
    const { P } = load();
    const store = P.createStore({ view: 'a', country: null, year: 0 });
    const calls = { view: [], any: [] };
    store.subscribe((keys) => calls.view.push(keys), { keys: ['view'] });
    store.subscribe((keys) => calls.any.push(keys));

    store.patch({ country: 'Togo' });
    store.patch({ year: 3 });
    store.patch({ country: 'Togo' });   // no change: must not count
    assert.equal(calls.any.length, 0, 'nothing is delivered synchronously');
    await tick();
    assert.equal(calls.view.length, 0, 'the view subscriber never woke');
    assert.deepEqual(plain(calls.any), [['country', 'year']], 'one notification for the whole tick');

    store.patch({ view: 'b' });
    await tick();
    assert.deepEqual(plain(calls.view), [['view']]);
    assert.equal(calls.any.length, 2);
});

test('a patch that changes nothing returns no keys and schedules nothing', async () => {
    const { P } = load();
    const store = P.createStore({ view: 'a' });
    let woke = 0;
    store.subscribe(() => { woke++; });
    assert.deepEqual(plain(store.patch({ view: 'a' })), []);
    assert.deepEqual(plain(store.patch({ other: undefined })), [], 'undefined is "no value", never a write');
    await tick();
    assert.equal(woke, 0);
});

test('the reducer applies cross-field rules once, in the same notification', async () => {
    const { P } = load();
    let reduced = 0;
    const store = P.createStore({ country: null, subset: 'articles' }, {
        reduce(state, changed) {
            reduced++;
            if (changed.includes('country') && state.country) return { subset: null };
            if (changed.includes('subset') && state.subset) return { country: null };
            return null;
        },
    });
    const seen = [];
    store.subscribe((keys) => seen.push(keys));
    const touched = store.patch({ country: 'Togo' });
    assert.deepEqual(plain(touched), ['country', 'subset']);
    assert.equal(store.state.subset, null);
    assert.equal(reduced, 1, 'the reducer must not run again on its own output');
    await tick();
    assert.deepEqual(plain(seen), [['country', 'subset']]);
});

test('a silent patch applies without waking anyone', async () => {
    const { P } = load();
    const store = P.createStore({ view: 'a' });
    let woke = 0;
    store.subscribe(() => { woke++; });
    store.patch({ view: 'b' }, { silent: true });
    await tick();
    assert.equal(store.state.view, 'b');
    assert.equal(woke, 0);
});

test('a subscriber that patches is delivered in the same flush, and cannot spin forever', async () => {
    const { P, warnings } = load();
    const store = P.createStore({ n: 0, corrected: false });
    const order = [];
    store.subscribe((keys) => {
        order.push(keys);
        if (keys.includes('n') && !store.state.corrected) store.patch({ corrected: true });
    });
    store.patch({ n: 1 });
    await tick();
    assert.deepEqual(plain(order), [['n'], ['corrected']]);

    // Two subscribers correcting each other: bounded, not hung.
    const ping = P.createStore({ a: 0 });
    ping.subscribe(() => { ping.patch({ a: ping.state.a + 1 }); });
    ping.patch({ a: 1 });
    await tick();
    assert.ok(warnings.length > 0, 'the runaway is reported');
    assert.ok(ping.state.a < 20, 'and stopped');
});

test('unsubscribe stops delivery', async () => {
    const { P } = load();
    const store = P.createStore({ v: 0 });
    let woke = 0;
    const off = store.subscribe(() => { woke++; });
    store.patch({ v: 1 });
    await tick();
    off();
    store.patch({ v: 2 });
    await tick();
    assert.equal(woke, 1);
});

/* ------------------------------------------------------------------ */
/*  URL binding                                                        */
/* ------------------------------------------------------------------ */

test('hydrates block-prefixed params, typed by the current value, and only offered values', () => {
    const win = fakeWindow('https://x.test/p?foo=1&laicite.view=trends&laicite.country=Togo'
        + '&laicite.axis=bogus&laicite.year=1973&laicite.terms=a,b&laicite.flag=1');
    const { P } = load({ window: win });
    const store = P.createStore({
        view: 'overview', country: null, axis: 'years', year: 0, terms: [], flag: false,
    });
    P.bindUrlState(store, {
        prefix: 'laicite',
        keys: [
            { key: 'view', values: ['overview', 'trends'] },
            'country',
            { key: 'axis', values: ['years', 'seasons'] },
            'year', 'terms', 'flag',
        ],
    });
    assert.equal(store.state.view, 'trends');
    assert.equal(store.state.country, 'Togo');
    assert.equal(store.state.axis, 'years', 'a value the block does not offer is ignored');
    assert.equal(store.state.year, 1973, 'numbers stay numbers');
    assert.deepEqual(plain(store.state.terms), ['a', 'b'], 'arrays split on commas');
    assert.equal(store.state.flag, true);
    assert.equal(win.history.writes.length, 0, 'hydration never writes the address');
});

test('writes the address on change, omits defaults, keeps foreign params, replaces by default', async () => {
    const win = fakeWindow('https://x.test/p?foo=1&bar=2');
    const { P } = load({ window: win });
    const store = P.createStore({ view: 'overview', country: null, terms: [] });
    const url = P.bindUrlState(store, { prefix: 'laicite', keys: ['view', 'country', 'terms'] });

    store.patch({ view: 'trends', country: 'Togo', terms: ['islam', 'laïcité'] });
    await tick();
    assert.equal(win.history.writes.length, 1);
    assert.equal(win.history.writes[0][0], 'replace');
    assert.equal(win.location.href,
        'https://x.test/p?foo=1&bar=2&laicite.view=trends&laicite.country=Togo&laicite.terms=islam,la%C3%AFcit%C3%A9');
    assert.equal(url.href(), win.location.href);

    // Back to the defaults: the params go away again.
    store.patch({ view: 'overview', country: null, terms: [] });
    await tick();
    assert.equal(win.location.href, 'https://x.test/p?foo=1&bar=2');
});

test('the written address parses back to the same state', async () => {
    const win = fakeWindow('https://x.test/p');
    const { P } = load({ window: win });
    const store = P.createStore({ view: 'a', q: '' });
    P.bindUrlState(store, { prefix: 'b', keys: ['view', 'q'] });
    store.patch({ view: 'c', q: 'école & mosquée, 1973' });
    await tick();

    const again = P.createStore({ view: 'a', q: '' });
    P.bindUrlState(again, { prefix: 'b', keys: ['view', 'q'] });
    assert.deepEqual(plain(again.state), { view: 'c', q: 'école & mosquée, 1973' });
});

test('custom serialize / parse / validate, and a default that is not the initial value', async () => {
    const years = [1960, 1961, 1962];
    const win = fakeWindow('https://x.test/p?scary.year=1962&scary.pick=zz');
    const { P } = load({ window: win });
    const store = P.createStore({ yearIdx: 0, pick: 'a' });
    P.bindUrlState(store, {
        prefix: 'scary',
        keys: [
            { key: 'yearIdx', param: 'year',
              serialize: (idx) => years[idx],
              parse: (raw) => { const i = years.indexOf(Number(raw)); return i === -1 ? undefined : i; } },
            { key: 'pick', validate: (v) => v.length === 1 },
        ],
    });
    assert.equal(store.state.yearIdx, 2, 'parsed through the custom parser');
    assert.equal(store.state.pick, 'a', 'rejected by validate');

    store.patch({ yearIdx: 1 });
    await tick();
    assert.equal(win.location.href, 'https://x.test/p?scary.year=1961');
});

test('push mode creates history entries and follows popstate', async () => {
    const win = fakeWindow('https://x.test/p');
    const { P } = load({ window: win });
    const store = P.createStore({ topic: null });
    P.bindUrlState(store, {
        prefix: 'topics', keys: ['topic'],
        push: (keys) => keys.includes('topic'),
    });
    store.patch({ topic: 7 });
    await tick();
    assert.deepEqual(win.history.writes, [['push', 'https://x.test/p?topics.topic=7']]);

    // The reader presses Back: the address changes underneath the block.
    win.location.href = 'https://x.test/p';
    win.listeners.popstate.forEach((fn) => fn());
    await tick();
    assert.equal(store.state.topic, null, 'hydrated back from the address');
});

test('a frame that cannot write its address degrades silently', async () => {
    const win = fakeWindow('https://x.test/p');
    win.history.replaceState = () => { throw new Error('SecurityError'); };
    const { P, warnings } = load({ window: win });
    const store = P.createStore({ view: 'a' });
    const url = P.bindUrlState(store, { prefix: 'b', keys: ['view'] });
    store.patch({ view: 'c' });
    await tick();
    assert.equal(win.location.href, 'https://x.test/p');
    assert.equal(url.href(), 'https://x.test/p?b.view=c', 'the link is still computable');
    assert.equal(warnings.length, 0);

    // No history object at all.
    const bare = fakeWindow('https://x.test/p');
    bare.history = undefined;
    const bareLoad = load({ window: bare });
    const s2 = bareLoad.P.createStore({ view: 'a' });
    bareLoad.P.bindUrlState(s2, { prefix: 'b', keys: ['view'] });
    s2.patch({ view: 'c' });
    await tick();
    assert.equal(bare.location.href, 'https://x.test/p');
});

test('the copy-link button copies the current href and reports it', async () => {
    const { P, win } = load();
    let copied = null;
    win.IWACVis.embed = { copyToClipboard: (text) => { copied = text; return Promise.resolve(); } };
    let n = 0;
    const btn = P.buildCopyLinkButton({ href: () => 'https://x.test/p?v=' + (++n) });
    assert.equal(btn.textContent, 'Copy link to this view');
    assert.equal(btn.attrs['data-iwac-control'], 'copy-link');
    btn.onclick();
    await tick();
    assert.equal(copied, 'https://x.test/p?v=1', 'href is read at click time');
    assert.equal(btn.textContent, 'Link copied');
});
