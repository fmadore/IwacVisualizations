/**
 * IWAC Visualizations — Article Dashboard block (orchestrator)
 *
 * Migrated to the v0.16.0 declarative dashboard-layout system. The
 * `'article'` layout is two slots:
 *
 *   1. Context network    — `iwacArticleNetwork` (the 3-layer force
 *                            graph: article + tagged entities + top
 *                            related articles via shared-entity overlap)
 *   2. Further reading    — `iwacArticleFurther` (toggle between
 *                            "by shared tags" and "by similar content")
 *
 * Server-side renders (the AI sentiment cards + the radar chart that
 * self-initialises from the inline JSON) live in `article.phtml` and
 * are NOT part of the dashboardLayout slot list. The radar
 * (`articleDashboard.radar`) hangs off its own DOM hook — it doesn't
 * need an orchestrator.
 *
 * Renderer wiring lives in `shared/dashboard-panels-bridge.js`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions || !ns.dashboardLayout) {
        console.warn('IWACVis article dashboard: missing dependencies — check script load order');
        return;
    }
    var P  = ns.panels;
    var DL = ns.dashboardLayout;

    /* ----------------------------------------------------------------- */
    /*  Empty-payload predicates                                          */
    /* ----------------------------------------------------------------- */

    function hasNetworkData(data) {
        var entities = (data && data.entities) || [];
        var related  = (data && data.related_by_entities) || [];
        return entities.length > 0 || related.length > 0;
    }
    function hasFurtherData(data) {
        return ((data && data.related_by_entities) || []).length > 0
            || ((data && data.semantic_neighbors) || []).length > 0;
    }

    /* ----------------------------------------------------------------- */
    /*  Layout                                                            */
    /* ----------------------------------------------------------------- */

    var ALL = DL.fullSlice;

    DL.register('article', [
        { chart: 'iwacArticleNetwork', wide: true, dataAccessor: ALL,
          title: 'Context network',  description: 'desc_article_context_network',
          hasData: hasNetworkData },
        { chart: 'iwacArticleFurther', wide: true, dataAccessor: ALL,
          title: 'Further reading',  description: 'desc_article_further_reading',
          hasData: hasFurtherData }
    ]);

    /* ----------------------------------------------------------------- */
    /*  Bootstrap                                                         */
    /* ----------------------------------------------------------------- */

    function noopFacet() {
        return { role: 'all', subscribe: function () {}, set: function () {} };
    }

    function initDashboard(container) {
        var itemId = container.dataset.itemId;
        if (!itemId) return;

        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || '',
            itemId:   itemId
        };
        var url = ctx.basePath + '/modules/IwacVisualizations/asset/data/article-dashboards/' + itemId + '.json';

        P.fetchJSON(url)
            .then(function (data) {
                var loading = container.querySelector('.iwac-vis-article__loading');
                if (loading) loading.remove();

                // Mount the dynamic-panels wrapper as a sibling of the
                // server-rendered sentiment block already present in
                // article.phtml; keeps the inter-panel gap consistent
                // with the other dashboards.
                var body = P.el('div', 'iwac-vis-article__body');
                container.appendChild(body);

                ctx.data  = data;
                ctx.facet = noopFacet();
                DL.render(body, 'article', data, ctx);

                // articleDashboard.radar self-initialises off the
                // inline `<script type="application/json">` block
                // emitted by article.phtml — no orchestrator step.
            })
            .catch(function (err) {
                console.error('IWACVis article dashboard:', err);
                var loading = container.querySelector('.iwac-vis-article__loading');
                if (loading) loading.remove();
                container.appendChild(P.buildErrorState());
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis article dashboard: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-article');
        for (var i = 0; i < containers.length; i++) initDashboard(containers[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
