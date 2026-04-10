/**
 * IWAC Visualizations — Shared ECharts option builders
 *
 * Every chart type the module renders has one builder here. Block
 * controllers import them via `IWACVis.chartOptions.<name>(data, opts)`
 * and pass the result to the ECharts instance's `setOption`.
 *
 * Builders return plain option objects — no theme colors, no font
 * families. The registered IWAC ECharts theme (iwac-theme.js) provides
 * all of that at init time, so switching light/dark just needs a
 * dispose+reinit which dashboard-core.js handles automatically.
 *
 * Load order: after panels.js, before any block controller.
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
     */
    C.timeline = function (timeline, opts) {
        opts = opts || {};
        var filter = opts.filterUnknown !== false;
        var categories = (timeline.categories || timeline.countries || []);
        if (filter) categories = categories.filter(function (c) { return !P.isUnknown(c); });
        var years = timeline.years || [];

        var series = categories.map(function (cat) {
            return {
                name: cat,
                type: 'bar',
                stack: 'total',
                barMaxWidth: 28,
                emphasis: { focus: 'series' },
                blur: { itemStyle: { opacity: 0.35 } },
                data: (timeline.series && timeline.series[cat]) || []
            };
        });

        var useZoom = years.length > 20;
        return {
            grid: { left: 48, right: 16, top: 48, bottom: useZoom ? 56 : 32, containLabel: true },
            legend: {
                type: 'scroll',
                top: 4,
                itemWidth: 12,
                itemHeight: 10
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' }
            },
            xAxis: {
                type: 'category',
                data: years,
                name: opts.categoryName || t('Year'),
                nameLocation: 'middle',
                nameGap: useZoom ? 36 : 24
            },
            yAxis: {
                type: 'value',
                name: opts.valueName || t('Count')
            },
            dataZoom: useZoom
                ? [
                      { type: 'slider', start: 60, end: 100, bottom: 8, height: 18 },
                      { type: 'inside' }
                  ]
                : [],
            series: series
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Horizontal bar                                                    */
    /* ----------------------------------------------------------------- */

    /**
     * Simple top-N horizontal bar chart.
     *
     * @param {Array<Object>} entries
     * @param {Object} [opts]
     * @param {string} [opts.nameKey='name']
     * @param {string} [opts.valueKey='count']
     * @param {boolean} [opts.filterUnknown=true]
     */
    C.horizontalBar = function (entries, opts) {
        opts = opts || {};
        var nameKey = opts.nameKey || 'name';
        var valueKey = opts.valueKey || 'count';
        var list = (entries || []).slice();
        if (opts.filterUnknown !== false) {
            list = list.filter(function (e) { return !P.isUnknown(e && e[nameKey]); });
        }
        var names = list.map(function (e) { return e[nameKey]; });
        var values = list.map(function (e) { return e[valueKey]; });
        return {
            grid: { left: 8, right: 28, top: 8, bottom: 8, containLabel: true },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false }
            },
            series: [
                {
                    type: 'bar',
                    data: values,
                    barMaxWidth: 22,
                    label: {
                        show: true,
                        position: 'right',
                        formatter: function (p) { return fmt(p.value); }
                    }
                }
            ]
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Pie (donut)                                                       */
    /* ----------------------------------------------------------------- */

    /**
     * Donut pie chart. Used for language distribution on both overview
     * blocks. Labels render only for slices >= 5% to avoid clutter.
     *
     * @param {Array<Object>} entries
     * @param {Object} [opts]
     * @param {string} [opts.nameKey='name']
     * @param {string} [opts.valueKey='count']
     */
    C.pie = function (entries, opts) {
        opts = opts || {};
        var nameKey = opts.nameKey || 'name';
        var valueKey = opts.valueKey || 'count';
        var data = (entries || []).map(function (e) {
            return { name: e[nameKey], value: e[valueKey] };
        });
        return {
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    return '<strong>' + esc(p.name) + '</strong><br>'
                        + fmt(p.value) + ' (' + p.percent + '%)';
                }
            },
            legend: {
                orient: 'vertical',
                left: 'right',
                top: 'middle',
                itemWidth: 12,
                itemHeight: 10
            },
            series: [
                {
                    type: 'pie',
                    radius: ['40%', '68%'],
                    center: ['38%', '50%'],
                    avoidLabelOverlap: true,
                    label: {
                        show: true,
                        formatter: function (p) {
                            return p.percent >= 5 ? p.name + '\n' + p.percent + '%' : '';
                        }
                    },
                    emphasis: {
                        label: { show: true, fontWeight: 'bold' }
                    },
                    labelLine: { show: true },
                    data: data
                }
            ]
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Newspaper coverage bar (with year-range tooltip)                  */
    /* ----------------------------------------------------------------- */

    /**
     * Horizontal bar with a richer tooltip showing year range + per-subset
     * breakdown + country.
     *
     * @param {Array<Object>} entries
     *   Each: { name, total, articles?, publications?, year_min?, year_max?, country? }
     */
    C.newspaper = function (entries) {
        var list = entries || [];
        var names = list.map(function (e) { return e.name; });
        var values = list.map(function (e) { return e.total; });
        return {
            grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var entry = list[p.dataIndex] || {};
                    var lines = ['<strong>' + esc(entry.name || '') + '</strong>'];
                    if (entry.year_min && entry.year_max) {
                        lines.push(t('coverage_range', { min: entry.year_min, max: entry.year_max }));
                    }
                    var bits = [];
                    if (entry.articles)     bits.push(fmt(entry.articles) + ' ' + t('Articles').toLowerCase());
                    if (entry.publications) bits.push(fmt(entry.publications) + ' ' + t('Publications').toLowerCase());
                    if (bits.length) lines.push(bits.join(' &middot; '));
                    if (entry.country) lines.push(esc(entry.country));
                    return lines.join('<br>');
                }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false }
            },
            series: [
                {
                    type: 'bar',
                    data: values,
                    barMaxWidth: 18,
                    label: {
                        show: true,
                        position: 'right',
                        formatter: function (p) { return fmt(p.value); }
                    }
                }
            ]
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Entity frequency bar (with click-through data)                    */
    /* ----------------------------------------------------------------- */

    /**
     * Horizontal bar for top-N entities. Each data point carries an
     * `o_id` so the controller can wire click → Omeka item page.
     *
     * @param {Array<Object>} entries
     *   Each: { title, frequency, o_id?, countries?, first_occurrence?, last_occurrence? }
     */
    C.entities = function (entries) {
        var list = entries || [];
        var names = list.map(function (e) { return e.title; });
        var values = list.map(function (e, i) {
            return { value: e.frequency, o_id: e.o_id };
        });
        return {
            grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var entry = list[p.dataIndex] || {};
                    var lines = [
                        '<strong>' + esc(entry.title || '') + '</strong>',
                        t('mentions_count', { count: fmt(entry.frequency || 0) })
                    ];
                    if (entry.first_occurrence || entry.last_occurrence) {
                        lines.push(
                            (entry.first_occurrence || '?') + ' \u2013 ' + (entry.last_occurrence || '?')
                        );
                    }
                    if (entry.countries && entry.countries.length) {
                        lines.push(entry.countries.join(', '));
                    }
                    return lines.join('<br>');
                }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false }
            },
            series: [
                {
                    type: 'bar',
                    data: values,
                    barMaxWidth: 20,
                    label: {
                        show: true,
                        position: 'right',
                        formatter: function (p) { return fmt(p.value); }
                    },
                    cursor: 'pointer'
                }
            ]
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Treemap                                                           */
    /* ----------------------------------------------------------------- */

    /**
     * Hierarchical treemap. Accepts an object of shape
     * `{ name, children: [...] }` where each child may have its own
     * `children`. Matches the generator's output and also matches the
     * structure we build client-side from the references subset.
     *
     * @param {Object} tree
     * @param {Object} [opts]
     * @param {string} [opts.rootName] default: tree.name || "Root"
     */
    C.treemap = function (tree, opts) {
        opts = opts || {};
        return {
            tooltip: {
                formatter: function (info) {
                    var path = info.treePathInfo || [];
                    var crumbs = path.slice(1).map(function (p) { return esc(p.name); }).join(' \u203a ');
                    return crumbs + '<br><strong>' + fmt(info.value) + '</strong>';
                }
            },
            series: [
                {
                    type: 'treemap',
                    name: opts.rootName || (tree && tree.name) || 'Root',
                    roam: false,
                    nodeClick: 'zoomToNode',
                    breadcrumb: { show: true, bottom: 4 },
                    label: { show: true, formatter: '{b}' },
                    upperLabel: { show: true, height: 22 },
                    itemStyle: { borderWidth: 1, gapWidth: 2 },
                    levels: [
                        { itemStyle: { borderWidth: 0, gapWidth: 3 } },
                        { itemStyle: { gapWidth: 2 }, upperLabel: { show: true } },
                        {
                            colorSaturation: [0.35, 0.5],
                            itemStyle: { gapWidth: 1, borderColorSaturation: 0.6 }
                        }
                    ],
                    data: (tree && tree.children) || []
                }
            ]
        };
    };
})();
