/**
 * IWAC Visualizations — Person Dashboard: neighbors network panel
 *
 * Force-directed graph of TF-IDF ranked associated entities, color-
 * coded by index.Type. Reuses C.network. Click a node to navigate to
 * the corresponding Omeka item page.
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

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var g = currentGraph();
            if (hasData(g)) {
                instance.setOption(C.network(g), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData(currentGraph()) && !chart) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        if (chart) {
            chart.on('click', function (params) {
                if (params.dataType !== 'node') return;
                var node = params.data || {};
                if (node.entityType === 'center') return;
                if (node.o_id && ctx && ctx.siteBase) {
                    window.location.href = ctx.siteBase + '/item/' + node.o_id;
                }
            });
        }

        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                var g = currentGraph();
                if (hasData(g)) {
                    chart.setOption(C.network(g), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.network = { render: render };
})();
