'use strict';

// The laïcité block repaints a view instead of rebuilding it (Tier 8 / S17).
//
// The bug was cheap to describe and expensive to see: `draw()` cleared
// `viewHost` on EVERY state change, so choosing a different actor type or a
// different sentiment model tore down a view whose chrome had not changed.
// Four things followed — the chart transition was lost (a disposed instance
// cannot animate into its replacement), `registerChart` re-registered new
// hosts on every keystroke, the host collapsed to zero height between the
// clear and the append so the page jumped, and the `role=status` region was
// re-announced in full.
//
// None of that is visible in a screenshot, and all of it is visible here:
// a repaint keeps the SAME nodes and calls `setOption` on the SAME live
// instance, while a rebuild replaces both. So these tests assert on node
// identity and on which chart instance received the option — the two things
// that separate the fixed behaviour from the old one.
//
// The DOM here is a stub, not jsdom: these builders use `P.el`,
// `appendChild`, `replaceChild`, `innerHTML = ''` and `hidden`, and a stub
// that answers exactly those is both enough and readable.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');

const SOURCES = [
    'asset/js/charts/laicite/actors.js',
    'asset/js/charts/laicite/references.js',
];

/* ------------------------------------------------------------------ */
/*  A DOM small enough to read                                         */
/* ------------------------------------------------------------------ */

function makeElement(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        className: '',
        children: [],
        style: {},
        hidden: false,
        textContent: '',
        parentNode: null,
        attrs: {},
        appendChild(child) {
            child.parentNode = el;
            el.children.push(child);
            return child;
        },
        replaceChild(next, prev) {
            const i = el.children.indexOf(prev);
            if (i === -1) throw new Error('replaceChild: node is not a child');
            el.children[i] = next;
            next.parentNode = el;
            prev.parentNode = null;
            return prev;
        },
        setAttribute(name, value) { el.attrs[name] = String(value); },
        getAttribute(name) { return el.attrs[name] ?? null; },
        addEventListener() {},
        removeEventListener() {},
        getBoundingClientRect() { return { width: 800, height: 400 }; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        contains() { return false; },
    };
    Object.defineProperty(el, 'innerHTML', {
        get() { return ''; },
        set(value) { if (value === '') el.children.length = 0; },
    });
    Object.defineProperty(el, 'childNodes', { get() { return el.children; } });
    Object.defineProperty(el, 'clientWidth', { get() { return 800; } });
    return el;
}

/** Every element in a subtree, in document order. */
function walk(el, out = []) {
    out.push(el);
    for (const child of el.children) walk(child, out);
    return out;
}

function textOf(el) {
    return walk(el).map((n) => n.textContent || '').join(' ').trim();
}

/**
 * Load the laïcité builders against a stub IWACVis.
 *
 * `registerChart` records (host, callback) and hands back a fake instance,
 * so a test can see which host was registered, how many times, and every
 * `setOption` that reached it.
 */
function loadLaicite() {
    const registrations = [];
    const charts = new Map();          // host -> fake instance

    function fakeInstance(host) {
        const options = [];
        return {
            host,
            options,
            disposed: false,
            setOption(option, opts) { options.push({ option, opts }); },
            isDisposed() { return this.disposed; },
            resize() {},
            showLoading() {},
            hideLoading() {},
        };
    }

    const P = {
        el(tag, className, text) {
            const node = makeElement(tag || 'div');
            if (className) node.className = className;
            if (text != null) node.textContent = String(text);
            return node;
        },
        t(key, vars) {
            return vars ? key + ':' + JSON.stringify(vars) : key;
        },
        formatNumber(n) { return String(n); },
        escapeHtml(s) { return String(s); },
        emptyChartOption() { return { __empty: true }; },
        buildNoDataState() { return P.el('div', 'iwac-vis-empty', 'no data'); },
        buildEmptyState(key) { return P.el('div', 'iwac-vis-empty', key); },
        buildPanel(className, title, desc) {
            const panel = P.el('div', className);
            if (title) panel.appendChild(P.el('h4', null, title));
            if (desc) panel.appendChild(P.el('p', 'iwac-vis-panel-desc', desc));
            const chart = P.el('div', 'iwac-vis-chart');
            panel.appendChild(chart);
            return { panel, chart };
        },
        buildPagination() { return P.el('div', 'iwac-vis-pagination'); },
    };

    const ns = {
        panels: P,
        chartOptions: {
            heatmapMatrix(data, opts) { return { __heatmap: data, opts }; },
            _grid(o) { return o; },
            _valueAxisName(name) { return { name }; },
            _dataZoom() { return []; },
        },
        getPalette() { return ['#111', '#222', '#333']; },
        registerChart(host, cb) {
            registrations.push(host);
            const instance = fakeInstance(host);
            charts.set(host, instance);
            cb(host, instance);
        },
        getLiveChart(host) {
            const c = charts.get(host);
            return c && !c.disposed ? c : null;
        },
    };

    const context = {
        console: { warn() {}, error() {} },
        window: { IWACVis: ns, innerWidth: 1280, setTimeout() {} },
        setTimeout(fn) { return fn ? 0 : 0; },
    };
    context.window.window = context.window;
    vm.createContext(context);
    for (const rel of SOURCES) {
        vm.runInContext(readFileSync(join(ROOT, rel), 'utf8'), context, { filename: rel });
    }
    // `L.chip` and `L.SUBSETS` live in helpers.js, which pulls in more than
    // this test needs; the two shapes they produce are trivial.
    ns.laicite.chip = (label, cls) => P.el('span', 'iwac-vis-chip ' + (cls || ''), label);
    ns.laicite.SUBSETS = ['articles', 'publications'];
    ns.laicite.subsetLabel = (s) => s;

    return { ns, L: ns.laicite, registrations, charts };
}

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const ACTORS_BUNDLE = {
    min_items: 3,
    index_records: 4700,
    unresolved_total: 120,
    decades: ['1960s', '1970s', '1980s', '1990s'],
    actors: [
        { name: 'A person', type: 'Personnes', o_id: 1, items: 40, tagged: 10, first_year: 1961, last_year: 2001, by_decade: [4, 8, 20, 8], by_subset: { articles: 40 } },
        { name: 'B person', type: 'Personnes', o_id: 2, items: 30, tagged: 6, first_year: 1970, last_year: 1999, by_decade: [0, 10, 12, 8], by_subset: { articles: 30 } },
        { name: 'C org', type: 'Organisations', o_id: 3, items: 25, tagged: 5, first_year: 1980, last_year: 2005, by_decade: [0, 0, 15, 10], by_subset: { publications: 25 } },
        { name: 'D org', type: 'Organisations', o_id: 4, items: 15, tagged: 2, first_year: 1985, last_year: 2010, by_decade: [0, 0, 7, 8], by_subset: { articles: 15 } },
    ],
};

const REFERENCES_BUNDLE = {
    years: [1990, 1995, 2000],
    by_year: [2, 5, 9],
    by_type: { Article: 6, Book: 10 },
    items: [
        { title: 'One', type: 'Article', o_id: 11, year: 1990 },
        { title: 'Two', type: 'Book', o_id: 12, year: 1995 },
        { title: 'Three', type: 'Book', o_id: 13, year: 2000 },
    ],
};

/* ------------------------------------------------------------------ */
/*  Actors                                                             */
/* ------------------------------------------------------------------ */

test('the actors view exposes update(), which is what lets draw() skip the rebuild', () => {
    const { L } = loadLaicite();
    const built = L.buildActors({
        bundle: ACTORS_BUNDLE, state: { actorType: '' }, siteBase: '/s/test',
    });
    assert.equal(typeof built.update, 'function',
        'without update() the orchestrator falls back to clearing viewHost');
});

test('changing the actor type keeps the same chart host and the same instance', () => {
    const { L, registrations, charts } = loadLaicite();
    const built = L.buildActors({
        bundle: ACTORS_BUNDLE, state: { actorType: '' }, siteBase: '/s/test',
    });
    built.mount();

    assert.equal(registrations.length, 1, 'mount should register exactly one chart');
    const host = registrations[0];
    const instance = charts.get(host);
    assert.equal(instance.options.length, 1);

    built.update({ actorType: 'Personnes' });

    assert.equal(registrations.length, 1,
        'a filter change re-registered a chart — the host was rebuilt');
    assert.equal(charts.get(host), instance,
        'the live instance was replaced rather than updated');
    assert.equal(instance.options.length, 2,
        'the new option never reached the live instance');
    assert.equal(instance.options[1].opts.notMerge, false,
        'notMerge: true would snap the heatmap instead of animating it');
});

test('the repainted list holds only the selected type, and the root node is the same', () => {
    const { L } = loadLaicite();
    const built = L.buildActors({
        bundle: ACTORS_BUNDLE, state: { actorType: '' }, siteBase: '/s/test',
    });
    built.mount();
    const rootBefore = built.root;

    const all = textOf(built.root);
    assert.ok(all.includes('A person') && all.includes('C org'));

    built.update({ actorType: 'Organisations' });

    assert.equal(built.root, rootBefore, 'update() replaced the root node');
    const orgs = textOf(built.root);
    assert.ok(orgs.includes('C org'), 'the selected type is missing after update');
    assert.ok(!orgs.includes('A person'),
        'a filtered-out actor survived the repaint — the list was not rebuilt');
});

test('a filter that matches nothing hides the chart rather than destroying it', () => {
    const { L, registrations, charts } = loadLaicite();
    const built = L.buildActors({
        bundle: ACTORS_BUNDLE, state: { actorType: '' }, siteBase: '/s/test',
    });
    built.mount();
    const host = registrations[0];

    built.update({ actorType: 'Événements' });     // no actors of this type

    assert.equal(host.hidden, true, 'the empty state left the chart host visible');
    assert.equal(registrations.length, 1, 'the host was rebuilt for an empty filter');
    assert.ok(charts.get(host), 'the instance was disposed for an empty filter');
    assert.ok(textOf(built.root).includes('laicite.actors_empty'));

    built.update({ actorType: 'Personnes' });      // and back
    assert.equal(host.hidden, false, 'the chart host stayed hidden after refilling');
    assert.equal(registrations.length, 1,
        'coming back from an empty filter registered a second chart');
});

/* ------------------------------------------------------------------ */
/*  References                                                         */
/* ------------------------------------------------------------------ */

test('the references type filter leaves the year chart untouched', () => {
    const { L, registrations, charts } = loadLaicite();
    const built = L.buildReferences({
        bundle: REFERENCES_BUNDLE, state: { refType: '' }, siteBase: '/s/test',
    });
    built.mount();

    assert.equal(registrations.length, 1);
    const instance = charts.get(registrations[0]);
    const optionsBefore = instance.options.length;

    built.update({ refType: 'Book' });

    // This chart is the whole literature's growth curve; the type filter
    // does not touch it. The old rebuild disposed and rebuilt it anyway.
    assert.equal(registrations.length, 1,
        'the unfiltered year chart was rebuilt for a filter it does not read');
    assert.equal(instance.options.length, optionsBefore,
        'the year chart was re-drawn for a change it does not depend on');
});
