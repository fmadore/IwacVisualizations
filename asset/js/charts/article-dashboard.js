/**
 * IWAC Visualizations — Article Dashboard block (orchestrator)
 *
 * Thin controller: fetches asset/data/article-dashboards/{o_id}.json,
 * builds the layout skeleton, and dispatches each panel's render to
 * its module under asset/js/charts/article-dashboard/.
 *
 * Layout:
 *   Row 1 (compact stat cards)             — stats.js
 *   Row 2 (wide: AI sentiment tabs)        — sentiment.js
 *   Row 3 (wide: context force graph)      — network.js
 *   Row 4 (side-by-side on desktop):
 *     - Similar articles (semantic bar)    — semantic.js
 *     - Spatial coverage (MapLibre)        — spatial-map.js
 *
 * Unlike person / entity dashboards, articles have no role facet —
 * we pass a no-op facet to sentiment.js so its interface stays
 * symmetric with the aggregate panel.
 *
 * Panels whose backing precompute is empty are elided from the layout
 * entirely (no dead "No data" cards for articles missing AI sentiment,
 * embeddings, or spatial tags).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis article dashboard: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;

    /**
     * No-op facet honored by the sentiment panel's `.subscribe()` call.
     * Matches the interface the person / entity panels expect.
     */
    function createNoopFacet() {
        return {
            role: 'all',
            subscribe: function () {},
            set: function () {}
        };
    }

    function hasSentimentData(data) {
        var s = data && data.sentiment;
        if (!s || !s.by_model) return false;
        var models = s.models || Object.keys(s.by_model);
        for (var i = 0; i < models.length; i++) {
            var m = s.by_model[models[i]];
            if (!m) continue;
            // A panel is worth rendering if the model rated ANY axis.
            if ((m.polarite && m.polarite.length) ||
                (m.centralite && m.centralite.length) ||
                (m.subjectivite && m.subjectivite.length)) return true;
        }
        return false;
    }

    function hasNetworkData(data) {
        var entities = (data && data.entities) || [];
        var related = (data && data.related_by_entities) || [];
        // We still render the network if there's at least one entity —
        // the center article + a ring of entities is a useful view even
        // without any related articles.
        return entities.length > 0 || related.length > 0;
    }

    function hasSemanticData(data) {
        var n = (data && data.semantic_neighbors) || [];
        return n.length > 0;
    }

    function hasSpatialData(data) {
        var s = (data && data.spatial) || [];
        return s.length > 0;
    }

    function buildLayout(container, data) {
        var loading = container.querySelector('.iwac-vis-article__loading');
        if (loading) loading.remove();

        var body = P.el('div', 'iwac-vis-article__body');
        container.appendChild(body);

        // 1. Compact stats row — hosted by a plain div, stats.js fills it.
        var statsHost = P.el('div', 'iwac-vis-article__stats');
        body.appendChild(statsHost);

        // 2–5. Panels grid.
        var grid = P.buildChartsGrid();
        grid.classList.add('iwac-vis-article__grid');
        body.appendChild(grid);

        var sentimentPanel = hasSentimentData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('AI sentiment'), P.t('desc_article_sentiment'))
            : null;
        var networkPanel = hasNetworkData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Context network'), P.t('desc_article_context_network'))
            : null;
        var semanticPanel = hasSemanticData(data)
            ? P.buildPanel('iwac-vis-panel', P.t('Semantic neighbors'), P.t('desc_article_semantic_neighbors'))
            : null;
        var spatialPanel = hasSpatialData(data)
            ? P.buildPanel('iwac-vis-panel', P.t('Spatial coverage'), P.t('desc_article_spatial'))
            : null;

        [sentimentPanel, networkPanel, semanticPanel, spatialPanel]
            .forEach(function (p) { if (p) grid.appendChild(p.panel); });

        return {
            stats: statsHost,
            sentiment: sentimentPanel,
            network: networkPanel,
            semantic: semanticPanel,
            spatial: spatialPanel
        };
    }

    function initDashboard(container) {
        var itemId = container.dataset.itemId;
        if (!itemId) return;

        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || '',
            itemId: itemId
        };
        var url = ctx.basePath + '/modules/IwacVisualizations/asset/data/article-dashboards/' + itemId + '.json';

        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var ad = ns.articleDashboard || {};
                var facet = createNoopFacet();
                var h = buildLayout(container, data);

                if (ad.stats)                      ad.stats.render(h.stats, data, facet);
                if (ad.sentiment && h.sentiment)   ad.sentiment.render(h.sentiment, data, facet);
                if (ad.network && h.network)       ad.network.render(h.network, data, facet, ctx);
                if (ad.semantic && h.semantic)     ad.semantic.render(h.semantic, data, facet, ctx);
                if (ad.spatialMap && h.spatial)    ad.spatialMap.render(h.spatial, data, facet, ctx);
            })
            .catch(function (err) {
                console.error('IWACVis article dashboard:', err);
                var loading = container.querySelector('.iwac-vis-article__loading');
                if (loading) loading.remove();
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis article dashboard: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-article');
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
