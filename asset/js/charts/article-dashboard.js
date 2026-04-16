/**
 * IWAC Visualizations — Article Dashboard block (orchestrator)
 *
 * Layout (top → bottom):
 *   1. Server-rendered sentiment panel    — rendered in article.phtml
 *                                           directly, left in place
 *   2. Context network (wide)             — network.js
 *   3. Further reading (wide)             — further-reading.js
 *                                           (toggle: by shared tags |
 *                                            by similar content)
 *
 * The stats panel, separate related-articles grid, separate similar-
 * articles grid, and the spatial-coverage map are intentionally NOT
 * rendered on article pages anymore — per user feedback the first
 * two were noise and the last two read better as a single toggleable
 * panel.
 *
 * Sentiment is rendered server-side from Omeka item metadata via
 * article.phtml + SentimentExtractor, so it is NOT fetched from the
 * precomputed JSON. The radar chart for the 3-model comparison
 * self-initialises from a `<script type="application/json">` embedded
 * in the rendered PHP; see article-dashboard/radar.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis article dashboard: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;

    function createNoopFacet() {
        return { role: 'all', subscribe: function () {}, set: function () {} };
    }

    function hasNetworkData(data) {
        var entities = (data && data.entities) || [];
        var related  = (data && data.related_by_entities) || [];
        return entities.length > 0 || related.length > 0;
    }
    function hasFurtherData(data) {
        return ((data && data.related_by_entities) || []).length > 0
            || ((data && data.semantic_neighbors) || []).length > 0;
    }

    function buildLayout(container, data) {
        var loading = container.querySelector('.iwac-vis-article__loading');
        if (loading) loading.remove();

        // The PHP-rendered sentiment section already lives inside the
        // container. We append our dynamic panels as siblings in an
        // .iwac-vis-article__body wrapper BELOW it. The wrapper is
        // what establishes the inter-panel gap (flex column + gap).
        var body = P.el('div', 'iwac-vis-article__body');
        container.appendChild(body);

        var grid = P.buildChartsGrid();
        grid.classList.add('iwac-vis-article__grid');
        body.appendChild(grid);

        var networkPanel = hasNetworkData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('Context network'), P.t('desc_article_context_network'))
            : null;
        var furtherPanel = hasFurtherData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('Further reading'), P.t('desc_article_further_reading'))
            : null;

        [networkPanel, furtherPanel].forEach(function (p) {
            if (p) grid.appendChild(p.panel);
        });

        return {
            network: networkPanel,
            further: furtherPanel
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

                if (ad.network && h.network)     ad.network.render(h.network, data, facet, ctx);
                if (ad.furtherReading && h.further)
                    ad.furtherReading.render(h.further, data, facet, ctx);
                // articleDashboard.radar self-initialises from the inline
                // JSON script block emitted by article.phtml.
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
        for (var i = 0; i < containers.length; i++) initDashboard(containers[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
