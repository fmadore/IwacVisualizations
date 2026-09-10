/**
 * IWAC Visualizations — Responsive helpers
 *
 * Breakpoint constants (single source of truth for JS), container-width
 * utility, and reusable ECharts media-query presets that chart builders
 * merge into their option objects via R.withMedia().
 *
 * Load order: after panels.js, before chart-options.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var R = ns.responsive = ns.responsive || {};

    /* ----------------------------------------------------------------- */
    /*  Breakpoint constants                                              */
    /* ----------------------------------------------------------------- */

    R.BP = { sm: 640, md: 768, lg: 1024 };

    /* ----------------------------------------------------------------- */
    /*  Container width helper                                            */
    /* ----------------------------------------------------------------- */

    R.containerWidth = function (el) {
        var parent = el && el.parentElement;
        if (!parent) return window.innerWidth;
        return parent.getBoundingClientRect().width || window.innerWidth;
    };

    /* ----------------------------------------------------------------- */
    /*  ECharts media presets                                              */
    /* ----------------------------------------------------------------- */

    R.legendMedia = [
        {
            query: { maxWidth: R.BP.sm },
            option: {
                legend: {
                    orient: 'horizontal',
                    left: 'center',
                    bottom: 0,
                    top: null,
                    right: null
                }
            }
        }
    ];

    R.gridMedia = [
        {
            query: { maxWidth: R.BP.sm },
            option: {
                grid: { left: 24, right: 12, top: 36, bottom: 24 }
            }
        }
    ];

    R.labelMedia = function (opts) {
        opts = opts || {};
        var smWidth = opts.smWidth || 100;
        var smFontSize = opts.smFontSize || 11;
        return [
            {
                query: { maxWidth: R.BP.sm },
                option: {
                    yAxis: {
                        axisLabel: {
                            width: smWidth,
                            fontSize: smFontSize,
                            overflow: 'truncate'
                        }
                    }
                }
            }
        ];
    };

    R.dataZoomMedia = [
        {
            query: { maxWidth: R.BP.sm },
            option: {
                dataZoom: [{ height: 14 }]
            }
        }
    ];

    /* Mobile preset for vertical value charts (timeline / stacked bar).
     * Three jobs the blunt gridMedia couldn't do for these charts:
     *   1. keep a left gutter (42px) wide enough for the rotated y-axis
     *      NAME so "Count"/"Nombre" doesn't clip off the left edge;
     *   2. when a bottom dataZoom slider is present, reserve enough bottom
     *      space (60px) and shrink the slider so the x-axis NAME sits ABOVE
     *      the slider instead of dropping into the track (the overlap bug
     *      on phones — gridMedia forced bottom:24 under a 36px nameGap);
     *   3. shrink axis-name + tick fonts to 10px so the narrow canvas
     *      breathes.
     * Validated at 360px container width: rotated name fully on-canvas,
     * ~18px clearance between the x-axis name and the slider. */
    R.valueChartMedia = function (opts) {
        opts = opts || {};
        var hasZoom = !!opts.hasZoom;
        var rule = {
            query: { maxWidth: R.BP.sm },
            option: {
                grid: { left: 42, right: 14, top: 34, bottom: hasZoom ? 60 : 36, containLabel: true },
                xAxis: { nameGap: hasZoom ? 28 : 22, axisLabel: { fontSize: P.AXIS_FONT_SM } },
                yAxis: { nameGap: 28, nameTextStyle: { fontSize: P.AXIS_FONT_SM }, axisLabel: { fontSize: P.AXIS_FONT_SM } }
            }
        };
        if (hasZoom) {
            rule.option.dataZoom = [{ bottom: 4, height: 14 }];
        }
        return [rule];
    };

    /* ----------------------------------------------------------------- */
    /*  Merge utility                                                     */
    /* ----------------------------------------------------------------- */

    // ECharts merges media options into the current model; it does not
    // restore baseOption when the last query stops matching. Restore only
    // properties touched by a media rule, so zoom windows, legend selection
    // and series data remain the reader's. Null clears a mobile-only value
    // and lets ECharts inherit its normal theme/default text styling again.
    function mediaDefaults(base, override, target) {
        Object.keys(override).forEach(function (key) {
            var value = override[key];
            var original = base && base[key];
            if (value && typeof value === 'object') {
                var array = Array.isArray(value);
                if (!target[key] || typeof target[key] !== 'object') target[key] = array ? [] : {};
                mediaDefaults(original, value, target[key]);
            } else {
                target[key] = original === undefined ? null : original;
            }
        });
        return target;
    }

    R.withMedia = function (baseOption /*, mediaArray1, mediaArray2, ... */) {
        var allRules = [];
        for (var i = 1; i < arguments.length; i++) {
            var arr = arguments[i];
            if (Array.isArray(arr)) {
                for (var j = 0; j < arr.length; j++) {
                    allRules.push(arr[j]);
                }
            }
        }
        if (allRules.length === 0) return baseOption;
        if (!allRules.some(function (rule) { return !rule.query; })) {
            var defaults = {};
            allRules.forEach(function (rule) { mediaDefaults(baseOption, rule.option || {}, defaults); });
            allRules.push({ option: defaults });
        }
        return { baseOption: baseOption, media: allRules };
    };
})();
