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
    /*  Label-ink contrast helpers (treemap)                              */
    /* ----------------------------------------------------------------- */

    /** Parse any ECharts-accepted colour string to [r,g,b], or null. */
    function _rgb(color) {
        if (typeof color !== 'string' || !color) return null;
        if (typeof echarts !== 'undefined' && echarts.color && echarts.color.parse) {
            var p = echarts.color.parse(color);
            if (p) return [p[0], p[1], p[2]];
        }
        return null;
    }

    /** WCAG relative luminance of an [r,g,b] triple. */
    function _relLum(rgb) {
        var c = [];
        for (var i = 0; i < 3; i++) {
            var v = rgb[i] / 255;
            c.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
        }
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }

    /** WCAG contrast ratio between two [r,g,b] triples. */
    function _contrast(a, b) {
        var la = _relLum(a);
        var lb = _relLum(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    /** AA for body-size text. The floor for anything drawn as glyphs. */
    var TEXT_CONTRAST_MIN = 4.5;

    /**
     * The series-palette slots that may be used as TEXT on `backdrop`, in
     * palette order.
     *
     * The categorical scale is built for filled marks — a bar carries its
     * meaning at any luminance, and only its label has to be readable. Glyphs
     * are the mark, so a slot that is fine as a 40px bar can be illegible as
     * 12px type: measured against the light panel, 13 of the 20 slots sit
     * under 4.5:1, and against the dark panel a different 5 do. There is no
     * single subset that works in both.
     *
     * So it is computed, per theme, per call — never listed. A hardcoded list
     * would be correct exactly until the next palette edit, and would then be
     * wrong silently, which is the failure mode this whole module's token
     * guards exist to prevent. Falls back to the ink token when nothing
     * qualifies (degraded mode with no resolvable tokens), because
     * monochrome-and-readable beats varied-and-not.
     *
     * @param {string} backdrop  resolved background colour of the host
     * @param {string} [ink]     fallback when no slot qualifies
     * @returns {Array<string>} at least one colour
     */
    C.readableInks = function (backdrop, ink) {
        var bg = _rgb(backdrop);
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var out = bg ? palette.filter(function (c) {
            var rgb = _rgb(c);
            return rgb && _contrast(rgb, bg) >= TEXT_CONTRAST_MIN;
        }) : [];
        return out.length ? out : [ink || (palette.length ? palette[0] : '#13161c')];
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
            }]
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
     * @param {function(string): string} [opts.colorFor]
     *   Fixes the colour of each FIRST-LEVEL node by name. Without it ECharts
     *   cycles the palette in tree order, so a country's colour here depended
     *   on where it happened to sort — a fourth grammar for the same six
     *   countries on a page that already had three. Pass `C._countryColor`
     *   whenever the top level is countries. Deeper levels stay
     *   saturation-shaded tints of their ancestor, which is what makes the
     *   nesting readable, so the fix stops at depth 1 by design.
     */
    C.treemap = function (tree, opts) {
        opts = opts || {};
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var surfaceColor  = tokens.surface       || '#fdfdfd';
        var surfaceRaised = tokens.surfaceRaised  || surfaceColor;
        var inkLight      = tokens.inkLight       || '#535862';
        var borderColor   = tokens.border         || '#d4d6da';
        var fontFamily    = tokens.fontFamily     || 'sans-serif';

        // Label ink is chosen PER TILE, from the two token-resolved extremes
        // the theme already gives us. Tiles are ECharts' own colours — the
        // series palette at the first visible level, saturation-shaded tints
        // below it — and they land mid-tone in BOTH themes (measured: #eb663d,
        // #ce4115, #597ca3, #73b598), so no single label colour clears 4.5:1
        // everywhere. A flat '#fff' (what this used to hardcode) measured
        // 3.15:1 on #eb663d and 1.02:1 where the tile grid thins out to
        // surface; a flat ink token would fail the deep slates just as badly.
        //
        // `surface` is the knockout colour (near-white in light, near-black in
        // dark) and `inkStrong` is its opposite in both — so picking whichever
        // wins on contrast needs no light/dark branch, and re-themes for free
        // when the render callback re-runs on toggle.
        var knockout = tokens.surface   || '#fdfcfb';
        var deepInk  = tokens.inkStrong || '#05070c';
        var koRgb    = _rgb(knockout);
        var deepRgb  = _rgb(deepInk);

        // Memoised: the formatters run once per node and tiles repeat hues.
        var inkCache = {};
        function inkFor(tileColor) {
            if (!koRgb || !deepRgb) return '';
            var hit = inkCache[tileColor];
            if (hit !== undefined) return hit;
            var tile = _rgb(tileColor);
            var pick = (tile && _contrast(deepRgb, tile) > _contrast(koRgb, tile)) ? 'd' : '';
            inkCache[tileColor] = pick;
            return pick;
        }

        // A 2px stroke in the OPPOSITE extreme. It buys no WCAG credit (the
        // ratios above are glyph-vs-tile) but it keeps 12px text crisp on the
        // mid-tones where the two candidates run close.
        function halo(deep) {
            var base = deep ? knockout : deepInk;
            var alpha = deep ? 0.45 : 0.34;
            return (typeof echarts !== 'undefined' && echarts.color && echarts.color.modifyAlpha)
                ? echarts.color.modifyAlpha(base, alpha)
                : (deep ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.34)');
        }
        function leafInk(deep, size, pad) {
            var style = {
                fontFamily: fontFamily, fontSize: size,
                color: deep ? deepInk : knockout,
                textBorderColor: halo(deep), textBorderWidth: 2
            };
            if (pad) style.padding = pad;
            return style;
        }
        function headerInk(deep) {
            var style = leafInk(deep, 12);
            style.fontWeight = 600;
            style.overflow = 'truncate';
            return style;
        }
        // Group headers all share one backdrop — the border strip — so their
        // ink is decided once rather than per node.
        var headerKey = inkFor(surfaceColor);

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

        /**
         * Colour the whole tree explicitly: first level from the caller's map
         * (or the series palette in order, which is what ECharts would have
         * done), every level below it a tint of its ancestor MIXED TOWARD THE
         * SURFACE.
         *
         * The direction is the point. ECharts' `colorSaturation` ramp — what
         * this used to lean on — moves descendants toward MID luminance from
         * whichever end their parent sits at: in light the slate ran
         * #394f68 → #587aa1 (getting lighter), in dark it ran #708093 →
         * #5f6e7e (getting darker), and both converge on L≈0.45. That is the
         * crossover band where neither ink extreme clears 4.5:1, which is why
         * the contrast-PICKED ink of 1.51.0 still left five dark tiles at
         * 4.29-4.49:1 (measured on the rig, not the token hexes — ECharts
         * shades what it draws). Mixing toward `--surface` instead moves every
         * descendant away from the band in BOTH themes: paler on a light page,
         * deeper on a dark one, and the ink that was already winning wins by
         * more. Same visual grammar — descendants read as tints of their
         * ancestor — opposite luminance direction.
         *
         * This is the treemap's form of the rule the token guard enforces in
         * CSS: never build a ramp on a value that does not flip with the
         * theme.
         */
        var seriesPalette = (ns.getPalette && ns.getPalette()) || [];
        function mixToward(color, target, t) {
            var a = _rgb(color);
            var b = _rgb(target);
            if (!a || !b) return color;
            return 'rgb(' + [0, 1, 2].map(function (i) {
                return Math.round(a[i] + (b[i] - a[i]) * t);
            }).join(', ') + ')';
        }
        function paint(node, depth, base) {
            // Every level is mixed from the FIRST-level colour, never from the
            // level above it — compounding the mix would wash level 3 out to
            // the surface itself.
            // 0.20 per level: enough to separate three levels, mild enough
            // that a leaf still reads as its country's colour.
            var color = depth === 1
                ? base
                : mixToward(base, surfaceColor, Math.min(0.6, 0.2 * (depth - 1)));
            var out = { name: node.name };
            if (color) out.itemStyle = { color: color };
            if (node.value != null) out.value = node.value;
            if (node.children) {
                out.children = node.children.map(function (kid) {
                    return paint(kid, depth + 1, base);
                });
            }
            return out;
        }
        children = children.map(function (node, i) {
            var base = (typeof opts.colorFor === 'function' && opts.colorFor(node.name))
                || seriesPalette[i % (seriesPalette.length || 1)];
            return paint(node, 1, base);
        });

        // Per-depth styling. ECharts indexes `levels` from the root (0)
        // down and THROWS when the array is shorter than the rendered
        // depth \u2014 so emit exactly `maxDepth + 1` entries.
        //
        //   depth 0          root container \u2014 no header, widest gaps
        //   1 .. maxDepth-1  parent groups \u2014 tinted header bar (upperLabel)
        //   maxDepth         leaves \u2014 colour tiles
        //
        // Colour is NOT set here any more: `paint()` above writes an explicit
        // itemStyle on every node, which is what lets the tint ramp run toward
        // the surface instead of toward mid luminance. A `colorSaturation`
        // range at this level would override those per-node colours.
        var levels = [];
        for (var d = 0; d <= maxDepth; d++) {
            var isRoot = d === 0;
            var isLeaf = d === maxDepth;
            levels.push({
                upperLabel: { show: !isRoot && !isLeaf },
                itemStyle: {
                    borderColor: surfaceColor,
                    borderWidth: isRoot ? 0 : 1,
                    gapWidth: isRoot ? 4 : 2
                }
            });
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
                // top-left. The formatter picks the rich style — plain (`n`/
                // `v`, knockout ink) or `d`-suffixed (deep ink) — from the
                // tile colour ECharts hands it as `p.color`.
                //
                // The count line used to be dimmed to 0.82 alpha. Dropped:
                // alpha-blending the ink INTO the tile costs about a full
                // contrast point (5.5:1 -> 4.4:1 on #eb663d), which is the
                // difference between passing and failing AA on a 11px label.
                // Size and the name's own weight carry the hierarchy instead.
                label: {
                    show: true,
                    position: 'insideTopLeft',
                    overflow: 'truncate',
                    lineHeight: 15,
                    padding: [3, 4, 0, 4],
                    formatter: function (p) {
                        var k = inkFor(p.color);
                        return '{n' + k + '|' + p.name + '}\n{v' + k + '|' + shortNum(p.value) + '}';
                    },
                    rich: {
                        n:  leafInk(false, 12),
                        v:  leafInk(false, 11, [1, 0, 0, 0]),
                        nd: leafInk(true, 12),
                        vd: leafInk(true, 11, [1, 0, 0, 0])
                    }
                },
                // Parent headers: bold name + abbreviated count.
                //
                // These do NOT sit on the group's own colour, which is why
                // `p.color` is the wrong reference here and the leaf rule
                // cannot just be reused. ECharts reserves `upperLabel.height`
                // out of the node's BORDER area and paints that strip with
                // `itemStyle.borderColor` — `surfaceColor` for us. So the
                // header ink is chosen once, against the surface: knockout on
                // surface is 1.0:1, so this always resolves to the deep ink,
                // and the headers read as ordinary ink on the panel. That is
                // the pair the Phase-1 probe caught at 1.02:1, visible only
                // because the halo outlined otherwise-white-on-white text.
                //
                // `overflow` is repeated inside the rich styles because the
                // parent-level setting does not reach rich segments.
                upperLabel: {
                    show: hasHeaders,
                    height: 22,
                    overflow: 'truncate',
                    formatter: function (p) {
                        return '{u' + headerKey + '|' + p.name + '   ' + shortNum(p.value) + '}';
                    },
                    rich: {
                        u:  headerInk(false),
                        ud: headerInk(true)
                    }
                },
                itemStyle: { borderColor: surfaceColor, borderWidth: 1, gapWidth: 2 },
                levels: levels,
                data: children
            }]
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
     * @param {number} [opts.windowSize=20]
     *   Rows the default view shows, and the hard cap on the zoom window.
     *   Above this the y-axis gets a slider — which is a SILENT truncation on
     *   its own, so any caller passing more rows than this should also render
     *   a `P.buildWindowDisclosure` note saying how many of how many. The
     *   slider only ever SCROLLS that window (see `maxValueSpan` below); the
     *   disclosure's button is the one thing that widens it.
     * @param {boolean} [opts.expanded=false]
     *   Drop the window and draw every row. The caller must give the chart
     *   host the height to hold them (`C.ganttHeight`) — an 84-row Gantt in a
     *   320px box is unreadable in a different way.
     */
    /**
     * Y-label gutter, reserved EXPLICITLY rather than by `containLabel`.
     *
     * `grid.containLabel` is supposed to grow the gutter to hold the axis
     * labels. Measured on the rig it does not, reliably: with the same 82
     * names and the same `axisLabel.width: 160`, the collapsed 20-row window
     * got a 160px gutter and the expanded 82-row view got 121px. ECharts
     * truncated the labels to the declared 160 and then drew them
     * right-aligned into 121, so five of the longest press runs lost their
     * FIRST characters off the left edge of the canvas — "Agence Togolaise de
     * Presse" rendered as "e Togolaise de Presse", and "Bulletin d'information
     * du CNI" managed to be clipped at the left AND ellipsised at the right in
     * the same label.
     *
     * A truncation the reader can see is fine; one that eats the beginning of
     * a title is not — the beginning is what makes it identifiable. So the
     * gutter is reserved by us and the label width is what fits it, in every
     * state and at every width, which is exactly what `containLabel` was
     * being trusted to work out.
     */
    var GANTT_LABEL_W = 160;
    var GANTT_LABEL_W_SM = 100;
    var GANTT_LABEL_GAP = 16; // axis gap + outer margin

    C.gantt = function (entries, opts) {
        opts = opts || {};
        var windowSize = opts.windowSize || 20;
        var expanded = !!opts.expanded;
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

        // Is a vertical slider being drawn? Both the base grid's right gutter
        // and the phone media block have to know: the slider is an overlay
        // ECharts positions against the CONTAINER, not the grid, so a gutter
        // narrower than the slider puts it on top of the bars.
        var windowed = !expanded && list.length > windowSize;

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
            grid: C._grid({
                left: GANTT_LABEL_W + GANTT_LABEL_GAP,
                right: 48,
                bottom: 56,
                containLabel: false
            }),
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
                // Years must render as "1961", not "1,961". A '{value}'
                // string template still runs ECharts' number formatter,
                // which applies locale thousand separators on a value
                // axis; a function returning the raw integer is the only
                // reliable override.
                axisLabel: { formatter: function (v) { return String(Math.round(v)); } },
                name: t('Year'),
                nameLocation: 'middle',
                nameGap: 28
            },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false },
                // `interval: 0` — label EVERY row in the window. ECharts'
                // default 'auto' drops labels until they stop colliding,
                // which on the 20-row window meant every other newspaper
                // went unnamed: half the visible bars were anonymous
                // coloured strips in a chart whose whole subject is WHICH
                // papers ran WHEN. The window is now sized so the rows fit,
                // so there is nothing to thin out.
                //
                // `hideOverlap` is the floor under that promise. `interval: 0`
                // asks for all of them unconditionally, so if a row ever gets
                // less pitch than a label needs, the labels do not thin — they
                // pile, and 84 names stack into one unreadable smear down the
                // axis. Not hypothetical: that is what the reader saw whenever
                // the zoom below was widened past the height the host had been
                // given. The zoom can no longer do that, and if some future
                // caller finds another way, this drops the labels that collide
                // instead of drawing the smear.
                axisLabel: {
                    width: GANTT_LABEL_W,
                    overflow: 'truncate',
                    interval: 0,
                    hideOverlap: true
                }
            },
            // Windowed unless the caller expanded it. `end` is the share of
            // the rows the first screenful covers — the same arithmetic as
            // before, but now driven by the window size the caller also
            // discloses, instead of a bare 20 that appeared nowhere in the UI.
            //
            // `maxValueSpan` is what keeps the two escape routes from
            // contradicting each other. The host's height is fixed by the
            // CALLER, from the row count it believes is on screen; this zoom
            // could change that row count without telling anyone. Widen the
            // slider to its full travel and 84 rows land in a box built for
            // 20 — ~3px each, every label drawn, and the panel reads as a
            // scribble. Capping the span at `windowSize` makes the slider a
            // scroller: it moves the window through the rows, it never resizes
            // it past what the box can render. Growing the view is the
            // disclosure button's job, and that one grows the host to match
            // (`C.ganttHeight`).
            //
            // The wheel bindings go with it. `inside` defaults to
            // `zoomOnMouseWheel: true`, so a reader scrolling PAST the panel
            // with the pointer over it zoomed the row axis instead — landing
            // in the squashed state having asked for nothing at all. The wheel
            // now scrolls the page; dragging still pans the rows.
            dataZoom: windowed ? [
                {
                    type: 'slider', yAxisIndex: 0,
                    start: 0, end: 100 * windowSize / list.length,
                    right: 8,
                    maxValueSpan: windowSize
                },
                {
                    type: 'inside', yAxisIndex: 0,
                    maxValueSpan: windowSize,
                    zoomOnMouseWheel: false,
                    moveOnMouseWheel: false
                }
            ] : [],
            series: [{
                type: 'custom',
                renderItem: renderItem,
                encode: { x: [1, 2], y: 0 },
                data: data
            }]
        };

        // On phones the value x-axis crowds ~10 year ticks into ~330px and
        // R.gridMedia's bottom:24 dropped the "Year" name into the bars.
        // Custom media: ~5 year ticks (interval /5 instead of /10), smaller
        // font, and a bottom gutter that keeps the axis name clear.
        //
        // The right gutter is the fix for the vertical slider. The base grid
        // reserves 48px for it (8px offset + ECharts' 30px default width);
        // this block was overriding that with 14px, so on every phone-width
        // Gantt the slider sat ON the plotted bars — the rows nearest the
        // right edge ran under a translucent grey panel and the handle covered
        // whichever bar reached the present. Reserve a gutter here too, and
        // slim the slider itself to 12px so the reservation costs ~7% of a
        // 375px viewport instead of ~13%. When nothing is windowed there is no
        // slider and the tight gutter is right, so it stays conditional.
        var ganttMedia = [{
            query: { maxWidth: R ? R.BP.sm : 640 },
            option: {
                grid: {
                    left: GANTT_LABEL_W_SM + GANTT_LABEL_GAP,
                    right: windowed ? 26 : 14,
                    top: 8, bottom: 48,
                    containLabel: false
                },
                yAxis: { axisLabel: { width: GANTT_LABEL_W_SM, fontSize: 11 } },
                xAxis: {
                    interval: Math.max(1, Math.ceil((yearMax - yearMin) / 5)),
                    nameGap: 24,
                    axisLabel: { fontSize: 10 }
                }
            }
        }];
        // Merged element-wise by index: [0] is the slider, [1] the inside
        // zoom, which has no geometry to narrow.
        if (windowed) {
            ganttMedia[0].option.dataZoom = [{ width: 12, right: 4 }];
        }

        // `R.labelMedia` is no longer in the chain: it set the phone label
        // width, and the width and the gutter that has to hold it are one
        // decision now, so both live in `ganttMedia` above.
        return R && R.withMedia ? R.withMedia(base, ganttMedia) : base;
    };

    /**
     * Host height a Gantt needs to draw `rows` rows at a legible pitch.
     *
     * An ECharts host has a fixed pixel height; the y-axis divides whatever it
     * gets by the row count. So "show all 84" without growing the host would
     * trade a silent truncation for 84 three-pixel slivers — honest and
     * unreadable.
     *
     * The pitch used to be 24px, justified in this comment as "the pitch the
     * 20-row default already renders at in a 320px panel". Measured on the
     * live panel it is not: the 320px panel gives the chart a 288px host, the
     * grid keeps ~96px of that for the x-axis and its name, and the 20 rows
     * divide the remaining ~220px into bands of **11px**. So the claim was
     * out by more than a factor of two, and expanding did not keep the bars
     * the size the reader was just looking at — it doubled them, and spent
     * 2112px of page on 84 newspapers to do it.
     *
     * 18px is the honest number: comfortably looser than the 11px the
     * collapsed view renders at, tight enough that all 84 rows come in at
     * ~1600px instead of ~2100px. Below ~14px the truncated titles start
     * touching, which is the failure this function exists to prevent.
     *
     * @param {number} rows
     * @param {number} [floor=320]  the panel's own min-height (iwac-core.css)
     */
    C.ganttHeight = function (rows, floor) {
        var CHROME = 96;  // grid top + x-axis labels + axis name + gutter
        var PITCH = 18;
        return Math.max(floor || 320, Math.round((Number(rows) || 0) * PITCH + CHROME));
    };

    /* ----------------------------------------------------------------- */
    /*  Word cloud (requires echarts-wordcloud extension)                 */
    /* ----------------------------------------------------------------- */

    var _wordcloudAvailable = null;

    /** Hover halo: the theme's strongest ink at 40%, or a neutral if absent. */
    function wcHalo(inkStrong) {
        return (inkStrong && typeof echarts !== 'undefined'
                && echarts.color && echarts.color.modifyAlpha)
            ? echarts.color.modifyAlpha(inkStrong, 0.4)
            : 'rgba(0, 0, 0, 0.4)';
    }

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
     * in echarts-wordcloud 2). Size range + grid adapt to the word count.
     *
     * COLOUR (v1.53.0). Until now each word drew a random pick from a
     * seven-hex literal that had drifted off the palette entirely — it still
     * led with `#e64a19`, the pre-v2.0.0 brand seed, and it was the same
     * array in both themes. Two consequences: the cloud was the one chart on
     * the page not speaking the module's colour grammar, and roughly half its
     * words failed AA against the panel in one theme or the other.
     *
     * A word cloud is knocked-out TEXT, not a filled mark, so the bar the
     * palette has to clear is text contrast: 4.5:1 against `--panel-bg` (the
     * panel's real backdrop — `--surface` in light, `--surface-raised` in
     * dark). The qualifying slots are COMPUTED from the live palette in the
     * active theme rather than listed, so a future palette edit either keeps
     * a slot qualified or silently drops it out of the cloud — it can never
     * leave an unreadable one in. And the assignment is by rank, not random:
     * the render callback re-runs on every theme toggle and resize, and a
     * cloud that re-shuffles its colours each time reads as a bug.
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

        var wcTokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var inks = C.readableInks(wcTokens.panelBg, wcTokens.ink);
        // Per-datum rather than a `textStyle.color` callback: echarts-wordcloud
        // resolves the datum's own textStyle, so this needs no assumption
        // about what the library passes a colour function.
        data.forEach(function (d, i) {
            d.textStyle = { color: inks[i % inks.length] };
        });

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
                    fontWeight: 'bold'
                },
                emphasis: {
                    textStyle: {
                        fontWeight: 'bold',
                        shadowBlur: 14,
                        // The hover halo was a literal black at 0.4 — which in
                        // dark mode is a black glow behind bright type on a
                        // near-black panel, i.e. no hover state at all. The
                        // theme's strongest ink flips with the theme (near-black
                        // in light, near-white in dark), so it is the one value
                        // that reads as a halo in both.
                        shadowColor: wcHalo(wcTokens.inkStrong)
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
     * The grid is calendar-agnostic: `opts.calendar = 'hijri'` swaps the
     * twelve row labels for the lunar months and tags the tooltip year
     * with an era marker. Nothing here converts a date — Hijri cells
     * arrive already bucketed by the generator from the dataset's stored
     * `hijri_*` columns, because ICU (what a browser would convert with)
     * disagrees with those tables on ~75% of this collection's pre-2000
     * days.
     *
     * @param {{years:number[], months:number[], cells:Array}} data
     * @param {Object} [opts]
     * @param {string} [opts.calendar]  'hijri' for the lunar row labels
     */
    C.heatmap = function (data, opts) {
        opts = opts || {};
        var years = (data && data.years) || [];
        var cells = (data && data.cells) || [];
        var hijri = opts.calendar === 'hijri';
        var monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (ns.locale === 'fr') {
            monthLabels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
                           'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
        }
        // Single copy of the lunar table lives in shared/hijri.js.
        if (hijri && ns.hijri && ns.hijri.MONTHS) {
            monthLabels = ns.hijri.MONTHS[ns.locale === 'fr' ? 'fr' : 'en']
                || ns.hijri.MONTHS.en;
        }
        var era = hijri ? ' ' + t('cal_hijri_era') : '';
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
                    return '<strong>' + esc(month + ' ' + year + era) + '</strong><br>' +
                        t('mentions_count', { count: fmt(p.data[2]) });
                }
            },
            // Hijri month names run two to three times longer than "Jan",
            // so the y-axis gutter widens to match instead of truncating.
            grid: C._grid({ top: 24, bottom: 40, left: hijri ? 96 : 64, right: 72 }),
            xAxis: {
                type: 'category',
                data: years.map(String),
                // The year axis is unlabelled in Gregorian (four digits
                // starting with 19/20 need no gloss) but carries the era
                // marker in Hijri, where a bare 1441 would otherwise read
                // as a typo.
                name: hijri ? t('cal_hijri_era') : '',
                nameLocation: 'end',
                nameGap: 8,
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

    /* ----------------------------------------------------------------- */
    /*  UMAP landscape (scatter of a projection, one series per bucket)   */
    /* ----------------------------------------------------------------- */

    /**
     * A 2-D embedding projection as a scatter: one series per category so
     * the theme palette and legend toggling come free, inside pan/zoom on
     * both axes, and the axes themselves hidden — UMAP coordinates carry
     * no unit, only proximity means anything, and a numbered axis would
     * invite a reading as a measure.
     *
     * Three blocks draw one — the article and periodical landscapes, the
     * laïcité dossier's semantic map, the bibliography's landscape — and
     * until v1.63.0 each carried its own copy of this option. They differ
     * in the point size a given density can afford, the tooltip lines,
     * whether a category has a colour of its own and whether a label
     * overlay sits on top; everything else is here.
     *
     * Every datum is `[x, y, i]`, `i` the point's index into the bundle's
     * columnar arrays, so a tooltip and a click handler resolve the title,
     * the id or any other column through it (see P.navigateOnClick).
     *
     * @param {{x:number[], y:number[], title?:string[]}} pts  columnar points
     * @param {{groups:Object<string,number[]>, order:string[]}} grouped
     *   bucket name → point indices, and the buckets' display order
     * @param {Object} [opts]
     *   symbolSize — px (default 4: right for ten thousand points)
     *   opacity — resting point opacity (default 0.6); emphasis is 1
     *   progressive / progressiveThreshold — ECharts progressive rendering,
     *     set only on the dense landscapes (off by default)
     *   tooltipBits(i) — extra lines for point i (country, year, …); the
     *     tooltip is the point's title in bold plus these joined by " · "
     *   seriesColor(name) — a colour for the bucket, or nothing for the
     *     palette (the laïcité frame facet reuses the arenas' palette)
     *   extraSeries — series appended after the buckets (a silent label
     *     overlay); the legend lists the buckets only
     */
    C.landscape = function (pts, grouped, opts) {
        opts = opts || {};
        pts = pts || {};
        var order = (grouped && grouped.order) || [];
        var groups = (grouped && grouped.groups) || {};
        var symbolSize = opts.symbolSize != null ? opts.symbolSize : 4;
        var opacity = opts.opacity != null ? opts.opacity : 0.6;
        var titles = pts.title || [];

        var series = order.map(function (name) {
            var s = {
                name: name,
                type: 'scatter',
                symbolSize: symbolSize
            };
            if (opts.progressive != null) {
                s.progressive = opts.progressive;
                s.progressiveThreshold = opts.progressiveThreshold != null
                    ? opts.progressiveThreshold : opts.progressive;
            }
            s.itemStyle = { opacity: opacity };
            var color = opts.seriesColor ? opts.seriesColor(name) : null;
            if (color) s.itemStyle.color = color;
            s.emphasis = { itemStyle: { opacity: 1 } };
            // [x, y, point-index] — the index feeds tooltip + click.
            s.data = (groups[name] || []).map(function (i) {
                return [pts.x[i], pts.y[i], i];
            });
            return s;
        });
        (opts.extraSeries || []).forEach(function (s) { if (s) series.push(s); });

        return {
            legend: {
                type: 'scroll',
                bottom: 0,
                itemWidth: 12,
                itemHeight: 10,
                // The point buckets only, so an overlay never grows a legend entry.
                data: order.slice()
            },
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    var i = p.data[2];
                    var bits = (opts.tooltipBits && opts.tooltipBits(i)) || [];
                    return '<strong>' + esc(titles[i] || '') + '</strong>'
                        + (bits.length ? '<br>' + esc(bits.join(' · ')) : '');
                }
            },
            grid: { left: 8, right: 8, top: 8, bottom: 36 },
            xAxis: { type: 'value', scale: true, show: false },
            yAxis: { type: 'value', scale: true, show: false },
            dataZoom: [
                { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
                { type: 'inside', yAxisIndex: 0, filterMode: 'none' }
            ],
            series: series,
            animation: false
        };
    };

    /**
     * Generic label × label count/intensity matrix on the shared
     * sequential ramp (--iwac-vis-heatmap-0..4). Unlike C.heatmap (the
     * year × month calendar above), both axes take arbitrary label
     * arrays; cells are sparse [xIdx, yIdx, value] rows and the first
     * y label renders at the TOP (inverse category axis). The ROADMAP
     * 4.6 matrix-coordinate rewrite can absorb both variants later.
     *
     * First consumer: the Periodicals Overview holdings matrix
     * (periodical × year issue counts); since v1.63.0 also the sentiment
     * atlas's centrality heatmap and model-agreement cross-tab, which
     * carried their own copies of this option until then.
     *
     * @param {{xLabels:Array, yLabels:Array, cells:Array}} data
     * @param {Object} [opts]
     *   tooltipFormatter — ECharts formatter; default "y · x — value"
     *   visualMin/visualMax — visualMap range (default 0..max(cell))
     *   ramp — visualMap colour stops, for a matrix that must not read on
     *     the heat ramp (the agreement cross-tab: surface → primary)
     *   grid — overrides merged over the default grid
     *   yLabelWidth — truncation width for long y labels (default 140)
     *   cellLabels — render each non-zero value inside its cell (small
     *     square matrices only; the default off suits dense year axes)
     *   cellBorder — 1px surface-colored separator between cells
     *   xLabelRotate — rotate the x labels (deg) and force interval 0,
     *     for term axes where every label must stay readable
     *   static — `progressive: 0, animation: false` on the series: a
     *     small matrix that is repainted on a facet change must not
     *     restart progressive rendering and flash empty
     */
    C.heatmapMatrix = function (data, opts) {
        opts = opts || {};
        var xLabels = (data && data.xLabels) || [];
        var yLabels = (data && data.yLabels) || [];
        var cells = (data && data.cells) || [];

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var resolve = ns.resolveCssVar || function () { return ''; };
        var muted = resolve('--muted') || tokens.muted;
        var border = resolve('--border') || tokens.border;
        var heatStops = [
            resolve('--iwac-vis-heatmap-0'),
            resolve('--iwac-vis-heatmap-1'),
            resolve('--iwac-vis-heatmap-2'),
            resolve('--iwac-vis-heatmap-3'),
            resolve('--iwac-vis-heatmap-4')
        ].filter(Boolean);
        if (heatStops.length < 2) {
            heatStops = [
                resolve('--surface') || tokens.surface,
                resolve('--primary') || tokens.primary
            ].filter(Boolean);
        }
        if (opts.ramp && opts.ramp.length >= 2) heatStops = opts.ramp.slice();

        var max = opts.visualMax;
        if (max == null) {
            max = 1;
            cells.forEach(function (c) {
                var v = c && c.value ? c.value[2] : (c ? c[2] : 0);
                if (v > max) max = v;
            });
        }

        var esc = (ns.panels && ns.panels.escapeHtml) || function (s) { return s; };
        var fmt = ns.formatNumber || String;

        var grid = { left: 8, right: 24, top: 12, bottom: 64, containLabel: true };
        if (opts.grid) {
            for (var g in opts.grid) {
                if (Object.prototype.hasOwnProperty.call(opts.grid, g)) grid[g] = opts.grid[g];
            }
        }

        var series = {
            type: 'heatmap',
            data: cells,
            label: opts.cellLabels
                ? {
                    show: true,
                    formatter: function (p) {
                        var v = p.value && p.value[2];
                        return v > 0 ? fmt(v) : '';
                    },
                    color: tokens.ink || '#2c2f37',
                    fontSize: 11
                }
                : { show: false },
            itemStyle: opts.cellBorder
                ? {
                    borderColor: resolve('--surface') || tokens.surface || '#fdfdfd',
                    borderWidth: 1
                }
                : undefined,
            emphasis: {
                itemStyle: {
                    borderColor: tokens.ink || '#2c2f37',
                    borderWidth: 2
                }
            }
        };
        if (opts.static) {
            series.progressive = 0;
            series.animation = false;
        }

        return {
            tooltip: {
                position: 'top',
                confine: true,
                formatter: opts.tooltipFormatter || function (p) {
                    var v = p.value || [];
                    return esc(String(yLabels[v[1]] || '')) + ' · '
                        + esc(String(xLabels[v[0]] || '')) + ' — ' + fmt(v[2]);
                }
            },
            grid: grid,
            xAxis: {
                type: 'category',
                data: xLabels.map(String),
                axisLabel: opts.xLabelRotate
                    ? { interval: 0, rotate: opts.xLabelRotate, fontSize: 10, color: muted }
                    : { interval: 'auto', fontSize: 10, color: muted },
                axisLine: { lineStyle: { color: border } },
                axisTick: { show: false },
                splitArea: { show: false }
            },
            yAxis: {
                type: 'category',
                data: yLabels.slice(),
                inverse: true,
                axisLabel: {
                    interval: 0,
                    fontSize: 10,
                    color: muted,
                    width: opts.yLabelWidth || 140,
                    overflow: 'truncate'
                },
                axisLine: { lineStyle: { color: border } },
                axisTick: { show: false },
                splitArea: { show: false }
            },
            visualMap: {
                min: opts.visualMin != null ? opts.visualMin : 0,
                max: max,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: 4,
                itemWidth: 14,
                itemHeight: 120,
                textStyle: { color: muted },
                inRange: { color: heatStops }
            },
            series: [series]
        };
    };
})();
