/**
 * IWAC Visualizations — Collection Overview: the collection-growth chart.
 *
 * `C.growthBar` used to sit in the shared charts bundle
 * (chart-options-bar.js), which every chart page loads, while only this
 * block draws it. It lives beside the block now and still attaches to
 * `IWACVis.chartOptions`, so `growth.js` did not change. Loaded before
 * that panel in the block's bundle (asset/js/bundles.json).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.collection-overview/growth-bar: panels.js and the shared chart options must load first');
        return;
    }

    var t = P.t;
    var R = ns.responsive;

    /* ----------------------------------------------------------------- */
    /*  Growth bar (monthly additions + cumulative line, dual axis)       */
    /* ----------------------------------------------------------------- */

    /**
     * @param {Object} growth { months: [...], monthly_additions: [...], cumulative_total: [...] }
     */
    C.growthBar = function (growth) {
        var months = growth.months || [];
        var monthly = growth.monthly_additions || [];
        var cumulative = growth.cumulative_total || [];
        var barDef = C._barDefaults('vertical');
        var dataZoom = C._dataZoom(months.length, { threshold: 24 });
        var useZoom = dataZoom.length > 0;

        var base = {
            // left + right gutters hold the two rotated axis names (Monthly
            // on the left, Cumulative on the right); bottom widened for the
            // x-axis name to clear any slider.
            grid: C._grid({ left: 64, right: 64, bottom: useZoom ? 64 : 44 }),
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: {
                top: 4,
                itemWidth: 12,
                itemHeight: 10,
                data: [t('Monthly additions'), t('Cumulative total')]
            },
            xAxis: {
                type: 'category',
                data: months,
                name: t('Month'),
                nameLocation: 'middle',
                nameGap: useZoom ? 34 : 26
            },
            yAxis: [
                Object.assign({ type: 'value' }, C._valueAxisName(t('Monthly'))),
                Object.assign({ type: 'value', splitLine: { show: false } }, C._valueAxisName(t('Cumulative')))
            ],
            dataZoom: dataZoom,
            series: [
                {
                    name: t('Monthly additions'),
                    type: 'bar',
                    yAxisIndex: 0,
                    data: monthly,
                    barMaxWidth: barDef.barMaxWidth - 8,
                    itemStyle: { borderRadius: barDef.borderRadius.slice() }
                },
                {
                    name: t('Cumulative total'),
                    type: 'line',
                    yAxisIndex: 1,
                    data: cumulative,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 2 }
                }
            ]
        };

        // Dual-axis chart is the most cramped on phones: rotate the long
        // "YYYY-MM" month labels, shrink fonts, and keep both rotated axis
        // names close. Custom media (not R.valueChartMedia) because the
        // yAxis is a two-element array that must be merged element-wise.
        var growthMedia = [{
            query: { maxWidth: R ? R.BP.sm : 640 },
            option: {
                grid: { left: 44, right: 44, top: 56, bottom: useZoom ? 64 : 56, containLabel: true },
                xAxis: {
                    nameGap: useZoom ? 28 : 24,
                    axisLabel: { rotate: 45, fontSize: 9, hideOverlap: true }
                },
                yAxis: [
                    { nameGap: 28, nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
                    { nameGap: 28, nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } }
                ]
            }
        }];
        if (useZoom) {
            growthMedia[0].option.dataZoom = [{ bottom: 4, height: 14 }];
        }

        return R && R.withMedia
            ? R.withMedia(base, growthMedia)
            : base;
    };
})();
