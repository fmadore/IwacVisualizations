'use strict';

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/minimal-item.html';

test('a YouTube item page is scoped to its own channel', async ({ page }) => {
    await page.goto(FIXTURE);

    // The block hydrated: the spinner is gone and the figures row leads.
    await expect(page.locator('.iwac-vis-minimal-item__loading')).toHaveCount(0);
    const figures = page.locator('.iwac-vis-summary-card');
    await expect(figures).toHaveCount(3);
    await expect(figures.nth(0)).toContainText('639');   // channel, not 1,146
    await expect(figures.nth(1)).toContainText('36 h');  // 129,600 s
    await expect(figures.nth(2)).toContainText('2:34');  // median 154 s

    // Panel copy names what produced it.
    await expect(page.getByRole('heading', { name: 'Activity of this source over time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'More from this source' })).toBeVisible();
    await expect(page.locator('.iwac-vis-sparkline__caption'))
        .toContainText('639 items from RTB');
});

test('cards open the record and show thumbnail, provenance and runtime', async ({ page }) => {
    await page.goto(FIXTURE);

    const cards = page.locator('.iwac-vis-similar-card');
    // The current item is dropped from its own strip.
    await expect(cards).toHaveCount(2);

    const first = cards.first();
    await expect(first).toHaveAttribute('href', '/s/iwac/item/1001');
    await expect(first.locator('.iwac-vis-similar-card__title'))
        .toHaveText('Journal télévisé du 2 août');
    await expect(first.locator('.iwac-vis-similar-card__meta'))
        .toContainText('RTB - Radiodiffusion Télévision du Burkina');
    await expect(first.locator('.iwac-vis-similar-card__duration')).toHaveText('2:34');
    // An hour-long recording keeps its hours place.
    await expect(cards.nth(1).locator('.iwac-vis-similar-card__duration')).toHaveText('1:02:05');
    // The thumbnail is a background image, never a bundled media file.
    await expect(first.locator('.iwac-vis-similar-card__thumb')).toBeVisible();
});

test('the watch link leaves the site safely and is not an embedded player', async ({ page }) => {
    await page.goto(FIXTURE);

    const watch = page.getByRole('link', { name: 'Watch on YouTube' });
    await expect(watch).toHaveAttribute('href', 'https://www.youtube.com/watch?v=xcGWG5msEEs');
    await expect(watch).toHaveAttribute('rel', /noopener/);
    // No third-party frame is created on load.
    await expect(page.locator('iframe')).toHaveCount(0);
});

test('an older data bundle falls back to whole-subset context', async ({ page }) => {
    await page.goto(`${FIXTURE}?scope=none`);

    await expect(page.locator('.iwac-vis-minimal-item__loading')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Activity over time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Other items in this collection' })).toBeVisible();
    await expect(page.locator('.iwac-vis-summary-card').first()).toContainText('1,146');
    await expect(page.locator('.iwac-vis-similar-card')).toHaveCount(1);
});

test('the channel view reads in French', async ({ page }) => {
    await page.goto(`${FIXTURE}?lang=fr`);

    await expect(page.getByRole('heading', { name: 'Activité de cette source dans le temps' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Autres contenus de cette source' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Regarder sur YouTube' })).toBeVisible();
    // A channel slice counts videos; the mixed subset counts items.
    await expect(page.locator('.iwac-vis-summary-card__label').first()).toHaveText('Vidéos');
    await page.goto(`${FIXTURE}?lang=fr&scope=none`);
    await expect(page.locator('.iwac-vis-summary-card__label').first()).toHaveText('Éléments');
});

test('the block does not overflow a 375 px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto(FIXTURE);
    await expect(page.locator('.iwac-vis-similar-card').first()).toBeVisible();

    const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
