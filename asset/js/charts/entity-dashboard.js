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
    /*  Empty-payload predicates (same shape as person dashboard)         */
    /* ----------------------------------------------------------------- */

    function hasNewspapersData(data) {
        var all = data && data.newspapers && data.newspapers.by_role && data.newspapers.by_role.all;
        return !!(all && all.length > 0);
    }
    function hasTopicsData(data) {
        var all = data && data.topics && data.topics.by_role && data.topics.by_role.all;
        return !!(all && all.length > 0);
    }
    function hasSentimentData(data) {
        var all = data && data.sentiment && data.sentiment.by_role && data.sentiment.by_role.all;
        if (!all || !all.by_model) return false;
        var models = all.models || Object.keys(all.by_model);
        for (var i = 0; i < models.length; i++) {
            var m = all.by_model[models[i]];
            if (m && m.polarite && m.polarite.length > 0) return true;
        }
        return false;
    }

    /* ----------------------------------------------------------------- */
    /*  Layout — same renderer keys as 'person', entity-specific descs    */
    /* ----------------------------------------------------------------- */

    var ALL = DL.fullSlice;

    DL.register('entity', [
        { chart: 'iwacTimeline',     wide: true, dataAccessor: ALL,
          title: 'Mentions',                description: 'desc_entity_mentions_timeline' },
        { chart: 'iwacHeatmap',      wide: true, dataAccessor: ALL,
          title: 'Year × month heatmap',    description: 'desc_year_month_heatmap' },
        { chart: 'iwacNewspapers',               dataAccessor: ALL,
          title: 'Top newspapers',          description: 'desc_entity_top_newspapers',
          hasData: hasNewspapersData },
        { chart: 'iwacCountries',                dataAccessor: ALL,
          title: 'Countries covered',       description: 'desc_entity_countries_covered' },
        { chart: 'iwacTopics',       wide: true, dataAccessor: ALL,
          title: 'Top LDA topics',          description: 'desc_lda_topics',
          hasData: hasTopicsData },
        { chart: 'iwacSentiment',    wide: true, dataAccessor: ALL,
          title: 'AI sentiment',            description: 'desc_ai_sentiment',
          hasData: hasSentimentData },
        { chart: 'iwacEntityNet',    wide: true, dataAccessor: ALL,
          title: 'Associated entities',     description: 'desc_entity_associated_entities' },
        { chart: 'iwacCoOccurrence', wide: true, dataAccessor: ALL,
          title: 'Subject co-occurrence',   description: 'desc_subject_cooccurrence' },
        { chart: 'iwacEntityMap',    wide: true, dataAccessor: ALL,
          title: 'Associated locations',    description: 'desc_entity_associated_locations' }
    ]);

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
