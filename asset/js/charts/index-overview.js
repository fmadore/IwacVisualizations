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
 * Data fetch is three-stage: Section A's chart bundle
 * (asset/data/index-overview.json, ~160 KB since the v1.6.0 split)
 * loads immediately; the index-table rows
 * (index-overview-table.json, ~620 KB — 80% of the old bundle) load
 * when the table panel nears the viewport; Section B's three
 * keyword-explorer files (~1.08 MB combined) load only when the
 * Keyword Explorer section nears the viewport. Both deferred stages
 * sit below the first screenful, so most visits never pay for them.
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
        var mapPanel        = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('Places map'),
            P.t('desc_places_map')
        );
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
            sectionB:       sectionB,
            filtersHost:    filtersHost,
            chartPanel:     chartPanel,
            tablePanel:     tablePanel
        };
    }

    function wireSectionA(h, dataA, ctx, base) {
        var io = ns.indexOverview || {};
        // Mount panels one macrotask apiece instead of one synchronous
        // pass — seven chart inits in a row block the main thread for
        // a second-plus on mid-range phones (TBT/INP). Yielding between
        // panels lets the browser paint and handle input while the rest
        // mount in source order. Layout is pre-built with min-height
        // reservations, so the stagger causes no layout shift.
        var tasks = [
            function () { if (io.stats)            io.stats.render(h.statsHost, dataA); },
            function () { if (io.typeDistribution) io.typeDistribution.render(h.typePanel, dataA); },
            function () { if (io.topEntities)      io.topEntities.render(h.topEntitiesPanel, dataA, ctx); },
            function () { if (io.lifespan)         io.lifespan.render(h.lifespanPanel, dataA, ctx); },
            function () { if (io.placesMap)        io.placesMap.render(h.mapPanel, dataA, ctx); },
            function () { if (io.activityGantt)    io.activityGantt.render(h.ganttPanel, dataA, ctx); },
            function () { armIndexTable(h, ctx, base); }
        ];
        (function next() {
            if (!tasks.length) return;
            var task = tasks.shift();
            try { task(); } catch (e) { console.error('IWACVis index overview panel:', e); }
            if (tasks.length) setTimeout(next, 0);
        })();
    }

    /**
     * The index-table rows live in a sibling file
     * (index-overview-table.json — ~80% of the old bundle's weight)
     * fetched only when the table panel nears the viewport. It is the
     * last panel in Section A, so most visits never pay for it.
     */
    function armIndexTable(h, ctx, base) {
        var io = ns.indexOverview || {};
        if (!io.indexTable) return;

        var spinner = P.buildLoadingState();
        h.indexPanel.chart.appendChild(spinner);

        var requested = false;
        function load() {
            if (requested) return;
            requested = true;
            P.fetchJSON(base + 'index-overview-table.json')
                .then(function (tableData) {
                    if (spinner.parentNode) spinner.parentNode.removeChild(spinner);
                    io.indexTable.render(h.indexPanel, tableData, ctx);
                })
                .catch(function (err) {
                    console.error('IWACVis index table:', err);
                    if (spinner.parentNode) spinner.parentNode.removeChild(spinner);
                    h.indexPanel.chart.appendChild(P.buildErrorState());
                });
        }

        if (!('IntersectionObserver' in window)) {
            load();
            return;
        }
        var obs = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) {
                    obs.disconnect();
                    load();
                    return;
                }
            }
        }, { rootMargin: '400px 0px' });
        obs.observe(h.indexPanel.panel);
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

    /**
     * Arm the deferred Section B fetch: the three keyword-explorer JSONs
     * download only when the Keyword Explorer section nears the viewport
     * (same 400px rootMargin as the asset lazy loader). The section's
     * panels are already laid out with their min-height reservations, so
     * deferral causes no layout shift — just a spinner until the data
     * lands. Falls back to an immediate load when IntersectionObserver
     * is unavailable.
     */
    function armSectionB(h, base) {
        var spinner = P.buildLoadingState();
        h.chartPanel.chart.appendChild(spinner);

        var requested = false;
        function load() {
            if (requested) return;
            requested = true;
            Promise.all([
                P.fetchJSON(base + 'keyword-explorer-subjects.json'),
                P.fetchJSON(base + 'keyword-explorer-spatial.json'),
                P.fetchJSON(base + 'keyword-explorer-metadata.json')
            ])
            .then(function (payloads) {
                if (spinner.parentNode) spinner.parentNode.removeChild(spinner);
                wireSectionB(h, {
                    subjects: payloads[0],
                    spatial:  payloads[1],
                    metadata: payloads[2]
                });
            })
            .catch(function (err) {
                console.error('IWACVis keyword explorer:', err);
                if (spinner.parentNode) spinner.parentNode.removeChild(spinner);
                h.chartPanel.chart.appendChild(P.buildErrorState());
            });
        }

        if (!('IntersectionObserver' in window)) {
            load();
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) {
                    io.disconnect();
                    load();
                    return;
                }
            }
        }, { rootMargin: '400px 0px' });
        io.observe(h.sectionB);
    }

    function initBlock(container) {
        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || ''
        };
        var base = ctx.basePath + '/modules/IwacVisualizations/asset/data/';

        P.fetchJSON(base + 'index-overview.json')
            .then(function (dataA) {
                var h = buildLayout(container, dataA);
                wireSectionA(h, dataA, ctx, base);
                armSectionB(h, base);
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
