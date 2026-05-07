/**
 * IWAC Visualizations — ECharts theme integration
 *
 * Reads the IWAC theme's CSS custom properties at runtime (via
 * `getComputedStyle`) and builds matching ECharts theme objects. This keeps
 * chart colors in sync with:
 *   - the theme's SCSS tokens (asset/sass/abstracts/variables/_colors.scss)
 *   - the admin-configured primary color (injected inline in layout.phtml)
 *   - light/dark switching (body[data-theme] + prefers-color-scheme)
 *
 * ECharts 6 removed `chart.setTheme()`, so switching requires dispose+reinit;
 * dashboard-core.js owns that plumbing. This file exposes:
 *   IWACVis.refreshThemes()      rebuild + re-register both themes from CSS
 *   IWACVis.getCurrentTheme()    'light' | 'dark'
 *   IWACVis.getChartTheme()      'iwac-light' | 'iwac-dark'
 *   IWACVis.getChartTokens()     the token object actually used by the current theme
 *   IWACVis.getBasemapStyle()    MapLibre style URL matching current theme
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};

    /* ----------------------------------------------------------------- */
    /*  Token fallbacks                                                   */
    /* ----------------------------------------------------------------- */

    // Used only if the IWAC theme is not the active Omeka theme and the CSS
    // custom properties don't resolve. Mirrors _colors.scss defaults for
    // IWAC theme v2.0.0 — OKLCH-based, cool-neutral surfaces (NOT cream),
    // primary hex `#e77f11` matching layout.phtml's `--primary-base`.
    var FALLBACK_LIGHT = {
        primary:       '#e77f11',  // brand orange, near oklch(67% 0.156 51)
        ink:           '#2c2f37',  // ~oklch(20% 0.012 264)
        inkLight:      '#535862',  // ~oklch(38% 0.012 260)
        muted:         '#767880',  // ~oklch(54% 0.008 256)
        surface:       '#fdfdfd',  // ~oklch(99.2% 0.002 60)  near-white, not cream
        surfaceRaised: '#fafaf9',  // ~oklch(98.0% 0.003 60)
        background:    '#f7f7f6',  // ~oklch(97.0% 0.003 60)
        border:        '#d4d6da',  // ~oklch(86% 0.007 258) cool-neutral
        borderLight:   '#e6e7eb'   // ~oklch(92% 0.005 258)
    };
    var FALLBACK_DARK = {
        primary:       '#f29541',  // mix(primary-base, white 12%) in oklab
        ink:           '#ebecf0',  // ~oklch(94% 0.008 258)
        inkLight:      '#b1b3ba',  // ~oklch(76% 0.010 258)
        muted:         '#84878f',  // ~oklch(60% 0.010 258)
        surface:       '#1f232b',  // ~oklch(17% 0.010 264)
        surfaceRaised: '#262a32',  // ~oklch(20% 0.010 264)
        background:    '#15181f',  // ~oklch(12% 0.010 264)
        border:        '#3d4148',  // ~oklch(30% 0.012 264)
        borderLight:   '#2f343c'   // ~oklch(24% 0.012 264)
    };

    /* ----------------------------------------------------------------- */
    /*  Qualitative palette                                               */
    /* ----------------------------------------------------------------- */

    /**
     * Categorical series colors. Index 0 is filled in from --primary so the
     * first series always matches the site's brand color. The remaining hues
     * are hand-picked to read well in both light and dark themes.
     */
    var PALETTE_REST = [
        '#394f68', '#4a8c6f', '#c5504d', '#7c5295', '#d4a574',
        '#2c5f7c', '#8b6f47', '#5ba3a0', '#cc8963', '#4a8aab',
        '#a68e6d', '#d49b6a', '#6fb08e', '#9e7bb8', '#e0a88a',
        '#8e7cb8', '#d87e7a', '#6b5b95', '#4db6ac'
    ];

    /* ----------------------------------------------------------------- */
    /*  Token reader                                                      */
    /* ----------------------------------------------------------------- */

    /** Read a CSS custom property from `document.body`, trimmed. */
    function readVar(name) {
        if (typeof getComputedStyle === 'undefined' || !document.body) return '';
        return getComputedStyle(document.body).getPropertyValue(name).trim();
    }

    /**
     * Read the body's resolved font-family stack so charts inherit the
     * theme's typography automatically. Theme v2.0.0 ships Public Sans
     * (body) + Source Serif 4 (headings); previous hardcoded "Inter"
     * here meant every chart visibly clashed with the surrounding UI.
     */
    function readBodyFont() {
        if (typeof getComputedStyle === 'undefined' || !document.body) {
            return null;
        }
        var ff = getComputedStyle(document.body).fontFamily;
        return (ff && ff.trim()) || null;
    }

    /**
     * Shared sacrificial <span> for color resolution. Parking it in the
     * DOM (hidden) lets us reuse it across every call instead of paying
     * the append/remove cost per token.
     */
    var _colorProbe = null;
    function _getColorProbe() {
        if (_colorProbe && _colorProbe.isConnected) return _colorProbe;
        if (typeof document === 'undefined' || !document.body) return null;
        _colorProbe = document.createElement('span');
        _colorProbe.setAttribute('aria-hidden', 'true');
        _colorProbe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;';
        document.body.appendChild(_colorProbe);
        return _colorProbe;
    }

    /**
     * Resolve a CSS color string (including hsl(h, calc(...), l%),
     * var(--primary), or color-mix()) to a plain `rgb(r, g, b)` or
     * `rgba(r, g, b, a)` string that ECharts' color parser understands.
     *
     * Background — ECharts' zrender color parser does NOT handle
     * `calc()` inside `hsl()`. When the site admin's dynamic primary
     * color injects something like
     *     --primary: hsl(14, calc(80% - 12%), 48%);
     * handing that raw value to ECharts as a bar color works for the
     * NORMAL render (the browser resolves it when drawing), but the
     * moment ECharts tries to brighten the color for the hover
     * emphasis state (via `echarts.color.lift`), the parse fails and
     * the returned color is undefined — which renders the bar
     * transparent. The bar visibly "disappears" on hover. Stacked
     * bars use `emphasis.focus: 'series'` which dims siblings without
     * touching the hovered bar's color, so they're unaffected.
     *
     * Fix: round-trip the value through the browser's color engine,
     * which evaluates calc() and returns `rgb()/rgba()` — always
     * parseable by ECharts.
     *
     * Safe to call with already-resolved colors (hex, rgb, named);
     * the browser just normalizes them. Returns the raw input as a
     * last resort so callers never get undefined.
     */
    // Coerce modern color forms (oklch/oklab/color-mix/color()) into legacy
    // rgb()/rgba() by RASTERIZING into a 1x1 sRGB canvas and reading back
    // the pixel bytes. `ctx.fillStyle = oklch(…); return ctx.fillStyle`
    // does NOT normalize in recent Chromium — it round-trips the modern
    // format unchanged. Rasterization works because the canvas backing
    // store is sRGB, so the bytes from getImageData are Color-Level-3 RGB
    // by construction. This is what lets IWAC theme v2.0.0 OKLCH tokens
    // (`oklch(20% .012 264)`, `color-mix(in oklab,…)`) survive ECharts'
    // internal lift/darken AND MapLibre's style validator.
    var _canvasProbe = null;
    function _normalizeViaCanvas(value) {
        if (!value) return value;
        try {
            if (!_canvasProbe) {
                var canvas = document.createElement('canvas');
                canvas.width = canvas.height = 1;
                _canvasProbe = canvas.getContext('2d', { colorSpace: 'srgb' })
                            || canvas.getContext('2d');
            }
            if (!_canvasProbe) return value;
            _canvasProbe.clearRect(0, 0, 1, 1);
            _canvasProbe.fillStyle = value;
            _canvasProbe.fillRect(0, 0, 1, 1);
            var d = _canvasProbe.getImageData(0, 0, 1, 1).data;
            if (d[3] === 255) {
                return 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')';
            }
            return 'rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', ' + (d[3] / 255) + ')';
        } catch (e) {
            return value;
        }
    }

    function resolveCssColor(value) {
        if (!value || typeof value !== 'string') return value;
        var trimmed = value.trim();
        if (!trimmed) return trimmed;
        // Fast path — hex / rgb / rgba don't need round-tripping and
        // the probe append/reflow is the expensive part of this fn.
        if (/^#([0-9a-f]{3}){1,2}$/i.test(trimmed)) return trimmed;
        if (/^rgba?\(/i.test(trimmed)) return trimmed;

        var probe = _getColorProbe();
        if (!probe) return _normalizeViaCanvas(trimmed) || trimmed;
        try {
            probe.style.color = '';
            probe.style.color = trimmed;
            var resolved = getComputedStyle(probe).color;
            if (!resolved) return trimmed;
            // rgb/rgba is Color-3-legal; everything else (oklch, oklab,
            // color(srgb …), color-mix(…)) gets canvas-normalized so it
            // survives ECharts' parser AND MapLibre's style validator.
            if (/^rgba?\(/i.test(resolved)) return resolved;
            return _normalizeViaCanvas(resolved) || resolved;
        } catch (e) {
            return trimmed;
        }
    }
    // Expose for chart modules that read CSS vars directly
    // (e.g. scary-terms, map panels) via ns.resolveCssVar —
    // they should route their color reads through this so they
    // never hand ECharts an unparseable `calc()` / color-mix().
    ns.resolveCssColor = resolveCssColor;

    /** Read a CSS color variable and resolve it to a parseable rgb(). */
    function readColorVar(name) {
        return resolveCssColor(readVar(name));
    }
    ns.readColorVar = readColorVar;

    /**
     * Apply an alpha to an already-resolved color string. Inputs are
     * expected to be `rgb(r, g, b)` (the form `resolveCssColor` returns);
     * `rgba(...)` and `#hex` are also accepted. Returns a flat
     * `rgba(r, g, b, a)` that ECharts' color parser fully understands —
     * crucially, it survives ECharts' internal color manipulations
     * (lift/darken on hover/emphasis), unlike runtime `color-mix(...)`
     * strings which canvas2d will fill directly but ECharts cannot
     * deconstruct.
     *
     * Use this for any chart color that needs to vary in opacity off a
     * theme token — never inline `color-mix()` in a chart string.
     */
    function withAlpha(color, alpha) {
        if (!color || typeof color !== 'string') return color;
        var a = Math.max(0, Math.min(1, Number(alpha)));
        // rgb(r, g, b) | rgba(r, g, b, ?)
        var m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
        if (m) {
            return 'rgba(' + m[1] + ', ' + m[2] + ', ' + m[3] + ', ' + a + ')';
        }
        // #rgb / #rrggbb — expand and convert
        var hex = /^#([0-9a-f]{3,8})$/i.exec(color);
        if (hex) {
            var h = hex[1];
            if (h.length === 3 || h.length === 4) {
                h = h.split('').map(function (c) { return c + c; }).join('');
            }
            var r = parseInt(h.slice(0, 2), 16);
            var g = parseInt(h.slice(2, 4), 16);
            var b = parseInt(h.slice(4, 6), 16);
            return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
        }
        // Fallback: round-trip through the browser via resolveCssColor,
        // then retry. Covers named colors, color(srgb ...), oklch(...).
        var resolved = resolveCssColor(color);
        if (resolved !== color) return withAlpha(resolved, alpha);
        return color;
    }
    ns.withAlpha = withAlpha;

    /**
     * Read the current IWAC theme tokens from CSS custom properties on
     * document.body. Every token is routed through `resolveCssColor`
     * so ECharts receives parseable rgb() values — this is what stops
     * single-series bars from disappearing on hover. Unresolvable
     * values fall back to the appropriate FALLBACK_* object based on
     * the current mode.
     */
    function readTokens() {
        var mode = ns.getCurrentTheme(); // 'light' | 'dark'
        var fallback = mode === 'dark' ? FALLBACK_DARK : FALLBACK_LIGHT;
        return {
            primary:       readColorVar('--primary')        || fallback.primary,
            ink:           readColorVar('--ink')            || fallback.ink,
            inkLight:      readColorVar('--ink-light')      || fallback.inkLight,
            muted:         readColorVar('--muted')          || fallback.muted,
            surface:       readColorVar('--surface')        || fallback.surface,
            surfaceRaised: readColorVar('--surface-raised') || fallback.surfaceRaised,
            background:    readColorVar('--background')     || fallback.background,
            border:        readColorVar('--border')         || fallback.border,
            borderLight:   readColorVar('--border-light')   || fallback.borderLight,
            // Inherits whatever the theme's body font-family is, so charts
            // never visibly clash with surrounding type. Stack fallback
            // matches theme v2.0.0 (Public Sans).
            fontFamily:    readBodyFont() || '"Public Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Theme object builder                                              */
    /* ----------------------------------------------------------------- */

    /** Build a palette with --primary in the first slot. */
    function buildPalette(tokens) {
        return [tokens.primary].concat(PALETTE_REST);
    }

    /** Build an ECharts theme object from the IWAC tokens. */
    function buildTheme(tokens) {
        var palette = buildPalette(tokens);
        var tooltipBg = tokens.surface;
        return {
            color: palette,
            backgroundColor: 'transparent',
            // Accessibility — ECharts generates an aria-label summary of
            // every chart unless a caller explicitly disables it.
            aria: { enabled: true },
            textStyle: {
                color: tokens.ink,
                fontFamily: tokens.fontFamily
            },
            title: {
                textStyle: { color: tokens.ink, fontWeight: 600 },
                subtextStyle: { color: tokens.muted }
            },
            legend: {
                textStyle: { color: tokens.inkLight },
                inactiveColor: tokens.border
            },
            tooltip: {
                backgroundColor: tooltipBg,
                borderColor: tokens.border,
                borderWidth: 1,
                textStyle: { color: tokens.ink },
                // Radius matches theme v2.0.0 --radius-md (8px, tightened
                // from 12px in v1.x for an institutional register).
                extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.12); border-radius: 8px;',
                // Prevent hover tooltips from being clipped by panels with
                // `overflow: hidden` (recent-additions scrollbox, grid
                // cells) or extending beyond the chart on narrow screens.
                // `appendTo: 'body'` escapes ancestor overflow clipping
                // (ECharts ≥ 5.5); `confine: true` then keeps the tooltip
                // within the chart's own view rect so it doesn't drift off
                // the page on mobile. Both are theme-level defaults so
                // every builder inherits without per-call configuration.
                confine: true,
                appendTo: 'body'
            },
            axisPointer: {
                lineStyle: { color: tokens.muted },
                crossStyle: { color: tokens.muted }
            },
            categoryAxis: {
                axisLine:  { show: true,  lineStyle: { color: tokens.border } },
                axisTick:  { show: true,  lineStyle: { color: tokens.border } },
                axisLabel: { show: true,  color: tokens.inkLight },
                splitLine: { show: false, lineStyle: { color: [tokens.borderLight] } },
                splitArea: { show: false }
            },
            valueAxis: {
                axisLine:  { show: false },
                axisTick:  { show: false },
                axisLabel: { show: true,  color: tokens.inkLight },
                splitLine: { show: true,  lineStyle: { color: [tokens.borderLight] } },
                splitArea: { show: false }
            },
            logAxis: {
                axisLine:  { show: false },
                axisTick:  { show: false },
                axisLabel: { show: true,  color: tokens.inkLight },
                splitLine: { show: true,  lineStyle: { color: [tokens.borderLight] } }
            },
            timeAxis: {
                axisLine:  { show: true, lineStyle: { color: tokens.border } },
                axisTick:  { show: true, lineStyle: { color: tokens.border } },
                axisLabel: { show: true, color: tokens.inkLight },
                splitLine: { show: true, lineStyle: { color: [tokens.borderLight] } }
            },
            toolbox: {
                iconStyle: { borderColor: tokens.muted },
                emphasis:  { iconStyle: { borderColor: tokens.ink } }
            },
            timeline: {
                lineStyle:        { color: tokens.border },
                itemStyle:        { color: tokens.primary, borderColor: tokens.primary },
                controlStyle:     { color: tokens.inkLight, borderColor: tokens.border },
                checkpointStyle:  { color: tokens.primary, borderColor: tokens.surface },
                label:            { color: tokens.inkLight },
                emphasis: {
                    itemStyle:    { color: tokens.primary },
                    controlStyle: { color: tokens.ink, borderColor: tokens.muted },
                    label:        { color: tokens.ink }
                }
            },
            visualMap: {
                textStyle: { color: tokens.inkLight },
                color: [tokens.primary, tokens.surfaceRaised]
            },
            dataZoom: {
                backgroundColor:     'transparent',
                dataBackgroundColor: tokens.borderLight,
                // 18% primary on transparent — composed via withAlpha (NOT
                // color-mix) so ECharts' internal parser can deconstruct it.
                fillerColor:         withAlpha(tokens.primary, 0.18),
                handleColor:         tokens.primary,
                handleSize:          '100%',
                textStyle:           { color: tokens.inkLight },
                borderColor:         tokens.border
            },
            graph: {
                color: palette,
                itemStyle: { borderColor: tokens.surface },
                lineStyle: { color: tokens.border },
                label: { color: tokens.ink }
            }
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Current theme detection                                           */
    /* ----------------------------------------------------------------- */

    /**
     * Resolve the current theme mode from body[data-theme], falling back to
     * the OS `prefers-color-scheme` media query. Returns 'light' or 'dark'.
     */
    ns.getCurrentTheme = function () {
        var explicit = document.body && document.body.getAttribute('data-theme');
        if (explicit === 'light' || explicit === 'dark') return explicit;
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    };

    /** Return the ECharts theme name for `echarts.init(el, <theme>)`. */
    ns.getChartTheme = function () {
        return 'iwac-' + ns.getCurrentTheme();
    };

    /**
     * Return the token object currently in use (last refresh). Useful for
     * MapLibre, D3, or raw DOM code that can't use ECharts theme registration.
     */
    ns.getChartTokens = function () {
        return ns._currentTokens || readTokens();
    };

    /**
     * Return the full qualitative series palette (with --primary in slot 0)
     * for callers that need to assign stable per-item colors outside of
     * ECharts' built-in per-series cycling. Used by charts that render a
     * single series with individually-colored data points (e.g. the Scary
     * Terms block's 12 term families).
     */
    ns.getPalette = function () {
        var tokens = ns._currentTokens || readTokens();
        return buildPalette(tokens);
    };

    /** CartoCDN basemap URL matching the current theme. */
    ns.getBasemapStyle = function () {
        return ns.getCurrentTheme() === 'dark'
            ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
            : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
    };

    /* ----------------------------------------------------------------- */
    /*  Registration                                                      */
    /* ----------------------------------------------------------------- */

    /**
     * Read the current CSS custom properties and re-register both
     * iwac-light and iwac-dark ECharts themes. Safe to call repeatedly —
     * ECharts overwrites existing registrations.
     *
     * Returns the theme object for the currently active mode (for callers
     * that want to inspect / extend it).
     */
    ns.refreshThemes = function () {
        if (typeof echarts === 'undefined') return null;
        var tokens = readTokens();
        ns._currentTokens = tokens;
        // Same tokens power both registered names for the current mode —
        // the "other" mode will be refreshed when the user flips the toggle.
        // Registering both names keeps ECharts happy when initChart() asks
        // for whichever name corresponds to the current body[data-theme].
        var theme = buildTheme(tokens);
        echarts.registerTheme(ns.getChartTheme(), theme);
        return theme;
    };

    /* ----------------------------------------------------------------- */
    /*  Eager + deferred initialization                                   */
    /* ----------------------------------------------------------------- */

    // Attempt immediate registration. At parse time the body may not yet
    // have `data-theme` set (theme-toggle.js runs on DOMContentLoaded), so
    // we also schedule a refresh once the DOM is ready to pick up the
    // post-toggle state.
    ns.refreshThemes();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ns.refreshThemes, { once: true });
    }
})();
