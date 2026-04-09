/**
 * Institution collaboration network chart (force-directed graph).
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    ns.charts.buildCollabNetwork = function (el, data, siteBase) {
        if (!data || !data.nodes || !data.links || data.links.length < 1) return;
        var chart = initChart(el);
        var n = data.nodes.length;

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong><br/>'
                            + p.data.value + (p.data.isSelf ? ' total items' : ' shared items');
                    }
                    if (p.dataType === 'edge') {
                        return echarts.format.encodeHTML(p.data.source) + ' \u2194 '
                            + echarts.format.encodeHTML(p.data.target) + ': ' + p.data.value + ' shared items';
                    }
                    return '';
                }
            },
            aria: { enabled: true },
            series: [{
                type: 'graph', layout: 'force',
                scaleLimit: { min: 0.3, max: 5 },
                data: data.nodes.map(function (nd, i) {
                    var isSelf = !!nd.isSelf;
                    var size = isSelf ? 45 : Math.max(12, Math.min(35, nd.value * 3));
                    return {
                        name: nd.name, symbolSize: size, value: nd.value,
                        isSelf: isSelf, itemId: nd.itemId,
                        itemStyle: isSelf
                            ? { color: THEME.accent, borderColor: THEME.text, borderWidth: 3 }
                            : { color: COLORS[(i - 1) % COLORS.length], borderColor: THEME.border, borderWidth: 1 },
                        label: {
                            show: isSelf || n <= 10,
                            fontSize: isSelf ? THEME.fontSizeEmphasis : THEME.fontSize,
                            fontWeight: isSelf ? 'bold' : 'normal',
                            formatter: function (p) { return truncateLabel(p.name, THEME.labelMaxLen); }
                        },
                        emphasis: { label: { show: true, fontSize: THEME.fontSizeEmphasis, fontWeight: 'bold' } }
                    };
                }),
                links: data.links.map(function (l) {
                    return {
                        source: l.source, target: l.target, value: l.value,
                        lineStyle: { width: Math.max(1, Math.min(6, l.value)), curveness: 0.15, opacity: 0.5 }
                    };
                }),
                force: {
                    repulsion: n > 15 ? 400 : 250,
                    gravity: n > 15 ? 0.06 : 0.1,
                    edgeLength: [60, 200],
                    friction: 0.85,
                    layoutAnimation: true
                },
                roam: true, draggable: true,
                emphasis: { focus: 'adjacency', lineStyle: { width: 4, opacity: 0.9 } },
                blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.08 } }
            }]
        });

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.itemId && siteBase) window.location.href = siteBase + '/item/' + p.data.itemId;
        });
        return chart;
    };
})();
