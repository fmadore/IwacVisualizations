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
    var R = ns.responsive;

    /* ----------------------------------------------------------------- */
    /*  Shared private helpers                                            */
    /* ----------------------------------------------------------------- */

    C._grid = function (overrides) {
        var defaults = { left: 48, right: 24, top: 48, bottom: 32, containLabel: true };
        if (!overrides) return defaults;
        var result = {};
        for (var k in defaults) {
            if (Object.prototype.hasOwnProperty.call(defaults, k)) {
                result[k] = overrides[k] !== undefined ? overrides[k] : defaults[k];
            }
        }
        for (var k2 in overrides) {
            if (Object.prototype.hasOwnProperty.call(overrides, k2) && !(k2 in defaults)) {
                result[k2] = overrides[k2];
            }
        }
        return result;
    };

    C._dataZoom = function (count, opts) {
        opts = opts || {};
        var threshold = opts.threshold || 20;
        if (count <= threshold) return [];
        var start = opts.start != null ? opts.start : 60;
        return [
            { type: 'slider', start: start, end: 100, bottom: 8, height: 18 },
            { type: 'inside' }
        ];
    };

    C._truncate = function (str, maxLen) {
        if (!str || str.length <= maxLen) return str || '';
        var head = Math.floor((maxLen - 1) / 2);
        var tail = maxLen - 1 - head;
        return str.slice(0, head) + '\u2026' + str.slice(-tail);
    };

    C._barDefaults = function (direction) {
        var horizontal = direction === 'horizontal';
        return {
            barMaxWidth: horizontal ? 24 : 28,
            emphasis: { focus: 'series' },
            blur: { itemStyle: { opacity: 0.35 } },
            itemStyle: { borderRadius: horizontal ? [0, 2, 2, 0] : [2, 2, 0, 0] }
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Country color map                                                 */
    /*                                                                    */
    /*  All known IWAC countries are pre-mapped in COUNTRY_MAP. The       */
    /*  _dynamicMap fallback handles any unexpected country name (e.g.    */
    /*  data drift) by assigning the next free palette slot. Since the    */
    /*  page reloads on dashboard navigation, persistence across reinits  */
    /*  is not a concern in practice.                                     */
    /* ----------------------------------------------------------------- */

    var COUNTRY_MAP = {
        'Benin':            0,
        'B\u00e9nin':       0,
        'Burkina Faso':     1,
        "C\u00f4te d'Ivoire": 2,
        'Niger':            3,
        'Nigeria':          4,
        'Togo':             5,
        'S\u00e9n\u00e9gal': 6,
        'Senegal':          6
    };
    var _dynamicIdx = 7;
    var _dynamicMap = {};

    C._countryColor = function (country) {
        var palette = (ns.getPalette && ns.getPalette()) || [];
        if (palette.length === 0) palette = ['#e67a14', '#394f68', '#4a8c6f', '#c5504d', '#7c5295', '#d4a574', '#2c5f7c', '#8b6f47'];
        var idx;
        if (COUNTRY_MAP[country] != null) {
            idx = COUNTRY_MAP[country];
        } else if (_dynamicMap[country] != null) {
            idx = _dynamicMap[country];
        } else {
            idx = _dynamicIdx++;
            _dynamicMap[country] = idx;
        }
        return palette[idx % palette.length];
    };

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
            var itemStyle = useCountryColors
                ? { borderRadius: barDef.itemStyle.borderRadius, color: C._countryColor(cat) }
                : { borderRadius: barDef.itemStyle.borderRadius };
            return {
                name: cat,
                type: 'bar',
                stack: 'total',
                barMaxWidth: barDef.barMaxWidth,
                emphasis: barDef.emphasis,
                blur: barDef.blur,
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
        var barDef = C._barDefaults('horizontal');

        var base = {
            grid: C._grid({ left: 8, top: 8, bottom: 8 }),
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false }
            },
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: barDef.barMaxWidth - 2,
                itemStyle: barDef.itemStyle,
                label: {
                    show: true,
                    position: 'right',
                    formatter: function (p) { return fmt(p.value); }
                }
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.gridMedia)
            : base;
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

        var base = {
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
            series: [{
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
                    label: { show: true, fontWeight: 'bold' },
                    scale: true,
                    scaleSize: 6
                },
                labelLine: { show: true },
                data: data
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        var pieMedia = [
            {
                query: { maxWidth: R ? R.BP.sm : 640 },
                option: {
                    legend: {
                        orient: 'horizontal',
                        left: 'center',
                        bottom: 0,
                        top: null,
                        right: null
                    },
                    series: [{
                        center: ['50%', '45%'],
                        radius: ['30%', '58%']
                    }]
                }
            }
        ];

        return R && R.withMedia
            ? R.withMedia(base, pieMedia)
            : base;
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
        var barDef = C._barDefaults('horizontal');

        var base = {
            grid: C._grid({ left: 8, right: 48, top: 8, bottom: 8 }),
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
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: barDef.barMaxWidth - 6,
                itemStyle: barDef.itemStyle,
                label: {
                    show: true,
                    position: 'right',
                    formatter: function (p) { return fmt(p.value); }
                }
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 120, smFontSize: 11 }), R.gridMedia)
            : base;
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
     * @param {Object} [opts]
     * @param {number} [opts.maxLabelLength=30]  Middle-ellipsis cutoff
     */
    C.entities = function (entries, opts) {
        opts = opts || {};
        var maxLen = opts.maxLabelLength || 30;
        var list = entries || [];
        var names = list.map(function (e) { return e.title; });
        var values = list.map(function (e) {
            return { value: e.frequency, o_id: e.o_id };
        });
        var barDef = C._barDefaults('horizontal');

        var base = {
            grid: C._grid({ left: 8, right: 48, top: 8, bottom: 8 }),
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
                axisTick: { show: false },
                axisLabel: {
                    width: 220,
                    overflow: 'truncate',
                    formatter: function (v) { return C._truncate(v, maxLen); }
                }
            },
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: barDef.barMaxWidth - 4,
                itemStyle: barDef.itemStyle,
                label: {
                    show: true,
                    position: 'right',
                    formatter: function (p) { return fmt(p.value); }
                },
                cursor: 'pointer'
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 120, smFontSize: 11 }), R.gridMedia)
            : base;
    };

    /* ----------------------------------------------------------------- */
    /*  Treemap                                                           */
    /* ----------------------------------------------------------------- */

    /**
     * Hierarchical treemap with defensive sanitization. ECharts 6 crashes
     * (`Cannot set properties of undefined (setting '2')`) when:
     *   - levels[] is shorter than the actual tree depth
     *   - non-leaf nodes carry `children: []`
     *   - parents are missing `value`
     *
     * We sanitize the tree and compute `levels` dynamically to match
     * whatever depth the data has.
     *
     * @param {Object} tree { name, children: [...] }
     * @param {Object} [opts]
     * @param {string} [opts.rootName]
     */
    C.treemap = function (tree, opts) {
        opts = opts || {};

        // Sanitize: only leaves carry value, parents only carry children.
        // This sidesteps an ECharts 6 bug in the treemap layout where
        // `upperLabel` on non-leaf levels + value-carrying parents crashes
        // with `Cannot set properties of undefined (setting '2')` in di().
        function sanitize(node, depth, depthRef) {
            if (!node || typeof node !== 'object') return null;
            depthRef.max = Math.max(depthRef.max, depth);
            var kids = node.children;
            if (Array.isArray(kids) && kids.length > 0) {
                var cleanKids = [];
                for (var i = 0; i < kids.length; i++) {
                    var c = sanitize(kids[i], depth + 1, depthRef);
                    if (c) cleanKids.push(c);
                }
                if (cleanKids.length > 0) {
                    return { name: node.name || '', children: cleanKids };
                }
                // kids array was effectively empty → treat as leaf if it has value
            }
            if (node.value != null && Number(node.value) > 0) {
                return { name: node.name || '', value: Number(node.value) };
            }
            return null;
        }

        var depthRef = { max: 0 };
        var sanitized = sanitize(tree || { children: [] }, 0, depthRef);
        var children = (sanitized && sanitized.children) || [];

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
                    leafDepth: 2,
                    breadcrumb: { show: true, bottom: 4 },
                    label: { show: true, formatter: '{b}' },
                    itemStyle: { borderWidth: 1, gapWidth: 2, borderColor: '#fff' },
                    levels: [
                        { itemStyle: { borderWidth: 0, gapWidth: 3 } },
                        { itemStyle: { gapWidth: 2 } },
                        { colorSaturation: [0.35, 0.5], itemStyle: { gapWidth: 1 } }
                    ],
                    data: children
                }
            ]
        };
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
                    emphasis: barDef.emphasis,
                    itemStyle: barDef.itemStyle
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
                emphasis: barDef.emphasis,
                blur: barDef.blur,
                itemStyle: { borderRadius: barDef.itemStyle.borderRadius },
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

    /* ----------------------------------------------------------------- */
    /*  Gantt (custom series — horizontal bars on a time axis)            */
    /* ----------------------------------------------------------------- */

    /**
     * Newspaper coverage Gantt. Each entry is drawn as a horizontal bar
     * from year_min to year_max on the x-axis, with the y-axis indexing
     * by newspaper name. Filtering by country / type is done by the
     * caller BEFORE invoking this builder.
     *
     * @param {Array<Object>} entries
     *   Each: { name, country, type, year_min, year_max, total }
     * @param {Object} [opts]
     */
    C.gantt = function (entries, opts) {
        opts = opts || {};
        var list = (entries || []).slice();
        var names = list.map(function (e) { return e.name; });
        var data = list.map(function (e, i) {
            return {
                value: [i, e.year_min, e.year_max],
                entry: e
            };
        });

        var yearMin = Infinity;
        var yearMax = -Infinity;
        list.forEach(function (e) {
            if (e.year_min != null && e.year_min < yearMin) yearMin = e.year_min;
            if (e.year_max != null && e.year_max > yearMax) yearMax = e.year_max;
        });
        if (!isFinite(yearMin)) yearMin = 1900;
        if (!isFinite(yearMax)) yearMax = new Date().getFullYear();

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var strokeColor = tokens.border ? tokens.border + '36' : 'rgba(0,0,0,0.13)';

        function renderItem(params, api) {
            var yIndex = api.value(0);
            var start = api.coord([api.value(1), yIndex]);
            var end = api.coord([api.value(2) + 1, yIndex]);
            var height = api.size([0, 1])[1] * 0.6;
            var width = Math.max(2, end[0] - start[0]);
            var entry = data[params.dataIndex] && data[params.dataIndex].entry;
            var color = C._countryColor(entry && entry.country);
            return {
                type: 'rect',
                shape: {
                    x: start[0],
                    y: start[1] - height / 2,
                    width: width,
                    height: height,
                    r: 2
                },
                style: { fill: color, stroke: strokeColor }
            };
        }

        var base = {
            grid: C._grid({ left: 8, right: 48, bottom: 48 }),
            tooltip: {
                formatter: function (p) {
                    var entry = (data[p.dataIndex] || {}).entry || {};
                    var lines = [
                        '<strong>' + esc(entry.name || '') + '</strong>',
                        (entry.year_min || '?') + ' \u2013 ' + (entry.year_max || '?')
                    ];
                    if (entry.country) lines.push(esc(entry.country));
                    if (entry.type)    lines.push(t('item_type_' + entry.type));
                    if (entry.total != null) {
                        lines.push(fmt(entry.total) + ' ' + t('items_count', { count: '' }).trim());
                    }
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'value',
                min: yearMin,
                max: yearMax + 1,
                interval: Math.max(1, Math.ceil((yearMax - yearMin) / 10)),
                axisLabel: { formatter: '{value}' },
                name: t('Year'),
                nameLocation: 'middle',
                nameGap: 28
            },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false },
                axisLabel: { width: 160, overflow: 'truncate' }
            },
            dataZoom: list.length > 20 ? [
                { type: 'slider', yAxisIndex: 0, start: 0, end: 100 / Math.max(1, list.length / 20), right: 8 },
                { type: 'inside', yAxisIndex: 0 }
            ] : [],
            series: [{
                type: 'custom',
                renderItem: renderItem,
                encode: { x: [1, 2], y: 0 },
                data: data
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 100 }), R.gridMedia)
            : base;
    };

    /* ----------------------------------------------------------------- */
    /*  Word cloud (requires echarts-wordcloud extension)                 */
    /* ----------------------------------------------------------------- */

    var _wordcloudAvailable = null;

    function isWordCloudAvailable() {
        if (_wordcloudAvailable !== null) return _wordcloudAvailable;
        if (typeof echarts === 'undefined') {
            _wordcloudAvailable = false;
            return false;
        }
        try {
            var probe = document.createElement('div');
            probe.style.width = '40px';
            probe.style.height = '40px';
            probe.style.position = 'absolute';
            probe.style.left = '-9999px';
            document.body.appendChild(probe);
            var tmp = echarts.init(probe);
            tmp.setOption({ series: [{ type: 'wordCloud', data: [{ name: 'a', value: 1 }] }] });
            tmp.dispose();
            document.body.removeChild(probe);
            _wordcloudAvailable = true;
        } catch (e) {
            console.warn('IWACVis.wordcloud: echarts-wordcloud not loaded, falling back', e);
            _wordcloudAvailable = false;
        }
        return _wordcloudAvailable;
    }

    /**
     * French word cloud, ported from ResourceVisualizations'
     * dashboard-charts-wordcloud.js. Uses a shape function that behaves
     * like a rectangle but fills the panel much better than the stock
     * `shape: 'rectangle'` (which collapses everything to a diagonal arc
     * in echarts-wordcloud 2). Size range + grid adapt to the word count;
     * color is randomized from a small palette pulled from the live IWAC
     * theme.
     *
     * @param {Array<[string, number]>} pairs
     * @param {Object} [opts]
     */
    C.wordcloud = function (pairs, opts) {
        opts = opts || {};
        var data = (pairs || []).map(function (pair) {
            return { name: pair[0], value: pair[1] };
        });
        if (!isWordCloudAvailable()) {
            return C.horizontalBar(
                data.slice(0, 20).map(function (d) { return { name: d.name, count: d.value }; }),
                { nameKey: 'name', valueKey: 'count' }
            );
        }

        var count = data.length;
        var minFont = count > 100 ? 10 : count > 50 ? 12 : 14;
        var maxFont = count > 100 ? 56 : count > 50 ? 64 : (count > 10 ? 72 : 88);
        var grid = count > 100 ? 4 : count > 50 ? 6 : 8;

        // Palette pulled from the live IWAC theme when available, with a
        // warm-to-cool default set as fallback. Randomized per-word so the
        // cloud has visual variety instead of one flat colour.
        var palette = (window.IWACVis && window.IWACVis.getPalette && window.IWACVis.getPalette())
            || ['#e67a14', '#c9442a', '#2d6a4f', '#1d4e6b', '#7a3b89', '#8a5a2b', '#4d3a1f'];

        return {
            tooltip: {
                confine: true,
                formatter: function (p) {
                    return '<strong>' + esc(p.name) + '</strong>: ' + fmt(p.value);
                }
            },
            aria: { enabled: true },
            series: [{
                type: 'wordCloud',
                // Inverse-square shape function: behaves as a rectangle but
                // lets the wordcloud layout actually fill the box.
                shape: function (theta) {
                    var cos = Math.abs(Math.cos(theta));
                    var sin = Math.abs(Math.sin(theta));
                    return 1 / Math.max(cos, sin);
                },
                left: 'center',
                top: 'center',
                width: '100%',
                height: '100%',
                right: null,
                bottom: null,
                sizeRange: [minFont, maxFont],
                rotationRange: [-45, 45],
                rotationStep: 15,
                gridSize: grid,
                drawOutOfBound: false,
                shrinkToFit: true,
                layoutAnimation: count <= 100,
                textStyle: {
                    fontFamily: 'sans-serif',
                    fontWeight: 'bold',
                    color: function () {
                        return palette[Math.floor(Math.random() * palette.length)];
                    }
                },
                emphasis: {
                    textStyle: {
                        fontWeight: 'bold',
                        shadowBlur: 10,
                        shadowColor: 'rgba(0,0,0,0.3)'
                    }
                },
                data: data
            }]
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Entity neighbor network (force-directed graph)                    */
    /* ----------------------------------------------------------------- */

    /**
     * Force-layout graph for a center entity + its top-N neighbors.
     *
     * Expected shape (produced by the Python generator):
     *   graph = {
     *     nodes: [
     *       { o_id, title, type, cooc, score }   // nodes[0] is the center
     *       ...
     *     ],
     *     edges: [
     *       { source, target, weight, cooc }
     *       ...
     *     ]
     *   }
     *
     * @param {Object} graph
     * @param {Object} [opts]
     * @param {number} [opts.maxLabelLength=24]   Middle-ellipsis cutoff
     * @param {Object} [opts.typeColors]          { typeName: hex }
     */
    C.network = function (graph, opts) {
        opts = opts || {};
        var maxLen = opts.maxLabelLength || 24;
        var nodes = (graph && graph.nodes) || [];
        var edges = (graph && graph.edges) || [];

        var palette = (ns.getPalette && ns.getPalette())
            || ['#d97706', '#2563eb', '#059669', '#9333ea', '#dc2626', '#0891b2'];
        var TYPE_COLORS = {
            'center':        palette[0],
            'Personnes':     palette[1],
            'Organisations': palette[2],
            'Lieux':         palette[3],
            'Sujets':        palette[4],
            '\u00c9v\u00e9nements': palette[5]
        };
        if (opts.typeColors) {
            for (var k in opts.typeColors) {
                if (Object.prototype.hasOwnProperty.call(opts.typeColors, k)) {
                    TYPE_COLORS[k] = opts.typeColors[k];
                }
            }
        }

        function truncate(name) {
            if (!name || name.length <= maxLen) return name || '';
            var head = Math.floor((maxLen - 1) / 2);
            var tail = maxLen - 1 - head;
            return name.slice(0, head) + '\u2026' + name.slice(-tail);
        }

        var scores = nodes.map(function (n) { return n.score || 0; });
        var maxScore = Math.max.apply(null, scores.concat([1]));
        var weights = edges.map(function (e) { return e.weight || 0; });
        var maxWeight = Math.max.apply(null, weights.concat([1]));

        var graphNodes = nodes.map(function (n, idx) {
            var isCenter = n.type === 'center';
            var normScore = isCenter ? 1 : Math.max(0, Math.min(1, (n.score || 0) / maxScore));
            var symbolSize = isCenter ? 46 : 14 + Math.sqrt(normScore) * 26;
            return {
                id: String(n.o_id),
                name: truncate(n.title || ''),
                fullTitle: n.title || '',
                entityType: n.type,
                o_id: n.o_id,
                cooc: n.cooc,
                score: n.score,
                symbolSize: symbolSize,
                itemStyle: { color: TYPE_COLORS[n.type] || palette[idx % palette.length] },
                fixed: isCenter,
                x: isCenter ? 0 : undefined,
                y: isCenter ? 0 : undefined,
                label: { show: true, position: 'right', formatter: '{b}' }
            };
        });

        var graphEdges = edges.map(function (e) {
            var normWeight = Math.max(0, Math.min(1, (e.weight || 0) / maxWeight));
            return {
                source: String(e.source),
                target: String(e.target),
                value: e.weight,
                cooc: e.cooc,
                lineStyle: {
                    width: 1 + Math.sqrt(normWeight) * 4,
                    opacity: 0.55
                }
            };
        });

        var uniqueTypes = {};
        nodes.forEach(function (n) { if (n.type && n.type !== 'center') uniqueTypes[n.type] = true; });
        var legendData = Object.keys(uniqueTypes).map(function (type) {
            return {
                name: t('entity_type_' + type),
                itemStyle: { color: TYPE_COLORS[type] }
            };
        });

        return {
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        var data = p.data || {};
                        var lines = ['<strong>' + esc(data.fullTitle || '') + '</strong>'];
                        if (data.entityType && data.entityType !== 'center') {
                            lines.push(t('entity_type_' + data.entityType));
                        }
                        if (data.cooc != null) {
                            lines.push(t('mentions_count', { count: fmt(data.cooc) }));
                        }
                        if (data.score != null) {
                            lines.push(t('Distinctiveness score') + ': ' + fmt(Math.round(data.score * 10) / 10));
                        }
                        return lines.join('<br>');
                    }
                    if (p.dataType === 'edge') {
                        var e = p.data || {};
                        return t('mentions_count', { count: fmt(e.cooc || 0) });
                    }
                    return '';
                }
            },
            legend: legendData.length ? [{
                data: legendData,
                top: 4,
                itemWidth: 12,
                itemHeight: 10
            }] : [],
            series: [{
                type: 'graph',
                layout: 'force',
                roam: true,
                draggable: true,
                focusNodeAdjacency: true,
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 3 }
                },
                force: {
                    repulsion: 180,
                    edgeLength: [40, 120],
                    gravity: 0.05
                },
                data: graphNodes,
                links: graphEdges,
                cursor: 'pointer'
            }]
        };
    };
})();
