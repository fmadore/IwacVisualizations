'use strict';

/**
 * The embed route renders without the theme's stylesheet.
 *
 * Every `var(--token, fallback)` in iwac-core.css therefore painted its LIGHT
 * fallback there, and `?theme=dark` only lightened the brand accent — so a
 * dark embed put light panels under charts that `iwac-theme.js`, seeing
 * `data-theme="dark"`, drew with its dark ink (#e7e4df): about 1.2:1.
 * asset/css/iwac-embed-tokens.css, generated from tokens.json, is the fix;
 * these tests hold the three things it has to guarantee: the panel paints the
 * theme's own value in each mode, the chart tokens and the CSS agree about the
 * ground, and the per-request brand accent still wins over the sheet.
 */

const { test, expect } = require('@playwright/test');
const tokens = require('../../tokens.json');

const FIXTURE = '/tests/browser/fixtures/embed-tokens.html';

/** A token's canonical value: colour map first, then `values` (--panel-bg lives there). */
function canon(theme, name) {
    return tokens[theme][name] || tokens.values[theme][name];
}

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255})`;
}

for (const theme of ['light', 'dark']) {
    test(`a ${theme} embed paints the theme's own ${theme} panel and ink`, async ({ page }) => {
        await page.goto(`${FIXTURE}?theme=${theme}`);
        const seen = await page.evaluate(() => {
            const panel = document.querySelector('.iwac-vis-panel');
            const chart = window.IWACVis.getChartTokens();
            return {
                panelBg: getComputedStyle(panel).backgroundColor,
                text: getComputedStyle(panel.querySelector('.fixture-text')).color,
                chartInk: chart.ink,
                chartPanelBg: chart.panelBg,
                chartText: window.contrast(chart.ink, getComputedStyle(panel).backgroundColor),
                sameGround: window.rgbOf(chart.panelBg).join() === window.rgbOf(getComputedStyle(panel).backgroundColor).join(),
            };
        });
        expect(seen.panelBg).toBe(hexToRgb(canon(theme, '--panel-bg')));
        expect(seen.text).toBe(hexToRgb(canon(theme, '--ink')));
        // The charts and the CSS must agree about the ground they share.
        expect(seen.sameGround, `chart panelBg ${seen.chartPanelBg} vs CSS ${seen.panelBg}`).toBe(true);
        expect(seen.chartText, 'chart ink on the panel it is drawn over').toBeGreaterThanOrEqual(4.5);
    });
}

/**
 * A brand seed is derived the way the theme derives its own: the light
 * primary is the seed 8 % toward black, the dark one 12 % toward white. The
 * embed used to paint the raw seed, so a stock site's embeds carried #e64a19
 * beside the canonical #ce4115. Each expectation is the browser's own
 * computation of the theme's expression, read off a probe.
 */
async function resolved(page, expression) {
    return page.evaluate((value) => {
        const probe = document.createElement('span');
        document.body.appendChild(probe);
        probe.style.color = value;
        const out = getComputedStyle(probe).color;
        probe.remove();
        return out;
    }, expression);
}

test('a per-request brand seed is derived like the theme’s, in both modes', async ({ page }) => {
    await page.goto(`${FIXTURE}?theme=light&primary=%23123456`);
    const light = await resolved(page, 'var(--primary)');
    expect(light).toBe(await resolved(page, 'color-mix(in oklab, #123456, black 8%)'));
    expect(light).not.toBe(await resolved(page, '#123456'));
    // The tokens composed from it follow, rather than keep the stock orange.
    expect(await resolved(page, 'var(--focus-color)')).toBe(light);
    expect(await resolved(page, 'var(--type-article)')).toBe(light);

    await page.goto(`${FIXTURE}?theme=dark&primary=%23123456`);
    const dark = await resolved(page, 'var(--primary)');
    expect(dark).toBe(await resolved(page, 'color-mix(in oklab, #123456, white 12%)'));
    expect(await resolved(page, 'var(--focus-color)')).toBe(dark);
});

test('without a seed the embed paints the theme’s own primary, not the raw seed', async ({ page }) => {
    for (const theme of ['light', 'dark']) {
        await page.goto(`${FIXTURE}?theme=${theme}`);
        expect(await resolved(page, 'var(--primary)')).toBe(hexToRgb(canon(theme, '--primary')));
    }
});

test('the source footer reads against its own ground in dark mode', async ({ page }) => {
    await page.goto(`${FIXTURE}?theme=dark`);
    const ratio = await page.evaluate(() => {
        const footer = document.querySelector('.iwac-embed-source');
        return window.contrast(getComputedStyle(footer.querySelector('a')).color, getComputedStyle(footer).backgroundColor);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
});
