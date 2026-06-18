/**
 * IWAC Visualizations — Article Dashboard: context network
 *
 * A single force-directed graph that answers two questions at once:
 *
 *   1. "What is this article about?"
 *        → inner ring of entities (Personnes / Organisations / Lieux /
 *          Sujets / Événements), one node per tagged index entry.
 *   2. "What else should I read?"
 *        → outer ring of related articles — the top K articles sharing
 *          the most entities with this one. Each related article is
 *          connected to every entity it shares with the center
 *          article, so ECharts' force layout pulls articles towards
 *          the cluster of entities they overlap with.
 *
 * Topology:
 *
 *            article (center, large)
 *                 ├── entity_1 ─── related_article_A
 *                 ├── entity_2 ─── related_article_A
 *                 ├── entity_2 ─── related_article_B
 *                 ├── entity_3
 *                 └── entity_4 ─── related_article_C
 *
 * Related articles with zero edges (shouldn't happen given how the
 * Python generator builds the list) are filtered out at build time.
 *
 * Reuses C.network(graph, opts) from chart-options.js unchanged —
 * the builder is topology-agnostic: it auto-creates legend categories
 * from whatever `type` strings it encounters, and node.type='article'
 * picks up the `entity_type_article` i18n key + the next fallback
 * palette colour automatically.
 *
 * Click routing:
 *   - Entity node  → /item/<o_id>  (resolves to its entity dashboard)
 *   - Article node → /item/<o_id>  (resolves to the other article's
 *                    dashboard — the feedback loop works out of the box)
 *   - Center node is ignored (users already have a URL bar for that)
 *
 * The 6-button toolbar (zoom +/−, reset, legend, download, fullscreen)
 * and the drag-suppressed click-through come from the shared
 * `P.buildGraphPanelToolbar` / `P.attachGraphClickThrough` helpers, so
 * this panel and the person/entity network stay consistent.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.network) {
        console.warn('IWACVis.article-dashboard/network: missing deps (need C.network)');
        return;
    }

    /**
     * Build {nodes, edges} from the article's entities + related-articles
     * precompute. Center article node gets `type='center'`; entities
     * keep their index Type string; related articles get `type='article'`.
     *
     * Node.score / edge.weight drive the radial symbol/line sizing in
     * C.network. We use:
     *   - center.score = null (gets the fixed 56px symbol from the builder)
     *   - entity.score = 1 (uniform small-ish ring)
     *   - related_article.score = shared_count (bigger ring → visual anchor)
     *   - center→entity edge weight = 1 (uniform line)
     *   - related→entity edge weight = 1 (uniform line)
     *
     * `cooc` is passed through as the tooltip count: for entities it's
     * 1 (this article mentions it once); for related articles it's the
     * number of shared entities.
     */
    function buildGraph(article, entities, relatedArticles) {
        var centerId = article.o_id;
        var centerTitle = article.title || ('#' + centerId);

        var nodes = [];
        var edges = [];
        var entityIds = {};

        nodes.push({
            o_id:  centerId,
            title: centerTitle,
            type:  'center',
            cooc:  null,
            score: null
        });

        entities.forEach(function (ent) {
            if (ent == null || ent.o_id == null) return;
            nodes.push({
                o_id:  ent.o_id,
                title: ent.title || ('#' + ent.o_id),
                type:  ent.type || 'Sujets',
                cooc:  1,
                score: 1
            });
            entityIds[ent.o_id] = true;
            edges.push({
                source: centerId,
                target: ent.o_id,
                weight: 1,
                cooc:   1
            });
        });

        // Cap the outer ring: 20 was visually too dense at typical
        // panel widths and made the force layout chase long edges
        // across the viewport. Twelve reads as a cloud around each
        // entity cluster without overwhelming the graph — readers who
        // want the full list now use the dedicated "Related articles"
        // card panel below.
        var OUTER_CAP = 12;
        (relatedArticles || []).slice(0, OUTER_CAP).forEach(function (rel) {
            if (rel == null || rel.o_id == null) return;
            var sharedIds = (rel.shared || []).filter(function (id) { return entityIds[id]; });
            if (sharedIds.length === 0) return; // unreachable entity set — skip

            nodes.push({
                o_id:  rel.o_id,
                title: rel.title || ('#' + rel.o_id),
                type:  'article',
                cooc:  rel.shared_count || sharedIds.length,
                score: Math.max(1, rel.shared_count || sharedIds.length)
            });
            // Fan-out edges: one per shared entity. ECharts' force
            // layout pulls this node towards the cluster of entities
            // it shares with the center.
            sharedIds.forEach(function (entId) {
                edges.push({
                    source: rel.o_id,
                    target: entId,
                    weight: 1,
                    cooc:   1
                });
            });
        });

        return { nodes: nodes, edges: edges };
    }

    function render(panelEl, data, facet, ctx) {
        var article = (data && data.article) || {};
        var entities = (data && data.entities) || [];
        var related  = (data && data.related_by_entities) || [];

        panelEl.chart.classList.add('iwac-vis-graph-host');
        if (panelEl.panel && panelEl.panel.setAttribute) {
            panelEl.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        }

        var graph = buildGraph(article, entities, related);
        var hasData = graph.nodes.length > 1;

        // The toolbar's legend toggle mutates legend visibility; buildFullOption
        // reads it back so a theme-swap re-render keeps the user's choice.
        var toolbar = null;
        function buildFullOption() {
            // thumbnail: ECharts 6 minimap — the 3-layer context graph
            // is the module's densest; the minimap keeps the viewport
            // situated while roaming (auto-hidden ≤640px).
            return C.network(graph, {
                showLegend: toolbar ? toolbar.isLegendVisible() : true,
                thumbnail: true
            });
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData) {
                instance.setOption(buildFullOption(), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData) {
            panelEl.chart.appendChild(P.buildEmptyState('No entities tagged'));
            return;
        }

        // ---------------- Toolbar + click-through ----------------
        toolbar = P.buildGraphPanelToolbar(panelEl, chart, {
            downloadName: 'iwac-article-context.png'
        });
        P.attachGraphClickThrough(chart, function (node) {
            if (node.entityType === 'center') return;
            if (node.o_id != null && ctx && ctx.siteBase) {
                // Both entity and article nodes route through /item/<o_id>;
                // Omeka picks the right page based on the item's template.
                window.location.href = ctx.siteBase + '/item/' + node.o_id;
            }
        });
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.network = { render: render };
})();
