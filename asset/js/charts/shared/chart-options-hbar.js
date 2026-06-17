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

    function haloLabel(labelInk, halo) {
        return {
            show: true,
            position: 'right',
            color: labelInk,
            textBorderColor: halo.textBorderColor,
            textBorderWidth: halo.textBorderWidth,
            formatter: function (p) { return fmt(p.value); }
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
                label: haloLabel(labelInk, halo),
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
})();
