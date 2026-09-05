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

        // MapLibre 6 requires WebGL2 and the constructor throws without it —
        // a `GPUInitializationError` in 6.7, a plain Error before. That is a
        // "never", not a "not yet", so it is NOT turned into the null that
        // means "the library has not landed" (see panels-map.js): it is
        // logged and rethrown for P.withMaplibre's catch to turn into the
        // "Map library unavailable" banner.
        var map;
        try {
            map = new maplibregl.Map(baseOptions);
        } catch (e) {
            console.warn('IWACVis.maplibre: map construction failed —', e && e.message);
            throw e;
        }

        // Runtime errors — a lost WebGL context, a basemap the CDN would not
        // serve — arrive as `error` events that nobody used to listen for, so
        // they surfaced as MapLibre's own console line or not at all. One
        // warning per map keeps a tile 404 storm from flooding the console
        // while still leaving a trace when a map goes blank.
        map.on('error', function (e) {
            if (map._iwacErrorLogged) return;
            map._iwacErrorLogged = true;
            var err = e && e.error;
            console.warn('IWACVis.maplibre: map error —', err && err.message ? err.message : err);
        });

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

    /* ----------------------------------------------------------------- */
    /*  Popup bounds                                                      */
    /* ----------------------------------------------------------------- */

    // MapLibre's automatic anchor chooses above/below from the popup's
    // measured height, but cannot keep a popup inside the map when it is
    // taller than the available space on both sides of its marker. The
    // same geometric limit exists horizontally around narrow embedded
    // maps. These are layout constants from MapLibre 6.3's distributed
    // CSS and our own popup-content rule.
    var POPUP_TIP_SIZE = 10;
    var POPUP_CONTENT_CHROME_Y = 30;
    var POPUP_CONTENT_CHROME_X = 60;
    var POPUP_MAX_CONTENT_HEIGHT = 460;

    function popupPadding(value) {
        value = value || {};
        function edge(name) {
            var number = Number(value[name]);
            return isFinite(number) && number > 0 ? number : 0;
        }
        return {
            top: edge('top'),
            right: edge('right'),
            bottom: edge('bottom'),
            left: edge('left')
        };
    }

    function elementSize(element, clientKey, rectKey) {
        if (!element) return 0;
        var size = Number(element[clientKey]) || 0;
        if (!size && typeof element.getBoundingClientRect === 'function') {
            size = Number(element.getBoundingClientRect()[rectKey]) || 0;
        }
        return size;
    }

    function pixelWidth(value) {
        var match = /^\s*(\d+(?:\.\d+)?)px\s*$/i.exec(String(value || ''));
        return match ? Number(match[1]) : Infinity;
    }

    /**
     * Create a MapLibre popup pre-scoped to the IWAC stylesheet hooks.
     * Stacks an `iwac-vis-maplibre-popup` class onto the popup root so
     * our CSS can target the close button, tip, and content without
     * fighting with MapLibre's built-in rules.
     *
     * The factory also keeps the popup inside its map container. The
     * documented `padding` option helps MapLibre choose an anchor, but it
     * does not resize content that cannot fit on either side of a marker.
     * Once a popup opens, its content height is capped at half of the map's
     * usable height (minus the 10px tip), which guarantees that either the
     * top or bottom anchor fits. Its width is capped at two thirds of the
     * usable map width, the corresponding guarantee for MapLibre's
     * left/centre/right anchor thresholds. Rich bodies scroll internally.
     * Bounds are recomputed after late content insertion and every map
     * resize, including fullscreen changes.
     *
     * Callers can still request a smaller maxWidth or different padding.
     * An explicit `anchor` remains the caller's responsibility because it
     * opts out of MapLibre's automatic placement.
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

        var popup = new maplibregl.Popup(merged);
        var requestedMaxWidth = merged.maxWidth;
        var requestedPadding = merged.padding;
        var activeMap = null;
        var originalAddTo = popup.addTo;
        var originalSetMaxWidth = popup.setMaxWidth;
        var originalSetPadding = popup.setPadding;

        function syncBounds() {
            if (!activeMap || !popup.isOpen || !popup.isOpen()) return;
            var mapElement = activeMap.getContainer && activeMap.getContainer();
            var popupElement = popup.getElement && popup.getElement();
            if (!mapElement || !popupElement) return;

            var mapWidth = elementSize(mapElement, 'clientWidth', 'width');
            var mapHeight = elementSize(mapElement, 'clientHeight', 'height');
            if (!mapWidth || !mapHeight) return;

            var padding = popupPadding(requestedPadding);
            var usableWidth = Math.max(0, mapWidth - padding.left - padding.right);
            var usableHeight = Math.max(0, mapHeight - padding.top - padding.bottom);

            // MapLibre uses the popup root's full size, including its tip,
            // when choosing the anchor. Reserve that tip here so the measured
            // result never crosses the half-height proof above.
            var contentHeight = Math.min(
                POPUP_MAX_CONTENT_HEIGHT,
                Math.max(0, Math.floor(usableHeight / 2) - POPUP_TIP_SIZE)
            );
            var bodyHeight = Math.max(0, contentHeight - POPUP_CONTENT_CHROME_Y);

            // For the horizontal algorithm, 2/3 of the usable map width is
            // the largest box that can always fit at its left, centred, or
            // right anchor for every possible marker x-coordinate.
            var geometricWidth = Math.max(0, Math.floor(usableWidth * 2 / 3));
            var constrainedWidth = Math.min(pixelWidth(requestedMaxWidth), geometricWidth);
            if (!isFinite(constrainedWidth)) constrainedWidth = geometricWidth;

            popupElement.style.setProperty(
                '--iwac-vis-popup-content-max-height', contentHeight + 'px'
            );
            popupElement.style.setProperty(
                '--iwac-vis-popup-body-max-height', bodyHeight + 'px'
            );
            popupElement.style.setProperty(
                '--iwac-vis-popup-inner-max-width',
                Math.max(0, constrainedWidth - POPUP_CONTENT_CHROME_X) + 'px'
            );

            // Both public setters call MapLibre's placement update. Apply the
            // width after the CSS variables exist, then let the padding update
            // make the final anchor decision against the constrained box.
            originalSetMaxWidth.call(popup, constrainedWidth + 'px');
            originalSetPadding.call(popup, requestedPadding);
        }

        function detachResize() {
            if (activeMap && typeof activeMap.off === 'function') {
                activeMap.off('resize', syncBounds);
            }
            activeMap = null;
        }

        popup.addTo = function (map) {
            detachResize();
            var result = originalAddTo.call(popup, map);
            activeMap = map;
            syncBounds();
            if (map && typeof map.on === 'function') map.on('resize', syncBounds);
            return result;
        };

        // Spatial Exploration opens its pinned popup before asynchronous
        // article content is attached. Re-run the constraint after every
        // public content setter so that path receives the same guarantee as
        // the usual setDOMContent(...).addTo(map) chain.
        ['setDOMContent', 'setHTML', 'setText'].forEach(function (method) {
            var original = popup[method];
            if (typeof original !== 'function') return;
            popup[method] = function () {
                var result = original.apply(popup, arguments);
                syncBounds();
                return result;
            };
        });

        // Preserve the public setters while retaining the requested value for
        // future resize calculations. Internal syncs call the originals above
        // so these wrappers cannot recurse.
        popup.setMaxWidth = function (value) {
            requestedMaxWidth = value;
            var result = originalSetMaxWidth.call(popup, value);
            syncBounds();
            return result;
        };
        popup.setPadding = function (value) {
            requestedPadding = value;
            var result = originalSetPadding.call(popup, value);
            syncBounds();
            return result;
        };

        if (typeof popup.on === 'function') popup.on('close', detachResize);
        return popup;
    };
})();
