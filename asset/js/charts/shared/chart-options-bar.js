/**
 * IWAC Visualizations — Shared ECharts option builders (vertical & stacked bars)
 *
 * Split out of chart-options.js (v0.23.0) so each chart family lives in
 * a file small enough to reason about. Every file extends the same
 * `IWACVis.chartOptions` (`C`) namespace and depends on the shared
 * private helpers (`C._grid`, `C._countryColor`, …) defined in
 * chart-options.js, which the asset partial loads first.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.chartOptions: panels.js must load first');
        return;
    }
    var C = ns.chartOptions = ns.chartOptions || {};

    var t = P.t;
    var fmt = P.formatNumber;
    var esc = P.escapeHtml;
    var R = ns.responsive;

    /* ----------------------------------------------------------------- */
    /*  Stacked timeline (bar) — year × category                          */
    /* ----------------------------------------------------------------- */

    /**
     * @param {Object} timeline
     * @param {Array<number>} timeline.years
     * @param {Array<string>} timeline.countries   // or any category
     * @param {Object<string, Array<number>>} timeline.series
     * @param {Object} [opts]
     * @param {string} [opts.categoryName] default: t('Year')
     * @param {string} [opts.valueName] default: t('Count')
     * @param {boolean} [opts.filterUnknown=true]
     * @param {boolean} [opts.useCountryColors=true] When true, applies stable per-country colors via C._countryColor
     */
    C.timeline = function (timeline, opts) {
        opts = opts || {};
        var filter = opts.filterUnknown !== false;
        var categories = (timeline.categories || timeline.countries || []);
        if (filter) categories = categories.filter(function (c) { return !P.isUnknown(c); });
        var years = timeline.years || [];

        var barDef = C._barDefaults('vertical');
        var useCountryColors = opts.useCountryColors !== false;
        var series = categories.map(function (cat) {
            var itemStyle = { borderRadius: barDef.borderRadius.slice() };
            if (useCountryColors) itemStyle.color = C._countryColor(cat);
            return {
                name: cat,
                type: 'bar',
                stack: 'total',
                barMaxWidth: barDef.barMaxWidth,
                emphasis: { focus: 'series' },
                blur: { itemStyle: { opacity: 0.5 } },
                itemStyle: itemStyle,
                data: (timeline.series && timeline.series[cat]) || []
            };
        });

        var dataZoom = C._dataZoom(years.length);
        var useZoom = dataZoom.length > 0;
        var base = {
            grid: C._grid({ bottom: useZoom ? 56 : 32 }),
            legend: { type: 'scroll', top: 4, itemWidth: 12, itemHeight: 10 },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'category',
                data: years,
                name: opts.categoryName || t('Year'),
                nameLocation: 'middle',
                nameGap: useZoom ? 36 : 24
            },
            yAxis: { type: 'value', name: opts.valueName || t('Count') },
            dataZoom: dataZoom,
            series: series,
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.gridMedia, R.dataZoomMedia)
            : base;
    };

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
            grid: C._grid({ right: 56, bottom: useZoom ? 56 : 32 }),
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
                nameGap: useZoom ? 36 : 24
            },
            yAxis: [
                { type: 'value', name: t('Monthly') },
                { type: 'value', name: t('Cumulative'), splitLine: { show: false } }
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
            ],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.gridMedia, R.dataZoomMedia)
            : base;
    };

    /* ----------------------------------------------------------------- */
    /*  Generic stacked bar (category × stack)                            */
    /* ----------------------------------------------------------------- */

    /**
     * Generic stacked bar. Different from `C.timeline` which is specialized
     * for year × country — this one accepts arbitrary category/stack keys
     * and an i18n lookup for series names.
     *
     * @param {Object} d
     * @param {Array<any>} d.categories      x-axis labels
     * @param {Array<string>} d.stackKeys    series keys (stacked)
     * @param {Object<string, Array<number>>} d.series
     * @param {Object} [opts]
     * @param {function(string): string} [opts.labelFor]
     * @param {string} [opts.categoryName]
     * @param {string} [opts.valueName]
     */
    C.stackedBar = function (d, opts) {
        opts = opts || {};
        var categories = d.categories || [];
        var stackKeys = d.stackKeys || [];
        var seriesMap = d.series || {};

        var barDef = C._barDefaults('vertical');
        var series = stackKeys.map(function (k) {
            return {
                name: opts.labelFor ? opts.labelFor(k) : k,
                type: 'bar',
                stack: 'total',
                barMaxWidth: barDef.barMaxWidth,
                emphasis: { focus: 'series' },
                blur: { itemStyle: { opacity: 0.5 } },
                itemStyle: { borderRadius: barDef.borderRadius.slice() },
                data: seriesMap[k] || []
            };
        });

        var dataZoom = C._dataZoom(categories.length);
        var useZoom = dataZoom.length > 0;
        var base = {
            grid: C._grid({ bottom: useZoom ? 56 : 32 }),
            legend: { type: 'scroll', top: 4, itemWidth: 12, itemHeight: 10 },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'category',
                data: categories,
                name: opts.categoryName || '',
                nameLocation: 'middle',
                nameGap: useZoom ? 36 : 24
            },
            yAxis: { type: 'value', name: opts.valueName || t('Count') },
            dataZoom: dataZoom,
            series: series,
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.gridMedia, R.dataZoomMedia)
            : base;
    };
})();
