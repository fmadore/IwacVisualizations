/**
 * IWAC Visualizations — Map helpers
 *
 * Part of the `IWACVis.panels` namespace, split out of the ~1,000-line
 * panels.js in v1.23.0 along its own section boundaries — the same split the
 * chart-options family already uses. Each part extends the same `P` object,
 * so load order among them does not matter; only that panels.js itself loads
 * first (it creates the namespace) and that all of them load before any block
 * controller.
 *
 * The MapLibre readiness gate, GeoJSON count-bubble features, and MapLibre
 * feature-state hover wiring.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels = ns.panels || {};

    /* ----------------------------------------------------------------- */
    /*  MapLibre readiness                                                */
    /* ----------------------------------------------------------------- */

    /**
     * Resolve once `window.maplibregl` exists; reject if it never will.
     *
     * MapLibre has been ESM-only since v6, so it cannot ride the classic
     * script chain — the on-view loader (view/common/iwac-assets.phtml)
     * `import()`s it in parallel and publishes the promise as
     * `window.IWACVisLazy.mjsP`. Everything that needs the global goes through
     * here.
     *
     * This exists because the alternative is making the whole page wait. The
     * loader used to hold the orchestrator back until the import settled,
     * since map panels read `maplibregl` synchronously in render() and
     * P.boot() calls render() eagerly — one true ordering constraint, paid for
     * by every ECharts panel on the page. Scoping the wait to the panels that
     * actually draw maps costs one promise and removes ~1 MB of MapLibre from
     * the critical path of first paint.
     *
     * @returns {Promise<Object>} the maplibregl namespace
     */
    P.whenMaplibre = function () {
        if (typeof maplibregl !== 'undefined' && maplibregl) {
            return Promise.resolve(window.maplibregl);
        }
        var lazy = window.IWACVisLazy;
        if (lazy && lazy.mjsP && typeof lazy.mjsP.then === 'function') {
            return lazy.mjsP.then(function (m) {
                if (typeof maplibregl === 'undefined') {
                    throw new Error('MapLibre resolved without publishing a global');
                }
                return m || window.maplibregl;
            });
        }
        // No import was ever armed: the block declared no `maplibre` need, or
        // the page is an embed route that never emitted the loader. Either way
        // the panel should say so rather than hang on a spinner.
        return Promise.reject(new Error('MapLibre was not requested for this page'));
    };

    /**
     * Run `build` once MapLibre is available, holding a spinner in `host`
     * meanwhile and swapping it for the standard "map unavailable" banner if
     * the import fails.
     *
     * Call this INSIDE a `P.lazyInit` where the panel already defers its data:
     * an off-screen map should not paint a spinner it never resolves.
     *
     * @param {HTMLElement} host   element the spinner / error banner goes into
     * @param {function(Object): *} build  receives the maplibregl namespace
     * @param {Object} [opts]
     * @param {boolean} [opts.loading=true]  set false when the caller already
     *   rendered its own loading state into `host`
     * @returns {Promise}
     */
    P.withMaplibre = function (host, build, opts) {
        var showLoading = !opts || opts.loading !== false;
        var loading = (host && showLoading) ? P.buildLoadingState('Loading map') : null;
        if (loading) host.appendChild(loading);

        function clear() {
            if (loading && loading.parentNode) loading.parentNode.removeChild(loading);
        }

        return P.whenMaplibre().then(function (lib) {
            clear();
            return build(lib);
        }, function (err) {
            clear();
            if (window.console && console.warn) {
                console.warn('IWACVis: map panel skipped —', err && err.message);
            }
            if (host) host.appendChild(P.buildErrorState('Map library unavailable'));
        });
    };

    /* ----------------------------------------------------------------- */
    /*  GeoJSON feature builder for count-sized bubble maps               */
    /* ----------------------------------------------------------------- */

    /**
     * Build a GeoJSON FeatureCollection from a list of records that each
     * carry lng/lat and a count-like numeric property. Returns both the
     * feature collection and the max count across surviving features, so
     * callers can drive a single `interpolate` expression in their
     * MapLibre paint spec without re-scanning the data.
     *
     * @param {Array<Object>} items   Records with lng, lat, and countKey
     * @param {Object} [opts]
     * @param {string} [opts.countKey='count']  Property holding the size metric
     * @param {number} [opts.minCount=1]  Items below this are dropped (strict <)
     * @param {function(item, idx):Object} [opts.toProps]
     *   Builds the feature `properties` object. Defaults to `{ [countKey]: count }`.
     *   Receives the original item and its (pre-filter) index so callers can
     *   stash an index lookup back into a richer source array.
     * @returns {{ max: number, collection: GeoJSON.FeatureCollection }}
     */
    /* ----------------------------------------------------------------- */
    /*  MapLibre feature-state hover wiring                               */
    /* ----------------------------------------------------------------- */

    /**
     * Wire up `feature-state`-driven hover highlights for one or more
     * MapLibre layers. The modern idiom: instead of swapping the CSS
     * cursor only, we track which feature is under the cursor and flip
     * its `hover` feature state. Paint expressions that reference
     * `['case', ['boolean', ['feature-state', 'hover'], false], <hover>, <normal>]`
     * then render a real visual change (brighter opacity, thicker
     * stroke, etc.) — all on the GPU, zero JS work per frame.
     *
     * Call this ONCE per map instance, outside `onStyleReady()`, so
     * handlers don't stack on every theme swap. The hover state
     * naturally resets on each style reload because new sources
     * generate fresh ids.
     *
     * Prerequisite: each passed source must be created with
     * `{type: 'geojson', generateId: true, ...}` so MapLibre has a
     * stable feature identity to key the state on.
     *
     * @param {maplibregl.Map} map
     * @param {Array<{layer: string, source: string}>|{layer: string, source: string}} layers
     *   One or more (layer, source) pairs to track. Pass a single object
     *   for the common single-layer case, or an array for multi-layer
     *   maps where the topmost hovered feature wins.
     * @returns {function()} detach — call to remove listeners + clear state
     */
    P.attachFeatureStateHover = function (map, layers) {
        if (!map) return function () {};
        var items = Array.isArray(layers) ? layers : [layers];
        var hovered = null; // { source, id }

        function clearHover() {
            if (hovered) {
                map.setFeatureState(
                    { source: hovered.source, id: hovered.id },
                    { hover: false }
                );
                hovered = null;
            }
        }

        function onMove(e) {
            // Filter to layers that are actually on the map right now
            // so theme swaps (which temporarily wipe custom layers)
            // don't throw on query.
            var active = items.filter(function (it) { return map.getLayer(it.layer); });
            if (active.length === 0) {
                clearHover();
                map.getCanvas().style.cursor = '';
                return;
            }
            var layerIds = active.map(function (it) { return it.layer; });
            var features = map.queryRenderedFeatures(e.point, { layers: layerIds });
            if (features.length === 0) {
                clearHover();
                map.getCanvas().style.cursor = '';
                return;
            }
            map.getCanvas().style.cursor = 'pointer';

            var f = features[0];
            if (f.id == null) return; // source missing generateId:true
            // Resolve source via the layer the hit came from.
            var src = null;
            for (var i = 0; i < active.length; i++) {
                if (f.layer && f.layer.id === active[i].layer) {
                    src = active[i].source;
                    break;
                }
            }
            if (!src) return;
            if (hovered && hovered.source === src && hovered.id === f.id) return;

            clearHover();
            hovered = { source: src, id: f.id };
            map.setFeatureState(
                { source: src, id: f.id },
                { hover: true }
            );
        }

        function onLeave() {
            clearHover();
            map.getCanvas().style.cursor = '';
        }

        map.on('mousemove', onMove);
        map.on('mouseleave', onLeave);

        return function detach() {
            clearHover();
            map.off('mousemove', onMove);
            map.off('mouseleave', onLeave);
        };
    };

    P.buildCountFeatures = function (items, opts) {
        opts = opts || {};
        var countKey = opts.countKey || 'count';
        var minCount = opts.minCount != null ? opts.minCount : 1;
        var toProps = opts.toProps;
        var max = 1;
        var features = [];
        (items || []).forEach(function (item, idx) {
            var c = Number(item[countKey] || 0);
            if (c < minCount) return;
            if (c > max) max = c;
            var props;
            if (toProps) {
                props = toProps(item, idx);
            } else {
                props = {};
                props[countKey] = c;
            }
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
                properties: props
            });
        });
        return {
            max: max,
            collection: { type: 'FeatureCollection', features: features }
        };
    };
})();
