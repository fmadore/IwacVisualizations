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
        // getPalette() carries the theme's own fallback scale.
        var palette = (ns.getPalette && ns.getPalette()) || [];

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
                               t('mentions_count', { count: p.data.value || 0 });
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
            }]
        };
    };
})();
