/**
 * IWAC Visualizations — References Overview: the author collaboration network.
 *
 * `C.collaborationNetwork` used to sit in the shared charts bundle
 * (chart-options-graph.js), which every chart page loads, while only this
 * block draws it. It lives beside the block now, still attaches to
 * `IWACVis.chartOptions`, and builds on the shared `C._forceGraphBase`.
 * Loaded before the orchestrator in the block's bundle (bundles.json).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.references-overview/collaboration-network: panels.js and the shared chart options must load first');
        return;
    }

    var t = P.t;
    var fmt = P.formatNumber;
    var esc = P.escapeHtml;

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

        // getPalette() carries the theme's own fallback scale.
        var palette = (ns.getPalette && ns.getPalette()) || [];

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
            tooltip: C._inPanelTooltip({
                trigger: 'item',
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        var d = p.data || {};
                        return '<strong>' + esc(d.fullTitle || '') + '</strong><br>'
                             + t('references_count', { count: d.value || 0 });
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
            }),
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
            )]
        };
    };
})();
