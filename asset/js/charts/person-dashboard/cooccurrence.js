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
    if (!P || !C || !C.chord || !P.buildFacetedChart) {
        console.warn('IWACVis.person-dashboard/cooccurrence: missing deps (need C.chord, P.buildFacetedChart)');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.cooccurrence && data.cooccurrence.by_role) || {};

        // Tall chart host so the chord ring has room to breathe and the
        // labels on the outer circle aren't clipped. Matches the graph
        // host height used by the associated-entities network so the
        // two panels feel balanced side by side.
        panelEl.chart.classList.add('iwac-vis-chord-host');

        var ctrl = P.buildFacetedChart(panelEl, {
            facet: facet,
            getData: function () { return byRole[facet.role] || { names: [], matrix: [] }; },
            hasData: function (d) { return !!(d && d.names && d.names.length > 1); },
            buildOption: function (d) { return C.chord(d); }
        });

        // Fullscreen toggle sits in the shared panel-toolbar alongside
        // the auto-attached Download button. The onResize callback
        // tells ECharts to rescale once the browser has applied the
        // new viewport.
        if (ctrl.chart && P.addFullscreenButton) {
            P.addFullscreenButton(panelEl.panel, {
                onResize: function () {
                    var live = ns.getLiveChart && ns.getLiveChart(panelEl.chart);
                    if (live) live.resize();
                }
            });
        }
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.cooccurrence = { render: render };
})();
