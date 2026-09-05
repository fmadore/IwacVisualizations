/**
 * IWAC Visualizations — Shared ECharts option builders (networks & graphs)
 *
 * Split out of chart-options.js (v0.23.0) so each chart family lives in
 * a file small enough to reason about. Every file extends the same
 * `IWACVis.chartOptions` (`C`) namespace and depends on the shared
 * private helpers (`C._grid`, `C._countryColor`, …) defined in
 * chart-options.js, which the asset partial loads first.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.chartOptions: panels.js must load first');
        return;
    }
    var C = ns.chartOptions = ns.chartOptions || {};

    var t = P.t;
    var fmt = P.formatNumber;
    var esc = P.escapeHtml;
    var R = ns.responsive;

    /* ----------------------------------------------------------------- */
    /*  Shared frozen-force series skeleton                               */
    /* ----------------------------------------------------------------- */

    /**
     * The roam/drag/zoom-clamped, circular-seeded, layoutAnimation:false
     * base the remaining ECharts force graphs build on
     * (C.collaborationNetwork, press-reprints). Two of its choices are
     * load-bearing, not stylistic:
     *
     * - `initLayout: 'circular'` seeds node positions — a frozen
     *   (layoutAnimation:false) force layout with no starting coordinates
     *   crashes ECharts 6 ("can't access property 0, e is null").
     * - `layoutAnimation: false` runs the simulation once, synchronously,
     *   and freezes the positions, so resize / fullscreen / merge-mode
     *   setOption never re-animates the edges.
     *
     * That second choice is also why the item-page ego networks left this
     * family in v1.28.0: a frozen layout cannot respond to a drag, so moving
     * a node moved it through a static picture. Those graphs now simulate
     * live on canvas (shared/graph-force.js). The two that remain here are
     * collection-scale and read as pictures rather than instruments.
     *
     * Callers `Object.assign` their data / links / categories / emphasis
     * / cursor on top; only the knobs that actually differ between the
     * in-tree graphs are parameterized.
     *
     * @param {Object} [opts]
     * @param {number} [opts.bottom=16]     56 when a bottom legend shows
     * @param {number} [opts.repulsion=220]
     * @param {number} [opts.gravity=0.08]
     */
    C._forceGraphBase = function (opts) {
        opts = opts || {};
        return {
            type: 'graph',
            layout: 'force',
            top: 16,
            bottom: opts.bottom != null ? opts.bottom : 16,
            left: 16,
            right: 16,
            roam: true,
            draggable: true,
            // Per ECharts docs: clamp zoom so roam button overlays can't
            // scale the graph into oblivion.
            scaleLimit: { min: 0.25, max: 5 },
            labelLayout: { hideOverlap: true },
            force: {
                initLayout: 'circular',
                repulsion: opts.repulsion != null ? opts.repulsion : 220,
                edgeLength: [60, 140],
                gravity: opts.gravity != null ? opts.gravity : 0.08,
                friction: 0.6,
                layoutAnimation: false
            }
        };
    };

    /* ------------------------------------------------------------------ */
    /*  Chord — circular pairwise relations                                */
    /* ------------------------------------------------------------------ */

    /**
     * Render a symmetric pairwise matrix as a native ECharts chord
     * diagram (`series-chord`, reintroduced in ECharts 6.0). Each
     * entity is a perimeter sector sized by its total co-occurrences;
     * each pair's ribbon width encodes the pairwise weight directly —
     * something the pre-v1.4 emulation (`series-graph` with
     * `layout: 'circular'`, written when ECharts 5 had no chord type)
     * could only approximate with edge thickness.
     *
     * Accepts the same `{names, matrix}` shape as the old builder, so
     * callers (person-dashboard co-occurrence, the shared `chord`
     * renderer) need no changes.
     *
     * @param {{names: string[], matrix: number[][]}} data
     * @param {Object} [opts]
     * @param {number} [opts.minWeight=1] Ribbons below this are dropped
     */
    C.chord = function (data, opts) {
        opts = opts || {};
        var minWeight = opts.minWeight || 1;
        var names = (data && data.names) || [];
        var matrix = (data && data.matrix) || [];
        var palette = (ns.getPalette && ns.getPalette())
            || ['#ce4115', '#394f68', '#4a8c6f', '#bb4c49', '#7c5295', '#d4a574'];

        // Row totals feed the node tooltip ("Total: N") — sector arcs
        // themselves are sized by ECharts from the surviving links.
        var rowSums = names.map(function (_, i) {
            return (matrix[i] || []).reduce(function (a, b) { return a + b; }, 0);
        });

        var nodes = names.map(function (name, i) {
            return {
                name: name,
                value: rowSums[i],
                itemStyle: { color: palette[i % palette.length] }
            };
        });

        // Undirected links (i < j only) so each pair renders one ribbon.
        var links = [];
        for (var i = 0; i < names.length; i++) {
            for (var j = i + 1; j < names.length; j++) {
                var w = (matrix[i] && matrix[i][j]) || 0;
                if (w >= minWeight) {
                    links.push({ source: names[i], target: names[j], value: w });
                }
            }
        }

        return {
            tooltip: {
                trigger: 'item',
                // See the network tooltip above for why both options
                // matter when the panel enters native fullscreen.
                confine: true,
                appendTo: function (chartEl) { return chartEl; },
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        return '<strong>' + esc(p.name || '') + '</strong><br>' +
                               (t('Total') + ': ' + fmt((p.data && p.data.value) || 0));
                    }
                    if (p.dataType === 'edge') {
                        return '<strong>' + esc(p.data.source || '') + '</strong><br>' +
                               '<strong>' + esc(p.data.target || '') + '</strong><br>' +
                               t('mentions_count', { count: fmt(p.data.value || 0) });
                    }
                    return '';
                }
            },
            series: [{
                type: 'chord',
                startAngle: 90,
                padAngle: 2,
                label: {
                    show: true,
                    position: 'outside',
                    fontSize: 11,
                    // Long French subject labels get a middle-ellipsis on
                    // the perimeter; tooltips carry the full name.
                    formatter: function (p) { return C._truncate(p.name, 28); }
                },
                itemStyle: { borderRadius: 3 },
                lineStyle: { color: 'gradient', opacity: 0.28 },
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { opacity: 0.6 }
                },
                data: nodes,
                links: links
            }],
            animationDuration: 600
        };
    };

    /* ------------------------------------------------------------------ */
    /*  Author collaboration network (force-directed, edge-typed)         */
    /* ------------------------------------------------------------------ */

    /**
     * Force-directed graph of authors that collaborated on the same
     * references. Not ego-centric — the item-page ego networks moved to
     * the canvas renderer in v1.28.0. Every node here is an author, and
     * edges carry a `type` field with three valid values:
     *
     *   - `coauthor`        — two authors signed the same reference
     *   - `author_editor`   — one author signed a reference whose
     *                          editor is the other person
     *   - `both`            — the same pair appears both as co-authors
     *                          on one reference and as author/editor
     *                          on another
     *
     * Each type renders with a distinct edge color (and the legend
     * lets the user toggle them) so the user can see at a glance
     * whether a tight cluster is a co-author clique, an editor with
     * many contributors, or a mixed group. Node radius reflects the
     * number of references the person appears on.
     *
     * @param {{ nodes: Array<{id, name, value, kind}>, edges: Array<{source, target, weight, type}> }} graph
     * @param {Object} [opts]
     * @param {number} [opts.maxLabelLength=24]   Middle-ellipsis cutoff
     * @param {boolean} [opts.showLegend=true]
     */
    C.collaborationNetwork = function (graph, opts) {
        opts = opts || {};
        var maxLen = opts.maxLabelLength || 24;
        var nodes = (graph && graph.nodes) || [];
        var edges = (graph && graph.edges) || [];

        var palette = (ns.getPalette && ns.getPalette())
            || ['#ce4115', '#394f68', '#4a8c6f', '#bb4c49', '#7c5295', '#d4a574'];

        // Edge color per collaboration type. Categories are also exposed
        // via a `categories` array on the graph series so ECharts can
        // build a working legend for edge filtering.
        var EDGE_COLORS = {
            'coauthor':      palette[1],   // blue
            'author_editor': palette[2],   // green
            'both':          palette[0]    // primary orange
        };

        // Node sizing — sqrt scale against the max reference count so
        // the most prolific authors stand out without dwarfing the rest.
        var maxValue = 1;
        nodes.forEach(function (n) { if (n.value > maxValue) maxValue = n.value; });
        var maxWeight = 1;
        edges.forEach(function (e) { if (e.weight > maxWeight) maxWeight = e.weight; });

        var graphNodes = nodes.map(function (n) {
            var norm = Math.max(0, Math.min(1, (n.value || 0) / maxValue));
            return {
                id: String(n.id),
                name: C._truncate(n.name || '', maxLen),
                fullTitle: n.name || '',
                value: n.value || 0,
                symbolSize: 8 + Math.sqrt(norm) * 28,
                itemStyle: { color: palette[0] },
                label: {
                    // Only label the top hubs at rest; everything else
                    // shows on hover via emphasis. Without this guard a
                    // 180-node graph turns into a wall of text.
                    show: norm > 0.45,
                    position: 'right',
                    formatter: '{b}',
                    fontSize: 10
                }
            };
        });

        var graphEdges = edges.map(function (e) {
            var norm = Math.max(0, Math.min(1, (e.weight || 0) / maxWeight));
            return {
                source: String(e.source),
                target: String(e.target),
                value: e.weight,
                edgeType: e.type,
                lineStyle: {
                    width: 1 + Math.sqrt(norm) * 5,
                    opacity: 0.6,
                    color: EDGE_COLORS[e.type] || palette[0],
                    curveness: 0.15
                }
            };
        });

        // Static legend swatches — three colored chips so the user can
        // read the edge types without ECharts' graph-series legend (which
        // doesn't natively expose per-edge categories).
        var legend = opts.showLegend !== false ? [{
            show:   true,
            bottom: 8,
            left:   'center',
            orient: 'horizontal',
            itemWidth:  14,
            itemHeight: 10,
            itemGap:    16,
            data: [
                { name: t('Co-author'),       icon: 'roundRect', itemStyle: { color: EDGE_COLORS['coauthor'] } },
                { name: t('Author / editor'), icon: 'roundRect', itemStyle: { color: EDGE_COLORS['author_editor'] } },
                { name: t('Mixed'),           icon: 'roundRect', itemStyle: { color: EDGE_COLORS['both'] } }
            ],
            // The legend entries don't toggle anything here — they're
            // pure swatches. Selected mode is set so the click handler
            // doesn't try to hide non-existent series.
            selectedMode: false
        }] : [];

        return {
            tooltip: {
                trigger: 'item',
                confine: true,
                appendTo: function (chartEl) { return chartEl; },
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        var d = p.data || {};
                        return '<strong>' + esc(d.fullTitle || '') + '</strong><br>'
                             + t('references_count', { count: fmt(d.value || 0) });
                    }
                    if (p.dataType === 'edge') {
                        var typeLabel;
                        if (p.data.edgeType === 'coauthor') typeLabel = t('Co-author');
                        else if (p.data.edgeType === 'author_editor') typeLabel = t('Author / editor');
                        else typeLabel = t('Mixed');
                        return '<strong>' + esc(p.data.source) + '</strong>'
                             + ' \u2194 '
                             + '<strong>' + esc(p.data.target) + '</strong><br>'
                             + typeLabel + '<br>'
                             + t('Shared references') + ': ' + fmt(p.data.value || 0);
                    }
                    return '';
                }
            },
            legend: legend,
            series: [Object.assign(
                C._forceGraphBase({
                    bottom: opts.showLegend !== false ? 56 : 16,
                    repulsion: 200
                }),
                {
                    nodeScaleRatio: 0.6,
                    emphasis: {
                        focus: 'adjacency',
                        lineStyle: { width: 4, opacity: 0.9 },
                        label: { show: true },
                        scale: true
                    },
                    data: graphNodes,
                    links: graphEdges,
                    cursor: 'pointer'
                }
            )],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
    };

    /* ------------------------------------------------------------------ */
    /*  Sankey — flow diagram                                              */
    /* ------------------------------------------------------------------ */

    /**
     * Standard ECharts sankey wrapper.
     * @param {{nodes: {name:string}[], links: {source:string,target:string,value:number}[]}} data
     */
    C.sankey = function (data, opts) {
        opts = opts || {};
        var nodes = (data && data.nodes) || [];
        var links = (data && data.links) || [];
        return {
            tooltip: {
                trigger: 'item',
                triggerOn: 'mousemove',
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        return esc(p.data.name) + ': ' + fmt(p.value || 0);
                    }
                    return esc(p.data.source) + ' \u2192 ' + esc(p.data.target) +
                        '<br>' + fmt(p.data.value || 0);
                }
            },
            series: [{
                type: 'sankey',
                top: 16,
                bottom: 16,
                left: 16,
                right: 80,
                data: nodes,
                links: links,
                emphasis: { focus: 'adjacency' },
                lineStyle: { color: 'gradient', curveness: 0.5 },
                label: { fontSize: 11 },
                nodeAlign: opts.nodeAlign || 'justify'
            }]
        };
    };
})();
