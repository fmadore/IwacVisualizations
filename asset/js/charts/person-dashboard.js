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
    /*  Empty-payload predicates                                          */
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
    /*  Layout registration — slot per panel module                       */
    /* ----------------------------------------------------------------- */
    //
    // Every slot uses `DL.fullSlice` as its dataAccessor so the slice
    // *is* the whole data bundle. Predicates above receive that bundle
    // and return true/false; the bridge renderer reads `ctx.data` for
    // the actual payload (same as the slice — it's the full bundle).
    // Titles + descriptions are i18n keys that the layout system
    // routes through `P.t()` automatically.

    var ALL = DL.fullSlice;

    DL.register('person', [
        { chart: 'iwacTimeline',     wide: true, dataAccessor: ALL,
          title: 'Mentions',                description: 'desc_mentions_timeline' },
        { chart: 'iwacHeatmap',      wide: true, dataAccessor: ALL,
          title: 'Year × month heatmap',    description: 'desc_year_month_heatmap' },
        { chart: 'iwacNewspapers',               dataAccessor: ALL,
          title: 'Top newspapers',          description: 'desc_top_newspapers',
          hasData: hasNewspapersData },
        { chart: 'iwacCountries',                dataAccessor: ALL,
          title: 'Countries covered',       description: 'desc_countries_covered' },
        { chart: 'iwacTopics',       wide: true, dataAccessor: ALL,
          title: 'Top LDA topics',          description: 'desc_lda_topics',
          hasData: hasTopicsData },
        { chart: 'iwacSentiment',    wide: true, dataAccessor: ALL,
          title: 'AI sentiment',            description: 'desc_ai_sentiment',
          hasData: hasSentimentData },
        { chart: 'iwacEntityNet',    wide: true, dataAccessor: ALL,
          title: 'Associated entities',     description: 'desc_associated_entities' },
        { chart: 'iwacCoOccurrence', wide: true, dataAccessor: ALL,
          title: 'Subject co-occurrence',   description: 'desc_subject_cooccurrence' },
        { chart: 'iwacEntityMap',    wide: true, dataAccessor: ALL,
          title: 'Associated locations',    description: 'desc_associated_locations' }
    ]);

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
