/**
 * IWAC Visualizations — Chord (circular graph) renderer
 *
 * Thin wrapper around the existing `IWACVis.chartOptions.chord` builder
 * exposed as a layout-system renderer. Useful for showing pairwise
 * co-occurrence (subjects, persons, places) in a circular layout that
 * reads better than a force-directed network past ~30 nodes.
 *
 * The underlying option uses `type: 'graph', layout: 'circular'` because
 * ECharts dropped the dedicated `chord` chart type — circular graph with
 * adjacency-driven curveness is the modern equivalent.
 *
 * Data shape (passes straight through to `C.chord`):
 *
 *     {
 *       names:  ['Subject A', 'Subject B', ...],
 *       matrix: [[0, 5, 2], [5, 0, 3], [2, 3, 0]]
 *     }
 *
 * Slot options (`slot.options`):
 *   - `minWeight` (number)  drop edges with weight < this. Default 1.
 *   - `maxNodes`  (number)  truncate the matrix to top-N rows by row-sum.
 *                           Default 30 (chords past that are visual mush).
 *
 * Registered as `chord`. Predicate: empty when fewer than 2 names or
 * matrix has no off-diagonal weight.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.chord: dashboard-layout.js + panels.js must load first');
        return;
    }

    /**
     * Truncate to top-N nodes by row-sum, keeping the matrix square.
     * Past ~30 entries the chord becomes a labelled blur, so we cap
     * at the most "central" participants.
     */
    function topN(data, n) {
        var names = data.names || [];
        var matrix = data.matrix || [];
        if (names.length <= n) return data;

        var sums = names.map(function (_, i) {
            var row = matrix[i] || [];
            var s = 0;
            for (var j = 0; j < row.length; j++) s += row[j] || 0;
            return { i: i, s: s };
        });
        sums.sort(function (a, b) { return b.s - a.s; });
        var keep = sums.slice(0, n).map(function (r) { return r.i; }).sort(
            function (a, b) { return a - b; });

        var nm = keep.map(function (i) { return names[i]; });
        var mx = keep.map(function (i) {
            var row = matrix[i] || [];
            return keep.map(function (j) { return row[j] || 0; });
        });
        return { names: nm, matrix: mx };
    }

    function hasMatrixData(v) {
        if (!v || !Array.isArray(v.names) || v.names.length < 2) return false;
        if (!Array.isArray(v.matrix)) return false;
        for (var i = 0; i < v.matrix.length; i++) {
            var row = v.matrix[i] || [];
            for (var j = 0; j < row.length; j++) {
                if (i !== j && row[j] > 0) return true;
            }
        }
        return false;
    }

    DL.registerRenderer('chord', function (el, data, slot) {
        if (!ns.chartOptions || typeof ns.chartOptions.chord !== 'function') {
            console.warn('IWACVis.chord renderer: chart-options.js must be loaded');
            el.appendChild(P.buildEmptyState());
            return;
        }
        var opts = (slot && slot.options) || {};
        var sliced = topN(data, opts.maxNodes || 30);
        var option = ns.chartOptions.chord(sliced, {
            minWeight: opts.minWeight != null ? opts.minWeight : 1
        });
        ns.registerChart(el, function (_e, instance) {
            instance.setOption(option, true);
        });
    });

    DL.registerMetadata('chord', {
        labelKey: 'Co-occurrence chord',
        descKey:  'desc_chord',
        hasData:  hasMatrixData
    });
})();
