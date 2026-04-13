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
    var R = ns.responsive = ns.responsive || {};

    /* ----------------------------------------------------------------- */
    /*  Breakpoint constants                                              */
    /* ----------------------------------------------------------------- */

    R.BP = { sm: 640, md: 768, lg: 1024 };

    /* ----------------------------------------------------------------- */
    /*  Container width helper                                            */
    /* ----------------------------------------------------------------- */

    R.containerWidth = function (el) {
        var node = el && (el.parentElement || el);
        if (!node) return window.innerWidth;
        return node.getBoundingClientRect().width || window.innerWidth;
    };

    /* ----------------------------------------------------------------- */
    /*  ECharts media presets                                              */
    /* ----------------------------------------------------------------- */

    R.legendMedia = function () {
        return [
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
    };

    R.gridMedia = function () {
        return [
            {
                query: { maxWidth: R.BP.sm },
                option: {
                    grid: { left: 24, right: 12, top: 36, bottom: 24 }
                }
            }
        ];
    };

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

    R.dataZoomMedia = function () {
        return [
            {
                query: { maxWidth: R.BP.sm },
                option: {
                    dataZoom: [{ height: 14 }]
                }
            }
        ];
    };

    /* ----------------------------------------------------------------- */
    /*  Merge utility                                                     */
    /* ----------------------------------------------------------------- */

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
        return { baseOption: baseOption, media: allRules };
    };
})();
