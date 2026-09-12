/**
 * IWAC Visualizations — Collection Overview block (orchestrator)
 *
 * Thin controller: fetches `asset/data/collection-overview.json`, builds
 * the layout skeleton, and delegates each panel's render to its dedicated
 * module under `asset/js/charts/collection-overview/`.
 *
 * Panels in render order:
 *   1. Summary cards row (inline)
 *   2. Period covered subtitle (inline)
 *   3. Items per year, by country          (inline, existing C.timeline)
 *   4. Items by type, over time            → types-over-time.js
 *   5. Collection growth over time         → growth.js
 *   6. Newspaper coverage (Gantt)          → gantt.js
 *   7. Content by country                  (inline, existing C.horizontalBar)
 *   8. Languages represented               → languages.js (with facets)
 *   9. Most-cited entities                 → entities.js (tabs + pagination)
 *  10. Collection breakdown                (inline, C.treemap with fix)
 *  11. French word cloud                   → wordcloud.js (lazy sidecar)
 *  12. World map                           → map.js (lazy sidecar)
 *  13. Source locations                    → sources-map.js
 *  14. Recent additions table              → recent-additions.js (last)
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis collection overview: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    function buildLayout(container, data, ctx) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        var summary = data.summary || {};

        // Summary cards were removed here: the headline counts AND the
        // corpus-depth figures (words, pages, sources, document types,
        // audiovisual minutes, languages) now live in the IWAC-theme homepage
        // hero, which reads the same precomputed snapshot. Keeping a duplicate
        // card row in this block would repeat the same numbers one scroll
        // apart. The block leads straight into the period subtitle + charts.
        // (P.buildSummaryCards stays in shared/panels.js — other dashboards
        // still use it.)

        // 1. Period subtitle
        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        // ONE country for the whole block (S4). Five panels used to build
        // their own Country facet, so picking Bénin on the timeline left the
        // Gantt, the languages bar, the map and the word cloud on "all" — the
        // same choice made five times, and any two panels free to disagree
        // about what they were showing. The chip says what is active and
        // clears it; the country bar and the treemap set it on click.
        ctx.linked = P.createStore({ country: null });
        root.appendChild(P.buildLinkedFilterBar({
            store: ctx.linked,
            key: 'country',
            labelKey: 'linked_country'
        }));

        // 2–12. Charts grid (recent additions rendered last)
        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var timelinePanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Items per year, by country'), P.t('collection.timeline_desc'));
        var typesPanel     = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Items by type, over time'), P.t('collection.types_desc'));
        var growthPanel    = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Collection growth over time'), P.t('collection.growth_desc'));
        var ganttPanel     = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Newspaper coverage'), P.t('collection.gantt_desc'));
        var countryPanel   = P.buildPanel('iwac-vis-panel',                      P.t('Content by country'), P.t('collection.country_desc'));
        var languagePanel  = P.buildPanel('iwac-vis-panel',                      P.t('Languages represented'), P.t('collection.language_desc'));
        var entitiesPanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Most-cited entities'), P.t('collection.entities_desc'));
        entitiesPanel.panel.classList.add('iwac-vis-entities-panel');
        var treemapPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Collection breakdown'), P.t('collection.breakdown_desc'));
        // Nested treemap (country › type › source) needs more vertical
        // room than the 320px floor so 3 levels of headers stay legible.
        treemapPanel.chart.classList.add('iwac-vis-treemap-host');
        var wordcloudPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide iwac-vis-panel--wordcloud', P.t('French word cloud'), P.t('collection.wordcloud_desc'));
        var mapPanel       = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('World map'), P.t('collection.map_desc'));
        var sourcesPanel   = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-sources-map',
            P.t('Source locations'),
            P.t('source_locations_desc')
        );
        var recentPanel    = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide iwac-vis-recent-additions',
                                          P.t('Recent additions'), P.t('collection.recent_desc'));

        [
            timelinePanel, typesPanel, growthPanel, ganttPanel,
            countryPanel, languagePanel,
            entitiesPanel, treemapPanel,
            wordcloudPanel, mapPanel, sourcesPanel,
            recentPanel
        ].forEach(function (p) { grid.appendChild(p.panel); });

        // Recent additions renders immediately (no facets / lazy loading)
        if (ns.collectionOverview && ns.collectionOverview.recentAdditions) {
            ns.collectionOverview.recentAdditions.render(recentPanel.chart, data, ctx);
        }

        return {
            timeline:  timelinePanel,
            types:     typesPanel,
            growth:    growthPanel,
            gantt:     ganttPanel,
            country:   countryPanel,
            language:  languagePanel,
            entities:  entitiesPanel,
            treemap:   treemapPanel,
            wordcloud: wordcloudPanel,
            map:       mapPanel,
            sources:   sourcesPanel
        };
    }

    /**
     * Localize the treemap's middle level.
     *
     * The hierarchy is country › document type › source. Countries and
     * sources are proper nouns and stay as they are; the type level is not —
     * `generate_collection_overview.py` writes French labels into it
     * ("Article de presse", "Périodique islamique"), and nothing translated
     * them, so the English site's "Collection breakdown" was the one chart on
     * the page speaking French, three rows under a dateline that said
     * "ARTICLE". Same `translateKeyed` pattern the references overview
     * already applies to its own treemap.
     */
    function localizeTreemap(tree) {
        return {
            name: tree.name,
            children: (tree.children || []).map(function (country) {
                return {
                    name: country.name,
                    value: country.value,
                    children: (country.children || []).map(function (type) {
                        return {
                            name: P.translateKeyed('doc_type_', type.name),
                            value: type.value,
                            children: type.children
                        };
                    })
                };
            })
        };
    }

    function wireInlinePanels(h, data, linked) {
        // Timeline (existing C.timeline, year × country)
        if (data.timeline && (data.timeline.years || []).length > 0) {
            ns.registerChart(h.timeline.chart, function (el, instance) {
                instance.setOption(C.timeline(data.timeline));
            });
        } else {
            h.timeline.chart.appendChild(P.buildEmptyState());
        }

        // Country bar — same country → slot grammar as the timeline above it
        // and the Gantt below it (chart-options.js, COUNTRY_MAP).
        var countries = (data.countries || []).slice(0, 10);
        if (countries.length > 0) {
            ns.registerChart(h.country.chart, function (el, instance) {
                instance.setOption(C.horizontalBar(countries, {
                    nameKey: 'name',
                    valueKey: 'total',
                    useCountryColors: true
                }));
            }).on('click', function (p) {
                // A country bar was the one chart on the page that named a
                // country and did nothing when you clicked it. It filters the
                // block now; clicking the active one clears the filter.
                if (!p || !p.name || !linked) return;
                linked.patch({
                    country: linked.state.country === p.name ? null : p.name
                });
            });
        } else {
            h.country.chart.appendChild(P.buildEmptyState());
        }

        // Treemap (sanitized inside C.treemap — Task 7 fix). Its first level
        // is countries, so it takes the same fixed slots rather than the
        // palette in tree order.
        if (data.treemap && (data.treemap.children || []).length > 0) {
            var tree = localizeTreemap(data.treemap);
            ns.registerChart(h.treemap.chart, function (el, instance) {
                instance.setOption(C.treemap(tree, { colorFor: C._countryColor }));
            }).on('click', function (p) {
                // Its first level IS the countries, so a top-level tile is
                // the same selector as a country bar.
                if (!linked || !p || !p.data || !p.treePathInfo) return;
                if (p.treePathInfo.length !== 2) return;   // root + country
                // Only the TYPE level is localised (localizeTreemap), so a
                // top-level tile's name is the country name the data uses.
                var name = p.name;
                if (!name) return;
                linked.patch({ country: linked.state.country === name ? null : name });
            });
        } else {
            h.treemap.chart.appendChild(P.buildEmptyState());
        }
    }

    function wireDelegatedPanels(h, data, ctx) {
        var co = ns.collectionOverview || {};

        if (co.typesOverTime)  co.typesOverTime.render(h.types, data, ctx);
        if (co.growth)         co.growth.render(h.growth.chart, data);
        if (co.gantt)          co.gantt.render(h.gantt, data, ctx);
        if (co.languages)      co.languages.render(h.language, data, ctx);
        if (co.entities)       co.entities.render(h.entities, data, ctx);
        if (co.wordcloud)      co.wordcloud.render(h.wordcloud, data, ctx);
        if (co.map)            co.map.render(h.map, data, ctx);
        if (co.sourcesMap)     co.sourcesMap.render(h.sources, data, ctx);
    }

    P.bootBlock({
        selector:       '.iwac-vis-overview',
        warnLabel:      'IWACVis collection overview',
        requireECharts: true,
        dataFile:       'collection-overview.json',
        render:         function (container, data, ctx) {
            var h = buildLayout(container, data, ctx);
            wireInlinePanels(h, data, ctx.linked);
            wireDelegatedPanels(h, data, ctx);
        }
    });
})();
