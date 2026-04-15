/**
 * IWAC Visualizations — Person + Entity Dashboards: year × month heatmap
 *
 * Discrete grid of mention counts. Reuses C.heatmap. Renders nothing
 * when the dataset has no items with parseable YYYY-MM dates (every
 * non-articles subset is silently dropped at the precompute level).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.heatmap) {
        console.warn('IWACVis.person-dashboard/heatmap: missing deps (need C.heatmap)');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.heatmap && data.heatmap.by_role) || {};
        P.buildFacetedChart(panelEl, {
            facet: facet,
            getData: function () {
                return byRole[facet.role] || { years: [], months: [], cells: [] };
            },
            hasData: function (d) { return d && d.cells && d.cells.length > 0; },
            buildOption: function (d) { return C.heatmap(d); }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.heatmap = { render: render };
})();
