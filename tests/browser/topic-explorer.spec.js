'use strict';

/**
 * The Topic Explorer page block, booted the way _generic.phtml boots it.
 *
 * The bundle is tests/browser/fixtures/data/topic-explorer.json: four topics
 * in generate_topic_explorer.py's shape (the keys validate_data.py requires,
 * the fields the overview reads). Four, not the deployed model's thirty, so
 * copy that counts the topics has to have read them from the payload.
 */

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const DATA = require('./fixtures/data/topic-explorer.json');

const FIXTURE = '/tests/browser/fixtures/topic-explorer.html';

function watch(page) {
    const problems = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    return problems;
}

async function ready(page, query = '') {
    await page.goto(FIXTURE + query);
    await expect(page.locator('.iwac-vis-topic-explorer__loading')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-topic-explorer__treemap .iwac-vis-chart canvas').first()).toBeVisible();
}

/** Serve the fixture's bundle with only its first `n` topics. */
function withTopics(page, n) {
    return page.route('**/tests/browser/fixtures/data/topic-explorer.json', (route) => route.fulfill({
        json: {
            ...DATA,
            metadata: { ...DATA.metadata, total_topics: n },
            topics: DATA.topics.slice(0, n),
        },
    }));
}

const treemapDesc = (page) => page.locator('.iwac-vis-topic-explorer__treemap .iwac-vis-panel-desc');

test('boots the overview without a console or page error', async ({ page }) => {
    const problems = watch(page);
    await ready(page);
    expect(await page.evaluate(() => window.__fetched))
        .toEqual(['/files/iwac-visualizations/topic-explorer.json']);
    await expect(page.locator('.iwac-vis-topic-explorer__topics > *')).toHaveCount(DATA.topics.length);
    expect(problems).toEqual([]);
});

test('the treemap description counts the bundle’s topics', async ({ page }) => {
    await ready(page);
    await expect(treemapDesc(page)).toHaveText(/^Each rectangle is one of the 4 themes identified by a statistical topic model \(LDA\)/);
    await expect(treemapDesc(page)).not.toContainText('30');
});

test('the French treemap description counts them too', async ({ page }) => {
    await ready(page, '?lang=fr');
    await expect(treemapDesc(page)).toHaveText(/^Chaque rectangle correspond à l’un des 4 thèmes identifiés par un modèle statistique \(LDA\)/);
    await expect(treemapDesc(page)).not.toContainText('30');
});

test('one topic reads in the singular, in both languages', async ({ page }) => {
    await withTopics(page, 1);
    await ready(page);
    await expect(treemapDesc(page)).toHaveText(/^The rectangle is the one theme identified by a statistical topic model/);
    await expect(treemapDesc(page)).toContainText('Click the rectangle to explore the theme.');

    await ready(page, '?lang=fr');
    await expect(treemapDesc(page)).toHaveText(/^Le rectangle correspond au seul thème identifié par un modèle statistique/);
    await expect(treemapDesc(page)).toContainText('Cliquez sur le rectangle pour explorer ce thème.');
});

/** The page's headings in document order, as level + text. */
function outline(page) {
    return page.locator('main').evaluate((main) =>
        Array.from(main.querySelectorAll('h1, h2, h3, h4, h5, h6'))
            .filter((h) => h.getClientRects().length)
            .map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.trim() })));
}

function expectNoSkippedLevel(headings) {
    expect(headings[0]).toEqual({ level: 1, text: 'Topic Explorer' });
    for (let i = 1; i < headings.length; i++) {
        expect(headings[i].level - headings[i - 1].level, `"${headings[i].text}" skips a level`).toBeLessThanOrEqual(1);
    }
}

test('the outline runs h1, the overview’s sections at h2, an open topic’s panels at h3', async ({ page }) => {
    // The block has no heading of its own, so what it shows are the page's
    // sections. Its panels were h4 and its "All topics" list an h3 under the
    // page's h1 (axe: heading-order); an open topic was an h3 over h4 panels.
    await ready(page);
    let headings = await outline(page);
    expectNoSkippedLevel(headings);
    expect(headings.slice(1)).toEqual([
        { level: 2, text: 'Topic distribution' },
        { level: 2, text: 'Topics over time' },
        { level: 2, text: 'All topics' },
    ]);

    const problems = watch(page);
    await page.locator('.iwac-vis-topic-card').first().click();
    await expect(page.locator('.iwac-vis-topic-explorer__detail.is-active h2')).toHaveText('Topic 0');
    await expect(page.locator('.iwac-vis-topic-explorer__detail .iwac-vis-panel')).toHaveCount(4);
    headings = await outline(page);
    expectNoSkippedLevel(headings);
    expect(headings.slice(1, 6)).toEqual([
        { level: 2, text: 'Topic 0' },
        { level: 3, text: 'Publication calendar' },
        { level: 3, text: 'Top countries' },
        { level: 3, text: 'Top newspapers' },
        { level: 3, text: 'Most representative articles' },
    ]);
    // accessibility.spec.js scans the overview; this is the open topic.
    const axe = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
    expect(axe.violations.map((v) => v.nodes.map((n) => n.target.join(' ')).join(', '))).toEqual([]);
    expect(axe.passes.map((p) => p.id)).toContain('heading-order');

    // The exports and the embed picker read a panel's title at h3 too.
    const download = page.waitForEvent('download');
    await page.locator('.iwac-vis-topic-explorer__detail .iwac-vis-panel')
        .filter({ hasText: 'Top countries' }).getByRole('button', { name: 'Download CSV' }).click();
    expect((await download).suggestedFilename()).toBe('top-countries.csv');
    expect(problems).toEqual([]);
});

test('the payload carries the keys validate_data.py requires of it', () => {
    for (const key of ['topics', 'metadata']) expect(DATA).toHaveProperty(key);
    expect(DATA.metadata.total_topics).toBe(DATA.topics.length);
});

/* ------------------------------------------------------------------ */
/*  Deep links and history — ?topic=<id>                               */
/* ------------------------------------------------------------------ */

const detailTitle = (page) => page.locator('.iwac-vis-topic-explorer__detail.is-active h2');
const overviewActive = (page) => page.locator('.iwac-vis-topic-explorer__overview.is-active');

test('a topic opened from the overview gets its own history entry; Back and Forward move between them', async ({ page }) => {
    const problems = watch(page);
    await ready(page);
    expect(await page.locator('.iwac-vis-topic-explorer').getAttribute('data-url-state')).toBe('topic');
    const before = await page.evaluate(() => history.length);

    const id = DATA.topics[1].id;
    await page.locator('.iwac-vis-topic-card').nth(1).click();
    await expect(detailTitle(page)).toHaveText(`Topic ${id}`);
    await expect(page).toHaveURL(new RegExp(`\\?topic=${id}$`));
    expect(await page.evaluate(() => history.length)).toBe(before + 1);

    await page.goBack();
    await expect(overviewActive(page)).toHaveCount(1);
    await expect(page).not.toHaveURL(/topic=/);

    await page.goForward();
    await expect(detailTitle(page)).toHaveText(`Topic ${id}`);
    await expect(page).toHaveURL(new RegExp(`\\?topic=${id}$`));

    // The detail's own Back button is a navigation too: it pushes the
    // overview, and the browser's Back returns to the topic.
    await page.getByRole('button', { name: 'Back to all topics' }).click();
    await expect(overviewActive(page)).toHaveCount(1);
    await expect(page).not.toHaveURL(/topic=/);
    await page.goBack();
    await expect(detailTitle(page)).toHaveText(`Topic ${id}`);
    await page.goForward();
    await expect(overviewActive(page)).toHaveCount(1);
    expect(problems).toEqual([]);
});

test('landing on ?topic= opens it without adding a history entry, and a bad id is left alone', async ({ page }) => {
    await page.goto(FIXTURE + '?topic=999');
    await expect(page.locator('.iwac-vis-topic-explorer__loading')).toHaveCount(0);
    await expect(overviewActive(page)).toHaveCount(1);
    await expect(page).toHaveURL(/\?topic=999$/);

    const id = DATA.topics[2].id;
    await page.goto(FIXTURE + `?lang=en&topic=${id}`);
    await expect(detailTitle(page)).toHaveText(`Topic ${id}`);
    await expect(page).toHaveURL(new RegExp(`\\?lang=en&topic=${id}$`));
    // Replaced, not pushed: Back leaves the topic for the page before it,
    // rather than bouncing to an overview the reader never saw.
    await page.goBack();
    await expect(page).toHaveURL(/\?topic=999$/);
});

test('the detail’s copy-link button hands out the topic’s address', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const id = DATA.topics[0].id;
    await page.goto(FIXTURE + `?topic=${id}`);
    await expect(detailTitle(page)).toHaveText(`Topic ${id}`);
    await page.getByRole('button', { name: 'Copy link to this topic' }).click();
    await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText()))
        .toBe(new URL(`${FIXTURE}?topic=${id}`, page.url()).href);
});
