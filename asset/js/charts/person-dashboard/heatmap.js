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

        function currentData() {
            return byRole[facet.role] || { years: [], months: [], cells: [] };
        }

        function hasData() {
            var d = currentData();
            return d && d.cells && d.cells.length > 0;
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData()) {
                instance.setOption(C.heatmap(currentData()), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData() && !chart) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                if (hasData()) {
                    chart.setOption(C.heatmap(currentData()), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.heatmap = { render: render };
})();
