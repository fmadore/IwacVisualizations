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

for (const theme of ['light', 'dark']) {
    test(`the cloud is one ink ramp by frequency, primary for the top few (${theme})`, () => {
        // V-11: the cloud cycled five series hues word by word, which encoded
        // nothing — size already carries frequency. Colour now says the same
        // thing in the theme's inks, and every step clears the text floor.
        const { C, panelBg } = load(theme);
        const t = TOKENS[theme];
        const pairs = Array.from({ length: 100 }, (_, i) => ['w' + i, 1000 - i * 7]);
        // Shuffled input: the ramp follows the counts, not the order given.
        const shuffled = pairs.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const option = C.wordcloud(shuffled);
        const byWord = {};
        for (const d of option.series[0].data) byWord[d.name] = d.textStyle.color;
        const ranked = pairs.map(([w]) => byWord[w]);
        assert.deepEqual(ranked.slice(0, 4), Array(4).fill(t['--primary']), 'the top words take the accent');
        assert.equal(ranked[4], t['--ink-strong']);
        assert.equal(ranked[99], t['--ink-light']);
        const allowed = [t['--primary'], t['--ink-strong'], t['--ink'], t['--ink-light']];
        for (const c of ranked) {
            assert.ok(allowed.includes(c), `${c} is not on the ink ramp`);
            assert.ok(contrast(parseColor(c), parseColor(panelBg)) >= 4.5, `${c} is under 4.5:1`);
        }
        // Emphasis never rises as frequency falls.
        const weight = (c) => allowed.indexOf(c);
        for (let i = 1; i < ranked.length; i++) assert.ok(weight(ranked[i]) >= weight(ranked[i - 1]));
        // The render callback re-runs on every toggle and resize: same words, same inks.
        assert.deepEqual(C.wordcloud(shuffled).series[0].data.map((d) => d.textStyle.color),
            option.series[0].data.map((d) => d.textStyle.color));
    });
}

test('the words lie flat and in the theme face', () => {
    const { C } = load('light');
    const series = C.wordcloud([['alpha', 3], ['beta', 2]]).series[0];
    assert.deepEqual(Array.from(series.rotationRange), [0, 0]);
    assert.equal(series.textStyle.fontFamily, '"Public Sans", sans-serif');
});

test('readableInks still answers when nothing qualifies', () => {
    const { C } = load('light');
    // A backdrop mid-way between the extremes: no slot can clear 4.5:1 against
    // it. Degraded, but never empty — monochrome-and-readable beats a crash.
    const inks = C.readableInks('#7f7f7f', '#000000');
    assert.equal(inks.length, 1);
    assert.equal(inks[0], '#000000');
});

test('a missing echarts-wordcloud plugin falls back to a bar chart', () => {
    // What the production ECharts build does with a series type nobody
    // registered: it accepts the option, drops the series and does not throw.
    // The probe used to test only for the throw, so it always said "available".
    const { C } = load('light', () => ({
        setOption() {},
        getOption: () => ({ series: [] }),
        dispose() {},
    }));
    const option = C.wordcloud([['alpha', 3], ['beta', 2]]);
    assert.ok(option.series.every((s) => s.type !== 'wordCloud'),
        'an unregistered wordCloud series paints nothing, so it must not be emitted');
    assert.equal(option.series[0].type, 'bar');
});
