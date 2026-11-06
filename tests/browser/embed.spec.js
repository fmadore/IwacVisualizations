'use strict';

/**
 * The embed affordances (asset/js/charts/shared/embed.js) on blocks that do
 * not render all their panels at once.
 *
 * Until 1.97 every block got its embed buttons once, 120 ms after its first
 * panel appeared. Albani Zaria builds eleven of its twenty panels as their
 * sections scroll into view, and every view of Laïcité past the first is
 * built when the reader switches to it: none of those panels had a button,
 * none could be embedded alone, and a single-panel embed framed the panel
 * under the block's whole masthead. The fixture reproduces each shape.
 */

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/embed.html';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        window.__iwacCopiedText = '';
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText(text) {
                    window.__iwacCopiedText = text;
                    return Promise.resolve();
                },
            },
        });
    });
});

const copied = (page) => page.evaluate(() => window.__iwacCopiedText);
const laicite = (page) => page.locator('.iwac-vis-fixture');

test('a panel that renders after the first ones still gets its embed button', async ({ page }) => {
    await page.goto(FIXTURE);
    const buttons = laicite(page).locator('.iwac-vis-panel .iwac-vis-embed-btn');
    await expect(buttons).toHaveCount(3);

    // Scrolling the lazy section into view builds its panel.
    await page.locator('.iwac-vis-fixture-lazy').scrollIntoViewIfNeeded();
    await expect(buttons).toHaveCount(4);
    await page.locator('[data-iwac-panel="fixture-keyness"]').getByRole('button', { name: 'Copy embed code' }).click();
    expect(await copied(page)).toContain('/s/iwac/iwac-embed/laicite/fixture-keyness"');
});

test('a panel embed carries its block’s view state, read when copied', async ({ page }) => {
    await page.goto(`${FIXTURE}?laicite.view=trends&laicite.country=Togo&cmp.a=articles`);
    const second = laicite(page).locator('.iwac-vis-panel').nth(1);
    await second.getByRole('button', { name: 'Copy embed code' }).click();
    let snippet = await copied(page);
    expect(snippet).toContain('/s/iwac/iwac-embed/laicite/panel-1?laicite.view=trends&laicite.country=Togo"');
    // Another block's parameters on the same page stay behind.
    expect(snippet).not.toContain('cmp.a');

    // The reader switches view after the button was made.
    await page.evaluate(() => history.replaceState(null, '', '?laicite.view=documents'));
    await second.getByRole('button', { name: 'Copy embed code' }).click();
    await expect.poll(() => copied(page)).toContain('/laicite/panel-1?laicite.view=documents"');
});

test('a block with no panels offers one button for the whole block, with its configuration', async ({ page }) => {
    await page.goto(FIXTURE);
    const block = page.locator('.iwac-vis-pipeline');
    const button = block.getByRole('button', { name: 'Copy embed code' });
    await expect(button).toHaveCount(1);
    await expect(button).toHaveClass(/iwac-vis-embed-btn--labeled/);
    await button.click();
    const snippet = await copied(page);
    expect(snippet).toContain('/s/iwac/iwac-embed/pipeline-explainer?preset=ocr"');
    expect(snippet).toContain('title="How OCR with AI reads a page"');
});

test('a single-panel embed shows the panel alone, without the block’s masthead', async ({ page }) => {
    await page.goto(`${FIXTURE}?embed=panel-1`);
    const target = page.locator('[data-iwac-panel="panel-1"]');
    await expect(target).toHaveAttribute('data-iwac-panel-active', '1');
    await expect(target).toBeVisible();
    await expect(laicite(page).locator('.iwac-vis-panel:visible')).toHaveCount(1);
    await expect(page.locator('.iwac-vis-block-header')).toBeHidden();
    await expect(page.locator('.iwac-vis-fixture-controls')).toBeHidden();
    await expect(page.locator('.iwac-vis-embed-btn')).toHaveCount(0);
});

test('a single-panel embed renders the section its panel waits in', async ({ page }) => {
    // Nothing in the frame scrolls 4000px down to the lazy section.
    await page.goto(`${FIXTURE}?embed=fixture-keyness`);
    const target = page.locator('[data-iwac-panel="fixture-keyness"]');
    await expect(target).toHaveAttribute('data-iwac-panel-active', '1');
    await expect(target).toBeVisible();
    await expect(laicite(page).locator('.iwac-vis-panel:visible')).toHaveCount(1);
    await expect(page.locator('.iwac-vis-block-header')).toBeHidden();
    // Its section heading sits beside the panel, not around it.
    await expect(page.locator('.iwac-vis-fixture-lazy > h3')).toBeHidden();
});

test('a single-panel embed renders only the lazy sections that could hold its panel', async ({ page }) => {
    // The unnamed section might hold anything; the named one says it holds
    // `fixture-named` only, so a frame after `fixture-keyness` skips it.
    await page.goto(`${FIXTURE}?embed=fixture-keyness`);
    await expect(page.locator('body')).toHaveClass(/iwac-embed-ready/);
    await expect(page.locator('[data-iwac-panel="fixture-keyness"]')).toHaveAttribute('data-iwac-panel-active', '1');
    expect(await page.evaluate(() => window.__namedRendered)).toBe(false);
    // Nor a map waiting inside a panel of its own: it builds no other panel.
    expect(await page.evaluate(() => window.__mapRendered)).toBe(false);

    await page.goto(`${FIXTURE}?embed=fixture-named`);
    await expect(page.locator('[data-iwac-panel="fixture-named"]')).toHaveAttribute('data-iwac-panel-active', '1');
    await expect(page.locator('body')).toHaveClass(/iwac-embed-ready/);
});

test('a single-panel embed is revealed only once its panel is pinned, or found missing', async ({ page }) => {
    await page.goto(`${FIXTURE}?embed=panel-1`);
    await expect(page.locator('body')).toHaveClass(/iwac-embed-ready/);
    await expect(page.locator('[data-iwac-panel="panel-1"]')).toHaveAttribute('data-iwac-panel-active', '1');

    // An unknown slug: every section that might hold it rendered, nothing
    // pinned, the whole block shown as it always was. The section that
    // names other panels cannot hold it, and waits to be scrolled to like
    // any section of the block.
    await page.goto(`${FIXTURE}?embed=no-such-panel`);
    await expect(page.locator('body')).toHaveClass(/iwac-embed-ready/);
    await expect(page.locator('[data-iwac-panel-active]')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-block-header')).toBeVisible();
    await expect(page.locator('[data-iwac-panel="fixture-keyness"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.__namedRendered)).toBe(false);
});
