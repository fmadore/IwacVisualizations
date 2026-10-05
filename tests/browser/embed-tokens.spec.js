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

test('the per-request brand accent outranks the token sheet in both modes', async ({ page }) => {
    await page.goto(`${FIXTURE}?theme=light&primary=%23123456`);
    const light = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--primary').trim());
    expect(light).toBe('#123456');

    await page.goto(`${FIXTURE}?theme=dark&primary=%23123456`);
    const dark = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--primary').trim());
    // Lightened for dark (iwac-embed.css), never the sheet's own dark primary.
    expect(dark).not.toBe(canon('dark', '--primary'));
    expect(dark).toContain('color-mix');
});

test('the source footer reads against its own ground in dark mode', async ({ page }) => {
    await page.goto(`${FIXTURE}?theme=dark`);
    const ratio = await page.evaluate(() => {
        const footer = document.querySelector('.iwac-embed-source');
        return window.contrast(getComputedStyle(footer.querySelector('a')).color, getComputedStyle(footer).backgroundColor);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
});
