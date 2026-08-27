'use strict';

/**
 * The shared table's narrow-container layout.
 *
 * The fixture holds the two shapes that break differently. First the
 * Audiovisual Overview's six-column "Most recent" panel — the widest table
 * the module ships, and the one that shredded into one-letter columns on a
 * 375px phone. Then a record carrying a value with nothing to break on: a
 * channel handle, a slug, the kind of hyphenless compound this corpus
 * supplies routinely.
 *
 * What these tests hold in place is that the fix keeps every field (the
 * previous answer hid columns), keeps the accessibility tree a table
 * (changing `display` on a table strips its implicit semantics), and keys
 * off the CONTAINER rather than the viewport.
 */

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/table-records.html';
const RECENT = '.iwac-vis-table--recent';
const UNBREAKABLE = '.iwac-vis-table--unbreakable';
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };

test('a six-column table fits a 375 px phone without a horizontal scroll', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(FIXTURE);

    const layout = await page.evaluate((sel) => {
        const table = document.querySelector(`${sel} .iwac-vis-table`);
        return {
            docScrollWidth: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
            tableDisplay: getComputedStyle(table).display,
            tableOverflow: table.scrollWidth - table.clientWidth,
            rowHeight: Math.round(
                table.querySelector('.iwac-vis-table__row').getBoundingClientRect().height
            ),
        };
    }, RECENT);

    expect(layout.docScrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.tableDisplay).toBe('block');
    expect(layout.tableOverflow).toBe(0);
    // The old failure printed the header band alone at ~340px tall.
    expect(layout.rowHeight).toBeLessThan(260);
});

test('a datum with nothing to break on stays inside the record', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(FIXTURE);

    // A label and its value are adjacent inline boxes with no whitespace
    // between them, so a channel handle or a slug is one unbreakable word
    // running from the start of the label. Laid out as a run of inline text
    // it walks straight out of the panel.
    const measured = await page.evaluate((sel) => {
        const wrapper = document.querySelector(sel);
        const row = wrapper.querySelector('.iwac-vis-table__row');
        const limit = wrapper.getBoundingClientRect().right;
        const rights = [...row.children].map((c) => c.getBoundingClientRect().right);
        return {
            worstOverflow: Math.round(Math.max(...rights) - limit),
            docScrollWidth: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
        };
    }, UNBREAKABLE);

    expect(measured.worstOverflow).toBeLessThanOrEqual(0);
    expect(measured.docScrollWidth).toBeLessThanOrEqual(measured.viewport);
});

test('every field survives the phone — the record hides nothing', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(FIXTURE);

    // Hiding the Source and Date columns was the previous answer to this
    // problem, and it left a phone reader a list of titles with no
    // provenance and no date.
    const visible = await page.evaluate((sel) =>
        [...document.querySelector(`${sel} .iwac-vis-table__row`).children]
            .filter((cell) => getComputedStyle(cell).display !== 'none')
            .map((cell) => (cell.className.match(/card-(\w+)/) || [])[1]), RECENT);
    expect(visible).toEqual(['media', 'title', 'meta', 'badge', 'meta', 'meta']);

    const row = page.locator(`${RECENT} .iwac-vis-table__row`).first();
    await expect(row).toContainText('Association des Élèves');
    await expect(row).toContainText('31:07');
    await expect(row).toContainText('Aug 12, 2024');
});

test('the accessibility tree stays a table with column headers at 375 px', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(FIXTURE);

    const recent = page.locator(RECENT);
    await expect(recent.getByRole('table')).toHaveCount(1);
    await expect(recent.getByRole('columnheader', { name: 'Source' })).toHaveCount(1);
    await expect(recent.getByRole('columnheader', { name: 'Duration' })).toHaveCount(1);
    await expect(recent.getByRole('row')).toHaveCount(3); // header + two records

    // The visible label echoes a header that is still announced, so it is
    // hidden — otherwise every field would be named twice.
    const label = await page.evaluate((sel) => {
        const el = document.querySelector(`${sel} .iwac-vis-table__cell-label`);
        return {
            text: el.textContent,
            ariaHidden: el.getAttribute('aria-hidden'),
            display: getComputedStyle(el).display,
        };
    }, RECENT);
    expect(label.text).toBe('Source');
    expect(label.ariaHidden).toBe('true');
    expect(label.display).not.toBe('none');
    await expect(recent.getByRole('cell', { name: 'Radio Al Houda', exact: true })).toHaveCount(1);
});

test('the flip follows the container, not the viewport', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(FIXTURE);

    const wide = await page.evaluate((sel) => {
        const table = document.querySelector(`${sel} .iwac-vis-table`);
        return {
            display: getComputedStyle(table).display,
            headers: getComputedStyle(table.querySelector('thead')).display,
            label: getComputedStyle(
                table.querySelector('.iwac-vis-table__cell-label')
            ).display,
        };
    }, RECENT);
    expect(wide.display).toBe('table');
    expect(wide.headers).toBe('table-header-group');
    expect(wide.label).toBe('none');

    // A narrow PANEL on a wide screen is the same failure as a phone.
    const narrowed = await page.evaluate((sel) => {
        window.setPanelWidth(420);
        return getComputedStyle(document.querySelector(`${sel} .iwac-vis-table`)).display;
    }, RECENT);
    expect(narrowed).toBe('block');
});

test('record text clears AA contrast in both themes', async ({ page }) => {
    for (const theme of ['light', 'dark']) {
        await page.setViewportSize(PHONE);
        await page.goto(`${FIXTURE}?theme=${theme}`);
        const ratios = await page.evaluate(() => ({
            label: window.contrastOf('.iwac-vis-table__cell-label', '.iwac-vis-panel'),
            meta: window.contrastOf('.iwac-vis-table__cell--card-meta', '.iwac-vis-panel'),
        }));
        expect(ratios.label, `${theme} label`).toBeGreaterThanOrEqual(4.5);
        expect(ratios.meta, `${theme} meta`).toBeGreaterThanOrEqual(4.5);
    }
});
