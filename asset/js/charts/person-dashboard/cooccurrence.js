/**
 * IWAC Visualizations — Person + Entity Dashboards: cooccurrence chord
 *
 * Pairwise co-occurrence among the top N neighbour entities, drawn as
 * a circular ECharts graph (chord-style). Distinct from the existing
 * Associated Entities network: that one is ego-centric (current entity
 * at the centre, edges = TF-IDF to that centre); this one is pair-wise
 * — each edge measures how often two NEIGHBOURS appear together in
 * items the current entity is also in.
 *
 * Reuses C.chord from chart-options.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.chord) {
        console.warn('IWACVis.person-dashboard/cooccurrence: missing deps (need C.chord)');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.cooccurrence && data.cooccurrence.by_role) || {};

        function currentData() {
            return byRole[facet.role] || { names: [], matrix: [] };
        }

        function hasData() {
            var d = currentData();
            return d && d.names && d.names.length > 1;
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData()) {
                instance.setOption(C.chord(currentData()), true);
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
                    chart.setOption(C.chord(currentData()), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.cooccurrence = { render: render };
})();
