/**
 * Timeline chart builder: items per year as a bar chart.
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

    ns.charts.buildTimeline = function (el, data) {
        var raw = (typeof data === 'object' && !Array.isArray(data)) ? data : null;
        if (!raw || !Object.keys(raw).length) return;
        var chart = initChart(el);
        var years = Object.keys(raw).sort();
        var values = years.map(function (y) { return raw[y]; });

        var zoom = buildDataZoom(years.length);
        chart.setOption({
            tooltip: { trigger: 'axis', confine: true },
            aria: { enabled: true },
            dataZoom: zoom,
            grid: { left: 50, right: 20, top: 20, bottom: zoom.length ? 60 : 40 },
            xAxis: {
                type: 'category', data: years,
                axisLabel: { rotate: years.length > 15 ? 45 : 0, fontSize: THEME.fontSize }
            },
            yAxis: { type: 'value', minInterval: 1 },
            series: [{
                type: 'bar', data: values,
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: COLORS[0] }, { offset: 1, color: THEME.gradientEnd }
                    ]),
                    borderRadius: [3, 3, 0, 0]
                },
                barMaxWidth: THEME.barMaxWidthWide
            }]
        });
        return chart;
    };
})();
