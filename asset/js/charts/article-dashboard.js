/**
 * IWAC Visualizations — Article Dashboard block (orchestrator)
 *
 * Migrated to the v0.16.0 declarative dashboard-layout system. The
 * `'article'` layout is three slots:
 *
 *   1. Context network    — `iwacArticleNetwork` (the 3-layer force
 *                            graph: article + tagged entities + top
 *                            related articles via shared-entity overlap)
 *   2. Further reading    — `iwacArticleFurther` (toggle between "by
 *                            shared tags", "by similar content" and,
 *                            where the bibliography is embedded, "in the
 *                            scholarship")
 *   3. Spatial coverage   — `iwacArticleMap` (pins for the article's
 *                            geocoded places)
 *
 * A stat-card row (words / Flesch readability / MATTR lexical richness /
 * pages / language / LDA topic) preceded these slots from v1.23.0 until
 * v1.33.0, when it was removed from the item page. The generator still
 * emits those fields on `article`; nothing renders them here.
 *
 * The AI sentiment panel is rendered server-side in `article.phtml`
 * (CSS dot plots off Omeka item metadata, no chart library) and is NOT
 * part of the dashboardLayout slot list — it needs no orchestrator and
 * no JS at all.
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
            || ((data && data.semantic_neighbors) || []).length > 0
            || ((data && data.related_scholarship) || []).length > 0;
    }
    function hasSpatialData(data) {
        return ((data && data.spatial) || []).length > 0;
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
          hasData: hasFurtherData },
        { chart: 'iwacArticleMap', wide: true, dataAccessor: ALL,
          title: 'Spatial coverage', description: 'desc_article_spatial',
          hasData: hasSpatialData }
    ]);

    /* ----------------------------------------------------------------- */
    /*  Bootstrap — shared per-item dashboard boot                         */
    /* ----------------------------------------------------------------- */
    //
    // No facet and no header here: the dynamic-panels `__body` wrapper
    // mounts as a sibling of the server-rendered sentiment block already
    // in article.phtml, which needs no orchestrator step of its own.

    P.bootPerItemDashboard({
        selector:   '.iwac-vis-article',
        classToken: 'article',
        dataDir:    'article-dashboards',
        layout:     'article',
        warnLabel:  'IWACVis article dashboard'
    });
})();
