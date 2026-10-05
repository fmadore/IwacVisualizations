/**
 * IWAC Visualizations — Scary Terms: the ranked-terms bar and its race.
 *
 * `C.scaryTerms` / `C.scaryTermItems` used to sit in the shared charts
 * bundle (chart-options-hbar.js), which every chart page loads, while only
 * this block draws them. They live beside the block now and still attach to
 * `IWACVis.chartOptions`, so the call sites did not change. Loaded before
 * the orchestrator in the block's bundle (asset/js/bundles.json).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.scary-terms/bars: panels.js and the shared chart options must load first');
        return;
    }

    var t = P.t;
    var fmt = P.formatNumber;
    var esc = P.escapeHtml;
    var R = ns.responsive;

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
     * **Race mode** (`cfg.race`) is a different chart, not a styling flag.
     * A bar chart race is ECharts' `realtimeSort`: the series carries EVERY
     * term against a FIXED category axis and ECharts ranks them, animating
     * each bar to its new row. What this used to do — slice the top ten per
     * frame and re-supply the axis — animated bar lengths in fixed slots
     * while the labels swapped instantly, which is a bar chart that changes.
     * In race mode the caller passes all terms in a stable order (see
     * `buildRaceFrames`) and `visibleBars` says how many rows to show.
     *
     * The animation timings are the documented recipe: the update duration
     * matches the caller's tick so one frame finishes as the next arrives,
     * easing is linear because anything else stalls mid-tick, and the
     * initial duration is 0 so the first frame does not grow from nothing.
     * Under `prefers-reduced-motion` the theme sets `animation: false` and
     * the whole thing snaps between frames, which is the correct reading of
     * that preference for a chart whose content is the motion.
     *
     * @param {Object} cfg
     * @param {Array<Array>}        cfg.entries     [[term, count], ...] sorted desc
     * @param {Object<string,string>} cfg.termColors Stable term → color map
     * @param {number}              [cfg.fixedMax]  Pin x-axis to this max
     * @param {number}              [cfg.maxLabelLength=28]
     * @param {boolean}             [cfg.race]      Enable realtimeSort
     * @param {number}              [cfg.visibleBars] Rows shown in race mode
     * @param {number}              [cfg.tickMs]    Frame interval, for the timings
     */
    /**
     * `[[term, count], ...]` → the series items, carrying each term's stable
     * colour.
     *
     * Exported because a race advances by MERGING `series[0].data`, and a
     * merge replaces the array wholesale: sending bare numbers would drop
     * every per-term colour on the first tick. The `name` is what ECharts
     * diffs bar items by — without it a term climbing from rank four to rank
     * two animates four bar lengths in fixed slots instead of moving up.
     */
    C.scaryTermItems = function (entries, termColors) {
        termColors = termColors || {};
        return (entries || []).map(function (e) {
            return {
                name: e[0],
                value: e[1],
                itemStyle: { color: termColors[e[0]] || undefined }
            };
        });
    };

    C.scaryTerms = function (cfg) {
        cfg = cfg || {};
        var entries = cfg.entries || [];
        var termColors = cfg.termColors || {};
        var maxLen = cfg.maxLabelLength || 28;

        var terms = entries.map(function (e) { return e[0]; });
        var values = C.scaryTermItems(entries, termColors);

        var barDef = C._barDefaults('horizontal');
        var labelInk = C._stableLabelColor();
        var race = !!cfg.race;
        var tick = cfg.tickMs || 1000;
        // One frame's animation ends just before the next arrives; a longer
        // one would be cut off mid-flight and read as a stutter.
        var frameMs = Math.max(200, tick - 100);
        var xAxis = { type: 'value', axisLabel: { formatter: function (v) { return fmt(v); } } };
        if (cfg.fixedMax != null) {
            xAxis.max = cfg.fixedMax;
        } else if (race) {
            // Adaptive per frame, deliberately: pinning to the final total
            // rendered every early year as a sliver.
            xAxis.max = 'dataMax';
        }

        var base = {
            grid: C._grid({ left: 8, right: 56, top: 8, bottom: 8 }),
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    return '<strong>' + esc(terms[p.dataIndex] || '') + '</strong><br>' +
                           t('mentions_count', { count: p.value || 0 });
                }
            },
            xAxis: xAxis,
            yAxis: {
                type: 'category',
                data: terms,
                inverse: true,
                axisTick: { show: false },
                animationDuration: race ? 300 : undefined,
                animationDurationUpdate: race ? 300 : 800,
                // n - 1, or every term is drawn and the race has no podium.
                max: race && cfg.visibleBars ? cfg.visibleBars - 1 : undefined,
                axisLabel: {
                    width: 160,
                    overflow: 'truncate',
                    formatter: function (v) { return C._truncate(v, maxLen); }
                }
            },
            series: [{
                type: 'bar',
                realtimeSort: race || undefined,
                data: values,
                barMaxWidth: barDef.barMaxWidth + 4,
                itemStyle: { borderRadius: barDef.borderRadius.slice() },
                label: {
                    show: true,
                    position: 'right',
                    color: labelInk,
                    valueAnimation: race || undefined,
                    formatter: function (p) { return fmt(p.value); }
                },
                emphasis: { disabled: true },
                animationDurationUpdate: race ? frameMs : 800,
                animationEasingUpdate: race ? 'linear' : 'cubicOut'
            }]
        };
        if (race) {
            base.animationDuration = 0;
            base.animationDurationUpdate = frameMs;
            base.animationEasing = 'linear';
            base.animationEasingUpdate = 'linear';
        }

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 120, smFontSize: 11 }), R.gridMedia)
            : base;
    };
})();
