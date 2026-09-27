'use strict';

const { test, expect } = require('@playwright/test');

for (const lang of ['en', 'fr']) {
    test(`Laïcité coverage and timeline preserve denominators and combined filters (${lang})`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize(lang === 'fr' ? { width: 390, height: 844 } : { width: 1280, height: 900 });
        await page.goto(`/tests/browser/fixtures/dashboard.html?lang=${lang}`);
        for (const sheet of ['shell', 'overview', 'lexicon', 'concordance', 'context']) {
            await page.addStyleTag({ url: `/asset/css/blocks/laicite-${sheet}.min.css` });
        }
        for (const url of ['/node_modules/echarts/dist/echarts.min.js', '/asset/js/dist/shared-charts.min.js',
            '/asset/js/dist/shared-ui.min.js', '/asset/js/dist/shared-layout.min.js']) await page.addScriptTag({ url });
        await page.evaluate(() => {
            const cell = (country, year, n, matched) => ({
                subset: 'articles', country, year, outlet: 'Journal A', records: n,
                title_available: n, fulltext_available: n, union_available: n, public_fulltext: n,
                selected: matched, tagged: 0, title_matches: 0, fulltext_matches: matched,
                union_matches: matched, fulltext_hits: matched * 2, title_hits: 0,
                broad_union_matches: matched, broad_fulltext_matches: matched, broad_fulltext_hits: matched * 2,
                legacy_only: 0,
            });
            const research = { minimum_cell: 5, cells: [cell('', 2020, 10, 2), cell('', 2021, 4, 1),
                cell('Togo', 2020, 10, 2), cell('Togo', 2021, 4, 1)] };
            const bundles = {
                'laicite-metadata.json': { frame_order: ['laicite'], frames: { laicite: { en: 'Laïcité', fr: 'Laïcité' } },
                    totals: { members: 3 }, countries: ['Togo'], subsets: {}, year_range: [2020, 2021],
                    membership_routes: { all: { 'tag+text': 2, 'text>=2': 1, 'text=1': 1, 'tag-only': 1, title_hit: 1 } },
                    audit_screen: { judged_at: '2026-09-14', model: 'claude-sonnet-5', rule_version: 'a1b2c3d',
                        members_total: 5, members_judged: 4, relevant: 3,
                        by_route: { 'tag+text': { judged: 2, relevant: 2 }, 'tag-only': { judged: 1, relevant: 0 } },
                        by_subset: { articles: { judged: 4, relevant: 3 } } } },
                'laicite-trends.json': { years: [2020, 2021], families: ['laicite'], global: {}, by_country: { Togo: {} }, research },
                'laicite-concordance.json': { by_subset: { articles: { emitted: 0 } } },
            };
            window.IWACVis.panels.fetchJSON = url => Promise.resolve(bundles[url.split('/').pop()] || null);
            document.querySelector('main').innerHTML = '<div class="iwac-vis-block iwac-vis-laicite" data-site-base="/s/westafrica"></div>';
        });
        // Built once per locale, like shared-core: load the page's language.
        await page.addScriptTag({ url: `/asset/js/dist/blocks/laicite.${lang}.min.js` });
        await expect(page.getByRole('heading', { name: lang === 'fr' ? 'Que pouvons-nous observer ?' : 'What can we observe?' })).toBeVisible();
        await expect(page.locator('meter')).toHaveCount(1);
        // The membership routes are a claim about how wide the dossier is,
        // so they ride beside the tag-vs-text bands, not in a footnote.
        await expect(page.getByText(lang === 'fr'
            ? 'Comment les notices sont entrées dans le dossier'
            : 'How records joined the dossier')).toBeVisible();
        await expect(page.getByText(lang === 'fr'
            ? 'Vocabulaire, une seule mention · 1' : 'Vocabulary, one mention · 1')).toBeVisible();
        // Every figure in the screen comes from `audit_screen`, including the
        // date in its own title: nothing here may be hardcoded in the copy.
        await expect(page.getByText(lang === 'fr'
            ? 'Contrôle assisté par modèle (septembre 2026)'
            : 'Model-assisted screen (September 2026)')).toBeVisible();
        // Collapsed like the sensitivity block beside it, so the rater and
        // the rule version are attached rather than on screen until asked for.
        await expect(page.getByText('claude-sonnet-5')).toBeAttached();
        await page.locator('select[data-iwac-control="laicite-view"]').selectOption('trends');
        const country = page.locator('select[data-iwac-control="laicite-trends-country"]');
        const subset = page.locator('select[data-iwac-control="laicite-trends-subset"]');
        await country.selectOption('Togo');
        await expect(subset).toHaveValue('articles');
        await expect(country).toHaveValue('Togo');
        const series = await page.evaluate(() => {
            const research = { minimum_cell: 5, cells: [
                { subset: 'articles', country: 'Togo', year: 2020, fulltext_available: 10, fulltext_matches: 2, records: 10 },
                { subset: 'articles', country: 'Togo', year: 2021, fulltext_available: 4, fulltext_matches: 1, records: 4 },
            ] };
            return window.IWACVis.laicite.researchSeries(research, { trendsSubset: 'articles', trendsCountry: 'Togo' }).series.laicite;
        });
        expect(series).toEqual([20, null]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
    });

    test(`Laïcité shows excerpt provenance and missing transcripts (${lang})`, async ({ page }) => {
        await page.setViewportSize(lang === 'fr'
            ? { width: 390, height: 844 } : { width: 1280, height: 900 });
        await page.goto(`/tests/browser/fixtures/dashboard.html?lang=${lang}`);
        for (const url of [
            '/asset/js/dist/shared-ui.min.js',
            '/asset/js/charts/laicite/i18n.js',
            '/asset/js/charts/laicite/helpers.js',
            '/asset/js/charts/laicite/overview.js',
            '/asset/js/charts/laicite/concordance.js',
        ]) await page.addScriptTag({ url });
        await page.evaluate(() => {
            const ns = window.IWACVis;
            const L = ns.laicite;
            const main = document.querySelector('main');
            main.innerHTML = '';
            main.appendChild(L.buildVideos({
                subsets: { audiovisual: {
                    corpus_size: 20, corpus_with_fulltext: 2,
                    members: 2, members_with_fulltext: 1,
                } },
                video_items: [
                    { o_id: '1', title: 'Laïcité — conférence', has_transcript: false },
                    { o_id: '2', title: 'Laïcité — débat', has_transcript: true },
                ],
            }, '/s/westafrica'));
            ns.panels.fetchJSON = () => Promise.resolve({
                items: [{ o: '1', t: 'Source', c: ['Bénin'], y: 2020, s: 'text=1' }],
                rows: [
                    { i: 0, f: 'laicite', d: 'title', l: '', m: 'Laïcité', r: '' },
                    { i: 0, f: 'laicite', d: 'OCR', l: '', m: 'Laïcité', r: '' },
                ],
            });
            const state = { kwicSubset: 'audiovisual', kwicStrict: false };
            const concordance = L.createConcordance({
                index: { by_subset: { audiovisual: { file: 'videos.json', emitted: 2 } } },
                metadata: { frames: {} }, state,
                dataBase: '/', siteBase: '/s/westafrica',
                onLoaded() { main.dataset.loadedCountries = concordance.countriesFor('audiovisual').join(','); },
            });
            window.__kwic = { state, concordance };
            main.appendChild(concordance.host);
            concordance.render();
        });
        await expect(page.locator('main')).toHaveAttribute('data-loaded-countries', 'Bénin');
        await expect(page.locator('.iwac-vis-kwic-source').nth(0))
            .toContainText(lang === 'en' ? 'Title' : 'Titre');
        await expect(page.locator('.iwac-vis-kwic-source').nth(1))
            .toContainText(lang === 'en' ? 'Full text' : 'Texte intégral');
        await page.locator('summary').click();
        await expect(page.getByText(lang === 'en'
            ? 'No transcript; title searched only' : 'Sans transcription ; seul le titre est interrogé',
        { exact: false })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Laïcité — conférence' }))
            .toHaveAttribute('href', '/s/westafrica/item/1');
        // A record admitted on one core match is badged rather than dropped:
        // the dossier stays as wide as the methodology says it is.
        await expect(page.locator('.iwac-vis-kwic-badge')).toHaveCount(2);
        await expect(page.locator('.iwac-vis-kwic-badge').first())
            .toHaveText(lang === 'en' ? 'single mention' : 'mention unique');
        await expect(page.locator('.iwac-vis-laicite-kwic-hidden')).toHaveCount(0);
        // Turning the strict filter on hides the record AND says so.
        await page.evaluate(() => {
            window.__kwic.state.kwicStrict = true;
            window.__kwic.concordance.render();
        });
        await expect(page.locator('.iwac-vis-kwic-badge')).toHaveCount(0);
        await expect(page.locator('.iwac-vis-laicite-kwic-hidden'))
            .toContainText(lang === 'en'
                ? '1 records hidden by the strict filter'
                : '1 documents masqués par le filtre strict');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
}
