/**
 * IWAC Visualizations — Spatial Exploration block (orchestrator)
 *
 * Thin controller: fetches `asset/data/spatial-exploration.json`,
 * builds the sidebar + map two-column layout, creates the shared
 * state hub, and delegates to the two panel modules under
 * `asset/js/charts/spatial-exploration/`:
 *
 *   - picker.js — entity type tabs, search, selection, top places
 *   - map.js    — bubbles, country/admin focus, popups, choropleths
 *
 * Entity selections hydrate from the per-entity dashboard fan-outs
 * (person-dashboards/{id}.json / entity-dashboards/{id}.json) that the
 * resource-page blocks already consume — no duplicated data files.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.spatialExploration ||
        !ns.spatialExploration.createState ||
        !ns.spatialExploration.picker ||
        !ns.spatialExploration.map) {
        console.warn('IWACVis spatial exploration: missing panel modules — check script load order');
        return;
    }
    var P = ns.panels;
    var SE = ns.spatialExploration;

    function buildLayout(container) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-spatial-root');
        container.appendChild(root);

        var layout = P.el('div', 'iwac-vis-layout--sidebar iwac-vis-spatial-layout');
        root.appendChild(layout);

        var sidebar = P.el('aside', 'iwac-vis-aside iwac-vis-spatial-sidebar');
        layout.appendChild(sidebar);

        var main = P.el('div', 'iwac-vis-spatial-main');
        layout.appendChild(main);

        var mapPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-spatial-map-panel',
            P.t('Places map'),
            P.t('spatial_map_description')
        );
        main.appendChild(mapPanel.panel);

        return { sidebar: sidebar, mapPanel: mapPanel };
    }

    P.bootBlock({
        selector:       '.iwac-vis-spatial',
        warnLabel:      'IWACVis spatial exploration',
        requireECharts: false,
        dataFile:       'spatial-exploration.json',
        render:         function (container, data, ctx) {
            var h = buildLayout(container);
            var state = SE.createState(data, ctx);
            SE.picker.render(h.sidebar, state);
            SE.map.render(h.mapPanel, state);
        }
    });
})();
