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
        // Default start: 0 so the full range is visible on load. Users can
        // drag the slider to zoom in. Previous default of 60 hid early years.
        var start = opts.start != null ? opts.start : 0;
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

    /**
     * Build a label config object for outside-bar value labels whose
     * color stays stable through the emphasis (hover) state. ECharts'
     * default `emphasis.label` inherits from the series `itemStyle`,
     * which means bar charts colored with the IWAC primary token
     * render hover labels in the same orange as the bar, disappearing
     * against any orange-tinted background. Forcing both label.color
     * and emphasis.label.color to an ink token decouples the label
     * text color from the bar fill color.
     *
     * @param {string} [position='right']
     * @returns {{color:string, emphasis:{color:string}}}
     *   (emphasis here is not a valid ECharts label child — callers
     *   splat the returned shape into `label` and separately into
     *   `emphasis.label`.)
     */
    C._stableLabelColor = function () {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        return tokens.ink || '#1c232d';
    };

    /**
     * A surface-colored halo around bar-value labels. On hover,
     * ECharts paints the emphasized bar over the adjacent area where
     * the label sits, and when both the bar fill and the text color
     * land on similar luminance (e.g. dark ink on orange), the label
     * can visually disappear. Adding a 2px text stroke in the
     * surface color guarantees a readable gap between glyph and
     * background regardless of what paints under it. Applied to
     * both normal and emphasis label states for consistency.
     */
    C._labelHalo = function () {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        return {
            textBorderColor: tokens.surface || '#fdfcfa',
            textBorderWidth: 2
        };
    };

    /**
     * Returns primitive values (numbers, not objects) so callers can compose
     * them into fresh option literals each call. Sharing object references
     * across series caused hover-state bugs where ECharts mutated the shared
     * itemStyle/emphasis/blur and other series rendered with broken state.
     */
    C._barDefaults = function (direction) {
        var horizontal = direction === 'horizontal';
        return {
            barMaxWidth: horizontal ? 24 : 28,
            borderRadius: horizontal ? [0, 2, 2, 0] : [2, 2, 0, 0]
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
        if (palette.length === 0) palette = ['#d86a11', '#394f68', '#4a8c6f', '#c5504d', '#7c5295', '#d4a574', '#2c5f7c', '#8b6f47'];
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
        var labelInk = C._stableLabelColor();
        var halo = C._labelHalo();

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
                itemStyle: { borderRadius: barDef.borderRadius.slice() },
                label: {
                    show: true,
                    position: 'right',
                    color: labelInk,
                    textBorderColor: halo.textBorderColor,
                    textBorderWidth: halo.textBorderWidth,
                    formatter: function (p) { return fmt(p.value); }
                },
                emphasis: {
                    label: {
                        color: labelInk,
                        textBorderColor: halo.textBorderColor,
                        textBorderWidth: halo.textBorderWidth
                    }
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
                    label: { show: true, fontWeight: 'bold' }
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
        var labelInk = C._stableLabelColor();
        var halo = C._labelHalo();

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
                    if (entry.references)   bits.push(fmt(entry.references) + ' ' + t('References').toLowerCase());
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
                itemStyle: { borderRadius: barDef.borderRadius.slice() },
                label: {
                    show: true,
                    position: 'right',
                    color: labelInk,
                    textBorderColor: halo.textBorderColor,
                    textBorderWidth: halo.textBorderWidth,
                    formatter: function (p) { return fmt(p.value); }
                },
                emphasis: {
                    label: {
                        color: labelInk,
                        textBorderColor: halo.textBorderColor,
                        textBorderWidth: halo.textBorderWidth
                    }
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
        var labelInk = C._stableLabelColor();
        var halo = C._labelHalo();

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
                itemStyle: { borderRadius: barDef.borderRadius.slice() },
                label: {
                    show: true,
                    position: 'right',
                    color: labelInk,
                    textBorderColor: halo.textBorderColor,
                    textBorderWidth: halo.textBorderWidth,
                    formatter: function (p) { return fmt(p.value); }
                },
                emphasis: {
                    label: {
                        color: labelInk,
                        textBorderColor: halo.textBorderColor,
                        textBorderWidth: halo.textBorderWidth
                    }
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
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var surfaceColor = tokens.surface || '#fdfcfa';

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
            series: [{
                type: 'treemap',
                name: opts.rootName || (tree && tree.name) || 'Root',
                roam: false,
                nodeClick: 'zoomToNode',
                leafDepth: 2,
                breadcrumb: { show: true, bottom: 4 },
                label: { show: true, formatter: '{b}' },
                itemStyle: { borderWidth: 1, gapWidth: 2, borderColor: surfaceColor },
                levels: [
                    { itemStyle: { borderWidth: 0, gapWidth: 3, borderColor: surfaceColor } },
                    { itemStyle: { gapWidth: 2, borderColor: surfaceColor } },
                    { colorSaturation: [0.35, 0.5], itemStyle: { gapWidth: 1, borderColor: surfaceColor } }
                ],
                data: children
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
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
        var smMaxFont = Math.round(maxFont * 0.8);

        var palette = (ns.getPalette && ns.getPalette())
            || ['#d86a11', '#c9442a', '#2d6a4f', '#1d4e6b', '#7a3b89', '#8a5a2b', '#4d3a1f'];

        var base = {
            tooltip: {
                confine: true,
                formatter: function (p) {
                    return '<strong>' + esc(p.name) + '</strong>: ' + fmt(p.value);
                }
            },
            aria: { enabled: true },
            series: [{
                type: 'wordCloud',
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
                        shadowBlur: 14,
                        shadowColor: 'rgba(0,0,0,0.4)'
                    }
                },
                data: data
            }]
        };

        var wcMedia = [
            {
                query: { maxWidth: R ? R.BP.sm : 640 },
                option: {
                    series: [{ sizeRange: [minFont, smMaxFont] }]
                }
            }
        ];

        return R && R.withMedia
            ? R.withMedia(base, wcMedia)
            : base;
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

        var scores = nodes.map(function (n) { return n.score || 0; });
        var maxScore = Math.max.apply(null, scores.concat([1]));
        var weights = edges.map(function (e) { return e.weight || 0; });
        var maxWeight = Math.max.apply(null, weights.concat([1]));

        // Build the categories array that ECharts needs for legend
        // toggling. Category 0 is always the centre so it can keep its
        // distinctive palette[0] color; non-centre types get their own
        // category in order of first appearance. Legend data is then
        // built FROM categories[].name, so legend names automatically
        // match series categories — clicking a legend entry toggles
        // all nodes with that category without the panel having to
        // replace the whole option.
        var categoryIndex = { 'center': 0 };
        var categories = [{
            name: t('entity_type_center') || 'Center',
            itemStyle: { color: TYPE_COLORS.center }
        }];
        nodes.forEach(function (n) {
            if (!n.type || n.type === 'center') return;
            if (categoryIndex[n.type] != null) return;
            categoryIndex[n.type] = categories.length;
            categories.push({
                name: t('entity_type_' + n.type),
                itemStyle: { color: TYPE_COLORS[n.type] || palette[categories.length % palette.length] }
            });
        });

        var graphNodes = nodes.map(function (n, idx) {
            var isCenter = n.type === 'center';
            var normScore = isCenter ? 1 : Math.max(0, Math.min(1, (n.score || 0) / maxScore));
            // Make the centre visually unmistakable since we no longer
            // fix its position — size + type color do all the lifting.
            var symbolSize = isCenter ? 56 : 14 + Math.sqrt(normScore) * 28;
            return {
                id: String(n.o_id),
                name: C._truncate(n.title || '', maxLen),
                fullTitle: n.title || '',
                entityType: n.type,
                o_id: n.o_id,
                cooc: n.cooc,
                score: n.score,
                symbolSize: symbolSize,
                category: categoryIndex[n.type] != null ? categoryIndex[n.type] : 0,
                // Intentionally NO `fixed` and NO x/y seed: pinning the
                // centre at (0,0) made the auto-fit asymmetric — nodes
                // clustered around the pin and ECharts couldn't centre
                // the resulting bbox in the viewport. Force layout with
                // an `initLayout: 'circular'` seed (set below) produces
                // a symmetric starting point so the final layout lands
                // in the middle of the panel.
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

        // Legend data = category names excluding the centre, so the
        // centre is always visible but the user can toggle off any
        // type they don't care about. Clicking a legend entry now
        // works because the names are guaranteed to match a category.
        var legendData = categories.slice(1).map(function (c) { return c.name; });

        var base = {
            tooltip: {
                trigger: 'item',
                // Keep the tooltip clamped inside the chart bounds and
                // append it to the chart's host element. Both matter
                // for native fullscreen: the panel becomes the only
                // visible element, so a tooltip that ECharts had
                // appended elsewhere (or positioned outside the chart
                // host's box) renders off-screen. `confine: true` +
                // explicit `appendTo` survive `requestFullscreen()`.
                confine: true,
                appendTo: function (chartEl) { return chartEl; },
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        var nodeData = p.data || {};
                        var lines = ['<strong>' + esc(nodeData.fullTitle || '') + '</strong>'];
                        if (nodeData.entityType && nodeData.entityType !== 'center') {
                            lines.push(t('entity_type_' + nodeData.entityType));
                        }
                        if (nodeData.cooc != null) {
                            lines.push(t('mentions_count', { count: fmt(nodeData.cooc) }));
                        }
                        if (nodeData.score != null) {
                            lines.push(t('Distinctiveness score') + ': ' + fmt(Math.round(nodeData.score * 10) / 10));
                        }
                        return lines.join('<br>');
                    }
                    if (p.dataType === 'edge') {
                        var edgeData = p.data || {};
                        return t('mentions_count', { count: fmt(edgeData.cooc || 0) });
                    }
                    return '';
                }
            },
            legend: legendData.length ? (function () {
                // Theme-aware legend chrome — read tokens at build time so
                // the panel matches IWAC light/dark and the user's CSS
                // overrides without any hardcoded rgba.
                var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
                return [{
                    // Legend data now matches series categories by name,
                    // so ECharts can toggle categories on/off when the
                    // user clicks a legend entry. The old implementation
                    // passed object literals with no series match and
                    // the legend rendered as an empty box.
                    data: legendData,
                    show: opts.showLegend !== false,
                    bottom: 8,
                    left: 'center',
                    orient: 'horizontal',
                    itemWidth: 14,
                    itemHeight: 10,
                    itemGap: 16,
                    padding: [6, 12],
                    backgroundColor: tokens.surface || 'transparent',
                    borderColor: tokens.borderLight || tokens.border || 'transparent',
                    borderWidth: 1,
                    borderRadius: 6,
                    textStyle: { fontSize: 12, color: tokens.inkLight || tokens.ink }
                }];
            })() : [],
            series: [{
                type: 'graph',
                layout: 'force',
                // Reserve room for the bottom legend only when it is
                // actually visible; otherwise the force layout gets the
                // whole panel below the top padding.
                top: 16,
                bottom: opts.showLegend !== false ? 56 : 16,
                left: 16,
                right: 16,
                roam: true,
                draggable: true,
                // Per ECharts docs: clamp zoom so roam button overlays
                // can't scale the graph into oblivion, and shrink node
                // symbols gently as the user zooms in so labels stay
                // readable.
                scaleLimit: { min: 0.25, max: 5 },
                nodeScaleRatio: 0.6,
                focusNodeAdjacency: true,
                labelLayout: { hideOverlap: true },
                // Categories drive the legend. Each entry's name must
                // match the legend.data entries (which we built from
                // the same array), so clicks on the legend toggle the
                // corresponding category without the panel JS having
                // to rebuild the whole option.
                categories: categories,
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 4 },
                    scale: true,
                    scaleSize: 3
                },
                force: {
                    // Circular seed gives force a symmetric starting
                    // point; without it, the jittered random initial
                    // positions + a pinned centre produced asymmetric
                    // layouts that auto-fit couldn't recover from.
                    initLayout: 'circular',
                    repulsion: 220,
                    edgeLength: [60, 140],
                    gravity: 0.08,
                    friction: 0.6,
                    // Disabled so the force simulation runs once,
                    // synchronously, and the final positions are
                    // frozen. Without this the graph re-animates on
                    // every resize / fullscreen / merge-mode setOption
                    // — unsettling edge jumps the user complained
                    // about. ECharts docs explicitly recommend
                    // disabling layoutAnimation for larger graphs.
                    layoutAnimation: false
                },
                data: graphNodes,
                links: graphEdges,
                cursor: 'pointer'
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        var networkMedia = [
            {
                query: { maxWidth: R ? R.BP.sm : 640 },
                option: {
                    series: [{
                        force: {
                            repulsion: 120,
                            edgeLength: [30, 80]
                        }
                    }]
                }
            }
        ];

        return R && R.withMedia
            ? R.withMedia(base, networkMedia)
            : base;
    };

    /* ------------------------------------------------------------------ */
    /*  Segmented bar — single-row horizontal stacked bar                 */
    /* ------------------------------------------------------------------ */

    /**
     * Render an ordered list of {name, count} segments as a single
     * horizontal stacked bar with inside-bar percentage labels and
     * a bottom legend. Reused by the sentiment panel for polarité,
     * centralité, and subjectivité distributions; equally applicable
     * to any other categorical distribution where the user wants to
     * see percentages at a glance instead of absolute counts.
     *
     * Colors are resolved by the caller from CSS variables / theme
     * tokens (NEVER hardcoded hex) and passed in via opts.colors.
     * Display labels are translated via opts.labelFor while the
     * underlying palette still keys on the original segment name —
     * that separation is deliberate so the French data keys keep
     * working when the locale is English.
     *
     * @param {Array<{name:string, count:number}>} segments
     * @param {Object} opts
     * @param {Object<string,string>} opts.colors      segment name → CSS color
     * @param {string}                opts.axisLabel   y-axis row label
     * @param {function(string):string} [opts.labelFor] map raw segment name → display label
     * @param {string}                [opts.fallbackColor] used when a segment is not in opts.colors
     */
    C.segmentedBar = function (segments, opts) {
        opts = opts || {};
        var colors = opts.colors || {};
        var fallback = opts.fallbackColor || '';
        var labelFor = typeof opts.labelFor === 'function'
            ? opts.labelFor
            : function (name) { return name; };
        var total = segments.reduce(function (s, e) { return s + (e.count || 0); }, 0);

        var series = segments.map(function (seg) {
            return {
                name: labelFor(seg.name),
                type: 'bar',
                stack: 'total',
                barMaxWidth: 28,
                data: [seg.count || 0],
                itemStyle: { color: colors[seg.name] || fallback || undefined },
                label: {
                    show: total > 0 && (seg.count / total) >= 0.04,
                    position: 'inside',
                    formatter: function (p) {
                        var pct = total > 0 ? Math.round((p.value / total) * 100) : 0;
                        return pct + '%';
                    },
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600
                },
                emphasis: { focus: 'series' }
            };
        });

        return {
            grid: { top: 10, bottom: 32, left: 90, right: 16, containLabel: false },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    var lines = [];
                    params.forEach(function (p) {
                        var pct = total > 0 ? Math.round((p.value / total) * 100) : 0;
                        lines.push(
                            p.marker + ' ' + esc(p.seriesName) +
                            ': <strong>' + fmt(p.value) + '</strong> (' + pct + '%)'
                        );
                    });
                    return lines.join('<br>');
                }
            },
            legend: {
                bottom: 0,
                itemWidth: 12,
                itemHeight: 10,
                textStyle: { fontSize: 11 }
            },
            xAxis: {
                type: 'value',
                show: false,
                max: total || undefined
            },
            yAxis: {
                type: 'category',
                data: [opts.axisLabel || ''],
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 11 }
            },
            series: series
        };
    };

    /* ------------------------------------------------------------------ */
    /*  Chord — circular pairwise relations                                */
    /* ------------------------------------------------------------------ */

    /**
     * Render a symmetric pairwise matrix as a circular ECharts graph.
     * ECharts has no first-class "chord" series, so this is implemented
     * as `series-graph` with `layout: 'circular'` — every node sits on
     * the perimeter and edge thickness encodes co-occurrence count.
     *
     * @param {{names: string[], matrix: number[][]}} data
     * @param {Object} [opts]
     * @param {number} [opts.minWeight=1] Edges below this are dropped
     */
    C.chord = function (data, opts) {
        opts = opts || {};
        var minWeight = opts.minWeight || 1;
        var names = (data && data.names) || [];
        var matrix = (data && data.matrix) || [];
        var palette = (ns.getPalette && ns.getPalette())
            || ['#d97706', '#2563eb', '#059669', '#9333ea', '#dc2626', '#0891b2'];

        // Pre-compute each row's total so symbol size can normalize
        // against the largest node. Without normalization the
        // variation is swamped when all values are small.
        var rowSums = names.map(function (_, i) {
            return (matrix[i] || []).reduce(function (a, b) { return a + b; }, 0);
        });
        var maxRowSum = rowSums.reduce(function (m, v) { return Math.max(m, v); }, 1);

        var nodes = names.map(function (name, i) {
            // Node radius reflects the row sum (total cooccurrences),
            // normalized so the biggest hub is always ~56px and the
            // smallest participant ~14px regardless of absolute counts.
            var rowSum = rowSums[i];
            var norm = maxRowSum > 0 ? rowSum / maxRowSum : 0;
            return {
                id: String(i),
                name: C._truncate(name, 28),
                fullName: name,
                value: rowSum,
                symbolSize: 14 + Math.sqrt(norm) * 42,
                itemStyle: { color: palette[i % palette.length] }
            };
        });

        // Build undirected edges (i < j only) so each pair counts once.
        var maxWeight = 1;
        var rawEdges = [];
        for (var i = 0; i < names.length; i++) {
            for (var j = i + 1; j < names.length; j++) {
                var w = (matrix[i] && matrix[i][j]) || 0;
                if (w >= minWeight) {
                    if (w > maxWeight) maxWeight = w;
                    rawEdges.push({ source: String(i), target: String(j), value: w });
                }
            }
        }
        var edges = rawEdges.map(function (e) {
            var norm = Math.max(0, Math.min(1, e.value / maxWeight));
            return {
                source: e.source,
                target: e.target,
                value: e.value,
                lineStyle: {
                    width: 1 + Math.sqrt(norm) * 5,
                    opacity: 0.55,
                    curveness: 0.3
                }
            };
        });

        var base = {
            tooltip: {
                trigger: 'item',
                // See the network tooltip above for why both options
                // matter when the panel enters native fullscreen.
                confine: true,
                appendTo: function (chartEl) { return chartEl; },
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        return '<strong>' + esc(p.data.fullName || '') + '</strong><br>' +
                               (t('Total') + ': ' + fmt(p.data.value));
                    }
                    if (p.dataType === 'edge') {
                        var srcIdx = parseInt(p.data.source, 10);
                        var tgtIdx = parseInt(p.data.target, 10);
                        return '<strong>' + esc(names[srcIdx] || '') + '</strong><br>' +
                               '<strong>' + esc(names[tgtIdx] || '') + '</strong><br>' +
                               t('mentions_count', { count: fmt(p.data.value) });
                    }
                    return '';
                }
            },
            series: [{
                type: 'graph',
                layout: 'circular',
                circular: { rotateLabel: true },
                top: 40,
                bottom: 40,
                left: 40,
                right: 40,
                roam: true,
                draggable: false,
                focusNodeAdjacency: true,
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 6 }
                },
                label: {
                    show: true,
                    position: 'right',
                    formatter: '{b}',
                    fontSize: 11
                },
                data: nodes,
                links: edges,
                cursor: 'pointer'
            }],
            animationDuration: 600
        };
        return base;
    };

    /* ------------------------------------------------------------------ */
    /*  Author collaboration network (force-directed, edge-typed)         */
    /* ------------------------------------------------------------------ */

    /**
     * Force-directed graph of authors that collaborated on the same
     * references. Distinct from `C.network` (which is the ego-centric
     * entity dashboard graph): every node here is an author, and edges
     * carry a `type` field with three valid values:
     *
     *   - `coauthor`        — two authors signed the same reference
     *   - `author_editor`   — one author signed a reference whose
     *                          editor is the other person
     *   - `both`            — the same pair appears both as co-authors
     *                          on one reference and as author/editor
     *                          on another
     *
     * Each type renders with a distinct edge color (and the legend
     * lets the user toggle them) so the user can see at a glance
     * whether a tight cluster is a co-author clique, an editor with
     * many contributors, or a mixed group. Node radius reflects the
     * number of references the person appears on.
     *
     * @param {{ nodes: Array<{id, name, value, kind}>, edges: Array<{source, target, weight, type}> }} graph
     * @param {Object} [opts]
     * @param {number} [opts.maxLabelLength=24]   Middle-ellipsis cutoff
     * @param {boolean} [opts.showLegend=true]
     */
    C.collaborationNetwork = function (graph, opts) {
        opts = opts || {};
        var maxLen = opts.maxLabelLength || 24;
        var nodes = (graph && graph.nodes) || [];
        var edges = (graph && graph.edges) || [];

        var palette = (ns.getPalette && ns.getPalette())
            || ['#d86a11', '#2563eb', '#059669', '#9333ea', '#dc2626', '#0891b2'];

        // Edge color per collaboration type. Categories are also exposed
        // via a `categories` array on the graph series so ECharts can
        // build a working legend for edge filtering.
        var EDGE_COLORS = {
            'coauthor':      palette[1],   // blue
            'author_editor': palette[2],   // green
            'both':          palette[0]    // primary orange
        };

        // Node sizing — sqrt scale against the max reference count so
        // the most prolific authors stand out without dwarfing the rest.
        var maxValue = 1;
        nodes.forEach(function (n) { if (n.value > maxValue) maxValue = n.value; });
        var maxWeight = 1;
        edges.forEach(function (e) { if (e.weight > maxWeight) maxWeight = e.weight; });

        var graphNodes = nodes.map(function (n) {
            var norm = Math.max(0, Math.min(1, (n.value || 0) / maxValue));
            return {
                id: String(n.id),
                name: C._truncate(n.name || '', maxLen),
                fullTitle: n.name || '',
                value: n.value || 0,
                symbolSize: 8 + Math.sqrt(norm) * 28,
                itemStyle: { color: palette[0] },
                label: {
                    // Only label the top hubs at rest; everything else
                    // shows on hover via emphasis. Without this guard a
                    // 180-node graph turns into a wall of text.
                    show: norm > 0.45,
                    position: 'right',
                    formatter: '{b}',
                    fontSize: 10
                }
            };
        });

        var graphEdges = edges.map(function (e) {
            var norm = Math.max(0, Math.min(1, (e.weight || 0) / maxWeight));
            return {
                source: String(e.source),
                target: String(e.target),
                value: e.weight,
                edgeType: e.type,
                lineStyle: {
                    width: 1 + Math.sqrt(norm) * 5,
                    opacity: 0.6,
                    color: EDGE_COLORS[e.type] || palette[0],
                    curveness: 0.15
                }
            };
        });

        // Static legend swatches — three colored chips so the user can
        // read the edge types without ECharts' graph-series legend (which
        // doesn't natively expose per-edge categories).
        var legend = opts.showLegend !== false ? [{
            show:   true,
            bottom: 8,
            left:   'center',
            orient: 'horizontal',
            itemWidth:  14,
            itemHeight: 10,
            itemGap:    16,
            data: [
                { name: t('Co-author'),       icon: 'roundRect', itemStyle: { color: EDGE_COLORS['coauthor'] } },
                { name: t('Author / editor'), icon: 'roundRect', itemStyle: { color: EDGE_COLORS['author_editor'] } },
                { name: t('Mixed'),           icon: 'roundRect', itemStyle: { color: EDGE_COLORS['both'] } }
            ],
            // The legend entries don't toggle anything here — they're
            // pure swatches. Selected mode is set so the click handler
            // doesn't try to hide non-existent series.
            selectedMode: false
        }] : [];

        return {
            tooltip: {
                trigger: 'item',
                confine: true,
                appendTo: function (chartEl) { return chartEl; },
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        var d = p.data || {};
                        return '<strong>' + esc(d.fullTitle || '') + '</strong><br>'
                             + t('references_count', { count: fmt(d.value || 0) });
                    }
                    if (p.dataType === 'edge') {
                        var typeLabel;
                        if (p.data.edgeType === 'coauthor') typeLabel = t('Co-author');
                        else if (p.data.edgeType === 'author_editor') typeLabel = t('Author / editor');
                        else typeLabel = t('Mixed');
                        return '<strong>' + esc(p.data.source) + '</strong>'
                             + ' \u2194 '
                             + '<strong>' + esc(p.data.target) + '</strong><br>'
                             + typeLabel + '<br>'
                             + t('Shared references') + ': ' + fmt(p.data.value || 0);
                    }
                    return '';
                }
            },
            legend: legend,
            series: [{
                type: 'graph',
                layout: 'force',
                top: 16,
                bottom: opts.showLegend !== false ? 56 : 16,
                left: 16,
                right: 16,
                roam: true,
                draggable: true,
                scaleLimit: { min: 0.25, max: 5 },
                nodeScaleRatio: 0.6,
                focusNodeAdjacency: true,
                labelLayout: { hideOverlap: true },
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 4, opacity: 0.9 },
                    label: { show: true },
                    scale: true
                },
                force: {
                    initLayout: 'circular',
                    repulsion: 200,
                    edgeLength: [60, 140],
                    gravity: 0.08,
                    friction: 0.6,
                    // Disabled so the simulation runs once and freezes —
                    // the same trick C.network uses to avoid edge jumps
                    // on every resize / fullscreen toggle.
                    layoutAnimation: false
                },
                data: graphNodes,
                links: graphEdges,
                cursor: 'pointer'
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
    };

    /* ------------------------------------------------------------------ */
    /*  Sankey — flow diagram                                              */
    /* ------------------------------------------------------------------ */

    /**
     * Standard ECharts sankey wrapper.
     * @param {{nodes: {name:string}[], links: {source:string,target:string,value:number}[]}} data
     */
    C.sankey = function (data, opts) {
        opts = opts || {};
        var nodes = (data && data.nodes) || [];
        var links = (data && data.links) || [];
        return {
            tooltip: {
                trigger: 'item',
                triggerOn: 'mousemove',
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        return esc(p.data.name) + ': ' + fmt(p.value || 0);
                    }
                    return esc(p.data.source) + ' \u2192 ' + esc(p.data.target) +
                        '<br>' + fmt(p.data.value || 0);
                }
            },
            series: [{
                type: 'sankey',
                top: 16,
                bottom: 16,
                left: 16,
                right: 80,
                data: nodes,
                links: links,
                emphasis: { focus: 'adjacency' },
                lineStyle: { color: 'gradient', curveness: 0.5 },
                label: { fontSize: 11 },
                nodeAlign: opts.nodeAlign || 'justify'
            }]
        };
    };

    /* ------------------------------------------------------------------ */
    /*  Sunburst — hierarchical pie                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Standard ECharts sunburst wrapper.
     * @param {{name:string, value?:number, children?:Array}[]} tree Root children
     */
    C.sunburst = function (tree, opts) {
        opts = opts || {};
        return {
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    return esc(p.name) + ': ' + fmt(p.value || 0);
                }
            },
            series: [{
                type: 'sunburst',
                radius: ['10%', '95%'],
                data: tree || [],
                label: {
                    rotate: 'radial',
                    minAngle: 8,
                    fontSize: 11
                },
                emphasis: { focus: 'ancestor' },
                levels: opts.levels || [
                    {},
                    { r0: '10%', r: '40%', label: { rotate: 0 } },
                    { r0: '40%', r: '70%' },
                    { r0: '70%', r: '95%' }
                ]
            }]
        };
    };

    /* ------------------------------------------------------------------ */
    /*  Beeswarm — jittered scatter on a single axis                       */
    /* ------------------------------------------------------------------ */

    /**
     * Beeswarm/strip plot. Each point is positioned on the value axis
     * with a small deterministic Y jitter so overlapping points spread
     * out vertically. Useful for showing distributions without the
     * smoothing of a histogram.
     *
     * @param {{value:number, label?:string, group?:string}[]} points
     * @param {Object} [opts]
     * @param {string} [opts.xAxisName] Axis label
     */
    C.beeswarm = function (points, opts) {
        opts = opts || {};
        // Deterministic jitter so pan/zoom doesn't reshuffle the swarm.
        function jitter(i) {
            var x = Math.sin(i * 12.9898) * 43758.5453;
            return (x - Math.floor(x) - 0.5) * 0.8;
        }
        var data = (points || []).map(function (p, i) {
            return {
                value: [p.value, jitter(i)],
                name: p.label || '',
                group: p.group || ''
            };
        });
        return {
            grid: C._grid({ top: 16, bottom: 32, left: 32, right: 16 }),
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var d = p.data || {};
                    return (d.name ? '<strong>' + esc(d.name) + '</strong><br>' : '') +
                        fmt(d.value[0]);
                }
            },
            xAxis: {
                type: 'value',
                name: opts.xAxisName || '',
                nameLocation: 'middle',
                nameGap: 24
            },
            yAxis: {
                type: 'value',
                show: false,
                min: -1,
                max: 1
            },
            series: [{
                type: 'scatter',
                data: data,
                symbolSize: 9,
                itemStyle: { opacity: 0.7 }
            }]
        };
    };

    /* ------------------------------------------------------------------ */
    /*  Heatmap — year × month calendar grid                               */
    /* ------------------------------------------------------------------ */

    /**
     * Discrete year × month heatmap, calendar-style: years run along
     * the x-axis (time flows left → right) and months stack along the
     * y-axis (12 fixed rows regardless of year range). Cells come in
     * as ``[year_index, month_index, count]`` triples which maps
     * directly to ECharts' ``[xIdx, yIdx, value]`` convention with
     * those axes.
     *
     * Colors are read from IWAC theme tokens via getChartTokens so the
     * ramp follows --primary and flips for dark mode.
     *
     * @param {{years:number[], months:number[], cells:Array}} data
     */
    C.heatmap = function (data, opts) {
        opts = opts || {};
        var years = (data && data.years) || [];
        var cells = (data && data.cells) || [];
        var monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (ns.locale === 'fr') {
            monthLabels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
                           'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
        }
        var max = 1;
        cells.forEach(function (c) { if (c[2] > max) max = c[2]; });

        // Theme-aware color ramp: the dedicated semantic palette is
        // defined in iwac-core.css (--iwac-vis-heatmap-0..4)
        // as `color-mix(in srgb, var(--primary), var(--surface))` stops
        // so it tracks the IWAC theme's --primary and --surface tokens.
        // We MUST resolve through ns.resolveCssVar (an offscreen probe)
        // rather than getPropertyValue: ECharts' color parser does not
        // understand CSS color-mix() and would fall back to grayscale.
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var resolve = ns.resolveCssVar || function () { return ''; };
        var heatStops = [
            resolve('--iwac-vis-heatmap-0'),
            resolve('--iwac-vis-heatmap-1'),
            resolve('--iwac-vis-heatmap-2'),
            resolve('--iwac-vis-heatmap-3'),
            resolve('--iwac-vis-heatmap-4')
        ].filter(Boolean);
        // Fallback ramp if CSS vars aren't resolvable (theme not loaded):
        // still routed through the base tokens so no hex literals ever
        // appear in this file.
        if (heatStops.length < 2) {
            heatStops = [tokens.surface || '', tokens.primary || ''].filter(Boolean);
        }

        return {
            tooltip: {
                position: 'top',
                formatter: function (p) {
                    var year = years[p.data[0]];
                    var month = monthLabels[p.data[1]];
                    return '<strong>' + month + ' ' + year + '</strong><br>' +
                        t('mentions_count', { count: fmt(p.data[2]) });
                }
            },
            grid: C._grid({ top: 24, bottom: 40, left: 64, right: 72 }),
            xAxis: {
                type: 'category',
                data: years.map(String),
                // Auto-skip labels when many years crowd the x axis
                axisLabel: { interval: 'auto', fontSize: 10 },
                splitArea: { show: true },
                axisTick: { show: false }
            },
            yAxis: {
                type: 'category',
                data: monthLabels,
                axisLabel: { fontSize: 10 },
                splitArea: { show: true },
                axisTick: { show: false }
            },
            visualMap: {
                min: 0,
                max: max,
                calculable: true,
                orient: 'vertical',
                right: 4,
                top: 'middle',
                itemHeight: 120,
                itemWidth: 12,
                textStyle: { fontSize: 10 },
                inRange: {
                    color: heatStops
                }
            },
            series: [{
                type: 'heatmap',
                data: cells,
                label: { show: false },
                emphasis: {
                    itemStyle: {
                        borderColor: tokens.ink || '#1c232d',
                        borderWidth: 2
                    }
                }
            }]
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Scary terms — horizontal bar with per-term colors                 */
    /* ----------------------------------------------------------------- */

    /**
     * Horizontal top-N bar chart for the Scary Terms block. Unlike
     * ``C.horizontalBar``, this builder takes ``[[term, count], ...]``
     * pairs (the raw shape produced by generate_scary_terms.py), applies a
     * stable per-term color from the caller-supplied map, and optionally
     * pins the x-axis to a fixed max so the bar chart race is visually
     * comparable across years.
     *
     * @param {Object} cfg
     * @param {Array<Array>}        cfg.entries     [[term, count], ...] sorted desc
     * @param {Object<string,string>} cfg.termColors Stable term → color map
     * @param {number}              [cfg.fixedMax]  Pin x-axis to this max
     * @param {number}              [cfg.maxLabelLength=28]
     */
    C.scaryTerms = function (cfg) {
        cfg = cfg || {};
        var entries = cfg.entries || [];
        var termColors = cfg.termColors || {};
        var maxLen = cfg.maxLabelLength || 28;

        var terms = entries.map(function (e) { return e[0]; });
        var values = entries.map(function (e) {
            return {
                value: e[1],
                itemStyle: { color: termColors[e[0]] || undefined }
            };
        });

        var barDef = C._barDefaults('horizontal');
        var labelInk = C._stableLabelColor();
        var xAxis = { type: 'value', axisLabel: { formatter: function (v) { return fmt(v); } } };
        if (cfg.fixedMax != null) {
            xAxis.max = cfg.fixedMax;
        }

        var base = {
            grid: C._grid({ left: 8, right: 56, top: 8, bottom: 8 }),
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    return '<strong>' + esc(terms[p.dataIndex] || '') + '</strong><br>' +
                           t('mentions_count', { count: fmt(p.value || 0) });
                }
            },
            xAxis: xAxis,
            yAxis: {
                type: 'category',
                data: terms,
                inverse: true,
                axisTick: { show: false },
                axisLabel: {
                    width: 160,
                    overflow: 'truncate',
                    formatter: function (v) { return C._truncate(v, maxLen); }
                }
            },
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: barDef.barMaxWidth + 4,
                itemStyle: { borderRadius: barDef.borderRadius.slice() },
                label: {
                    show: true,
                    position: 'right',
                    color: labelInk,
                    formatter: function (p) { return fmt(p.value); }
                },
                emphasis: { disabled: true },
                animationDurationUpdate: 800,
                animationEasingUpdate: 'cubicOut'
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 120, smFontSize: 11 }), R.gridMedia)
            : base;
    };
})();
