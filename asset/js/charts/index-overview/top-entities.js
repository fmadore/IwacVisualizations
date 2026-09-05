/**
 * IWAC Visualizations — Index Overview: Top entities panel
 *
 * The shared entities panel (shared/entities-panel.js) in the index's
 * tab order — places second, since the index is where places are looked
 * up. Registered under its own namespace because the orchestrator
 * reaches for `ns.indexOverview.topEntities`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildEntitiesPanel) {
        console.warn('IWACVis.index-overview/top-entities: missing dependencies');
        return;
    }

    var TYPE_ORDER = ['Personnes', 'Lieux', 'Organisations', 'Sujets', 'Événements'];

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.topEntities = {
        render: function (panelEl, data, ctx) {
            P.buildEntitiesPanel(panelEl, (data && data.top_entities) || {}, ctx, {
                typeOrder: TYPE_ORDER
            });
        }
    };
})();
