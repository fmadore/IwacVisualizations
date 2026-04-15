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
        P.buildFacetedChart(panelEl, {
            facet: facet,
            getData: function () {
                return byRole[facet.role] || { years: [], countries: [], series: {} };
            },
            hasData: function (slice) { return slice.years && slice.years.length > 0; },
            buildOption: function (slice) { return C.timeline(slice); }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.timeline = { render: render };
})();
