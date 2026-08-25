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

function load(theme) {
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
            init: () => ({ setOption() {}, dispose() {} }),
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
                    ink: TOKENS[theme]['--ink'],
                    inkStrong: TOKENS[theme]['--ink-strong'],
                    surface: TOKENS[theme]['--surface'],
                    border: TOKENS[theme]['--border'],
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

test('word colours are assigned by rank, not at random', () => {
    const { C, panelBg } = load('light');
    const pairs = Array.from({ length: 24 }, (_, i) => ['w' + i, 24 - i]);
    const first = C.wordcloud(pairs);
    const second = C.wordcloud(pairs);
    const colours = (opt) => (opt.series[0].data || []).map((d) => d.textStyle.color);
    // The render callback re-runs on every theme toggle and every resize. A
    // cloud that reshuffles its colours each time reads as a bug, and the
    // random pick this replaced did exactly that.
    assert.deepEqual(colours(first), colours(second));

    const inks = C.readableInks(panelBg, TOKENS.light['--ink']);
    assert.deepEqual(colours(first).slice(0, inks.length), inks,
        'the first N words walk the qualifying set in order');
    for (const c of colours(first)) {
        assert.ok(inks.includes(c), `${c} is not one of the qualifying slots`);
    }
});

test('readableInks still answers when nothing qualifies', () => {
    const { C } = load('light');
    // A backdrop mid-way between the extremes: no slot can clear 4.5:1 against
    // it. Degraded, but never empty — monochrome-and-readable beats a crash.
    const inks = C.readableInks('#7f7f7f', '#000000');
    assert.equal(inks.length, 1);
    assert.equal(inks[0], '#000000');
});
