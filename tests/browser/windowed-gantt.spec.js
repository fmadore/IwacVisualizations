'use strict';

/**
 * P.buildWindowedGantt, through the newspaper Gantt panel that uses it
 * (the index activity Gantt and the periodical runs Gantt share it): the
 * row window is stated, the button escapes it, the host is sized from the
 * rows on screen in both states, and a facet that leaves fewer rows than
 * the window collapses the disclosure.
 */

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/windowed-gantt.html';
// C.ganttHeight: 18px a row plus 96px of chrome, never below the 320px floor.
const height = (rows) => Math.max(320, rows * 18 + 96);

async function ready(page) {
    const problems = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    await page.goto(FIXTURE);
    await page.waitForFunction(() => window.__ready);
    await expect(page.locator('.iwac-vis-chart canvas').first()).toBeVisible();
    return problems;
}

const host = (page) => page.locator('.iwac-vis-panel .iwac-vis-chart');
const hostHeight = (page) => host(page).evaluate((el) => el.getBoundingClientRect().height);
const note = (page) => page.locator('.iwac-vis-window-note__text');
const toggle = (page) => page.locator('.iwac-vis-window-note__toggle');

test('states its window, escapes it, and sizes the host from the rows shown', async ({ page }) => {
    const problems = await ready(page);
    // Disclosure, then the country key, then the chart.
    const order = await page.locator('.iwac-vis-panel').evaluate((panel) =>
        Array.from(panel.children).map((el) => el.className.split(' ')[0]));
    expect(order.indexOf('iwac-vis-window-note')).toBeLessThan(order.indexOf('iwac-vis-key'));
    expect(order.indexOf('iwac-vis-key')).toBeLessThan(order.indexOf('iwac-vis-chart'));

    await expect(note(page)).toContainText('20');
    await expect(note(page)).toContainText('30');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    expect(await hostHeight(page)).toBe(height(20));

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => hostHeight(page)).toBe(height(30));
    // The canvas follows the host at once (resize before setOption).
    expect(await page.locator('.iwac-vis-chart canvas').first().evaluate((c) => c.getBoundingClientRect().height))
        .toBe(height(30));

    // A theme swap redraws through the same path and keeps the state.
    await page.evaluate(() => { document.body.dataset.theme = 'dark'; });
    await page.waitForTimeout(300);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    expect(await hostHeight(page)).toBe(height(30));

    await toggle(page).click();
    await expect.poll(() => hostHeight(page)).toBe(height(20));
    expect(problems).toEqual([]);
});

test('a facet that fits the window collapses the disclosure; the volume view adds its legend', async ({ page }) => {
    const problems = await ready(page);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');

    await page.locator('select').first().selectOption('Togo');
    await expect(page.locator('.iwac-vis-window-note')).toBeHidden();
    await expect.poll(() => hostHeight(page)).toBe(height(6));

    await page.locator('select').first().selectOption('__all__');
    await expect(page.locator('.iwac-vis-window-note')).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => hostHeight(page)).toBe(height(20));

    await page.getByRole('button', { name: 'Items per year' }).click();
    await expect.poll(() => hostHeight(page)).toBe(height(20) + 32);
    expect(problems).toEqual([]);
});
