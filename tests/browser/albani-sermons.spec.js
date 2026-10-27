'use strict';

/**
 * The Albani Zaria sermons page block, booted the way _generic.phtml boots it.
 *
 * The bundles are tests/browser/fixtures/data/albani-sermons/, the
 * generator's real output on a four-recording corpus
 * (tests/browser/build_albani_fixture.py): one public and one private copy
 * of the current-format test transcript, one legacy transcript, one
 * recording with none. `?eager=1` renders every lazy section at once.
 */

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/albani-sermons.html';

function watch(page) {
    const problems = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    return problems;
}

async function ready(page, query = '') {
    await page.goto(`${FIXTURE}?eager=1${query}`);
    await expect(page.locator('.iwac-vis-albani__loading')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__section')).toHaveCount(7);
    await expect(page.locator('[data-iwac-section="politics"] .iwac-vis-kwic-row').first()).toBeVisible();
}

test('every section renders from its own bundle, without a console problem', async ({ page }) => {
    const problems = watch(page);
    await ready(page);
    const sections = await page.locator('.iwac-vis-albani__section').evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-iwac-section')));
    expect(sections).toEqual(['corpus', 'vocabulary', 'youth', 'politics', 'overlap', 'keyness', 'method']);
    const fetched = await page.evaluate(() => window.__fetched.map((u) => u.split('/').pop()).sort());
    expect(fetched).toEqual([
        'collocates.json', 'concordance-politics.json', 'concordance-youth.json', 'keyness.json',
        'lexicon.json', 'metadata.json', 'network.json', 'overlap.json', 'vocabulary.json',
    ]);
    expect(problems).toEqual([]);
});

test('the transcripts still being redone are named, and the democracy caveat shows', async ({ page }) => {
    await ready(page);
    await expect(page.locator('.iwac-vis-albani__status')).toContainText("Shari'a");
    await expect(page.locator('.iwac-vis-albani__caveat')).toContainText('Demokuradiyyah');
});

test('passages come from the public transcript only, and say what was withheld', async ({ page }) => {
    await ready(page);
    const politics = page.locator('[data-iwac-section="politics"]');
    const rows = politics.locator('.iwac-vis-kwic-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.locator('.iwac-vis-kwic-title').first()).toHaveText("Ziyarar 'Yan Uwa Daga Gombe");
    // The emir, never the divine epithet that ends the same transcript.
    await expect(rows.locator('.iwac-vis-kwic-match')).toHaveText(["'yan siyasa", 'Sarkin']);
    await expect(politics).toContainText('counted above but not quoted');
    // No IIIF manifest in the fixture: the window falls back to the item page.
    await expect(rows.first().locator('.iwac-vis-albani__window')).toHaveAttribute('href', '/s/iwac/item/15889');
});

test('the methods are explained in plain terms, with their sources linked', async ({ page }) => {
    await ready(page);
    const method = page.locator('[data-iwac-section="method"]');
    await expect(method.locator('.iwac-vis-albani__method-item')).toHaveCount(9);
    await expect(method).toContainText('Bashir, Bichi and Adamu (2024)');
    await expect(method.getByRole('link', { name: 'https://doi.org/10.1186/s43067-024-00187-5' }))
        .toHaveAttribute('href', 'https://doi.org/10.1186/s43067-024-00187-5');
    await expect(method.locator('.iwac-vis-albani__references > li')).toHaveCount(4);
    // The header's jump link lands on the section's heading.
    const href = await page.locator('.iwac-vis-albani__jump').getAttribute('href');
    expect(href).toBe('#' + await method.locator('.iwac-vis-section-heading').getAttribute('id'));
});

test('every chart and network offers the shared full-screen control, and fills the screen', async ({ page }) => {
    await ready(page);
    // Every panel that draws (an ECharts canvas or a force graph) carries
    // the shared toolbar's full-screen button; tables and lists do not.
    const drawn = page.locator('.iwac-vis-albani__section .iwac-vis-panel').filter({ has: page.locator('canvas') });
    const count = await drawn.count();
    expect(count).toBeGreaterThan(8);
    for (let i = 0; i < count; i++) {
        await expect(drawn.nth(i).getByRole('button', { name: 'Toggle fullscreen' })).toHaveCount(1);
    }
    // A row-sized bar chart: its inline minimum height must not hold the
    // chart at page size once the panel is expanded.
    const panel = page.locator('[data-iwac-panel="albani-youth-intensity"]');
    const chart = panel.locator('.iwac-vis-chart');
    const before = (await chart.boundingBox()).height;
    const viewport = page.viewportSize().height;
    const button = panel.getByRole('button', { name: 'Toggle fullscreen' });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    // iwac-core.css sizes a full-screen chart at 100vh - 160px.
    await expect.poll(async () => (await chart.boundingBox()).height).toBeGreaterThan(before);
    expect((await chart.boundingBox()).height).toBeGreaterThanOrEqual(viewport - 161);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('the counting scope is one control, reflected in the address bar', async ({ page }) => {
    await ready(page);
    const monologue = page.locator('[data-iwac-control="albani-scope:monologue"]');
    await monologue.click();
    await expect(monologue).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/albani\.scope=monologue/);
    // The exchange segment's lines drop out of the youth concordance.
    await expect(page.locator('[data-iwac-section="youth"] .iwac-vis-albani__count')).toContainText(/^\d+ of \d+ lines$/);
});

test('the French site reads French', async ({ page }) => {
    const problems = watch(page);
    await ready(page, '&lang=fr');
    await expect(page.locator('.iwac-vis-block-header__title')).toHaveText('Les sermons du cheikh Albani Zaria');
    await expect(page.locator('[data-iwac-section="youth"] .iwac-vis-section-heading')).toHaveText('La jeunesse');
    expect(problems).toEqual([]);
});
