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
    // custom properties don't resolve. Mirrors _colors.scss defaults.
    var FALLBACK_LIGHT = {
        primary:       '#e67a14',
        ink:           '#18202a',
        inkLight:      '#4a5766',
        muted:         '#6e7a82',
        surface:       '#fdfdfc',
        surfaceRaised: '#f9f7f3',
        background:    '#f5f3ee',
        border:        '#dcd7ce',
        borderLight:   '#ebe7df'
    };
    var FALLBACK_DARK = {
        primary:       '#ea8c2e',
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
     * Read the current IWAC theme tokens from CSS custom properties on
     * document.body. Unresolvable values fall back to the appropriate
     * FALLBACK_* object based on the current mode.
     */
    function readTokens() {
        var mode = ns.getCurrentTheme(); // 'light' | 'dark'
        var fallback = mode === 'dark' ? FALLBACK_DARK : FALLBACK_LIGHT;
        return {
            primary:       readVar('--primary')        || fallback.primary,
            ink:           readVar('--ink')             || fallback.ink,
            inkLight:      readVar('--ink-light')       || fallback.inkLight,
            muted:         readVar('--muted')           || fallback.muted,
            surface:       readVar('--surface')         || fallback.surface,
            surfaceRaised: readVar('--surface-raised')  || fallback.surfaceRaised,
            background:    readVar('--background')      || fallback.background,
            border:        readVar('--border')          || fallback.border,
            borderLight:   readVar('--border-light')    || fallback.borderLight
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
                fillerColor:         'color-mix(in srgb, ' + tokens.primary + ' 18%, transparent)',
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
