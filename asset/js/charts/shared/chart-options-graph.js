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
    /*  Entity neighbor network (force-directed graph)                    */
    /* ----------------------------------------------------------------- */

    /**
     * Force-layout graph for a center entity + its top-N neighbors.
     *
     * Expected shape (produced by the Python generator):
     *   graph = {
     *     nodes: [
     *       { o_id, title, type, cooc, score }   // nodes[0] is the center
     *       ...
     *     ],
     *     edges: [
     *       { source, target, weight, cooc }
     *       ...
     *     ]
     *   }
     *
     * @param {Object} graph
     * @param {Object} [opts]
     * @param {number} [opts.maxLabelLength=24]   Middle-ellipsis cutoff
     * @param {Object} [opts.typeColors]          { typeName: hex }
     */
    C.network = function (graph, opts) {
        opts = opts || {};
        var maxLen = opts.maxLabelLength || 24;
        var nodes = (graph && graph.nodes) || [];
        var edges = (graph && graph.edges) || [];

        var palette = (ns.getPalette && ns.getPalette())
            || ['#d97706', '#2563eb', '#059669', '#9333ea', '#dc2626', '#0891b2'];
        var TYPE_COLORS = {
            'center':        palette[0],
            'Personnes':     palette[1],
            'Organisations': palette[2],
            'Lieux':         palette[3],
            'Sujets':        palette[4],
            '\u00c9v\u00e9nements': palette[5]
        };
        if (opts.typeColors) {
            for (var k in opts.typeColors) {
                if (Object.prototype.hasOwnProperty.call(opts.typeColors, k)) {
                    TYPE_COLORS[k] = opts.typeColors[k];
                }
            }
        }

        var scores = nodes.map(function (n) { return n.score || 0; });
        var maxScore = Math.max.apply(null, scores.concat([1]));
        var weights = edges.map(function (e) { return e.weight || 0; });
        var maxWeight = Math.max.apply(null, weights.concat([1]));

        // Build the categories array that ECharts needs for legend
        // toggling. Category 0 is always the centre so it can keep its
        // distinctive palette[0] color; non-centre types get their own
        // category in order of first appearance. Legend data is then
        // built FROM categories[].name, so legend names automatically
        // match series categories — clicking a legend entry toggles
        // all nodes with that category without the panel having to
        // replace the whole option.
        var categoryIndex = { 'center': 0 };
        var categories = [{
            name: t('entity_type_center') || 'Center',
            itemStyle: { color: TYPE_COLORS.center }
        }];
        nodes.forEach(function (n) {
            if (!n.type || n.type === 'center') return;
            if (categoryIndex[n.type] != null) return;
            categoryIndex[n.type] = categories.length;
            categories.push({
                name: t('entity_type_' + n.type),
                itemStyle: { color: TYPE_COLORS[n.type] || palette[categories.length % palette.length] }
            });
        });

        var graphNodes = nodes.map(function (n, idx) {
            var isCenter = n.type === 'center';
            var normScore = isCenter ? 1 : Math.max(0, Math.min(1, (n.score || 0) / maxScore));
            // Make the centre visually unmistakable since we no longer
            // fix its position — size + type color do all the lifting.
            var symbolSize = isCenter ? 56 : 14 + Math.sqrt(normScore) * 28;
            return {
                id: String(n.o_id),
                name: C._truncate(n.title || '', maxLen),
                fullTitle: n.title || '',
                entityType: n.type,
                o_id: n.o_id,
                cooc: n.cooc,
                score: n.score,
                symbolSize: symbolSize,
                category: categoryIndex[n.type] != null ? categoryIndex[n.type] : 0,
                // Intentionally NO `fixed` and NO x/y seed: pinning the
                // centre at (0,0) made the auto-fit asymmetric — nodes
                // clustered around the pin and ECharts couldn't centre
                // the resulting bbox in the viewport. Force layout with
                // an `initLayout: 'circular'` seed (set below) produces
                // a symmetric starting point so the final layout lands
                // in the middle of the panel.
                label: { show: true, position: 'right', formatter: '{b}' }
            };
        });

        var graphEdges = edges.map(function (e) {
            var normWeight = Math.max(0, Math.min(1, (e.weight || 0) / maxWeight));
            return {
                source: String(e.source),
                target: String(e.target),
                value: e.weight,
                cooc: e.cooc,
                lineStyle: {
                    width: 1 + Math.sqrt(normWeight) * 4,
                    opacity: 0.55
                }
            };
        });

        // Legend data = category names excluding the centre, so the
        // centre is always visible but the user can toggle off any
        // type they don't care about. Clicking a legend entry now
        // works because the names are guaranteed to match a category.
        var legendData = categories.slice(1).map(function (c) { return c.name; });

        var base = {
            tooltip: {
                trigger: 'item',
                // Keep the tooltip clamped inside the chart bounds and
                // append it to the chart's host element. Both matter
                // for native fullscreen: the panel becomes the only
                // visible element, so a tooltip that ECharts had
                // appended elsewhere (or positioned outside the chart
                // host's box) renders off-screen. `confine: true` +
                // explicit `appendTo` survive `requestFullscreen()`.
                confine: true,
                appendTo: function (chartEl) { return chartEl; },
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        var nodeData = p.data || {};
                        var lines = ['<strong>' + esc(nodeData.fullTitle || '') + '</strong>'];
                        if (nodeData.entityType && nodeData.entityType !== 'center') {
                            lines.push(t('entity_type_' + nodeData.entityType));
                        }
                        if (nodeData.cooc != null) {
                            lines.push(t('mentions_count', { count: fmt(nodeData.cooc) }));
                        }
                        if (nodeData.score != null) {
                            lines.push(t('Distinctiveness score') + ': ' + fmt(Math.round(nodeData.score * 10) / 10));
                        }
                        return lines.join('<br>');
                    }
                    if (p.dataType === 'edge') {
                        var edgeData = p.data || {};
                        return t('mentions_count', { count: fmt(edgeData.cooc || 0) });
                    }
                    return '';
                }
            },
            legend: legendData.length ? (function () {
                // Theme-aware legend chrome — read tokens at build time so
                // the panel matches IWAC light/dark and the user's CSS
                // overrides without any hardcoded rgba.
                var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
                return [{
                    // Legend data now matches series categories by name,
                    // so ECharts can toggle categories on/off when the
                    // user clicks a legend entry. The old implementation
                    // passed object literals with no series match and
                    // the legend rendered as an empty box.
                    data: legendData,
                    show: opts.showLegend !== false,
                    bottom: 8,
                    left: 'center',
                    orient: 'horizontal',
                    itemWidth: 14,
                    itemHeight: 10,
                    itemGap: 16,
                    padding: [6, 12],
                    backgroundColor: tokens.surface || 'transparent',
                    borderColor: tokens.borderLight || tokens.border || 'transparent',
                    borderWidth: 1,
                    borderRadius: 6,
                    textStyle: { fontSize: 12, color: tokens.inkLight || tokens.ink }
                }];
            })() : [],
            series: [{
                type: 'graph',
                layout: 'force',
                // Reserve room for the bottom legend only when it is
                // actually visible; otherwise the force layout gets the
                // whole panel below the top padding.
                top: 16,
                bottom: opts.showLegend !== false ? 56 : 16,
                left: 16,
                right: 16,
                roam: true,
                draggable: true,
                // Per ECharts docs: clamp zoom so roam button overlays
                // can't scale the graph into oblivion, and shrink node
                // symbols gently as the user zooms in so labels stay
                // readable.
                scaleLimit: { min: 0.25, max: 5 },
                nodeScaleRatio: 0.6,
                focusNodeAdjacency: true,
                labelLayout: { hideOverlap: true },
                // Categories drive the legend. Each entry's name must
                // match the legend.data entries (which we built from
                // the same array), so clicks on the legend toggle the
                // corresponding category without the panel JS having
                // to rebuild the whole option.
                categories: categories,
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 4 },
                    scale: true,
                    scaleSize: 3
                },
                force: {
                    // Circular seed gives force a symmetric starting
                    // point; without it, the jittered random initial
                    // positions + a pinned centre produced asymmetric
                    // layouts that auto-fit couldn't recover from.
                    initLayout: 'circular',
                    repulsion: 220,
                    edgeLength: [60, 140],
                    gravity: 0.08,
                    friction: 0.6,
                    // Disabled so the force simulation runs once,
                    // synchronously, and the final positions are
                    // frozen. Without this the graph re-animates on
                    // every resize / fullscreen / merge-mode setOption
                    // — unsettling edge jumps the user complained
                    // about. ECharts docs explicitly recommend
                    // disabling layoutAnimation for larger graphs.
                    layoutAnimation: false
                },
                data: graphNodes,
                links: graphEdges,
                cursor: 'pointer'
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        // Optional thumbnail minimap (ECharts 6.0 component) — orientation
        // aid for the bigger ego networks: the window rectangle shows
        // which part of the zoomed/panned graph is in view. Off by
        // default; the person / article network panels opt in.
        if (opts.thumbnail) {
            var thumbTokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            base.thumbnail = {
                show: true,
                right: 8,
                top: 8,
                width: '24%',
                height: '24%',
                seriesIndex: 0,
                itemStyle: {
                    color: thumbTokens.surface || 'transparent',
                    borderColor: thumbTokens.border || '#999',
                    borderWidth: 1
                },
                windowStyle: {
                    color: 'transparent',
                    borderColor: thumbTokens.primary || thumbTokens.ink || '#999',
                    borderWidth: 1
                }
            };
        }

        var networkMedia = [
            {
                query: { maxWidth: R ? R.BP.sm : 640 },
                option: {
                    // The minimap costs too much canvas on phones.
                    thumbnail: { show: false },
                    series: [{
                        force: {
                            repulsion: 120,
                            edgeLength: [30, 80]
                        }
                    }]
                }
            }
        ];

        return R && R.withMedia
            ? R.withMedia(base, networkMedia)
            : base;
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
            || ['#d97706', '#2563eb', '#059669', '#9333ea', '#dc2626', '#0891b2'];

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
     * references. Distinct from `C.network` (which is the ego-centric
     * entity dashboard graph): every node here is an author, and edges
     * carry a `type` field with three valid values:
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
            || ['#e64a19', '#2563eb', '#059669', '#9333ea', '#dc2626', '#0891b2'];

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
            series: [{
                type: 'graph',
                layout: 'force',
                top: 16,
                bottom: opts.showLegend !== false ? 56 : 16,
                left: 16,
                right: 16,
                roam: true,
                draggable: true,
                scaleLimit: { min: 0.25, max: 5 },
                nodeScaleRatio: 0.6,
                focusNodeAdjacency: true,
                labelLayout: { hideOverlap: true },
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 4, opacity: 0.9 },
                    label: { show: true },
                    scale: true
                },
                force: {
                    initLayout: 'circular',
                    repulsion: 200,
                    edgeLength: [60, 140],
                    gravity: 0.08,
                    friction: 0.6,
                    // Disabled so the simulation runs once and freezes —
                    // the same trick C.network uses to avoid edge jumps
                    // on every resize / fullscreen toggle.
                    layoutAnimation: false
                },
                data: graphNodes,
                links: graphEdges,
                cursor: 'pointer'
            }],
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
