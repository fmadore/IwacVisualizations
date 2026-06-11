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
 *   5. Languages — log-scaled horizontal bar
 *   6. Countries — horizontal bar
 *   7. Top subjects — horizontal bar (wide)
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
    /*  Block-local i18n strings                                          */
    /* ----------------------------------------------------------------- */

    // Registered here (scary-terms pattern) rather than in iwac-i18n.js;
    // generic keys the block also uses — 'Languages', 'Countries',
    // 'Total pages', 'Total words', 'period_covered', 'Logarithmic
    // scale', 'lang_<name>' — already live in the shared dictionary.
    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Loading periodicals overview':       'Loading periodicals overview',
            'periodicals.issues':                 'Issues',
            'periodicals.periodicals':            'Periodicals',
            'periodicals.runs_title':             'Periodical runs',
            'periodicals.runs_desc':              'Publication span of each periodical, from its first to its last issue in the collection, colored by country.',
            'periodicals.issues_per_year_title':  'Issues per year',
            'periodicals.subjects_title':         'Top subjects'
        });
        ns.addTranslations('fr', {
            'Loading periodicals overview':       'Chargement des périodiques',
            'periodicals.issues':                 'Numéros',
            'periodicals.periodicals':            'Périodiques',
            'periodicals.runs_title':             'Parutions des périodiques',
            'periodicals.runs_desc':              'Période de parution de chaque périodique, du premier au dernier numéro conservé dans la collection, colorée par pays.',
            'periodicals.issues_per_year_title':  'Numéros par année',
            'periodicals.subjects_title':         'Principaux sujets'
        });
    }

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
        var key = 'lang_' + name;
        var translated = P.t(key);
        return translated === key ? name : translated;
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

        grid.appendChild(runsPanel.panel);
        grid.appendChild(perYearPanel.panel);
        grid.appendChild(languagesPanel.panel);
        grid.appendChild(countriesPanel.panel);
        grid.appendChild(subjectsPanel.panel);

        return {
            runs:           runsPanel.chart,
            perYear:        perYearPanel.chart,
            languages:      languagesPanel.chart,
            languagesPanel: languagesPanel.panel,
            countries:      countriesPanel.chart,
            subjects:       subjectsPanel.chart
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function initPeriodicalsOverview(container) {
        var loadingLabel = container.querySelector('.iwac-vis-loading span');
        if (loadingLabel) loadingLabel.textContent = P.t('Loading periodicals overview') + '…';

        var basePath = container.getAttribute('data-base-path') || '';
        var url = basePath + '/modules/IwacVisualizations/asset/data/periodicals-overview.json';

        P.fetchJSON(url)
            .then(function (data) {
                if (!data || !data.summary || !data.summary.total) {
                    container.innerHTML = '';
                    container.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
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

                // 2. Issues per year, stacked by country
                var perYear = data.issues_per_year || { years: [], countries: [], series: {} };
                if (perYear.years && perYear.years.length > 0) {
                    ns.registerChart(h.perYear, function (el, chart) {
                        chart.setOption(C.timeline(perYear));
                    });
                }

                // 3. Languages — log scale: French is ~99.9% of the
                // issues, so a linear bar collapses Arabic to an
                // invisible sliver (same rationale as the collection
                // overview's languages panel).
                var languages = localizeLanguages(data.languages);
                if (languages.length > 0) {
                    ns.registerChart(h.languages, function (el, chart) {
                        chart.setOption(C.horizontalBar(languages, {
                            filterUnknown: false,
                            log: true
                        }));
                    });
                    h.languagesPanel.appendChild(
                        P.el('p', 'iwac-vis-muted iwac-vis-lang-note', P.t('Logarithmic scale'))
                    );
                }

                // 4. Countries
                var countries = data.countries || [];
                if (countries.length > 0) {
                    ns.registerChart(h.countries, function (el, chart) {
                        chart.setOption(C.horizontalBar(countries));
                    });
                }

                // 5. Top subjects
                var subjects = data.top_subjects || [];
                if (subjects.length > 0) {
                    ns.registerChart(h.subjects, function (el, chart) {
                        chart.setOption(C.horizontalBar(subjects));
                    });
                }
            })
            .catch(function (err) {
                console.error('IWACVis periodicals overview:', err);
                container.innerHTML = '';
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
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
