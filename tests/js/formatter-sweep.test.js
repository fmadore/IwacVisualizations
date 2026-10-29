'use strict';

// Hostile labels through every shared chart-option builder's tooltips
// (asset/js/charts/shared/chart-options*.js).
//
// ECharts renders a tooltip formatter's return value as HTML, and the labels
// in it — newspaper titles, entity names, place names, topic words — come
// from the archive and its imports. tooltip.test.js pins the one helper most
// formatters share (C.itemTooltip); this sweeps the rest. Each builder gets
// an input whose every text field is an <img onerror> payload, every tooltip
// formatter FUNCTION in the option it returns is called with params built
// from that option's own series (the shape ECharts hands it), and no output
// may contain the raw tag. Axis and series labels are drawn as canvas text,
// not HTML, so only tooltips are swept.
//
// The same contract as DRE Visualizations' check-formatters.mjs, which runs
// its formatters on hostile golden data.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, 'asset', 'js', ...parts), 'utf8');

const H = '<img src=x onerror=alert(1)>';
const RAW = '<img';

function stubElement() {
    return {
        setAttribute() {}, appendChild() {}, removeChild() {}, addEventListener() {},
        classList: { add() {}, remove() {}, contains: () => false },
        style: {}, dataset: {}, children: [], textContent: '',
        getContext: () => ({ measureText: (s) => ({ width: String(s).length * 7 }), font: '' }),
        getBoundingClientRect: () => ({ width: 640, height: 360 }),
    };
}

function load() {
    const context = {
        console, Math, JSON, Intl, Number, String, Array, Object, Date,
        document: { createElement: stubElement, documentElement: { lang: 'en' }, body: stubElement() },
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        window: { IWACVis: { t: (k) => k, formatNumber: String, locale: 'en' } },
    };
    context.window.getComputedStyle = context.getComputedStyle;
    vm.createContext(context);
    for (const file of ['panels.js', 'hijri.js', 'chart-options.js', 'chart-options-bar.js', 'chart-options-hbar.js',
        'chart-options-graph.js', 'chart-options-special.js']) {
        vm.runInContext(read('charts', 'shared', file), context, { filename: file });
    }
    return context.window.IWACVis.chartOptions;
}

/** Each shared builder, with an input whose text is all payload. */
function hostileBuilds(C) {
    const years = [2001, 2002, 2003];
    return {
        timeline: () => C.timeline({ years, countries: [H, 'Bénin'], series: { [H]: [1, 2, 3], 'Bénin': [3, 2, 1] } }),
        stackedBar: () => C.stackedBar({ categories: [H, 'b'], stackKeys: [H, 'k'], series: { [H]: [1, 2], k: [2, 1] } }),
        chord: () => C.chord({ names: [H, 'b', 'c'], matrix: [[0, 2, 1], [2, 0, 3], [1, 3, 0]] }),
        horizontalBar: () => C.horizontalBar([{ name: H, count: 3 }, { name: 'b', count: 1 }]),
        newspaper: () => C.newspaper([{ name: H, count: 3, country: H }, { name: 'b', count: 1, country: 'Togo' }]),
        entities: () => C.entities([
            { title: H, frequency: 3, o_id: 1, countries: [H], first_occurrence: H, last_occurrence: H },
            { title: 'b', frequency: 1, o_id: 2, countries: ['Togo'] },
        ]),
        pie: () => C.pie([{ name: H, count: 3 }, { name: 'b', count: 1 }]),
        treemap: () => C.treemap({ name: H, children: [{ name: H, value: 2, children: [{ name: H, value: 2 }] },
            { name: 'b', value: 1 }] }),
        gantt: () => C.gantt([{ name: H, year_min: 2001, year_max: 2005 }, { name: 'b', year_min: 2002, year_max: 2003 }]),
        wordcloud: () => C.wordcloud([[H, 5], ['b', 3]], stubElement()),
        segmentedBar: () => C.segmentedBar([{ name: H, count: 2 }, { name: 'b', count: 1 }],
            { colors: {}, axisLabel: H }),
        sunburst: () => C.sunburst([{ name: H, value: 2, children: [{ name: H, value: 2 }] }, { name: 'b', value: 1 }]),
        heatmap: () => C.heatmap({ years, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], cells: [[0, 0, 5], [1, 3, 2]] }),
        landscape: () => C.landscape({ x: [0.1, 0.2, 0.3], y: [0.3, 0.2, 0.1], title: [H, H, 'c'] },
            { groups: { [H]: [0, 1], b: [2] }, order: [H, 'b'] }, { tooltipBits: () => [H] }),
        heatmapMatrix: () => C.heatmapMatrix({ xLabels: [H, 'x'], yLabels: [H, 'y'], cells: [[0, 0, 3], [1, 1, 1]] }),
    };
}

function categoryAxis(option) {
    for (const key of ['xAxis', 'yAxis', 'angleAxis', 'radiusAxis', 'singleAxis']) {
        const axes = [].concat(option[key] || []);
        const withData = axes.find((a) => a && Array.isArray(a.data));
        if (withData) return withData.data.map((d) => (d && typeof d === 'object' ? d.value : d));
    }
    return [];
}

function nameOf(datum, index, categories) {
    if (datum && typeof datum === 'object' && !Array.isArray(datum) && datum.name != null) return datum.name;
    if (categories[index] != null) return categories[index];
    return H;
}

function valueOf(datum) {
    if (datum && typeof datum === 'object' && !Array.isArray(datum)) return datum.value;
    return datum;
}

/** Every params object ECharts would hand an item tooltip, series by series. */
function itemParams(option) {
    const categories = categoryAxis(option);
    const out = [];
    [].concat(option.series || []).forEach((series, seriesIndex) => {
        if (!series) return;
        const base = { componentType: 'series', seriesType: series.type, seriesIndex, seriesName: series.name,
            color: '#123456', marker: '<span class="m"></span>', percent: 50 };
        (series.data || []).forEach((datum, dataIndex) => {
            const name = nameOf(datum, dataIndex, categories);
            out.push(Object.assign({}, base, {
                dataType: series.type === 'graph' ? 'node' : undefined,
                name, dataIndex, data: datum, value: valueOf(datum),
                treePathInfo: [{ name: H }, { name }], treeAncestors: [{ name: H }, { name }],
            }));
        });
        (series.links || series.edges || []).forEach((link, dataIndex) => {
            out.push(Object.assign({}, base, {
                dataType: 'edge', name: `${link.source} > ${link.target}`, dataIndex, data: link, value: link.value,
            }));
        });
    });
    return out;
}

/** The params array an axis-triggered tooltip receives, one per category. */
function axisParams(option) {
    const categories = categoryAxis(option);
    const items = itemParams(option);
    const width = Math.max(categories.length, ...items.map((p) => p.dataIndex + 1), 1);
    const out = [];
    for (let i = 0; i < width; i++) {
        const row = items.filter((p) => p.dataIndex === i && p.dataType !== 'edge')
            .map((p) => Object.assign({}, p, { axisValue: categories[i] ?? H, axisValueLabel: categories[i] ?? H }));
        if (row.length) out.push(row);
    }
    return out;
}

/** [where, formatter, trigger] for every tooltip formatter function in an option. */
function tooltipFormatters(option) {
    const found = [];
    const globalTrigger = option.tooltip && option.tooltip.trigger;
    if (option.tooltip && typeof option.tooltip.formatter === 'function') {
        found.push(['tooltip', option.tooltip.formatter, globalTrigger || 'item']);
    }
    [].concat(option.series || []).forEach((series, i) => {
        if (series && series.tooltip && typeof series.tooltip.formatter === 'function') {
            found.push([`series[${i}].tooltip`, series.tooltip.formatter, series.tooltip.trigger || globalTrigger || 'item']);
        }
    });
    return found;
}

// Builders whose tooltip shows no text field at all (year × month counts).
const NO_TEXT = new Set(['heatmap']);

test('every shared builder\'s tooltips escape a hostile label', () => {
    const C = load();
    let withFormatter = 0;
    for (const [builder, build] of Object.entries(hostileBuilds(C))) {
        const option = build();
        // No formatter function: ECharts' own tooltip, which escapes names.
        for (const [where, formatter, trigger] of tooltipFormatters(option)) {
            withFormatter++;
            const paramsList = trigger === 'axis' ? axisParams(option) : itemParams(option);
            assert.ok(paramsList.length, `${builder} ${where}: no params could be built from its own series`);
            let escaped = 0;
            for (const params of paramsList) {
                const html = String(formatter(params) ?? '');
                if (html.includes('&lt;img')) escaped++;
                assert.ok(!html.includes(RAW), `${builder} ${where} put a raw label into its HTML:\n${html}`);
            }
            // Raw-free because the payload never arrived proves nothing: the
            // label must reach the HTML, escaped.
            if (!NO_TEXT.has(builder)) {
                assert.ok(escaped > 0, `${builder} ${where}: the hostile label never reached the tooltip`);
            }
        }
    }
    assert.ok(withFormatter >= 13, `only ${withFormatter} tooltip formatters swept`);
});

// Public chartOptions functions that return something other than a chart
// option: tooltip pieces (itemTooltip has its own test), palettes, sizes and
// the word-cloud layout primitives.
const NOT_BUILDERS = ['centralityPalette', 'ganttHeight', 'itemTooltip', 'polarityPalette', 'readableInks',
    'sortedAxisTooltip', 'subjectivityPalette', 'tooltipDot', 'typeColors', 'wordcloudInks', 'wordcloudLayout'];

test('a new shared builder cannot skip the sweep', () => {
    const C = load();
    const builders = Object.keys(C).filter((k) => typeof C[k] === 'function' && !k.startsWith('_')
        && !NOT_BUILDERS.includes(k));
    assert.deepEqual(builders.sort(), Object.keys(hostileBuilds(C)).sort(),
        'add the builder to hostileBuilds (or, if it builds no option, to NOT_BUILDERS)');
});

test('the sweep notices a raw label', () => {
    // The assertion above, against a formatter that interpolates the name.
    const option = { tooltip: { trigger: 'item', formatter: (p) => `<strong>${p.name}</strong>` },
        series: [{ type: 'pie', data: [{ name: H, value: 1 }] }] };
    const [[, formatter, trigger]] = tooltipFormatters(option);
    const html = formatter((trigger === 'axis' ? axisParams(option) : itemParams(option))[0]);
    assert.ok(html.includes(RAW));
});
