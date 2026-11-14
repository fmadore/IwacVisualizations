/**
 * IWAC Visualizations — References Overview: author collaboration network.
 *
 * Authors credited together on the same references, drawn by the shared
 * d3-force canvas renderer (`P.mountForceGraph`, shared/graph-panel.js) —
 * the renderer the item-page networks and the Albani Zaria block already
 * use, ported from AMIRA's DREVisualizations.
 *
 * This panel used to be an ECharts `graph`/`force` series. That series ran
 * its layout to a frozen state with no collision pass, so nodes overlapped,
 * only the largest hubs could carry a label, and dragging one moved it
 * through a static picture. Its colour went on the edges (co-author /
 * author–editor / both), so the groups a reader looks for in a
 * collaboration network were never shown at all.
 *
 * Now colour marks COMMUNITIES — authors who publish together more than
 * with the rest — found by Louvain modularity in the browser
 * (`P.collaborationCommunities`, below). Connected components would not do:
 * the bibliography's network is one component of ~160 authors plus a few
 * small cliques, so a component colouring paints almost everything one
 * colour. The communities are deterministic (nodes visited in id order,
 * ties kept), so the same data always draws the same groups.
 *
 * The edge relationship survives as the line style: solid for co-authors
 * (or a pair that is both), dashed for an author and the editor of the
 * volume their work appeared in — the renderer's `weak` link, which also
 * lays those pairs a little further apart. The panel description says so.
 *
 * Payload (generate_references_overview.py `compute_author_collaborations`):
 *   { nodes: [{ id, name, value, kind }],
 *     edges: [{ source, target, weight, type: 'coauthor'|'author_editor'|'both' }] }
 *
 * Depends on: panels.js, graph-panel.js (the `d3` need) — the block's
 * registry row declares it.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.references-overview/collaboration-network: panels.js must load first');
        return;
    }

    var t = P.t;
    var fmt = P.formatNumber;

    /**
     * The series slots the coloured groups take, in order (0-based, so slot
     * 0 is --series-1): orange, violet, tan, sky, green. Not the first N:
     * --series-2 and --series-7 are both slate blues, --series-6 and
     * --series-8 both tans, and on the dark panel --series-2 sits next to the
     * muted grey of "Smaller groups". These five keep ≥ 28° of OKLCH hue
     * between any two and ≥ 0.09 OKLab distance from each other and from the
     * grey, in both themes; no sixth slot keeps both, so the rest of the
     * network is pooled as "Smaller groups" rather than given a near-twin.
     */
    var GROUP_SLOTS = [0, 4, 5, 10, 13];
    /** Groups that get a colour and a legend chip of their own. */
    var MAX_COLOURED_GROUPS = GROUP_SLOTS.length;
    /** A group smaller than this is pooled with the other small ones. */
    var MIN_GROUP_SIZE = 3;
    /** The most prolific authors, whose names stay on the graph at any zoom. */
    var NAMED_AUTHORS = 8;

    /* ------------------------------------------------------------------ */
    /*  Louvain communities                                                */
    /* ------------------------------------------------------------------ */

    /**
     * Louvain modularity communities of an undirected weighted graph.
     *
     * The classic two-phase loop: move each node to the neighbouring
     * community with the best modularity gain until nothing moves, then
     * collapse each community into one node and repeat on that graph.
     * Deterministic — nodes are visited in the order given, neighbouring
     * communities in ascending index order, and a move needs a strictly
     * better gain — so a reload never reshuffles the colours.
     *
     * @param {Array<string>} ids     node ids, in a stable order
     * @param {Array<{source, target, weight}>} edges
     * @returns {Object<string, number>} id → community index (0 = largest)
     */
    P.collaborationCommunities = function (ids, edges) {
        var index = {};
        ids.forEach(function (id, i) { index[id] = i; });

        // adj[i][j] = weight; symmetric, so the diagonal of a collapsed graph
        // holds twice its internal weight and a row sum is always the degree.
        var adj = ids.map(function () { return {}; });
        var m2 = 0;
        (edges || []).forEach(function (e) {
            var a = index[e.source];
            var b = index[e.target];
            if (a == null || b == null || a === b) return;
            var w = Number(e.weight) || 1;
            adj[a][b] = (adj[a][b] || 0) + w;
            adj[b][a] = (adj[b][a] || 0) + w;
            m2 += 2 * w;
        });

        var membership = ids.map(function (_, i) { return i; });
        if (!m2) return finish(membership);

        for (var level = 0; level < 12; level++) {
            var size = adj.length;
            var k = adj.map(function (row) {
                var s = 0;
                for (var j in row) s += row[j];
                return s;
            });
            var comm = [];
            var tot = [];
            for (var i = 0; i < size; i++) { comm[i] = i; tot[i] = k[i]; }

            var movedAtAll = false;
            for (var pass = 0; pass < 50; pass++) {
                var moved = false;
                for (i = 0; i < size; i++) {
                    var own = comm[i];
                    var wTo = {};
                    for (var key in adj[i]) {
                        var j2 = Number(key);
                        if (j2 === i) continue;
                        wTo[comm[j2]] = (wTo[comm[j2]] || 0) + adj[i][key];
                    }
                    tot[own] -= k[i];
                    var best = own;
                    var bestGain = (wTo[own] || 0) - tot[own] * k[i] / m2;
                    Object.keys(wTo).map(Number).sort(function (x, y) { return x - y; })
                        .forEach(function (c) {
                            var gain = wTo[c] - tot[c] * k[i] / m2;
                            if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
                        });
                    comm[i] = best;
                    tot[best] += k[i];
                    if (best !== own) moved = true;
                }
                if (!moved) break;
                movedAtAll = true;
            }
            if (!movedAtAll) break;

            // Renumber the surviving communities 0..C-1 by first appearance.
            var renum = {};
            var count = 0;
            for (i = 0; i < size; i++) {
                if (renum[comm[i]] == null) renum[comm[i]] = count++;
            }
            membership = membership.map(function (c) { return renum[comm[c]]; });

            // Collapse: one node per community, internal weight on the diagonal.
            var next = [];
            for (i = 0; i < count; i++) next.push({});
            for (i = 0; i < size; i++) {
                var ci = renum[comm[i]];
                for (var key2 in adj[i]) {
                    var cj = renum[comm[Number(key2)]];
                    next[ci][cj] = (next[ci][cj] || 0) + adj[i][key2];
                }
            }
            adj = next;
            if (count === size) break;
        }
        return finish(membership);

        /** Index communities by size, largest first (ties: first member). */
        function finish(member) {
            var sizes = {};
            var first = {};
            member.forEach(function (c, i) {
                sizes[c] = (sizes[c] || 0) + 1;
                if (first[c] == null) first[c] = i;
            });
            var order = Object.keys(sizes).map(Number).sort(function (a, b) {
                return sizes[b] - sizes[a] || first[a] - first[b];
            });
            var rank = {};
            order.forEach(function (c, r) { rank[c] = r; });
            var out = {};
            ids.forEach(function (id, i) { out[id] = rank[member[i]]; });
            return out;
        }
    };

    /* ------------------------------------------------------------------ */
    /*  Graph model                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Nodes, links and legend categories for the renderer.
     *
     * Category 0 is the shared renderer's ego centre, which this graph does
     * not have — the slot stays empty, as in the Albani network. Each of the
     * largest communities is named after its most prolific member, so the
     * legend reads "Around X" instead of "Group 3", and X's label is always
     * drawn (`prominent`); every community below
     * MIN_GROUP_SIZE, or past MAX_COLOURED_GROUPS, shares one muted
     * "Smaller groups" category.
     */
    P.collaborationGraphModel = function (graph) {
        var rawNodes = (graph && graph.nodes) || [];
        var rawEdges = (graph && graph.edges) || [];
        var ids = rawNodes.map(function (n) { return String(n.id); }).sort();
        var community = P.collaborationCommunities(ids, rawEdges.map(function (e) {
            return { source: String(e.source), target: String(e.target), weight: e.weight };
        }));

        var members = {};
        rawNodes.forEach(function (n) {
            var c = community[String(n.id)];
            (members[c] = members[c] || []).push(n);
        });

        var categories = [{ name: '' }];
        var categoryOf = {};
        var anchors = {};
        Object.keys(members).map(Number).sort(function (a, b) { return a - b; }).forEach(function (c) {
            var group = members[c];
            if (categories.length > MAX_COLOURED_GROUPS || group.length < MIN_GROUP_SIZE) return;
            var anchor = group.slice().sort(function (a, b) {
                return (b.value || 0) - (a.value || 0) || String(a.name).localeCompare(String(b.name));
            })[0];
            categoryOf[c] = categories.length;
            anchors[anchor.id] = true;
            categories.push({
                name: t('references_group_around', { name: anchor.name || anchor.id }),
                size: group.length
            });
        });
        var otherIndex = categories.length;
        categories.push({ name: t('references_group_smaller') });

        var max = 1;
        rawNodes.forEach(function (n) { if ((n.value || 0) > max) max = n.value; });
        rawNodes.slice().sort(function (a, b) {
            return (b.value || 0) - (a.value || 0) || String(a.id).localeCompare(String(b.id));
        }).slice(0, NAMED_AUTHORS).forEach(function (n) { anchors[n.id] = true; });

        var nodes = rawNodes.map(function (n) {
            var c = community[String(n.id)];
            var cat = categoryOf[c] != null ? categoryOf[c] : otherIndex;
            return {
                id: String(n.id),
                name: n.name || String(n.id),
                category: cat,
                // The member each coloured group is named after, and the most
                // prolific authors, keep their labels at any zoom: the legend's
                // names are on the graph, and so are its biggest circles.
                prominent: !!anchors[n.id],
                size: 7 + 19 * Math.sqrt((n.value || 0) / max),
                data: { value: n.value || 0, groupSize: members[c].length }
            };
        });

        var maxWeight = 1;
        rawEdges.forEach(function (e) { if ((Number(e.weight) || 0) > maxWeight) maxWeight = Number(e.weight); });

        var links = rawEdges.map(function (e) {
            var w = Number(e.weight) || 1;
            return {
                source: String(e.source),
                target: String(e.target),
                weight: w,
                width: 1.2 + 3 * Math.sqrt(w / maxWeight),
                weak: e.type === 'author_editor',
                name: t('references_link_' + (e.type || 'coauthor'), { count: w, formatted: fmt(w) })
            };
        });

        return { nodes: nodes, links: links, categories: categories, otherIndex: otherIndex };
    };

    /* ------------------------------------------------------------------ */
    /*  Panel                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * Mount the network into a panel built by `P.buildPanel`.
     *
     * @param {{panel: HTMLElement, chart: HTMLElement}} panel
     * @param {Object} graph  the payload's `author_collaborations`
     * @returns {boolean} whether a graph was drawn
     */
    P.renderCollaborationNetwork = function (panel, graph) {
        if (!graph || !graph.nodes || graph.nodes.length < 2 || !P.mountForceGraph) return false;
        var model = P.collaborationGraphModel(graph);
        var categories = model.categories;

        function categoryName(node) {
            return (categories[node.category] || {}).name || '';
        }

        var mounted = P.mountForceGraph(panel, {
            nodes: model.nodes,
            categories: categories,
            seed: 53,
            colorOf: function (i) {
                if (i === model.otherIndex) {
                    return ((ns.getChartTokens && ns.getChartTokens()) || {}).muted;
                }
                return ns.getSeriesColor(GROUP_SLOTS[i - 1]);
            },
            categoryName: categoryName,
            tooltip: function (node, link) {
                var rows = [];
                if (node) {
                    rows.push(P.el('strong', null, node.name));
                    rows.push(P.el('div', null, t('references_count', { count: (node.data || {}).value || 0 })));
                    rows.push(P.el('div', null, categoryName(node)));
                } else if (link) {
                    rows.push(P.el('strong', null, link.source.name + ' ↔ ' + link.target.name));
                    if (link.name) rows.push(P.el('div', null, link.name));
                }
                return rows;
            },
            cardRows: function (node) {
                var d = node.data || {};
                return [
                    { label: t('References'), value: fmt(d.value || 0) },
                    { label: t('references_group'), value: t('references_group_size', { count: d.groupSize || 1, formatted: fmt(d.groupSize || 1) }) }
                ];
            },
            announce: function (node) {
                return node.name + '. ' + t('references_count', { count: (node.data || {}).value || 0 })
                    + '. ' + categoryName(node) + '. ' + P.connectionsLabel(node.deg || 0);
            },
            ariaLabel: t('Author collaborations'),
            downloadName: 'iwac-author-collaborations'
        });
        if (!mounted) return false;
        mounted.setGraph({ nodes: model.nodes.map(function (n) { return { id: n.id }; }), links: model.links });
        return true;
    };
})();
