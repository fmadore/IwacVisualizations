/**
 * IWAC Visualizations — Index Overview page block (orchestrator)
 *
 * Two sections in one block:
 *
 *   A. Entity Index Explorer — summary cards + type distribution +
 *      top entities + lifespan scatter + gender donut + places map
 *      (authority pins + dct:spatial mention bubbles) + activity
 *      gantt + recent additions + full searchable index table.
 *
 *   B. Keyword Explorer — Dublin Core Subject and Spatial Coverage
 *      prevalence over time, with global / country / newspaper
 *      facets, top-N and compare view modes, and a paginated
 *      all-keywords table with an Add-to-compare action.
 *
 * Data fetch: 4 JSON files in parallel.
 *   asset/data/index-overview.json
 *   asset/data/keyword-explorer-subjects.json
 *   asset/data/keyword-explorer-spatial.json
 *   asset/data/keyword-explorer-metadata.json
 *
 * Panel modules are self-registering under `ns.indexOverview.*` and
 * this file just composes the layout + hands them their host elements.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis index overview: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;

    function buildLayout(container, dataA) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root iwac-vis-index-overview-root');
        container.appendChild(root);

        /* ============================================================= */
        /*  Section A — Entity Index Explorer                              */
        /* ============================================================= */

        var sectionA = P.el('section', 'iwac-vis-index-overview-section');
        sectionA.appendChild(P.el('h3', 'iwac-vis-section-heading', P.t('Entity Index Explorer')));

        // Stats row + period subtitle (render target is the section body)
        var statsHost = P.el('div');
        sectionA.appendChild(statsHost);

        // Charts grid
        var gridA = P.buildChartsGrid();
        sectionA.appendChild(gridA);

        var typePanel       = P.buildPanel('iwac-vis-panel', P.t('Entities by type'));
        var topEntitiesPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('Top entities'),
            P.t('desc_top_entities')
        );
        topEntitiesPanel.panel.classList.add('iwac-vis-entities-panel');
        var lifespanPanel   = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('Lifespan × frequency'),
            P.t('desc_lifespan')
        );
        var mapPanel        = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Places map'));
        var ganttPanel      = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('Temporal extent'),
            P.t('desc_temporal_extent')
        );
        var indexPanel      = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Index table'));

        [
            typePanel, topEntitiesPanel,
            lifespanPanel,
            mapPanel, ganttPanel,
            indexPanel
        ].forEach(function (p) { gridA.appendChild(p.panel); });

        root.appendChild(sectionA);

        /* ============================================================= */
        /*  Section B — Keyword Explorer                                   */
        /* ============================================================= */

        var sectionB = P.el('section', 'iwac-vis-index-overview-section');
        sectionB.appendChild(P.el('h3', 'iwac-vis-section-heading', P.t('Keyword Explorer')));
        sectionB.appendChild(P.el('p', 'iwac-vis-section-desc',
            P.t('Explore the prevalence of Dublin Core Subject and Spatial Coverage fields over time.')));

        var keywordsLayout = P.el('div', 'iwac-vis-keywords-layout');
        sectionB.appendChild(keywordsLayout);

        // Two-column: filters sidebar + chart + table
        var filtersHost = P.el('div', 'iwac-vis-keywords-sidebar');
        keywordsLayout.appendChild(filtersHost);

        var keywordsMain = P.el('div', 'iwac-vis-keywords-main');
        keywordsLayout.appendChild(keywordsMain);

        var chartPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Keywords over time'));
        keywordsMain.appendChild(chartPanel.panel);

        var tablePanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('All keywords'));
        keywordsMain.appendChild(tablePanel.panel);

        root.appendChild(sectionB);

        return {
            statsHost:      statsHost,
            typePanel:      typePanel,
            topEntitiesPanel: topEntitiesPanel,
            lifespanPanel:  lifespanPanel,
            mapPanel:       mapPanel,
            ganttPanel:     ganttPanel,
            indexPanel:     indexPanel,
            filtersHost:    filtersHost,
            chartPanel:     chartPanel,
            tablePanel:     tablePanel
        };
    }

    function wireSectionA(h, dataA, ctx) {
        var io = ns.indexOverview || {};
        if (io.stats)            io.stats.render(h.statsHost, dataA);
        if (io.typeDistribution) io.typeDistribution.render(h.typePanel, dataA);
        if (io.topEntities)      io.topEntities.render(h.topEntitiesPanel, dataA, ctx);
        if (io.lifespan)         io.lifespan.render(h.lifespanPanel, dataA, ctx);
        if (io.placesMap)        io.placesMap.render(h.mapPanel, dataA);
        if (io.activityGantt)    io.activityGantt.render(h.ganttPanel, dataA, ctx);
        if (io.indexTable)       io.indexTable.render(h.indexPanel, dataA, ctx);
    }

    function wireSectionB(h, datasets) {
        var io = ns.indexOverview || {};
        if (!io.keywordsState || !io.keywordsFilters || !io.keywordsChart || !io.keywordsTable) {
            console.warn('IWACVis index overview: keyword explorer modules missing');
            return;
        }
        var state = io.keywordsState.create(datasets);
        io.keywordsFilters.render(h.filtersHost, state, datasets);
        // Chart panel receives the panel object so it can inject its
        // subtitle ABOVE panel.chart as a sibling (nesting inside
        // panel.chart collapses the ECharts canvas to 0px height).
        io.keywordsChart.render(h.chartPanel, state);
        io.keywordsTable.render(h.tablePanel.chart, state);
    }

    function initBlock(container) {
        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || ''
        };
        var base = ctx.basePath + '/modules/IwacVisualizations/asset/data/';

        var urls = [
            base + 'index-overview.json',
            base + 'keyword-explorer-subjects.json',
            base + 'keyword-explorer-spatial.json',
            base + 'keyword-explorer-metadata.json'
        ];

        Promise.all(urls.map(function (u) {
            return fetch(u).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + u);
                return r.json();
            });
        }))
        .then(function (payloads) {
            var dataA = payloads[0];
            var datasets = {
                subjects: payloads[1],
                spatial:  payloads[2],
                metadata: payloads[3]
            };
            var h = buildLayout(container, dataA);
            wireSectionA(h, dataA, ctx);
            wireSectionB(h, datasets);
        })
        .catch(function (err) {
            console.error('IWACVis index overview:', err);
            container.innerHTML = '';
            container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
        });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis index overview: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-index-overview');
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
