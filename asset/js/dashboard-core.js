/**
 * IWAC Visualizations — Dashboard core
 *
 * Bootstraps the `window.IWACVis` namespace, wires chart initialization
 * through the IWAC ECharts theme (iwac-theme.js) and i18n helper
 * (iwac-i18n.js), and watches `body[data-theme]` so that ECharts and
 * MapLibre instances re-render when the user toggles light/dark mode.
 *
 * Load order (set by Module.php):
 *   1. https://cdn.jsdelivr.net/npm/echarts@6/...
 *   2. asset/js/iwac-i18n.js     (no deps)
 *   3. asset/js/iwac-theme.js    (needs echarts)
 *   4. asset/js/dashboard-core.js (this file — needs all of the above)
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};

    // Cache-buster appended by P.fetchJSON (shared/panels.js) to every data
    // request. It combines two versions:
    //   1. the module version, parsed from this script's own `?v=` (Omeka's
    //      assetUrl appends `?v=<config/module.ini version>` to module assets);
    //   2. the data version — the last Sync Data time, stamped on every
    //      .iwac-vis-block as `data-version` by iwac-block-shell.phtml.
    // Data now lives in files/iwac-visualizations/ and is refreshed by the
    // admin Sync Data job WITHOUT a module bump (issue #7), so folding in the
    // data version is what busts stale data caches on a fresh pull. Either may
    // be absent (no `?v=`, or pre-first-sync) — we use whichever exist.
    // document.currentScript is set during execution of classic scripts,
    // including ones the on-view lazy loader injects async=false.
    (function () {
        var el = document.currentScript;
        var m = el && el.src ? /[?&]v=([^&#]+)/.exec(el.src) : null;
        var moduleV = m ? decodeURIComponent(m[1]) : '';
        var block = document.querySelector('.iwac-vis-block[data-version]');
        var dataV = block ? block.getAttribute('data-version') : '';
        ns.assetVersion = dataV
            ? (moduleV ? moduleV + '-' + dataV : dataV)
            : moduleV;
    })();

    function debounce(fn, ms) {
        var timer;
        return function () {
            if (timer) clearTimeout(timer);
            timer = setTimeout(fn, ms);
        };
    }

    // Ensure themes are registered even if iwac-theme.js loaded before ECharts.
    if (typeof ns.registerEChartsThemes === 'function') {
        ns.registerEChartsThemes();
    }

    /* ----------------------------------------------------------------- */
    /*  Chart tracking                                                    */
    /* ----------------------------------------------------------------- */

    /**
     * Each registered chart is an object of the form
     *   { el, render, instance, kind }
     * where `render(el, instance)` is called with a fresh instance after
     * theme changes. `kind` is 'echarts' | 'maplibre' — other types
     * can be added later.
     */
    ns._charts = [];

    /**
     * Merge a baseline aria config into a chart AFTER its render callback
     * ran. Render callbacks rebuild the whole option with
     * `setOption(option, true)` (notMerge), which would discard anything
     * injected earlier — applying aria as a follow-up merge survives that
     * pattern, and the theme-swap path re-applies it after each re-render.
     * `aria.enabled` makes ECharts generate a screen-reader description
     * of the chart (series, types, data extent) on the canvas element.
     * Zero visual change — decal patterns stay off (see ROADMAP 4.5/7.2).
     */
    ns._applyAria = function (instance) {
        if (!instance || instance.isDisposed()) return;
        try {
            instance.setOption({ aria: { enabled: true } });
        } catch (e) { /* enhancement only — never let aria break a render */ }
    };

    /**
     * Create an ECharts instance with the current IWAC theme applied.
     * Returns the ECharts instance. Caller is responsible for setOption().
     * Not normally called directly — prefer `ns.registerChart()`.
     */
    ns.initChart = function (el) {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis: ECharts not loaded');
            return null;
        }
        return echarts.init(el, ns.getChartTheme ? ns.getChartTheme() : null);
    };

    /**
     * Register a chart so it re-renders on theme change.
     *
     * @param {HTMLElement} el
     * @param {function(HTMLElement, echarts.ECharts): void} render
     *   Called with (el, instance) on first render and after every theme swap.
     *   Typically this calls `instance.setOption({...})`.
     * @returns {echarts.ECharts|null}
     */
    ns.registerChart = function (el, render) {
        var instance = ns.initChart(el);
        if (!instance) return null;
        var entry = { el: el, render: render, instance: instance, kind: 'echarts' };

        if (typeof ResizeObserver !== 'undefined') {
            var ro = new ResizeObserver(debounce(function () {
                if (entry.instance && !entry.instance.isDisposed()) {
                    entry.instance.resize({
                        animation: { duration: 200, easing: 'cubicOut' }
                    });
                }
            }, 150));
            ro.observe(el.parentElement || el);
            entry._resizeObserver = ro;
        }

        ns._charts.push(entry);
        try { render(el, instance); } catch (e) { console.error('IWACVis: render failed', e); }
        ns._applyAria(instance);

        // Auto-attach the shared panel toolbar (download button) if the
        // panel-toolbar module is loaded and the chart lives inside a
        // `.iwac-vis-panel` wrapper. Silently no-ops if either is absent.
        if (ns.panels && typeof ns.panels.autoAttachPanelToolbar === 'function') {
            try { ns.panels.autoAttachPanelToolbar(el); }
            catch (e) { console.error('IWACVis: panel toolbar attach failed', e); }
        }
        return instance;
    };

    /**
     * Return the currently-live ECharts instance for a given container,
     * or null if the chart is not tracked or has been disposed. Theme
     * swaps dispose + re-init the instance, so any caller that needs to
     * read data from the chart after registration time must go through
     * this lookup rather than closing over the original return value.
     */
    ns.getLiveChart = function (el) {
        for (var i = 0; i < ns._charts.length; i++) {
            var entry = ns._charts[i];
            if (entry.el !== el || entry.kind !== 'echarts') continue;
            if (entry.instance && !entry.instance.isDisposed()) return entry.instance;
            return null;
        }
        return null;
    };

    /**
     * Register a MapLibre GL map so it gets a new basemap style on theme change.
     *
     * @param {maplibregl.Map} map
     * @param {HTMLElement} [el]  Optional container reference (for dispose tracking)
     */
    ns.registerMap = function (map, el) {
        if (!map) return;
        ns._charts.push({ el: el || null, instance: map, kind: 'maplibre' });

        // Auto-attach the shared panel toolbar (download button) to map
        // panels too, using the same closest-panel lookup as ECharts.
        // Silent no-op when panel-toolbar.js didn't load or the map
        // container isn't inside a `.iwac-vis-panel`.
        if (el && ns.panels && typeof ns.panels.autoAttachPanelToolbar === 'function') {
            try { ns.panels.autoAttachPanelToolbar(el); }
            catch (e) { console.error('IWACVis: panel toolbar attach failed', e); }
        }
    };

    /**
     * Return the currently-live MapLibre instance for a given container,
     * or null if the map is not tracked or has been removed. Used by
     * the panel-toolbar download button to capture the current canvas
     * without closing over a stale reference.
     */
    ns.getLiveMap = function (el) {
        for (var i = 0; i < ns._charts.length; i++) {
            var entry = ns._charts[i];
            if (entry.el !== el || entry.kind !== 'maplibre') continue;
            if (entry.instance && !entry.instance._removed) return entry.instance;
            return null;
        }
        return null;
    };

    /** Remove disposed/detached charts from the tracking array. */
    ns.pruneCharts = function () {
        ns._charts = ns._charts.filter(function (c) {
            var alive = false;
            if (c.kind === 'echarts') alive = c.instance && !c.instance.isDisposed();
            else if (c.kind === 'maplibre') alive = c.instance && !c.instance._removed;
            if (!alive && c._resizeObserver) {
                c._resizeObserver.disconnect();
                c._resizeObserver = null;
            }
            return alive;
        });
    };

    /* ----------------------------------------------------------------- */
    /*  Theme change handling                                             */
    /* ----------------------------------------------------------------- */

    /**
     * Re-render every tracked chart against the current theme.
     *
     * For ECharts we rebuild the theme from the current CSS variables
     * (via refreshThemes) and then call `instance.setTheme()` — supported
     * since ECharts 6.0.0 — followed by re-running the registered render
     * callback. setTheme alone preserves DOM state (no detach / reattach
     * flash, no re-init cost), and re-rendering immediately afterwards
     * picks up any theme tokens that callers baked into their option
     * literal via `getChartTokens()`. The ECharts 6 caveat ("multiple
     * setOption merge calls before setTheme are discarded") doesn't bite
     * us because the render callback always rebuilds the option from
     * scratch with `setOption(..., true)` — the canonical IWAC pattern.
     *
     * For MapLibre we swap the style URL. The `createIwacMap` factory
     * registers an `onStyleReady` callback that re-runs on every
     * `style.load`, so custom sources / layers / markers get rebuilt
     * automatically after the basemap swap.
     */
    ns.applyThemeToCharts = function () {
        if (typeof ns.refreshThemes === 'function') ns.refreshThemes();
        ns.pruneCharts();
        var themeName = ns.getChartTheme ? ns.getChartTheme() : null;
        ns._charts.forEach(function (entry) {
            if (entry.kind === 'echarts') {
                if (!entry.instance || entry.instance.isDisposed()) return;
                try {
                    if (themeName && typeof entry.instance.setTheme === 'function') {
                        entry.instance.setTheme(themeName);
                    }
                    if (typeof entry.render === 'function' && entry.el) {
                        entry.render(entry.el, entry.instance);
                        ns._applyAria(entry.instance);
                    }
                } catch (e) {
                    console.error('IWACVis: theme swap failed', e);
                }
            } else if (entry.kind === 'maplibre') {
                try {
                    // Route through P.setMapTheme when shared/maplibre.js
                    // is loaded — gives us the per-map no-op cache so a
                    // theme attribute write that didn't actually change
                    // the value can't blow away custom layers.
                    var maps = ns.panels;
                    var mode = ns.getCurrentTheme ? ns.getCurrentTheme() : 'light';
                    if (maps && typeof maps.setMapTheme === 'function') {
                        maps.setMapTheme(entry.instance, mode);
                    } else {
                        entry.instance.setStyle(ns.getBasemapStyle());
                    }
                } catch (e) { console.error('IWACVis: basemap swap failed', e); }
            }
        });
    };

    /* ----------------------------------------------------------------- */
    /*  body[data-theme] observer                                         */
    /* ----------------------------------------------------------------- */

    var _lastTheme = ns.getCurrentTheme ? ns.getCurrentTheme() : 'light';

    function handleThemeChange() {
        var now = ns.getCurrentTheme();
        if (now === _lastTheme) return;
        _lastTheme = now;
        ns.applyThemeToCharts();
    }

    function observeTheme() {
        var observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].attributeName === 'data-theme') {
                    handleThemeChange();
                    break;
                }
            }
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });

        // Follow OS pref too, but only while no explicit body attribute is set.
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
                if (!document.body.getAttribute('data-theme')) handleThemeChange();
            });
        }
    }

    /* ----------------------------------------------------------------- */
    /*  Window resize -> chart.resize()                                   */
    /* ----------------------------------------------------------------- */
    //
    // ECharts canvases do NOT auto-resize when their container shrinks or
    // grows. Without this, the chart keeps its initial pixel size and
    // overflows its grid cell on window resize. Debounced so we don't
    // thrash during the drag.

    var handleWindowResize = debounce(function () {
        ns.pruneCharts();
        ns._charts.forEach(function (entry) {
            try {
                // ECharts entries with a per-chart ResizeObserver are already
                // handled by that observer — skip them here to avoid double resize.
                if (entry.kind === 'echarts' && entry.instance && !entry._resizeObserver) {
                    entry.instance.resize();
                } else if (entry.kind === 'maplibre' && entry.instance) {
                    entry.instance.resize();
                }
            } catch (e) {
                // Swallow — a disposed chart shouldn't take the whole page down
            }
        });
    }, 120);

    function observeResize() {
        window.addEventListener('resize', handleWindowResize, { passive: true });
    }

    function bootstrapObservers() {
        observeTheme();
        observeResize();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapObservers);
    } else {
        bootstrapObservers();
    }

    /* ----------------------------------------------------------------- */
    /*  Shared helpers                                                    */
    /* ----------------------------------------------------------------- */

    /**
     * Resolve a CSS custom property to a concrete color string that
     * ECharts' color parser can understand (`rgb(...)` / `rgba(...)`).
     *
     * Why this exists: our theme ramps under iwac-core.css
     * (--iwac-vis-heatmap-0..4, --iwac-vis-cent-*, --iwac-vis-subj-*)
     * are defined as `color-mix(in oklab, var(--primary), var(--surface))`
     * expressions so they track the IWAC theme's --primary / --surface
     * tokens. Two things conspire against ECharts here:
     *   1. `getPropertyValue('--x')` returns the raw source — ECharts has
     *      no idea what `color-mix(...)` means and falls back to grayscale.
     *   2. `getComputedStyle(probe).color` DOES compute the expression,
     *      but modern Chromium serializes the result as
     *      `color(srgb 0.98 0.93 0.92)` (CSS Color Module Level 4).
     *      ECharts' parser doesn't understand `color()` either.
     * So we force the browser to compute the expression via an offscreen
     * probe, then if the result comes back as `color(srgb ...)`, parse it
     * ourselves and emit legacy `rgb()` / `rgba()`.
     *
     * @param {string} varName  e.g. '--iwac-vis-heatmap-2'
     * @returns {string} legacy-rgb color, or '' if undefined / unresolvable
     */
    ns.resolveCssVar = function (varName) {
        if (typeof document === 'undefined' || !document.body) return '';
        var probe = document.createElement('span');
        probe.style.cssText =
            'position:absolute;visibility:hidden;width:0;height:0;' +
            'color:var(' + varName + ',transparent)';
        document.body.appendChild(probe);
        var resolved = getComputedStyle(probe).color;
        document.body.removeChild(probe);
        if (!resolved || resolved === 'rgba(0, 0, 0, 0)') return '';

        // rgb / rgba are already Color-3-legal — fast path.
        if (/^rgba?\(/i.test(resolved)) return resolved;

        // After IWAC theme v2.0.0 reframed tokens around OKLCH, modern
        // Chromium serializes `color-mix(in oklab, …)` and `oklch(…)`
        // results as oklab(…) / oklch(…) AS-IS, not as rgb. ECharts'
        // parse → undefined → hover lift fails → orange "disappears".
        // ns._convertModernColor (defined in iwac-theme.js) does pure-JS
        // Oklab → linear sRGB → sRGB math, so the result is parseable
        // by ECharts AND accepted by MapLibre's style validator. No
        // canvas (anti-fingerprinting layers can corrupt canvas reads).
        if (typeof ns._convertModernColor === 'function') {
            var converted = ns._convertModernColor(resolved);
            if (converted) return converted;
        }
        return resolved;
    };

    /** Convert either {key: value} or array format to [{ name, value, itemId? }]. */
    ns.toEntries = function (data) {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        return Object.keys(data).map(function (k) { return { name: k, value: data[k] }; });
    };

})();
