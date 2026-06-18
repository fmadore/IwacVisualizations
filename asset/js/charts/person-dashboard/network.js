/**
 * IWAC Visualizations — Person + Entity Dashboards: network panel
 *
 * Force-directed graph of TF-IDF ranked associated entities, colored
 * by index.Type. Reuses C.network. Click a node to navigate to the
 * corresponding Omeka item.
 *
 * The toolbar (zoom ±, reset, legend, PNG download, fullscreen) and the
 * click-vs-drag-disambiguated click-through come from the shared
 * `P.buildGraphPanelToolbar` / `P.attachGraphClickThrough` helpers, so
 * this panel and the article context network stay visually +
 * behaviourally identical.
 *
 * The panel opts out of the shared `.iwac-vis-panel-toolbar` via
 * `data-iwac-no-panel-toolbar="1"` (and its chart host carries the
 * `.iwac-vis-graph-host` marker class) so the two toolbars don't stack.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.network) {
        console.warn('IWACVis.person-dashboard/network: missing deps (need C.network)');
        return;
    }

    function render(panelEl, data, facet, ctx) {
        var byRole = (data && data.network && data.network.by_role) || {};

        function currentGraph() {
            return byRole[facet.role] || { nodes: [], edges: [] };
        }
        function hasData(g) { return g && g.nodes && g.nodes.length > 1; }

        panelEl.chart.classList.add('iwac-vis-graph-host');
        // Opt out of the shared panel-toolbar auto-wire — this panel ships
        // its own graph toolbar (with a download button) just below.
        if (panelEl.panel && panelEl.panel.setAttribute) {
            panelEl.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        }

        // Build the full option only when the graph itself changes (facet
        // switch, role flip). The toolbar's legend + fullscreen toggles use
        // merge-mode setOption so the force simulation never restarts.
        var toolbar = null;
        function buildFullOption() {
            // thumbnail: ECharts 6 minimap — orientation aid once the user
            // zooms/pans the 50-node graph (auto-hidden ≤640px).
            return C.network(currentGraph(), {
                showLegend: toolbar ? toolbar.isLegendVisible() : true,
                thumbnail: true
            });
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData(currentGraph())) {
                instance.setOption(buildFullOption(), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData(currentGraph()) && !chart) {
            panelEl.chart.appendChild(P.buildEmptyState());
        }

        if (chart) {
            toolbar = P.buildGraphPanelToolbar(panelEl, chart, {
                downloadName: 'iwac-associated-entities.png'
            });
            P.attachGraphClickThrough(chart, function (node) {
                if (node.entityType === 'center') return;
                if (node.o_id && ctx && ctx.siteBase) {
                    window.location.href = ctx.siteBase + '/item/' + node.o_id;
                }
            });
        }

        // Role flips DO change the graph (different nodes + edges), so
        // rebuild the full option. Force layout runs once synchronously
        // because layoutAnimation is disabled in C.network.
        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                if (hasData(currentGraph())) {
                    chart.setOption(buildFullOption(), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.network = { render: render };
})();
