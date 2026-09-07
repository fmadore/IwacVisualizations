'use strict';

// C.itemTooltip / C.tooltipDot — the shape fifteen tooltip formatters built
// by hand (asset/js/charts/shared/chart-options.js).
//
// The escaping split is the part worth pinning: the TITLE is always a datum
// and is escaped here, while the LINES are HTML the caller composed on
// purpose — a colour swatch, an <em>, a translated string with a <br> in it.
// Passing them as one string would force every caller to choose, which is
// how an unescaped title gets shipped.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, 'asset', 'js', ...parts), 'utf8');

function load() {
    const context = {
        console,
        document: { createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { add() {} }, style: {} }) },
        window: { IWACVis: { t: (k) => k, formatNumber: String, locale: 'en' } },
    };
    vm.createContext(context);
    vm.runInContext(read('charts', 'shared', 'panels.js'), context, { filename: 'panels.js' });
    vm.runInContext(read('charts', 'shared', 'chart-options.js'), context, { filename: 'chart-options.js' });
    return context.window.IWACVis.chartOptions;
}

test('the title is escaped and the lines are not', () => {
    const C = load();
    assert.equal(
        C.itemTooltip('Côte d\'Ivoire <b>', ['<em>245</em> articles']),
        '<strong>Côte d&#39;Ivoire &lt;b&gt;</strong><br><em>245</em> articles'
    );
});

test('a title on its own carries no separator', () => {
    const C = load();
    assert.equal(C.itemTooltip('Togo'), '<strong>Togo</strong>');
    assert.equal(C.itemTooltip('Togo', []), '<strong>Togo</strong>');
    assert.equal(C.itemTooltip('Togo', ''), '<strong>Togo</strong>');
});

test('lines join on <br>, and empty ones drop out rather than doubling it', () => {
    const C = load();
    assert.equal(
        C.itemTooltip('Niger', ['1961', '', '12 articles']),
        '<strong>Niger</strong><br>1961<br>12 articles'
    );
});

test('a missing title is empty, not "undefined"', () => {
    const C = load();
    assert.equal(C.itemTooltip(null, ['x']), '<strong></strong><br>x');
    assert.equal(C.itemTooltip(undefined), '<strong></strong>');
    assert.equal(C.itemTooltip(0), '<strong>0</strong>');
});

test('a single string is accepted where a list is', () => {
    const C = load();
    assert.equal(C.itemTooltip('A', 'one line'), '<strong>A</strong><br>one line');
});

test('the swatch matches ECharts own marker, and degrades to transparent', () => {
    const C = load();
    assert.match(C.tooltipDot('#ce4115'), /background-color:#ce4115/);
    assert.match(C.tooltipDot(), /background-color:transparent/);
});
