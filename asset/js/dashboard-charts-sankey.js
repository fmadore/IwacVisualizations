/**
 * Sankey diagram builder: flow from contributors through projects to types.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildSankey = function (el, data) {
        if (!data || !data.nodes || !data.links || data.links.length < 1) return;
        var chart = initChart(el);
        chart._noDecal = true;

        chart.setOption({
            tooltip: { trigger: 'item', confine: true },
            aria: { enabled: true, decal: { show: ns._decalEnabled } },
            series: [{
                type: 'sankey', layout: 'none',
                emphasis: { focus: 'adjacency' },
                nodeAlign: 'left', orient: 'horizontal',
                nodeWidth: 20, nodeGap: 10,
                lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.4 },
                label: {
                    fontSize: THEME.fontSize,
                    formatter: function (p) { return truncateLabel(p.name, 25); }
                },
                data: data.nodes.map(function (n, i) {
                    return { name: n.name, itemStyle: { color: COLORS[i % COLORS.length] } };
                }),
                links: data.links
            }]
        });
        return chart;
    };
})();
