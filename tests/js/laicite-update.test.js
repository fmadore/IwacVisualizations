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
    'asset/js/charts/shared/concordance.js',
    'asset/js/charts/laicite/helpers.js',
    'asset/js/charts/laicite/actors.js',
    'asset/js/charts/laicite/references.js',
    'asset/js/charts/laicite/concordance.js',
    'asset/js/charts/laicite/research.js',
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
        buildPagination() {
            return { root: P.el('div', 'iwac-vis-pagination'), update() {} };
        },
        buildLoadingState(key) { return P.el('div', 'iwac-vis-loading', key); },
        // The real fold strips diacritics and lowercases; the concordance
        // free-text filter is the only caller reached from here.
        foldAccents(str) {
            return String(str).normalize('NFD')
                .replace(/[̀-ͯ]/g, '').toLowerCase();
        },
        fetchJSON() { return Promise.resolve(null); },
        formatDate(value) { return String(value); },
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
    // helpers.js supplies `L.chip`, `L.SUBSETS`, `L.routeChip` and the
    // route vocabulary. It used to be stubbed here; the stub went stale
    // the moment helpers grew a function the views call, so the real
    // file is loaded instead — it defines functions and touches nothing.

    return { ns, P, L: ns.laicite, registrations, charts };
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

/* ------------------------------------------------------------------ */
/*  Concordance: membership strength                                   */
/* ------------------------------------------------------------------ */

// The September 2026 screen found that a record admitted on ONE core
// match is read as substantively about laïcité about three times in four,
// and that a scholarly record whose only matches sit in a bibliography is
// usually matching another work's title. Neither fact changes membership —
// the dossier stays as wide as the methodology says it is — so both are
// surfaced instead: a badge on the line, and an opt-in strict filter.
//
// Three things are worth asserting and easy to get wrong:
//   * the strict filter must count what IT removed, not what the frame,
//     country and text facets had already removed;
//   * it must count RECORDS, not rows, because the summary says records;
//   * data generated before the route fields existed must be untouched —
//     an item with no `s` is not a weak item, it is an unmeasured one.

/** A per-corpus concordance bundle: two rows per item, one item per route. */
const KWIC_PAYLOAD = {
    items: [
        { o: '1', t: 'Tag and text', c: ['Togo'], y: 2001, s: 'tag+text', g: 1 },
        { o: '2', t: 'One mention', c: ['Togo'], y: 2002, s: 'text=1' },
        { o: '3', t: 'Two mentions', c: ['Bénin'], y: 2003, s: 'text>=2' },
        { o: '4', t: 'In a bibliography', c: ['Bénin'], y: 2004, s: 'text>=2', b: 1 },
    ],
    rows: [
        { i: 0, f: 'laicite', d: 'title', l: 'un état ', m: 'laïc', r: ' et républicain' },
        { i: 0, f: 'ecole', d: 'OCR', l: 'une ', m: 'école', r: ' publique' },
        { i: 1, f: 'laicite', d: 'OCR', l: 'pays ', m: 'laïc', r: ' — bonne fête' },
        { i: 2, f: 'laicite', d: 'OCR', l: 'la ', m: 'laïcité', r: ' à l’école' },
        { i: 2, f: 'laicite', d: 'title', l: '', m: 'laïcité', r: ' en débat' },
        { i: 3, f: 'laicite', d: 'OCR', l: 'cf. ', m: 'laïcité', r: ', Paris, 1998' },
    ],
};

/** The same bundle as a deploy whose data predates the route fields. */
const LEGACY_PAYLOAD = {
    items: KWIC_PAYLOAD.items.map(({ s, b, ...rest }) => rest),
    rows: KWIC_PAYLOAD.rows,
};

test('the strict filter hides single-mention and bibliography-only records', () => {
    const { L } = loadLaicite();

    const open = L.filterConcordanceRows(KWIC_PAYLOAD, { kwicStrict: false });
    assert.equal(open.rows.length, 6, 'the filter is off; nothing may be hidden');
    assert.equal(open.hiddenRecords, 0);

    const strict = L.filterConcordanceRows(KWIC_PAYLOAD, { kwicStrict: true });
    assert.deepEqual(Array.from(strict.rows, (r) => r.i), [0, 0, 2, 2],
        'a text=1 row or a bibliography-only row survived the strict filter');
    // Two RECORDS (items 1 and 3), not the three rows they contribute.
    assert.equal(strict.hiddenRecords, 2,
        'the summary counts records, so rows-per-item must not inflate it');
});

test('the hidden count reports only what STRICT removed, after the other facets', () => {
    const { L } = loadLaicite();

    // The frame facet already removes the `ecole` row; the country facet
    // already removes both Bénin items, the bibliography-only one included.
    // Only the single-mention Togo record is left for strict to hide.
    const scoped = L.filterConcordanceRows(KWIC_PAYLOAD, {
        kwicStrict: true, kwicFrame: 'laicite', kwicCountry: 'Togo',
    });
    assert.deepEqual(Array.from(scoped.rows, (r) => r.i), [0]);
    assert.equal(scoped.hiddenRecords, 1,
        'records the reader had already filtered out were counted as hidden');
});

test('the free-text filter still folds accents, and composes with strict', () => {
    const { L } = loadLaicite();
    const hits = L.filterConcordanceRows(KWIC_PAYLOAD,
        { kwicStrict: true, kwicQuery: 'laicite' });
    assert.deepEqual(Array.from(hits.rows, (r) => r.i), [2, 2]);
    assert.equal(hits.hiddenRecords, 1, 'the bibliography row matches "laicite" too');
});

test('data generated before the routes existed is unaffected by the strict filter', () => {
    const { L } = loadLaicite();
    const strict = L.filterConcordanceRows(LEGACY_PAYLOAD, { kwicStrict: true });
    assert.equal(strict.rows.length, 6,
        'an item with no route is unmeasured, not weak — nothing may be hidden');
    assert.equal(strict.hiddenRecords, 0,
        'a "records hidden" line over an unchanged list is a lie about the data');
});

test('badges mark the weak routes only, and name themselves through i18n', () => {
    const { L } = loadLaicite();
    const badges = (item) => Array.from(L.concordanceItemBadges(item), (b) => b.label);

    assert.deepEqual(badges({ s: 'tag+text' }), [],
        'a tag+text item is the unremarkable case and must carry no badge');
    assert.deepEqual(badges({ s: 'text>=2' }), []);
    assert.deepEqual(badges({ s: 'text=1' }), ['laicite.badge_single_mention']);
    assert.deepEqual(badges({ s: 'text>=2', b: 1 }), ['laicite.badge_bibliography']);
    assert.deepEqual(badges({ s: 'text=1', b: 1 }),
        ['laicite.badge_single_mention', 'laicite.badge_bibliography']);
    assert.deepEqual(badges(undefined), [], 'a missing item must not throw');

    const [single] = L.concordanceItemBadges({ s: 'text=1' });
    assert.equal(single.className, 'is-single');
    assert.equal(single.title, 'laicite.badge_single_mention_hint',
        'the badge needs a hint: two words cannot explain a membership route');
});

test('the shared renderer paints caller-supplied badges, and none without the hook', () => {
    const { P, L } = loadLaicite();
    const classesIn = (root) => walk(root)
        .map((n) => n.className)
        .filter((c) => c && c.includes('iwac-vis-kwic-badge'));

    const bare = P.buildConcordance({
        rows: KWIC_PAYLOAD.rows, items: KWIC_PAYLOAD.items,
    });
    assert.equal(classesIn(bare.root).length, 0,
        'the shared renderer must know nothing about membership on its own');

    const badged = P.buildConcordance({
        rows: KWIC_PAYLOAD.rows, items: KWIC_PAYLOAD.items,
        itemBadges: L.concordanceItemBadges,
    });
    // One row from item 1 (single mention) and one from item 3 (bibliography).
    assert.deepEqual(classesIn(badged.root),
        ['iwac-vis-kwic-badge is-single', 'iwac-vis-kwic-badge is-bibliography']);
    assert.ok(textOf(badged.root).includes('laicite.badge_single_mention'));
});

test('a badge without a label is dropped rather than rendered empty', () => {
    const { P } = loadLaicite();
    const built = P.buildConcordance({
        rows: [KWIC_PAYLOAD.rows[2]], items: KWIC_PAYLOAD.items,
        itemBadges: () => [null, { label: '' }, { label: 'ok', className: 'is-x' }],
    });
    const badges = walk(built.root)
        .filter((n) => (n.className || '').includes('iwac-vis-kwic-badge'));
    assert.equal(badges.length, 1);
    assert.equal(badges[0].textContent, 'ok');
});

test('the concordance summary states how many records the strict filter hid', async () => {
    const { P, L } = loadLaicite();
    P.fetchJSON = () => Promise.resolve(KWIC_PAYLOAD);

    const state = { kwicSubset: 'articles', kwicStrict: false };
    const view = L.createConcordance({
        index: { by_subset: { articles: { file: 'kwic.json', emitted: 6 } } },
        metadata: { frames: {} }, state, dataBase: '/', siteBase: '/s/test',
    });
    view.render();
    await new Promise((resolve) => setImmediate(resolve));

    const open = textOf(view.host);
    assert.ok(open.includes('laicite.concordance_count:{"count":"6"}'));
    assert.ok(!open.includes('laicite.concordance_strict_hidden'),
        'the hidden line showed while the strict filter was off');

    state.kwicStrict = true;
    view.render();
    const strict = textOf(view.host);
    assert.ok(strict.includes('laicite.concordance_count:{"count":"4"}'));
    assert.ok(strict.includes('laicite.concordance_strict_hidden:{"count":"2"}'),
        'the summary must say what the strict filter is costing');
});


/* ------------------------------------------------------------------ */
/*  Membership routes on the cards, and the model-assisted screen      */
/* ------------------------------------------------------------------ */

test('a work shows its route, its title hit and its bibliography badge', () => {
    const { L } = loadLaicite();
    const built = L.buildReferences({
        bundle: {
            ...REFERENCES_BUNDLE,
            items: [{
                title: 'One', type: 'Article', o_id: 11, year: 1990,
                membership_route: 'text=1', title_hit: 1, bib_only: 1,
            }],
        },
        state: { refType: '' }, siteBase: '/s/test',
    });
    const text = textOf(built.root);
    assert.ok(text.includes('laicite.route_text_single'), 'the route chip is missing');
    assert.ok(text.includes('laicite.route_title_hit'));
    assert.ok(text.includes('laicite.badge_bibliography'));
});

test('a work from older data shows no route chip rather than an empty one', () => {
    const { L } = loadLaicite();
    const built = L.buildReferences({
        bundle: REFERENCES_BUNDLE, state: { refType: '' }, siteBase: '/s/test',
    });
    const text = textOf(built.root);
    assert.ok(!text.includes('laicite.route_'),
        'a bundle with no membership_route rendered a route chip anyway');
    assert.equal(L.routeChip('something else'), null,
        'an unknown route must render nothing, not an "unknown" chip');
});

// The screen's numbers live in the data, not in the dictionary: a later
// audit of newly ingested records has to be able to update this panel by
// republishing `laicite-metadata.json`. Which also means the panel has to
// disappear cleanly when the field is not there at all.
const AUDIT_SCREEN = {
    judged_at: '2026-09-14', model: 'claude-sonnet-5', rule_version: 'a1b2c3d',
    members_total: 1244, members_judged: 1200, relevant: 1044,
    by_route: {
        'tag+text': { judged: 686, relevant: 669 },
        'text>=2': { judged: 200, relevant: 186 },
        'text=1': { judged: 281, relevant: 216 },
        'tag-only': { judged: 33, relevant: 11 },
    },
    by_subset: { articles: { judged: 645, relevant: 561 } },
};

test('the model-assisted screen renders from the data, with its own coverage', () => {
    const { L } = loadLaicite();
    const panel = L.buildAuditScreen({ audit_screen: AUDIT_SCREEN });
    const text = textOf(panel);

    assert.ok(text.includes('"model":"claude-sonnet-5"'), 'the rater is not named');
    assert.ok(text.includes('"judged":"1200"') && text.includes('"total":"1244"'));
    assert.ok(text.includes('"percent":87'),
        'the headline share must be computed, never carried in the copy');
    // 1244 - 1200: records the screen has not reached yet.
    assert.ok(text.includes('laicite.research_screen_pending:{"count":"44"}'),
        'unscreened records were silently folded into the screened total');
    assert.ok(text.includes('"rule":"a1b2c3d"'), 'the rule version is not stated');
    assert.ok(text.includes('laicite.route_tag_only'), 'the route breakdown is missing');
    assert.ok(text.includes('34.9%') || text.includes('33.3%'),
        'the per-route share is not rendered');
});

test('the screen disappears on older data instead of reporting zeros', () => {
    const { L } = loadLaicite();
    assert.equal(L.buildAuditScreen({}), null,
        'a bundle predating the screen must render no panel');
    assert.equal(L.buildAuditScreen(undefined), null);
    assert.equal(L.buildAuditScreen({ audit_screen: { members_judged: 0 } }), null,
        '"0 of 0 judged relevant" would read as a finding');
});

test('a fully screened dossier says nothing about unscreened records', () => {
    const { L } = loadLaicite();
    const full = { ...AUDIT_SCREEN, members_judged: 1244, members_total: 1244 };
    const text = textOf(L.buildAuditScreen({ audit_screen: full }));
    assert.ok(!text.includes('laicite.research_screen_pending'));
});
