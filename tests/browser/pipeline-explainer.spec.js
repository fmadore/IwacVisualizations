'use strict';
/**
 * Pipeline explainer: the server's reading without JavaScript, the Svelte
 * diagram over it, its single play and Replay, reduced motion, keyboard,
 * phone layout, both themes and both languages — on fixtures rendered from
 * the production template (tests/browser/render-pipeline-explainer.php),
 * with all four presets on one page.
 */
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const tokens = require('../../tokens.json');

const URL = '/tests/browser/fixtures/pipeline-explainer';
const PRESETS = [
    // instance, preset, stages per route
    ['pipeline-1', 'topic-modelling', [5]],
    ['pipeline-2', 'ocr', [4, 4]],
    ['pipeline-3', 'entity-enrichment', [4]],
    ['pipeline-4', 'albani-sermons', [5]],
];

/** A tokens.json hex colour as getComputedStyle prints it. */
function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function open(page, locale = 'en', query = '') {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${URL}.${locale}.html${query}`);
    for (const [instance] of PRESETS) {
        await expect(page.locator(`[data-instance="${instance}"]`)).toHaveAttribute('data-pipeline-ready', 'true');
    }
    return errors;
}

/** Running CSS animations inside one block. */
function animationsIn(page, instance) {
    return page.evaluate((id) => document.getAnimations()
        .filter((a) => a.effect && a.effect.target && a.effect.target.closest(`[data-instance="${id}"]`)).length, instance);
}

test('without JavaScript the server reading is complete and ordered', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${URL}.en.html`);
    for (const [instance, , routes] of PRESETS) {
        const block = page.locator(`[data-instance="${instance}"]`);
        const lists = block.locator('ol.iwac-vis-pipeline__stages');
        await expect(lists).toHaveCount(routes.length);
        for (const [r, count] of routes.entries()) {
            await expect(lists.nth(r).locator('> li')).toHaveCount(count);
        }
        await expect(block.locator('.iwac-vis-pipeline__caption').first()).not.toBeEmpty();
        await expect(block.locator('.iwac-vis-pipeline__caveat')).toBeVisible();
        await expect(block.locator('.iwac-vis-pipeline__art')).toHaveCount(0);
        await expect(block.getByRole('button')).toHaveCount(0);
    }
    // Two routes are two titled sections, not one long list.
    await expect(page.getByRole('region', { name: 'Direct extraction, the current workflow' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Post-correction of noisy OCR' })).toBeVisible();
    await context.close();
});

test('each block mounts its own diagram over the same words', async ({ page }) => {
    const errors = await open(page);
    for (const [instance, preset, routes] of PRESETS) {
        const block = page.locator(`[data-instance="${instance}"]`);
        await expect(block.locator('.iwac-vis-pipeline__figure')).toHaveCount(1);
        await expect(block.locator('.iwac-vis-pipeline__figure')).toHaveAttribute('data-preset', preset);
        const stages = block.locator('.iwac-vis-pipeline__stage');
        await expect(stages).toHaveCount(routes.reduce((a, b) => a + b, 0));
        // Every stage has a drawing, and every drawing is hidden from assistive technology.
        await expect(block.locator('.iwac-vis-pipeline__art')).toHaveCount(await stages.count());
        await expect(block.locator('.iwac-vis-pipeline__art:not([aria-hidden="true"])')).toHaveCount(0);
        await expect(block.getByRole('button', { name: 'Replay animation' })).toHaveCount(1);
        // The figure is named by its title, at the level the editor chose.
        await expect(block.getByRole('figure')).toHaveAccessibleName(await block.locator('h3').first().innerText());
    }
    // No chart library, and no request beyond the page's own assets.
    expect(await page.evaluate(() => typeof window.echarts)).toBe('undefined');
    expect(errors).toEqual([]);
});

test('plays once in view, replays on request, and rests on the whole diagram', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    const ocr = page.locator('[data-instance="pipeline-2"]');
    const figure = ocr.locator('.iwac-vis-pipeline__figure');
    // Below the fold: not played yet, and complete as it rests.
    await expect(figure).not.toHaveClass(/--playing/);
    await ocr.scrollIntoViewIfNeeded();
    await expect(figure).toHaveClass(/--playing/);
    expect(await animationsIn(page, 'pipeline-2')).toBeGreaterThan(0);
    // Under five seconds, then nothing moves: no loop.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'), null, { timeout: 6000 });
    // A block that played does not start the others.
    await expect(page.locator('[data-instance="pipeline-4"] .iwac-vis-pipeline__figure')).not.toHaveClass(/--playing/);
    // Replay from the keyboard.
    const replay = ocr.getByRole('button', { name: 'Replay animation' });
    await replay.focus();
    await expect(replay).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await animationsIn(page, 'pipeline-2')).toBeGreaterThan(0);
    await expect(replay).toBeFocused();
});

test('reduced motion shows the complete diagram and no Replay', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    for (const [instance] of PRESETS) {
        const block = page.locator(`[data-instance="${instance}"]`);
        await block.scrollIntoViewIfNeeded();
        await expect(block.getByRole('button')).toHaveCount(0);
        await expect(block.locator('.iwac-vis-pipeline__figure')).not.toHaveClass(/--playing/);
        expect(await animationsIn(page, instance)).toBe(0);
    }
});

test('a phone keeps every stage, in order, with nothing overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const [instance] of PRESETS) {
        const tops = await page.locator(`[data-instance="${instance}"] .iwac-vis-pipeline__stages`).first()
            .locator('> li').evaluateAll((items) => items.map((li) => li.getBoundingClientRect().top));
        // One stage a row: each starts below the one before.
        expect(tops).toEqual([...tops].sort((a, b) => a - b));
        expect(new Set(tops).size).toBe(tops.length);
    }
    // No drawing spills out of its box or over its stage's words.
    const spills = await page.evaluate(() => [...document.querySelectorAll('.iwac-vis-pipeline__art')].filter((art) => {
        const box = art.getBoundingClientRect();
        const stage = art.closest('.iwac-vis-pipeline__stage').getBoundingClientRect();
        return [...art.querySelectorAll('*')].some((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.bottom > box.bottom + 1 || r.right > stage.right + 2 || r.left < stage.left - 2);
        });
    }).length);
    expect(spills).toBe(0);
});

test('the drawings follow the theme toggle', async ({ page }) => {
    await open(page);
    const paper = page.locator('[data-instance="pipeline-1"] .iwac-vis-pipeline__paper').first();
    await expect(paper).toHaveCSS('fill', rgb(tokens.light['--surface-raised']));
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect(paper).toHaveCSS('fill', rgb(tokens.dark['--surface-raised']));
});

for (const theme of ['light', 'dark']) {
    test(`no serious WCAG A/AA violation and a sound outline (${theme})`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open(page, 'en', `?theme=${theme}`);
        const report = (results) => results.violations
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        // One scan per run: `withRules` would replace the tags, not add to them.
        const wcag = await new AxeBuilder({ page }).include('.iwac-vis-pipeline')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(report(wcag)).toEqual([]);
        // h1 → h2 (page) → h3 (block) → h4 (routes): the outline the level setting keeps.
        const outline = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
        expect(report(outline)).toEqual([]);
        expect(outline.passes.map((p) => p.id)).toContain('heading-order');
    });
}

test('French page: the words come from fr.po, the drawings stay put', async ({ page }) => {
    const errors = await open(page, 'fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    const ocr = page.locator('[data-instance="pipeline-2"]');
    await expect(ocr.getByRole('heading', { name: 'Comment l’IA transforme des pages numérisées en texte consultable' })).toBeVisible();
    await expect(ocr.getByRole('region', { name: 'Post-correction d’un OCR bruité' })).toBeVisible();
    await expect(ocr.getByRole('button', { name: 'Rejouer l’animation' })).toBeVisible();
    await expect(page.locator('[data-instance="pipeline-3"] .iwac-vis-pipeline__category').first()).toHaveText('Personne');
    expect(errors).toEqual([]);
});
