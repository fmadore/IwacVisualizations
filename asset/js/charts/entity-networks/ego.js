/**
 * IWAC Visualizations — Entity Networks: neighbourhood graph
 *
 * The interactive close-up of one selected entry: the entry, its strongest
 * neighbours as the reader currently filters the network, and the links
 * among those neighbours. Drawn by the shared d3-force canvas renderer
 * (`P.mountEntityGraph`, shared/entity-graph.js) that the item-page
 * networks and the author-collaboration graph use, so it drags, zooms,
 * names its links and opens records the same way they do.
 *
 * The whole network stays on MapLibre: 2,800+ nodes and 50k+ links are
 * far past what a live force simulation can lay out readably in a browser,
 * which is why the generator precomputes those positions. A neighbourhood
 * of 25 is exactly what the force renderer is good at.
 *
 * `build()` is pure (data in, payload out) so the unit tests can pin it.
 *
 * Usage:
 *   var payload = ns.entityNetworks.ego.build(data, selection, { cap: 25, weightMin: 2 });
 *   var view = ns.entityNetworks.ego.mount(host, ctx, payload, opts);
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;

    var DEFAULT_CAP = 25;

    /**
     * The payload `P.mountEntityGraph` reads:
     *   { nodes: [{ o_id, title, type, cooc, score }],   // nodes[0] is the centre
     *     edges: [{ source, target, weight, cooc, kind }] } // kind: 'ego' | 'cross'
     *
     * @param {Object} data       the decoded network ({ types, nodes, edges })
     * @param {Object} selection  graph.js's selection: { index, node, neighbors }
     *   with `neighbors` already filtered and strongest first
     * @param {{cap?: number, weightMin?: number}} [opts]
     */
    function build(data, selection, opts) {
        opts = opts || {};
        var cap = opts.cap || DEFAULT_CAP;
        var weightMin = opts.weightMin || 0;
        var center = selection.node;

        function typeName(node) {
            // The place network carries no types: every node is a place.
            return data.types && node.type != null ? data.types[node.type] : 'Lieux';
        }

        var kept = selection.neighbors.slice(0, cap);
        var member = {};
        kept.forEach(function (nb) { member[nb.index] = true; });

        var nodes = [{ o_id: center.id, title: center.label, type: 'center' }];
        var edges = [];
        kept.forEach(function (nb) {
            nodes.push({
                o_id: nb.node.id,
                title: nb.node.label,
                type: typeName(nb.node),
                cooc: nb.weight,
                score: nb.weight
            });
            edges.push({
                source: center.id, target: nb.node.id,
                weight: nb.weight, cooc: nb.weight, kind: 'ego'
            });
        });

        // Links among the neighbours: which of them belong together.
        (data.edges || []).forEach(function (e) {
            if (e[2] < weightMin || !member[e[0]] || !member[e[1]]) return;
            edges.push({
                source: data.nodes[e[0]].id, target: data.nodes[e[1]].id,
                weight: e[2], cooc: e[2], kind: 'cross'
            });
        });

        return { nodes: nodes, edges: edges };
    }

    /**
     * Mount the neighbourhood graph into `host` (emptied first). Returns
     * null when the force renderer is unavailable or there is nothing to
     * draw — the caller keeps the map then.
     */
    function mount(host, ctx, payload, opts) {
        opts = opts || {};
        if (!P || !P.mountEntityGraph) return null;
        while (host.firstChild) host.removeChild(host.firstChild);
        var mounted = P.mountEntityGraph({ panel: opts.panel || null, chart: host }, ctx, {
            variants: { ego: payload },
            // The block's type chips are the legend; a second row of
            // category toggles under the canvas would be a second filter.
            showLegend: false,
            coocText: function (count) {
                return P.t('shared_items_count', { count: count });
            },
            coocName: P.t('Shared items'),
            showScore: false,
            downloadName: opts.downloadName,
            ariaLabel: opts.ariaLabel
        });
        if (!mounted || !mounted.show('ego')) return null;
        return mounted;
    }

    ns.entityNetworks = ns.entityNetworks || {};
    ns.entityNetworks.ego = { build: build, mount: mount, DEFAULT_CAP: DEFAULT_CAP };
})();
