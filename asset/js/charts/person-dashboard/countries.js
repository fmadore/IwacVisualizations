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
    if (!P || !C || !P.buildFacetedChart) {
        console.warn('IWACVis.person-dashboard/countries: missing deps');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.countries && data.countries.by_role) || {};
        P.buildFacetedChart(panelEl, {
            facet: facet,
            getData: function () { return (byRole[facet.role] || []).slice(0, 10); },
            hasData: function (entries) { return entries.length > 0; },
            buildOption: function (entries) { return C.horizontalBar(entries, { nameKey: 'name', valueKey: 'count' }); }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.countries = { render: render };
})();
