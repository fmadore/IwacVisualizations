'use strict';

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/associated-entities.html';

test('switches between the network and ranked relational list', async ({ page }) => {
    await page.goto(FIXTURE);

    const network = page.getByRole('button', { name: 'Network' });
    const list = page.getByRole('button', { name: 'Relational list' });
    await expect(page.getByRole('button', { name: 'Over time' })).toBeVisible();
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

test('compares ranked entities across five-year periods or decades', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.getByRole('button', { name: 'Over time' }).click();

    await expect(page.getByLabel('Period')).toHaveValue('5');
    await expect(page.locator('.iwac-vis-time-matrix__table tbody tr')).toHaveCount(10);
    await expect(page.locator('.iwac-vis-time-matrix__period-head')).toHaveCount(7);
    await expect(page.locator('.iwac-vis-time-matrix__caveat')).toContainText('2');
    await expect(page.locator('.iwac-vis-time-matrix__cell').first()).toHaveAttribute(
        'aria-label',
        /shared items, 1990–1994/
    );

    await page.getByLabel('Period').selectOption('10');
    await expect(page.locator('.iwac-vis-time-matrix__period-head')).toHaveCount(4);
    await expect(page.locator('.iwac-vis-time-matrix__period-head').first()).toContainText('1990s');

    await page.getByRole('button', { name: /^Organisations 4$/ }).click();
    await expect(page.locator('.iwac-vis-time-matrix__table tbody tr')).toHaveCount(4);
    await expect(page.locator('.iwac-vis-time-matrix__name').first()).toHaveText('Organisations 01');
});

test('keeps the two established views when an older payload has no timeline', async ({ page }) => {
    await page.goto(`${FIXTURE}?legacy=1`);
    await expect(page.getByRole('button', { name: 'Network' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Relational list' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Over time' })).toHaveCount(0);
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
    await expect(page.getByRole('button', { name: 'Dans le temps' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Toutes 34$/ })).toBeVisible();
    await expect(page.getByLabel('Nombre affiché')).toBeVisible();
    await page.getByRole('button', { name: 'Dans le temps' }).click();
    await expect(page.getByLabel('Période')).toBeVisible();
});

test('lines every control up on one label gutter and holds its height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(FIXTURE);

    const readBar = () => page.evaluate(() => {
        const bar = document.querySelector('.iwac-vis-associated__controls');
        const labels = [...bar.querySelectorAll('.iwac-vis-associated__control-label')];
        return {
            height: Math.round(bar.getBoundingClientRect().height),
            lefts: labels.map((el) => Math.round(el.getBoundingClientRect().left)),
            tops: labels.map((el) => Math.round(el.getBoundingClientRect().top)),
        };
    });

    // View, entity type and top-N: one gutter column, one row each.
    const network = await readBar();
    expect(network.lefts).toHaveLength(3);
    expect(new Set(network.lefts).size).toBe(1);
    expect(new Set(network.tops).size).toBe(3);

    // The period select joins the top-N row, so no view switch reflows the bar.
    await page.getByRole('button', { name: 'Over time' }).click();
    await expect(page.getByLabel('Period')).toBeVisible();
    const time = await readBar();
    expect(time.tops).toEqual(network.tops);
    expect(time.height).toBe(network.height);
});

test('keeps the temporal matrix inside a horizontal scroller on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.goto(`${FIXTURE}?theme=dark`);
    await page.getByRole('button', { name: 'Over time' }).click();

    const layout = await page.evaluate(() => {
        const scroller = document.querySelector('.iwac-vis-time-matrix__scroll');
        return {
            viewport: document.documentElement.clientWidth,
            documentWidth: document.documentElement.scrollWidth,
            clientWidth: scroller.clientWidth,
            scrollWidth: scroller.scrollWidth,
        };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
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
