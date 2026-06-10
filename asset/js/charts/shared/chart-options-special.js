/**
 * IWAC Visualizations — Shared ECharts option builders (pie, hierarchical, scatter, heatmap, wordcloud)
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
    /*  Treemap                                                           */
    /* ----------------------------------------------------------------- */

    /**
     * Hierarchical, fully-nested treemap. Every level renders at once \u2014
     * parent groups carry a tinted header bar (`upperLabel`) and leaves
     * are saturation-shaded tints of their ancestor, so the structure
     * (country \u203a type \u203a source) reads on first sight instead of behind a
     * `leafDepth` drill-down. Clicking a parent still zooms into it; the
     * breadcrumb climbs back out.
     *
     * Defensive sanitization is preserved \u2014 ECharts 6 crashes
     * (`Cannot set properties of undefined (setting '2')`) when:
     *   - levels[] is shorter than the actual tree depth
     *   - non-leaf nodes carry `children: []`
     *   - parents are missing `value`
     *
     * We sanitize the tree, track its depth, and build exactly
     * `maxDepth + 1` `levels` entries so the array can never be too short
     * for the rendered depth.
     *
     * @param {Object} tree { name, children: [...] }
     * @param {Object} [opts]
     * @param {string} [opts.rootName]
     */
    C.treemap = function (tree, opts) {
        opts = opts || {};
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var surfaceColor  = tokens.surface       || '#fdfdfd';
        var surfaceRaised = tokens.surfaceRaised  || surfaceColor;
        var inkLight      = tokens.inkLight       || '#535862';
        var borderColor   = tokens.border         || '#d4d6da';
        var fontFamily    = tokens.fontFamily     || 'sans-serif';

        // Abbreviate big counts for in-tile labels (4804 -> "4.8K"); the
        // tooltip still carries the exact figure via `fmt`.
        function shortNum(n) {
            n = Number(n) || 0;
            if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
            if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
            return String(n);
        }

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
        var maxDepth = Math.max(1, depthRef.max);

        // Per-depth styling. ECharts indexes `levels` from the root (0)
        // down and THROWS when the array is shorter than the rendered
        // depth \u2014 so emit exactly `maxDepth + 1` entries.
        //
        //   depth 0          root container \u2014 no header, widest gaps
        //   1 .. maxDepth-1  parent groups \u2014 tinted header bar (upperLabel)
        //   maxDepth         leaves \u2014 saturation-shaded colour tiles
        //
        // The first visible level (countries / top categories) keeps its
        // distinct palette hue; only depth >= 2 is saturation-shaded so
        // descendants read as tints of their ancestor.
        var levels = [];
        for (var d = 0; d <= maxDepth; d++) {
            var isRoot = d === 0;
            var isLeaf = d === maxDepth;
            var level = {
                upperLabel: { show: !isRoot && !isLeaf },
                itemStyle: {
                    borderColor: surfaceColor,
                    borderWidth: isRoot ? 0 : 1,
                    gapWidth: isRoot ? 4 : 2
                }
            };
            if (d >= 2) {
                var hi = Math.max(0.34, 0.58 - (d - 2) * 0.1);
                level.colorSaturation = [Math.max(0.2, hi - 0.16), hi];
            }
            levels.push(level);
        }

        // Flat depth-1 trees (e.g. the topic treemap) have no parent level
        // to label, so the header bar stays off there.
        var hasHeaders = maxDepth >= 2;

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
                left: 2, top: 2, right: 2, bottom: 26,
                breadcrumb: {
                    show: true,
                    bottom: 4,
                    height: 20,
                    emptyItemWidth: 18,
                    itemStyle: {
                        color: surfaceRaised,
                        borderColor: borderColor,
                        borderWidth: 1,
                        textStyle: { color: inkLight, fontFamily: fontFamily }
                    },
                    emphasis: { itemStyle: { color: borderColor } }
                },
                // Leaf labels: name over abbreviated count, anchored
                // top-left. White text + a soft dark halo stays legible
                // across every tile hue (light tan through saturated orange).
                label: {
                    show: true,
                    position: 'insideTopLeft',
                    overflow: 'truncate',
                    lineHeight: 15,
                    padding: [3, 4, 0, 4],
                    formatter: function (p) {
                        return '{n|' + p.name + '}\n{v|' + shortNum(p.value) + '}';
                    },
                    rich: {
                        n: {
                            fontFamily: fontFamily, fontSize: 12, color: '#fff',
                            textBorderColor: 'rgba(0, 0, 0, 0.34)', textBorderWidth: 2
                        },
                        v: {
                            fontFamily: fontFamily, fontSize: 11, color: 'rgba(255, 255, 255, 0.82)',
                            textBorderColor: 'rgba(0, 0, 0, 0.30)', textBorderWidth: 2,
                            padding: [1, 0, 0, 0]
                        }
                    }
                },
                // Parent headers: bold name + abbreviated count on the
                // group's own tinted bar.
                upperLabel: {
                    show: hasHeaders,
                    height: 22,
                    overflow: 'truncate',
                    fontFamily: fontFamily,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#fff',
                    textBorderColor: 'rgba(0, 0, 0, 0.32)',
                    textBorderWidth: 2,
                    formatter: function (p) {
                        return p.name + '   ' + shortNum(p.value);
                    }
                },
                itemStyle: { borderColor: surfaceColor, borderWidth: 1, gapWidth: 2 },
                emphasis: { upperLabel: { color: '#fff' } },
                levels: levels,
                data: children
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
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
        // modifyAlpha rather than string-concat an '36' hex-alpha suffix —
        // the latter only worked for hex tokens and silently broke the
        // stroke (producing e.g. `rgb(210,213,203)36`, an invalid color)
        // once iwac-theme.js started emitting rgb() via the probe-based
        // resolver. 0.21 ≈ 21% matches the previous `36` hex alpha.
        var strokeColor = (tokens.border && echarts && echarts.color && echarts.color.modifyAlpha)
            ? echarts.color.modifyAlpha(tokens.border, 0.21)
            : 'rgba(0,0,0,0.13)';

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

        // On phones the value x-axis crowds ~10 year ticks into ~330px and
        // R.gridMedia's bottom:24 dropped the "Year" name into the bars.
        // Custom media: ~5 year ticks (interval /5 instead of /10), smaller
        // font, and a bottom gutter that keeps the axis name clear.
        var ganttMedia = [{
            query: { maxWidth: R ? R.BP.sm : 640 },
            option: {
                grid: { left: 8, right: 14, top: 8, bottom: 44, containLabel: true },
                xAxis: {
                    interval: Math.max(1, Math.ceil((yearMax - yearMin) / 5)),
                    nameGap: 24,
                    axisLabel: { fontSize: 10 }
                }
            }
        }];

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 100 }), ganttMedia)
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
            || ['#e64a19', '#c9442a', '#2d6a4f', '#394f68', '#7a3b89', '#8a5a2b', '#4d3a1f'];

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

        // Pick theme-aware text colors so the y-axis label and legend
        // remain readable when the chart inherits the dark ECharts theme.
        // ECharts' merge semantics: setting `axisLabel: {fontSize: 11}`
        // shouldn't clobber the theme's color, but in practice some panels
        // re-init outside the standard theme scope. Setting color
        // explicitly here is defensive.
        var themeTokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var isDark = ns.getCurrentTheme && ns.getCurrentTheme() === 'dark';
        var labelInk      = themeTokens.ink      || (isDark ? '#e7e4df' : '#2c2f37');
        var labelInkLight = themeTokens.inkLight || (isDark ? '#b5b0aa' : '#535862');

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
                textStyle: { fontSize: 11, color: labelInkLight }
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
                axisLabel: { fontSize: 11, color: labelInk, fontWeight: 600 }
            },
            series: series
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
        // as `color-mix(in oklab, var(--primary), var(--surface))` stops
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
                        borderColor: tokens.ink || '#2c2f37',
                        borderWidth: 2
                    }
                }
            }]
        };
    };
})();
