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
 *  13. Recent additions table              → recent-additions.js (last)
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

        // 1. Summary cards — 11 cards per the expansion spec
        root.appendChild(P.buildSummaryCards([
            { value: summary.articles,             labelKey: 'Articles' },
            { value: summary.index_entries,        labelKey: 'Index' },
            { value: summary.total_words,          labelKey: 'Total words' },
            { value: summary.total_pages,          labelKey: 'Total pages' },
            { value: summary.scanned_pages,        labelKey: 'Scanned pages' },
            { value: summary.unique_sources,       labelKey: 'Unique sources' },
            { value: summary.document_types,       labelKey: 'Document types' },
            { value: summary.audiovisual_minutes,  labelKey: 'Audiovisual minutes' },
            { value: summary.references_count,     labelKey: 'References count' },
            { value: summary.countries,            labelKey: 'Countries' },
            { value: summary.languages,            labelKey: 'Languages' }
        ]));

        // 2. Period subtitle
        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        // 3–13. Charts grid (recent additions rendered last)
        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var timelinePanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Items per year, by country'));
        var typesPanel     = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Items by type, over time'));
        var growthPanel    = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Collection growth over time'));
        var ganttPanel     = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Newspaper coverage'));
        var countryPanel   = P.buildPanel('iwac-vis-panel',                      P.t('Content by country'));
        var languagePanel  = P.buildPanel('iwac-vis-panel',                      P.t('Languages represented'));
        var entitiesPanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Most-cited entities'));
        entitiesPanel.panel.classList.add('iwac-vis-entities-panel');
        var treemapPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Collection breakdown'));
        var wordcloudPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide iwac-vis-panel--wordcloud', P.t('French word cloud'));
        var mapPanel       = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('World map'));
        var recentPanel    = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide iwac-vis-recent-additions',
                                          P.t('Recent additions'));

        [
            timelinePanel, typesPanel, growthPanel, ganttPanel,
            countryPanel, languagePanel,
            entitiesPanel, treemapPanel,
            wordcloudPanel, mapPanel,
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
            map:       mapPanel
        };
    }

    function wireInlinePanels(h, data) {
        // Timeline (existing C.timeline, year × country)
        if (data.timeline && (data.timeline.years || []).length > 0) {
            ns.registerChart(h.timeline.chart, function (el, instance) {
                instance.setOption(C.timeline(data.timeline));
            });
        } else {
            h.timeline.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        // Country bar
        var countries = (data.countries || []).slice(0, 10);
        if (countries.length > 0) {
            ns.registerChart(h.country.chart, function (el, instance) {
                instance.setOption(C.horizontalBar(countries, { nameKey: 'name', valueKey: 'total' }));
            });
        } else {
            h.country.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        // Treemap (sanitized inside C.treemap — Task 7 fix)
        if (data.treemap && (data.treemap.children || []).length > 0) {
            ns.registerChart(h.treemap.chart, function (el, instance) {
                instance.setOption(C.treemap(data.treemap));
            });
        } else {
            h.treemap.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }
    }

    function wireDelegatedPanels(h, data, ctx) {
        var co = ns.collectionOverview || {};

        if (co.typesOverTime)  co.typesOverTime.render(h.types, data);
        if (co.growth)         co.growth.render(h.growth.chart, data);
        if (co.gantt)          co.gantt.render(h.gantt, data);
        if (co.languages)      co.languages.render(h.language, data);
        if (co.entities)       co.entities.render(h.entities, data, ctx);
        if (co.wordcloud)      co.wordcloud.render(h.wordcloud, data, ctx);
        if (co.map)            co.map.render(h.map, data, ctx);
    }

    function initOverview(container) {
        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || ''
        };
        var url = ctx.basePath + '/modules/IwacVisualizations/asset/data/collection-overview.json';

        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var h = buildLayout(container, data, ctx);
                wireInlinePanels(h, data);
                wireDelegatedPanels(h, data, ctx);
            })
            .catch(function (err) {
                console.error('IWACVis collection overview:', err);
                container.innerHTML = '';
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis collection overview: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-overview');
        for (var i = 0; i < containers.length; i++) {
            initOverview(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
