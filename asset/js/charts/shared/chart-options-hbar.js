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
    /*  horizontalBar (and the newspaper / entities wrappers over it)     */
    /*  renders an outside-bar value label with a stable ink color +      */
    /*  surface halo (so it survives the emphasis state — see             */
    /*  C._stableLabelColor / C._labelHalo in the core file). The normal  */
    /*  and the emphasis label configs are built here, side by side.      */
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
     * @param {string[]} [opts.itemFields] Entry fields copied onto each data
     *   item, for a click handler to read off `params.data` (`o_id`).
     * @param {number} [opts.maxLabelLength] Middle-ellipsis cap on the
     *   category labels (C._truncate), for names whose ends both matter.
     * @param {boolean} [opts.clickable=false] Pointer cursor on the bars.
     * @param {Object} [opts.grid] Overrides merged into the grid.
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
        // Items carry their NAME. ECharts diffs bar items by name when one is
        // present and by index otherwise, so a sort toggle or a pagination
        // step on nameless items animated every bar's length in place while
        // the axis labels swapped underneath — the ranking looked like it
        // reshuffled by slot. Named items animate each bar to its new row.
        var values = list.map(function (e) {
            var item = { name: e[nameKey], value: e[valueKey] };
            (opts.itemFields || []).forEach(function (key) { item[key] = e[key]; });
            if (opts.useCountryColors) item.itemStyle = { color: C._countryColor(e[nameKey]) };
            return item;
        });
        var gridOpts = { left: 8, top: 8, bottom: 8 };
        if (opts.grid) {
            Object.keys(opts.grid).forEach(function (key) { gridOpts[key] = opts.grid[key]; });
        }
        var axisLabel = { width: 180, overflow: 'truncate' };
        if (opts.maxLabelLength) {
            axisLabel.width = 220;
            axisLabel.formatter = function (v) { return C._truncate(v, opts.maxLabelLength); };
        }
        var barDef = C._barDefaults('horizontal');
        var labelInk = C._stableLabelColor();
        var halo = C._labelHalo();

        var valueFormat = opts.valueFormatter || fmt;
        var base = {
            grid: C._grid(gridOpts),
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
            // Log axis can't anchor at 0 — start the scale at 1. Bars retain
            // their true count in the value
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
                animationDurationUpdate: 400,
                // Cap long category labels with an ellipsis; the full name
                // stays available in the axis tooltip. R.labelMedia narrows
                // the cap on phones.
                axisLabel: axisLabel
            },
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: barDef.barMaxWidth - 2,
                // A count of one sits at the log baseline: retain a visible
                // mark without changing its count or tooltip.
                barMinHeight: opts.log ? 2 : 0,
                itemStyle: { borderRadius: barDef.borderRadius.slice() },
                label: haloLabel(labelInk, halo, opts.valueFormatter),
                emphasis: haloEmphasis(labelInk, halo)
            }]
        };
        if (opts.clickable) base.series[0].cursor = 'pointer';

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 110 }), R.gridMedia)
            : base;
    };

    /* ----------------------------------------------------------------- */
    /*  Newspaper coverage bar (with year-range tooltip)                  */
    /* ----------------------------------------------------------------- */

    /**
     * `C.horizontalBar` with a richer tooltip: year range, per-subset
     * breakdown and country. It used to keep its own copy of the bar,
     * which is how its tooltip came to print "1 articles": the breakdown
     * glued a lower-cased column title to a formatted number.
     *
     * @param {Array<Object>} entries
     *   Each: { name, total, articles?, publications?, references?,
     *   year_min?, year_max?, country? }
     */
    C.newspaper = function (entries) {
        var list = entries || [];
        return C.horizontalBar(list, {
            valueKey: 'total',
            // The tooltip reads `list[dataIndex]`, so the rows must not shift.
            filterUnknown: false,
            grid: { right: 48 },
            tooltipFormatter: function (p) {
                var entry = list[p.dataIndex] || {};
                var lines = ['<strong>' + esc(entry.name || '') + '</strong>'];
                if (entry.year_min && entry.year_max) {
                    lines.push(t('coverage_range', { min: entry.year_min, max: entry.year_max }));
                }
                var bits = [];
                if (entry.articles)     bits.push(t('articles_count', { count: entry.articles }));
                if (entry.publications) bits.push(t('publications_count', { count: entry.publications }));
                if (entry.references)   bits.push(t('references_count', { count: entry.references }));
                if (bits.length) lines.push(bits.join(' &middot; '));
                if (entry.country) lines.push(esc(entry.country));
                return lines.join('<br>');
            }
        });
    };

    /* ----------------------------------------------------------------- */
    /*  Entity frequency bar (with click-through data)                    */
    /* ----------------------------------------------------------------- */

    /**
     * `C.horizontalBar` for top-N entities. Each data point carries an
     * `o_id` so the controller can wire click → Omeka item page.
     *
     * @param {Array<Object>} entries
     *   Each: { title, frequency, o_id?, countries?, first_occurrence?, last_occurrence? }
     * @param {Object} [opts]
     * @param {number} [opts.maxLabelLength=30]  Middle-ellipsis cutoff
     */
    C.entities = function (entries, opts) {
        opts = opts || {};
        var list = entries || [];
        return C.horizontalBar(list, {
            nameKey: 'title',
            valueKey: 'frequency',
            filterUnknown: false,
            itemFields: ['o_id'],
            maxLabelLength: opts.maxLabelLength || 30,
            clickable: true,
            grid: { right: 48 },
            tooltipFormatter: function (p) {
                var entry = list[p.dataIndex] || {};
                var lines = [
                    '<strong>' + esc(entry.title || '') + '</strong>',
                    t('mentions_count', { count: entry.frequency || 0 })
                ];
                if (entry.first_occurrence || entry.last_occurrence) {
                    lines.push(
                        (entry.first_occurrence || '?') + ' \u2013 ' + (entry.last_occurrence || '?')
                    );
                }
                if (entry.countries && entry.countries.length) {
                    lines.push(esc(entry.countries.join(', ')));
                }
                return lines.join('<br>');
            }
        });
    };
})();
