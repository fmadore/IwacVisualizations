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
    /*  Bootstrap                                                         */
    /* ----------------------------------------------------------------- */

    function initDashboard(container) {
        var itemId = container.dataset.itemId;
        if (!itemId) return;

        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || '',
            itemId:   itemId
        };
        var url = ctx.basePath + '/modules/IwacVisualizations/asset/data/person-dashboards/' + itemId + '.json';

        P.fetchJSON(url)
            .then(function (data) {
                var loading = container.querySelector('.iwac-vis-person__loading');
                if (loading) loading.remove();

                var pd = ns.personDashboard || {};
                var facet = pd.facet
                    ? pd.facet.create('all')
                    : { role: 'all', subscribe: function () {}, set: function () {} };

                // Header — stats row + role facet bar. Mounted before
                // the chart grid so the order is: stats / facet / grid.
                var body = P.el('div', 'iwac-vis-person__body');
                container.appendChild(body);

                var statsHost = P.el('div', 'iwac-vis-person__stats');
                body.appendChild(statsHost);
                if (pd.stats) pd.stats.render(statsHost, data, facet);

                var facetHost = P.el('div', 'iwac-vis-person__facet');
                body.appendChild(facetHost);
                if (pd.facet) pd.facet.render(facetHost, data, facet);

                // Grid — declarative slot list dispatched through the
                // layout system. Each slot's renderer is a thin
                // wrapper around the legacy panel module, registered
                // by shared/dashboard-panels-bridge.js. ctx carries
                // `data` and `facet` so the bridge can reassemble the
                // legacy `(panelEl, data, facet, ctx)` signature.
                ctx.data  = data;
                ctx.facet = facet;
                DL.render(body, 'person', data, ctx);
            })
            .catch(function (err) {
                console.error('IWACVis person dashboard:', err);
                var loading = container.querySelector('.iwac-vis-person__loading');
                if (loading) loading.remove();
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis person dashboard: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-person');
        for (var i = 0; i < containers.length; i++) {
            initDashboard(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
