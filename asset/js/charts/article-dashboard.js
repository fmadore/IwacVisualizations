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
    /*  Bootstrap — shared per-item dashboard boot                         */
    /* ----------------------------------------------------------------- */
    //
    // No header and no facet here: the dynamic-panels `__body` wrapper
    // mounts as a sibling of the server-rendered sentiment block already
    // in article.phtml, and `articleDashboard.radar` self-initialises off
    // that template's inline JSON — neither needs an orchestrator step.

    P.bootPerItemDashboard({
        selector:   '.iwac-vis-article',
        classToken: 'article',
        dataDir:    'article-dashboards',
        layout:     'article',
        warnLabel:  'IWACVis article dashboard'
    });
})();
