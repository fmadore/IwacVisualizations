/**
 * IWAC Visualizations — Person Dashboard: top newspapers panel
 *
 * Horizontal bar with year range tooltip. Reuses C.newspaper.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.person-dashboard/newspapers: missing deps');
        return;
    }

    function render(panelEl, data, facet, ctx) {
        var byRole = (data && data.newspapers && data.newspapers.by_role) || {};

        function currentEntries() {
            return (byRole[facet.role] || []).slice(0, 15);
        }

        function hasData() { return currentEntries().length > 0; }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData()) {
                instance.setOption(C.newspaper(currentEntries()), true);
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
                    chart.setOption(C.newspaper(currentEntries()), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.newspapers = { render: render };
})();
