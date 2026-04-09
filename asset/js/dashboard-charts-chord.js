/**
 * Chord diagram builder: circular graph for co-occurrence relationships.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildChord = function (el, data, siteBase) {
        if (!data || !data.nodes || !data.links || data.nodes.length < 2) return;
        var chart = initChart(el);
        chart._noDecal = true;

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) {
                    if (p.dataType === 'node') return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>';
                    if (p.dataType === 'edge') {
                        return echarts.format.encodeHTML(p.data.source) + ' \u2194 '
                            + echarts.format.encodeHTML(p.data.target) + ': ' + p.data.value;
                    }
                    return '';
                }
            },
            aria: { enabled: true },
            series: [{
                type: 'graph', layout: 'circular', circular: { rotateLabel: true },
                data: data.nodes.map(function (n, i) {
                    return {
                        name: n.name, symbolSize: Math.max(10, Math.min(40, n.value * 2)),
                        itemStyle: { color: COLORS[i % COLORS.length] },
                        itemId: n.itemId,
                        label: { fontSize: THEME.fontSize - 1, formatter: function (p) { return truncateLabel(p.name, 20); } }
                    };
                }),
                links: data.links.map(function (l) {
                    return {
                        source: l.source, target: l.target, value: l.value,
                        lineStyle: { width: Math.max(1, Math.min(6, l.value)), curveness: 0.3, opacity: 0.5 }
                    };
                }),
                roam: true, label: { show: true, position: 'right' },
                emphasis: { focus: 'adjacency', lineStyle: { width: 4, opacity: 0.9 } }
            }]
        });

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.itemId && siteBase) window.location.href = siteBase + '/item/' + p.data.itemId;
        });
        return chart;
    };
})();
