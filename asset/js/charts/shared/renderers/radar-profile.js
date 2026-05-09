/**
 * IWAC Visualizations — Radar profile renderer
 *
 * Multi-series radar comparing two or more entities (newspapers,
 * countries, persons) along 3+ scaled axes. Per-axis max defaults to
 * `max(values, 1)` across all series so shapes are directly comparable
 * — unlike absolute-scale radars where one tall axis flattens the
 * others to a dot.
 *
 * Data shape:
 *
 *     {
 *       indicators: [
 *         { name: 'Articles',  max?: 100 },          // max optional, auto-derived
 *         { name: 'Authors',   max?: 50  },
 *         ...
 *       ],
 *       series: [
 *         { name: 'Le Soleil', value: [80, 30, 50, 20, 35] },
 *         { name: 'Sud Quotidien', value: [60, 45, 40, 25, 28] }
 *       ]
 *     }
 *
 * Predicate: needs ≥ 3 indicators and ≥ 1 series with values.
 *
 * Registered as `radarProfile`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.radar-profile: dashboard-layout.js + panels.js must load first');
        return;
    }

    function buildOption(data) {
        var indicators = (data && data.indicators) || [];
        var series = (data && data.series) || [];

        // Auto-fill missing max values from the per-axis maximum across
        // all series — keeps shapes comparable when callers don't bother
        // specifying scales themselves.
        var resolved = indicators.map(function (ind, i) {
            if (ind.max != null) return { name: ind.name, max: ind.max };
            var m = 1;
            for (var s = 0; s < series.length; s++) {
                var v = series[s].value && series[s].value[i];
                if (typeof v === 'number' && v > m) m = v;
            }
            return { name: ind.name, max: m };
        });

        var palette = (ns.getPalette && ns.getPalette()) || [];
        var tokens  = (ns.getChartTokens && ns.getChartTokens()) || {};

        return {
            tooltip: { trigger: 'item' },
            legend: {
                top: 6,
                textStyle: { color: tokens.inkLight }
            },
            radar: {
                indicator: resolved,
                shape: 'polygon',
                splitNumber: 4,
                center: ['50%', '55%'],
                radius: '62%',
                axisName: { color: tokens.inkLight, fontSize: 11 },
                splitLine: { lineStyle: { color: tokens.borderLight || tokens.border } },
                splitArea: {
                    areaStyle: {
                        color: [tokens.surface, tokens.surfaceRaised || tokens.surface],
                        opacity: 0.6
                    }
                },
                axisLine: { lineStyle: { color: tokens.border } }
            },
            series: [{
                type: 'radar',
                emphasis: { focus: 'series' },
                data: series.map(function (s, i) {
                    var color = palette[i % (palette.length || 1)];
                    return {
                        name: s.name,
                        value: s.value,
                        itemStyle: { color: color },
                        lineStyle: { color: color, width: 2 },
                        areaStyle: { color: color, opacity: 0.15 }
                    };
                })
            }]
        };
    }

    DL.registerRenderer('radarProfile', function (el, data) {
        var option = buildOption(data);
        ns.registerChart(el, function (_e, instance) {
            instance.setOption(option, true);
        });
    });

    DL.registerMetadata('radarProfile', {
        labelKey: 'Profile comparison',
        descKey:  'desc_radar_profile',
        hasData:  function (v) {
            return v && Array.isArray(v.indicators) && v.indicators.length >= 3
                && Array.isArray(v.series) && v.series.length > 0
                && v.series.some(function (s) { return Array.isArray(s.value) && s.value.length > 0; });
        }
    });
})();
