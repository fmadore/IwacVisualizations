'use strict';

// The shared control primitives (panels-controls.js + facet-buttons.js),
// against a small DOM stand-in. Nothing here is visible in a screenshot:
//
//   * a segmented group is one vocabulary — role=group, aria-pressed on
//     every button, arrow keys moving focus, `set()` silent;
//   * a year slider announces the YEAR through aria-valuetext, on the
//     reader's move and on the playback tick alike;
//   * a select repopulated in place keeps its value when it survives;
//   * a remount puts focus back on the control with the same handle — the
//     mechanism that makes a `<select>` traversable by keyboard at all;
//   * a facet bar opens on the sub-facet it is told to, and `setActive`
//     moves the pressed button along with the value (the S19 trap).

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const SHARED = join(ROOT, 'asset', 'js', 'charts', 'shared');
const read = (file) => readFileSync(join(SHARED, file), 'utf8');
// Objects built inside the vm realm carry that realm's prototypes, which
// strict deep equality rejects; a JSON round-trip compares structure only.
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ------------------------------------------------------------------ */
/*  A DOM small enough to read, large enough for the widgets           */
/* ------------------------------------------------------------------ */

class ClassList {
    constructor(el) { this.el = el; }
    get set() { return new Set((this.el.className || '').split(/\s+/).filter(Boolean)); }
    write(set) { this.el.className = [...set].join(' '); }
    add(c) { const s = this.set; s.add(c); this.write(s); }
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
        this.tagName = tag.toUpperCase();
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
        this._value = '';
        this._selectionStart = null;
        this._selectionEnd = null;
    }
    setAttribute(n, v) { this.attrs[n] = String(v); if (n.startsWith('data-')) this.dataset[camel(n.slice(5))] = String(v); }
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
    removeAttribute(n) { delete this.attrs[n]; }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); c.parentNode = null; return c; }
    replaceChild(next, prev) { const i = this.children.indexOf(prev); this.children[i] = next; next.parentNode = this; prev.parentNode = null; return prev; }
    get lastChild() { return this.children[this.children.length - 1] || null; }
    set innerHTML(v) { if (v === '') { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; } }
    get innerHTML() { return ''; }
    contains(el) { for (let n = el; n; n = n.parentNode) if (n === this) return true; return false; }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    dispatch(name, event = {}) {
        event.target = event.target || this;
        event.preventDefault = event.preventDefault || (() => { event.defaulted = true; });
        (this.listeners[name] || []).forEach((fn) => fn(event));
        // bubble
        if (this.parentNode && this.parentNode.dispatch) this.parentNode.dispatch(name, event);
    }
    focus() { this.ownerDocument.activeElement = this; }
    setSelectionRange(a, b) { this._selectionStart = a; this._selectionEnd = b; }
    get selectionStart() { return this.tagName === 'INPUT' ? (this._selectionStart == null ? 0 : this._selectionStart) : undefined; }
    get selectionEnd() { return this.tagName === 'INPUT' ? (this._selectionEnd == null ? 0 : this._selectionEnd) : undefined; }
    get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
    get value() {
        if (this.tagName === 'SELECT') {
            const sel = this.options.find((o) => o.selected);
            return sel ? sel._value : (this.options[0] ? this.options[0]._value : '');
        }
        return this._value;
    }
    set value(v) {
        v = String(v);
        if (this.tagName === 'SELECT') {
            let hit = false;
            this.options.forEach((o) => { o.selected = !hit && o._value === v; if (o.selected) hit = true; });
        } else {
            this._value = v;
        }
    }
    *walk() { yield this; for (const c of this.children) yield* c.walk(); }
    querySelector(selector) {
        const m = /^\[data-iwac-control="([^"]+)"\]$/.exec(selector);
        if (!m) throw new Error('unsupported selector ' + selector);
        for (const el of this.walk()) if (el.attrs['data-iwac-control'] === m[1]) return el;
        return null;
    }
    querySelectorAll() { return []; }
}
function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function makeDocument() {
    const doc = {
        activeElement: null,
        createElement(tag) { return new Element(tag, doc); },
        contains() { return true; },
        addEventListener() {},
        removeEventListener() {},
    };
    doc.body = doc.createElement('body');
    return doc;
}

function load() {
    const document = makeDocument();
    const context = {
        console,
        document,
        setTimeout, clearTimeout,
        window: { IWACVis: { t: (k) => k, locale: 'en' } },
    };
    context.window.document = document;
    vm.createContext(context);
    vm.runInContext(read('panels.js'), context, { filename: 'panels.js' });
    vm.runInContext(read('panels-controls.js'), context, { filename: 'panels-controls.js' });
    vm.runInContext(read('facet-buttons.js'), context, { filename: 'facet-buttons.js' });
    vm.runInContext(read('choropleth.js'), context, { filename: 'choropleth.js' });
    return { P: context.window.IWACVis.panels, document };
}

/* ------------------------------------------------------------------ */
/*  Segmented                                                          */
/* ------------------------------------------------------------------ */

test('a segmented group is role=group with aria-pressed, and only the reader fires onChange', () => {
    const { P } = load();
    const fired = [];
    const seg = P.buildSegmented({
        name: 'view',
        label: 'View:',
        options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }],
        active: 'a',
        onChange: (k) => fired.push(k),
    });
    assert.equal(seg.root.attrs.role, 'group');
    assert.equal(seg.root.attrs['aria-labelledby'], seg.root.children[0].id);
    assert.equal(seg.root.children[0].textContent, 'View:');
    assert.equal(seg.buttons.a.attrs['aria-pressed'], 'true');
    assert.equal(seg.buttons.b.attrs['aria-pressed'], 'false');
    assert.ok(seg.buttons.a.classList.contains('iwac-vis-tab--active'));
    assert.equal(seg.buttons.b.attrs['data-iwac-control'], 'view:b');

    seg.buttons.b.dispatch('click');
    assert.deepEqual(fired, ['b']);
    assert.equal(seg.get(), 'b');
    assert.equal(seg.buttons.a.attrs['aria-pressed'], 'false');
    assert.equal(seg.buttons.b.attrs['aria-pressed'], 'true');

    seg.buttons.b.dispatch('click');
    assert.deepEqual(fired, ['b'], 'pressing the pressed button is not a change');

    seg.set('c');
    assert.deepEqual(fired, ['b'], 'set() is silent');
    assert.equal(seg.buttons.c.attrs['aria-pressed'], 'true');
    assert.ok(!seg.buttons.b.classList.contains('iwac-vis-tab--active'));
});

test('arrow keys move focus within the group; Home / End reach the ends', () => {
    const { P, document } = load();
    const seg = P.buildSegmented({
        options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }],
        active: 'a',
        onChange() {},
    });
    seg.buttons.a.focus();
    seg.buttons.a.dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(document.activeElement, seg.buttons.b);
    seg.buttons.b.dispatch('keydown', { key: 'ArrowLeft' });
    assert.equal(document.activeElement, seg.buttons.a);
    seg.buttons.a.dispatch('keydown', { key: 'ArrowLeft' });
    assert.equal(document.activeElement, seg.buttons.c, 'wraps');
    seg.buttons.c.dispatch('keydown', { key: 'Home' });
    assert.equal(document.activeElement, seg.buttons.a);
    seg.buttons.a.dispatch('keydown', { key: 'End' });
    assert.equal(document.activeElement, seg.buttons.c);
    assert.equal(seg.get(), 'a', 'moving focus never presses');
});

test('null classes mean no class: a stylesheet keyed on aria-pressed needs none', () => {
    const { P } = load();
    const seg = P.buildSegmented({
        options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
        active: 'a',
        classes: { root: 'picker__type', btn: null, active: null },
        labelledBy: 'lbl',
        onChange() {},
    });
    assert.equal(seg.root.className, 'picker__type');
    assert.equal(seg.root.attrs['aria-labelledby'], 'lbl');
    assert.equal(seg.buttons.a.className, '');
    seg.set('b');
    assert.equal(seg.buttons.b.className, '', 'no active class was invented');
    assert.equal(seg.buttons.b.attrs['aria-pressed'], 'true');
});

/* ------------------------------------------------------------------ */
/*  Year slider                                                        */
/* ------------------------------------------------------------------ */

test('the year slider announces the year, on input and on set()', () => {
    const { P } = load();
    const years = [1960, 1961, 1962, 1963];
    const moves = [];
    const slider = P.buildYearSlider({
        years, index: 2, fillVar: '--fill', name: 'yr',
        onInput: (i) => moves.push(i),
    });
    const input = slider.input;
    assert.equal(input.attrs.type === undefined ? input.type : input.attrs.type, 'range');
    assert.equal(input.min, '0');
    assert.equal(input.max, '3');
    assert.equal(input.value, '2');
    assert.equal(input.attrs['aria-valuetext'], '1962');
    assert.equal(input.attrs['aria-label'], 'Year');
    assert.equal(input.style.props['--fill'], (2 / 3 * 100) + '%');
    assert.equal(slider.root.children[0].textContent, '1960');
    assert.equal(slider.root.children[2].textContent, '1963');

    input.value = '3';
    input.dispatch('input');
    assert.deepEqual(moves, [3]);
    assert.equal(input.attrs['aria-valuetext'], '1963');

    slider.set(0);
    assert.deepEqual(moves, [3], 'the playback tick does not echo as input');
    assert.equal(input.value, '0');
    assert.equal(input.attrs['aria-valuetext'], '1960');
    assert.equal(input.style.props['--fill'], '0%');

    slider.set(99);
    assert.equal(slider.get(), 3, 'clamped to the last year');
});

test('the year slider can be poured into an existing row', () => {
    const { P } = load();
    const row = P.el('div', 'row');
    const slider = P.buildYearSlider({ years: [2000, 2001], into: row, onInput() {} });
    assert.equal(slider.root, row);
    assert.equal(row.children.length, 3);
    assert.equal(row.children[1], slider.input);
});

/* ------------------------------------------------------------------ */
/*  Select                                                             */
/* ------------------------------------------------------------------ */

test('a select repopulated in place keeps a surviving value and falls back otherwise', () => {
    const { P } = load();
    const changes = [];
    const group = P.buildSelectControl({
        name: 'slice', label: 'Slice',
        options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
        current: 'b',
        onChange: (v) => changes.push(v),
    });
    assert.equal(group.control.value, 'b');
    assert.equal(group.control.attrs['data-iwac-control'], 'slice');

    assert.equal(group.setOptions([{ value: 'b', label: 'B' }, { value: 'c', label: 'C' }]), 'b');
    assert.equal(group.control.value, 'b', 'kept: still offered');
    assert.equal(group.setOptions([{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]), 'x');
    assert.equal(group.control.value, 'x', 'fell back to the first');
    assert.equal(group.setOptions([{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }], 'y'), 'y');
    assert.deepEqual(changes, [], 'repopulating never fires onChange');

    group.control.value = 'x';
    group.control.dispatch('change');
    assert.deepEqual(changes, ['x']);
});

/* ------------------------------------------------------------------ */
/*  Focus across a remount                                             */
/* ------------------------------------------------------------------ */

test('withFocusRestored puts focus on the control carrying the same handle', () => {
    const { P, document } = load();
    const host = P.el('div');
    let select = P.buildSelectControl({ name: 'country', label: 'C', options: [{ value: 'a', label: 'A' }], onChange() {} });
    host.appendChild(select);
    select.control.focus();
    assert.equal(document.activeElement, select.control);

    let rebuilt;
    P.withFocusRestored(host, () => {
        host.innerHTML = '';
        rebuilt = P.buildSelectControl({ name: 'country', label: 'C', options: [{ value: 'a', label: 'A' }], onChange() {} });
        host.appendChild(rebuilt);
    });
    assert.notEqual(rebuilt.control, select.control);
    assert.equal(document.activeElement, rebuilt.control, 'the new select took focus');

    // Focus outside the host is left alone.
    const elsewhere = P.el('button');
    elsewhere.focus();
    P.withFocusRestored(host, () => { host.innerHTML = ''; });
    assert.equal(document.activeElement, elsewhere);

    // A text input gets its caret back.
    const input = P.el('input');
    input.setAttribute('data-iwac-control', 'q');
    input.value = 'école';
    input.setSelectionRange(2, 2);
    host.appendChild(input);
    input.focus();
    let again;
    P.withFocusRestored(host, () => {
        host.innerHTML = '';
        again = P.el('input');
        again.setAttribute('data-iwac-control', 'q');
        again.value = 'école';
        host.appendChild(again);
    });
    assert.equal(document.activeElement, again);
    assert.deepEqual([again._selectionStart, again._selectionEnd], [2, 2]);
});

/* ------------------------------------------------------------------ */
/*  Facet buttons                                                      */
/* ------------------------------------------------------------------ */

function facetBar(P, overrides) {
    const events = [];
    const bar = P.buildFacetButtons(Object.assign({
        facets: [
            { key: 'global', label: 'Global' },
            { key: 'country', label: 'Country',
              subFacets: { Benin: 'Bénin', Togo: 'Togo', Niger: 'Niger' }, renderAs: 'buttons' },
            { key: 'decade', label: 'Decade',
              subFacets: { d1960: '1960s', d1970: '1970s' }, renderAs: 'select' },
        ],
        activeKey: 'global',
        onChange: (e) => events.push(e),
    }, overrides || {}));
    return { bar, events };
}

function subButtons(bar) {
    const subBar = bar.root.children[1];
    const group = subBar.children[0];
    return group ? group.children : [];
}

test('a facet bar opens on the requested sub-facet, and the pressed button follows setActive', () => {
    const { P } = load();
    const { bar, events } = facetBar(P, { activeKey: 'country', activeSubKey: 'Togo' });
    const mains = bar.root.children[0].children;
    assert.equal(mains.length, 3);
    assert.equal(mains[1].attrs['aria-pressed'], 'true');
    assert.equal(mains[1].dataset.facetKey, 'country');

    let subs = subButtons(bar);
    assert.equal(subs.length, 3);
    assert.equal(subs.map((b) => b.attrs['aria-pressed']).join(','), 'false,true,false', 'opened on Togo');
    assert.deepEqual(plain(bar.getActive()), { facet: 'country', subFacet: 'Togo' });
    assert.deepEqual(events, [], 'the initial render does not fire');

    // The S19 trap: setActive with a sub-key in button mode must move the mark.
    bar.setActive('country', 'Niger');
    subs = subButtons(bar);
    assert.equal(subs.map((b) => b.attrs['aria-pressed']).join(','), 'false,false,true');
    assert.deepEqual(plain(events.at(-1)), { facet: 'country', subFacet: 'Niger' });

    // Another facet, select mode: the select shows the requested value.
    bar.setActive('decade', 'd1970');
    const select = bar.root.children[1].children[0];
    assert.equal(select.tagName, 'SELECT');
    assert.equal(select.value, 'd1970');
    assert.deepEqual(plain(events.at(-1)), { facet: 'decade', subFacet: 'd1970' });

    // A sub-key the facet does not offer falls back to the first.
    bar.setActive('country', 'Nowhere');
    assert.deepEqual(plain(bar.getActive()), { facet: 'country', subFacet: 'Benin' });
});

test('a sub-facet click fires with both keys; a main click reopens on the first sub-facet', () => {
    const { P } = load();
    const { bar, events } = facetBar(P);
    const mains = bar.root.children[0].children;
    mains[1].dispatch('click');
    assert.deepEqual(plain(events), [{ facet: 'country', subFacet: 'Benin' }]);
    subButtons(bar)[2].dispatch('click');
    assert.deepEqual(plain(events.at(-1)), { facet: 'country', subFacet: 'Niger' });
    assert.equal(subButtons(bar)[2].attrs['aria-pressed'], 'true');
});

test('a single-facet bar renders an eyebrow label that names its select', () => {
    const { P } = load();
    const { bar } = facetBar(P, {
        facets: [{ key: 'decade', label: 'Decade', subFacets: { a: 'A', b: 'B' }, renderAs: 'select' }],
        activeKey: 'decade',
        activeSubKey: 'b',
    });
    const eyebrow = bar.root.children[0].children[0];
    assert.equal(eyebrow.tagName, 'SPAN');
    assert.equal(eyebrow.textContent, 'Decade');
    const select = bar.root.children[1].children[0];
    assert.equal(select.attrs['aria-labelledby'], eyebrow.id);
    assert.equal(select.value, 'b');
});

/* ------------------------------------------------------------------ */
/*  Choropleth scale + legend                                          */
/* ------------------------------------------------------------------ */

test('the legend is built from the same scale as the fill', () => {
    const { P } = load();
    // No theme tokens in this harness: the ramp falls back to two stops.
    const seq = P.choroplethScale(null, { 'Bénin': 40, Togo: 12 });
    assert.equal(seq.mode, 'sequential');
    assert.deepEqual(plain(seq.stops.map((s) => s.value)), [0, 40]);

    const pinned = P.choroplethScale({ fixedMax: 100 }, { 'Bénin': 40 });
    assert.deepEqual(plain(pinned.stops.map((s) => s.value)), [0, 100], 'fixedMax pins the top');

    const div = P.choroplethScale({ mode: 'diverging', negColor: '#00f', posColor: '#f00' }, { a: -30, b: 12 });
    assert.equal(div.mode, 'diverging');
    assert.deepEqual(plain(div.stops.map((s) => s.value)), [-30, 0, 30]);

    const legend = P.buildChoroplethLegend({ title: 'mentions', stops: seq.stops });
    assert.equal(legend.className, 'iwac-vis-map-legend');
    assert.equal(legend.children[0].textContent, 'mentions');
    assert.match(legend.children[1].style.background, /^linear-gradient\(to right, .* 0%, .* 100%\)$/);
    assert.deepEqual(legend.children[2].children.map((c) => c.textContent), ['0', '40']);

    const divLegend = P.buildChoroplethLegend({ stops: div.stops });
    assert.deepEqual(divLegend.children[1].children.map((c) => c.textContent), ['\u221230', '0', '+30'],
        'a diverging scale is labelled from minus through zero to plus');

    const classed = P.buildChoroplethLegend({ title: 'Quantile', items: [
        { color: '#a', label: '1–4' }, { color: '#b', label: '5–20' },
    ] });
    assert.equal(classed.children.length, 3);
    assert.equal(classed.children[1].children[0].style.background, '#a');
    assert.equal(classed.children[2].children[1].textContent, '5–20');
});
