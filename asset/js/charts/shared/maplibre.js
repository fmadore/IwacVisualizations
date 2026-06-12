/**
 * IWAC Visualizations — Shared MapLibre helpers
 *
 * Reusable factories that wrap maplibregl with the conventions every
 * IWAC map panel needs:
 *
 *   - picks its basemap style from the active IWAC theme (light → positron,
 *     dark → dark-matter) via `IWACVis.getBasemapStyle()`
 *   - auto-registers with dashboard-core so the basemap swaps on
 *     light/dark toggle
 *   - re-runs the caller's custom-layer setup after every style load
 *     (initial render AND theme-triggered setStyle) so custom sources
 *     and layers survive basemap swaps without bookkeeping in each panel
 *   - adds NavigationControl + GlobeControl (Mercator ⇄ globe toggle
 *     with smooth transition — MapLibre 5.5+)
 *   - exposes `P.createIwacPopup()` so every popup gets the same
 *     iwac-vis-maplibre-popup class hook that our CSS targets (fixes
 *     the oversized / mis-coloured default close button)
 *
 * Usage:
 *
 *     var map = P.createIwacMap(container, {
 *         center: [2, 10],
 *         zoom: 3.2,
 *         onStyleReady: function (m) {
 *             m.addSource('locations', { type: 'geojson', data: features });
 *             m.addLayer({ id: 'bubbles', type: 'circle', source: 'locations', paint: {...} });
 *             m.on('click', 'bubbles', function (e) {
 *                 P.createIwacPopup()
 *                     .setLngLat(e.features[0].geometry.coordinates)
 *                     .setHTML('...')
 *                     .addTo(m);
 *             });
 *         }
 *     });
 *
 * Load order: after panels.js + iwac-theme.js + dashboard-core.js,
 * before any panel module that uses maps.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.maplibre: panels.js must load first');
        return;
    }

    /* ----------------------------------------------------------------- */
    /*  Per-map theme cache                                               */
    /* ----------------------------------------------------------------- */
    //
    // Stamp the active theme mode on every map instance the first time
    // we apply a basemap, then no-op subsequent setStyle() calls that
    // try to apply the SAME theme. This guards against:
    //   * Spurious theme observer fires (the body[data-theme] attribute
    //     can be written without changing value).
    //   * External callers (panels rebuilding their map) accidentally
    //     blowing away the current style + custom layers.
    //
    // Returns true if the basemap actually changed, false otherwise.
    // Either way the active mode is recorded on the map.

    P.setMapTheme = function (map, mode) {
        if (!map) return false;
        var next = mode === 'dark' ? 'dark' : 'light';
        if (map._iwacThemeMode === next) return false;
        map._iwacThemeMode = next;
        // Graph-mode maps (abstract layouts with no basemap) swap to a
        // freshly-built blank style instead of a Carto URL; their
        // custom layers are rebuilt by the same onStyleReady path with
        // colors re-resolved from the new theme's tokens.
        var style = map._iwacStyleMode === 'graph'
            ? P.buildGraphStyle()
            : (next === 'dark'
                ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
                : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json');
        try {
            map.setStyle(style);
            return true;
        } catch (e) {
            console.error('IWACVis.maplibre: setStyle failed', e);
            return false;
        }
    };

    /* ----------------------------------------------------------------- */
    /*  Blank "graph canvas" style                                        */
    /* ----------------------------------------------------------------- */

    /**
     * Build a minimal MapLibre style for non-geographic uses of the
     * renderer (e.g. the Entity Networks block's abstract layout):
     * a single background layer painted with the current theme's
     * background token, no tile sources, and the CartoCDN glyphs
     * endpoint so symbol layers (node labels) can render text. Called
     * once per (re-)style, so colors always reflect the active theme.
     *
     * @returns {Object} MapLibre style object
     */
    P.buildGraphStyle = function () {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var bg = P.normalizeColorForMapLibre(tokens.background || '#f7f7f6');
        return {
            version: 8,
            // Same CDN family as the positron/dark-matter basemaps used
            // everywhere else in the module.
            glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
            sources: {},
            layers: [{
                id: 'iwac-graph-background',
                type: 'background',
                paint: { 'background-color': bg }
            }]
        };
    };

    /* ----------------------------------------------------------------- */
    /*  MapLibre color normalization                                      */
    /* ----------------------------------------------------------------- */
    //
    // MapLibre's style validator only accepts CSS Color Module Level 3
    // colors (hex, rgb/rgba, hsl/hsla, named). After IWAC theme v2.0.0
    // reframed its palette around OKLCH, `getComputedStyle()` may return
    // `oklch(...)` / `oklab(...)` / `color(srgb ...)` strings that
    // MapLibre rejects with errors like:
    //
    //   layers.location-circles.paint.circle-color: color expected,
    //   "oklab(0.574 0.149 0.109)" found
    //
    // We rasterize through a 1x1 sRGB canvas and read pixel bytes via
    // getImageData — the backing store is sRGB by spec, so the result is
    // Color-Level-3 RGB regardless of input format. ONLY called from the
    // MapLibre paint path; the ECharts resolvers (resolveCssColor /
    // resolveCssVar) are untouched because canvas rasterization can be
    // affected by browser anti-fingerprinting (Brave Shields) and
    // ECharts' color parser already handles the formats those resolvers
    // emit. Don't reroute ECharts through this.
    //
    var _mlProbe = null;
    P.normalizeColorForMapLibre = function (value) {
        if (!value || typeof value !== 'string') return value;
        var trimmed = value.trim();
        if (!trimmed) return trimmed;
        // Fast paths — already Color-3-legal.
        if (/^#([0-9a-f]{3,8})$/i.test(trimmed)) return trimmed;
        if (/^rgba?\(/i.test(trimmed)) return trimmed;
        if (/^hsla?\(/i.test(trimmed)) return trimmed;
        try {
            if (!_mlProbe) {
                var canvas = document.createElement('canvas');
                canvas.width = canvas.height = 1;
                _mlProbe = canvas.getContext('2d', { colorSpace: 'srgb' })
                        || canvas.getContext('2d');
            }
            if (!_mlProbe) return trimmed;
            _mlProbe.clearRect(0, 0, 1, 1);
            _mlProbe.fillStyle = trimmed;
            _mlProbe.fillRect(0, 0, 1, 1);
            var d = _mlProbe.getImageData(0, 0, 1, 1).data;
            if (d[3] === 255) {
                return 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')';
            }
            return 'rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', ' + (d[3] / 255) + ')';
        } catch (e) {
            return trimmed;
        }
    };

    /**
     * @param {HTMLElement|string} container  Map container (element or id)
     * @param {Object} config
     * @param {Array<number>} [config.center=[0,0]]  [lng, lat]
     * @param {number} [config.zoom=2]
     * @param {function(maplibregl.Map)} config.onStyleReady
     *   Called once per style.load event. This is where you add your
     *   custom sources, layers, and layer-bound event handlers. The
     *   callback fires on the initial render AND again after every
     *   setStyle (e.g. theme swap), so anything that was wiped by the
     *   new style gets rebuilt automatically.
     * @param {boolean} [config.globe=true]  Show the GlobeControl toggle
     * @param {boolean} [config.navigation=true]  Show the NavigationControl
     * @param {boolean} [config.fullscreen=true]  Show MapLibre's native FullscreenControl
     * @param {string} [config.styleMode='basemap']  'basemap' uses the
     *   theme's Carto style; 'graph' uses the blank P.buildGraphStyle()
     *   canvas (and theme swaps rebuild that instead of a basemap).
     * @param {Object} [config.mapOptions]  Extra options passed straight
     *   to `new maplibregl.Map` (overrides any defaults here)
     * @returns {maplibregl.Map|null}
     */
    P.createIwacMap = function (container, config) {
        if (typeof maplibregl === 'undefined') {
            console.warn('IWACVis.maplibre: maplibre-gl not loaded');
            return null;
        }
        config = config || {};

        var graphMode = config.styleMode === 'graph';
        var defaultStyle;
        if (graphMode) {
            defaultStyle = P.buildGraphStyle();
        } else {
            defaultStyle = ns.getBasemapStyle
                ? ns.getBasemapStyle()
                : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
        }

        // Localized cooperative-gestures hints. The historical reason
        // for NOT enabling cooperativeGestures was MapLibre's
        // English-only hint dialog; the `locale` map option localizes
        // it, so the standard embedded-map etiquette (wheel zoom needs
        // Ctrl/⌘, touch pan needs two fingers — page scroll always
        // wins) is now on by default. Opt out per map via
        // `mapOptions: { cooperativeGestures: false }`.
        var fr = ns.locale === 'fr';
        var gestureLocale = {
            'CooperativeGesturesHandler.WindowsHelpText': fr
                ? 'Utilisez Ctrl + molette pour zoomer la carte'
                : 'Use Ctrl + scroll to zoom the map',
            'CooperativeGesturesHandler.MacHelpText': fr
                ? 'Utilisez ⌘ + molette pour zoomer la carte'
                : 'Use ⌘ + scroll to zoom the map',
            'CooperativeGesturesHandler.MobileHelpText': fr
                ? 'Utilisez deux doigts pour déplacer la carte'
                : 'Use two fingers to move the map'
        };

        var baseOptions = {
            container: container,
            style: defaultStyle,
            center: config.center || [0, 0],
            zoom: config.zoom != null ? config.zoom : 2,
            attributionControl: { compact: true },
            cooperativeGestures: true,
            locale: gestureLocale,
            // Required for `canvas.toDataURL()` to return the rendered
            // pixels instead of a blank buffer. Without this flag the
            // WebGL context clears the drawing buffer after compositing,
            // so the panel-toolbar's Download button would produce an
            // empty PNG. The perf hit is negligible for our panel sizes.
            preserveDrawingBuffer: true
        };
        // Shallow-merge caller-provided mapOptions last so they win
        if (config.mapOptions) {
            for (var k in config.mapOptions) {
                if (Object.prototype.hasOwnProperty.call(config.mapOptions, k)) {
                    baseOptions[k] = config.mapOptions[k];
                }
            }
        }

        var map = new maplibregl.Map(baseOptions);

        // Stamp the initial theme so future P.setMapTheme calls can no-op
        // when the requested mode already matches, and the style mode so
        // theme swaps know whether to rebuild a basemap or a graph canvas.
        map._iwacThemeMode = ns.getCurrentTheme ? ns.getCurrentTheme() : 'light';
        if (graphMode) map._iwacStyleMode = 'graph';

        // Built-in controls
        if (config.navigation !== false) {
            map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        }
        if (config.globe !== false && typeof maplibregl.GlobeControl === 'function') {
            map.addControl(new maplibregl.GlobeControl(), 'top-right');
        }
        // Native MapLibre fullscreen — applies to the `.iwac-vis-map`
        // container, not the surrounding panel. That's intentional:
        // maps have their own zoom / pan controls and users want to
        // expand the basemap itself, not the chrome around it. Opt-out
        // by passing `fullscreen: false`.
        if (config.fullscreen !== false && typeof maplibregl.FullscreenControl === 'function') {
            map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        }

        // Run the caller's custom-layer setup on every style load so
        // custom state survives basemap swaps on theme change.
        if (typeof config.onStyleReady === 'function') {
            map.on('style.load', function () {
                try {
                    config.onStyleReady(map);
                } catch (e) {
                    console.error('IWACVis.maplibre: onStyleReady failed', e);
                }
            });
        }

        // Register for automatic basemap swaps on theme change
        if (typeof ns.registerMap === 'function') {
            var el = typeof container === 'string' ? document.getElementById(container) : container;
            ns.registerMap(map, el);
        }

        return map;
    };

    /**
     * Create a MapLibre popup pre-scoped to the IWAC stylesheet hooks.
     * Stacks an `iwac-vis-maplibre-popup` class onto the popup root so
     * our CSS can target the close button, tip, and content without
     * fighting with MapLibre's built-in rules.
     *
     * Two MapLibre PopupOptions defaults that fix a recurring "popup
     * spills outside the map" complaint:
     *
     *   - `maxWidth: '320px'` — matches the inner `.iwac-vis-map-popup`
     *     CSS cap so MapLibre's auto-anchor calculation reflects the
     *     real popup width. The MapLibre default is 240px, which made
     *     the auto-anchor pick "top" or "bottom" even when the popup
     *     would actually overflow the side of the map container.
     *   - `padding: 16` — uniform pixel padding from the map container
     *     edges that MapLibre keeps free when picking an anchor. With
     *     this set, a click on a marker near the edge anchors away
     *     from that edge, keeping the entire popup in the viewport.
     *     PaddingOptions on Popup is supported in MapLibre 5+.
     *
     * Callers can override either by passing the same key in `options`.
     *
     * @param {Object} [options]  Same shape as maplibregl.Popup options
     * @returns {maplibregl.Popup}
     */
    P.createIwacPopup = function (options) {
        if (typeof maplibregl === 'undefined') {
            console.warn('IWACVis.maplibre: maplibre-gl not loaded');
            return null;
        }
        var opts = options || {};
        var className = 'iwac-vis-maplibre-popup';
        if (opts.className) className += ' ' + opts.className;
        var merged = {
            maxWidth: '320px',
            padding: { top: 16, right: 16, bottom: 16, left: 16 }
        };
        for (var k in opts) {
            if (Object.prototype.hasOwnProperty.call(opts, k)) merged[k] = opts[k];
        }
        merged.className = className;
        return new maplibregl.Popup(merged);
    };
})();
