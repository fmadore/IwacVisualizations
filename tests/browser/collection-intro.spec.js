'use strict';
/**
 * Collection Introduction: the server's prose reading without JavaScript,
 * the Svelte introduction over it once collection-overview.json arrives,
 * each chapter's single play and the block's Replay, reduced motion, the
 * phone layout, both themes and both languages, the whole-block embed, and
 * what is left when the data or the geometry cannot be fetched — on
 * fixtures rendered from the production template
 * (tests/browser/render-collection-intro.php), fed the generator's golden
 * output.
 */
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const tokens = require('../../tokens.json');
const DATA = require('../golden/collection_overview/collection-overview.json');

const URL = '/tests/browser/fixtures/collection-intro';
const BLOCK = '[data-instance="collection-intro-1"]';
const NNBSP = ' ';

/** A tokens.json hex colour as getComputedStyle prints it. */
function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** Thousands grouped with U+202F, as the module's formatter does in both locales. */
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);

async function open(page, locale = 'en', query = '') {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${URL}.${locale}.html${query}`);
    await expect(page.locator(BLOCK)).toHaveAttribute('data-intro-ready', 'true');
    return errors;
}

/** Running CSS animations inside one chapter. */
function animationsIn(page, chapter) {
    return page.evaluate((id) => document.getAnimations()
        .filter((a) => a.effect && a.effect.target && a.effect.target.closest(`[data-chapter="${id}"]`)).length, chapter);
}

test('without JavaScript the prose reading is complete', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${URL}.en.html`);
    const block = page.locator(BLOCK);
    await expect(block.getByRole('heading', { level: 2, name: 'The Islam West Africa Collection' })).toBeVisible();
    await expect(block.getByRole('heading', { level: 3 })).toHaveText([
        'What it holds', 'Where it comes from', 'The years it covers', 'Languages and subjects',
    ]);
    await expect(block.locator('.iwac-vis-intro__sentence')).toHaveCount(4);
    await expect(block.locator('.iwac-vis-intro__plate, .iwac-vis-intro__numeral')).toHaveCount(0);
    await expect(block.getByRole('button')).toHaveCount(0);
    await context.close();
});

test('mounts over the same words, with a figure per chapter and nothing else fetched', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await open(page);
    const block = page.locator(BLOCK);
    await expect(block.locator('.iwac-vis-intro__figure')).toHaveCount(1);
    await expect(block.locator('.iwac-vis-intro__plate')).toHaveCount(4);
    await expect(block.getByRole('heading', { level: 3 })).toHaveCount(4);
    // The section is named by its title, at the level the editor chose.
    await expect(block.getByRole('region', { name: 'The Islam West Africa Collection' })).toBeVisible();
    // Drawings are hidden from assistive technology; their numbers are text.
    for (const drawing of ['.iwac-vis-intro__strip', '.iwac-vis-intro__map', '.iwac-vis-intro__bars']) {
        await expect(block.locator(drawing)).toHaveAttribute('aria-hidden', 'true');
    }
    expect(await page.evaluate(() => typeof window.echarts)).toBe('undefined');
    expect(await page.evaluate(() => window.__fetched)).toEqual([
        '/files/iwac-visualizations/collection-overview.json',
        '/modules/IwacVisualizations/asset/geo/iwac-countries.geojson',
    ]);
    expect(errors).toEqual([]);
});

test('every figure carries the data file’s numbers', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const block = page.locator(BLOCK);
    const s = DATA.summary;

    const what = block.locator('[data-chapter="what"]');
    await expect(what.locator('.iwac-vis-intro__numeral .iwac-vis-intro__count')).toHaveText(grouped(s.total_items));
    await expect(what.locator('.iwac-vis-intro__second dd .iwac-vis-intro__count')).toHaveText([grouped(s.index_entries), grouped(s.total_words)]);
    const dated = Object.fromEntries(Object.entries(DATA.types_over_time.series_global).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0)]));
    const types = what.locator('.iwac-vis-intro__ledger .iwac-vis-intro__row');
    await expect(types.locator('.iwac-vis-intro__name')).toHaveText([
        'Newspaper articles', 'Islamic periodicals', 'Audiovisual recordings', 'Archival documents', 'Scholarly references', 'Photographs',
    ]);
    await expect(types.locator('.iwac-vis-intro__num')).toHaveText([
        s.articles, dated.publication, dated.audiovisual, dated.document, s.references_count, s.photographs,
    ].map(grouped));
    await expect(what.locator('.iwac-vis-intro__segment')).toHaveCount(6);

    const where = block.locator('[data-chapter="where"]');
    await expect(where.locator('.iwac-vis-intro__numeral .iwac-vis-intro__count')).toHaveText(String(s.countries));
    const countries = [...DATA.countries].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    await expect(where.locator('.iwac-vis-intro__row .iwac-vis-intro__name')).toHaveText(countries.map((c) => c.name));
    await expect(where.locator('.iwac-vis-intro__row .iwac-vis-intro__num')).toHaveText(countries.map((c) => grouped(c.total)));
    // Every country on the map is named on it, so no tint has to be decoded.
    await expect(where.locator('.iwac-vis-intro__land')).toHaveCount(6);
    const names = await where.locator('.iwac-vis-intro__place-name').allTextContents();
    expect(names.map((n) => n.replace(/\s+/g, '')).sort()).toEqual(countries.map((c) => c.name.replace(/\s+/g, '')).sort());

    const when = block.locator('[data-chapter="when"]');
    const years = DATA.timeline.years;
    await expect(when.locator('.iwac-vis-intro__numeral .iwac-vis-intro__value')).toHaveText(`${years[0]}–${years[years.length - 1]}`);
    await expect(when.locator('.iwac-vis-intro__second dd .iwac-vis-intro__count')).toHaveText(String(s.newspapers));
    // The peak: the highest year, the later of a tie.
    let peak = 0;
    DATA.timeline.totals.forEach((count, i) => { if (count >= DATA.timeline.totals[peak]) peak = i; });
    await expect(when.locator('.iwac-vis-intro__peak-value')).toHaveText(`${years[peak]} · ${DATA.timeline.totals[peak]}`);
    // One bar a year with items, across a continuous axis (the data skips years).
    await expect(when.locator('.iwac-vis-intro__bar')).toHaveCount(years.length);
    expect(await when.locator('.iwac-vis-intro__bars').getAttribute('viewBox')).toBe(`0 0 ${years[years.length - 1] - years[0] + 1} 100`);
    const decadeTotals = await when.locator('.iwac-vis-intro__decade .iwac-vis-intro__num').allTextContents();
    expect(decadeTotals.reduce((a, t) => a + Number(t.replace(/\D/g, '')), 0))
        .toBe(DATA.timeline.totals.reduce((a, b) => a + b, 0));

    const voices = block.locator('[data-chapter="voices"]');
    await expect(voices.locator('.iwac-vis-intro__numeral .iwac-vis-intro__count')).toHaveText(String(s.languages));
    await expect(voices.locator('.iwac-vis-intro__ledger--bars .iwac-vis-intro__name')).toHaveText(['French', 'English', 'Hausa']);
    await expect(voices.locator('.iwac-vis-intro__group-name')).toHaveText(['People', 'Organisations', 'Subjects', 'Places', 'Events']);
    const person = DATA.top_entities.Personnes[0];
    await expect(voices.getByRole('link', { name: person.title })).toHaveAttribute('href', `/s/iwac/item/${person.o_id}`);

    await expect(block.locator('.iwac-vis-intro__foot')).toHaveText('Figures from the collection’s data as of January 1, 2026.');
});

test('each chapter plays once in view, Replay plays it again, and it rests on the real values', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    const block = page.locator(BLOCK);
    const what = block.locator('[data-chapter="what"]');
    const voices = block.locator('[data-chapter="voices"]');
    await what.scrollIntoViewIfNeeded();
    await expect(what).toHaveClass(/--playing/);
    expect(await animationsIn(page, 'what')).toBeGreaterThan(0);
    // Below the fold: not played yet, and complete as it rests.
    await expect(voices).not.toHaveClass(/--playing/);
    await expect(voices.locator('.iwac-vis-intro__ledger--bars .iwac-vis-intro__row')).toHaveCount(3);
    // Under two seconds, then nothing moves: no loop.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'), null, { timeout: 2500 });
    await expect(what.locator('.iwac-vis-intro__numeral .iwac-vis-intro__count')).toHaveText(grouped(DATA.summary.total_items));
    await voices.scrollIntoViewIfNeeded();
    await expect(voices).toHaveClass(/--playing/);
    // Replay from the keyboard restarts what is on screen.
    const replay = block.getByRole('button', { name: 'Replay animation' });
    await replay.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'), null, { timeout: 2500 });
    await replay.focus();
    await page.keyboard.press('Enter');
    await expect(replay).toBeFocused();
    expect(await animationsIn(page, 'what')).toBeGreaterThan(0);
});

test('reduced motion shows the final state and no Replay', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const block = page.locator(BLOCK);
    await expect(block.getByRole('button', { name: 'Replay animation' })).toHaveCount(0);
    for (const chapter of ['what', 'where', 'when', 'voices']) {
        const el = block.locator(`[data-chapter="${chapter}"]`);
        await el.scrollIntoViewIfNeeded();
        await expect(el).not.toHaveClass(/--playing/);
        expect(await animationsIn(page, chapter)).toBe(0);
    }
    await expect(block.locator('[data-chapter="what"] .iwac-vis-intro__numeral .iwac-vis-intro__count'))
        .toHaveText(grouped(DATA.summary.total_items));
});

test('a phone reads one column, words before figure, with nothing overflowing', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const chapter of ['what', 'where', 'when', 'voices']) {
        const el = page.locator(`${BLOCK} [data-chapter="${chapter}"]`);
        const text = await el.locator('.iwac-vis-intro__text').boundingBox();
        const plate = await el.locator('.iwac-vis-intro__plate').boundingBox();
        expect(plate.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
        expect(plate.x + plate.width).toBeLessThanOrEqual(376);
    }
});

test('the figures follow the theme toggle', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const bar = page.locator(`${BLOCK} .iwac-vis-intro__bar:not(.iwac-vis-intro__bar--peak)`).first();
    const dot = page.locator(`${BLOCK} .iwac-vis-intro__dot--article`).first();
    await expect(bar).toHaveCSS('fill', rgb(tokens.light['--ink-light']));
    await expect(dot).toHaveCSS('background-color', rgb(tokens.light['--type-article']));
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect(bar).toHaveCSS('fill', rgb(tokens.dark['--ink-light']));
    await expect(dot).toHaveCSS('background-color', rgb(tokens.dark['--type-article']));
});

for (const theme of ['light', 'dark']) {
    test(`no serious WCAG A/AA violation and a sound outline (${theme})`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open(page, 'en', `?theme=${theme}`);
        const report = (results) => results.violations
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        const wcag = await new AxeBuilder({ page }).include('.iwac-vis-intro')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(report(wcag)).toEqual([]);
        // h1 (page) → h2 (block) → h3 (chapters).
        const outline = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
        expect(report(outline)).toEqual([]);
        expect(outline.passes.map((p) => p.id)).toContain('heading-order');
    });
}

test('French page: the words come from fr.po, the numbers follow the page locale', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await open(page, 'fr');
    const block = page.locator(BLOCK);
    await expect(block.getByRole('heading', { level: 2, name: 'La collection Islam Afrique de l’Ouest' })).toBeVisible();
    await expect(block.getByRole('heading', { level: 3, name: 'Ce qu’elle contient' })).toBeVisible();
    await expect(block.locator('[data-chapter="what"] .iwac-vis-intro__unit')).toHaveText('documents');
    await expect(block.locator('[data-chapter="what"] .iwac-vis-intro__second dd .iwac-vis-intro__count').nth(1))
        .toHaveText(grouped(DATA.summary.total_words));
    // The decimal comma and the narrow space before the per cent sign.
    await expect(block.locator('[data-chapter="what"] .iwac-vis-intro__pct').first()).toHaveText(`50,0${NNBSP}%`);
    await expect(block.locator('[data-chapter="when"] .iwac-vis-intro__decade .iwac-vis-intro__sr').first()).toHaveText('années 1990');
    await expect(block.locator('[data-chapter="voices"] .iwac-vis-intro__ledger--bars .iwac-vis-intro__name').first()).toHaveText('Français');
    await expect(block.locator('[data-chapter="voices"] .iwac-vis-intro__group-name').first()).toHaveText('Personnes');
    await expect(block.locator('.iwac-vis-intro__foot')).toHaveText('Chiffres tirés des données de la collection au 1 janvier 2026.');
    expect(errors).toEqual([]);
});

test('one embed button for the whole block, with no configuration in its URL', async ({ page }) => {
    await page.addInitScript(() => {
        window.__iwacCopiedText = '';
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText(text) { window.__iwacCopiedText = text; return Promise.resolve(); } },
        });
    });
    await open(page);
    const button = page.locator(BLOCK).getByRole('button', { name: 'Copy embed code' });
    await expect(button).toHaveCount(1);
    await button.click();
    const snippet = await page.evaluate(() => window.__iwacCopiedText);
    expect(snippet).toContain('/s/iwac/iwac-embed/collection-intro"');
    expect(snippet).toContain('title="The Islam West Africa Collection"');
});

test('without its data the prose reading stays, and no figure is drawn', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/tests/golden/collection_overview/collection-overview.json', (route) => route.fulfill({ status: 404, body: 'Not found' }));
    await page.goto(`${URL}.en.html`);
    const block = page.locator(BLOCK);
    await expect.poll(() => page.evaluate(() => window.__fetched.length)).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await expect(block).not.toHaveAttribute('data-intro-ready', 'true');
    await expect(block.locator('.iwac-vis-intro__sentence')).toHaveCount(4);
    await expect(block.locator('.iwac-vis-intro__plate, .iwac-vis-intro__numeral, .iwac-vis-error, [role="alert"]')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('without the geometry the “Where” chapter keeps its ledger and loses only the map', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/asset/geo/iwac-countries.geojson', (route) => route.fulfill({ status: 404, body: 'Not found' }));
    await open(page);
    const where = page.locator(`${BLOCK} [data-chapter="where"]`);
    await expect(where.locator('.iwac-vis-intro__map')).toHaveCount(0);
    await expect(where.locator('.iwac-vis-intro__row')).toHaveCount(DATA.countries.length);
});
