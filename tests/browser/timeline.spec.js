'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const tokens = require('../../tokens.json');
const URL = '/tests/browser/fixtures/timeline.html';

/** A tokens.json hex colour as getComputedStyle prints it. */
function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Switch the theme and wait until the page has finished repainting for it.
 *
 * Every timeline button eases its background over --transition-fast (150ms)
 * while its text colour flips at once, so an axe scan that starts inside that
 * window reads the dark ink on a still-light ground (1.23:1 on the markers)
 * and fails: under a loaded run it did. Wait for every running transition to
 * finish, then for a marker to show the theme's own --surface.
 */
async function switchTheme(page, root, theme) {
    await page.evaluate(value => { document.body.dataset.theme = value; }, theme);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
    await expect(root.locator('.iwac-vis-timeline__marker').first())
        .toHaveCSS('background-color', rgb(tokens[theme]['--surface']));
}

async function ready(page, suffix = '') {
    await page.route('https://example.org/**', route => route.abort());
    await page.goto(URL + suffix);
    await expect(page.locator('[data-instance="block-1"]')).toHaveAttribute('data-timeline-ready', 'true');
    return page.locator('[data-instance="block-1"]');
}

test('narrative order, chronological reading view, keyboard, print and theme state', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const root = await ready(page);
    await expect(root.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'intro');
    await root.getByRole('button', { name: 'Next event', exact: true }).click();
    await expect(root.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'later');
    await root.locator('.iwac-vis-timeline__events').focus();
    await page.keyboard.press('ArrowRight');
    await expect(root.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'range');
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect(root.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'range');
    // A key outside the timeline cannot advance it.
    await page.keyboard.press('ArrowRight');
    await expect(root.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'range');
    await root.getByRole('button', { name: 'All events', exact: true }).click();
    expect(await root.locator('[data-event-id]:visible').evaluateAll(nodes => nodes.map(n => n.dataset.eventId)))
        .toEqual(['intro', 'range', 'first', 'same', 'later']);
    await root.getByRole('button', { name: 'Narrative', exact: true }).click();
    await page.emulateMedia({ media: 'print' });
    await expect(root.locator('[data-event-id]:visible')).toHaveCount(5);
    await expect(root.locator('.iwac-vis-timeline__controls')).toBeHidden();
    expect(await page.evaluate(() => typeof window.echarts)).toBe('undefined');
    expect(errors).toEqual([]);
});

test('deep links distinguish repeated instances and respond to hash changes', async ({ page }) => {
    const first = await ready(page, '#timeline=history&slide=first&block=block-2');
    const second = page.locator('[data-instance="block-2"]');
    await expect(first.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'intro');
    await expect(second.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'first');
    await page.evaluate(() => { location.hash = 'timeline=history&slide=range&block=block-1'; });
    await expect(first.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'range');
    await expect(second.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'first');
    await first.locator('[data-timeline-marker="first"]').click();
    await page.keyboard.press('End');
    await expect(first.locator('[aria-current="step"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'intro');
    await expect(first.locator('.iwac-vis-timeline__events')).toBeFocused();
});

test('mobile targets, swipe, reduced motion and no horizontal page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const root = await ready(page);
    const stage = root.locator('.iwac-vis-timeline__events');
    await stage.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 100 });
    await stage.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 100, clientY: 105 });
    await expect(root.locator('[data-event-id]:visible')).toHaveAttribute('data-event-id', 'later');
    const targets = await root.locator('button:visible, select:visible').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect(); return { w: box.width, h: box.height };
    }));
    expect(targets.every(box => box.w >= 44 && box.h >= 44)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await root.locator('[data-timeline-marker="later"]').evaluate(node => parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThanOrEqual(0.001);
});

test('complete reading view and native links work with JavaScript disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route('https://example.org/**', route => route.abort());
    await page.goto('http://127.0.0.1:4187' + URL);
    const root = page.locator('[data-instance="block-1"]');
    await expect(root.locator('[data-event-id]:visible')).toHaveCount(5);
    await expect(root.locator('.iwac-vis-timeline__controls')).toHaveCount(0);
    await expect(root.locator('[data-event-link="first"]')).toHaveAttribute('href', '#block-1-first');
    await root.locator('[data-event-link="first"]').click();
    await expect(page).toHaveURL(/#block-1-first$/);
    await context.close();
});

for (const theme of ['light', 'dark']) {
    test(`timeline accessible in ${theme} mode, including ranges and failed media`, async ({ page }) => {
        const root = await ready(page, '#timeline=history&slide=range');
        await switchTheme(page, root, theme);
        await expect(root.locator('.iwac-vis-timeline__image-link')).toContainText('Archival page');
        const result = await new AxeBuilder({ page }).include('[data-instance="block-1"]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(result.violations).toEqual([]);
    });
}
