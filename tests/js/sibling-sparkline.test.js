'use strict';

// The sibling sparkline's year labels, against a DOM stand-in:
//
//   * the plot stops above the label band, so a series near zero at either
//     end no longer runs its line through the end years;
//   * the highlight label is pinned to an edge only when centring would clip
//     it, and an endpoint label is dropped only when the two would overlap —
//     a highlight two years from the end used to print "20172019".

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const SOURCE = readFileSync(
    join(ROOT, 'asset', 'js', 'charts', 'shared', 'renderers', 'sibling-sparkline.js'),
    'utf8'
);

class Node {
    constructor(tag) {
        this.tag = tag;
        this.attrs = {};
        this.children = [];
        this.textContent = '';
        this.classes = [];
        this.classList = { add: (...cs) => this.classes.push(...cs) };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    appendChild(c) { this.children.push(c); return c; }
}

function loadRenderer() {
    const renderers = {};
    const context = {
        console,
        document: { createElementNS: (ns, tag) => new Node(tag) },
        window: {
            IWACVis: {
                panels: {
                    el: (tag, cls, text) => Object.assign(new Node(tag), { className: cls, textContent: text }),
                    buildEmptyState: () => new Node('empty'),
                },
                dashboardLayout: {
                    registerRenderer: (name, fn) => { renderers[name] = fn; },
                    registerMetadata() {},
                },
            },
        },
    };
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'sibling-sparkline.js' });
    return renderers.siblingSparkline;
}

function render(data) {
    const host = new Node('div');
    host.closest = () => null;
    loadRenderer()(host, data);
    const svg = host.children[0];
    const labels = svg.children
        .filter((n) => n.tag === 'text')
        .map((n) => ({ text: n.textContent, x: Number(n.attrs.x), anchor: n.attrs['text-anchor'] || 'start' }));
    return { svg, labels };
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// Le Patriote's articles per year in the IWAC corpus, 1992-2019.
const YEARS = range(1992, 2019);
const VALUES = [1, 6, 2, 0, 0, 0, 0, 26, 39, 60, 20, 34, 78, 64, 71, 55, 11, 52, 73, 44, 5, 40, 23, 24, 10, 110, 5, 8];

test('sparkline keeps the plot above the year labels', () => {
    const { svg } = render({ years: YEARS, values: VALUES });
    const line = svg.children.find((n) => n.attrs.class === 'iwac-vis-sparkline__line');
    const ys = line.attrs.d.match(/,[\d.]+/g).map((s) => Number(s.slice(1)));
    // Labels sit on the baseline y = 55 at 11px, so their tops reach ~44.
    assert.ok(Math.max(...ys) <= 43, `lowest point ${Math.max(...ys)} runs into the label band`);
});

test('sparkline drops the end label a near-end highlight would overprint', () => {
    const { labels } = render({ years: YEARS, values: VALUES, highlight: 2017 });
    assert.deepEqual(labels.map((l) => l.text), ['2017', '1992']);
    assert.equal(labels[0].anchor, 'middle');
});

test('sparkline keeps both end labels when the highlight sits clear of them', () => {
    const { labels } = render({ years: YEARS, values: VALUES, highlight: 2004 });
    assert.deepEqual(labels.map((l) => l.text).sort(), ['1992', '2004', '2019']);
});

test('sparkline pins a highlight label that centring would clip', () => {
    const years = range(1960, 2025);
    const values = years.map((_, i) => i % 7);
    const first = render({ years, values, highlight: 1961 }).labels;
    assert.equal(first[0].text, '1961');
    assert.equal(first[0].anchor, 'start');
    assert.ok(!first.some((l) => l.text === '1960'), 'the start label overprints a pinned highlight');

    const last = render({ years, values, highlight: 2025 }).labels;
    assert.equal(last[0].anchor, 'end');
    assert.deepEqual(last.map((l) => l.text), ['2025', '1960']);
});

test('sparkline without a highlight labels both ends', () => {
    const { labels, svg } = render({ years: YEARS, values: VALUES });
    assert.deepEqual(labels.map((l) => l.text), ['1992', '2019']);
    assert.ok(!svg.children.some((n) => n.tag === 'circle'));
});
