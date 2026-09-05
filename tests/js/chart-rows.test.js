'use strict';

// The chart's option read back as rows (asset/js/charts/shared/chart-rows.js).
//
// A table that disagrees with the chart it sits under is worse than no
// table, so each option shape the builders emit is pinned here: category
// axes on either side, the named bar items the horizontal builders carry,
// the heatmap matrix, name/value series, nested trees, scatter points —
// and the shapes that must yield nothing. The CSV is checked for the two
// things a spreadsheet trips on: quoting, and a leading `=`.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const SOURCE = readFileSync(join(ROOT, 'asset', 'js', 'charts', 'shared', 'chart-rows.js'), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));

function load() {
    const context = { console, window: { IWACVis: { panels: { t: (k) => k } } } };
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'chart-rows.js' });
    return context.window.IWACVis.panels;
}

test('a category x axis with two series: one row per category, one column per series', () => {
    const P = load();
    const table = P.optionToRows({
        xAxis: { type: 'category', data: ['1960', '1961', '1962'], name: 'Year' },
        yAxis: { type: 'value' },
        series: [
            { name: 'Articles', type: 'bar', data: [3, null, 5] },
            { name: 'Publications', type: 'line', data: [{ value: 1 }, 2, '4'] },
        ],
    });
    assert.deepEqual(plain(table), {
        columns: [
            { label: 'Year', numeric: false },
            { label: 'Articles', numeric: true },
            { label: 'Publications', numeric: true },
        ],
        rows: [['1960', 3, 1], ['1961', null, 2], ['1962', 5, 4]],
    });
    assert.ok(P.hasTabularOption({ xAxis: { type: 'category', data: ['a'] }, series: [{ data: [1] }] }));
});

test('a category y axis (horizontal bars) with named items reads the value beside the name', () => {
    const P = load();
    const table = P.optionToRows({
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: ['Bénin', 'Togo'], inverse: true },
        series: [{ type: 'bar', data: [{ name: 'Bénin', value: 12 }, { name: 'Togo', value: 7 }] }],
    });
    assert.deepEqual(plain(table.rows), [['Bénin', 12], ['Togo', 7]]);
    assert.equal(table.columns[0].label, 'Category');
    assert.equal(table.columns[1].label, 'Series 1');
});

test('a series shorter than the axis is placed by name, not by position', () => {
    const P = load();
    const table = P.optionToRows({
        xAxis: { type: 'category', data: ['a', 'b', 'c'] },
        yAxis: {},
        series: [{ name: 's', data: [['c', 9], ['a', 1]] }],
    });
    assert.deepEqual(plain(table.rows), [['a', 1], ['b', null], ['c', 9]]);
});

test('the withMedia form is read through its baseOption', () => {
    const P = load();
    const table = P.optionToRows({
        baseOption: { xAxis: { type: 'category', data: ['x'] }, series: [{ name: 'n', data: [2] }] },
        media: [{ query: {}, option: {} }],
    });
    assert.deepEqual(plain(table.rows), [['x', 2]]);
});

test('a heatmap over two category axes becomes a matrix, rows by the y axis', () => {
    const P = load();
    const table = P.optionToRows({
        xAxis: { type: 'category', data: ['Jan', 'Feb'] },
        yAxis: { type: 'category', data: ['1960', '1961'], name: 'Year' },
        series: [{ type: 'heatmap', data: [[0, 0, 5], { value: [1, 1, 8] }, [1, 0, 0]] }],
    });
    assert.deepEqual(plain(table), {
        columns: [{ label: 'Year', numeric: false }, { label: 'Jan', numeric: true }, { label: 'Feb', numeric: true }],
        rows: [['1960', 5, 0], ['1961', null, 8]],
    });
});

test('a pie is name/value; a treemap flattens its tree with a path', () => {
    const P = load();
    const pie = P.optionToRows({
        series: [{ type: 'pie', name: 'Languages', data: [{ name: 'fr', value: 90 }, { name: 'en', value: 10 }] }],
    });
    assert.deepEqual(plain(pie), {
        columns: [{ label: 'Name', numeric: false }, { label: 'Languages', numeric: true }],
        rows: [['fr', 90], ['en', 10]],
    });

    const tree = P.optionToRows({
        series: [{ type: 'treemap', data: [
            { name: 'Press', children: [{ name: 'Bénin', value: 4 }, { name: 'Togo', value: [2, 99] }] },
            { name: 'Other', value: 1 },
        ] }],
    });
    assert.deepEqual(plain(tree.rows), [['Press › Bénin', 4], ['Press › Togo', 2], ['Other', 1]]);
    assert.equal(tree.columns[1].label, 'Value', 'an unnamed single series is headed "Value"');

    const two = P.optionToRows({
        series: [
            { type: 'pie', name: 'A', data: [{ name: 'x', value: 1 }, { name: 'y', value: 2 }] },
            { type: 'pie', name: 'B', data: [{ name: 'y', value: 3 }] },
        ],
    });
    assert.deepEqual(plain(two.rows), [['x', 1, null], ['y', 2, 3]]);
});

test('scatter points on value axes: one row per point with the series name', () => {
    const P = load();
    const table = P.optionToRows({
        xAxis: { type: 'value', name: 'Words' },
        yAxis: { type: 'value' },
        series: [{ type: 'scatter', name: 'Items', data: [[10, 2.5], { value: [20, 3] }] }],
    });
    assert.deepEqual(plain(table), {
        columns: [{ label: 'Series', numeric: false }, { label: 'Words', numeric: true }, { label: 'y', numeric: true }],
        rows: [['Items', 10, 2.5], ['Items', 20, 3]],
    });
});

test('shapes with no tabular reading yield nothing', () => {
    const P = load();
    assert.equal(P.optionToRows(null), null);
    assert.equal(P.optionToRows({ title: { text: 'No data' } }), null);
    assert.equal(P.optionToRows({ series: [{ type: 'graph', data: [{ name: 'a' }], links: [] }] }), null);
    assert.equal(P.optionToRows({
        xAxis: { type: 'category', data: ['a'] },
        series: [{ type: 'bar', data: [1] }, { type: 'custom', data: [[0, 1]] }],
    }), null, 'one unreadable series poisons the table — a half-table would claim to be the chart');
    assert.equal(P.hasTabularOption({ series: [{ type: 'bar', data: [] }] }), false);
    assert.equal(P.hasTabularOption({ series: [{ type: 'custom', data: [1] }] }), false);
});

test('CSV: BOM, CRLF, quoting, raw numbers, link cells by their text, formulas neutralised', () => {
    const P = load();
    const csv = P.rowsToCsv({
        columns: [{ label: 'Place' }, { label: 'Count, n' }],
        rows: [
            [{ text: 'Cotonou', href: '/item/1' }, 1234.5],
            ['Say "hi"', null],
            ['=SUM(A1)', -3],
            ['-3 not a formula', 0],
        ],
    });
    assert.ok(csv.startsWith('\uFEFF'), 'a BOM so a spreadsheet reads the accents');
    assert.deepEqual(csv.slice(1).split('\r\n'), [
        'Place,"Count, n"',
        'Cotonou,1234.5',
        '"Say ""hi""",',
        '\'=SUM(A1),-3',
        '-3 not a formula,0',
        '',
    ]);
});
