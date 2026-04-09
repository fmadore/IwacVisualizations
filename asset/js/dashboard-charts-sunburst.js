/**
 * Sunburst chart builder: hierarchical radial chart (type > language > subject).
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME;
    var initChart = ns.initChart;

    ns.charts = ns.charts || {};

    ns.charts.buildSunburst = function (el, data) {
        if (!data || !data.length) return;
        var chart = initChart(el);

        chart.setOption({
            tooltip: { confine: true },
            aria: { enabled: true, decal: { show: ns._decalEnabled } },
            series: [{
                type: 'sunburst',
                data: data,
                radius: ['10%', '90%'],
                sort: null,
                emphasis: { focus: 'ancestor' },
                levels: [
                    {},
                    { r0: '10%', r: '40%', label: { fontSize: THEME.fontSize, rotate: 'tangential' }, itemStyle: { borderWidth: 2 } },
                    { r0: '40%', r: '65%', label: { fontSize: THEME.fontSize - 1, rotate: 'tangential' }, itemStyle: { borderWidth: 1 } },
                    { r0: '65%', r: '90%', label: { show: false }, itemStyle: { borderWidth: 0.5 } }
                ]
            }]
        });
        return chart;
    };
})();
