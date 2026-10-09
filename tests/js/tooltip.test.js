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

/*
 * V-04. In native fullscreen only the fullscreen element and its descendants
 * are drawn, so a tooltip appended to <body> (the theme's default, which
 * escapes a small chart's clipping cell) vanishes behind the panel. Every
 * chart in a panel with a fullscreen control keeps its tooltip in the chart
 * through C._inPanelTooltip.
 */
function loadBuilders() {
    const context = {
        console,
        document: { createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { add() {} }, style: {} }) },
        window: { IWACVis: { t: (k) => k, formatNumber: String, locale: 'en', getPalette: () => ['#111111', '#222222'], getChartTokens: () => ({}) } },
    };
    vm.createContext(context);
    for (const file of [
        ['charts', 'shared', 'panels.js'],
        ['charts', 'shared', 'chart-options.js'],
        ['charts', 'shared', 'chart-options-graph.js'],
        ['charts', 'shared', 'chart-options-special.js'],
        ['charts', 'references-overview', 'collaboration-network.js'],
    ]) {
        vm.runInContext(read(...file), context, { filename: file.join('/') });
    }
    return context.window.IWACVis.chartOptions;
}

function assertInPanel(tooltip, label) {
    assert.ok(tooltip, `${label}: no tooltip`);
    assert.equal(tooltip.confine, true, `${label}: tooltip not confined`);
    const host = { id: 'chart' };
    assert.equal(typeof tooltip.appendTo, 'function', `${label}: tooltip appended to <body>`);
    assert.equal(tooltip.appendTo(host), host, `${label}: tooltip not appended to its chart`);
}

test('C._inPanelTooltip keeps a tooltip inside its chart', () => {
    const C = loadBuilders();
    const tip = C._inPanelTooltip({ trigger: 'item' });
    assert.equal(tip.trigger, 'item');
    assertInPanel(tip, '_inPanelTooltip');
});

test('the builders behind fullscreen-capable panels keep their tooltips in-panel', () => {
    const C = loadBuilders();
    assertInPanel(C.chord({ names: ['a', 'b'], matrix: [[0, 2], [2, 0]] }).tooltip, 'chord');
    assertInPanel(C.collaborationNetwork({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] }).tooltip, 'collaboration network');
    const landscape = C.landscape({ x: [0, 1], y: [0, 1], title: ['a', 'b'] }, { a: [0, 1] }, {});
    assertInPanel(landscape.tooltip, 'semantic landscape');
});

test('a panel with a fullscreen control sets no <body> tooltip', () => {
    // Source-level: every file that adds a fullscreen control writes its
    // ECharts tooltips through C._inPanelTooltip. A tooltip in such a file
    // that belongs to a panel WITHOUT the control says so on the line above.
    const { readdirSync, statSync } = require('node:fs');
    const files = [];
    (function walk(dir) {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) { if (name !== 'dist') walk(full); }
            else if (name.endsWith('.js')) files.push(full);
        }
    })(join(ROOT, 'asset', 'js', 'charts'));
    const offenders = [];
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        if (!/buildGraphPanelToolbar\(|addFullscreenButton\(/.test(src)) continue;
        const lines = src.split(/\r?\n/);
        lines.forEach((line, i) => {
            if (!/\btooltip\s*[:=]\s*\{/.test(line)) return;
            if (/no fullscreen control/.test(lines[i - 1] || '')) return;
            offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
        });
    }
    assert.deepEqual(offenders, [], 'route these through C._inPanelTooltip');
});

test('a landscape tabulates titles, buckets and details, never projection floats', () => {
    // V-12: "View as table" on a semantic landscape listed UMAP x and y.
    const C = loadBuilders();
    const option = C.landscape(
        { x: [0.1, 0.2], y: [0.3, 0.4], title: ['Alpha', 'Beta'], o_id: [11, 12] },
        { groups: { Togo: [0], Niger: [1] }, order: ['Togo', 'Niger'] },
        { siteBase: '/s/iwac', tooltipBits: (i) => [i ? '1990' : '1985'] }
    );
    const table = JSON.parse(JSON.stringify(option.iwacRows()));
    assert.deepEqual(table.columns.map((c) => c.label), ['Title', 'Category', 'Details']);
    assert.deepEqual(table.rows, [
        [{ text: 'Alpha', href: '/s/iwac/item/11' }, 'Togo', '1985'],
        [{ text: 'Beta', href: '/s/iwac/item/12' }, 'Niger', '1990'],
    ]);
});

test('a network label is cut at its end, where a name stops identifying itself', () => {
    // V-19: the middle ellipsis printed "Fête de Tab…hier la fête".
    const C = loadBuilders();
    const label = C._truncateEnd('Fête de Tabaski, hier la fête', 24);
    assert.equal(label.length <= 24, true);
    assert.ok(label.startsWith('Fête de Tabaski'));
    assert.ok(label.endsWith('\u2026'));
    assert.equal(C._truncateEnd('Short', 24), 'Short');
});

test('the theme tooltip and legend take their chrome from tokens', () => {
    const source = readFileSync(join(ROOT, 'asset', 'js', 'iwac-theme.js'), 'utf8');
    assert.match(source, /extraCssText: 'box-shadow: var\(--shadow-md, /);
    assert.match(source, /border-radius: var\(--radius-md, 0\.5rem\);'/);
    assert.match(source, /inactiveColor: tokens\.muted/);
});
