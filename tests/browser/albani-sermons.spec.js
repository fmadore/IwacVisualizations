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
    await expect(page.locator('.iwac-vis-albani__section')).toHaveCount(8);
    await expect(page.locator('[data-iwac-section="politics"] .iwac-vis-kwic-row').first()).toBeVisible();
}

test('every section renders from its own bundle, without a console problem', async ({ page }) => {
    const problems = watch(page);
    await ready(page);
    const sections = await page.locator('.iwac-vis-albani__section').evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-iwac-section')));
    expect(sections).toEqual(['corpus', 'vocabulary', 'entities', 'youth', 'politics', 'overlap', 'keyness', 'method']);
    const fetched = await page.evaluate(() => window.__fetched.map((u) => u.split('/').pop()).sort());
    expect(fetched).toEqual([
        'collocates.json', 'concordance-politics.json', 'concordance-youth.json', 'entities.json', 'keyness.json',
        'lexicon.json', 'metadata.json', 'network.json', 'overlap.json', 'vocabulary.json',
    ]);
    expect(problems).toEqual([]);
});

test('the transcripts still being redone are named, and the democracy caveat waits on Demokuradiyyah alone', async ({ page }) => {
    // The fixture holds back Shari'a only: the caveat names Demokuradiyyah,
    // so it must not show for another recording's re-transcription.
    await ready(page);
    await expect(page.locator('.iwac-vis-albani__status')).toContainText("Shari'a");
    await expect(page.locator('.iwac-vis-albani__caveat')).toHaveCount(0);

    await page.route('**/albani-sermons/metadata.json*', async (route) => {
        const response = await route.fetch();
        const metadata = await response.json();
        metadata.recordings.push({ o: '15850', t: 'Demokuradiyyah', st: 'legacy', lang: ['Haoussa'] });
        await route.fulfill({ response, json: metadata });
    });
    await ready(page);
    await expect(page.locator('.iwac-vis-albani__caveat')).toContainText('Demokuradiyyah');
});

test('once nothing is being re-transcribed, neither the timeline nor the method says so', async ({ page }) => {
    const legend = () => page.evaluate(() => {
        const el = document.querySelector('[data-iwac-panel="albani-corpus-timeline"] .iwac-vis-chart');
        return window.echarts.getInstanceByDom(el).getOption().series.map((s) => s.name);
    });
    const scope = page.locator('[data-iwac-section="method"] .iwac-vis-albani__method-item').nth(1);
    await ready(page);
    await expect(scope).toContainText('until it has been redone');

    // The live corpus since 2026-11-03: every transcript in the current format.
    await page.route('**/albani-sermons/metadata.json*', async (route) => {
        const response = await route.fetch();
        const metadata = await response.json();
        metadata.recordings.forEach((r) => {
            if (r.st === 'legacy') { r.st = 'analysed'; r.d = r.d || '2010'; r.dur = r.dur || 3600; }
        });
        await route.fulfill({ response, json: metadata });
    });
    await ready(page);
    const names = await legend();
    expect(names).not.toContain('Being re-transcribed');
    expect(names).toContain('Analysed');
    await expect(scope).toContainText('Every transcript is counted.');
    await expect(scope).not.toContainText('redone');
    await expect(page.locator('.iwac-vis-albani__status')).not.toContainText("Shari'a");
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
    await expect(method.locator('.iwac-vis-albani__method-item')).toHaveCount(11);
    await expect(method).toContainText('Bashir, Bichi and Adamu (2024)');
    await expect(method.getByRole('link', { name: 'https://doi.org/10.1186/s43067-024-00187-5' }))
        .toHaveAttribute('href', 'https://doi.org/10.1186/s43067-024-00187-5');
    await expect(method.locator('.iwac-vis-albani__references > li')).toHaveCount(5);
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
    expect(count).toBeGreaterThan(6);
    for (let i = 0; i < count; i++) {
        await expect(drawn.nth(i).getByRole('button', { name: 'Toggle fullscreen' })).toHaveCount(1);
    }
    // A row-sized matrix: its inline minimum height must not hold the
    // chart at page size once the panel is expanded.
    const panel = page.locator('[data-iwac-panel="albani-youth-profile"]');
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

test('the score has one cell per segment, and reshades by measure', async ({ page }) => {
    await ready(page);
    const panel = page.locator('[data-iwac-panel="albani-score"]');
    const read = () => page.evaluate(() => {
        const el = document.querySelector('[data-iwac-panel="albani-score"] .iwac-vis-chart');
        const series = window.echarts.getInstanceByDom(el).getOption().series;
        return {
            cells: series.filter((s) => s.type === 'heatmap').reduce((n, s) => n + s.data.length, 0),
            shaded: series[0].data.map((d) => d.value[2]),
        };
    });
    // Two analysed recordings of three segments each; the last segment of
    // each holds one meeting, built from two political terms.
    expect(await read()).toEqual({ cells: 6, shaded: [1, 1] });
    await panel.locator('[data-iwac-control="albani-score-measure:politics"]').click();
    await expect.poll(read).toEqual({ cells: 6, shaded: [2, 2] });
});

test('one switch shows or hides the translations, and the address remembers it', async ({ page }) => {
    await ready(page);
    const labels = () => page.evaluate(() => {
        const el = document.querySelector('[data-iwac-panel="albani-overlap-pairs"] .iwac-vis-chart');
        return window.echarts.getInstanceByDom(el).getOption().yAxis[0].data;
    });
    // The lexicon's gloss rides on each axis label, after a middle dot.
    expect((await labels()).every((l) => l.includes(' · '))).toBe(true);
    await page.locator('[data-iwac-control="albani-glosses:off"]').click();
    await expect(page).toHaveURL(/albani\.glosses=off/);
    await expect.poll(async () => (await labels()).some((l) => l.includes(' · '))).toBe(false);
    // The contents link every section by a stable anchor.
    await expect(page.locator('.iwac-vis-albani__toc-link')).toHaveCount(8);
    await expect(page.locator('.iwac-vis-albani__toc-link').first()).toHaveAttribute('href', '#albani-corpus');
});

test('the places named are mapped, the people and bodies listed by kind', async ({ page }) => {
    await ready(page);
    const section = page.locator('[data-iwac-section="entities"]');
    // Zaria, Kaduna and Nigeria are named in the fixture transcripts; the
    // map's source carries one feature per mapped place.
    await expect.poll(() => page.evaluate(() => {
        const map = (window.__fixtureMaps || [])[0];
        const src = map && map.getSource('albani-places');
        return src ? src._data.features.map((f) => f.properties.id).sort() : null;
    })).toEqual(['kaduna', 'nigeria', 'zaria']);
    await expect(section.locator('.iwac-vis-albani__map-legend-item')).toHaveCount(3);
    const orgs = section.locator('[data-iwac-panel="albani-orgs"]');
    await expect(orgs.locator('.iwac-vis-albani__group-title')).toHaveText(['Movements and communities', 'Schools and universities']);
    await expect(orgs.locator('.iwac-vis-albani__ledger-row').first().locator('.iwac-vis-albani__strip-cell')).toHaveCount(2);
});

test('the formulae are a ledger with one strip cell per recording', async ({ page }) => {
    await ready(page);
    const rows = page.locator('[data-iwac-panel="albani-formulae"] .iwac-vis-albani__ledger-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('.iwac-vis-albani__ledger-phrase')).toHaveText('wallahi');
    await expect(rows.first().locator('.iwac-vis-albani__ledger-spread')).toHaveText('in 2 of 2 recordings');
    await expect(rows.first().locator('.iwac-vis-albani__strip-cell')).toHaveCount(2);
});

test('signature words say so when no word clears the thresholds', async ({ page }) => {
    await ready(page);
    const panel = page.locator('[data-iwac-panel="albani-keyness"]');
    await expect(panel.locator('.iwac-vis-albani__sig')).toHaveCount(0);
    await expect(panel).toContainText('No word meets the thresholds');
    await panel.locator('[data-iwac-control="albani-keyness-facet:mode"]').click();
    await expect(panel).toContainText('No word meets the thresholds');
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
