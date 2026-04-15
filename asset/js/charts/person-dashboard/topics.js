/**
 * IWAC Visualizations — Person + Entity Dashboards: LDA topics panel
 *
 * Top LDA topic labels for items mentioning the entity, rendered as a
 * horizontal bar via the shared C.horizontalBar builder. Each item
 * counts once toward exactly one topic (the topic the LDA model
 * assigned it). Only the articles subset carries LDA fields; items
 * from publications/references are silently skipped.
 *
 * Lives under person-dashboard/ but is reused verbatim by the entity
 * orchestrator (entity-dashboard.js) — both share the same data shape
 * thanks to the `by_role.all` envelope in the precompute output.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.horizontalBar) {
        console.warn('IWACVis.person-dashboard/topics: missing deps (need C.horizontalBar)');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.topics && data.topics.by_role) || {};
        P.buildFacetedChart(panelEl, {
            facet: facet,
            getData: function () { return (byRole[facet.role] || []).slice(0, 12); },
            hasData: function (entries) { return entries.length > 0; },
            buildOption: function (entries) {
                return C.horizontalBar(entries, {
                    nameKey: 'label',
                    valueKey: 'count',
                    maxLabelLength: 60
                });
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.topics = { render: render };
})();
