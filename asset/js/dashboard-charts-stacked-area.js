/**
 * Stacked area chart builders: subject trends and language timeline.
 *
 * Both use the same stacked area pattern with different data dimensions.
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart;
    var buildDataZoom = ns.buildDataZoom;

    ns.charts = ns.charts || {};

    /**
     * Shared stacked area builder.
     * Data format: { years: string[], series: [{ name, data: number[] }] }
     */
    function buildStackedArea(el, data, stackKey) {
        if (!data || !data.years || !data.series || data.years.length < 2) return;
        var chart = initChart(el);
        var hasZoom = data.years.length > 15;
        var bottomMargin = hasZoom ? 90 : 50;

        chart.setOption({
            tooltip: {
                trigger: 'axis',
                confine: true,
                axisPointer: { type: 'cross' }
            },
            aria: { enabled: true },
            legend: {
                type: 'scroll',
                bottom: hasZoom ? 35 : 5,
                textStyle: { fontSize: THEME.fontSize }
            },
            grid: { left: 50, right: 30, top: 20, bottom: bottomMargin },
            xAxis: {
                type: 'category',
                data: data.years,
                boundaryGap: false,
                axisLabel: { fontSize: THEME.fontSize }
            },
            yAxis: {
                type: 'value',
                axisLabel: { fontSize: THEME.fontSize }
            },
            dataZoom: buildDataZoom(data.years.length),
            series: data.series.map(function (s, i) {
                return {
                    name: s.name,
                    type: 'line',
                    stack: stackKey,
                    areaStyle: { opacity: 0.4 },
                    emphasis: { focus: 'series' },
                    symbol: 'circle',
                    symbolSize: 4,
                    lineStyle: { width: 2 },
                    itemStyle: { color: COLORS[i % COLORS.length] },
                    data: s.data
                };
            })
        });

        return chart;
    }

    /** Subject Temporal Trends — top subjects by year. */
    ns.charts.buildSubjectTrends = function (el, data) {
        return buildStackedArea(el, data, 'subjects');
    };

    /** Language × Time — language distribution by year. */
    ns.charts.buildLanguageTimeline = function (el, data) {
        return buildStackedArea(el, data, 'languages');
    };
})();
