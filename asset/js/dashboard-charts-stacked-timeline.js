/**
 * Stacked timeline builder: items per year stacked by resource type.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart;
    var buildDataZoom = ns.buildDataZoom;

    ns.charts = ns.charts || {};

    ns.charts.buildStackedTimeline = function (el, data) {
        if (!data || !data.years || !data.series) return;
        var chart = initChart(el);

        var series = data.series.map(function (s, i) {
            return {
                name: s.name, type: 'bar', stack: 'total',
                data: s.data,
                itemStyle: { color: COLORS[i % COLORS.length] },
                emphasis: { focus: 'series' }
            };
        });

        var zoom = buildDataZoom(data.years.length);
        chart.setOption({
            tooltip: { trigger: 'axis', confine: true },
            aria: { enabled: true, decal: { show: ns._decalEnabled } },
            dataZoom: zoom,
            legend: { bottom: zoom.length ? 50 : 5, textStyle: { fontSize: THEME.fontSize }, type: 'scroll' },
            grid: { left: 50, right: 20, top: 20, bottom: zoom.length ? 110 : 55 },
            xAxis: {
                type: 'category', data: data.years,
                axisLabel: { rotate: data.years.length > 15 ? 45 : 0, fontSize: THEME.fontSize }
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: series
        });
        return chart;
    };
})();
