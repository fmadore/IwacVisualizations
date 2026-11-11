'use strict';

/**
 * Keyboard and screen-reader behaviour of the shared controls.
 *
 * `P.buildSearchDropdown` was a search input over a div of buttons: no
 * combobox semantics, Enter took the first result only, nothing announced
 * the count, and tabbing away left the list open. Three controls also
 * destroyed the element they were activated from and dropped focus to
 * <body>: the graph card's Close and neighbour buttons, the linked filter's
 * Clear, and a picked search result.
 */

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const FIXTURE = '/tests/browser/fixtures/shared-controls.html';

async function open(page, query = '') {
    await page.goto(FIXTURE + query);
    await page.waitForLoadState('networkidle');
}

function activeInfo(page) {
    return page.evaluate(() => {
        const a = document.activeElement;
        return {
            tag: a ? a.tagName : null,
            id: a ? a.id : null,
            cls: a ? a.className : null,
            text: a ? (a.textContent || '').trim() : null,
            isBody: a === document.body,
        };
    });
}

test.describe('search combobox', () => {
    test('carries combobox and listbox semantics', async ({ page }) => {
        await open(page);
        const input = page.getByRole('combobox', { name: 'Search a term' });
        await expect(input).toHaveAttribute('aria-expanded', 'false');
        await expect(input).toHaveAttribute('aria-autocomplete', 'list');
        const listId = await input.getAttribute('aria-controls');
        expect(listId).toBeTruthy();

        await input.fill('ima');
        const list = page.locator('#' + listId);
        await expect(list).toBeVisible();
        await expect(list).toHaveAttribute('role', 'listbox');
        await expect(input).toHaveAttribute('aria-expanded', 'true');
        const options = list.getByRole('option');
        await expect(options).toHaveCount(3);
        // Not tab stops: focus stays in the input.
        for (const opt of await options.all()) await expect(opt).toHaveAttribute('tabindex', '-1');
        await expect(page.locator('.iwac-vis-search__status'))
            .toHaveText('3 suggestions available, use the up and down arrows to browse');
    });

    test('arrow keys walk the suggestions and Enter takes the highlighted one', async ({ page }) => {
        await open(page);
        const input = page.getByRole('combobox', { name: 'Search a term' });
        await input.fill('ima');
        await expect(page.getByRole('option')).toHaveCount(3);
        await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);

        await input.press('ArrowDown');
        const first = page.getByRole('option').nth(0);
        await expect(input).toHaveAttribute('aria-activedescendant', await first.getAttribute('id'));
        await expect(first).toHaveAttribute('aria-selected', 'true');

        await input.press('ArrowDown');
        const second = page.getByRole('option').nth(1);
        await expect(input).toHaveAttribute('aria-activedescendant', await second.getAttribute('id'));
        await expect(second).toHaveAttribute('aria-selected', 'true');
        await expect(first).toHaveAttribute('aria-selected', 'false');

        // End / Home while browsing; Up wraps from the first to the last.
        await input.press('End');
        await expect(page.getByRole('option').nth(2)).toHaveAttribute('aria-selected', 'true');
        await input.press('Home');
        await expect(first).toHaveAttribute('aria-selected', 'true');
        await input.press('ArrowUp');
        await expect(page.getByRole('option').nth(2)).toHaveAttribute('aria-selected', 'true');
        await input.press('ArrowDown');
        await input.press('ArrowDown');

        await input.press('Enter');
        await expect(page.locator('#picked')).toHaveText('imamat');
        await expect(input).toHaveValue('');
        await expect(input).toHaveAttribute('aria-expanded', 'false');
        await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
        await expect(input).toBeFocused();
    });

    test('Enter with nothing highlighted still takes the first match, even before the debounce', async ({ page }) => {
        await open(page);
        const input = page.getByRole('combobox', { name: 'Search a term' });
        await input.focus();
        await page.keyboard.type('isl');
        await page.keyboard.press('Enter');
        await expect(page.locator('#picked')).toHaveText('islam');
    });

    test('Escape closes and keeps focus in the input', async ({ page }) => {
        await open(page);
        const input = page.getByRole('combobox', { name: 'Search a term' });
        await input.fill('ima');
        await expect(page.getByRole('listbox')).toBeVisible();
        await input.press('ArrowDown');
        await input.press('Escape');
        await expect(page.locator('.iwac-vis-search__results')).toBeHidden();
        await expect(input).toHaveAttribute('aria-expanded', 'false');
        await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
        await expect(input).toBeFocused();
        // The query survives: Escape dismissed the list, not the text.
        await expect(input).toHaveValue('ima');
        // ArrowDown reopens on the same query.
        await input.press('ArrowDown');
        await expect(page.getByRole('listbox')).toBeVisible();
        await expect(page.getByRole('option').nth(0)).toHaveAttribute('aria-selected', 'true');
    });

    test('Tab closes the list', async ({ page }) => {
        await open(page);
        const input = page.getByRole('combobox', { name: 'Search a term' });
        await input.fill('ima');
        await expect(page.getByRole('listbox')).toBeVisible();
        await input.press('Tab');
        await expect(page.locator('.iwac-vis-search__results')).toBeHidden();
        await expect(input).toHaveAttribute('aria-expanded', 'false');
        // Options are not tab stops: Tab went straight past them.
        await expect(page.locator('#after-search')).toBeFocused();
    });

    test('announces no matches', async ({ page }) => {
        await open(page);
        const input = page.getByRole('combobox', { name: 'Search a term' });
        await input.fill('zzz');
        await expect(page.locator('.iwac-vis-search__empty')).toBeVisible();
        await expect(page.locator('.iwac-vis-search__status')).toHaveText('No matches');
        await expect(input).toHaveAttribute('aria-expanded', 'false');
    });

    test('announces in French', async ({ page }) => {
        await open(page, '?lang=fr');
        const input = page.getByRole('combobox');
        await input.fill('ima');
        await expect(page.locator('.iwac-vis-search__status'))
            .toHaveText('3 suggestions disponibles, parcourez-les avec les flèches haut et bas');
        await input.fill('zzz');
        await expect(page.locator('.iwac-vis-search__status')).toHaveText('Aucun résultat');
    });

    test('a click on an option still picks it and leaves focus in the input', async ({ page }) => {
        await open(page);
        const input = page.getByRole('combobox', { name: 'Search a term' });
        await input.fill('mos');
        await page.getByRole('option', { name: /mosquée/ }).click();
        await expect(page.locator('#picked')).toHaveText('mosquée');
        await expect(input).toBeFocused();
    });

    test('the open list passes axe', async ({ page }) => {
        await open(page);
        const input = page.getByRole('combobox', { name: 'Search a term' });
        await input.fill('ima');
        await input.press('ArrowDown');
        const results = await new AxeBuilder({ page })
            .include('#search-block')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`))
            .toEqual([]);
    });
});

test.describe('focus survives a rebuild', () => {
    test('clearing the linked filter moves focus to a control that stays', async ({ page }) => {
        await open(page);
        await page.locator('#set-filter').click();
        const clear = page.locator('.iwac-vis-linked-filter__clear');
        await expect(clear).toBeVisible();
        await clear.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('.iwac-vis-linked-filter')).toBeHidden();
        const info = await activeInfo(page);
        expect(info.isBody).toBe(false);
        expect(info.id).toBe('set-filter');
    });

    test('a new value while on Clear keeps focus on the new Clear', async ({ page }) => {
        await open(page);
        await page.locator('#set-filter').click();
        await page.locator('.iwac-vis-linked-filter__clear').focus();
        await page.evaluate(() => window.__store.patch({ country: 'Togo' }));
        await expect(page.locator('.iwac-vis-linked-filter')).toContainText('Togo');
        await expect(page.locator('.iwac-vis-linked-filter__clear')).toBeFocused();
    });

    test('a neighbour jump in the graph card lands on the new title', async ({ page }) => {
        await open(page);
        await page.evaluate(() => window.__graph.select('a'));
        const card = page.locator('.iwac-vis-graph-card');
        await expect(card).toBeVisible();
        await card.locator('.iwac-vis-graph-card__jump', { hasText: 'Togo' }).focus();
        await page.keyboard.press('Enter');
        await expect(card.locator('.iwac-vis-graph-card__title')).toHaveText('Togo');
        await expect(card.locator('.iwac-vis-graph-card__title')).toBeFocused();
    });

    test('closing the graph card returns focus to the graph', async ({ page }) => {
        await open(page);
        await page.evaluate(() => window.__graph.select('b'));
        const card = page.locator('.iwac-vis-graph-card');
        await card.locator('.iwac-vis-graph-card__close').focus();
        await page.keyboard.press('Enter');
        await expect(card).toBeHidden();
        const info = await activeInfo(page);
        expect(info.isBody).toBe(false);
        await expect(page.locator('.iwac-vis-graph-canvas')).toBeFocused();
    });

    test('a selection made elsewhere does not steal focus', async ({ page }) => {
        await open(page);
        await page.locator('#set-filter').focus();
        await page.evaluate(() => window.__graph.select('b'));
        await expect(page.locator('.iwac-vis-graph-card')).toBeVisible();
        await expect(page.locator('#set-filter')).toBeFocused();
    });
});
