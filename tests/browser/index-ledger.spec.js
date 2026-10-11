'use strict';

/**
 * The Index Overview's "All index entries" ledger.
 *
 * It replaced a five-column table whose Countries column took the width the
 * other four needed: "Places" broke over two lines and "6447" over two more,
 * on desktop as well as on a phone. What these tests hold is that no field is
 * squeezed again — the count stays on one line, nothing leaves the panel —
 * that the ledger uses the width it has, and that paging and search keep the
 * list's numbering and its announced count honest.
 */

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/index-ledger.html';
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };

for (const theme of ['light', 'dark']) {
    test(`no field is squeezed on a 375 px phone (${theme})`, async ({ page }) => {
        await page.setViewportSize(PHONE);
        await page.goto(`${FIXTURE}?theme=${theme}`);
        await expect(page.locator('.iwac-vis-index-ledger__row').first()).toBeVisible();

        const layout = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.iwac-vis-index-ledger__row')];
            const lineHeight = (el) => parseFloat(getComputedStyle(el).fontSize) * 1.6;
            return {
                docOverflow: document.documentElement.scrollWidth - window.innerWidth,
                columns: getComputedStyle(document.querySelector('.iwac-vis-index-ledger')).columnCount,
                // A count or a type label that wraps is the old failure.
                wrappedCounts: rows.filter((r) => {
                    const c = r.querySelector('.iwac-vis-index-ledger__count');
                    return c.getBoundingClientRect().height > lineHeight(c);
                }).length,
                wrappedTypes: rows.filter((r) => {
                    const t = r.querySelector('.iwac-vis-index-ledger__type');
                    return t.getBoundingClientRect().height > lineHeight(t);
                }).length,
                outside: rows.filter((r) => {
                    const box = r.getBoundingClientRect();
                    return [...r.querySelectorAll('*')].some((el) => el.getBoundingClientRect().right > box.right + 0.5);
                }).length,
            };
        });

        expect(layout.docOverflow).toBeLessThanOrEqual(0);
        expect(layout.columns).toBe('auto');
        expect(layout.wrappedCounts).toBe(0);
        expect(layout.wrappedTypes).toBe(0);
        expect(layout.outside).toBe(0);
    });
}

test('a desktop panel sets the ledger in two columns, read down the first', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(FIXTURE);
    await expect(page.locator('.iwac-vis-index-ledger__row').first()).toBeVisible();

    const columns = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.iwac-vis-index-ledger__row')];
        const lefts = [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().left)))];
        return {
            count: getComputedStyle(document.querySelector('.iwac-vis-index-ledger')).columnCount,
            lefts: lefts.length,
            // Column-major: the second record sits under the first.
            secondUnderFirst: Math.round(rows[1].getBoundingClientRect().left) === Math.round(rows[0].getBoundingClientRect().left),
        };
    });
    expect(columns.count).toBe('2');
    expect(columns.lefts).toBe(2);
    expect(columns.secondUnderFirst).toBe(true);
});

test('a record carries type, years, title, countries and its count', async ({ page }) => {
    await page.goto(FIXTURE);
    const first = page.locator('.iwac-vis-index-ledger__row').first();
    await expect(first.locator('.iwac-vis-index-ledger__type')).toHaveText('Places·');
    await expect(first.locator('.iwac-vis-index-ledger__type')).toHaveClass(/iwac-vis-index-ledger__type--lieux/);
    await expect(first.locator('.iwac-vis-index-ledger__years')).toHaveText('1924 – 2026');
    await expect(first.getByRole('link', { name: 'Burkina Faso' })).toHaveAttribute('href', '/s/iwac/item/546');
    await expect(first.locator('.iwac-vis-index-ledger__country')).toHaveCount(6);
    await expect(first.locator('.iwac-vis-index-ledger__figure')).toHaveText('6 447 mentions');

    const edges = page.locator('.iwac-vis-index-ledger__row');
    const byTitle = (t) => edges.filter({ hasText: t });
    await expect(byTitle('Single year').locator('.iwac-vis-index-ledger__years')).toHaveText('1995');
    await expect(byTitle('Single year').locator('.iwac-vis-index-ledger__figure')).toHaveText('1 mention');
    await expect(byTitle('Undated').locator('.iwac-vis-index-ledger__years')).toHaveCount(0);
    await expect(byTitle('Undated').locator('.iwac-vis-index-ledger__type')).toHaveText('Subjects');
    await expect(byTitle('Cited nowhere').locator('.iwac-vis-index-ledger__countries')).toHaveCount(0);
    await expect(byTitle('No item to open').getByRole('link')).toHaveCount(0);
});

test('the list numbers follow the page, and search announces its count', async ({ page }) => {
    await page.goto(FIXTURE);
    const list = page.locator('.iwac-vis-index-ledger');
    const count = page.locator('.iwac-vis-index-ledger-count');
    await expect(count).toHaveText('50 entries');
    await expect(list).toHaveAttribute('start', '1');

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(list).toHaveAttribute('start', '31');
    await expect(page.locator('.iwac-vis-index-ledger__row')).toHaveCount(20);

    await page.getByRole('searchbox').fill('ouaga');
    await expect(count).toHaveText('1 entry');
    await expect(list).toHaveAttribute('start', '1');
    await expect(page.locator('.iwac-vis-index-ledger__row')).toHaveCount(1);

    await page.getByRole('searchbox').fill('nothing matches this');
    await expect(count).toHaveText('0 entries');
    await expect(list).toBeHidden();
    await expect(page.locator('#host .iwac-vis-empty')).toBeVisible();
});

test('French counts and labels', async ({ page }) => {
    await page.goto(`${FIXTURE}?lang=fr`);
    await expect(page.locator('.iwac-vis-index-ledger-count')).toHaveText('50 entrées');
    const first = page.locator('.iwac-vis-index-ledger__row').first();
    await expect(first.locator('.iwac-vis-index-ledger__type')).toHaveText('Lieux·');
    await expect(first.locator('.iwac-vis-index-ledger__label')).toHaveText('Pays');
    await expect(page.locator('.iwac-vis-index-ledger__row').filter({ hasText: 'Single year' })
        .locator('.iwac-vis-index-ledger__unit')).toHaveText('mention');
});
