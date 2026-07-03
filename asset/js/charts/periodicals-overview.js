/**
 * IWAC Visualizations — Periodicals Overview block (controller)
 *
 * Corpus-level view of the IWAC `publications` subset (Islamic-periodical
 * issues). Loads a single precomputed JSON bundle from
 * `asset/data/periodicals-overview.json` (built by
 * `scripts/generate_periodicals_overview.py`) and renders all panels
 * from it — no runtime calls to the Hugging Face datasets-server.
 *
 * Panels (in render order):
 *   1. Summary cards row
 *   2. "Period covered" subtitle
 *   3. Periodical runs — Gantt of each periodical's publication span (wide)
 *   4. Issues per year — stacked bar by country (wide)
 *   5. Languages — donut
 *   6. Countries — donut
 *   7. Top subjects — horizontal bar (wide)
 *   8. Most frequent terms — word cloud over lemmatized text (wide)
 *
 * Load order: after shared/panels.js + shared/chart-options.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis periodicals overview: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    /* ----------------------------------------------------------------- */
    /*  Translation helper — language names                               */
    /* ----------------------------------------------------------------- */

    /**
     * The precomputed JSON ships raw French language labels
     * ("Français"); the JS calls `lang_<name>` so the panel shows
     * "French" on the English site and "Français" on the French one.
     * Falls back to the raw name when no translation exists.
     */
    function translateLang(name) {
        return P.translateKeyed('lang_', name);
    }

    function localizeLanguages(entries) {
        return (entries || []).map(function (e) {
            return { name: translateLang(e.name), count: e.count };
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Layout composition                                                */
    /* ----------------------------------------------------------------- */

    function buildLayout(container, summary) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        root.appendChild(P.buildSummaryCards([
            { value: summary.total,       labelKey: 'periodicals.issues' },
            { value: summary.periodicals, labelKey: 'periodicals.periodicals' },
            { value: summary.countries,   labelKey: 'Countries' },
            { value: summary.languages,   labelKey: 'Languages' },
            { value: summary.total_pages, labelKey: 'Total pages' },
            { value: summary.total_words, labelKey: 'Total words' }
        ]));

        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var runsPanel      = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('periodicals.runs_title'), P.t('periodicals.runs_desc'));
        var perYearPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('periodicals.issues_per_year_title'));
        var languagesPanel = P.buildPanel('iwac-vis-panel', P.t('Languages'));
        var countriesPanel = P.buildPanel('iwac-vis-panel', P.t('Countries'));
        var subjectsPanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('periodicals.subjects_title'));
        var wordcloudPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('periodicals.wordcloud_title'), P.t('periodicals.wordcloud_desc'));
        // Word clouds need vertical room — reuse the shared 400px host
        // reservation instead of the default 320px chart height.
        wordcloudPanel.chart.classList.add('iwac-vis-wordcloud-host');

        // Holdings matrix (ROADMAP 9.4) — 25 periodical rows need the
        // 400px reservation too. The controller removes the panel when
        // the deployed bundle predates the holdings section.
        var holdingsPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('periodicals.holdings_title'), P.t('periodicals.holdings_desc'));
        holdingsPanel.chart.classList.add('iwac-vis-chart--tall');

        grid.appendChild(runsPanel.panel);
        grid.appendChild(holdingsPanel.panel);
        grid.appendChild(perYearPanel.panel);
        grid.appendChild(languagesPanel.panel);
        grid.appendChild(countriesPanel.panel);
        grid.appendChild(subjectsPanel.panel);
        grid.appendChild(wordcloudPanel.panel);

        return {
            runs:           runsPanel.chart,
            holdings:       holdingsPanel.chart,
            holdingsPanel:  holdingsPanel.panel,
            perYear:        perYearPanel.chart,
            languages:      languagesPanel.chart,
            countries:      countriesPanel.chart,
            subjects:       subjectsPanel.chart,
            wordcloud:      wordcloudPanel.chart
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function initPeriodicalsOverview(container) {
        var loadingLabel = container.querySelector('.iwac-vis-loading span');
        if (loadingLabel) loadingLabel.textContent = P.t('Loading periodicals overview') + '…';

        var basePath = container.getAttribute('data-base-path') || '';
        var url = basePath + '/files/iwac-visualizations/periodicals-overview.json';

        P.fetchJSON(url)
            .then(function (data) {
                if (!data || !data.summary || !data.summary.total) {
                    container.innerHTML = '';
                    container.appendChild(P.buildEmptyState());
                    return;
                }

                var h = buildLayout(container, data.summary);

                // 1. Periodical runs (Gantt — bars colored by country)
                var runs = data.runs || [];
                if (runs.length > 0) {
                    ns.registerChart(h.runs, function (el, chart) {
                        chart.setOption(C.gantt(runs));
                    });
                }

                // 1b. Holdings matrix — periodical × year issue counts
                //     (ROADMAP 9.4). Rows keep the Gantt's ordering; a
                //     blank cell inside a run is a collection gap. Elides
                //     when the deployed bundle predates the section.
                var holdings = data.holdings || {};
                if (holdings.cells && holdings.cells.length && C.heatmapMatrix) {
                    ns.registerChart(h.holdings, function (el, chart) {
                        chart.setOption(C.heatmapMatrix({
                            xLabels: holdings.years || [],
                            yLabels: holdings.periodicals || [],
                            cells: holdings.cells
                        }, {
                            tooltipFormatter: function (p) {
                                var v = p.value || [];
                                return P.t('periodicals.holdings_tip', {
                                    name: P.escapeHtml((holdings.periodicals || [])[v[1]] || ''),
                                    year: (holdings.years || [])[v[0]],
                                    count: P.formatNumber(v[2])
                                });
                            }
                        }), true);
                    });
                } else if (h.holdingsPanel && h.holdingsPanel.parentNode) {
                    h.holdingsPanel.parentNode.removeChild(h.holdingsPanel);
                }

                // 2. Issues per year, stacked by country
                var perYear = data.issues_per_year || { years: [], countries: [], series: {} };
                if (perYear.years && perYear.years.length > 0) {
                    ns.registerChart(h.perYear, function (el, chart) {
                        chart.setOption(C.timeline(perYear));
                    });
                }

                // 3. Languages — donut (matches the references-overview
                // languages panel). French dominates the issue count, so
                // the labelled slices stay readable while the tooltip
                // carries the exact share for the long tail.
                var languages = localizeLanguages(data.languages);
                if (languages.length > 0) {
                    ns.registerChart(h.languages, function (el, chart) {
                        chart.setOption(C.pie(languages));
                    });
                }

                // 4. Countries — donut
                var countries = data.countries || [];
                if (countries.length > 0) {
                    ns.registerChart(h.countries, function (el, chart) {
                        chart.setOption(C.pie(countries));
                    });
                }

                // 5. Top subjects
                var subjects = data.top_subjects || [];
                if (subjects.length > 0) {
                    ns.registerChart(h.subjects, function (el, chart) {
                        chart.setOption(C.horizontalBar(subjects));
                    });
                }

                // 6. Word cloud — most frequent lemmas across all issues.
                // C.wordcloud falls back to a bar chart when the
                // echarts-wordcloud extension isn't available.
                var wordcloud = data.wordcloud || [];
                if (wordcloud.length > 0) {
                    ns.registerChart(h.wordcloud, function (el, chart) {
                        chart.setOption(C.wordcloud(wordcloud));
                    });
                }
            })
            .catch(function (err) {
                console.error('IWACVis periodicals overview:', err);
                container.innerHTML = '';
                container.appendChild(P.buildFetchErrorState(err));
            });
    }

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis periodicals overview: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-periodicals-overview');
        for (var i = 0; i < containers.length; i++) {
            initPeriodicalsOverview(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
