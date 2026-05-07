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
    // IWAC theme v1.7.0+ (hue 22 primary, warm neutral surfaces).
    var FALLBACK_LIGHT = {
        primary:       '#d86a11',
        ink:           '#1c232d',
        inkLight:      '#4a5766',
        muted:         '#707f86',
        surface:       '#fdfcfa',
        surfaceRaised: '#f7f4ee',
        background:    '#f1ede3',
        border:        '#dad5cb',
        borderLight:   '#e8e3d9'
    };
    var FALLBACK_DARK = {
        primary:       '#ee8f30',
        ink:           '#f2f5f9',
        inkLight:      '#aab4bf',
        muted:         '#969ca4',
        surface:       '#191d24',
        surfaceRaised: '#1e2229',
        background:    '#13171d',
        border:        '#31363e',
        borderLight:   '#272b33'
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
    function resolveCssColor(value) {
        if (!value || typeof value !== 'string') return value;
        var trimmed = value.trim();
        if (!trimmed) return trimmed;
        // Fast path — hex / rgb / rgba don't need round-tripping and
        // the probe append/reflow is the expensive part of this fn.
        if (/^#([0-9a-f]{3}){1,2}$/i.test(trimmed)) return trimmed;
        if (/^rgba?\(/i.test(trimmed)) return trimmed;

        var probe = _getColorProbe();
        if (!probe) return trimmed;
        try {
            probe.style.color = '';
            probe.style.color = trimmed;
            var resolved = getComputedStyle(probe).color;
            return resolved || trimmed;
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
            borderLight:   readColorVar('--border-light')   || fallback.borderLight
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
                fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
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
                extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.12); border-radius: 6px;',
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
                fillerColor:         'color-mix(in oklab, ' + tokens.primary + ' 18%, transparent)',
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
