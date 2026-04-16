/**
 * IWAC Visualizations — Article Dashboard block (orchestrator)
 *
 * Thin controller: fetches asset/data/article-dashboards/{o_id}.json,
 * builds the layout skeleton, and dispatches each panel's render to
 * its module under asset/js/charts/article-dashboard/.
 *
 * Layout (top → bottom):
 *   1. Stats row                               — stats.js
 *   2. Server-rendered sentiment panel         — (rendered in article.phtml,
 *                                                the orchestrator leaves
 *                                                it in place)
 *   3. Context network (wide)                  — network.js
 *   4. Related by shared entities (wide)       — related.js
 *   5. Similar articles by embedding (wide)    — semantic.js
 *   6. Spatial coverage (wide)                 — spatial-map.js
 *
 * Sentiment is rendered server-side from Omeka item metadata via
 * article.phtml + SentimentExtractor, so it is NOT fetched from the
 * precomputed JSON. That's intentional: editorial changes on
 * islam.zmo.de land instantly without waiting for a regenerator pass.
 * The radar chart for the 3-model comparison self-initialises from a
 * `<script type="application/json">` embedded in the rendered PHP; see
 * article-dashboard/radar.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis article dashboard: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;

    /** No-op facet — keeps the panel call signature uniform with the person / entity dashboards. */
    function createNoopFacet() {
        return {
            role: 'all',
            subscribe: function () {},
            set: function () {}
        };
    }

    function hasNetworkData(data) {
        var entities = (data && data.entities) || [];
        var related  = (data && data.related_by_entities) || [];
        return entities.length > 0 || related.length > 0;
    }
    function hasRelatedData(data) {
        return ((data && data.related_by_entities) || []).length > 0;
    }
    function hasSemanticData(data) {
        return ((data && data.semantic_neighbors) || []).length > 0;
    }
    function hasSpatialData(data) {
        return ((data && data.spatial) || []).length > 0;
    }

    function buildLayout(container, data) {
        var loading = container.querySelector('.iwac-vis-article__loading');
        if (loading) loading.remove();

        // The server-rendered sentiment panel (`.iwac-vis-article__sentiment`)
        // already lives inside the container; we need to insert our
        // dynamic panels AFTER it so the reader's scroll order matches
        // the conceptual reading order (metrics → sentiment → context →
        // related → similar → spatial).
        var sentimentSection = container.querySelector('.iwac-vis-article__sentiment');

        var body = P.el('div', 'iwac-vis-article__body');

        // 1. Stats row
        var statsHost = P.el('div', 'iwac-vis-article__stats');
        body.appendChild(statsHost);

        // 3–6. Panel grid (below the PHP-rendered sentiment section).
        var grid = P.buildChartsGrid();
        grid.classList.add('iwac-vis-article__grid');
        body.appendChild(grid);

        var networkPanel = hasNetworkData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('Context network'), P.t('desc_article_context_network'))
            : null;
        var relatedPanel = hasRelatedData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('Related articles'), P.t('desc_article_related'))
            : null;
        var semanticPanel = hasSemanticData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('Semantic neighbors'), P.t('desc_article_semantic_neighbors'))
            : null;
        var spatialPanel = hasSpatialData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('Spatial coverage'), P.t('desc_article_spatial'))
            : null;

        [networkPanel, relatedPanel, semanticPanel, spatialPanel]
            .forEach(function (p) { if (p) grid.appendChild(p.panel); });

        // Insert body AFTER the sentiment section. If no sentiment was
        // rendered (unrated article, or the whole section skipped),
        // the body lands at the end of the container as normal.
        if (sentimentSection && sentimentSection.parentNode === container) {
            container.insertBefore(body, sentimentSection.nextSibling);
            // Also move the stats ABOVE the sentiment section so the
            // reader sees the quick metric card row first.
            container.insertBefore(statsHost, sentimentSection);
        } else {
            container.appendChild(body);
        }

        return {
            stats:    statsHost,
            network:  networkPanel,
            related:  relatedPanel,
            semantic: semanticPanel,
            spatial:  spatialPanel
        };
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

        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var ad = ns.articleDashboard || {};
                var facet = createNoopFacet();
                var h = buildLayout(container, data);

                if (ad.stats)                    ad.stats.render(h.stats, data, facet);
                if (ad.network && h.network)     ad.network.render(h.network, data, facet, ctx);
                if (ad.related && h.related)     ad.related.render(h.related, data, facet, ctx);
                if (ad.semantic && h.semantic)   ad.semantic.render(h.semantic, data, facet, ctx);
                if (ad.spatialMap && h.spatial)  ad.spatialMap.render(h.spatial, data, facet, ctx);
                // articleDashboard.radar self-initialises from the
                // inline JSON script block in article.phtml; no-op here.
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
