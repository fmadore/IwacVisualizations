'use strict';

/**
 * The module's composed colour tokens follow the theme's manual toggle.
 *
 * The IWAC theme declares its light tokens on :root, its dark tokens on :root
 * under a dark OS preference, and BOTH again on body[data-theme] for the
 * reader's own light/dark switch (_colors.scss). A custom property whose value
 * holds a var() is substituted on the element that declares it, so the
 * module's ramps (`--iwac-vis-heatmap-*`, `-cent-*`, `-subj-*`, `-sent-*`) used
 * to be computed once on :root, from the OS scheme, and inherited frozen into
 * a body the reader had toggled the other way: a light-OS reader who chose
 * dark got the light heatmap ramp on dark panels. The tokens are now declared
 * on `:root, body`; this spec flips the toggle against the OS scheme both ways
 * and requires every composition to match what the same expression computes
 * inside the toggled body.
 */

const { test, expect } = require('@playwright/test');
const tokens = require('../../tokens.json');

const FIXTURE = '/tests/browser/fixtures/theme-toggle.html';

function block(theme) {
    return Object.entries(tokens[theme])
        .map(([name, value]) => `${name}: ${value};`)
        .join(' ');
}

/** The theme's colour cascade, reduced to its three selectors. */
const THEME_STAND_IN = [
    `:root { ${block('light')} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${block('dark')} } }`,
    `body[data-theme="dark"] { ${block('dark')} }`,
    `body[data-theme="light"] { ${block('light')} }`,
].join('\n');

/** Each module token and the expression it is declared as, theme-token side. */
const COMPOSED = {
    '--iwac-vis-heatmap-0': 'color-mix(in oklab, var(--primary) 8%, var(--surface))',
    '--iwac-vis-heatmap-2': 'color-mix(in oklab, var(--primary) 50%, var(--surface))',
    '--iwac-vis-cent-4': 'color-mix(in oklab, var(--primary) 30%, var(--surface))',
    '--iwac-vis-subj-1': 'color-mix(in oklab, var(--primary) 15%, var(--surface))',
    '--iwac-vis-sent-pos': 'color-mix(in oklab, var(--success) 55%, var(--surface))',
    '--iwac-vis-sent-neutral': 'var(--muted)',
    '--iwac-vis-sent-na': 'var(--border-light)',
};

for (const [os, toggled] of [['light', 'dark'], ['dark', 'light']]) {
    test(`a ${toggled} toggle on a ${os} OS repaints the module's composed tokens`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: os });
        await page.goto(FIXTURE);
        await page.addStyleTag({ content: THEME_STAND_IN });
        await page.evaluate((mode) => document.body.setAttribute('data-theme', mode), toggled);

        const seen = await page.evaluate((composed) => {
            const oracle = document.querySelector('.fixture-oracle');
            const panel = document.querySelector('.iwac-vis-panel');
            const out = {};
            for (const [name, expression] of Object.entries(composed)) {
                // What the module token paints on a panel…
                panel.style.outlineColor = `var(${name})`;
                const actual = getComputedStyle(panel).outlineColor;
                // …against the same expression computed in the toggled body.
                oracle.style.outlineColor = expression;
                const expected = getComputedStyle(oracle).outlineColor;
                out[name] = { actual, expected };
            }
            panel.style.outlineColor = '';
            return out;
        }, COMPOSED);

        for (const [name, { actual, expected }] of Object.entries(seen)) {
            expect(actual, `${name} on a ${os} OS with the ${toggled} toggle`).toBe(expected);
        }

        // And the ramp reads the right way round: the lowest heatmap bucket
        // sits next to the panel ground, not at the opposite end of the scale.
        const lowest = await page.evaluate(() => window.IWACVis.resolveCssVar('--iwac-vis-heatmap-0'));
        const surface = tokens[toggled]['--surface'];
        const lum = (rgb) => {
            const [r, g, b] = rgb.map((c) => {
                const s = c / 255;
                return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        const nums = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
        const [hi, lo] = [lum(nums(lowest)), lum(hex(surface))].sort((a, b) => b - a);
        expect((hi + 0.05) / (lo + 0.05), `heatmap-0 ${lowest} against the ${toggled} surface`).toBeLessThan(1.5);
    });
}
