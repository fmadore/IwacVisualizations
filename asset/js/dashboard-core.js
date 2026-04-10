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
        ns._charts.push(entry);
        try { render(el, instance); } catch (e) { console.error('IWACVis: render failed', e); }
        return instance;
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
    };

    /** Remove disposed/detached charts from the tracking array. */
    ns.pruneCharts = function () {
        ns._charts = ns._charts.filter(function (c) {
            if (c.kind === 'echarts') return c.instance && !c.instance.isDisposed();
            if (c.kind === 'maplibre') return c.instance && !c.instance._removed;
            return false;
        });
    };

    /* ----------------------------------------------------------------- */
    /*  Theme change handling                                             */
    /* ----------------------------------------------------------------- */

    /**
     * Re-render every tracked chart against the current theme.
     *
     * For ECharts we rebuild the theme from the current CSS variables
     * (via refreshThemes) and then dispose + reinit each chart, because
     * ECharts 6 no longer supports `chart.setTheme()`. For MapLibre we
     * swap the style URL.
     */
    ns.applyThemeToCharts = function () {
        if (typeof ns.refreshThemes === 'function') ns.refreshThemes();
        ns.pruneCharts();
        var themeName = ns.getChartTheme ? ns.getChartTheme() : null;
        ns._charts.forEach(function (entry) {
            if (entry.kind === 'echarts') {
                if (!entry.render || !entry.el) return; // can't re-render untracked charts
                try {
                    entry.instance.dispose();
                    entry.instance = echarts.init(entry.el, themeName);
                    entry.render(entry.el, entry.instance);
                } catch (e) {
                    console.error('IWACVis: theme swap failed', e);
                }
            } else if (entry.kind === 'maplibre') {
                try { entry.instance.setStyle(ns.getBasemapStyle()); }
                catch (e) { console.error('IWACVis: basemap swap failed', e); }
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

    var _resizeTimer = null;
    function handleWindowResize() {
        if (_resizeTimer) clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
            ns.pruneCharts();
            ns._charts.forEach(function (entry) {
                try {
                    if (entry.kind === 'echarts' && entry.instance) entry.instance.resize();
                    else if (entry.kind === 'maplibre' && entry.instance) entry.instance.resize();
                } catch (e) {
                    // Swallow — a disposed chart shouldn't take the whole page down
                }
            });
        }, 120);
    }

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

    /** Truncate a string with ellipsis if it exceeds maxLen. */
    ns.truncateLabel = function (str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.substring(0, maxLen) + '\u2026' : str;
    };

    /** Convert either {key: value} or array format to [{ name, value, itemId? }]. */
    ns.toEntries = function (data) {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        return Object.keys(data).map(function (k) { return { name: k, value: data[k] }; });
    };

    /** Build a dataZoom config (slider + scroll) for timeline-type charts. */
    ns.buildDataZoom = function (count) {
        if (count <= 15) return [];
        return [
            { type: 'slider', start: 0, end: 100, bottom: 8, height: 22 },
            { type: 'inside' }
        ];
    };

    /** Add click-to-navigate on chart elements pointing at Omeka items. */
    ns.addClickHandler = function (chart, entries, siteBase) {
        if (!siteBase) return;
        chart.on('click', function (params) {
            var entry = entries.find(function (e) { return e.name === params.name; });
            if (entry && entry.itemId) {
                window.location.href = siteBase + '/item/' + entry.itemId;
            }
        });
        chart.getZr().on('mousemove', function (e) {
            chart.getZr().setCursorStyle(e.target ? 'pointer' : 'default');
        });
    };
})();
