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
    if (!P || !C || !P.buildFacetedChart) {
        console.warn('IWACVis.person-dashboard/newspapers: missing deps');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.newspapers && data.newspapers.by_role) || {};
        P.buildFacetedChart(panelEl, {
            facet: facet,
            getData: function () { return (byRole[facet.role] || []).slice(0, 15); },
            hasData: function (entries) { return entries.length > 0; },
            buildOption: function (entries) { return C.newspaper(entries); }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.newspapers = { render: render };
})();
