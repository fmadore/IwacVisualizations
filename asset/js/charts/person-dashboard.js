/**
 * IWAC Visualizations — Person Dashboard block (orchestrator)
 *
 * Migrated to the v0.16.0 declarative dashboard-layout system. The
 * orchestrator now registers one layout (`'person'`) once at module
 * load, then on `DOMContentLoaded` it fetches the per-person JSON,
 * mounts the header (summary stats + role facet bar — outside the
 * grid, since they're not chart panels), and delegates the panel
 * grid to `IWACVis.dashboardLayout.render(body, 'person', data, ctx)`.
 *
 * Renderer wiring lives in `shared/dashboard-panels-bridge.js`, which
 * the template loads as the last `panels` entry. Predicates
 * (`hasNewspapersData`, `hasTopicsData`, `hasSentimentData`) live
 * here as part of the layout definition — they're person/entity-
 * specific and read from the precomputed bundle's `by_role.all`
 * sections (the same shape as the legacy hand-rolled orchestrator).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions || !ns.dashboardLayout) {
        console.warn('IWACVis person dashboard: missing dependencies — check script load order');
        return;
    }
    var P  = ns.panels;
    var DL = ns.dashboardLayout;

    /* ----------------------------------------------------------------- */
    /*  Layout registration                                               */
    /* ----------------------------------------------------------------- */
    //
    // The nine-slot grid and its empty-payload predicates live on the bridge
    // (`DL.personLikeSlots`), which the template already loads as the last
    // `panels` entry — the entity dashboard registers the same grid with the
    // entity wording. Renderer wiring lives there too.

    DL.register('person', DL.personLikeSlots(''));

    /* ----------------------------------------------------------------- */
    /*  Bootstrap — shared per-item dashboard boot (fetch → header → grid) */
    /* ----------------------------------------------------------------- */
    //
    // The header (stats row + role facet bar) mounts before the chart
    // grid via `mountHeader`, so the order stays stats / facet / grid.
    // The facet built by `makeFacet` is placed on ctx.facet and reused by
    // both the header renderers and the bridge's `(panelEl, data, facet,
    // ctx)` reassembly. Predicates + layout above are person-specific.

    P.bootPerItemDashboard({
        selector:   '.iwac-vis-person',
        classToken: 'person',
        dataDir:    'person-dashboards',
        layout:     'person',
        warnLabel:  'IWACVis person dashboard',
        makeFacet:  function () {
            var pd = ns.personDashboard || {};
            return pd.facet ? pd.facet.create('all') : null;
        },
        mountHeader: function (body, data, ctx) {
            var pd = ns.personDashboard || {};
            var statsHost = P.el('div', 'iwac-vis-person__stats');
            body.appendChild(statsHost);
            if (pd.stats) pd.stats.render(statsHost, data, ctx.facet);

            var facetHost = P.el('div', 'iwac-vis-person__facet');
            body.appendChild(facetHost);
            if (pd.facet) pd.facet.render(facetHost, data, ctx.facet);
        }
    });
})();
