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
            // left:56 — room for the rotated y-axis name to clear the tick
            // numbers; bottom widened so, with a slider present, the x-axis
            // name sits above the slider track instead of colliding.
            grid: C._grid({ left: 64, bottom: useZoom ? 64 : 40 }),
            legend: C._legend(),
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'category',
                data: years,
                name: opts.categoryName || t('Year'),
                nameLocation: 'middle',
                nameGap: useZoom ? 34 : 26
            },
            yAxis: Object.assign({ type: 'value' }, C._valueAxisName(opts.valueName || t('Count'))),
            dataZoom: dataZoom,
            series: series
        };

        return R && R.withMedia
            ? R.withMedia(base, R.valueChartMedia({ hasZoom: useZoom }))
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
     * @param {Object<string,string>} [opts.colors]
     *   Raw stack key → CSS color. Supply this whenever the stack is an
     *   ORDINAL scale (polarité, centralité, a 1–5 rating): left to its
     *   own devices ECharts hands out the categorical series palette,
     *   which encodes no order and collides with the semantic ramps the
     *   rest of the site reads from `--iwac-vis-sent-*` / `-cent-*`.
     *   Keyed on the RAW key, not the translated label, so the lookup
     *   survives a locale switch.
     */
    C.stackedBar = function (d, opts) {
        opts = opts || {};
        var categories = d.categories || [];
        var stackKeys = d.stackKeys || [];
        var seriesMap = d.series || {};
        var colors = opts.colors || null;

        var barDef = C._barDefaults('vertical');
        var series = stackKeys.map(function (k) {
            var itemStyle = { borderRadius: barDef.borderRadius.slice() };
            if (colors && colors[k]) itemStyle.color = colors[k];
            return {
                name: opts.labelFor ? opts.labelFor(k) : k,
                type: 'bar',
                stack: 'total',
                barMaxWidth: barDef.barMaxWidth,
                emphasis: { focus: 'series' },
                blur: { itemStyle: { opacity: 0.5 } },
                itemStyle: itemStyle,
                data: seriesMap[k] || []
            };
        });

        var dataZoom = C._dataZoom(categories.length);
        var useZoom = dataZoom.length > 0;
        var base = {
            grid: C._grid({ left: 64, bottom: useZoom ? 64 : 40 }),
            legend: C._legend(),
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'category',
                data: categories,
                name: opts.categoryName || '',
                nameLocation: 'middle',
                nameGap: useZoom ? 34 : 26
            },
            yAxis: Object.assign({ type: 'value' }, C._valueAxisName(opts.valueName || t('Count'))),
            dataZoom: dataZoom,
            series: series
        };

        return R && R.withMedia
            ? R.withMedia(base, R.valueChartMedia({ hasZoom: useZoom }))
            : base;
    };
})();
