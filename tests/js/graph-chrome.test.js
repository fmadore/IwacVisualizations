'use strict';

// The chrome around the graphs, against a small DOM stand-in:
//
//   * a theme swap reaches EVERY listener a force graph has, and reaches
//     them before the canvas repaints — the legend's listener used to be
//     silently replaced by the entity layer's, and the paint ran first;
//   * nothing keeps a copy of the palette: the colours a graph paints and
//     the type colours every block shares are read at call time;
//   * `P.bindFullscreen` is one binding with a fallback for a browser that
//     has no element fullscreen (an iPhone), and its listener cleans up;
//   * a segmented group's arrow keys skip a disabled button;
//   * the search dropdown wears the shared classes, and an open list eats
//     the Escape that would otherwise also leave a fullscreen overlay.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, 'asset', 'js', ...parts), 'utf8');

/* ------------------------------------------------------------------ */
/*  A DOM small enough to read                                         */
/* ------------------------------------------------------------------ */

class ClassList {
    constructor(el) { this.el = el; }
    get set() { return new Set((this.el.className || '').split(/\s+/).filter(Boolean)); }
    write(set) { this.el.className = [...set].join(' '); }
    add(...cs) { const s = this.set; cs.forEach((c) => s.add(c)); this.write(s); }
    remove(c) { const s = this.set; s.delete(c); this.write(s); }
    contains(c) { return this.set.has(c); }
    toggle(c, force) {
        const s = this.set;
        const on = force === undefined ? !s.has(c) : !!force;
        if (on) s.add(c); else s.delete(c);
        this.write(s);
        return on;
    }
}

class Element {
    constructor(tag, doc) {
        this.tagName = String(tag).toUpperCase();
        this.ownerDocument = doc;
        this.attrs = {};
        this.children = [];
        this.parentNode = null;
        this.className = '';
        this.textContent = '';
        this.dataset = {};
        this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
        this.listeners = {};
        this.classList = new ClassList(this);
        this.hidden = false;
        this.disabled = false;
    }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); c.parentNode = null; return c; }
    get firstChild() { return this.children[0] || null; }
    set innerHTML(v) { if (v === '') { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; } }
    contains(el) { for (let n = el; n; n = n.parentNode) if (n === this) return true; return false; }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter((f) => f !== fn); }
    dispatch(name, event = {}) {
        event.target = event.target || this;
        event.preventDefault = event.preventDefault || (() => { event.defaultPrevented = true; });
        event.stopPropagation = event.stopPropagation || (() => { event.stopped = true; });
        (this.listeners[name] || []).forEach((fn) => fn(event));
        if (event.stopped) return event;
        if (this.parentNode && this.parentNode.dispatch) return this.parentNode.dispatch(name, event);
        // Off the top of the tree: the document's own listeners.
        const doc = this.ownerDocument;
        if (doc && this === doc.body) (doc.listeners[name] || []).forEach((fn) => fn(event));
        return event;
    }
    focus() { this.ownerDocument.activeElement = this; }
    click() { this.dispatch('click'); }
    *walk() { yield this; for (const c of this.children) yield* c.walk(); }
    querySelector(sel) {
        const cls = /^\.([\w-]+)$/.exec(sel);
        if (cls) { for (const el of this.walk()) if (el !== this && el.classList.contains(cls[1])) return el; return null; }
        if (sel === 'button') { for (const el of this.walk()) if (el !== this && el.tagName === 'BUTTON') return el; return null; }
        throw new Error('unsupported selector ' + sel);
    }
}

function makeDocument() {
    const doc = {
        activeElement: null,
        listeners: {},
        fullscreenElement: null,
        fullscreenEnabled: false,
        createElement(tag) { return new Element(tag, doc); },
        addEventListener(name, fn) { (doc.listeners[name] = doc.listeners[name] || []).push(fn); },
        removeEventListener(name, fn) { doc.listeners[name] = (doc.listeners[name] || []).filter((f) => f !== fn); },
        fire(name, event = {}) { (doc.listeners[name] || []).slice().forEach((fn) => fn(event)); },
    };
    doc.body = doc.createElement('body');
    return doc;
}

/** A context with panels.js + the files under test, MapLibre and ECharts absent. */
function load(files, extra = {}) {
    const document = makeDocument();
    const context = Object.assign({
        console,
        document,
        setTimeout: (fn) => { fn(); return 0; },
        clearTimeout() {},
        requestAnimationFrame: (fn) => { fn(); return 0; },
        Promise,
        window: { IWACVis: { t: (k) => k, locale: 'en', formatNumber: String }, addEventListener() {} },
    }, extra);
    context.window.document = document;
    vm.createContext(context);
    vm.runInContext(read('charts', 'shared', 'panels.js'), context, { filename: 'panels.js' });
    for (const f of files) vm.runInContext(read(...f.split('/')), context, { filename: f });
    return { ns: context.window.IWACVis, P: context.window.IWACVis.panels, document, context };
}

/* ------------------------------------------------------------------ */
/*  Theme: additive listeners, run before the paint                    */
/* ------------------------------------------------------------------ */

function loadForceGraph() {
    const env = load([], { d3: { forceSimulation() {} } });
    const { ns, context } = env;
    const log = [];
    let repaint = null;
    ns.getSeriesColor = (i) => ns._palette[i % ns._palette.length];
    ns._palette = ['#light0', '#light1'];
    ns.registerRenderer = (_el, fn) => { repaint = fn; return { remove() {} }; };
    ns.GraphCanvas = {
        create: () => ({
            paint: (scene) => log.push(['paint', scene.colorOf(0)]),
            resize: () => false,
            width: () => 0,
            height: () => 0,
        }),
    };
    vm.runInContext(read('charts', 'shared', 'graph-force.js'), context, { filename: 'graph-force.js' });
    const container = env.document.createElement('div');
    const graph = ns.ForceGraph.create(container, { nodes: [{ id: 'a', name: 'A' }] });
    return { env, graph, log, theme: () => repaint() };
}

test('a theme swap runs every listener, in order, and only then repaints', () => {
    const { graph, log, theme, env } = loadForceGraph();
    graph.onTheme(() => log.push(['legend']));
    graph.onTheme(() => log.push(['entity layer']));

    env.ns._palette = ['#dark0', '#dark1'];
    theme();
    assert.deepEqual(log, [['legend'], ['entity layer'], ['paint', '#dark0']],
        'the second listener must not replace the first, and the paint comes last');
});

test('a force graph keeps no palette copy: the default colour is read at paint time', () => {
    const { log, theme, env } = loadForceGraph();
    theme();
    env.ns._palette = ['#dark0'];
    theme();
    assert.deepEqual(log.map((e) => e[1]), ['#light0', '#dark0']);
});

test('the force graph no longer exports what nothing outside it used', () => {
    const { graph, env } = loadForceGraph();
    assert.deepEqual(Object.keys(env.ns.ForceGraph), ['create']);
    for (const gone of ['toggleHalos', 'pinnedCount', 'visibleNodes', 'adjacency', 'dispose']) {
        assert.equal(graph[gone], undefined, gone);
    }
});

/* ------------------------------------------------------------------ */
/*  One type → colour table, read live                                 */
/* ------------------------------------------------------------------ */

const TOKENS = JSON.parse(readFileSync(join(ROOT, 'tokens.json'), 'utf8'));
const TYPE_TOKENS = {
    Personnes: '--type-entity-personnes',
    Lieux: '--type-entity-lieux',
    Organisations: '--type-entity-organisations',
    Sujets: '--type-entity-sujets',
    'Événements': '--type-entity-evenements',
    article: '--type-article',
};

/**
 * iwac-theme.js in a bare context. With `vars`, the body's computed style
 * answers those custom properties (mutable: assign the dark map to toggle);
 * without, there is no body and no token resolves.
 */
function loadTheme(vars = null) {
    const body = vars ? { getAttribute: () => null } : null;
    const document = { body, addEventListener() {}, readyState: 'complete' };
    const context = {
        console: { warn() {}, error() {} },
        document,
        window: { IWACVis: {}, addEventListener() {}, matchMedia: () => ({ matches: false }) },
        setTimeout,
    };
    if (vars) {
        context.getComputedStyle = () => ({ getPropertyValue: (n) => vars[n] || '', fontFamily: '' });
    }
    context.window.document = document;
    vm.createContext(context);
    vm.runInContext(read('iwac-theme.js'), context, { filename: 'iwac-theme.js' });
    return context;
}

test('entity types take the theme\'s --type-entity-* colours, the ones IwacSearch\'s chips use', () => {
    const vars = { ...TOKENS.light };
    const ns = loadTheme(vars).window.IWACVis;
    for (const [type, token] of Object.entries(TYPE_TOKENS)) {
        assert.equal(ns.getEntityTypeColor(type), TOKENS.light[token], type);
    }
    // The article-context legend set these two in one slate.
    assert.notEqual(ns.getEntityTypeColor('Personnes'), ns.getEntityTypeColor('article'));

    // Cached for the per-frame painter; the refresh a toggle runs drops it.
    Object.assign(vars, TOKENS.dark);
    assert.equal(ns.getEntityTypeColor('Lieux'), TOKENS.light['--type-entity-lieux']);
    ns.refreshThemes();
    for (const [type, token] of Object.entries(TYPE_TOKENS)) {
        assert.equal(ns.getEntityTypeColor(type), TOKENS.dark[token], type + ' (dark)');
    }
});

test('without the tokens, entity types degrade to fixed palette slots', () => {
    const ns = loadTheme().window.IWACVis;
    const palette = ns.getPalette();
    const order = Array.from(ns.ENTITY_TYPE_ORDER);
    order.forEach((type, i) => assert.equal(ns.getEntityTypeColor(type), palette[i], type));
    assert.equal(ns.getEntityTypeColor('Unheard of'), palette[order.length]);
    assert.equal(ns.getEntityTypeColor('Unheard of', 1), palette[order.length + 1]);

    // A theme swap replaces the cached palette; the lookup follows it.
    ns._currentPalette = palette.map((_c, i) => '#swapped' + i);
    assert.equal(ns.getEntityTypeColor('Lieux'), '#swapped' + order.indexOf('Lieux'));
});

test('an entity graph colours its categories from the live theme, not a mount-time copy', () => {
    const vars = { ...TOKENS.light };
    const context = loadTheme(vars);
    const ns = context.window.IWACVis;
    const document = makeDocument();
    context.document = document;
    context.window.document = document;
    Object.assign(ns, { t: (k) => k, locale: 'en', formatNumber: String });
    vm.runInContext(read('charts', 'shared', 'panels.js'), context, { filename: 'panels.js' });
    let spec = null;
    ns.panels.mountForceGraph = (_panelEl, s) => {
        spec = s;
        return { graph: { onTheme() { throw new Error('nothing to refresh: no copy is kept'); } }, setGraph() {} };
    };
    vm.runInContext(read('charts', 'shared', 'entity-graph.js'), context, { filename: 'entity-graph.js' });
    ns.panels.mountEntityGraph({ panel: null, chart: null }, {}, {
        variants: { all: { nodes: [
            { o_id: 1, title: 'Centre', type: 'center' },
            { o_id: 2, title: 'A place', type: 'Lieux' },
            { o_id: 3, title: 'A person', type: 'Personnes' },
            { o_id: 4, title: 'A related article', type: 'article' },
            { o_id: 5, title: 'Odd one', type: 'Mystère' },
            { o_id: 6, title: 'Odder one', type: 'Autre' },
        ], edges: [] } },
    });
    const colorOf = (type) => spec.colorOf(spec.categories.findIndex((c) => c.type === type));
    assert.equal(colorOf('Lieux'), TOKENS.light['--type-entity-lieux']);
    assert.equal(colorOf('article'), TOKENS.light['--type-article']);
    assert.notEqual(colorOf('Personnes'), colorOf('article'));
    assert.equal(colorOf('center'), ns.getSeriesColor(0), 'the centre keeps the lead slot');
    assert.notEqual(colorOf('Mystère'), colorOf('Autre'), 'unknown types stay apart');

    Object.assign(vars, TOKENS.dark);
    ns.refreshThemes();
    assert.equal(colorOf('Lieux'), TOKENS.dark['--type-entity-lieux']);
    assert.equal(colorOf('article'), TOKENS.dark['--type-article']);
    assert.equal(ns.entityGraph, undefined, 'the type table lives in iwac-theme.js now');
});

/* ------------------------------------------------------------------ */
/*  Fullscreen                                                         */
/* ------------------------------------------------------------------ */

function loadToolbar() {
    const env = load([], {});
    vm.runInContext(read('charts', 'shared', 'panel-toolbar.js'), env.context, { filename: 'panel-toolbar.js' });
    const target = env.document.createElement('section');
    env.document.body.appendChild(target);
    const button = env.P.iconButton('F', 'Toggle fullscreen');
    target.appendChild(button);
    return Object.assign(env, { target, button });
}

test('without element fullscreen, the state class alone is the overlay and Escape leaves it', () => {
    const { P, document, target, button } = loadToolbar();
    const changes = [];
    P.bindFullscreen(button, target, { onChange: (full) => changes.push(full) });
    assert.equal(button.getAttribute('aria-pressed'), 'false');

    button.click();
    assert.ok(target.classList.contains('iwac-vis-panel--fullscreen'));
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(changes, [true]);

    // Escape from inside the overlay: out, and focus back on the toggle.
    document.activeElement = null;
    target.dispatch('keydown', { key: 'Escape' });
    assert.ok(!target.classList.contains('iwac-vis-panel--fullscreen'));
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(document.activeElement, button);
    assert.deepEqual(changes, [true, false]);
    assert.equal((document.listeners.keydown || []).length, 0, 'the Escape listener goes with the overlay');
});

test('with element fullscreen, the API is used and fullscreenchange drives the state', () => {
    const { P, document, target, button } = loadToolbar();
    document.fullscreenEnabled = true;
    let requested = 0;
    target.requestFullscreen = () => { requested++; document.fullscreenElement = target; return Promise.resolve(); };
    document.exitFullscreen = () => { document.fullscreenElement = null; };
    P.bindFullscreen(button, target, { stateClass: 'layout--fullscreen' });

    button.click();
    assert.equal(requested, 1);
    document.fire('fullscreenchange');
    assert.ok(target.classList.contains('layout--fullscreen'));
    assert.equal(button.getAttribute('aria-pressed'), 'true');

    button.click();
    document.fire('fullscreenchange');
    assert.ok(!target.classList.contains('layout--fullscreen'));
    assert.equal(button.getAttribute('aria-pressed'), 'false');

    // A target that has left the document takes its listener with it.
    document.body.removeChild(target);
    document.fire('fullscreenchange');
    assert.equal((document.listeners.fullscreenchange || []).length, 0);
});

test('a panel toolbar fullscreen button is the same binding, aimed where the caller says', () => {
    const { P, document } = loadToolbar();
    const panel = document.createElement('article');
    const layout = document.createElement('div');
    layout.appendChild(panel);
    document.body.appendChild(layout);
    panel.querySelector = (sel) => (sel.startsWith(':scope') ? panel.children.find((c) => c.classList.contains('iwac-vis-panel-toolbar')) || null : Element.prototype.querySelector.call(panel, sel));
    P.addFullscreenButton(panel, { target: layout, stateClass: 'networks--fullscreen' });
    const btn = panel.children[0].children[0];
    assert.ok(btn.classList.contains('iwac-vis-panel-toolbar__btn--fullscreen'));
    btn.click();
    assert.ok(layout.classList.contains('networks--fullscreen'));
    assert.ok(!panel.classList.contains('iwac-vis-panel--fullscreen'));
});

/* ------------------------------------------------------------------ */
/*  Controls                                                           */
/* ------------------------------------------------------------------ */

test('arrow keys, Home and End skip a disabled button in a segmented group', () => {
    const { P, document } = load(['charts/shared/panels-controls.js']);
    const seg = P.buildSegmented({
        options: ['a', 'b', 'c', 'd'].map((k) => ({ key: k, label: k.toUpperCase() })),
        active: 'a',
        onChange() {},
    });
    seg.buttons.b.disabled = true;
    seg.buttons.d.disabled = true;
    seg.buttons.a.focus();
    seg.buttons.a.dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(document.activeElement, seg.buttons.c, 'b is skipped');
    seg.buttons.c.dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(document.activeElement, seg.buttons.a, 'd is skipped and the walk wraps');
    seg.buttons.a.dispatch('keydown', { key: 'End' });
    assert.equal(document.activeElement, seg.buttons.c, 'End lands on the last ENABLED button');
});

test('the search dropdown wears the shared classes, and an open list keeps its Escape', () => {
    const { P, document } = load(['charts/shared/panels-controls.js']);
    const search = P.buildSearchDropdown({
        placeholder: 'Find',
        classes: { root: 'iwac-vis-search block-hook' },
        getMatches: () => [{ label: 'Abidjan', detail: '12' }],
        onPick() {},
    });
    document.body.appendChild(search.root);
    assert.equal(search.root.className, 'iwac-vis-search block-hook');
    assert.ok(search.input.classList.contains('iwac-vis-search__input'));
    const dropdown = search.root.children[1];
    assert.ok(dropdown.classList.contains('iwac-vis-search__results'));

    search.input.value = 'abi';
    search.input.dispatch('input');
    const item = dropdown.children[0];
    assert.ok(item.classList.contains('iwac-vis-list-item'));
    assert.equal(item.children[0].className, 'iwac-vis-list__name');
    assert.equal(item.children[1].className, 'iwac-vis-list-item__count');

    const open = search.input.dispatch('keydown', { key: 'Escape' });
    assert.equal(dropdown.style.display, 'none');
    assert.ok(open.stopped, 'closing the list is the whole of this Escape');
    const closed = search.input.dispatch('keydown', { key: 'Escape' });
    assert.ok(!closed.stopped, 'with the list shut, Escape travels on');
});
