'use strict';

/**
 * The article page's dashboards, booted the way article.phtml boots them.
 *
 * The fixture renders the server-side AI-sentiment panel with the template's
 * own loop (French strings from language/fr.po), then loads the bundles the
 * template's needs name — real ECharts and real d3-force from the test-only
 * npm copies, MapLibre stood in for by maplibre-stub.js — and serves the
 * per-article bundle from tests/browser/fixtures/data/. Nothing here mocks
 * the module's own code: the context network is the shared canvas force
 * graph, further reading the real card grid, the map the shared map helpers
 * against the stub.
 *
 * Every date in the bundle is a calendar date, so the whole file runs in New
 * York: a formatter that read them in the visitor's zone would print the day
 * before (X-03).
 */

const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const tokens = require('../../tokens.json');

const FIXTURE = '/tests/browser/fixtures/article-dashboard.html';
const NNBSP = ' ';
const NBSP = ' ';

test.use({ timezoneId: 'America/New_York' });

/** Console errors and warnings, and uncaught exceptions, for the whole test. */
function watch(page) {
    const problems = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    return problems;
}

/** Load the fixture and wait until every panel has drawn. */
async function ready(page, query = '') {
    await page.goto(FIXTURE + query);
    await expect(page.locator('.iwac-vis-article__loading')).toHaveCount(0);
    await expect(page.locator('.iwac-vis-graph-canvas')).toBeVisible();
    await expect(page.locator('.iwac-vis-map canvas.maplibregl-canvas')).toBeVisible();
    // The stub publishes `maplibregl` a beat after the panels render, like the
    // parallel ES-module import; the circle layer lands on its style.load.
    await expect.poll(() => page.evaluate(() => {
        const map = window.__fixtureMaps[0];
        return !!(map && map.getLayer('article-place-circles'));
    })).toBe(true);
}

function hexRgb(hex) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** `#rrggbb` or `rgb(r, g, b)` → [r, g, b]. */
function rgbOf(color) {
    if (/^#/.test(color)) return hexRgb(color);
    return color.match(/[\d.]+/g).slice(0, 3).map(Number);
}

/** How many fully opaque canvas pixels are exactly each colour. */
function canvasCounts(page, hexes) {
    return page.evaluate((targets) => {
        const canvas = document.querySelector('.iwac-vis-graph-canvas');
        const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const want = targets.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
        const counts = targets.map(() => 0);
        for (let p = 0; p < data.length; p += 4) {
            if (data[p + 3] !== 255) continue;
            for (let t = 0; t < want.length; t++) {
                if (data[p] === want[t][0] && data[p + 1] === want[t][1] && data[p + 2] === want[t][2]) {
                    counts[t]++;
                    break;
                }
            }
        }
        return counts;
    }, hexes);
}

const ENTITY_TOKENS = {
    Personnes: '--type-entity-personnes',
    Organisations: '--type-entity-organisations',
    Lieux: '--type-entity-lieux',
    Sujets: '--type-entity-sujets',
    'Événements': '--type-entity-evenements',
    article: '--type-article',
};

for (const theme of ['light', 'dark']) {
    test(`boots every panel without a console or page error (${theme})`, async ({ page }) => {
        const problems = watch(page);
        await ready(page, `?theme=${theme}`);

        // One request: this article's bundle, from the data root.
        expect(await page.evaluate(() => window.__fetched))
            .toEqual(['/files/iwac-visualizations/article-dashboards/4321.json']);

        // The section opens on the block's h2; every panel under it is an h3.
        await expect(page.locator('.iwac-vis-block > h2')).toHaveText('Visualisations');
        await expect(page.locator('.iwac-vis-panel > h3')).toHaveText([
            'AI sentiment',
            'This article’s catalogue connections',
            'Further reading',
            'Places associated with this article',
        ]);

        // The server-rendered sentiment panel survives the boot beside the
        // dashboard: three axes, a lane per rating model, and the verdicts.
        const sentiment = page.locator('.iwac-vis-article__sentiment');
        await expect(sentiment.locator('.iwac-vis-sent-axis')).toHaveCount(3);
        await expect(sentiment.locator('.iwac-vis-sent-lane')).toHaveCount(9);
        await expect(sentiment.locator('.iwac-vis-sent-axis__verdict'))
            .toHaveText(['Models nearly agree', 'Models agree', 'Models disagree']);
        // Each vendor mark loaded (an SVG served with the wrong type is a
        // broken image, which no other assertion would notice).
        await expect.poll(() => sentiment.locator('.iwac-vis-sent-lane__logo').evaluateAll(
            (imgs) => imgs.filter((img) => img.complete && img.naturalWidth > 0).length)).toBe(9);

        // The context network: a painted canvas and a legend chip per type,
        // in the shared order.
        const canvas = await page.locator('.iwac-vis-graph-canvas').boundingBox();
        expect(canvas.width).toBeGreaterThan(300);
        expect(canvas.height).toBeGreaterThan(300);
        await expect(page.locator('.iwac-vis-graph-legend .iwac-vis-type-chip')).toHaveText([
            'People', 'Organisations', 'Places', 'Subjects', 'Events', 'Newspaper article',
        ]);

        // Further reading opens on the shared-tag cards.
        await expect(page.locator('.iwac-vis-further__grid .iwac-vis-article-card')).toHaveCount(4);

        // The map: two pins, one per geocoded place, on a named host.
        const host = page.locator('.iwac-vis-panel .iwac-vis-map');
        await expect(host).toHaveAttribute('role', 'group');
        await expect(host).toHaveAttribute('aria-label', 'Places associated with this article');
        expect(await page.evaluate(() => window.__fixtureMaps[0].queryRenderedFeatures({ layers: ['article-place-circles'] }).length))
            .toBe(2);

        expect(problems).toEqual([]);
    });
}

test('further reading switches between tags, content and scholarship', async ({ page }) => {
    await ready(page);
    const panel = page.locator('.iwac-vis-panel').filter({ hasText: 'Further reading' });
    const cards = panel.locator('.iwac-vis-article-card');

    const first = cards.first();
    await expect(first).toHaveAttribute('href', '/s/iwac/item/4401');
    await expect(first.locator('.iwac-vis-article-card__shared')).toHaveText('4 shared tags');
    // Three sample ids ride along for the tooltip, whatever the count.
    await expect(first.locator('.iwac-vis-article-card__shared'))
        .toHaveAttribute('title', 'Shares: Tabaski, Ouagadougou, Conseil supérieur des imams');
    await expect(cards.nth(3).locator('.iwac-vis-article-card__shared')).toHaveText('1 shared tag');
    // A calendar date keeps its day in New York.
    await expect(first.locator('.iwac-vis-article-card__meta')).toHaveText('Sidwaya · Burkina Faso · Nov 17, 2010');

    await panel.getByRole('button', { name: 'By similar content' }).click();
    await expect(cards).toHaveCount(3);
    await expect(cards.first().locator('.iwac-vis-article-card__sim')).toHaveText('92%');
    await expect(cards.first().locator('.iwac-vis-article-card__sim')).toHaveAttribute('title', 'Similarity: 91.8%');

    await panel.getByRole('button', { name: 'In the scholarship' }).click();
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toHaveAttribute('href', '/s/iwac/item/9101');
    await expect(cards.first().locator('.iwac-vis-article-card__meta')).toHaveText('Otayek, René, Cissé, Issa · Book · 2003');
    await expect(cards.nth(1).locator('.iwac-vis-article-card__meta')).toHaveText('Madore, Frédérick · Journal article · 2016');
});

test('the map tabulates its places and opens a pin’s record', async ({ page }) => {
    await ready(page);
    const panel = page.locator('.iwac-vis-panel').filter({ has: page.locator('.iwac-vis-map') });

    await panel.getByRole('button', { name: 'View as table' }).click();
    const rows = panel.locator('.iwac-vis-panel-table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByRole('link')).toHaveText('Bobo-Dioulasso');
    await expect(rows.first().getByRole('link')).toHaveAttribute('href', '/s/iwac/item/501');
    await expect(rows.nth(1).getByRole('link')).toHaveAttribute('href', '/s/iwac/item/502');
    await panel.getByRole('button', { name: 'Hide table' }).click();

    // The CSV is named for the panel's title, an h3 on the item page. The
    // export looked for an h4, so every promoted panel's file was "iwac-chart".
    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Download CSV' }).click();
    expect((await download).suggestedFilename()).toBe('places-associated-with-this-article.csv');

    // The view was fitted to the two pins; click Ouagadougou's.
    const pin = await page.evaluate(() => window.__fixtureMaps[0].project([-1.5197, 12.3714]));
    const box = await panel.locator('canvas.maplibregl-canvas').boundingBox();
    expect(pin.x).toBeGreaterThan(0);
    expect(pin.x).toBeLessThan(box.width);
    await page.mouse.click(box.x + pin.x, box.y + pin.y);
    const popup = panel.locator('.iwac-vis-maplibre-popup');
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('link', { name: 'Ouagadougou' })).toHaveAttribute('href', '/s/iwac/item/502');
    await expect(popup).toContainText('Mentioned in this article');
});

test.describe('in French', () => {
    test('labels, typography, number and date formats follow the page', async ({ page }) => {
        const problems = watch(page);
        await ready(page, '?lang=fr');

        await expect(page.locator('.iwac-vis-panel > h3')).toHaveText([
            'Sentiment IA',
            'Liens de cet article dans le catalogue',
            'Pour aller plus loin',
            'Lieux associés à cet article',
        ]);
        await expect(page.locator('.iwac-vis-sent-axis__verdict'))
            .toHaveText(['Les modèles s’accordent presque', 'Les modèles s’accordent', 'Les modèles divergent']);
        await expect(page.locator('.iwac-vis-sent-lane__reading').first()).toHaveText('Positif');
        // `%s` is a placeholder, not a percent sign: it takes no narrow
        // no-break space before it, or "par" fuses with the first rater.
        const description = await page.locator('.iwac-vis-article__sentiment .iwac-vis-panel-desc').textContent();
        expect(description).toContain('séparément par GPT-5.6 Luna, Mistral Small 4, DeepSeek V4 Flash.');

        await expect(page.locator('.iwac-vis-graph-legend .iwac-vis-type-chip')).toHaveText([
            'Personnes', 'Organisations', 'Lieux', 'Sujets', 'Événements', 'Article de presse',
        ]);
        await expect(page.locator('.iwac-vis-graph-canvas')).toHaveAttribute('aria-label', /^Réseau des entités balisées/);

        const panel = page.locator('.iwac-vis-panel').filter({ hasText: 'Pour aller plus loin' });
        const cards = panel.locator('.iwac-vis-article-card');
        await expect(cards.first().locator('.iwac-vis-article-card__shared')).toHaveText('4 balises partagées');
        await expect(cards.nth(3).locator('.iwac-vis-article-card__shared')).toHaveText('1 balise partagée');
        await expect(cards.first().locator('.iwac-vis-article-card__meta'))
            .toHaveText('Sidwaya · Burkina Faso · 17 nov. 2010');
        await panel.getByRole('button', { name: 'Par contenu similaire' }).click();
        await expect(cards.first().locator('.iwac-vis-article-card__sim')).toHaveText(`92${NNBSP}%`);
        await expect(cards.first().locator('.iwac-vis-article-card__sim'))
            .toHaveAttribute('title', `Similarité${NBSP}: 91,8${NNBSP}%`);
        await panel.getByRole('button', { name: 'Dans la littérature' }).click();
        await expect(cards.first().locator('.iwac-vis-article-card__meta'))
            .toHaveText('Otayek, René, Cissé, Issa · Livre · 2003');

        const map = page.locator('.iwac-vis-panel').filter({ has: page.locator('.iwac-vis-map') });
        await expect(map.locator('.iwac-vis-map')).toHaveAttribute('aria-label', 'Lieux associés à cet article');
        await expect(map.getByRole('button', { name: 'Afficher en tableau' })).toBeVisible();
        await expect(map.getByRole('button', { name: 'Zoom avant' })).toBeVisible();

        expect(problems).toEqual([]);
    });
});

test('the light/dark toggle repaints the network, its legend and the map from the theme tokens', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await ready(page);

    const types = Object.keys(ENTITY_TOKENS);
    const expected = (theme) => types.map((type) => tokens[theme][ENTITY_TOKENS[type]]);
    const read = () => page.evaluate((list) => ({
        colours: list.map((type) => window.IWACVis.getEntityTypeColor(type)),
        chips: [...document.querySelectorAll('.iwac-vis-graph-legend .iwac-vis-type-chip__swatch')]
            .map((swatch) => getComputedStyle(swatch).backgroundColor),
        map: window.__fixtureMaps[0].getPaintProperty('article-place-circles', 'circle-color'),
        style: window.__fixtureMaps[0].styleHistory.slice(-1)[0],
    }), types);

    // The legend chips are in ENTITY_TYPE_ORDER, which is `types`' order.
    for (const theme of ['light', 'dark']) {
        if (theme === 'dark') {
            await page.evaluate(() => { document.body.dataset.theme = 'dark'; });
        }
        await expect.poll(async () => (await read()).chips.map(rgbOf)).toEqual(expected(theme).map(hexRgb));
        const seen = await read();
        expect(seen.colours.map(rgbOf), `${theme} entity colours`).toEqual(expected(theme).map(hexRgb));

        // The canvas itself: node discs paint in this theme's type colours
        // and none in the other theme's. Subjects are left out of the pixel
        // check only because their two theme values are 2 apart per channel.
        const distinct = ['Personnes', 'Organisations', 'Lieux', 'Événements'];
        const other = theme === 'light' ? 'dark' : 'light';
        await expect.poll(async () => {
            const own = await canvasCounts(page, distinct.map((t) => tokens[theme][ENTITY_TOKENS[t]]));
            return own.every((n) => n > 40);
        }, { message: `${theme} type colours on the canvas` }).toBe(true);
        const stale = await canvasCounts(page, distinct.map((t) => tokens[other][ENTITY_TOKENS[t]]));
        expect(stale, `no ${other} type colours left on the canvas`).toEqual([0, 0, 0, 0]);

        // The map swaps basemap and re-adds its pins in this theme's primary.
        await expect.poll(async () => rgbOf((await read()).map || '#000000'))
            .toEqual(hexRgb(tokens[theme]['--primary']));
        expect((await read()).style).toMatch(theme === 'light' ? /positron/ : /dark-matter/);
    }
    expect(problems).toEqual([]);
});

test('graph tooltips stay inside the panel, in place and in fullscreen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page);
    const panel = page.locator('.iwac-vis-panel').filter({ has: page.locator('.iwac-vis-graph-canvas') });

    // Sweep the pointer across the whole stage and measure every tooltip it
    // raises against the panel (and, in fullscreen, the viewport).
    const sweep = () => page.evaluate(() => {
        const canvas = document.querySelector('.iwac-vis-graph-canvas');
        const tip = document.querySelector('.iwac-vis-graph-tooltip');
        const panelEl = canvas.closest('.iwac-vis-panel');
        const c = canvas.getBoundingClientRect();
        const p = panelEl.getBoundingClientRect();
        let shown = 0;
        const outside = [];
        for (let y = c.top + 4; y < c.bottom - 4; y += 9) {
            for (let x = c.left + 4; x < c.right - 4; x += 9) {
                canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
                if (tip.hidden) continue;
                shown++;
                const t = tip.getBoundingClientRect();
                const outPanel = t.left < p.left || t.top < p.top || t.right > p.right || t.bottom > p.bottom;
                const outScreen = panelEl.matches('.iwac-vis-panel--fullscreen')
                    && (t.left < 0 || t.top < 0 || t.right > innerWidth || t.bottom > innerHeight);
                if (outPanel || outScreen) outside.push([Math.round(x - c.left), Math.round(y - c.top)]);
            }
        }
        canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }));
        return { shown, outside: outside.slice(0, 5) };
    });

    const inPlace = await sweep();
    expect(inPlace.shown).toBeGreaterThan(20);
    expect(inPlace.outside).toEqual([]);

    const before = await page.locator('.iwac-vis-graph-canvas').boundingBox();
    await panel.getByRole('button', { name: 'Toggle fullscreen' }).click();
    await expect(panel).toHaveClass(/iwac-vis-panel--fullscreen/);
    // The panel fills the screen and the stage re-measures before the sweep.
    const viewport = page.viewportSize();
    await expect.poll(async () => {
        const box = await panel.boundingBox();
        return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
    }).toEqual([0, 0, viewport.width, viewport.height]);
    await expect.poll(async () => (await page.locator('.iwac-vis-graph-canvas').boundingBox()).width)
        .toBeGreaterThan(before.width);
    const full = await sweep();
    expect(full.shown).toBeGreaterThan(20);
    expect(full.outside).toEqual([]);
    // The tooltip lives in the panel, so native fullscreen's top layer draws it.
    expect(await page.evaluate(() => document.querySelector('.iwac-vis-panel--fullscreen')
        .contains(document.querySelector('.iwac-vis-graph-tooltip')))).toBe(true);
});

test('an article with no bundle yet keeps its sentiment panel', async ({ page }) => {
    await page.goto(`${FIXTURE}?item=9999`);
    const block = page.locator('.iwac-vis-article');
    await expect(block.getByRole('status')).toHaveText('The data for this visualisation has not been published yet.');
    await expect(block.locator('.iwac-vis-article__loading')).toHaveCount(0);
    await expect(block.locator('.iwac-vis-article__sentiment .iwac-vis-sent-lane')).toHaveCount(9);
    await expect(block.locator('.iwac-vis-article__body')).toHaveCount(0);
});

test('a failed fetch retries in place, leaving the sentiment panel where it was', async ({ page }) => {
    let refused = 0;
    await page.route('**/tests/browser/fixtures/data/article-dashboards/4321.json', (route) => {
        if (refused++ === 0) return route.fulfill({ status: 503, body: 'busy' });
        return route.continue();
    });
    await page.goto(FIXTURE);
    const block = page.locator('.iwac-vis-article');
    const retry = block.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.locator('.iwac-vis-graph-canvas')).toBeVisible();
    await expect(retry).toHaveCount(0);
    // The banner was swapped for the dashboard; the server-rendered panel
    // before it was neither removed nor duplicated.
    await expect(block.locator('.iwac-vis-article__sentiment')).toHaveCount(1);
    await expect(block.locator('.iwac-vis-article__body')).toHaveCount(1);
});

test('the map panel reports an unavailable library instead of spinning', async ({ page }) => {
    await page.goto(`${FIXTURE}?maplibre=fail`);
    const panel = page.locator('.iwac-vis-panel').filter({ hasText: 'Places associated with this article' });
    await expect(panel.getByText('Map library unavailable')).toBeVisible();
    await expect(panel.locator('.iwac-vis-loading')).toHaveCount(0);
    // The rest of the dashboard is unaffected.
    await expect(page.locator('.iwac-vis-graph-canvas')).toBeVisible();
});

test('the offline renderers match the production pins', () => {
    const assets = readFileSync(path.join(__dirname, '../../view/common/iwac-assets.phtml'), 'utf8');
    for (const name of ['d3-dispatch', 'd3-quadtree', 'd3-timer', 'd3-force']) {
        // Read from disk: the packages' `exports` maps do not expose package.json.
        const manifest = path.join(__dirname, '../../node_modules', name, 'package.json');
        const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
        expect(assets, name).toContain(`${name}@${version}/dist/${name}.min.js`);
    }
});
