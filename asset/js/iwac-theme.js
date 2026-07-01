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
 * Theme switching uses `chart.setTheme()` — supported in ECharts 6.0.0+ —
 * orchestrated from dashboard-core.js so individual chart modules don't
 * each register a theme observer. This file exposes:
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
    // custom properties don't resolve. These mirror the theme's RESOLVED
    // tokens (IWAC-theme/tokens.json, generated from _colors.scss) — OKLCH
    // cool-neutral surfaces (NOT cream); `primary` is the working --primary
    // (#ce4115 = seed #e64a19 darkened 8% in oklab), not the raw seed. The
    // check-theme-tokens guard fails the build if any value drifts from
    // tokens.json — keep them in sync via `npm run build:tokens` in the theme.
    var FALLBACK_LIGHT = {
        primary:       '#ce4115',  // --primary = mix(#e64a19, black 8%)
        secondary:     '#394f68',  // --secondary = seed (slate; 2nd data colour)
        ink:           '#13161c',  // oklch(20% 0.012 264)
        inkLight:      '#3f4349',  // oklch(38% 0.012 260)
        muted:         '#66696e',  // oklch(52% 0.008 256)
        surface:       '#fdfcfb',  // oklch(99.2% 0.002 60)  near-white, not cream
        surfaceRaised: '#faf8f6',  // oklch(98.0% 0.003 60)
        background:    '#f7f5f3',  // oklch(97.0% 0.003 60)
        border:        '#ced1d6',  // oklch(86% 0.007 258) cool-neutral
        borderLight:   '#e2e5e8'   // oklch(92% 0.005 258)
    };
    var FALLBACK_DARK = {
        // Warm "lamplit reading room" dark set (theme v2.6 — hue ~70-80,
        // chroma ~0.012) replacing the old blue-cool dark palette.
        primary:       '#ec653f',  // mix(--primary-base, white 12%) in oklab
        secondary:     '#708093',  // mix(--secondary-base, white 30%) in oklab
        ink:           '#e7e4df',  // oklch(92% 0.008 78)
        inkLight:      '#b5b0aa',  // oklch(76% 0.010 75)
        muted:         '#8a8580',  // oklch(62% 0.010 70)
        surface:       '#110c08',  // oklch(16% 0.012 70)
        surfaceRaised: '#1a1510',  // oklch(20% 0.013 70)
        background:    '#080503',  // oklch(12% 0.012 75)
        border:        '#352f28',  // oklch(31% 0.015 70)
        borderLight:   '#26211a'   // oklch(25% 0.014 70)
    };

    /* ----------------------------------------------------------------- */
    /*  Qualitative palette                                               */
    /* ----------------------------------------------------------------- */

    /**
     * Categorical series colours used after the two theme-driven slots.
     * buildPalette() prepends --primary (slot 0) and --secondary (slot 1),
     * so PALETTE_REST[0] (#394f68) is the slate's hardcoded twin and is
     * skipped via slice(1). The remaining hues are hand-picked to read well
     * in both light and dark themes. These are SANCTIONED, module-owned data
     * colours (data encoding needs more distinct hues than a UI theme should
     * carry) — see IWAC-theme/docs/DESIGN-SYSTEM.md, "chart-palette exception".
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

    /* ------------------------------------------------------------- */
    /*  Pure-JS oklab / oklch / color(srgb …) → legacy rgb           */
    /* ------------------------------------------------------------- */
    //
    // Why this exists: ECharts' zrender parser only understands CSS
    // Color Module Level 3 (hex, rgb, hsl, named). On normal render
    // the browser resolves whatever string we hand fillStyle, but for
    // hover emphasis ECharts itself calls `color.lift(seriesColor)`
    // which calls `color.parse(seriesColor)`. Parse returns undefined
    // for oklab/oklch/color(srgb), lift returns undefined, and the
    // hovered shape is drawn with no fill — the orange bar visibly
    // "disappears" on hover.
    //
    // After IWAC theme v2.0.0 reframed tokens around OKLCH:
    //     --ink:     oklch(20% 0.012 264);
    //     --primary: color-mix(in oklab, var(--primary-base), black 8%);
    // modern Chromium serializes `getComputedStyle(probe).color` AS
    // oklab() / oklch() — not rgb(). Probe round-trip alone no longer
    // produces a parseable result.
    //
    // The fix: parse oklab() / oklch() / color(srgb) ourselves and
    // emit legacy rgb()/rgba(). Pure math, no canvas (Brave Shields
    // and other anti-fingerprinting layers can corrupt canvas reads),
    // no DOM, deterministic.

    function _clip01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    // Linear sRGB → sRGB (gamma encode)
    function _linearToSrgb(v) {
        v = _clip01(v);
        return v >= 0.0031308
            ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055
            : 12.92 * v;
    }

    // Oklab → linear sRGB (Björn Ottosson's reference matrix)
    function _oklabToLinearSrgb(L, a, b) {
        var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
        var l = l_ * l_ * l_;
        var m = m_ * m_ * m_;
        var s = s_ * s_ * s_;
        return [
             4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
        ];
    }

    // Parse a CSS number that may be `0.94`, `94%`, etc.
    function _num(s, base) {
        s = String(s).trim();
        if (s.slice(-1) === '%') return parseFloat(s) / 100 * (base || 1);
        return parseFloat(s);
    }

    // Build an "rgb(...)" or "rgba(...)" from float linear sRGB triple
    // and an alpha 0..1. Clips out-of-gamut to [0,1].
    function _emitRgbFromLinear(rL, gL, bL, alpha) {
        var r = Math.round(_linearToSrgb(rL) * 255);
        var g = Math.round(_linearToSrgb(gL) * 255);
        var b = Math.round(_linearToSrgb(bL) * 255);
        if (r < 0) r = 0; if (r > 255) r = 255;
        if (g < 0) g = 0; if (g > 255) g = 255;
        if (b < 0) b = 0; if (b > 255) b = 255;
        if (alpha != null && alpha < 1) {
            return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
        }
        return 'rgb(' + r + ', ' + g + ', ' + b + ')';
    }

    // Match  oklab( L A B [ / alpha ] )   space- or comma-separated
    var _oklabRe = /^oklab\(\s*([\d.eE+\-%]+)[\s,]+([\d.eE+\-%]+)[\s,]+([\d.eE+\-%]+)(?:\s*\/\s*([\d.eE+\-%]+))?\s*\)$/i;
    // Match  oklch( L C H [ / alpha ] )
    var _oklchRe = /^oklch\(\s*([\d.eE+\-%]+)[\s,]+([\d.eE+\-%]+)[\s,]+([\d.eE+\-%]+)(?:deg)?(?:\s*\/\s*([\d.eE+\-%]+))?\s*\)$/i;
    // Match  color(srgb r g b [ / alpha ] )
    var _csrgbRe = /^color\(\s*srgb\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)(?:\s*\/\s*([\d.eE+\-]+))?\s*\)$/i;

    function _convertModernColor(s) {
        var m = _oklabRe.exec(s);
        if (m) {
            var L = _num(m[1], 1);   // 0..1 (or %)
            var a = _num(m[2], 0.4); // unitless (rough scale ~0.4)
            var b = _num(m[3], 0.4);
            var alpha = m[4] != null ? _num(m[4], 1) : 1;
            var lin = _oklabToLinearSrgb(L, a, b);
            return _emitRgbFromLinear(lin[0], lin[1], lin[2], alpha);
        }
        m = _oklchRe.exec(s);
        if (m) {
            var L2 = _num(m[1], 1);
            var C  = _num(m[2], 0.4);
            var H  = _num(m[3], 360);   // already degrees
            var alpha2 = m[4] != null ? _num(m[4], 1) : 1;
            var hRad = H * Math.PI / 180;
            var aLab = C * Math.cos(hRad);
            var bLab = C * Math.sin(hRad);
            var lin2 = _oklabToLinearSrgb(L2, aLab, bLab);
            return _emitRgbFromLinear(lin2[0], lin2[1], lin2[2], alpha2);
        }
        m = _csrgbRe.exec(s);
        if (m) {
            var rByte = Math.round(_clip01(parseFloat(m[1])) * 255);
            var gByte = Math.round(_clip01(parseFloat(m[2])) * 255);
            var bByte = Math.round(_clip01(parseFloat(m[3])) * 255);
            var aSrgb = m[4] != null ? parseFloat(m[4]) : 1;
            if (aSrgb < 1) {
                return 'rgba(' + rByte + ', ' + gByte + ', ' + bByte + ', ' + aSrgb + ')';
            }
            return 'rgb(' + rByte + ', ' + gByte + ', ' + bByte + ')';
        }
        return null;
    }

    /**
     * Resolve a CSS color string to a Color-3-legal `rgb(...)` /
     * `rgba(...)` that ECharts AND MapLibre's style validator both
     * accept. Strategy:
     *   1. hex / rgb / rgba — fast-pass.
     *   2. probe round-trip via getComputedStyle for hsl/calc/var/color-mix.
     *   3. if the round-trip yields oklab / oklch / color(srgb), convert
     *      via pure JS math (Oklab → linear sRGB → sRGB).
     *   4. fallback: return the round-tripped string (anything ECharts
     *      already understood: rgb, hsl, named).
     *
     * No canvas — anti-fingerprinting layers (Brave Shields) can
     * corrupt canvas pixel reads, which would silently produce wrong
     * colors and break ECharts hover lifts.
     */
    function resolveCssColor(value) {
        if (!value || typeof value !== 'string') return value;
        var trimmed = value.trim();
        if (!trimmed) return trimmed;
        if (/^#([0-9a-f]{3}){1,2}$/i.test(trimmed)) return trimmed;
        if (/^rgba?\(/i.test(trimmed)) return trimmed;

        // Direct math conversion if the input is already a modern form
        var direct = _convertModernColor(trimmed);
        if (direct) return direct;

        var probe = _getColorProbe();
        if (!probe) return trimmed;
        try {
            // Two-sentinel invalid-value guard. When `trimmed` is NOT a colour
            // the browser can parse, `style.color = trimmed` is silently
            // ignored and the probe keeps its previous value. A valid colour
            // overrides BOTH sentinels to the same resolved rgb(); an invalid
            // one leaves the two distinct sentinels untouched. In that case we
            // return '' so the CALLER's `|| fallback` fires — instead of
            // handing back the probe's default rgb(0,0,0), which is what made
            // a single corrupted CSS var (e.g. an embed that mis-escaped
            // `--primary` to `&#x23`) render every chart series solid black.
            probe.style.color = 'rgb(1, 1, 1)';
            probe.style.color = trimmed;
            var r1 = getComputedStyle(probe).color;
            probe.style.color = 'rgb(2, 2, 2)';
            probe.style.color = trimmed;
            var r2 = getComputedStyle(probe).color;
            if (r1 !== r2) return '';           // unparseable — let caller fall back
            var resolved = r1;
            if (!resolved) return trimmed;
            if (/^rgba?\(/i.test(resolved)) return resolved;
            // Modern Chromium can emit oklab() / oklch() / color(srgb)
            // for color-mix() / oklch() / hsl(modern syntax) inputs.
            var converted = _convertModernColor(resolved);
            return converted || resolved;
        } catch (e) {
            return trimmed;
        }
    }
    // Exposed for callers that want to convert raw strings (not only
    // CSS variables) — e.g. tokens.primary that already came from
    // readTokens() but is being repurposed as a MapLibre paint value.
    ns._convertModernColor = _convertModernColor;
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
            secondary:     readColorVar('--secondary')      || fallback.secondary,
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

    /**
     * Build the categorical palette. Slot 0 = --primary (brand), slot 1 =
     * --secondary (the shared slate); then the hand-picked categorical hues.
     * PALETTE_REST[0] is the slate's hardcoded twin, so slice(1) avoids
     * emitting it twice when --secondary resolves to that same value.
     */
    function buildPalette(tokens) {
        return [tokens.primary, tokens.secondary].concat(PALETTE_REST.slice(1));
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
