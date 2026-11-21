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

/** A chapter link as `chapter#hash`; its other parameters are the page's own. */
function target(href) {
    const url = new URL(href, 'http://fixture.test');
    return (url.searchParams.get('albani.chapter') || '') + url.hash;
}

async function ready(page, query = '') {
    await page.goto(`${FIXTURE}?eager=1${query}`);
    await expect(page.locator('.iwac-vis-albani__loading')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__section')).toHaveCount(9);
    await expect(page.locator('[data-iwac-section="politics"] .iwac-vis-kwic-row').first()).toBeVisible();
}

test('every section renders from its own bundle, without a console problem', async ({ page }) => {
    const problems = watch(page);
    await ready(page);
    const sections = await page.locator('.iwac-vis-albani__section').evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-iwac-section')));
    expect(sections).toEqual(['corpus', 'vocabulary', 'entities', 'youth', 'politics', 'overlap', 'keyness', 'rhetoric', 'method']);
    const fetched = await page.evaluate(() => window.__fetched.map((u) => u.split('/').pop()).sort());
    expect(fetched).toEqual([
        'collocates.json', 'concordance-politics.json', 'concordance-youth.json', 'entities.json', 'keyness.json',
        'lexicon.json', 'metadata.json', 'network.json', 'overlap.json', 'rhetoric.json', 'vocabulary.json',
    ]);
    expect(problems).toEqual([]);
});

test('a sub-page shows its own sections, fetches only theirs, and links to the other pages', async ({ page }) => {
    const problems = watch(page);
    await page.goto(`${FIXTURE}?eager=1&sections=youth,politics,overlap&albani.scope=monologue`);
    await expect(page.locator('.iwac-vis-albani__loading')).toHaveCount(0);
    const sections = await page.locator('.iwac-vis-albani__section').evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-iwac-section')));
    expect(sections).toEqual(['youth', 'politics', 'overlap']);
    await expect(page.locator('[data-iwac-section="politics"] .iwac-vis-kwic-row').first()).toBeVisible();

    // The introduction and figures belong to the recordings page; the
    // switches every section reads stay.
    await expect(page.locator('.iwac-vis-albani__header')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__scope')).toHaveCount(1);
    const fetched = await page.evaluate(() => window.__fetched.map((u) => u.split('/').pop()).sort());
    expect(fetched).not.toContain('vocabulary.json');
    expect(fetched).not.toContain('keyness.json');
    expect(fetched).not.toContain('entities.json');

    // The contents: every section some page shows, in exhibition order —
    // this page's to their anchors, the others to their pages; the two no
    // page shows (people and places, rhetoric) are left out.
    const toc = await page.locator('.iwac-vis-albani__toc-link').evaluateAll((els) => els.map((a) => ({
        href: a.getAttribute('href'), here: a.parentElement.classList.contains('is-here'),
    })));
    expect(toc).toEqual([
        { href: '/s/iwac/page/albani#albani-corpus', here: false },
        { href: '/s/iwac/page/albani-vocabulary#albani-vocabulary', here: false },
        { href: '#albani-youth', here: true },
        { href: '#albani-politics', here: true },
        { href: '#albani-overlap', here: true },
        { href: '/s/iwac/page/albani-vocabulary#albani-keyness', here: false },
        { href: '/s/iwac/page/albani-method#albani-method', here: false },
    ]);
    await expect(page.locator('.iwac-vis-albani__jump')).toHaveAttribute('href', '/s/iwac/page/albani-method#albani-method');

    // Previous and next pages, by title.
    const pager = page.locator('.iwac-vis-albani__pager');
    await expect(pager.locator('.iwac-vis-albani__pager-link--prev')).toHaveAttribute('href', '/s/iwac/page/albani-vocabulary');
    await expect(pager.locator('.iwac-vis-albani__pager-link--prev')).toContainText('Vocabulary');
    await expect(pager.locator('.iwac-vis-albani__pager-link--next')).toHaveAttribute('href', '/s/iwac/page/albani-method');

    // Following one carries the reader's counting scope along.
    const next = pager.locator('.iwac-vis-albani__pager-link--next');
    await next.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
    await next.click();
    expect(new URL(await next.evaluate((a) => a.href)).searchParams.get('albani.scope')).toBe('monologue');
    expect(problems).toEqual([]);
});

test('the landing page sums up every chapter, with no other page to make', async ({ page }) => {
    const problems = watch(page);
    // Only "Landing page" ticked, and no other Albani page on the site.
    await page.goto(`${FIXTURE}?eager=1&sections=overview&nopages=1`);
    await expect(page.locator('.iwac-vis-albani__loading')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__header')).toHaveCount(1);
    await expect(page.locator('.iwac-vis-albani__section')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__toc')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__scope')).toHaveCount(0);
    const cards = await page.locator('.iwac-vis-albani__card').evaluateAll((els) => els.map((card) => ({
        title: card.querySelector('.iwac-vis-albani__card-link').textContent,
        href: card.querySelector('.iwac-vis-albani__card-link').getAttribute('href'),
        sections: [...card.querySelectorAll('.iwac-vis-albani__card-section-link')].map((a) => a.getAttribute('href')),
        texts: [...card.querySelectorAll('.iwac-vis-albani__card-text')].every((p) => p.textContent.length > 20),
    })));
    // Every link stays on this page and keeps its own parameters.
    for (const card of cards) {
        for (const href of [card.href, ...card.sections]) {
            expect(href.startsWith('/tests/browser/fixtures/albani-sermons.html?eager=1&sections=overview&nopages=1&albani.chapter=')).toBe(true);
        }
        card.href = target(card.href);
        card.sections = card.sections.map(target);
    }
    // A card lists what is inside only when a chapter holds several sections.
    expect(cards).toEqual([
        { title: 'The recordings', href: 'recordings', texts: true, sections: [] },
        { title: 'Vocabulary', href: 'vocabulary', texts: true,
            sections: ['vocabulary#albani-vocabulary', 'vocabulary#albani-keyness'] },
        { title: 'People and places', href: 'entities', texts: true, sections: [] },
        { title: 'Youth and politics', href: 'themes', texts: true,
            sections: ['themes#albani-youth', 'themes#albani-politics', 'themes#albani-overlap'] },
        { title: 'Style and rhetoric', href: 'rhetoric', texts: true, sections: [] },
        { title: 'How this was made', href: 'method', texts: true, sections: [] },
    ]);
    // Each card has its number, its sentence and a way in naming the chapter.
    await expect(page.locator('.iwac-vis-albani__card-number').first()).toHaveText('01');
    await expect(page.locator('.iwac-vis-albani__card-more').nth(3)).toHaveAttribute('aria-label', 'Read the chapter: Youth and politics');
    // The archive at a glance: one bar per recording, the undated after the dated.
    await expect(page.locator('.iwac-vis-albani__archive-bar')).toHaveCount(4);
    await expect(page.locator('.iwac-vis-albani__archive-plot')).toHaveAttribute('aria-label', /^4 recordings from 2008 to 2013/);
    expect(target(await page.locator('.iwac-vis-albani__jump').getAttribute('href'))).toBe('method#albani-method');
    // The summary itself reads only the metadata.
    const fetched = await page.evaluate(() => window.__fetched.map((u) => u.split('/').pop()));
    expect(fetched).toEqual(['metadata.json']);
    expect(problems).toEqual([]);
});

test('a chapter opens on the same page, alone, and leads to its neighbours and back', async ({ page }) => {
    const problems = watch(page);
    await page.goto(`${FIXTURE}?eager=1&sections=overview&nopages=1`);
    await expect(page.locator('.iwac-vis-albani__card')).toHaveCount(6);
    // Following a card keeps the reader's choices but never an old chapter.
    await page.evaluate(() => history.replaceState(null, '', location.href + '&albani.scope=monologue&albani.chapter=method'));
    await Promise.all([
        page.waitForURL(/albani\.chapter=themes/, { waitUntil: 'load' }),
        page.locator('.iwac-vis-albani__card-link', { hasText: 'Youth and politics' }).click(),
    ]);
    await expect(page.locator('.iwac-vis-albani__chapter-title')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('albani.scope')).toBe('monologue');
    expect(new URL(page.url()).searchParams.getAll('albani.chapter')).toEqual(['themes']);

    await expect(page.locator('.iwac-vis-albani__loading')).toHaveCount(0);
    const sections = await page.locator('.iwac-vis-albani__section').evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-iwac-section')));
    expect(sections).toEqual(['youth', 'politics', 'overlap']);
    await expect(page.locator('[data-iwac-section="politics"] .iwac-vis-kwic-row').first()).toBeVisible();
    await expect(page.locator('.iwac-vis-albani__chapter-title')).toHaveText('Youth and politics');
    await expect(page.locator('.iwac-vis-albani__header')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__card')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__scope')).toHaveCount(1);
    // Back to the summary: the same page and parameters, no chapter.
    await expect(page.locator('.iwac-vis-albani__back')).toHaveAttribute('href', '/tests/browser/fixtures/albani-sermons.html?eager=1&sections=overview&nopages=1');
    const fetched = await page.evaluate(() => window.__fetched.map((u) => u.split('/').pop()));
    expect(fetched).not.toContain('vocabulary.json');
    expect(fetched).not.toContain('entities.json');

    const pager = page.locator('.iwac-vis-albani__pager');
    expect(target(await pager.locator('.iwac-vis-albani__pager-link--prev').getAttribute('href'))).toBe('entities');
    await expect(pager.locator('.iwac-vis-albani__pager-link--prev')).toContainText('People and places');
    await expect(pager.locator('.iwac-vis-albani__pager-back')).toHaveText('Back to the summary');
    expect(target(await pager.locator('.iwac-vis-albani__pager-link--next').getAttribute('href'))).toBe('rhetoric');
    expect(problems).toEqual([]);

    // The first chapter has no previous one; an unknown chapter is the summary.
    await page.goto(`${FIXTURE}?eager=1&sections=overview&nopages=1&albani.chapter=recordings`);
    await expect(page.locator('.iwac-vis-albani__pager-link--prev')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__section')).toHaveCount(1);
    await page.goto(`${FIXTURE}?eager=1&sections=overview&nopages=1&albani.chapter=nonsense`);
    await expect(page.locator('.iwac-vis-albani__card')).toHaveCount(6);
});

test('a link into a section of a chapter lands on it once drawn', async ({ page }) => {
    await page.goto(`${FIXTURE}?eager=1&sections=overview&nopages=1&albani.chapter=themes#albani-overlap`);
    await expect(page.locator('.iwac-vis-albani__loading')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
        const h = document.getElementById('albani-overlap').getBoundingClientRect();
        return h.top >= -2 && h.top < window.innerHeight / 2;
    })).toBe(true);
});

test('a block without the setting is unchanged', async ({ page }) => {
    await ready(page);
    await expect(page.locator('.iwac-vis-albani__card')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__pager')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__toc-item.is-here')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-albani__jump')).toHaveAttribute('href', '#albani-method');
});

test('the French landing page reads French', async ({ page }) => {
    await page.goto(`${FIXTURE}?eager=1&sections=overview&nopages=1&lang=fr`);
    await expect(page.locator('.iwac-vis-albani__overview')).toHaveAttribute('aria-label', 'L’exposition, chapitre par chapitre');
    await expect(page.locator('.iwac-vis-albani__card-link').nth(3)).toHaveText('Jeunesse et politique');
    await page.goto(`${FIXTURE}?eager=1&sections=overview&nopages=1&lang=fr&albani.chapter=method`);
    await expect(page.locator('.iwac-vis-albani__back')).toHaveText('Retour au sommaire');
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
    await expect(method.locator('.iwac-vis-albani__method-item')).toHaveCount(12);
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
    await expect(page.locator('.iwac-vis-albani__toc-link')).toHaveCount(9);
    await expect(page.locator('.iwac-vis-albani__toc-link').first()).toHaveAttribute('href', '#albani-corpus');
    // Vocabulary frequency table glosses follow the same switch.
    const vocabGlosses = page.locator('[data-iwac-panel="albani-vocab-list"] .iwac-vis-albani__vocab-gloss');
    await expect(vocabGlosses).toHaveCount(0);
    await page.locator('[data-iwac-control="albani-glosses:on"]').click();
    await expect.poll(() => vocabGlosses.count()).toBeGreaterThan(0);
});

test('meetings passages are rights-gated and filterable, and KWIC search folds Hausa orthography', async ({ page }) => {
    await ready(page);
    const panel = page.locator('[data-iwac-panel="albani-overlap-passages"]');
    const rows = panel.locator('.iwac-vis-kwic-row');
    await expect(rows).toHaveCount(2);
    await expect(panel).toContainText('counted above but not quoted');
    // Hooked Hausa ƴ folds to 'y, matching "'yan siyasa" in the passage context.
    const search = panel.locator('.iwac-vis-albani__search');
    await search.fill('ƴan siyasa');
    await expect(rows).toHaveCount(2);
    await search.fill('no-such-word');
    await expect(rows).toHaveCount(0);
    await search.fill('');
    await expect(rows).toHaveCount(2);
    await panel.locator('select[data-iwac-control="albani-overlap-politics"]').selectOption('sarki');
    await expect(rows).toHaveCount(1);

    // Theme KWIC search folds hooked letters (ƙ→k, ƴ→'y).
    const polRows = page.locator('[data-iwac-panel="albani-politics-kwic"] .iwac-vis-kwic-row');
    const polSearch = page.locator('[data-iwac-panel="albani-politics-kwic"] .iwac-vis-albani__search');
    await polSearch.fill('sarƙin');
    await expect(polRows).toHaveCount(2);
    await polSearch.fill('ƴan siyasa');
    await expect(polRows).toHaveCount(2);
    await polSearch.fill('no-such-word');
    await expect(polRows).toHaveCount(0);
});

test('corpus table filters by status and search, and youth collocates omits a duplicate pooled slice', async ({ page }) => {
    await page.route('**/albani-sermons/collocates.json*', async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        const sample = { w: 'ilimi', n: 6, s: 3, r: 2, bg: 20, ratio: 3.1 };
        ['all', 'monologue'].forEach((scope) => {
            data.scopes[scope].youth.pooled = { terms: [sample] };
            data.scopes[scope].youth.youth = { terms: [sample] };
        });
        await route.fulfill({ response, json: data });
    });
    await ready(page);
    const corpusPanel = page.locator('[data-iwac-panel="albani-corpus-table"]');
    const tbodyRows = corpusPanel.locator('tbody tr');
    await expect(tbodyRows).toHaveCount(4);
    await corpusPanel.locator('select[data-iwac-control="albani-corpus-status"]').selectOption('legacy');
    await expect(tbodyRows).toHaveCount(1);
    await corpusPanel.locator('select[data-iwac-control="albani-corpus-status"]').selectOption('');
    await corpusPanel.locator('.iwac-vis-albani__search').fill('gurɓacewar');
    await expect(tbodyRows).toHaveCount(1);
    await corpusPanel.locator('.iwac-vis-albani__search').fill('daga');
    await expect(tbodyRows).toHaveCount(2);

    const youthOpts = await page.locator('select[data-iwac-control="albani-youth-collocates"] option').evaluateAll(
        (els) => els.map((o) => o.value));
    expect(youthOpts).toEqual(['youth']);
});

test('style and rhetoric section states the methodological limit, shades by scheme, and gates passages', async ({ page }) => {
    await ready(page);
    const section = page.locator('[data-iwac-section="rhetoric"]');
    await expect(section.locator('.iwac-vis-albani__rhetoric-limit')).toContainText('karin magana');
    await expect(section.locator('.iwac-vis-albani__rhetoric-limit')).toContainText('separate what is directly measurable');
    await expect(section).not.toContainText(/abdoulaye/i);

    // Score switches cleanly between all measurable devices and oaths.
    await section.locator('[data-iwac-control="albani-rhetoric-measure:oath_emphasis"]').click();
    await expect(section.locator('[data-iwac-control="albani-rhetoric-measure:oath_emphasis"]'))
        .toHaveAttribute('aria-pressed', 'true');

    // Passages panel quotes public transcript only and filters by device.
    const passages = section.locator('[data-iwac-panel="albani-rhetoric-passages"]');
    await expect(passages).toContainText('counted above but not quoted');
    const rows = passages.locator('.iwac-vis-kwic-row');
    await expect(rows).toHaveCount(3);
    await passages.locator('select[data-iwac-control="albani-rhetoric-device"]').selectOption('oath_emphasis');
    await expect(rows).toHaveCount(2);
    await passages.locator('[data-iwac-control="albani-rhetoric-tier:2"]').click();
    await expect(rows).toHaveCount(0);
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

/* --------------------------------------------------------------------- */
/*  The single-panel embed: only the panel's section, only its bundles    */
/* --------------------------------------------------------------------- */

test('every panel the page builds is claimed by the section that builds it', async ({ page }) => {
    // The single-panel embed builds the section a key is claimed by; a panel
    // added without a claim would embed as the whole exhibition, and a
    // claim no panel answers would embed as one empty section.
    await ready(page);
    await expect(page.locator('[data-iwac-section="entities"] [data-iwac-panel="albani-orgs"]')).toHaveCount(1);
    const { built, claimed } = await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('.iwac-vis-albani__section').forEach((section) => {
            out[section.getAttribute('data-iwac-section')] = Array.from(
                section.querySelectorAll('.iwac-vis-panel[data-iwac-panel]'),
                (p) => p.getAttribute('data-iwac-panel')).sort();
        });
        const panels = window.IWACVis.albaniSermons.PANELS;
        const keys = {};
        Object.keys(panels).forEach((s) => { keys[s] = Object.values(panels[s]).sort(); });
        return { built: out, claimed: keys };
    });
    expect(built).toEqual(claimed);
    // Nothing outside a section is a panel the embed could be asked for.
    await expect(page.locator('.iwac-vis-albani__root > .iwac-vis-panel')).toHaveCount(0);
});

const SINGLE = [
    { key: 'albani-score', section: 'overlap', bundles: ['lexicon.json', 'metadata.json', 'overlap.json'] },
    { key: 'albani-overlap-pairs', section: 'overlap', bundles: ['lexicon.json', 'metadata.json', 'overlap.json'] },
    { key: 'albani-overlap-passages', section: 'overlap', bundles: ['lexicon.json', 'metadata.json', 'overlap.json'] },
    { key: 'albani-rhetoric-score', section: 'rhetoric', bundles: ['metadata.json', 'rhetoric.json'] },
    { key: 'albani-rhetoric-passages', section: 'rhetoric', bundles: ['metadata.json', 'rhetoric.json'] },
    { key: 'albani-youth-kwic', section: 'youth',
        bundles: ['collocates.json', 'concordance-youth.json', 'lexicon.json', 'metadata.json', 'network.json'] },
    { key: 'albani-places', section: 'entities', bundles: ['entities.json', 'metadata.json'] },
    { key: 'albani-people', section: 'entities', bundles: ['entities.json', 'metadata.json'] },
    { key: 'albani-corpus-timeline', section: 'corpus', bundles: ['metadata.json'] },
];

for (const { key, section, bundles } of SINGLE) {
    test(`the ${key} embed builds its own section alone, from its own bundles`, async ({ page }) => {
        const problems = watch(page);
        // No ?eager: a frame showing one panel never scrolls to its section.
        await page.goto(`${FIXTURE}?embed=${key}`);
        await expect(page.locator('body')).toHaveClass(/iwac-embed-ready/);
        const target = page.locator(`[data-iwac-panel="${key}"]`);
        await expect(target).toHaveAttribute('data-iwac-panel-active', '1');
        await expect(target).toBeVisible();
        await expect(page.locator('.iwac-vis-panel:visible')).toHaveCount(1);
        const sections = await page.locator('.iwac-vis-albani__section').evaluateAll(
            (els) => els.map((el) => el.getAttribute('data-iwac-section')));
        expect(sections).toEqual([section]);
        await expect(page.locator('.iwac-vis-albani__header')).toHaveCount(0);
        await expect(page.locator('.iwac-vis-albani__section .iwac-vis-section-heading')).toBeHidden();
        const fetched = await page.evaluate(() => window.__fetched.map((u) => u.split('/').pop()).sort());
        expect(fetched).toEqual(bundles);
        expect(problems).toEqual([]);
    });
}

test('a frame keeps the block unpainted until its panel is pinned', async ({ page }) => {
    // Hold the section's bundle back: the frame has its section, its
    // spinner, and nothing else to show.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/albani-sermons/overlap.json*', async (route) => {
        await held;
        await route.continue();
    });
    await page.goto(`${FIXTURE}?embed=albani-overlap-pairs`);
    await expect(page.locator('[data-iwac-section="overlap"]')).toHaveCount(1);
    await expect(page.locator('body')).not.toHaveClass(/iwac-embed-ready/);
    await expect(page.locator('.iwac-vis-albani')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('[data-iwac-section="overlap"] .iwac-vis-section-heading')).toBeHidden();
    // Its loading state is the one thing that shows.
    await expect(page.locator('[data-iwac-section="overlap"] .iwac-vis-loading')).toBeVisible();

    release();
    await expect(page.locator('body')).toHaveClass(/iwac-embed-ready/);
    await expect(page.locator('.iwac-vis-albani')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('[data-iwac-panel="albani-overlap-pairs"]')).toBeVisible();
});

test('a framed panel tells its host one height, the panel’s', async ({ page }) => {
    const src = encodeURIComponent(`${FIXTURE}?embed=albani-overlap-pairs`);
    await page.goto(`/tests/browser/fixtures/embed-host.html?src=${src}`);
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-iwac-panel="albani-overlap-pairs"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__heights.length)).toBeGreaterThan(0);
    const heights = await page.evaluate(() => window.__heights);
    // The whole exhibition is tens of thousands of pixels; the panel is not.
    expect(Math.max(...heights)).toBeLessThan(1500);
    const panelHeight = await frame.locator('[data-iwac-panel="albani-overlap-pairs"]')
        .evaluate((el) => el.getBoundingClientRect().height);
    expect(heights[0]).toBeGreaterThanOrEqual(Math.floor(panelHeight));
});

test('a panel key no section claims frames the whole exhibition', async ({ page }) => {
    await page.goto(`${FIXTURE}?embed=albani-no-such-panel`);
    await expect(page.locator('body')).toHaveClass(/iwac-embed-ready/);
    await expect(page.locator('.iwac-vis-albani__section')).toHaveCount(9);
    await expect(page.locator('.iwac-vis-albani__header')).toBeVisible();
    await expect(page.locator('[data-iwac-panel-active]')).toHaveCount(0);
});
