/**
 * IWAC Visualizations — Person Dashboard: mentions timeline
 *
 * Year × country stacked bar. Reuses C.timeline. Subscribes to the
 * role facet and reruns setOption when the role changes.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.person-dashboard/timeline: missing deps');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.timeline && data.timeline.by_role) || {};

        function currentSlice() {
            return byRole[facet.role] || { years: [], countries: [], series: {} };
        }

        function hasData(slice) {
            return slice.years && slice.years.length > 0;
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var slice = currentSlice();
            if (hasData(slice)) {
                instance.setOption(C.timeline(slice), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData(currentSlice()) && !chart) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                var slice = currentSlice();
                if (hasData(slice)) {
                    chart.setOption(C.timeline(slice), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.timeline = { render: render };
})();
