/**
 * IWAC Visualizations — Laïcité block: Arenas (issue #14, view 8).
 *
 * What is actually being contested under the word. One small multiple per
 * argumentative frame, decade on the x-axis, and — this is the load-bearing
 * choice — the SHARE of that decade's dossier items touching the frame on
 * the y-axis, not a count.
 *
 * Counts would make every panel the same panel: the 2010s hold several times
 * the items of the 1980s, so every frame would rise together and the chart
 * would report corpus growth wearing ten different labels. Shares ask the
 * question the view exists for — of the laïcité argument in this decade,
 * how much of it was about schooling — and that answer is comparable across
 * decades and across countries of very different sizes.
 *
 * All panels share one y-axis maximum, so a frame's height means the same
 * thing in every cell of the grid.
 *
 * Rendered as ONE ECharts instance with N grids rather than N instances:
 * one theme-swap re-init, one resize observer, one legend.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite arenas: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;
    var L = ns.laicite = ns.laicite || {};

    /** Countries offered by the scope selector, plus the pooled view. */
    L.arenaCountries = function (bundle) {
        return ((bundle || {}).countries || []).slice();
    };

    /**
     * @param {Object} cfg {bundle, metadata, state, frameColors}
     * @returns {{root: HTMLElement, mount: function():void}}
     */
    L.buildArenas = function (cfg) {
        var bundle = cfg.bundle;
        var root = P.el('div', 'iwac-vis-laicite-arenas');

        var panel = P.el('div', 'iwac-vis-panel');
        panel.appendChild(P.el('h4', null, P.t('laicite.arenas_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.arenas_desc')));

        if (!bundle || !(bundle.frames || []).length) {
            panel.appendChild(P.buildNoDataState());
            root.appendChild(panel);
            return { root: root, mount: function () {} };
        }

        var chart = P.el('div', 'iwac-vis-chart iwac-vis-laicite-arenas-chart');
        // Height scales with the row count: a fixed height would squeeze ten
        // stacked panels into the space one needs. The option builder lays
        // its grids out against this same number, so it is computed once.
        var cols = columnsFor();
        var rows = Math.ceil((bundle.frames || []).length / cols);
        var height = Math.max(340, 170 * rows + 20);
        chart.style.height = height + 'px';
        panel.appendChild(chart);

        // The bundle carries an English prose copy of every method note for
        // anyone reading the JSON directly; the panel renders the catalog so
        // the French site is not half-translated.
        var method = P.el('div', 'iwac-vis-laicite-method');
        method.appendChild(P.el('p', null, P.t('laicite.arenas_scope')));
        if ((bundle.dropped_countries || []).length) {
            method.appendChild(P.el('p', 'iwac-vis-laicite-method-dropped',
                P.t('laicite.arenas_dropped', {
                    countries: bundle.dropped_countries.join(', ')
                })));
        }
        panel.appendChild(method);
        root.appendChild(panel);

        return {
            root: root,
            mount: function () {
                ns.registerChart(chart, function (el, instance) {
                    instance.setOption(
                        smallMultiples(bundle, cfg, cols, rows, height),
                        { notMerge: true });
                });
            }
        };
    };

    /** Three columns on a normal page, two when the block is narrow. */
    function columnsFor() {
        var w = (window.innerWidth || 1024);
        if (w < 640) return 1;
        if (w < 1024) return 2;
        return 3;
    }

    function seriesFor(bundle, country) {
        if (country && (bundle.by_country || {})[country]) {
            return {
                counts: bundle.by_country[country],
                totals: (bundle.country_totals || {})[country] || []
            };
        }
        return { counts: bundle.global || {}, totals: bundle.global_totals || [] };
    }

    function smallMultiples(bundle, cfg, cols, rows, height) {
        var frames = bundle.frames || [];
        var decades = bundle.decades || [];
        var metadata = cfg.metadata || {};
        var frameColors = cfg.frameColors || {};
        var picked = seriesFor(bundle, cfg.state.arenaCountry);
        if (!decades.length) return P.emptyChartOption();

        // Shares, computed once so the shared axis maximum can be read off
        // the same numbers the series carry.
        var shares = {};
        var peak = 0;
        frames.forEach(function (frame) {
            shares[frame] = decades.map(function (_, i) {
                var total = picked.totals[i] || 0;
                if (!total) return null;
                var pct = ((picked.counts[frame] || [])[i] || 0) / total * 100;
                if (pct > peak) peak = pct;
                return Math.round(pct * 10) / 10;
            });
        });
        var axisMax = Math.min(100, Math.max(10, Math.ceil(peak / 10) * 10));

        // Horizontal in percent, vertical in pixels. ECharts takes a number
        // (px) or a percentage string per property but has no calc(), so the
        // rows are laid out against the container height the caller already
        // computed rather than against a fraction of it.
        var gapX = 4;                        // % between columns
        var cellW = (100 - gapX * (cols + 1)) / cols;
        var rowTotal = (height - 12) / rows;
        var titleH = 22;                     // px for the per-panel caption
        var gridH = Math.max(80, rowTotal - titleH - 16);

        var grids = [];
        var xAxes = [];
        var yAxes = [];
        var series = [];
        var titles = [];

        frames.forEach(function (frame, i) {
            var col = i % cols;
            var row = Math.floor(i / cols);
            var left = gapX * (col + 1) + cellW * col;
            var titleTop = 12 + row * rowTotal;

            grids.push({
                left: left + '%',
                width: cellW + '%',
                top: titleTop + titleH,
                height: gridH,
                containLabel: true
            });
            xAxes.push({
                type: 'category',
                gridIndex: i,
                data: decades,
                axisLabel: { fontSize: 10, interval: 0, rotate: decades.length > 5 ? 40 : 0 },
                axisTick: { show: false }
            });
            yAxes.push({
                type: 'value',
                gridIndex: i,
                max: axisMax,
                splitNumber: 2,
                axisLabel: C._percentAxisLabel({ fontSize: 10 })
            });
            titles.push({
                text: L.frameLabel(metadata, frame),
                left: (left + cellW / 2) + '%',
                top: titleTop,
                textAlign: 'center',
                textStyle: {
                    fontSize: 12, fontWeight: 600,
                    overflow: 'truncate', width: 180
                }
            });
            series.push({
                name: L.frameLabel(metadata, frame),
                type: 'bar',
                xAxisIndex: i,
                yAxisIndex: i,
                barCategoryGap: '30%',
                itemStyle: { color: frameColors[frame] },
                data: shares[frame]
            });
        });

        return {
            title: titles,
            grid: grids,
            xAxis: xAxes,
            yAxis: yAxes,
            series: series,
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    return P.escapeHtml(p.seriesName) + '<br>'
                        + P.escapeHtml(String(p.name)) + ': <strong>'
                        + (p.value == null ? '—' : p.value + '%')
                        + '</strong>';
                }
            },
            animationDuration: 400
        };
    }
})();
