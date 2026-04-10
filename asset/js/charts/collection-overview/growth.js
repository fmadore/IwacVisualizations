/**
 * IWAC Visualizations — Collection Overview: Growth panel
 *
 * Monthly additions (bar) + cumulative total (line) based on added_date.
 * Single call to C.growthBar — no facets in v1.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.collection-overview/growth: missing dependencies');
        return;
    }

    function render(chartEl, data) {
        var growth = data && data.growth;
        if (!growth || !growth.months || growth.months.length === 0) {
            chartEl.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        ns.registerChart(chartEl, function (el, instance) {
            instance.setOption(C.growthBar(growth), true);
        });
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.growth = { render: render };
})();
