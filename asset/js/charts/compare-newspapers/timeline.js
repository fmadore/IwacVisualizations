/**
 * IWAC Visualizations — Compare Newspapers block: timeline panel.
 *
 * Split out of compare-newspapers.js. Builds the overlapping items-per-
 * year line chart across the union of both corpora's years. Hangs off
 * IWACVis.compareNewspapers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/timeline: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    function buildTimeline(dataA, dataB) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Timeline (items per year)')));
        var host = P.el('div', 'iwac-vis-chart');
        panel.appendChild(host);

        var _cc = CN.compareColors();
        var colorA = _cc.a;
        var colorB = _cc.b;

        var yearSet = {};
        (dataA.timeline.years || []).forEach(function (y) { yearSet[y] = true; });
        (dataB.timeline.years || []).forEach(function (y) { yearSet[y] = true; });
        var years = Object.keys(yearSet).map(Number).sort(function (a, b) { return a - b; });

        function toSeries(d) {
            var yearToCount = {};
            (d.timeline.years || []).forEach(function (y, i) {
                yearToCount[y] = d.timeline.counts[i];
            });
            return years.map(function (y) { return yearToCount[y] || 0; });
        }

        ns.registerChart(host, function (el, instance) {
            instance.setOption({
                grid: { left: 48, right: 24, top: 48, bottom: 48, containLabel: true },
                tooltip: { trigger: 'axis' },
                legend: { top: 4, itemWidth: 14, itemHeight: 10 },
                xAxis: {
                    type: 'category',
                    data: years,
                    name: P.t('Year'),
                    nameLocation: 'middle',
                    nameGap: 28
                },
                yAxis: { type: 'value', name: P.t('Count') },
                dataZoom: years.length > 30
                    ? [{ type: 'slider', start: 0, end: 100, bottom: 8, height: 18 },
                       { type: 'inside' }]
                    : [],
                series: [
                    {
                        name: dataA.name,
                        type: 'line',
                        smooth: true,
                        symbolSize: 5,
                        lineStyle: { width: 2, color: colorA },
                        itemStyle: { color: colorA },
                        areaStyle: { color: colorA, opacity: 0.18 },
                        data: toSeries(dataA)
                    },
                    {
                        name: dataB.name,
                        type: 'line',
                        smooth: true,
                        symbolSize: 5,
                        lineStyle: { width: 2, color: colorB },
                        itemStyle: { color: colorB },
                        areaStyle: { color: colorB, opacity: 0.18 },
                        data: toSeries(dataB)
                    }
                ],
                animationDuration: 600,
                animationEasing: 'cubicOut'
            });
        });

        return panel;
    }

    CN.buildTimeline = buildTimeline;
})();
