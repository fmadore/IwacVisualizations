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
     * @param {boolean} [config.fullscreen=false]
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

        var defaultStyle = ns.getBasemapStyle
            ? ns.getBasemapStyle()
            : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

        var baseOptions = {
            container: container,
            style: defaultStyle,
            center: config.center || [0, 0],
            zoom: config.zoom != null ? config.zoom : 2,
            attributionControl: { compact: true }
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

        // Built-in controls
        if (config.navigation !== false) {
            map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        }
        if (config.globe !== false && typeof maplibregl.GlobeControl === 'function') {
            map.addControl(new maplibregl.GlobeControl(), 'top-right');
        }
        if (config.fullscreen) {
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
        var merged = {};
        for (var k in opts) {
            if (Object.prototype.hasOwnProperty.call(opts, k)) merged[k] = opts[k];
        }
        merged.className = className;
        return new maplibregl.Popup(merged);
    };
})();
