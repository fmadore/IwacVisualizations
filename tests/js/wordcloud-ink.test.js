'use strict';

// The word cloud's ink is the one place in this module where the series
// palette is used as TEXT rather than as a filled mark, and text has a
// contrast floor a bar does not: measured against the panel, 13 of the 20
// slots fall under 4.5:1 in light and a DIFFERENT 6 fall under it in dark.
// There is no subset that works in both, so `C.readableInks` computes the
// qualifying set per theme instead of carrying a list.
//
// That distinction is the whole point, and it is invisible in the source — a
// hardcoded array would look identical at a glance and be correct right up
// until the next palette edit. So it is asserted here: every colour the cloud
// can paint must clear 4.5:1 against the panel it paints on, in both themes,
// derived from tokens.json rather than from anything this module writes down.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'tokens.json'), 'utf8'));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const SOURCES = [
    ['iwac-i18n.js', read('asset', 'js', 'iwac-i18n.js')],
    ['panels.js', read('asset', 'js', 'charts', 'shared', 'panels.js')],
    ['chart-options.js', read('asset', 'js', 'charts', 'shared', 'chart-options.js')],
    // The bar builder the cloud falls back to when the plugin is missing.
    ['chart-options-hbar.js', read('asset', 'js', 'charts', 'shared', 'chart-options-hbar.js')],
    ['chart-options-special.js', read('asset', 'js', 'charts', 'shared', 'chart-options-special.js')],
];

/** Minimal zrender colour stub: `#rrggbb` and `rgb(r, g, b)` are all we emit. */
function parseColor(css) {
    if (typeof css !== 'string') return null;
    const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
    if (hex) {
        return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    }
    const fn = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(css.trim());
    if (fn) return [+fn[1], +fn[2], +fn[3], 1];
    return null;
}

function contrast(a, b) {
    const lum = (c) => {
        const v = c.slice(0, 3).map((x) => x / 255)
            .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function load(theme, init) {
    const palette = TOKENS.series[theme];
    const panelBg = TOKENS.values[theme]['--panel-bg'];
    const context = {
        console: { warn() {}, error() {} },
        Intl,
        setTimeout,
        clearTimeout,
        document: {
            createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
            documentElement: { getAttribute: () => 'en' },
            // `isWordCloudAvailable` probes by mounting a throwaway chart.
            body: { appendChild() {}, removeChild() {} },
        },
        echarts: {
            // Enough for the availability probe to succeed, so the test walks
            // the real word-cloud branch rather than its bar-chart fallback.
            init: init || (() => ({ setOption() {}, getOption: () => ({ series: [{}] }), dispose() {} })),
            color: {
                parse: parseColor,
                modifyAlpha: (c, a) => `alpha(${c},${a})`,
            },
        },
        window: {
            IWACVis: {
                readColorVar: (name) => name,
                getPalette: () => palette,
                getChartTokens: () => ({
                    panelBg,
                    primary: TOKENS[theme]['--primary'],
                    ink: TOKENS[theme]['--ink'],
                    inkStrong: TOKENS[theme]['--ink-strong'],
                    inkLight: TOKENS[theme]['--ink-light'],
                    surface: TOKENS[theme]['--surface'],
                    border: TOKENS[theme]['--border'],
                    fontFamily: '"Public Sans", sans-serif',
                }),
                getSeriesColor: (slot) => palette[
                    ((Number(slot) % palette.length) + palette.length) % palette.length
                ],
            },
        },
    };
    context.window.window = context.window;
    context.globalThis = context;
    vm.createContext(context);
    for (const [filename, src] of SOURCES) vm.runInContext(src, context, { filename });
    return {
        C: context.window.IWACVis.chartOptions,
        palette,
        panelBg,
    };
}

for (const theme of ['light', 'dark']) {
    test(`every word-cloud ink clears AA text contrast on the ${theme} panel`, () => {
        const { C, panelBg } = load(theme);
        const inks = C.readableInks(panelBg, TOKENS[theme]['--ink']);
        assert.ok(inks.length > 0, 'the cloud must always have something to paint with');
        for (const ink of inks) {
            const ratio = contrast(parseColor(ink), parseColor(panelBg));
            assert.ok(ratio >= 4.5,
                `${ink} is ${ratio.toFixed(2)}:1 on ${panelBg} — below the 4.5:1 text floor`);
        }
    });

    test(`the ${theme} ink set is exactly the slots that qualify — no more, no fewer`, () => {
        const { C, palette, panelBg } = load(theme);
        const inks = C.readableInks(panelBg, TOKENS[theme]['--ink']);
        // Computed independently here from tokens.json. If the module ever
        // starts carrying a list, this is what catches it: a slot that
        // qualifies but is missing is a silently narrowed palette, and a slot
        // that does not qualify but is present is unreadable type.
        const expected = palette.filter(
            (c) => contrast(parseColor(c), parseColor(panelBg)) >= 4.5);
        assert.deepEqual(inks, expected);
    });
}

test('the qualifying sets differ between themes, so neither can be hardcoded', () => {
    const light = load('light');
    const dark = load('dark');
    const l = light.C.readableInks(light.panelBg, TOKENS.light['--ink']);
    const d = dark.C.readableInks(dark.panelBg, TOKENS.dark['--ink']);
    assert.notDeepEqual(l, d,
        'if these ever coincide the computation is still right — but a list would look right too');
    assert.ok(l.length >= 3 && d.length >= 3,
        'a cloud painted from one or two hues has lost the variety it exists for');
});

const FIXTURE_PAIRS = JSON.parse(readFileSync(join(ROOT, 'tests', 'browser', 'fixtures', 'wordcloud.json'), 'utf8'));

for (const theme of ['light', 'dark']) {
    test(`the cloud colours by frequency band, the accent for the top few (${theme})`, () => {
        // Colour repeats what size says: one hue per band of frequency, never
        // one per word. The top words take the accent, then four equal bands
        // take four more hues, and every colour clears the text floor.
        const { C, panelBg } = load(theme);
        const t = TOKENS[theme];
        const tokens = { panelBg, primary: t['--primary'], ink: t['--ink'] };
        const data = Array.from({ length: 100 }, (_, i) => ({ name: 'w' + i, value: 1000 - i * 7 }));
        // Shuffled input: the bands follow the counts, not the order given.
        const shuffled = data.slice().sort((a, b) => (a.name < b.name ? -1 : 1));
        const inks = C.wordcloudInks(shuffled, tokens);
        const byWord = {};
        shuffled.forEach((d, i) => { byWord[d.name] = inks[i]; });
        const ranked = data.map((d) => byWord[d.name]);
        assert.deepEqual(ranked.slice(0, 4), Array(4).fill(t['--primary']), 'the top words take the accent');
        // Four bands of 24 below the accent: one colour each, all different.
        const bands = [0, 1, 2, 3].map((b) => ranked.slice(4 + b * 24, 4 + (b + 1) * 24));
        for (const band of bands) assert.equal(new Set(band).size, 1, 'one colour per band');
        const hues = [t['--primary'], ...bands.map((band) => band[0])];
        assert.equal(new Set(hues).size, 5, 'five bands, five colours');
        assert.ok(!hues.includes(t['--ink']), 'the bands are hues, not the text ink');
        for (const c of ranked) {
            assert.ok(contrast(parseColor(c), parseColor(panelBg)) >= 4.5, `${c} is under 4.5:1`);
        }
        // The render re-runs on every toggle and resize: same words, same colours.
        assert.deepEqual(C.wordcloudInks(shuffled, tokens), inks);
    });
}

test('without a readable palette the cloud is the accent alone, never empty', () => {
    const { C } = load('light');
    const inks = C.wordcloudInks([{ name: 'a', value: 2 }, { name: 'b', value: 1 }],
        { panelBg: '#7f7f7f', primary: '#000000', ink: '#000000' });
    assert.deepEqual(Array.from(inks), ['#000000', '#000000']);
});

test('readableInks still answers when nothing qualifies', () => {
    const { C } = load('light');
    // A backdrop mid-way between the extremes: no slot can clear 4.5:1 against
    // it. Degraded, but never empty — monochrome-and-readable beats a crash.
    const inks = C.readableInks('#7f7f7f', '#000000');
    assert.equal(inks.length, 1);
    assert.equal(inks[0], '#000000');
});

function boxes(option) {
    return option.series[0].data.map((d) => ({
        name: d.name,
        count: d.value[2],
        size: d.label.fontSize,
        x0: d.value[0] - d.symbolSize[0] / 2,
        x1: d.value[0] + d.symbolSize[0] / 2,
        y0: d.value[1] - d.symbolSize[1] / 2,
        y1: d.value[1] + d.symbolSize[1] / 2,
    }));
}

for (const [width, height] of [[900, 400], [560, 380], [344, 320]]) {
    test(`every word has its own box inside a ${width}x${height} panel`, () => {
        // The plugin's pixel packing let two words on one line touch, and in
        // the Albani cloud "malam" + "annabi" read as one Hausa word. Boxes
        // that never overlap, each carrying a margin, make the gap certain.
        const { C } = load('light');
        const option = C.wordcloud(FIXTURE_PAIRS, { width, height });
        const placed = boxes(option);
        assert.ok(placed.length >= 0.9 * FIXTURE_PAIRS.length, `${placed.length} of ${FIXTURE_PAIRS.length} words drawn`);
        for (let i = 0; i < placed.length; i++) {
            const a = placed[i];
            assert.ok(a.x0 >= 0 && a.y0 >= 0 && a.x1 <= width && a.y1 <= height, `${a.name} leaves the panel`);
            assert.ok(a.size >= 11, `${a.name} is under the 11px type floor`);
            for (let j = i + 1; j < placed.length; j++) {
                const b = placed[j];
                const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
                assert.ok(!overlap, `${a.name} and ${b.name} overlap`);
            }
        }
    });
}

test('size follows frequency, and the cloud fills its panel', () => {
    const { C } = load('light');
    const option = C.wordcloud(FIXTURE_PAIRS, { width: 900, height: 400 });
    const placed = boxes(option).sort((a, b) => b.count - a.count);
    for (let i = 1; i < placed.length; i++) {
        assert.ok(placed[i].size <= placed[i - 1].size + 1e-9, `${placed[i].name} outgrows a commoner word`);
    }
    // Area, not height, follows the count: two words whose counts differ
    // fourfold differ about twofold in size (until the cap or the floor).
    const x0 = Math.min(...placed.map((p) => p.x0));
    const x1 = Math.max(...placed.map((p) => p.x1));
    const y0 = Math.min(...placed.map((p) => p.y0));
    const y1 = Math.max(...placed.map((p) => p.y1));
    assert.ok(x1 - x0 > 0.85 * 900, 'the words span the panel width');
    assert.ok(y1 - y0 > 0.85 * 400, 'the words span the panel height');
});

test('the layout is the same every time, and is redone for a new size', () => {
    const { C } = load('light');
    const a = C.wordcloud(FIXTURE_PAIRS, { width: 700, height: 360 });
    const b = C.wordcloud(FIXTURE_PAIRS, { width: 700, height: 360 });
    assert.deepEqual(boxes(a), boxes(b));
    assert.deepEqual(Array.from(a.iwacSize), [700, 360]);
    const wider = a.iwacRelayout(1200, 500);
    assert.deepEqual(Array.from(wider.iwacSize), [1200, 500]);
    assert.ok(Math.max(...boxes(wider).map((p) => p.size)) > Math.max(...boxes(a).map((p) => p.size)),
        'a bigger panel sets bigger type');
});

test('a panel too small for every word drops some from the picture, none from the table', () => {
    const { C } = load('light');
    const pairs = Array.from({ length: 200 }, (_, i) => ['term' + i, 400 - i]);
    const option = C.wordcloud(pairs, { width: 240, height: 160 });
    assert.ok(option.series[0].data.length > 0 && option.series[0].data.length < 200);
    const rows = option.iwacRows();
    assert.equal(rows.rows.length, 200);
    assert.deepEqual(Array.from(rows.rows[0]), ['term0', 400]);
    assert.deepEqual(Array.from(rows.columns, (c) => c.numeric), [false, true]);
});

test('the words lie flat, in the theme face, and hover takes the strongest ink', () => {
    const { C } = load('light');
    const option = C.wordcloud([['alpha', 3], ['beta', 2]], { width: 400, height: 200 });
    const series = option.series[0];
    assert.equal(series.label.fontFamily, '"Public Sans", sans-serif');
    for (const d of series.data) {
        assert.equal(d.label.rotate, undefined);
        assert.equal(d.emphasis.label.color, TOKENS.light['--ink-strong']);
    }
    // The tooltip reads the count, not the scatter's pixel coordinates.
    assert.match(option.tooltip.formatter({ name: 'alpha', value: [10, 20, 3] }), /alpha<\/strong>: 3$/);
});

test('an empty word list is the shared empty state', () => {
    const { C } = load('light');
    const option = C.wordcloud([], { width: 400, height: 200 });
    assert.ok(!option.series || option.series.every((s) => s.type !== 'scatter'));
});
