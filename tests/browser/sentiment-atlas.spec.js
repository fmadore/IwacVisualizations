'use strict';

/**
 * The Sentiment Atlas page block, booted the way _generic.phtml boots it.
 *
 * The default bundle is tests/browser/fixtures/data/sentiment-atlas.json: a
 * 1,234-row synthetic sample aggregated with generate_sentiment_atlas.py
 * v0.3.0's rules, so it has that generator's keys (and validate_data.py's
 * required ones) and every stack sums to its model's rated count. It is kept
 * at v0.3.0 on purpose: the block ships as a release while its data arrives
 * by a separate pull, so new code must keep drawing an older bundle.
 *
 * `?bundle=v4` serves sentiment-atlas-v4.json and its places sidecar instead:
 * what the v0.4.0 generator wrote over the seeded corpus in
 * tests/python/test_sentiment_atlas.py, for the comparison, trend, ranking
 * and map panels. Real ECharts, the real bundles, the theme's token cascade
 * from tokens.json, and the MapLibre stand-in.
 */

const { test, expect } = require('@playwright/test');
const tokens = require('../../tokens.json');
const DATA = require('./fixtures/data/sentiment-atlas.json');
const V4 = require('./fixtures/data/sentiment-atlas-v4.json');
const PLACES = require('./fixtures/data/sentiment-atlas-places.json');

const FIXTURE = '/tests/browser/fixtures/sentiment-atlas.html';
const NNBSP = ' ';
const NBSP = ' ';

const PANELS = [
    'polarity-by-year', 'centrality-by-year', 'subjectivity',
    'polarity-by-country', 'correlation', 'centrality-heatmap',
    'polarity-by-topic', 'polarity-by-newspaper', 'extremes',
    'model-pairs', 'model-agreement',
];

/** A v0.4.0 bundle adds the trend, ranking, map, calibration and dissent. */
const PANELS_V4 = [
    'polarity-by-year', 'centrality-by-year', 'subjectivity', 'model-trends',
    'polarity-by-country', 'correlation', 'centrality-heatmap',
    'polarity-by-topic', 'polarity-by-newspaper', 'newspaper-ranking', 'places-map',
    'extremes',
    'model-pairs', 'model-agreement', 'model-calibration', 'model-dissent',
];

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
    await expect(page.locator('.iwac-vis-sentiment-atlas .iwac-vis-loading')).toHaveCount(0);
    await expect(page.locator('[data-iwac-panel="model-agreement"] .iwac-vis-chart canvas').first()).toBeVisible();
}

/** The live option of the chart in one named panel. */
function option(page, key) {
    return page.evaluate((k) => {
        const el = document.querySelector(`[data-iwac-panel="${k}"] .iwac-vis-chart`);
        const opt = window.echarts.getInstanceByDom(el).getOption();
        return {
            series: opt.series.map((s) => ({
                name: s.name,
                type: s.type,
                color: s.itemStyle && s.itemStyle.color,
                data: (s.data || []).map((d) => (d && typeof d === 'object' && 'value' in d ? d.value : d)),
            })),
            xAxis: (opt.xAxis || []).map((a) => a.data),
            yAxis: (opt.yAxis || []).map((a) => a.data),
            visualMap: (opt.visualMap || []).map((v) => v.inRange && v.inRange.color),
            tooltip: (opt.tooltip || []).map((t) => ({ confine: t.confine })),
        };
    }, key);
}

for (const theme of ['light', 'dark']) {
    test(`boots every panel without a console or page error (${theme})`, async ({ page }) => {
        const problems = watch(page);
        await ready(page, `?theme=${theme}`);

        expect(await page.evaluate(() => window.__fetched))
            .toEqual(['/files/iwac-visualizations/sentiment-atlas.json']);

        // The intro: the corpus and each rater's coverage, grouped with U+202F
        // on the English site too.
        const cards = page.locator('.iwac-vis-sentiment-atlas > .iwac-vis-overview-root > .iwac-vis-overview-summary .iwac-vis-summary-card');
        await expect(cards).toHaveCount(4);
        await expect(cards.locator('.iwac-vis-summary-card__value'))
            .toHaveText([`1${NNBSP}234`, `1${NNBSP}187`, `1${NNBSP}156`, `1${NNBSP}123`]);
        await expect(cards.nth(1)).toContainText('Rated by GPT-5.6 Luna');
        await expect(page.getByText('Period covered: 2019 – 2024')).toBeVisible();
        await expect(page.locator('h2.iwac-vis-section-heading')).toHaveText([
            'Ratings over time', 'How the ratings break down',
            'Subjects associated with high and low ratings', 'Model comparison',
        ]);

        // Every panel, in order, each with a live chart that drew series.
        const keys = await page.locator('[data-iwac-panel]').evaluateAll((els) => els.map((el) => el.dataset.iwacPanel));
        expect(keys).toEqual(PANELS);
        for (const key of PANELS) {
            const opt = await option(page, key);
            expect(opt.series.length, `${key} series`).toBeGreaterThan(0);
            await expect(page.locator(`[data-iwac-panel="${key}"] .iwac-vis-chart canvas`).first()).toBeVisible();
        }
        expect((await option(page, 'polarity-by-year')).series.map((s) => s.name))
            .toEqual(['Very positive', 'Positive', 'Neutral', 'Negative', 'Very negative']);
        expect((await option(page, 'subjectivity')).series.map((s) => s.name))
            .toEqual(['GPT-5.6 Luna', 'Mistral Small 4', 'DeepSeek V4 Flash']);

        // The comparison, from a v0.3.0 bundle: polarity and exact agreement
        // only, so no dimension or measure facet, and one card for the
        // selected pair — never a kappa the bundle does not carry.
        const pairs = await option(page, 'model-pairs');
        expect(pairs.series[0].data.length).toBe(2 * DATA.agreement.length);
        await expect(page.locator('.iwac-vis-overview-root > .iwac-vis-facet-host').nth(1).getByRole('button'))
            .toHaveCount(0);
        await expect(page.locator('[data-iwac-panel="model-pairs"]').getByRole('button', { name: 'Weighted kappa' })).toHaveCount(0);
        const agreementPanel = page.locator('[data-iwac-panel="model-agreement"]');
        const agreement = agreementPanel.locator('.iwac-vis-summary-card');
        await expect(agreement).toHaveCount(1);
        await expect(agreementPanel.getByRole('button', { name: 'GPT-5.6 Luna × Mistral Small 4' }))
            .toHaveAttribute('aria-pressed', 'true');
        await expect(agreement.first()).toContainText('57.9%');
        await expect(agreement.first()).toContainText(`1${NNBSP}112 co-rated articles`);
        await expect(page.getByText('Rows: GPT-5.6 Luna · Columns: Mistral Small 4')).toBeVisible();
        await expect(page.getByText(`${DATA.models.gpt_5_6_luna.not_applicable} articles rated “Not applicable” by this model are excluded from the polarity stacks.`)).toBeVisible();

        expect(problems).toEqual([]);
    });
}

test('the outline runs h1, the sections at h2, their panels at h3', async ({ page }) => {
    await ready(page);
    // The page block has no heading of its own: its sections are the page's.
    // They were h3 under the h1, with panels at h4 (axe: heading-order).
    const outline = await page.locator('main').evaluate((main) =>
        Array.from(main.querySelectorAll('h1, h2, h3, h4, h5, h6'))
            .map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.trim() })));
    expect(outline[0]).toEqual({ level: 1, text: 'Sentiment Atlas' });
    for (let i = 1; i < outline.length; i++) {
        expect(outline[i].level - outline[i - 1].level, `"${outline[i].text}" skips a level`).toBeLessThanOrEqual(1);
    }
    expect(outline.filter((h) => h.level === 2).map((h) => h.text)).toEqual([
        'Ratings over time', 'How the ratings break down',
        'Subjects associated with high and low ratings', 'Model comparison',
    ]);
    // Spearman's rho under the cross-tab, from counts a v0.3.0 bundle has.
    await expect(page.locator('[data-iwac-panel="correlation"]').getByText(/^Spearman’s ρ = [+−-]?\d/)).toBeVisible();
    const titles = await page.locator('[data-iwac-panel]').evaluateAll((els) =>
        els.map((el) => el.firstElementChild.tagName));
    expect(titles).toEqual(PANELS.map(() => 'H3'));

    // Code that reads a panel's title follows it to h3. Both looked for an
    // h4: the embed picker would list every panel untitled, and the CSV and
    // PNG exports would all be called "iwac-chart".
    const headings = await page.locator('[data-iwac-panel] > h3').allTextContents();
    const listed = await page.evaluate(() => window.IWACVis.embed
        .enumeratePanels(document.querySelector('.iwac-vis-sentiment-atlas'))
        .map((info) => info.title));
    expect(listed).toEqual(headings);
    const download = page.waitForEvent('download');
    await page.locator('[data-iwac-panel="polarity-by-year"]').getByRole('button', { name: 'Download CSV' }).click();
    expect((await download).suggestedFilename()).toBe('polarity-over-time.csv');
});

test('the topic panel’s description counts the bundle’s topics', async ({ page }) => {
    // The fixture has three topics; the copy used to say thirty regardless.
    const desc = page.locator('[data-iwac-panel="polarity-by-topic"] .iwac-vis-panel-desc');
    expect(DATA.topics).toHaveLength(3);
    await ready(page);
    await expect(desc).toHaveText(/^Each of the 3 topics found by the statistical model as a share/);
    await expect(desc).not.toContainText('30');
    await ready(page, '?lang=fr');
    await expect(desc).toHaveText(/^Chacun des 3 thèmes dégagés par le modèle statistique/);
    await expect(desc).not.toContainText('30');

    // One topic reads in the singular, in both languages.
    await page.route('**/tests/browser/fixtures/data/sentiment-atlas.json', (route) =>
        route.fulfill({ json: { ...DATA, topics: DATA.topics.slice(0, 1) } }));
    await ready(page);
    await expect(desc).toHaveText(/^The one topic found by the statistical model as a share/);
    await expect(desc).toContainText('The topic name shows its two leading words');
    await ready(page, '?lang=fr');
    await expect(desc).toHaveText(/^Le seul thème dégagé par le modèle statistique/);
    await expect(desc).toContainText('Le nom du thème affiche ses deux mots principaux');
});

test('“View as table” lists each panel’s figures exactly', async ({ page }) => {
    await ready(page);
    const panel = page.locator('[data-iwac-panel="polarity-by-year"]');
    await panel.getByRole('button', { name: 'View as table' }).click();
    const table = panel.locator('.iwac-vis-panel-table table');
    await expect(table.locator('tbody tr')).toHaveCount(DATA.years.length);
    const head = await table.locator('thead th').allTextContents();
    expect(head.slice(1)).toEqual(['Very positive', 'Positive', 'Neutral', 'Negative', 'Very negative']);
    const first = await table.locator('tbody tr').first().locator('td').allTextContents();
    expect(first[0]).toBe(String(DATA.years[0]));
    const model = DATA.models.gpt_5_6_luna;
    expect(first.slice(1).map(Number))
        .toEqual(['Très positif', 'Positif', 'Neutre', 'Négatif', 'Très négatif'].map((l) => model.polarity_by_year[l][0]));

    const country = page.locator('[data-iwac-panel="polarity-by-country"]');
    await country.getByRole('button', { name: 'View as table' }).click();
    await expect(country.locator('.iwac-vis-panel-table tbody tr')).toHaveCount(DATA.countries.length);
    await expect(country.locator('.iwac-vis-panel-table tbody tr').first().locator('td').first()).toHaveText(DATA.countries[0]);
});

test('the model and sort facets repaint their panels and address the view', async ({ page }) => {
    await ready(page);
    await page.locator('.iwac-vis-facet-host').first().getByRole('button', { name: 'Mistral Small 4' }).click();
    const mistral = DATA.models.mistral_small_2603;
    await expect.poll(async () => (await option(page, 'polarity-by-year')).series[0].data)
        .toEqual(mistral.polarity_by_year['Très positif']);
    await expect(page.getByText(`${mistral.not_applicable} articles rated “Not applicable” by this model`)).toBeVisible();
    expect(new URL(page.url()).searchParams.get('sentiment.model')).toBe('mistral_small_2603');

    // Volume order on the topic panel: the count column follows the totals.
    const topics = page.locator('[data-iwac-panel="polarity-by-topic"]');
    await topics.getByRole('button', { name: 'Most articles first' }).click();
    const scale = DATA.polarity_order.filter((l) => l !== 'Non applicable');
    const totals = DATA.topics.map((_, i) => scale.reduce((sum, l) => sum + mistral.polarity_by_topic[l][i], 0))
        .sort((a, b) => b - a).map(String);
    await expect.poll(async () => (await option(page, 'polarity-by-topic')).yAxis[1]).toEqual(totals);

    // The addressed view survives a fresh load of the same URL.
    await ready(page, new URL(page.url()).search);
    await expect(page.locator('.iwac-vis-facet-host').first().getByRole('button', { name: 'Mistral Small 4' }))
        .toHaveAttribute('aria-pressed', 'true');
    await expect(topics.getByRole('button', { name: 'Most articles first' })).toHaveAttribute('aria-pressed', 'true');
});

test('reads in French: labels, ratings and number formats', async ({ page }) => {
    const problems = watch(page);
    await ready(page, '?lang=fr');

    await expect(page.locator('h2.iwac-vis-section-heading')).toHaveText([
        'Évaluations au fil du temps', 'Répartition des évaluations',
        'Sujets associés aux évaluations hautes et basses', 'Comparaison des modèles',
    ]);
    const cards = page.locator('.iwac-vis-sentiment-atlas > .iwac-vis-overview-root > .iwac-vis-overview-summary .iwac-vis-summary-card');
    await expect(cards.locator('.iwac-vis-summary-card__value').first()).toHaveText(`1${NNBSP}234`);
    await expect(cards.nth(1)).toContainText('Évalués par GPT-5.6 Luna');
    // The rating labels arrive in French and pass straight through.
    expect((await option(page, 'polarity-by-year')).series.map((s) => s.name))
        .toEqual(['Très positif', 'Positif', 'Neutre', 'Négatif', 'Très négatif']);
    expect((await option(page, 'centrality-by-year')).series.map((s) => s.name))
        .toEqual(['Très central', 'Central', 'Secondaire', 'Marginal', 'Non abordé']);

    const agreement = page.locator('[data-iwac-panel="model-agreement"] .iwac-vis-summary-card');
    await expect(agreement.first()).toContainText(`57,9${NNBSP}%`);
    await expect(agreement.first()).toContainText(`1${NNBSP}112 articles co-évalués`);
    await expect(page.getByText(`Lignes${NBSP}: GPT-5.6 Luna · Colonnes${NBSP}: Mistral Small 4`)).toBeVisible();
    await expect(page.getByText(`${DATA.models.gpt_5_6_luna.not_applicable} articles évalués «${NBSP}Non applicable${NBSP}» par ce modèle`)).toBeVisible();

    const panel = page.locator('[data-iwac-panel="polarity-by-year"]');
    await panel.getByRole('button', { name: 'Afficher en tableau' }).click();
    const head = await panel.locator('.iwac-vis-panel-table thead th').allTextContents();
    expect(head.slice(1)).toEqual(['Très positif', 'Positif', 'Neutre', 'Négatif', 'Très négatif']);
    await expect(page.locator('[data-iwac-panel="polarity-by-topic"]').getByRole('button', { name: 'Du plus fourni' })).toBeVisible();

    expect(problems).toEqual([]);
});

/**
 * Each composed ramp, as iwac-core.css declares it, written against the
 * THEME's tokens: evaluated inside the toggled body, it is what the chart must
 * paint. Comparing against the module token itself would agree with a stale
 * composition (a token computed once on :root and inherited frozen).
 */
const RAMPS = {
    'polarity-by-year': [
        'var(--success)',
        'color-mix(in oklab, var(--success) 55%, var(--surface))',
        'var(--muted)',
        'var(--warning)',
        'var(--error)',
    ],
    'centrality-by-year': [
        'var(--primary)',
        'color-mix(in oklab, var(--primary) 75%, var(--surface))',
        'color-mix(in oklab, var(--primary) 50%, var(--surface))',
        'color-mix(in oklab, var(--primary) 30%, var(--surface))',
        'var(--border-light)',
    ],
    'centrality-heatmap': [
        'color-mix(in oklab, var(--primary) 8%, var(--surface))',
        'color-mix(in oklab, var(--primary) 28%, var(--surface))',
        'color-mix(in oklab, var(--primary) 50%, var(--surface))',
        'color-mix(in oklab, var(--primary) 75%, var(--surface))',
        'var(--primary)',
    ],
    'model-agreement': ['var(--surface-raised)', 'var(--primary)'],
};

/** Every colour, evaluated in the page and read back as sRGB bytes. */
function toBytes(page, colours) {
    return page.evaluate((list) => {
        const probe = document.createElement('i');
        document.body.appendChild(probe);
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        const out = list.map((c) => {
            probe.style.color = '';
            probe.style.color = c;
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = getComputedStyle(probe).color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
        });
        probe.remove();
        return out;
    }, colours);
}

async function painted(page) {
    const out = {};
    for (const key of Object.keys(RAMPS)) {
        const opt = await option(page, key);
        const colours = opt.visualMap.length ? opt.visualMap[0] : opt.series.map((s) => s.color);
        out[key] = await toBytes(page, colours);
    }
    return out;
}

async function oracle(page) {
    const out = {};
    for (const [key, expressions] of Object.entries(RAMPS)) out[key] = await toBytes(page, expressions);
    return out;
}

const close = (a, b) => a.every((row, i) => row.every((v, j) => Math.abs(v - b[i][j]) <= 1));

test('the light/dark toggle repaints the charts and their composed ramps', async ({ page }) => {
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await ready(page);

    const light = await painted(page);
    const lightOracle = await oracle(page);
    for (const key of Object.keys(RAMPS)) expect(close(light[key], lightOracle[key]), `${key} light`).toBe(true);

    await page.evaluate(() => { document.body.dataset.theme = 'dark'; });
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
    const darkOracle = await oracle(page);
    await expect.poll(async () => {
        const dark = await painted(page);
        return Object.keys(RAMPS).filter((key) => !close(dark[key], darkOracle[key]));
    }, { message: 'ramps still painted from the light theme' }).toEqual([]);

    // And the dark ramps are really the dark ones: the lowest heat bucket
    // sits next to the dark surface, not next to the light one.
    const surface = (theme) => tokens[theme]['--surface'].match(/\w\w/g).map((h) => parseInt(h, 16));
    const lowest = darkOracle['centrality-heatmap'][0];
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(distance(lowest, surface('dark'))).toBeLessThan(distance(lowest, surface('light')));
    for (const key of Object.keys(RAMPS)) expect(close(darkOracle[key], lightOracle[key]), `${key} changed`).toBe(false);

    expect(problems).toEqual([]);
});

test('no panel offers fullscreen, and every tooltip is confined to its chart', async ({ page }) => {
    // The theme appends tooltips to <body>, which native fullscreen does not
    // draw (V-04): fine here only while no panel can go fullscreen.
    await ready(page);
    await expect(page.locator('.iwac-vis-panel-toolbar__btn--fullscreen, .iwac-vis-graph-toolbar')).toHaveCount(0);
    for (const key of PANELS) {
        const opt = await option(page, key);
        expect(opt.tooltip.every((t) => t.confine === true), `${key} tooltip confined`).toBe(true);
    }

    // A real hover: the tooltip opens beside the bar, inside the chart box.
    const chart = page.locator('[data-iwac-panel="polarity-by-year"] .iwac-vis-chart');
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    await page.mouse.move(box.x + box.width * 0.93, box.y + box.height * 0.5);
    const tip = page.locator('body > div').filter({ hasText: /Very positive/ }).filter({ hasText: /2024/ });
    await expect(tip).toBeVisible();
    const t = await tip.boundingBox();
    expect(t.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(t.x + t.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('the payload carries the keys validate_data.py requires of it', () => {
    // REQUIRED_KEYS["sentiment-atlas.json"] in scripts/validate_data.py.
    for (const key of ['models', 'years', 'summary']) expect(DATA).toHaveProperty(key);
    for (const model of Object.values(DATA.models)) {
        const rated = Object.values(model.polarity_by_year).flat().reduce((a, b) => a + b, 0);
        expect(rated).toBe(model.rated);
    }
});

/* ------------------------------------------------------------------------ */
/*  A v0.4.0 bundle: comparison on three dimensions, trends, ranking, map   */
/* ------------------------------------------------------------------------ */

const fmt = (n, digits = 2) => {
    const v = Math.round(n * 10 ** digits) / 10 ** digits;
    return String(v);
};

test('a v0.4.0 bundle boots every new panel, map included, without an error', async ({ page }) => {
    const problems = watch(page);
    await ready(page, '?bundle=v4');

    const keys = await page.locator('[data-iwac-panel]').evaluateAll((els) => els.map((el) => el.dataset.iwacPanel));
    expect(keys).toEqual(PANELS_V4);
    for (const key of PANELS_V4.filter((k) => k !== 'places-map')) {
        const opt = await option(page, key);
        expect(opt.series.length, `${key} series`).toBeGreaterThan(0);
    }

    // The map fetches its sidecar only as it nears the viewport.
    expect(await page.evaluate(() => window.__fetched))
        .toEqual(['/files/iwac-visualizations/sentiment-atlas.json']);
    const map = page.locator('[data-iwac-panel="places-map"]');
    await map.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.__fixtureMaps.length)).toBe(1);
    expect(await page.evaluate(() => window.__fetched))
        .toContain('/files/iwac-visualizations/sentiment-atlas-places.json');
    // Five grades and the neutral "too few" swatch; each bubble coloured
    // by a step over its own mean, not one colour for the layer.
    await expect(map.locator('.iwac-vis-key__item')).toHaveCount(6);
    const fill = await page.evaluate(() => window.__fixtureMaps[0]
        .getPaintProperty('iwac-sentiment-places-bubbles', 'circle-color'));
    expect(fill[0]).toBe('step');
    expect(fill.length).toBe(3 + 2 * 5);
    await expect(map.locator('details tbody tr')).toHaveCount(PLACES.places.length);

    expect(problems).toEqual([]);
});

test('the comparison follows the dimension, the measure and a click on a pair', async ({ page }) => {
    await ready(page, '?bundle=v4');
    const panel = (key) => page.locator(`[data-iwac-panel="${key}"]`);

    // The whole panel's Fleiss' kappa heads the pair matrix.
    const fleiss = V4.reliability.polarity.panel;
    await expect(panel('model-pairs').locator('p.iwac-vis-muted'))
        .toContainText(`Fleiss’ kappa ${fmt(fleiss.fleiss_kappa)}`);
    // Weighted kappa by default: each cell rounded to two places.
    const firstPair = V4.reliability.polarity.pairs[0];
    expect((await option(page, 'model-pairs')).series[0].data)
        .toContainEqual([1, 0, Math.round(firstPair.weighted_kappa * 100) / 100]);
    // The selected pair's four measures.
    await expect(panel('model-agreement').locator('.iwac-vis-summary-card')).toHaveCount(4);
    await expect(panel('model-agreement').locator('.iwac-vis-summary-card').first())
        .toContainText(`${firstPair.exact}%`);

    // A click on a matrix cell (column DeepSeek, row Mistral) selects that
    // pair below.
    await panel('model-pairs').scrollIntoViewIfNeeded();
    const cell = await page.evaluate(() => {
        const el = document.querySelector('[data-iwac-panel="model-pairs"] .iwac-vis-chart');
        const chart = window.echarts.getInstanceByDom(el);
        const px = chart.convertToPixel({ seriesIndex: 0 }, [2, 1]);
        const box = el.getBoundingClientRect();
        return [box.left + px[0], box.top + px[1]];
    });
    await page.mouse.click(cell[0], cell[1]);
    await expect(page.getByText('Rows: Mistral Small 4 · Columns: DeepSeek V4 Flash')).toBeVisible();
    await expect(panel('model-agreement').getByRole('button', { name: 'Mistral Small 4 × DeepSeek V4 Flash' }))
        .toHaveAttribute('aria-pressed', 'true');
    expect(new URL(page.url()).searchParams.get('sentiment.pair')).toBe('2');

    // The dimension lens (the section's own bar, after the page's model
    // bar) repaints all four panels.
    await page.locator('.iwac-vis-overview-root > .iwac-vis-facet-host').nth(1)
        .getByRole('button', { name: 'Centrality', exact: true }).click();
    expect(new URL(page.url()).searchParams.get('sentiment.dimension')).toBe('centrality');
    await expect.poll(async () => (await option(page, 'model-calibration')).series.map((s) => s.name))
        .toEqual(['Not addressed', 'Marginal', 'Secondary', 'Central', 'Very central']);
    const cenPair = V4.reliability.centrality.pairs[2];
    await expect(panel('model-agreement').locator('.iwac-vis-summary-card').first())
        .toContainText(`${cenPair.exact}%`);
    const consensus = V4.consensus.centrality;
    await expect(panel('model-dissent').locator('.iwac-vis-summary-card').first())
        .toContainText(`of ${consensus.n} articles`);
    expect((await option(page, 'model-dissent')).series.map((s) => s.name))
        .toEqual(['Alone less central', 'Alone more central']);

    // And the measure facet swaps the matrix to exact agreement.
    await panel('model-pairs').getByRole('button', { name: 'Exact agreement' }).click();
    expect((await option(page, 'model-pairs')).series[0].data)
        .toContainEqual([1, 0, V4.reliability.centrality.pairs[0].exact]);
});

test('the trend, ranking and heatmap controls repaint and address their views', async ({ page }) => {
    await ready(page, '?bundle=v4');
    const panel = (key) => page.locator(`[data-iwac-panel="${key}"]`);

    // Trend: a band (two helper series) under one line per model.
    const trend = await option(page, 'model-trends');
    expect(trend.series.map((s) => s.name).slice(2))
        .toEqual(['GPT-5.6 Luna', 'Mistral Small 4', 'DeepSeek V4 Flash']);
    await expect(panel('model-trends').locator('p.iwac-vis-muted'))
        .toContainText(`fewer than ${V4.trends.min_count} articles`);
    await panel('model-trends').getByRole('button', { name: 'Decade' }).click();
    await expect.poll(async () => (await option(page, 'model-trends')).xAxis[0])
        .toEqual(['1990s', '2000s', '2010s', '2020s']);
    await panel('model-trends').getByRole('button', { name: 'Each model’s own' }).click();
    expect(new URL(page.url()).searchParams.get('sentiment.cohort')).toBe('available');

    // Ranking: one row per title over the threshold, lowest mean first on
    // the category axis (drawn at the bottom), and the omitted count said.
    const rows = V4.ranking.models.gpt_5_6_luna.polarity;
    const ranked = await option(page, 'newspaper-ranking');
    expect(ranked.yAxis[0]).toHaveLength(rows.length);
    const lowest = rows.reduce((a, b) => (b[2] < a[2] ? b : a));
    expect(ranked.yAxis[0][0]).toBe(V4.ranking.newspapers[lowest[0]]);
    await expect(panel('newspaper-ranking').locator('p.iwac-vis-muted'))
        .toContainText(`fewer than ${V4.ranking.min} rated articles`);
    await panel('newspaper-ranking').getByRole('button', { name: 'Subjectivity' }).click();
    expect(new URL(page.url()).searchParams.get('sentiment.rank')).toBe('subjectivity');

    // Heatmap: a minimum per cell hides the thin cells and says how many.
    const cells = V4.models.gpt_5_6_luna.centrality_heatmap;
    const hidden = cells.filter((c) => c[3] < 10).length;
    await panel('centrality-heatmap').getByRole('button', { name: '10', exact: true }).click();
    expect((await option(page, 'centrality-heatmap')).series[0].data).toHaveLength(cells.length - hidden);
    if (hidden) {
        await expect(panel('centrality-heatmap').locator('p.iwac-vis-muted'))
            .toContainText(`fewer than 10 rated articles`);
    }

    // The addressed view survives a fresh load.
    await ready(page, new URL(page.url()).search);
    await expect(panel('model-trends').getByRole('button', { name: 'Decade' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel('newspaper-ranking').getByRole('button', { name: 'Subjectivity' })).toHaveAttribute('aria-pressed', 'true');
});

test('the v0.4.0 payloads carry the keys validate_data.py requires of them', () => {
    // REQUIRED_KEYS in scripts/validate_data.py.
    for (const key of ['models', 'years', 'summary']) expect(V4).toHaveProperty(key);
    for (const key of ['places', 'models']) expect(PLACES).toHaveProperty(key);
    expect(V4.places_file).toBe('sentiment-atlas-places.json');
    for (const [model, block] of Object.entries(V4.models)) {
        expect(block.distribution.polarity.reduce((a, b) => a + b, 0), model).toBe(block.rated);
    }
});
