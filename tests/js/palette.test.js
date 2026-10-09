'use strict';

/**
 * The module's categorical colour choices, measured.
 *
 * Two scales are this module's decision: which series slot each country
 * takes (COUNTRY_MAP, charts/shared/chart-options.js), and the five model
 * accents it owns outright (--iwac-vis-model-1..5, iwac-core.css). Both were
 * picked by eye and both had pairs a reader could not tell apart — Bénin
 * beside Niger at ΔEok 0.054, two model blues at 0.059 (0.027 to a
 * deuteranope) — and a member under 3:1 on the panel. These tests hold every
 * pair to the bar the 2026-10 review set:
 *
 *   - at least 40° apart in OKLCH hue, or at least 0.1 apart in lightness in
 *     BOTH themes (a hue says nothing at low chroma, so hue only counts when
 *     both colours carry some);
 *   - at least 3:1 against the panel each is drawn on, light and dark.
 *
 * Colours come from tokens.json (the synced contract) and the stylesheet,
 * never from a copy in this file.
 */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'tokens.json'), 'utf8'));
const PANEL = {
    light: (TOKENS.values.light && TOKENS.values.light['--panel-bg']) || TOKENS.light['--surface'],
    dark: (TOKENS.values.dark && TOKENS.values.dark['--panel-bg']) || TOKENS.dark['--surface-raised'],
};

/* ---- colour maths (sRGB → OKLab / OKLCH, WCAG contrast, CVD) ---------- */

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function oklab(hex) {
    const [r, g, b] = rgb(hex).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}
function oklch(hex) {
    const [L, a, b] = oklab(hex);
    const h = (Math.atan2(b, a) * 180) / Math.PI;
    return { L, C: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}
function contrast(a, b) {
    const Y = (hex) => { const [r, g, bl] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
    const [hi, lo] = [Y(a), Y(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}
function deltaE(a, b) {
    const [x, y] = [oklab(a), oklab(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
// Machado et al. (2009), severity 1, on linear RGB.
const CVD = {
    deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
};
function simulate(hex, matrix) {
    const v = rgb(hex).map(lin);
    const out = matrix.map((row) => Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
    const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    return '#' + out.map((c) => Math.round(enc(c) * 255).toString(16).padStart(2, '0')).join('');
}

/** Why two colours fail the separation bar in one theme, or null. */
function apart(a, b) {
    const [x, y] = [oklch(a), oklch(b)];
    let dh = Math.abs(x.h - y.h) % 360;
    dh = Math.min(dh, 360 - dh);
    const hueCounts = x.C > 0.04 && y.C > 0.04;
    if ((hueCounts && dh >= 40) || Math.abs(x.L - y.L) >= 0.1) return null;
    return `hue ${dh.toFixed(0)}° apart, lightness ${Math.abs(x.L - y.L).toFixed(3)} apart`;
}

/* ---- countries ------------------------------------------------------- */

function countryMap() {
    const context = { console, window: { IWACVis: { panels: {}, t: (k) => k, formatNumber: String, locale: 'en' } } };
    vm.createContext(context);
    vm.runInContext(readFileSync(join(ROOT, 'asset/js/charts/shared/chart-options.js'), 'utf8'), context);
    const map = context.window.IWACVis.chartOptions.COUNTRY_MAP;
    const byCountry = {};
    for (const [name, slot] of Object.entries(map)) {
        // One entry per country: the accented spelling, where there are two.
        const key = name.normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (!(key in byCountry) || name !== key) byCountry[key] = { name, slot };
    }
    return Object.values(byCountry);
}

/**
 * Contrast shortfalls the THEME has already fixed upstream and this repo has
 * not synced yet: IWAC-theme's "Lift every series slot to 3:1 on all four
 * surfaces" raises dark --series-7 and light --series-14. Self-retiring — an
 * entry whose colour now clears 3:1 fails the test until it is deleted, so
 * the list goes when the contract sync lands.
 */
const PENDING_THEME_LIFT = new Set(['Burkina Faso:dark', 'Sénégal:light']);

test('no two countries are colours a reader cannot tell apart, in either theme', () => {
    const countries = countryMap();
    assert.equal(countries.length, 7);
    assert.equal(new Set(countries.map((c) => c.slot)).size, 7, 'two countries share a slot');
    const failures = [];
    for (const theme of ['light', 'dark']) {
        const scale = TOKENS.series[theme];
        for (let i = 0; i < countries.length; i++) {
            for (let j = i + 1; j < countries.length; j++) {
                const why = apart(scale[countries[i].slot], scale[countries[j].slot]);
                if (why) failures.push(`${theme}: ${countries[i].name} / ${countries[j].name} — ${why}`);
            }
        }
    }
    assert.deepEqual(failures, []);
});

test('every country colour reads at 3:1 on the panel, in both themes', () => {
    const failures = [];
    const retired = [];
    for (const { name, slot } of countryMap()) {
        for (const theme of ['light', 'dark']) {
            const ratio = contrast(TOKENS.series[theme][slot], PANEL[theme]);
            const key = `${name}:${theme}`;
            if (ratio < 3 && !PENDING_THEME_LIFT.has(key)) failures.push(`${key} ${ratio.toFixed(2)}:1`);
            if (ratio >= 3 && PENDING_THEME_LIFT.has(key)) retired.push(key);
        }
    }
    assert.deepEqual(failures, []);
    assert.deepEqual(retired, [], 'the synced contract fixed these — delete them from PENDING_THEME_LIFT');
});

test('countries stay off the admin-tunable lead slots', () => {
    // --series-1/2 alias --primary/--secondary, which an admin can retune; a
    // country there would change colour with the brand seed.
    for (const { name, slot } of countryMap()) {
        assert.ok(slot >= TOKENS.series.leadSlots, `${name} sits on lead slot ${slot}`);
    }
});

/* ---- model accents --------------------------------------------------- */

function modelAccents() {
    const css = readFileSync(join(ROOT, 'asset/css/iwac-core.css'), 'utf8');
    const out = [];
    for (let n = 1; n <= 5; n++) {
        const m = new RegExp(`--iwac-vis-model-${n}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
        assert.ok(m, `--iwac-vis-model-${n} is not a #rrggbb literal`);
        out.push(m[1].toLowerCase());
    }
    return out;
}

test('the five model accents are apart for every reader, and read on both panels', () => {
    const accents = modelAccents();
    const failures = [];
    for (let i = 0; i < 5; i++) {
        for (const theme of ['light', 'dark']) {
            const ratio = contrast(accents[i], PANEL[theme]);
            if (ratio < 3) failures.push(`model-${i + 1} on the ${theme} panel: ${ratio.toFixed(2)}:1`);
        }
        for (let j = i + 1; j < 5; j++) {
            const why = apart(accents[i], accents[j]);
            if (why) failures.push(`model-${i + 1} / model-${j + 1}: ${why}`);
            // The one chart that draws all five is a line chart: two lines a
            // colour-blind reader sees as one are one line.
            for (const [kind, matrix] of Object.entries(CVD)) {
                const d = deltaE(simulate(accents[i], matrix), simulate(accents[j], matrix));
                if (d < 0.08) failures.push(`model-${i + 1} / model-${j + 1} under ${kind}: ΔEok ${d.toFixed(3)}`);
            }
        }
    }
    assert.deepEqual(failures, []);
});
