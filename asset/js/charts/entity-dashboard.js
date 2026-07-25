/**
 * IWAC Visualizations — Entity Dashboard block (orchestrator)
 *
 * Drives the dashboard for non-person entities (Lieux, Organisations,
 * Sujets, Événements). Same nine panels as the person dashboard MINUS
 * the role facet bar — non-person items always pass `role = 'all'`
 * since the precompute (`generate_entity_dashboards.py`) wraps every
 * section in `by_role.all` precisely so the panel modules work
 * unchanged with a no-op facet.
 *
 * Migrated to the v0.16.0 declarative dashboard-layout system. The
 * `'entity'` layout is structurally identical to `'person'` but uses
 * the entity-specific i18n descriptors (`desc_entity_*`) — the
 * underlying panel modules are the same ones the person dashboard
 * dispatches to, registered into `IWACVis.dashboardLayout` by
 * `shared/dashboard-panels-bridge.js`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions || !ns.dashboardLayout) {
        console.warn('IWACVis entity dashboard: missing dependencies — check script load order');
        return;
    }
    var P  = ns.panels;
    var DL = ns.dashboardLayout;

    /* ----------------------------------------------------------------- */
    /*  Layout registration                                               */
    /* ----------------------------------------------------------------- */
    //
    // Structurally identical to the person grid — same renderer keys, same
    // predicates — with the entity wording on the five descriptions that have
    // a variant. Both come from the same builder on the bridge.

    DL.register('entity', DL.personLikeSlots('entity'));

    /* ----------------------------------------------------------------- */
    /*  Bootstrap — shared per-item dashboard boot                         */
    /* ----------------------------------------------------------------- */
    //
    // No role facet (non-person entities are always `role = 'all'`), so we
    // rely on the helper's default no-op facet and mount only the stats row.

    P.bootPerItemDashboard({
        selector:   '.iwac-vis-entity',
        classToken: 'entity',
        dataDir:    'entity-dashboards',
        layout:     'entity',
        warnLabel:  'IWACVis entity dashboard',
        mountHeader: function (body, data, ctx) {
            var pd = ns.personDashboard || {};
            var statsHost = P.el('div', 'iwac-vis-entity__stats');
            body.appendChild(statsHost);
            if (pd.stats) pd.stats.render(statsHost, data, ctx.facet);
        }
    });
})();
