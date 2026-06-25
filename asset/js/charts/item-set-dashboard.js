/**
 * IWAC Visualizations — Item Set Dashboard (orchestrator)
 *
 * Per-item-set dashboard that REUSES the single-corpus aggregates the
 * Compare Newspapers precompute already emits — newspapers, Islamic
 * periodicals, and countries all exist as item sets on islam.zmo.de,
 * and `generate_compare_newspapers.py` writes one aggregate JSON per
 * corpus. No new precompute needed.
 *
 * Matching: `compare-newspapers/index.json` lists every available
 * corpus with its display name. The item set's title (passed by the
 * partial via `data-item-set-title`) is compared NFC-normalized and
 * case-folded against, in order:
 *
 *   1. articles.newspapers      3. articles.countries
 *   2. publications.newspapers  4. publications.countries
 *
 * — newspaper corpora first because they're more specific than the
 * country rollups. No hit → the whole block (heading included) is
 * removed, mirroring the Visualizations block's "unsupported templates
 * produce no output" rule, so the block can be enabled for all item
 * sets without littering unrelated ones.
 *
 * Panels (all from existing shared builders — no new chart code):
 *   - Summary cards (items / words / pages / subjects / places)
 *     + period subtitle
 *   - Items per year (single-series timeline bar)
 *   - Top subjects / Spatial coverage (horizontal bars)
 *   - Most frequent words (wordcloud, horizontal-bar fallback when
 *     echarts-wordcloud is unavailable)
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis item-set dashboard: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Items': 'Items',
            'Items per year': 'Items per year',
            'Top subjects': 'Top subjects',
            'Spatial coverage': 'Spatial coverage',
            'Most frequent words': 'Most frequent words',
            'desc_item_set_corpus': 'Aggregated from the IWAC corpus precompute for this collection.'
        });
        ns.addTranslations('fr', {
            'Items': 'Éléments',
            'Items per year': 'Éléments par année',
            'Top subjects': 'Principaux sujets',
            'Spatial coverage': 'Couverture spatiale',
            'Most frequent words': 'Mots les plus fréquents',
            'desc_item_set_corpus': 'Agrégé à partir du précalcul de corpus IWAC pour cette collection.'
        });
    }

    var DATA_BASE = '/files/iwac-visualizations/compare-newspapers/';

    function norm(s) {
        s = String(s || '').trim().toLowerCase();
        try { s = s.normalize('NFC'); } catch (e) { /* pre-Unicode-norm engines */ }
        return s;
    }

    /** Find the corpus whose display name matches the item set title. */
    function findCorpus(index, title) {
        var t = norm(title);
        if (!t) return null;
        var subsets = (index && index.subsets) || {};
        var probes = [
            ['articles',     'newspapers', 'newspaper'],
            ['publications', 'newspapers', 'newspaper'],
            ['articles',     'countries',  'country'],
            ['publications', 'countries',  'country']
        ];
        for (var i = 0; i < probes.length; i++) {
            var list = (subsets[probes[i][0]] && subsets[probes[i][0]][probes[i][1]]) || [];
            for (var j = 0; j < list.length; j++) {
                if (norm(list[j].name) === t) {
                    return { type: probes[i][0], scope: probes[i][2], slug: list[j].slug };
                }
            }
        }
        return null;
    }

    /** Remove the whole block (incl. server-rendered heading) — the
     *  silent-skip rule for item sets that map to no corpus. */
    function removeBlock(container) {
        var block = container.closest ? container.closest('.iwac-vis-block') : null;
        if (block && block.parentNode) {
            block.parentNode.removeChild(block);
        } else {
            container.innerHTML = '';
        }
    }

    function render(container, corpus) {
        var s = corpus.summary || {};
        var root = P.el('div', 'iwac-vis-overview-root iwac-vis-item-set__body');
        container.appendChild(root);

        root.appendChild(P.buildSummaryCards([
            { value: s.total_items,     labelKey: 'Items', featured: true },
            { value: s.total_words,     labelKey: 'Words' },
            { value: s.total_pages,     labelKey: 'Pages' },
            { value: s.unique_subjects, labelKey: 'Subjects' },
            { value: s.unique_spatial,  labelKey: 'Spatial coverage' }
        ]));
        var subtitle = P.buildPeriodSubtitle(s.year_min, s.year_max);
        if (subtitle) root.appendChild(subtitle);

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        // Items per year — single-series stacked timeline (the builder
        // is year × category; one category = a plain bar series).
        var tl = corpus.timeline || {};
        if (tl.years && tl.years.length) {
            var seriesName = P.t('Items');
            var series = {};
            series[seriesName] = tl.counts || [];
            var tlPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Items per year'));
            grid.appendChild(tlPanel.panel);
            ns.registerChart(tlPanel.chart, function (el, instance) {
                instance.setOption(C.timeline(
                    { years: tl.years, countries: [seriesName], series: series },
                    { useCountryColors: false }
                ), true);
            });
        }

        // Top subjects / spatial — straight horizontal bars.
        [
            { key: 'subjects', title: 'Top subjects' },
            { key: 'spatial',  title: 'Spatial coverage' }
        ].forEach(function (def) {
            var entries = (corpus[def.key] || []).slice(0, 15);
            if (!entries.length) return;
            var panel = P.buildPanel('iwac-vis-panel', P.t(def.title));
            grid.appendChild(panel.panel);
            ns.registerChart(panel.chart, function (el, instance) {
                instance.setOption(C.horizontalBar(entries), true);
            });
        });

        // Most frequent words — wordcloud with an hbar fallback when
        // echarts-wordcloud failed to load (setOption throws on the
        // unknown series type; the fallback re-renders as a bar).
        var pairs = corpus.wordcloud || [];
        if (pairs.length) {
            var wcPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Most frequent words'));
            grid.appendChild(wcPanel.panel);
            ns.registerChart(wcPanel.chart, function (el, instance) {
                try {
                    instance.setOption(C.wordcloud(pairs), true);
                } catch (e) {
                    var entries = pairs.slice(0, 15).map(function (p) {
                        return { name: p[0], count: p[1] };
                    });
                    instance.setOption(C.horizontalBar(entries), true);
                }
            });
        }
    }

    function initBlock(container) {
        var title = container.dataset.itemSetTitle || '';
        var basePath = container.dataset.basePath || '';
        if (!title) {
            removeBlock(container);
            return;
        }

        P.fetchJSON(basePath + DATA_BASE + 'index.json')
            .then(function (index) {
                var corpus = findCorpus(index, title);
                if (!corpus) {
                    removeBlock(container);
                    return null;
                }
                return P.fetchJSON(
                    basePath + DATA_BASE + corpus.type + '/' + corpus.scope + '-' + corpus.slug + '.json'
                );
            })
            .then(function (corpus) {
                if (!corpus) return;
                var loading = container.querySelector('.iwac-vis-item-set__loading');
                if (loading) loading.remove();
                render(container, corpus);
            })
            .catch(function (err) {
                // Treat data errors like a non-match: this block is an
                // opportunistic enhancement, never a broken banner on
                // every collection page.
                console.error('IWACVis item-set dashboard:', err);
                removeBlock(container);
            });
    }

    function init() {
        var containers = document.querySelectorAll('.iwac-vis-item-set');
        for (var i = 0; i < containers.length; i++) {
            initBlock(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
