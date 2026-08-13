'use strict';

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/associated-entities.html';

test('switches between the network and ranked relational list', async ({ page }) => {
    await page.goto(FIXTURE);

    const network = page.getByRole('button', { name: 'Network' });
    const list = page.getByRole('button', { name: 'Relational list' });
    await expect(network).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.fixture-force')).toBeVisible();

    await list.click();
    await expect(list).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.iwac-vis-arc-list__row')).toHaveCount(20);
    await expect(page.locator('.iwac-vis-arc-list__arc').first()).toHaveAttribute('d', /C/);
    await expect(page.locator('.fixture-force')).toBeHidden();

    await page.getByLabel('Number shown').selectOption('10');
    await expect(page.locator('.iwac-vis-arc-list__row')).toHaveCount(10);
});

test('filters both views with correctly ranked authority-type variants', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.getByRole('button', { name: 'Relational list' }).click();
    await page.getByRole('button', { name: /^Organisations 4$/ }).click();

    const rows = page.locator('.iwac-vis-arc-list__row');
    await expect(rows).toHaveCount(4);
    await expect(rows.first().getByRole('link')).toHaveText('Organisations 01');
    await expect(rows.first().getByRole('link')).toHaveAttribute('href', /\/s\/iwac\/item\/300$/);

    await page.getByRole('button', { name: 'Network' }).click();
    await expect(page.locator('.iwac-vis-associated__network')).toHaveAttribute(
        'data-variant',
        /Organisations/
    );
});

test('highlights the selected row and its relationship arcs', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.getByRole('button', { name: 'Relational list' }).click();

    const firstRow = page.locator('.iwac-vis-arc-list__row').first();
    await firstRow.hover();
    await expect(firstRow).toHaveClass(/iwac-vis-arc-list__row--active/);
    await expect(page.locator('.iwac-vis-arc-list__arc--active')).not.toHaveCount(0);

    await firstRow.getByRole('link').focus();
    await expect(firstRow).toHaveClass(/iwac-vis-arc-list__row--active/);
});

test('localizes the new controls in French', async ({ page }) => {
    await page.goto(`${FIXTURE}?lang=fr-FR`);
    await expect(page.getByRole('button', { name: 'Réseau' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Liste relationnelle' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Toutes 34$/ })).toBeVisible();
    await expect(page.getByLabel('Nombre affiché')).toBeVisible();
});

test('uses the exact list without decorative arcs on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.goto(`${FIXTURE}?theme=dark`);
    await page.getByRole('button', { name: 'Relational list' }).click();

    const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        arcsDisplay: getComputedStyle(document.querySelector('.iwac-vis-arc-list__arcs')).display,
        rowWidth: document.querySelector('.iwac-vis-arc-list__row').getBoundingClientRect().width,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.arcsDisplay).toBe('none');
    expect(layout.rowWidth).toBeGreaterThan(300);
});
