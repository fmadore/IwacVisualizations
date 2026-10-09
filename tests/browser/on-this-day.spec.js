'use strict';

/**
 * On This Day, as the homepage serves it: no chart library, the theme's
 * switch grammar, and a section rule rather than a panel box.
 *
 * The almanac is pure DOM, but `echarts` is the one asset need that defaults
 * ON, so the homepage — where this is the only module block — downloaded
 * ECharts (359 KB) for nothing. The template now declares it off; this
 * fixture loads exactly what that template loads and must render.
 */

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/on-this-day.html';

function contrastOf(page, selector) {
    return page.evaluate((sel) => {
        const ctx = document.createElement('canvas').getContext('2d');
        const rgba = (color) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        };
        const lum = (rgb) => {
            const c = rgb.slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
            return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        const el = document.querySelector(sel);
        let bgEl = el;
        let bg = 'rgba(0, 0, 0, 0)';
        while (bgEl && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
            bg = getComputedStyle(bgEl).backgroundColor;
            bgEl = bgEl.parentElement;
        }
        const style = getComputedStyle(el);
        const [x, y] = [lum(rgba(style.color)), lum(rgba(bg))].sort((a, b) => b - a);
        return { ratio: (x + 0.05) / (y + 0.05), opacity: style.opacity };
    }, selector);
}

for (const theme of ['light', 'dark']) {
    test(`renders without ECharts and keeps its switch counts readable (${theme})`, async ({ page }) => {
        await page.goto(`${FIXTURE}?theme=${theme}`);
        await expect(page.locator('.iwac-vis-otd-panel')).toBeVisible();
        expect(await page.evaluate(() => typeof window.echarts)).toBe('undefined');
        await expect(page.locator('.iwac-vis-otd-register__row, .iwac-vis-otd-body > *').first()).toBeVisible();

        // V-07: the calendar counts are --muted itself, not faded ink.
        const hint = await contrastOf(page, '.iwac-vis-otd-switch__hint');
        expect(hint.opacity).toBe('1');
        expect(hint.ratio, 'switch count contrast').toBeGreaterThanOrEqual(4.5);
    });
}

test('switches are outlined chips, never pills', async ({ page }) => {
    await page.goto(FIXTURE);
    const radii = await page.locator('.iwac-vis-otd-switch .iwac-vis-facets__btn')
        .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).borderTopLeftRadius));
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) expect(parseFloat(r)).toBeLessThanOrEqual(8);

    // A layout switch still switches.
    await page.getByRole('button', { name: 'Clippings' }).click();
    await expect(page.locator('.iwac-vis-otd-body--clippings')).toHaveCount(1);
});

test('opens on the section rule, without a panel box, and keeps the embed control off it', async ({ page }) => {
    await page.goto(FIXTURE);
    await expect(page.locator('.iwac-vis-otd-panel')).toBeVisible();
    const box = await page.evaluate(() => {
        const panel = document.querySelector('.iwac-vis-otd-panel');
        const style = getComputedStyle(panel);
        const rule = panel.querySelector(':scope > h2');
        return {
            border: style.borderTopWidth,
            shadow: style.boxShadow,
            rule: getComputedStyle(rule).borderTopWidth,
        };
    });
    expect(box.border).toBe('0px');
    expect(box.shadow).toBe('none');
    expect(box.rule).toBe('2px');

    // The copy-embed control closes the block instead of sitting on the rule.
    const toolbar = page.locator('.iwac-vis-otd-panel > .iwac-vis-panel-toolbar');
    await expect(toolbar).toHaveCount(1);
    const geometry = await page.evaluate(() => {
        const panel = document.querySelector('.iwac-vis-otd-panel');
        const rule = panel.querySelector(':scope > h2').getBoundingClientRect();
        const bar = panel.querySelector(':scope > .iwac-vis-panel-toolbar').getBoundingClientRect();
        return { ruleTop: rule.top, barTop: bar.top, barBottom: bar.bottom, ruleBottom: rule.bottom };
    });
    expect(geometry.barTop).toBeGreaterThan(geometry.ruleBottom);
});

test('the French page loads the French bundle and its switches', async ({ page }) => {
    await page.goto(`${FIXTURE}?lang=fr`);
    await expect(page.getByRole('button', { name: 'Coupures' })).toBeVisible();
    await expect(page.locator('.iwac-vis-otd-panel > h2')).toContainText('Ce jour-là');
    expect(await page.evaluate(() => typeof window.echarts)).toBe('undefined');
});
