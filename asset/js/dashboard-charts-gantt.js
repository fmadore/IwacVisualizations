/**
 * Gantt chart builder: project timelines with start/end date bars.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildGantt = function (el, data, siteBase) {
        if (!data || !data.length) return;
        var chart = initChart(el);
        var projects = data.slice().reverse();
        var names = projects.map(function (p) { return p.name; });
        var minYear = 9999, maxYear = 0;

        var barData = projects.map(function (p, i) {
            var start = new Date(p.start).getTime();
            var end = new Date(p.end).getTime();
            var sy = new Date(p.start).getFullYear();
            var ey = new Date(p.end).getFullYear();
            if (sy < minYear) minYear = sy;
            if (ey > maxYear) maxYear = ey;
            return {
                name: p.name, value: [i, start, end, p.itemId],
                itemStyle: { color: COLORS[i % COLORS.length], borderRadius: 3 }
            };
        });

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (params) {
                    var v = params.value;
                    var s = new Date(v[1]).toLocaleDateString('en', { year: 'numeric', month: 'short' });
                    var e = new Date(v[2]).toLocaleDateString('en', { year: 'numeric', month: 'short' });
                    return '<strong>' + echarts.format.encodeHTML(params.name) + '</strong><br/>' + s + ' \u2192 ' + e;
                }
            },
            aria: { enabled: true },
            grid: { left: 220, right: 30, top: 10, bottom: 30 },
            xAxis: {
                type: 'time',
                min: new Date(minYear, 0, 1).getTime(),
                max: new Date(maxYear + 1, 0, 1).getTime(),
                axisLabel: { fontSize: THEME.fontSize }
            },
            yAxis: {
                type: 'category', data: names,
                axisLabel: {
                    fontSize: THEME.fontSize, width: 200, overflow: 'truncate',
                    formatter: function (v) { return truncateLabel(v, 28); }
                }
            },
            series: [{
                type: 'custom',
                renderItem: function (params, api) {
                    var catIdx = api.value(0);
                    var start = api.coord([api.value(1), catIdx]);
                    var end = api.coord([api.value(2), catIdx]);
                    var height = api.size([0, 1])[1] * 0.6;
                    return {
                        type: 'rect', shape: { x: start[0], y: start[1] - height / 2, width: end[0] - start[0], height: height },
                        style: api.style()
                    };
                },
                encode: { x: [1, 2], y: 0 },
                data: barData
            }]
        });

        chart.on('click', function (p) {
            if (p.value && p.value[3] && siteBase) window.location.href = siteBase + '/item/' + p.value[3];
        });
        return chart;
    };
})();
