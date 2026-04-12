/**
 * IWAC Visualizations — Person Dashboard: countries breakdown panel
 *
 * Horizontal bar. Reuses C.horizontalBar.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.person-dashboard/countries: missing deps');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.countries && data.countries.by_role) || {};

        function currentEntries() {
            return (byRole[facet.role] || []).slice(0, 10);
        }

        function hasData() { return currentEntries().length > 0; }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData()) {
                instance.setOption(C.horizontalBar(currentEntries(), { nameKey: 'name', valueKey: 'count' }), true);
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
                    chart.setOption(C.horizontalBar(currentEntries(), { nameKey: 'name', valueKey: 'count' }), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.countries = { render: render };
})();
