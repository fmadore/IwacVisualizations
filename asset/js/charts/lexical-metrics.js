/**
 * IWAC Visualizations — Press Language block (controller)
 *
 * Corpus-level lexical metrics of the IWAC `articles` subset, computed
 * from the OCR text by the dataset pipeline: readability (Flesch
 * reading-ease, French adaptation — higher = easier to read), lexical
 * richness (type-token ratio — higher = more varied vocabulary) and
 * words per article. Loads a single precomputed JSON bundle from
 * `asset/data/lexical-metrics.json` (built by
 * `scripts/generate_lexical_metrics.py`) and renders all panels from
 * it — no runtime calls to the Hugging Face datasets-server.
 *
 * Panels (in render order):
 *   1. Summary cards — article count + corpus means
 *   2. "Period covered" subtitle
 *   3. Readability over time — single-series line (wide)
 *   4. Lexical richness over time — single-series line
 *   5. Article length over time — single-series line
 *   6. Newspapers by readability — horizontal bar (top 15)
 *   7. Newspapers by lexical richness — horizontal bar (top 15)
 *
 * Load order: after shared/panels.js + shared/chart-options*.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis lexical metrics: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    // Ranking bars stay legible at the shared panel height with 15 rows.
    var TOP_N_NEWSPAPERS = 15;

    /* ----------------------------------------------------------------- */
    /*  Block-local i18n strings                                          */
    /* ----------------------------------------------------------------- */

    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Loading press language metrics': 'Loading press language metrics',
            'lexical.mean_readability':       'Mean readability (Flesch)',
            'lexical.mean_richness':          'Mean lexical richness',
            'lexical.mean_words':             'Mean words per article',
            'lexical.readability_title':      'Readability over time',
            'lexical.readability_desc':       'Mean Flesch reading-ease score (French adaptation) of the articles published each year, computed from the OCR text. Higher = easier to read.',
            'lexical.richness_title':         'Lexical richness over time',
            'lexical.richness_desc':          'Mean type-token ratio (distinct words ÷ total words) of the articles published each year, computed from the OCR text. Higher = more varied vocabulary.',
            'lexical.words_title':            'Article length over time',
            'lexical.words_desc':             'Mean number of words per article published each year, counted from the OCR text.',
            'lexical.np_read_title':          'Newspapers by readability',
            'lexical.np_read_desc':           'Newspapers with at least {min} articles, ranked by mean Flesch reading-ease score computed from the OCR text (top {top}). Higher = easier to read.',
            'lexical.np_rich_title':          'Newspapers by lexical richness',
            'lexical.np_rich_desc':           'Newspapers with at least {min} articles, ranked by mean type-token ratio computed from the OCR text (top {top}). Higher = more varied vocabulary.',
            'lexical.axis_readability':       'Flesch score',
            'lexical.axis_richness':          'Type-token ratio'
        });
        ns.addTranslations('fr', {
            'Loading press language metrics': 'Chargement des indicateurs de langue',
            'lexical.mean_readability':       'Lisibilité moyenne (Flesch)',
            'lexical.mean_richness':          'Richesse lexicale moyenne',
            'lexical.mean_words':             'Mots par article (moyenne)',
            'lexical.readability_title':      'Lisibilité au fil du temps',
            'lexical.readability_desc':       'Score moyen de lisibilité Flesch (adaptation française) des articles publiés chaque année, calculé à partir du texte océrisé. Plus le score est élevé, plus le texte est facile à lire.',
            'lexical.richness_title':         'Richesse lexicale au fil du temps',
            'lexical.richness_desc':          'Ratio types-occurrences moyen (mots distincts ÷ mots totaux) des articles publiés chaque année, calculé à partir du texte océrisé. Plus le ratio est élevé, plus le vocabulaire est varié.',
            'lexical.words_title':            'Longueur des articles au fil du temps',
            'lexical.words_desc':             'Nombre moyen de mots par article publié chaque année, compté à partir du texte océrisé.',
            'lexical.np_read_title':          'Journaux par lisibilité',
            'lexical.np_read_desc':           'Journaux comptant au moins {min} articles, classés par score moyen de lisibilité Flesch calculé à partir du texte océrisé (top {top}). Plus le score est élevé, plus le texte est facile à lire.',
            'lexical.np_rich_title':          'Journaux par richesse lexicale',
            'lexical.np_rich_desc':           'Journaux comptant au moins {min} articles, classés par ratio types-occurrences moyen calculé à partir du texte océrisé (top {top}). Plus le ratio est élevé, plus le vocabulaire est varié.',
            'lexical.axis_readability':       'Score Flesch',
            'lexical.axis_richness':          'Ratio types-occurrences'
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Shared single-series trend line option                            */
    /* ----------------------------------------------------------------- */

    /**
     * No shared multi-purpose line builder exists in chart-options-*,
     * so the three trend panels share this small inline helper. Colors
     * and fonts come from the registered IWAC ECharts theme — no
     * literals here.
     *
     * @param {Object} byYear  {years, count, <metric>} aligned arrays
     * @param {string} metricKey
     * @param {Object} opts {metricLabel, valueName}
     */
    function trendLineOption(byYear, metricKey, opts) {
        var years = byYear.years || [];
        var values = byYear[metricKey] || [];
        var counts = byYear.count || [];
        var dataZoom = C._dataZoom(years.length);
        var useZoom = dataZoom.length > 0;

        return {
            grid: C._grid({ left: 56, bottom: useZoom ? 64 : 40 }),
            tooltip: {
                trigger: 'axis',
                formatter: function (params) {
                    var p = params && params[0];
                    if (!p) return '';
                    var i = p.dataIndex;
                    var lines = ['<strong>' + P.escapeHtml(p.axisValue) + '</strong>'];
                    lines.push(opts.metricLabel + ': '
                        + (p.value == null ? '—' : P.formatNumber(p.value)));
                    if (counts[i] != null) {
                        lines.push(P.t('Articles') + ': ' + P.formatNumber(counts[i]));
                    }
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'category',
                data: years,
                name: P.t('Year'),
                nameLocation: 'middle',
                nameGap: useZoom ? 34 : 26
            },
            // scale:true — readability means hover around 40-60, richness
            // around 0.4-0.6; anchoring at zero would flatten the trend.
            yAxis: Object.assign(
                { type: 'value', scale: true },
                C._valueAxisName(opts.valueName)
            ),
            dataZoom: dataZoom,
            series: [{
                type: 'line',
                smooth: true,
                symbol: 'circle',
                symbolSize: 4,
                lineStyle: { width: 2 },
                data: values
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
    }

    /** Top-N newspapers by a mean metric, descending, nulls dropped. */
    function rankNewspapers(newspapers, metricKey) {
        return (newspapers || [])
            .filter(function (e) { return e && e[metricKey] != null; })
            .sort(function (a, b) { return b[metricKey] - a[metricKey]; })
            .slice(0, TOP_N_NEWSPAPERS);
    }

    /* ----------------------------------------------------------------- */
    /*  Layout composition                                                */
    /* ----------------------------------------------------------------- */

    function buildLayout(container, summary) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        root.appendChild(P.buildSummaryCards([
            { value: summary.articles,         labelKey: 'Articles' },
            { value: summary.readability_mean, labelKey: 'lexical.mean_readability' },
            { value: summary.richness_mean,    labelKey: 'lexical.mean_richness' },
            { value: summary.words_mean,       labelKey: 'lexical.mean_words' }
        ]));

        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        return { root: root, grid: grid };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function initLexicalMetrics(container) {
        var loadingLabel = container.querySelector('.iwac-vis-loading span');
        if (loadingLabel) loadingLabel.textContent = P.t('Loading press language metrics') + '…';

        var basePath = container.getAttribute('data-base-path') || '';
        var url = basePath + '/modules/IwacVisualizations/asset/data/lexical-metrics.json';

        P.fetchJSON(url)
            .then(function (data) {
                if (!data || !data.summary || !data.summary.articles) {
                    container.innerHTML = '';
                    container.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
                    return;
                }

                var h = buildLayout(container, data.summary);
                var byYear = data.by_year || { years: [] };
                var minArticles = (data.metadata && data.metadata.minArticlesPerNewspaper) || 50;
                var rankParams = { min: minArticles, top: TOP_N_NEWSPAPERS };

                // 1-3. The three trend lines.
                var trends = [
                    {
                        metric: 'readability',
                        cls: 'iwac-vis-panel iwac-vis-panel--wide',
                        title: 'lexical.readability_title',
                        desc: 'lexical.readability_desc',
                        labelKey: 'lexical.mean_readability',
                        valueName: P.t('lexical.axis_readability')
                    },
                    {
                        metric: 'richness',
                        cls: 'iwac-vis-panel',
                        title: 'lexical.richness_title',
                        desc: 'lexical.richness_desc',
                        labelKey: 'lexical.mean_richness',
                        valueName: P.t('lexical.axis_richness')
                    },
                    {
                        metric: 'words',
                        cls: 'iwac-vis-panel',
                        title: 'lexical.words_title',
                        desc: 'lexical.words_desc',
                        labelKey: 'lexical.mean_words',
                        valueName: P.t('Words')
                    }
                ];
                trends.forEach(function (def) {
                    var panel = P.buildPanel(def.cls, P.t(def.title), P.t(def.desc));
                    h.grid.appendChild(panel.panel);
                    if (!byYear.years || !byYear.years.length) {
                        panel.chart.appendChild(
                            P.el('div', 'iwac-vis-empty', P.t('No data available')));
                        return;
                    }
                    ns.registerChart(panel.chart, function (el, chart) {
                        chart.setOption(trendLineOption(byYear, def.metric, {
                            metricLabel: P.t(def.labelKey),
                            valueName: def.valueName
                        }));
                    });
                });

                // 4-5. Newspaper rankings.
                var rankings = [
                    {
                        metric: 'readability',
                        title: 'lexical.np_read_title',
                        desc: 'lexical.np_read_desc'
                    },
                    {
                        metric: 'richness',
                        title: 'lexical.np_rich_title',
                        desc: 'lexical.np_rich_desc'
                    }
                ];
                rankings.forEach(function (def) {
                    var entries = rankNewspapers(data.newspapers, def.metric);
                    if (!entries.length) return;
                    var panel = P.buildPanel('iwac-vis-panel',
                        P.t(def.title), P.t(def.desc, rankParams));
                    h.grid.appendChild(panel.panel);
                    ns.registerChart(panel.chart, function (el, chart) {
                        chart.setOption(C.horizontalBar(entries, {
                            nameKey: 'name',
                            valueKey: def.metric,
                            filterUnknown: false
                        }));
                    });
                });
            })
            .catch(function (err) {
                console.error('IWACVis lexical metrics:', err);
                container.innerHTML = '';
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis lexical metrics: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-lexical-metrics');
        for (var i = 0; i < containers.length; i++) {
            initLexicalMetrics(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
