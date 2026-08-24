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
 * C._labelHalo, C._barDefaults, C._countryColor), the country-color map,
 * and the ORDINAL ramp lookups every rating chart paints from:
 * C.polarityPalette() (diverging), C.centralityPalette() and
 * C.subjectivityPalette() (sequential). Those three are the SINGLE copy of
 * each rating-scale → token map — the person/entity dashboards and the
 * laïcité framing view read them from here rather than repeating them. The individual chart builders live in sibling files that extend
 * the same IWACVis.chartOptions (C) namespace:
 *
 *   chart-options-bar.js      timeline, growthBar, stackedBar
 *   chart-options-hbar.js     horizontalBar, newspaper, entities, scaryTerms,
 *                             divergingBar (+ divergingExtent)
 *   chart-options-graph.js    chord, collaborationNetwork, sankey
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
     * base; pair it with a left grid gutter of ≥64px (desktop) so the
     * rotated glyph clears the tick numbers — including thousands-scale
     * labels like "6,000" — R.valueChartMedia narrows the gutter + name
     * gap to 42/28px on phones. Validated to stay fully on-canvas at a
     * 360px container width.
     */
    C._valueAxisName = function (name) {
        return {
            name: name,
            nameLocation: 'middle',
            nameRotate: 90,
            nameGap: 50,
            nameTextStyle: { align: 'center' }
        };
    };

    /**
     * Axis-trigger tooltip formatter for multi-series charts: a bold,
     * escaped axis-value header, then one line per series row, sorted by
     * value (desc by default) with empty rows dropped — so a 12-series
     * tooltip stays scannable. Only the per-row text is chart-specific;
     * callers supply it via `row(p, dataIndex)` and typically compose
     * `p.marker + ' ' + esc(p.seriesName) + …`.
     *
     * @param {object} opts
     * @param {function(object, number): string} opts.row
     *   Renders one series line. Receives the ECharts param object and the
     *   shared dataIndex; its return value is used verbatim (caller escapes).
     * @param {function(object, number): boolean} [opts.skip]
     *   Drop predicate; defaults to `p.value == null`.
     * @param {'asc'|'desc'} [opts.order='desc']
     *   'asc' for rank-style series where 1 is best (bump charts).
     * @param {number} [opts.missingValue=0]
     *   Stand-in used when comparing rows whose value is null/0 — pass a
     *   large number with order:'asc' so missing ranks sink to the bottom.
     * @returns {function} an ECharts `tooltip.formatter`
     */
    C.sortedAxisTooltip = function (opts) {
        var order = opts.order === 'asc' ? 1 : -1;
        var missing = opts.missingValue != null ? opts.missingValue : 0;
        var skip = opts.skip || function (p) { return p.value == null; };
        return function (params) {
            if (!params || !params.length) return '';
            var i = params[0].dataIndex;
            var lines = ['<strong>'
                + esc(String(params[0].axisValue)) + '</strong>'];
            params.slice().sort(function (a, b) {
                return order * ((a.value || missing) - (b.value || missing));
            }).forEach(function (p) {
                if (skip(p, i)) return;
                lines.push(opts.row(p, i));
            });
            // Optional trailing line for a per-category denominator — the
            // n of the bucket, which is what tells a reader whether a
            // dramatic-looking share rests on 2 documents or 200.
            if (opts.footer) {
                var footer = opts.footer(i, params);
                if (footer) lines.push(footer);
            }
            return lines.join('<br>');
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Ordinal rating ramps                                              */
    /* ----------------------------------------------------------------- */

    /**
     * Polarité (5-point Likert) → CSS colour, read from the
     * `--iwac-vis-sent-*` tokens in iwac-core.css.
     *
     * Polarité is ORDINAL — very positive → very negative — so it must be
     * painted with the diverging ramp, never with the categorical series
     * palette ECharts assigns by default. The sentiment atlas did exactly
     * that for five releases: every polarity panel there stacked the same
     * five buckets in orange / blue / green / red / purple, so the colours
     * carried no order at all AND disagreed with the person, entity and
     * laïcité dashboards, which have always read these tokens. Same five
     * labels, two colour systems, one site.
     *
     * Keys are the RAW French bucket names as they arrive in the
     * precomputed bundles (the same strings `polarity_order` carries);
     * callers translate for display but must look the palette up by the
     * raw key. Read at call time, not at load, so the light/dark swap in
     * dashboard-core repaints without remounting the panel.
     */
    C.polarityPalette = function () {
        var read = ns.readColorVar || ns.resolveCssVar || function () { return ''; };
        return {
            'Très positif':   read('--iwac-vis-sent-pos-strong'),
            'Positif':        read('--iwac-vis-sent-pos'),
            'Neutre':         read('--iwac-vis-sent-neutral'),
            'Négatif':        read('--iwac-vis-sent-neg'),
            'Très négatif':   read('--iwac-vis-sent-neg-strong'),
            'Non applicable': read('--iwac-vis-sent-na')
        };
    };

    /**
     * Centralité (how central Islam and Muslims are to an article) → CSS
     * colour, from the `--iwac-vis-cent-*` tokens.
     *
     * Sequential, not diverging: one hue fading toward the background as
     * the subject becomes more peripheral, ending on the flat border tint
     * for "not addressed at all". Same argument as polarité — the grades
     * are ORDERED, so the categorical series palette encodes nothing.
     *
     * Keys are the raw French bucket names carried by `centrality_order`.
     */
    C.centralityPalette = function () {
        var read = ns.readColorVar || ns.resolveCssVar || function () { return ''; };
        return {
            'Très central': read('--iwac-vis-cent-1'),
            'Central':      read('--iwac-vis-cent-2'),
            'Secondaire':   read('--iwac-vis-cent-3'),
            'Marginal':     read('--iwac-vis-cent-4'),
            'Non abordé':   read('--iwac-vis-cent-na')
        };
    };

    /**
     * Subjectivité 1–5 → CSS colour, from the `--iwac-vis-subj-*` tokens.
     * Sequential: 1 is factual and nearly the background, 5 is the accent
     * itself. Keys are STRINGS, matching the level names the bundles carry.
     */
    C.subjectivityPalette = function () {
        var read = ns.readColorVar || ns.resolveCssVar || function () { return ''; };
        return {
            '1': read('--iwac-vis-subj-1'),
            '2': read('--iwac-vis-subj-2'),
            '3': read('--iwac-vis-subj-3'),
            '4': read('--iwac-vis-subj-4'),
            '5': read('--iwac-vis-subj-5')
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
