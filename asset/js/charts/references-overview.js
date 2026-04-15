/**
 * IWAC Visualizations — References Overview block (controller)
 *
 * Loads a single precomputed JSON bundle from
 * `asset/data/references-overview.json` (built by
 * `scripts/generate_references_overview.py`) and renders all panels
 * from it. Replaces the old client-side path that paged through the
 * Hugging Face datasets-server `/rows` endpoint at runtime — every
 * visit triggered ~9 parallel HTTP fetches and a full client-side
 * aggregation pass over 864 rows.
 *
 * Panels (in render order):
 *   1. Summary cards row
 *   2. "Period covered" subtitle
 *   3. Timeline — stacked bar of references per year, by type (wide)
 *   4. Reference types — horizontal bar
 *   5. Languages represented — pie
 *   6. Countries studied — horizontal bar
 *   7. Top authors — horizontal bar (wide)
 *   8. Top subjects — horizontal bar (wide)
 *   9. References breakdown — treemap country → type (wide)
 *  10. Author collaborations — force-directed network (wide)
 *
 * Load order: after shared/panels.js + shared/chart-options.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis references overview: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    /* ----------------------------------------------------------------- */
    /*  Translation helpers — type + language names                       */
    /* ----------------------------------------------------------------- */

    /**
     * Translate a French-source reference type (e.g. "Article de revue")
     * to the active locale via the `ref_type_<name>` i18n key. Falls
     * back to the raw name when no translation exists so unknown types
     * still render gracefully.
     */
    function translateType(type) {
        var key = 'ref_type_' + type;
        var translated = P.t(key);
        return translated === key ? type : translated;
    }

    /**
     * Same idea for language names: precomputed JSON ships the raw
     * French label ("Anglais"), the JS calls `lang_<name>` so the panel
     * shows "English" on the English site and "Anglais" on the French
     * one.
     */
    function translateLang(name) {
        var key = 'lang_' + name;
        var translated = P.t(key);
        return translated === key ? name : translated;
    }

    function translateEntries(entries, fn) {
        return (entries || []).map(function (e) {
            return { name: fn(e.name), count: e.count };
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
            { value: summary.total,      labelKey: 'References' },
            { value: summary.authors,    labelKey: 'Authors' },
            { value: summary.publishers, labelKey: 'Publishers' },
            { value: summary.types,      labelKey: 'Reference types' },
            { value: summary.countries,  labelKey: 'Countries' },
            { value: summary.languages,  labelKey: 'Languages' }
        ]));

        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var timelinePanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('References by type over time'));
        var typesPanel     = P.buildPanel('iwac-vis-panel', P.t('Reference types'));
        var languagesPanel = P.buildPanel('iwac-vis-panel', P.t('Languages represented'));
        var countriesPanel = P.buildPanel('iwac-vis-panel', P.t('Content by country'));
        var authorsPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Top authors'));
        var subjectsPanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Top subjects'));
        var treemapPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Collection breakdown'));
        var networkPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Author collaborations'));
        // The collaboration network needs the same breathing room as
        // the entity-dashboard graph host so labels on the outer ring
        // don't clip and the force layout has somewhere to expand to.
        networkPanel.chart.classList.add('iwac-vis-graph-host');

        grid.appendChild(timelinePanel.panel);
        grid.appendChild(typesPanel.panel);
        grid.appendChild(languagesPanel.panel);
        grid.appendChild(countriesPanel.panel);
        grid.appendChild(authorsPanel.panel);
        grid.appendChild(subjectsPanel.panel);
        grid.appendChild(treemapPanel.panel);
        grid.appendChild(networkPanel.panel);

        return {
            timeline:  timelinePanel.chart,
            types:     typesPanel.chart,
            languages: languagesPanel.chart,
            countries: countriesPanel.chart,
            authors:   authorsPanel.chart,
            subjects:  subjectsPanel.chart,
            treemap:   treemapPanel.chart,
            network:   networkPanel,
            networkChart: networkPanel.chart
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Translation pass over the precomputed data                        */
    /* ----------------------------------------------------------------- */

    /**
     * The generator ships type names as raw French because i18n is the
     * front-end's job, not the build's. This wraps the affected fields
     * with `translateType` / `translateLang` calls so every label that
     * lands in the DOM has been routed through the active locale.
     */
    function localizeData(data) {
        // Timeline: the `countries` array is actually the stack
        // categories (reference types). Both `countries` and `series`
        // keys need the same rename so C.timeline finds matching keys.
        var timeline = data.timeline || { years: [], countries: [], series: {} };
        var translatedTypes = (timeline.countries || []).map(translateType);
        var translatedSeries = {};
        (timeline.countries || []).forEach(function (rawType, i) {
            translatedSeries[translatedTypes[i]] = timeline.series[rawType] || [];
        });
        var localizedTimeline = {
            years:     timeline.years || [],
            countries: translatedTypes,
            series:    translatedSeries
        };

        // Treemap: keep country labels as-is (they're language-neutral
        // proper nouns), but translate the inner type children.
        var treemap = data.treemap || { children: [] };
        var localizedTreemap = {
            name: treemap.name,
            children: (treemap.children || []).map(function (c) {
                return {
                    name: c.name,
                    value: c.value,
                    children: (c.children || []).map(function (t) {
                        return { name: translateType(t.name), value: t.value };
                    })
                };
            })
        };

        return {
            summary:                data.summary || {},
            timeline:               localizedTimeline,
            types:                  translateEntries(data.types, translateType),
            languages:              translateEntries(data.languages, translateLang),
            countries:              data.countries || [],
            authors:                data.authors || [],
            subjects:               data.subjects || [],
            treemap:                localizedTreemap,
            author_collaborations:  data.author_collaborations || { nodes: [], edges: [] }
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function initReferencesOverview(container) {
        var loadingLabel = container.querySelector('.iwac-vis-loading span');
        if (loadingLabel) loadingLabel.textContent = P.t('Loading references overview') + '\u2026';

        var basePath = container.getAttribute('data-base-path') || '';
        var url = basePath + '/modules/IwacVisualizations/asset/data/references-overview.json';

        fetch(url, { headers: { Accept: 'application/json' }})
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (raw) {
                if (!raw || !raw.summary || raw.summary.total === 0) {
                    container.innerHTML = '';
                    container.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
                    return;
                }

                var data = localizeData(raw);
                var h = buildLayout(container, data.summary);

                // 1. Timeline
                if (data.timeline.years && data.timeline.years.length > 0) {
                    ns.registerChart(h.timeline, function (el, chart) {
                        chart.setOption(C.timeline(data.timeline));
                    });
                }

                // 2. Reference types
                if (data.types.length > 0) {
                    ns.registerChart(h.types, function (el, chart) {
                        chart.setOption(C.horizontalBar(data.types));
                    });
                }

                // 3. Languages
                if (data.languages.length > 0) {
                    ns.registerChart(h.languages, function (el, chart) {
                        chart.setOption(C.pie(data.languages));
                    });
                }

                // 4. Countries
                if (data.countries.length > 0) {
                    ns.registerChart(h.countries, function (el, chart) {
                        chart.setOption(C.horizontalBar(data.countries));
                    });
                }

                // 5. Top authors
                if (data.authors.length > 0) {
                    ns.registerChart(h.authors, function (el, chart) {
                        chart.setOption(C.horizontalBar(data.authors));
                    });
                }

                // 6. Top subjects
                if (data.subjects.length > 0) {
                    ns.registerChart(h.subjects, function (el, chart) {
                        chart.setOption(C.horizontalBar(data.subjects));
                    });
                }

                // 7. Treemap country → type
                if (data.treemap.children && data.treemap.children.length > 0) {
                    ns.registerChart(h.treemap, function (el, chart) {
                        chart.setOption(C.treemap(data.treemap));
                    });
                }

                // 8. Author collaboration network
                var graph = data.author_collaborations;
                if (graph.nodes && graph.nodes.length > 1 && C.collaborationNetwork) {
                    var chart = ns.registerChart(h.networkChart, function (el, instance) {
                        instance.setOption(C.collaborationNetwork(graph), true);
                    });
                    // Wire a fullscreen toggle so the network panel can
                    // expand into the viewport for closer inspection,
                    // matching the cooccurrence chord and entity network
                    // panels on the person dashboard.
                    if (chart && P.addFullscreenButton) {
                        P.addFullscreenButton(h.network.panel, {
                            onResize: function () {
                                var live = ns.getLiveChart && ns.getLiveChart(h.networkChart);
                                if (live) live.resize();
                            }
                        });
                    }
                }
            })
            .catch(function (err) {
                console.error('IWACVis references overview:', err);
                container.innerHTML = '';
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis references overview: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-references-overview');
        for (var i = 0; i < containers.length; i++) {
            initReferencesOverview(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
