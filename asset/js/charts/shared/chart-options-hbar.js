/**
 * IWAC Visualizations — Shared ECharts option builders (horizontal bars)
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
    /*  Shared right-aligned value label                                  */
    /*                                                                    */
    /*  horizontalBar / newspaper / entities all render the same          */
    /*  outside-bar value label with a stable ink color + surface halo    */
    /*  (so it survives the emphasis state — see C._stableLabelColor /    */
    /*  C._labelHalo in the core file). Build both the normal and the     */
    /*  emphasis label configs from one place so the three stay in sync.  */
    /*  Each call returns a fresh literal — ECharts mutates label/emphasis */
    /*  objects, so they must never be shared across series.              */
    /* ----------------------------------------------------------------- */

    /**
     * @param {function(number):string} [valueFormatter]
     *   Renders the value label. Defaults to the plain thousands-separated
     *   count. A panel whose bars carry a *measure* rather than a tally —
     *   runtime, bytes, a rate — passes its own so the number on the bar
     *   arrives with its unit instead of reading as a count of something.
     */
    function haloLabel(labelInk, halo, valueFormatter) {
        var format = valueFormatter || fmt;
        return {
            show: true,
            position: 'right',
            color: labelInk,
            textBorderColor: halo.textBorderColor,
            textBorderWidth: halo.textBorderWidth,
            formatter: function (p) { return format(p.value); }
        };
    }

    function haloEmphasis(labelInk, halo) {
        return {
            label: {
                color: labelInk,
                textBorderColor: halo.textBorderColor,
                textBorderWidth: halo.textBorderWidth
            }
        };
    }

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
     * @param {boolean} [opts.log=false] Logarithmic value axis — use when a
     *   single category dwarfs the rest (e.g. French at 97% of languages) so
     *   the long tail stays legible instead of collapsing to invisible bars.
     * @param {function(number):string} [opts.valueFormatter] Renders the value
     *   label and the tooltip figure. Default: thousands-separated count. Pass
     *   one when the bars carry a measure with a unit (runtime, bytes) — the
     *   same ranking read as a bare number reads as a tally.
     * @param {function(Object):string} [opts.tooltipFormatter] Replaces the
     *   whole tooltip body. Receives the resolved ECharts param object.
     *
     *   Take this rather than mutating `option.tooltip` on the returned value:
     *   when responsive rules apply, the return is `{baseOption, media}`, so
     *   an assignment to `option.tooltip` lands on the wrapper where ECharts
     *   never reads it — the chart keeps the default tooltip and nothing
     *   errors. That silent failure is the reason this option exists.
     * @param {boolean} [opts.useCountryColors=false] Colour each bar by its
     *   country's fixed palette slot (C._countryColor). Pass this on ANY chart
     *   whose categories are countries: one series means ECharts paints every
     *   bar in slot 0, so "Content by country" rendered six countries in one
     *   undifferentiated --primary while the timeline directly above it gave
     *   each of them a distinct colour. Off by default — a top-N of newspapers
     *   or languages is not a country scale and must not borrow its colours.
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
        var values = opts.useCountryColors
            ? list.map(function (e) {
                return { value: e[valueKey], itemStyle: { color: C._countryColor(e[nameKey]) } };
            })
            : list.map(function (e) { return e[valueKey]; });
        var barDef = C._barDefaults('horizontal');
        var labelInk = C._stableLabelColor();
        var halo = C._labelHalo();

        var valueFormat = opts.valueFormatter || fmt;
        var base = {
            grid: C._grid({ left: 8, top: 8, bottom: 8 }),
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    var p = Array.isArray(params) ? params[0] : params;
                    if (!p) return '';
                    if (opts.tooltipFormatter) return opts.tooltipFormatter(p);
                    var v = p.value && p.value.value != null ? p.value.value : p.value;
                    return esc(String(p.name)) + '<br/>' + esc(valueFormat(v));
                }
            },
            // Log axis can't anchor at 0 — start the scale at 1 (every real
            // count is ≥1). Bars still carry their true count in the value
            // label + tooltip; only the bar LENGTH is log-scaled.
            xAxis: opts.log
                ? { type: 'log', min: 1, minorSplitLine: { show: false },
                    axisLabel: { formatter: function (v) { return fmt(v); } } }
                : { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false },
                // Cap long category labels with an ellipsis; the full name
                // stays available in the axis tooltip. R.labelMedia narrows
                // the cap on phones.
                axisLabel: { width: 180, overflow: 'truncate' }
            },
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: barDef.barMaxWidth - 2,
                itemStyle: { borderRadius: barDef.borderRadius.slice() },
                label: haloLabel(labelInk, halo, opts.valueFormatter),
                emphasis: haloEmphasis(labelInk, halo)
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 110 }), R.gridMedia)
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
                label: haloLabel(labelInk, halo),
                emphasis: haloEmphasis(labelInk, halo)
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
                label: haloLabel(labelInk, halo),
                emphasis: haloEmphasis(labelInk, halo),
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

    /* ----------------------------------------------------------------- */
    /*  Diverging (centred) stacked bar — the Likert plot                 */
    /* ----------------------------------------------------------------- */

    /**
     * Horizontal diverging stacked bar for an ORDINAL rating scale with a
     * meaningful midpoint. Rows are categories; each row's ratings are
     * expressed as a share of that row's own total, negative grades
     * running left from a zero baseline and positive grades running
     * right, with the midpoint grade straddling the line half and half.
     *
     * Why this form. A plain stacked bar answers "how big is this
     * category": bar LENGTH encodes volume, so across a corpus whose
     * largest category is 77x its smallest, composition — the thing the
     * panel is actually about — is legible for the top two rows and
     * invisible for the other twenty-eight. Sharing a baseline at the
     * neutral midpoint instead makes every row directly comparable, and
     * puts the two questions a reader arrives with ("how positive?", "how
     * negative?") each on their own edge of the chart. Volume does not
     * disappear: it moves to the count gutter on the right, where it
     * reads as the denominator it is and warns that a 40% share of 17
     * documents is not a finding.
     *
     * Sorting rows by (positive share - negative share) makes BOTH outer
     * edges monotonic, because the two extents always sum to 100 — so the
     * chart resolves into two clean curves instead of a comb. Callers
     * that order rows that way get that for free; callers that order by
     * volume get an honest, noisier chart.
     *
     * Layout notes:
     *   - Category labels sit horizontally on the left. That is the whole
     *     reason this exists: 30 categories named after LDA term pairs
     *     cannot be read on a rotated x-axis, and the rotation ate so much
     *     of a 320px panel that the plot collapsed to a ~50px strip.
     *   - `extent` pins the value axis across facet switches, so changing
     *     the rating model moves the BARS and not the ruler.
     *   - Series carry signed values in one stack: ECharts accumulates
     *     positives rightward and negatives leftward from zero
     *     independently, which is exactly the diverging geometry. The two
     *     halves of the midpoint grade are two series sharing one name, so
     *     the legend shows one swatch and toggles both together.
     *
     * @param {Object} cfg
     * @param {Array<Object>} cfg.rows
     *   Ordered rows, top to bottom. Each: { name, full?, counts: {key: n} }.
     *   `full` is the untruncated name used as the tooltip header.
     * @param {Array<string>} cfg.order
     *   Grade keys in scale order, most negative first, e.g.
     *   ['Très négatif','Négatif','Neutre','Positif','Très positif'].
     * @param {string} cfg.neutralKey  The midpoint grade, split across zero.
     * @param {Object<string,string>} cfg.colors  Raw grade key → CSS color.
     * @param {function(string): string} [cfg.labelFor]  Grade key → display name.
     * @param {{min:number,max:number}} [cfg.extent]  Pinned percent extent.
     * @param {string} [cfg.countName]  Header over the right-hand count gutter.
     * @param {function(number): string} [cfg.countNote]  Row n → tooltip line.
     * @param {number} [cfg.labelWidth=210]  Category-label truncation width.
     */
    C.divergingBar = function (cfg) {
        var order = cfg.order || [];
        var rows = (cfg.rows || []).filter(function (r) {
            return r && rowTotal(r, order) > 0;
        });
        var neutralKey = cfg.neutralKey;
        var colors = cfg.colors || {};
        var labelFor = cfg.labelFor || function (k) { return k; };
        var neutralIdx = order.indexOf(neutralKey);
        // Nearest-the-axis first, so each side stacks outward from zero.
        var negKeys = order.slice(0, neutralIdx).reverse();
        var posKeys = order.slice(neutralIdx + 1);

        var names = rows.map(function (r) { return r.name; });
        var totals = rows.map(function (r) { return rowTotal(r, order); });
        var shares = rows.map(function (r, i) {
            var out = {};
            order.forEach(function (k) {
                out[k] = totals[i] ? ((r.counts[k] || 0) / totals[i]) * 100 : 0;
            });
            return out;
        });

        function gradeSeries(key, sign, half) {
            return {
                name: labelFor(key),
                type: 'bar',
                stack: 'polarity',
                barMaxWidth: 15,
                itemStyle: { color: colors[key] },
                emphasis: { focus: 'series' },
                blur: { itemStyle: { opacity: 0.35 } },
                data: shares.map(function (s) {
                    var v = half ? s[key] / 2 : s[key];
                    // Zero-share grades stay out of the stack entirely: a 0
                    // still paints a hairline at the segment boundary, which
                    // on a 15px bar reads as a real category.
                    return v ? sign * v : null;
                })
            };
        }

        var series = [gradeSeries(neutralKey, -1, true)];
        negKeys.forEach(function (k) { series.push(gradeSeries(k, -1, false)); });
        series.push(gradeSeries(neutralKey, 1, true));
        posKeys.forEach(function (k) { series.push(gradeSeries(k, 1, false)); });

        // The zero baseline is this chart's whole premise, so it is drawn
        // rather than left to whichever splitLine happens to fall there.
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        series[0].markLine = {
            silent: true,
            symbol: 'none',
            animation: false,
            label: { show: false },
            emphasis: { disabled: true },
            lineStyle: {
                color: tokens.inkLight || tokens.ink || '#3f4349',
                width: 1,
                type: 'solid',
                opacity: 0.7
            },
            data: [{ xAxis: 0 }]
        };

        var labelWidth = cfg.labelWidth || 210;

        // How far the count column has to stand off the plot.
        //
        // A right-positioned axis anchors its labels at (grid right +
        // margin) and, right-aligned, they grow LEFTWARD from there — so
        // the default 8px margin puts a four-digit count on top of any bar
        // that reaches the end of the axis. Right alignment is worth
        // keeping (a column of magnitudes reads down its units digit), so
        // the margin is widened to the width of the longest count instead.
        // 0.62em per digit is the advance width of a lining figure in the
        // faces this theme ships; the extra 10px is the gutter itself.
        var countLabels = totals.map(function (n) { return fmt(n); });
        var countChars = countLabels.reduce(function (max, str) {
            return Math.max(max, str.length);
        }, 1);
        function countMargin(fontSize) {
            return Math.round(countChars * fontSize * 0.62) + 10;
        }

        var base = {
            grid: C._grid({ left: 4, right: 4, top: 44, bottom: 26 }),
            legend: {
                // Ordered most-negative to most-positive so the key reads
                // left to right as the same ruler the bars are drawn on.
                data: order.map(labelFor),
                top: 0,
                left: 'center',
                itemWidth: 12,
                itemHeight: 10,
                itemGap: 14
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: divergingTooltip(rows, order, totals, shares, colors, labelFor, cfg.countNote)
            },
            xAxis: {
                type: 'value',
                min: cfg.extent ? cfg.extent.min : null,
                max: cfg.extent ? cfg.extent.max : null,
                // With min/max pinned, ECharts still inserts 0 as a boundary
                // tick, which on an asymmetric extent yields a lattice like
                // -50 / -30 / 0 / 30 / 60: irregular steps on a ruler whose
                // whole job is to be read symmetrically about zero. A fixed
                // interval that the extent is a multiple of (which
                // C.divergingExtent guarantees) keeps the steps even and puts
                // a tick ON zero instead of beside it.
                interval: cfg.extent ? cfg.extent.interval : null,
                axisLabel: {
                    // Distance from the midpoint is a share of the row, so
                    // the left half is labelled unsigned, not negative.
                    formatter: function (v) { return Math.abs(v) + ' %'; }
                },
                splitLine: { show: true }
            },
            yAxis: [
                {
                    type: 'category',
                    data: names,
                    inverse: true,
                    axisTick: { show: false },
                    axisLine: { show: false },
                    axisLabel: { width: labelWidth, overflow: 'truncate', fontSize: 12 }
                },
                // The count gutter: a second category axis over the same
                // rows, so the denominators line up with their bars instead
                // of riding along as value labels that move with the data.
                // `nameLocation: 'start'` is the TOP of an inverted axis —
                // the counts are a column and a column's header belongs
                // above it, not at the foot where it lands on the x-axis
                // ticks.
                {
                    type: 'category',
                    data: totals.map(function (n) { return fmt(n); }),
                    position: 'right',
                    inverse: true,
                    name: cfg.countName || '',
                    nameLocation: 'start',
                    nameGap: 18,
                    // The labels are pushed clear of the plot by their
                    // `margin`; an axis NAME takes no margin, so without
                    // the same shift the header sits a column-width to the
                    // left of the numbers it heads. Negative right padding
                    // is how a right-aligned text box moves outward.
                    nameTextStyle: {
                        align: 'right',
                        fontSize: 11,
                        fontWeight: 'bold',
                        padding: [0, -countMargin(11), 0, 0]
                    },
                    axisLine: { show: false },
                    axisTick: { show: false },
                    splitLine: { show: false },
                    axisLabel: { align: 'right', fontSize: 11, margin: countMargin(11) }
                }
            ],
            series: series,
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, divergingMedia(labelWidth, countMargin))
            : base;
    };

    /**
     * A value extent for `divergingBar`, snapped so that both ends and
     * every tick sit on the same lattice through zero.
     *
     * Pass EVERY series that should share the ruler — across facets, and
     * across panels that sit next to each other. A diverging bar whose axis
     * rescales per facet lies by omission: the model that rates most
     * sharply and the model that rates most mildly then draw bars of the
     * same width, and the difference between them — the thing a
     * multi-rater corpus exists to show — reads as nothing.
     *
     * @param {Array<Object>} rows  Pooled rows, any order.
     * @param {Array<string>} order Grades, most negative first.
     * @param {string} neutralKey   Grade straddling zero.
     * @param {number} [step=20]    Tick interval, in percentage points.
     */
    C.divergingExtent = function (rows, order, neutralKey, step) {
        step = step || 20;
        var neutralIdx = order.indexOf(neutralKey);
        var negKeys = order.slice(0, neutralIdx);
        var posKeys = order.slice(neutralIdx + 1);
        var left = 0;
        var right = 0;
        (rows || []).forEach(function (r) {
            var total = rowTotal(r, order);
            if (!total) return;
            var half = ((r.counts[neutralKey] || 0) / total) * 50;
            left = Math.max(left, (sumOver(r.counts, negKeys) / total) * 100 + half);
            right = Math.max(right, (sumOver(r.counts, posKeys) / total) * 100 + half);
        });
        function snap(v) { return Math.min(100, Math.ceil(v / step) * step) || step; }
        return { min: -snap(left), max: snap(right), interval: step };
    };

    function sumOver(counts, keys) {
        var n = 0;
        (keys || []).forEach(function (k) { n += (counts && counts[k]) || 0; });
        return n;
    }

    function rowTotal(row, order) {
        var sum = 0;
        (order || []).forEach(function (k) { sum += (row.counts && row.counts[k]) || 0; });
        return sum;
    }

    /** Swatch matching ECharts' own tooltip marker, for our custom rows. */
    function dot(color) {
        return '<span style="display:inline-block;margin-right:6px;border-radius:10px;'
            + 'width:10px;height:10px;background-color:' + (color || 'transparent') + '"></span>';
    }

    /**
     * The params ECharts hands an axis tooltip here are the SIGNED, halved
     * plotting values spread over six series — useless to a reader.
     * Everything is re-derived from the source rows instead, keyed on
     * dataIndex: the untruncated category name, the row's n, and one line
     * per grade in scale order carrying its true count and share.
     */
    function divergingTooltip(rows, order, totals, shares, colors, labelFor, countNote) {
        return function (params) {
            if (!params || !params.length) return '';
            var i = params[0].dataIndex;
            var row = rows[i];
            if (!row) return '';
            var lines = ['<strong>' + esc(row.full || row.name) + '</strong>'];
            if (countNote) {
                lines.push('<span style="opacity:.75">' + esc(countNote(totals[i])) + '</span>');
            }
            order.slice().reverse().forEach(function (k) {
                var n = (row.counts && row.counts[k]) || 0;
                if (!n) return;
                lines.push(dot(colors[k]) + esc(labelFor(k))
                    + ' <strong>' + fmt(n) + '</strong>'
                    + ' <span style="opacity:.75">'
                    + shares[i][k].toFixed(1).replace('.', ns.locale === 'fr' ? ',' : '.')
                    + ' %</span>');
            });
            return lines.join('<br>');
        };
    }

    /**
     * Narrow screens. Three things change, all of them forced by the plot
     * being ~170px wide on a phone:
     *   - category labels truncate harder, and the count column tightens to
     *     its 10px measure;
     *   - the legend wraps to two rows, so the grid starts lower and the
     *     count header has somewhere to sit;
     *   - the value axis keeps its 20-point gridlines but labels only every
     *     40, because seven "%"-suffixed labels across 170px run together
     *     into one unreadable band. Zero stays labelled either way — the
     *     extent is always a multiple of 20, so it is on the 40 lattice too.
     */
    function divergingMedia(labelWidth, countMargin) {
        return [
            {
                query: { maxWidth: R.BP.md },
                option: {
                    grid: { top: 76 },
                    yAxis: [
                        { axisLabel: { width: Math.min(labelWidth, 128), fontSize: 11 } },
                        {
                            nameGap: 16,
                            nameTextStyle: { fontSize: 10, padding: [0, -countMargin(10), 0, 0] },
                            axisLabel: { fontSize: 10, margin: countMargin(10) }
                        }
                    ],
                    xAxis: {
                        axisLabel: {
                            fontSize: 10,
                            formatter: function (v) {
                                return v % 40 === 0 ? Math.abs(v) + ' %' : '';
                            }
                        }
                    }
                }
            }
        ];
    }
})();
