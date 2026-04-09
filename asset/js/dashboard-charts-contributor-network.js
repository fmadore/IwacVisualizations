/**
 * Contributor and affiliation network charts (bipartite force-directed graphs).
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 *
 * Data format:
 *   { nodes: [{ name, value, itemId, category: 'person'|'project'|'institution', isSelf? }],
 *     links: [{ source, target, value }],
 *     categories: ['person', 'project'] }
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    /** Category color palettes for bipartite graphs (from COLORS palette). */
    var CATEGORY_COLORS = {
        person:      COLORS[0],
        project:     COLORS[1],
        institution: COLORS[2]
    };

    /**
     * Generic bipartite force graph builder.
     * Used for both contributor networks (person↔project) and
     * affiliation networks (person↔institution).
     */
    function buildBipartiteNetwork(el, data, siteBase, tooltipFormatter) {
        if (!data || !data.nodes || !data.links || data.links.length < 1) return;
        var chart = initChart(el);
        var n = data.nodes.length;

        // Build categories array for legend.
        var cats = (data.categories || []).map(function (c) {
            return { name: c, itemStyle: { color: CATEGORY_COLORS[c] || COLORS[0] } };
        });

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: tooltipFormatter || function (p) {
                    if (p.dataType === 'node') {
                        return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>'
                            + '<br/>' + p.data.value + ' items'
                            + (p.data.category ? '<br/><em>' + p.data.category + '</em>' : '');
                    }
                    if (p.dataType === 'edge') {
                        return echarts.format.encodeHTML(p.data.source) + ' \u2194 '
                            + echarts.format.encodeHTML(p.data.target)
                            + ': ' + p.data.value + ' items';
                    }
                    return '';
                }
            },
            aria: { enabled: true },
            legend: cats.length > 1 ? [{
                data: cats.map(function (c) { return c.name; }),
                bottom: 5,
                textStyle: { fontSize: THEME.fontSize }
            }] : [],
            series: [{
                type: 'graph', layout: 'force',
                categories: cats,
                scaleLimit: { min: 0.3, max: 5 },
                data: data.nodes.map(function (nd, i) {
                    var isSelf = !!nd.isSelf;
                    var catIdx = (data.categories || []).indexOf(nd.category);
                    var catColor = CATEGORY_COLORS[nd.category] || COLORS[i % COLORS.length];
                    var size = isSelf ? 45 : Math.max(10, Math.min(35, nd.value * 2.5));
                    return {
                        name: nd.name, symbolSize: size, value: nd.value,
                        category: catIdx >= 0 ? catIdx : 0,
                        itemId: nd.itemId,
                        itemStyle: isSelf
                            ? { color: THEME.accent, borderColor: THEME.text, borderWidth: 3 }
                            : { color: catColor, borderColor: THEME.border, borderWidth: 1,
                                opacity: 0.9 },
                        label: {
                            show: isSelf || n <= 12,
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
                        lineStyle: { width: Math.max(1, Math.min(5, l.value)), curveness: 0.15, opacity: 0.4 }
                    };
                }),
                force: {
                    repulsion: n > 20 ? 500 : 300,
                    gravity: n > 20 ? 0.05 : 0.08,
                    edgeLength: [50, 180],
                    friction: 0.85,
                    layoutAnimation: true
                },
                roam: true, draggable: true,
                emphasis: { focus: 'adjacency', lineStyle: { width: 4, opacity: 0.9 } },
                blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.08 } }
            }]
        });

        chart.on('click', function (p) {
            if (p.dataType === 'node' && p.data.itemId && siteBase) {
                window.location.href = siteBase + '/item/' + p.data.itemId;
            }
        });
        return chart;
    }

    /** Contributor network: person → project. */
    ns.charts.buildContributorNetwork = function (el, data, siteBase) {
        return buildBipartiteNetwork(el, data, siteBase, function (p) {
            if (p.dataType === 'node') {
                var role = p.data.category === 0 ? 'contributor' : 'project';
                return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>'
                    + '<br/>' + p.data.value + ' items'
                    + '<br/><em>' + role + '</em>';
            }
            if (p.dataType === 'edge') {
                return echarts.format.encodeHTML(p.data.source) + ' \u2192 '
                    + echarts.format.encodeHTML(p.data.target)
                    + ': ' + p.data.value + ' contributions';
            }
            return '';
        });
    };

    /** Affiliation network: person → institution. */
    ns.charts.buildAffiliationNetwork = function (el, data, siteBase) {
        return buildBipartiteNetwork(el, data, siteBase, function (p) {
            if (p.dataType === 'node') {
                var type = p.data.isSelf ? 'this institution' :
                    (p.data.category === 0 ? 'person' : 'institution');
                return '<strong>' + echarts.format.encodeHTML(p.name) + '</strong>'
                    + '<br/>' + p.data.value + ' affiliations'
                    + '<br/><em>' + type + '</em>';
            }
            if (p.dataType === 'edge') {
                return echarts.format.encodeHTML(p.data.source) + ' \u2194 '
                    + echarts.format.encodeHTML(p.data.target);
            }
            return '';
        });
    };
})();
