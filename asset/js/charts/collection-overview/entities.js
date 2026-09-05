/**
 * IWAC Visualizations — Collection Overview: Entities panel
 *
 * The shared entities panel (shared/entities-panel.js) in the
 * collection's tab order — persons, organisations, places, subjects,
 * events. Registered under its own namespace because the orchestrator
 * reaches for `ns.collectionOverview.entities`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildEntitiesPanel) {
        console.warn('IWACVis.collection-overview/entities: missing dependencies');
        return;
    }

    var TYPE_ORDER = ['Personnes', 'Organisations', 'Lieux', 'Sujets', 'Événements'];

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.entities = {
        render: function (panelEl, data, ctx) {
            P.buildEntitiesPanel(panelEl, (data && data.top_entities) || {}, ctx, {
                typeOrder: TYPE_ORDER
            });
        }
    };
})();
