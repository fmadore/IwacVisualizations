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
 *          connected to every entity it shares with the center article,
 *          so the layout pulls it towards the cluster of entities it
 *          overlaps with.
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
 * Related articles with zero edges (shouldn't happen given how the Python
 * generator builds the list) are filtered out at build time.
 *
 * Rendered by the shared canvas force graph (shared/entity-graph.js →
 * graph-panel.js → graph-force.js) since v1.28, replacing the frozen
 * ECharts `graph`/`force` series. See person-dashboard/network.js for what
 * that swap buys; this panel gains the most from the collision-placed
 * labels, because it is the module's densest ego graph.
 *
 * The centre's own statements are tagged `kind: 'ego'` and the
 * related-article fan-out `kind: 'cross'`, which is what the renderer reads
 * to draw the second layer thinner and dashed — so "what this article is
 * about" stays legible through "what else cites the same things".
 *
 * Clicking a node selects it (neighbourhood highlighted, connections named,
 * record offered as an explicit link in the card) rather than navigating
 * away. Both entity and article records live at /item/<o_id>; Omeka picks
 * the right page from the item's template, so following an article node's
 * link lands on that article's own dashboard.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.mountEntityGraph) {
        console.warn('IWACVis.article-dashboard/network: missing deps (need shared/entity-graph.js)');
        return;
    }

    /**
     * Build {nodes, edges} from the article's entities + related-articles
     * precompute. Center article node gets `type='center'`; entities keep
     * their index Type string; related articles get `type='article'`.
     *
     * Node.score / edge.weight drive the radial symbol/line sizing:
     *   - center.score = null (fixed 56px symbol)
     *   - entity.score = 1 (uniform small-ish ring)
     *   - related_article.score = shared_count (bigger ring → visual anchor)
     *
     * `cooc` is passed through as the tooltip count: for entities it's 1
     * (this article mentions it once); for related articles it's the number
     * of shared entities.
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
                cooc:   1,
                kind:   'ego'
            });
        });

        // Cap the outer ring: 20 was visually too dense at typical panel
        // widths and made the layout chase long edges across the viewport.
        // Twelve reads as a cloud around each entity cluster without
        // overwhelming the graph — readers who want the full list use the
        // dedicated "Related articles" card panel below.
        var OUTER_CAP = 12;
        (relatedArticles || []).slice(0, OUTER_CAP).forEach(function (rel) {
            if (rel == null || rel.o_id == null) return;
            var sharedIds = (rel.shared || []).filter(function (id) { return entityIds[id]; });
            if (sharedIds.length === 0) return; // unreachable entity set — skip

            var shared = rel.shared_count || sharedIds.length;
            nodes.push({
                o_id:  rel.o_id,
                title: rel.title || ('#' + rel.o_id),
                type:  'article',
                cooc:  shared,
                score: Math.max(1, shared)
            });
            // Fan-out edges: one per shared entity, so the layout pulls this
            // article towards the cluster of entities it overlaps with.
            sharedIds.forEach(function (entId) {
                edges.push({
                    source: rel.o_id,
                    target: entId,
                    weight: 1,
                    cooc:   1,
                    kind:   'cross'
                });
            });
        });

        return { nodes: nodes, edges: edges };
    }

    function render(panelEl, data, facet, ctx) {
        var article = (data && data.article) || {};
        var entities = (data && data.entities) || [];
        var related  = (data && data.related_by_entities) || [];

        var graph = buildGraph(article, entities, related);
        if (graph.nodes.length < 2) {
            panelEl.chart.appendChild(P.buildEmptyState('No entities tagged'));
            return;
        }

        var mounted = P.mountEntityGraph(panelEl, ctx, {
            variants: { context: graph },
            downloadName: 'iwac-article-context.png',
            ariaLabel: P.t('Network of the entities this article is tagged with and the articles sharing them. Use the arrow keys to move between them and Enter to select one.')
        });
        if (!mounted || !mounted.show('context', false)) {
            panelEl.chart.appendChild(P.buildEmptyState('No entities tagged'));
        }
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.network = { render: render };
})();
