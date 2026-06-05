/**
 * IWAC Visualizations — Shared ECharts option builders (core helpers)
 *
 * Block controllers import builders via `IWACVis.chartOptions.<name>(data,
 * opts)` and pass the result to the ECharts instance's `setOption`.
 *
 * Builders return plain option objects — no theme colors, no font
 * families. The registered IWAC ECharts theme (iwac-theme.js) provides
 * all of that at init time, so switching light/dark just needs a
 * dispose+reinit which dashboard-core.js handles automatically.
 *
 * This file is the CORE of the chart-options module: it owns the shared
 * private helpers (C._grid, C._dataZoom, C._truncate, C._stableLabelColor,
 * C._labelHalo, C._barDefaults, C._countryColor) and the country-color
 * map. The individual chart builders live in sibling files that extend
 * the same IWACVis.chartOptions (C) namespace:
 *
 *   chart-options-bar.js      timeline, growthBar, stackedBar
 *   chart-options-hbar.js     horizontalBar, newspaper, entities, scaryTerms
 *   chart-options-graph.js    network, chord, collaborationNetwork, sankey
 *   chart-options-special.js  pie, treemap, gantt, wordcloud, segmentedBar,
 *                             sunburst, beeswarm, heatmap
 *
 * Load order: after panels.js, this core file first, then the four
 * builder files (any order), before any block controller. The shared
 * asset partial (view/common/iwac-assets.phtml) enqueues all five when a
 * block declares `chartOptions => true`.
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
        return tokens.ink || '#2c2f37';
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
            textBorderColor: tokens.surface || '#fdfdfd',
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

    /**
     * Value-axis NAME placed vertically along the LEFT edge — the
     * conventional spot for a y-axis title. ECharts' default puts the name
     * at the axis 'end' (floating at the top-left, above the tick labels),
     * which crowds the top of the panel and reads as disconnected on
     * mobile. A centred, 90°-rotated title declutters the top and labels
     * the axis properly. Callers spread this over a `{ type: 'value' }`
     * base; pair it with a left grid gutter of ≥56px (desktop) so the
     * rotated glyph clears the tick numbers — R.valueChartMedia narrows
     * the gutter + name gap to 42/28px on phones. Validated to stay fully
     * on-canvas at a 360px container width.
     */
    C._valueAxisName = function (name) {
        return {
            name: name,
            nameLocation: 'middle',
            nameRotate: 90,
            nameGap: 42,
            nameTextStyle: { align: 'center' }
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
        if (palette.length === 0) palette = ['#e64a19', '#394f68', '#4a8c6f', '#c5504d', '#7c5295', '#d4a574', '#2c5f7c', '#8b6f47'];
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
})();
