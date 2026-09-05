/**
 * IWAC Visualizations — Index Overview: Rising & falling subjects bump chart
 *
 * ROADMAP 9.7: the rank of the leading Dublin Core subjects per decade,
 * derived client-side from the Keyword Explorer's already-fetched
 * subjects bundle (global_series carries the top-100 pool with per-year
 * counts — no new precompute, no payload growth). Answers "what
 * replaced what" in a way the keywords-over-time lines don't: a line
 * that climbs took attention away from one that sinks.
 *
 * A subject enters the chart if it ranks in the decade top-N at least
 * once; outside the top-N its line breaks (null), which reads as
 * "dropped off the chart". Decade labels are locale-neutral
 * ("1960–1969").
 *
 * Load order: after panels.js + chart-options.js, before the
 * index-overview orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.index-overview/keywords-bump: panels.js must load first');
        return;
    }

    var RANK_N = 8;

    function render(panelEl, subjects) {
        var years = (subjects && subjects.years) || [];
        var series = (subjects && subjects.global_series) || {};
        var keywords = Object.keys(series);
        if (!years.length || !keywords.length) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        // --- Decade aggregation ------------------------------------------
        var decadeStarts = [];
        var decadeIdx = {};
        years.forEach(function (y) {
            var d = Math.floor(y / 10) * 10;
            if (!(d in decadeIdx)) {
                decadeIdx[d] = decadeStarts.length;
                decadeStarts.push(d);
            }
        });
        var decadeLabels = decadeStarts.map(function (d) {
            return d + '–' + (d + 9);
        });

        // totals[kw] = per-decade summed counts
        var totals = {};
        keywords.forEach(function (kw) {
            var counts = series[kw].counts || [];
            var buckets = decadeStarts.map(function () { return 0; });
            years.forEach(function (y, i) {
                buckets[decadeIdx[Math.floor(y / 10) * 10]] += counts[i] || 0;
            });
            totals[kw] = buckets;
        });

        // Drop decades where nothing ranks — stray early items (a lone
        // 1910s record) would otherwise render empty rank columns.
        var keep = decadeStarts.map(function (_, di) {
            return keywords.some(function (kw) { return totals[kw][di] > 0; });
        });
        if (keep.indexOf(true) === -1) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }
        decadeStarts = decadeStarts.filter(function (_, di) { return keep[di]; });
        decadeLabels = decadeLabels.filter(function (_, di) { return keep[di]; });
        keywords.forEach(function (kw) {
            totals[kw] = totals[kw].filter(function (_, di) { return keep[di]; });
        });

        // ranks[kw] = per-decade rank (1-based) or null outside top-N
        var ranks = {};
        keywords.forEach(function (kw) { ranks[kw] = []; });
        decadeStarts.forEach(function (_, di) {
            var order = keywords
                .filter(function (kw) { return totals[kw][di] > 0; })
                .sort(function (a, b) { return totals[b][di] - totals[a][di]; });
            keywords.forEach(function (kw) {
                var r = order.indexOf(kw);
                ranks[kw].push(r >= 0 && r < RANK_N ? r + 1 : null);
            });
        });

        var tracked = keywords.filter(function (kw) {
            return ranks[kw].some(function (r) { return r !== null; });
        });
        if (!tracked.length) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        // --- Chart ---------------------------------------------------------
        ns.registerChart(panelEl.chart, function (el, chart) {
            var chartSeries = tracked.map(function (kw) {
                return {
                    name: kw,
                    type: 'line',
                    smooth: 0.3,
                    symbol: 'circle',
                    symbolSize: 9,
                    lineStyle: { width: 3, cap: 'round' },
                    emphasis: { focus: 'series' },
                    connectNulls: false,
                    endLabel: {
                        show: true,
                        formatter: '{a}',
                        fontSize: 11,
                        width: 110,
                        overflow: 'truncate',
                        distance: 8
                    },
                    labelLayout: { hideOverlap: true },
                    data: ranks[kw]
                };
            });

            chart.setOption({
                grid: { left: 44, right: 130, top: 16, bottom: 36, containLabel: false },
                tooltip: {
                    trigger: 'axis',
                    confine: true,
                    // Ranks sort ascending (#1 first); missing ranks sink.
                    formatter: ns.chartOptions.sortedAxisTooltip({
                        order: 'asc',
                        missingValue: 99,
                        row: function (p, di) {
                            return p.marker + ' #' + p.value + ' '
                                + P.escapeHtml(p.seriesName) + ' ('
                                + P.formatNumber(totals[p.seriesName][di]) + ')';
                        }
                    })
                },
                xAxis: {
                    type: 'category',
                    data: decadeLabels,
                    boundaryGap: true,
                    axisTick: { show: false }
                },
                yAxis: {
                    type: 'value',
                    inverse: true,
                    min: 1,
                    max: RANK_N,
                    interval: 1,
                    axisLabel: { formatter: function (v) { return '#' + v; } },
                    splitLine: { show: false }
                },
                series: chartSeries
            }, true);
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.keywordsBump = { render: render };
})();
