/**
 * Heatmap chart builder: cross-tabulation matrix (e.g. type × language).
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildHeatmap = function (el, data) {
        if (!data || !data.rows || !data.cols || !data.values) return;
        var chart = initChart(el);
        chart._noDecal = true;
        var maxVal = 0;
        data.values.forEach(function (v) { if (v[2] > maxVal) maxVal = v[2]; });

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) {
                    return echarts.format.encodeHTML(data.rows[p.value[1]]) + ' \u00d7 '
                        + echarts.format.encodeHTML(data.cols[p.value[0]]) + ': ' + p.value[2];
                }
            },
            aria: { enabled: true },
            grid: { left: 120, right: 60, top: 10, bottom: 80 },
            xAxis: {
                type: 'category', data: data.cols, splitArea: { show: true },
                axisLabel: { rotate: 35, fontSize: THEME.fontSize, formatter: function (v) { return truncateLabel(v, 15); } }
            },
            yAxis: {
                type: 'category', data: data.rows, splitArea: { show: true },
                axisLabel: { fontSize: THEME.fontSize, formatter: function (v) { return truncateLabel(v, 15); } }
            },
            visualMap: {
                min: 0, max: maxVal || 1, calculable: true, orient: 'vertical', right: 0, top: 'center',
                inRange: { color: ['#f0f9e8', '#bae4bc', '#7bccc4', '#43a2ca', '#0868ac'] }
            },
            series: [{
                type: 'heatmap', data: data.values,
                label: { show: true, fontSize: 10 },
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } }
            }]
        });
        return chart;
    };
})();
