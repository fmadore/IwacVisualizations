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

test('the payload carries the keys validate_data.py requires of it', () => {
    for (const key of ['topics', 'metadata']) expect(DATA).toHaveProperty(key);
    expect(DATA.metadata.total_topics).toBe(DATA.topics.length);
});
