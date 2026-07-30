/**
 * IWAC Visualizations — Entity semantics for the canvas force graph.
 *
 * The layer that knows what an IWAC node *is*: index Types (Personnes,
 * Organisations, Lieux, Sujets, Événements), the centre, newspaper articles,
 * their colours, their tooltips, and the URL of the Omeka record behind each
 * one. graph-force.js and graph-panel.js stay generic; this file is where the
 * collection's vocabulary lives, shared by the two item-page ego networks
 * (Associated entities, Article context).
 *
 * Payload shape (from `dashboard_aggregator.compute_network`, and built by
 * hand in article-dashboard/network.js):
 *
 *   { nodes: [{ o_id, title, type, cooc, score }],     // nodes[0] is the centre
 *     edges: [{ source, target, weight, cooc, kind }] } // kind: 'ego' | 'cross'
 *
 * `kind` is optional: dashboards precomputed before v1.28 carry ego edges
 * only and no `kind` field, and must keep rendering.
 *
 * Depends on: panels.js, iwac-theme.js, graph-panel.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.mountForceGraph) {
        console.warn('IWACVis.entity-graph: graph-panel.js must load first');
        return;
    }

    var t = P.t;
    var fmt = P.formatNumber;

    /**
     * Type → palette slot, FIXED.
     *
     * Building categories in order of first appearance — what the ECharts
     * builder did — makes a colour depend on which types a given item happens
     * to have, so Personnes could come out slate on one entity page and green
     * on the next. The slots below reproduce the colours that mapping produced
     * for a full graph, so nothing visibly changes; they just stop moving.
     * Order here is also the legend's order.
     */
    var TYPE_SLOTS = [
        'center',
        'Personnes',
        'Organisations',
        'Lieux',
        'Sujets',
        'Événements',
        'article'
    ];

    /** Node radius in px (diameter), from its distinctiveness score. */
    function sizeOf(node, maxScore) {
        if (node.type === 'center') return 56;
        var norm = Math.max(0, Math.min(1, (node.score || 0) / (maxScore || 1)));
        return 14 + Math.sqrt(norm) * 28;
    }

    /**
     * Mount an entity force graph into a panel.
     *
     * @param {{panel: HTMLElement, chart: HTMLElement}} panelEl
     * @param {Object} ctx                        needs `siteBase` for record links
     * @param {Object} opts
     * @param {Object} opts.variants              key → {nodes, edges}. Every
     *   variant's nodes are registered up front so a facet flip re-settles the
     *   layout instead of restarting it.
     * @param {string} [opts.downloadName]
     * @param {string} [opts.ariaLabel]
     * @returns {{show: function(string, boolean): boolean}|null}
     *   `show(key, warm)` returns false when that variant has nothing to draw.
     */
    P.mountEntityGraph = function (panelEl, ctx, opts) {
        opts = opts || {};
        var variants = opts.variants || {};
        var siteBase = (ctx && ctx.siteBase) || '';
        var palette = (ns.getPalette && ns.getPalette()) || ['#ce4115'];

        /* ---- Vocabulary present across every variant ------------------ */

        var typesPresent = {};
        var byNodeId = {};
        var order = [];
        var maxScore = 1;

        Object.keys(variants).forEach(function (key) {
            ((variants[key] && variants[key].nodes) || []).forEach(function (n) {
                if (n == null || n.o_id == null) return;
                if (n.score > maxScore) maxScore = n.score;
                typesPresent[n.type || 'Sujets'] = true;
                var id = String(n.o_id);
                if (!byNodeId[id]) { byNodeId[id] = n; order.push(id); }
            });
        });

        // Fixed slot order, filtered to what this item actually has. Anything
        // unrecognised lands after the known types, still deterministically.
        var catTypes = TYPE_SLOTS.filter(function (type) { return typesPresent[type]; });
        Object.keys(typesPresent).sort().forEach(function (type) {
            if (catTypes.indexOf(type) < 0) catTypes.push(type);
        });
        if (catTypes.indexOf('center') !== 0) catTypes.unshift('center');

        var catIndex = {};
        var categories = catTypes.map(function (type, i) {
            catIndex[type] = i;
            return { name: t('entity_type_' + type), type: type };
        });

        function slotColor(i) {
            var type = catTypes[i];
            var slot = TYPE_SLOTS.indexOf(type);
            return palette[(slot >= 0 ? slot : TYPE_SLOTS.length + i) % palette.length];
        }

        var nodes = order.map(function (id) {
            var n = byNodeId[id];
            var type = n.type || 'Sujets';
            return {
                id: id,
                name: n.title || ('#' + n.o_id),
                category: catIndex[type] != null ? catIndex[type] : 0,
                size: sizeOf(n, maxScore),
                isCenter: type === 'center',
                url: type === 'center' || !siteBase ? null : siteBase + '/item/' + n.o_id,
                data: n
            };
        });
        if (!nodes.length) return null;

        /* ---- Payload → renderer graph --------------------------------- */

        function toRendererGraph(graph) {
            var edges = (graph && graph.edges) || [];
            var maxEgo = 1, maxCross = 1;
            edges.forEach(function (e) {
                if (e.kind === 'cross') { if (e.weight > maxCross) maxCross = e.weight; }
                else if (e.weight > maxEgo) maxEgo = e.weight;
            });
            return {
                nodes: ((graph && graph.nodes) || []).map(function (n) {
                    return { id: String(n.o_id) };
                }),
                links: edges.map(function (e) {
                    var cross = (e.kind === 'cross');
                    var norm = Math.max(0, Math.min(1,
                        (e.weight || 0) / (cross ? maxCross : maxEgo)));
                    return {
                        source: String(e.source),
                        target: String(e.target),
                        weight: e.weight || 0,
                        // The ego statements stay the primary layer: thicker,
                        // opaque and solid. Cross edges are the texture that
                        // shows which neighbours belong together — drawn thin,
                        // faint and dashed so they read behind, not instead.
                        width: cross ? 1 + Math.sqrt(norm) * 2 : 1 + Math.sqrt(norm) * 4,
                        alpha: cross ? 0.36 : 0.6,
                        weak: cross,
                        name: cross
                            ? t('shared_items_count', { count: fmt(e.cooc || 0) })
                            : t('mentions_count', { count: fmt(e.cooc || 0) }),
                        data: e
                    };
                })
            };
        }

        /* ---- Presentation hooks --------------------------------------- */

        function typeLabel(node) {
            var cat = categories[node.category];
            return cat ? cat.name : '';
        }

        function tooltip(node, link) {
            var rows = [];
            if (node) {
                rows.push(P.el('strong', null, node.name));
                if (!node.isCenter) rows.push(P.el('div', null, typeLabel(node)));
                var d = node.data || {};
                if (d.cooc != null) {
                    rows.push(P.el('div', null, t('mentions_count', { count: fmt(d.cooc) })));
                }
                if (d.score != null) {
                    rows.push(P.el('div', null, t('Distinctiveness score') + ': '
                        + fmt(Math.round(d.score * 10) / 10)));
                }
                rows.push(P.el('div', 'iwac-vis-graph-tooltip__hint',
                    node.isCenter ? t('Drag to move it') : t('Click to see its connections')));
            } else if (link) {
                rows.push(P.el('strong', null, link.source.name + ' ↔ ' + link.target.name));
                if (link.name) rows.push(P.el('div', null, link.name));
            }
            return rows;
        }

        function cardRows(node) {
            var d = node.data || {};
            var rows = [];
            if (d.cooc != null) {
                rows.push({ label: t('Mentions'), value: fmt(d.cooc) });
            }
            if (d.score != null) {
                rows.push({
                    label: t('Distinctiveness score'),
                    value: fmt(Math.round(d.score * 10) / 10)
                });
            }
            return rows;
        }

        function announce(node) {
            var d = node.data || {};
            var parts = [node.name];
            if (!node.isCenter) parts.push(typeLabel(node));
            if (d.cooc != null) parts.push(t('mentions_count', { count: fmt(d.cooc) }));
            parts.push(P.connectionsLabel(node.deg || 0));
            return parts.join('. ');
        }

        var mounted = P.mountForceGraph(panelEl, {
            nodes: nodes,
            categories: categories,
            // The centre's id makes the layout reproducible per item without
            // making every item's graph the same shape.
            seed: parseInt(nodes[0].id, 10) || 1,
            colorOf: slotColor,
            tooltip: tooltip,
            cardRows: cardRows,
            categoryName: typeLabel,
            itemUrl: function (node) { return node.url; },
            announce: announce,
            downloadName: opts.downloadName,
            ariaLabel: opts.ariaLabel
        });
        if (!mounted) return null;

        mounted.graph.onTheme(function () {
            palette = (ns.getPalette && ns.getPalette()) || palette;
        });

        return {
            graph: mounted.graph,
            show: function (key, warm) {
                var graph = variants[key];
                if (!graph || !graph.nodes || graph.nodes.length < 2) return false;
                mounted.setGraph(toRendererGraph(graph), !!warm);
                return true;
            },
            /**
             * Empty the canvas. A facet can have mentions and still produce a
             * sub-two-node network (every neighbour below `min_cooccurrence`,
             * or filtered out as collection-wide noise), and leaving the
             * previous facet's graph on screen would silently mislabel it.
             */
            clear: function () {
                mounted.setGraph({ nodes: [], links: [] }, true);
            }
        };
    };

    ns.entityGraph = { TYPE_SLOTS: TYPE_SLOTS, sizeOf: sizeOf };
})();
