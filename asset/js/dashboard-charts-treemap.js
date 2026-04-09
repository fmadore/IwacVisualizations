/**
 * Treemap chart builder: hierarchical space-filling visualization.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 *
 * Data format: [{ name, value, children: [{ name, value }] }]
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildTreemap = function (el, data) {
        if (!data || !data.length) return;
        var chart = initChart(el);

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) {
                    var path = p.treePathInfo.map(function (n) { return n.name; }).filter(Boolean);
                    return path.join(' \u203a ') + '<br/>' + p.value + ' items';
                }
            },
            aria: { enabled: true },
            series: [{
                type: 'treemap',
                data: data,
                roam: false,
                nodeClick: false,
                breadcrumb: {
                    show: true,
                    bottom: 5,
                    itemStyle: { textStyle: { fontSize: THEME.fontSize } }
                },
                label: {
                    show: true,
                    fontSize: THEME.fontSize,
                    formatter: function (p) { return truncateLabel(p.name, 20); }
                },
                upperLabel: {
                    show: true,
                    height: 22,
                    fontSize: THEME.fontSize,
                    color: THEME.border,
                    formatter: function (p) { return truncateLabel(p.name, 30); }
                },
                itemStyle: {
                    borderColor: '#fff',
                    borderWidth: 2,
                    gapWidth: 1
                },
                levels: [
                    {
                        itemStyle: { borderWidth: 3, gapWidth: 3 },
                        upperLabel: { show: true }
                    },
                    {
                        itemStyle: { borderWidth: 1, gapWidth: 1 },
                        colorSaturation: [0.35, 0.6]
                    }
                ]
            }]
        });

        return chart;
    };
})();
