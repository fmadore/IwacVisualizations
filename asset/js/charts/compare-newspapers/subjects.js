/**
 * IWAC Visualizations — Compare Newspapers block: top-subjects panel.
 *
 * Split out of compare-newspapers.js. Builds the grouped horizontal
 * bar chart of the combined top-15 subjects across both corpora.
 * Hangs off IWACVis.compareNewspapers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/subjects: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    function buildTopSubjects(dataA, dataB) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Top subjects (combined top 15)')));
        var host = P.el('div', 'iwac-vis-chart');
        panel.appendChild(host);

        var _cc = CN.compareColors();
        var colorA = _cc.a;
        var colorB = _cc.b;

        var mapA = {}, mapB = {};
        (dataA.subjects || []).forEach(function (e) { mapA[e.name] = e.count; });
        (dataB.subjects || []).forEach(function (e) { mapB[e.name] = e.count; });

        var names = {};
        Object.keys(mapA).forEach(function (n) { names[n] = true; });
        Object.keys(mapB).forEach(function (n) { names[n] = true; });
        var allNames = Object.keys(names);
        allNames.sort(function (a, b) {
            return ((mapB[b] || 0) + (mapA[b] || 0)) - ((mapB[a] || 0) + (mapA[a] || 0));
        });
        var top = allNames.slice(0, 15).reverse();

        ns.registerChart(host, function (el, instance) {
            instance.setOption({
                grid: { left: 8, right: 48, top: 36, bottom: 8, containLabel: true },
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                legend: { top: 4, itemWidth: 14, itemHeight: 10 },
                xAxis: { type: 'value' },
                yAxis: {
                    type: 'category',
                    data: top,
                    axisTick: { show: false },
                    axisLabel: { width: 160, overflow: 'truncate' }
                },
                series: [
                    {
                        name: dataA.name,
                        type: 'bar',
                        itemStyle: { color: colorA, borderRadius: [0, 4, 4, 0] },
                        data: top.map(function (n) { return mapA[n] || 0; })
                    },
                    {
                        name: dataB.name,
                        type: 'bar',
                        itemStyle: { color: colorB, borderRadius: [0, 4, 4, 0] },
                        data: top.map(function (n) { return mapB[n] || 0; })
                    }
                ],
                animationDuration: 600,
                animationEasing: 'cubicOut'
            });
        });

        return panel;
    }

    CN.buildTopSubjects = buildTopSubjects;
})();
