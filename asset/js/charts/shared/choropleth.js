/**
 * IWAC Visualizations — MapLibre choropleth toggle helper
 *
 * Adds a single button to a MapLibre instance that switches between
 * the map's existing point-bubble view and a 6-country choropleth
 * fill view (Bénin, Burkina Faso, Côte d'Ivoire, Niger, Nigeria,
 * Togo). Designed so every IWAC map can opt in with two lines of
 * code: pass an existing per-country aggregation + the IDs of the
 * bubble layers to hide. The helper owns:
 *
 *   - lazy-loading + caching the iwac-countries.geojson once per page
 *     (138 KB, fetched only when the user first toggles to choropleth)
 *   - adding fill + stroke layers, hidden by default, and toggling
 *     visibility back and forth without disposing them
 *   - a MapLibre control with a single button that swaps the icon and
 *     aria-label between bubble / choropleth states
 *   - re-adding the choropleth source + layers after every
 *     `style.load` (i.e. theme swap), since `setStyle()` wipes
 *     custom sources / layers and the existing pattern in IWAC is
 *     to rebuild from `onStyleReady`
 *   - theme-aware paint via the same `--iwac-vis-heatmap-*` ramp the
 *     year × month heatmap and calendar heatmap use, so light/dark
 *     toggle propagates without manual re-paint
 *
 * Usage:
 *
 *     var choropleth = P.attachChoroplethToggle(map, {
 *         countryCounts: { 'Bénin': 245, 'Burkina Faso': 312, ... },
 *         bubbleLayers:  ['location-circles'],
 *         basePath:      ctx.basePath,
 *         labelKey:      'mentions'   // i18n key for popup count suffix
 *     });
 *
 * Returns `{ getMode, setMode, updateCounts(newCounts), destroy }`.
 *
 * Dependencies: maplibre.js (P.normalizeColorForMapLibre,
 * P.createIwacPopup), panels.js, dashboard-core.js (ns.resolveCssVar,
 * ns.getChartTokens), iwac-i18n.js (P.t).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    if (!P) {
        console.warn('IWACVis.choropleth: panels.js must load first');
        return;
    }

    // Single shared cache per page — the GeoJSON is identical across
    // every map so we fetch once and reuse the parsed object.
    var _geojsonCache = null;
    var _geojsonInflight = null;
    function loadGeojson(basePath) {
        if (_geojsonCache) return Promise.resolve(_geojsonCache);
        if (_geojsonInflight) return _geojsonInflight;
        var url = (basePath || '') +
            '/modules/IwacVisualizations/asset/data/iwac-countries.geojson';
        _geojsonInflight = fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (geo) {
                _geojsonCache = geo;
                _geojsonInflight = null;
                return geo;
            })
            .catch(function (err) {
                _geojsonInflight = null;
                throw err;
            });
        return _geojsonInflight;
    }

    /* ----------------------------------------------------------------- */
    /*  Theme-aware paint                                                 */
    /* ----------------------------------------------------------------- */
    //
    // The heatmap palette tokens (--iwac-vis-heatmap-0..4) are defined
    // in iwac-core.css as `color-mix(in oklab, var(--primary), var(--surface))`
    // ramps that already follow the IWAC theme's primary colour and
    // flip for dark mode. Routing them through ns.resolveCssVar gives
    // us a parseable rgb() string; P.normalizeColorForMapLibre then
    // makes sure MapLibre's style validator accepts the result.

    function ml(color) {
        return P.normalizeColorForMapLibre
            ? P.normalizeColorForMapLibre(color)
            : color;
    }

    function resolveRamp() {
        var resolve = ns.resolveCssVar || function () { return ''; };
        var stops = [
            resolve('--iwac-vis-heatmap-0'),
            resolve('--iwac-vis-heatmap-1'),
            resolve('--iwac-vis-heatmap-2'),
            resolve('--iwac-vis-heatmap-3'),
            resolve('--iwac-vis-heatmap-4')
        ].filter(Boolean).map(ml);
        if (stops.length < 2) {
            var t = (ns.getChartTokens && ns.getChartTokens()) || {};
            stops = [t.surface || '#fdfcfa', t.primary || '#d86a11'].map(ml);
        }
        return stops;
    }

    function buildFillExpression(maxCount) {
        var stops = resolveRamp();
        // Scale the count axis from 0..maxCount across the ramp. With 5
        // stops that's evenly spaced quintiles; with 2 it's a linear
        // tween. ECharts' visualMap-style "calculable" smoothness in
        // both cases — no banding artefacts at the boundaries.
        var expr = ['interpolate', ['linear'], ['get', '_iwac_count']];
        for (var i = 0; i < stops.length; i++) {
            var t = stops.length === 1 ? 0 : (maxCount * i) / (stops.length - 1);
            expr.push(t, stops[i]);
        }
        return expr;
    }

    function strokeColor() {
        var t = (ns.getChartTokens && ns.getChartTokens()) || {};
        return ml(t.border || '#d4d6da');
    }

    /* ----------------------------------------------------------------- */
    /*  Custom MapLibre control                                           */
    /* ----------------------------------------------------------------- */

    function buildToggleControl(initialMode, onClick) {
        function Control() {}
        Control.prototype.onAdd = function (mapRef) {
            this._map = mapRef;
            var c = document.createElement('div');
            c.className = 'maplibregl-ctrl maplibregl-ctrl-group iwac-choropleth-ctrl';

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'iwac-choropleth-ctrl__btn';
            // The glyph here is a "squared four areas" character that
            // reads as a polygon-fill icon. CSS may swap it for an
            // SVG later without touching the button's role.
            btn.innerHTML = '<span aria-hidden="true">▥</span>';
            updateButtonState(btn, initialMode);
            btn.addEventListener('click', onClick);

            c.appendChild(btn);
            this._container = c;
            this._btn = btn;
            return c;
        };
        Control.prototype.onRemove = function () {
            if (this._container && this._container.parentNode) {
                this._container.parentNode.removeChild(this._container);
            }
            this._map = null;
            this._btn = null;
        };
        // Expose so the parent helper can update the button state on
        // mode changes (label, pressed look) without rebuilding.
        Control.prototype.refresh = function (mode) {
            if (this._btn) updateButtonState(this._btn, mode);
        };
        return new Control();
    }

    function updateButtonState(btn, mode) {
        var isChoropleth = mode === 'choropleth';
        btn.classList.toggle('iwac-choropleth-ctrl__btn--active', isChoropleth);
        btn.setAttribute('aria-pressed', isChoropleth ? 'true' : 'false');
        var title = isChoropleth
            ? P.t('Show bubbles')
            : P.t('Show choropleth');
        btn.title = title;
        btn.setAttribute('aria-label', title);
    }

    /* ----------------------------------------------------------------- */
    /*  Public helper                                                     */
    /* ----------------------------------------------------------------- */

    /**
     * Attach a choropleth-toggle button to the given MapLibre instance.
     *
     * @param {maplibregl.Map} map
     * @param {Object} opts
     * @param {Object<string, number>} opts.countryCounts
     *   Per-IWAC-country aggregation. Keys are the canonical IWAC
     *   spellings ("Bénin", "Burkina Faso", "Côte d'Ivoire", "Niger",
     *   "Nigeria", "Togo"); unknown keys are silently ignored.
     * @param {Array<string>} opts.bubbleLayers
     *   IDs of the map's existing point-bubble layers. The helper
     *   toggles their `visibility` layout property in lockstep with
     *   its own choropleth layers.
     * @param {string} [opts.basePath='']  Omeka base path for the
     *   GeoJSON fetch.
     * @param {string} [opts.labelKey='mentions']  i18n key used as
     *   the count suffix in the country-click popup.
     * @param {string} [opts.position='top-right']  MapLibre control
     *   anchor position.
     * @param {function(string)} [opts.onModeChange]  Fires with the
     *   new mode ("bubbles" | "choropleth") on every successful swap.
     * @returns {{getMode: function, setMode: function(string),
     *            updateCounts: function(Object), destroy: function}}
     */
    P.attachChoroplethToggle = function (map, opts) {
        opts = opts || {};
        if (!map) return null;

        var countryCounts = opts.countryCounts || {};
        var bubbleLayers  = (opts.bubbleLayers || []).slice();
        var basePath      = opts.basePath || '';
        var labelKey      = opts.labelKey || 'mentions';
        var onModeChange  = opts.onModeChange;

        // Random suffix so multiple maps on the same page (e.g. compare-
        // newspapers' two corpora maps side-by-side) don't collide on
        // source / layer IDs.
        var SUFFIX = Math.random().toString(36).slice(2, 8);
        var SOURCE = 'iwac-choropleth-' + SUFFIX;
        var FILL   = SOURCE + '-fill';
        var STROKE = SOURCE + '-stroke';

        var mode = 'bubbles';
        var pendingFetch = null;

        function maxValue() {
            var m = 1;
            for (var k in countryCounts) {
                if (countryCounts.hasOwnProperty(k) && countryCounts[k] > m) {
                    m = countryCounts[k];
                }
            }
            return m;
        }

        function annotate(geo) {
            // Mutate a clone — keep _geojsonCache pristine across maps
            // since each map has different counts.
            var clone = {
                type: 'FeatureCollection',
                features: geo.features.map(function (f) {
                    var props = {};
                    for (var k in f.properties) {
                        if (f.properties.hasOwnProperty(k)) props[k] = f.properties[k];
                    }
                    props._iwac_count = countryCounts[props.name] || 0;
                    return {
                        type: 'Feature',
                        geometry: f.geometry,
                        properties: props
                    };
                })
            };
            return clone;
        }

        function ensureLayers() {
            // If the source already exists on the current style, just
            // re-set the data (handles updateCounts() and post-style.load
            // re-init paths).
            if (map.getSource(SOURCE)) {
                if (pendingFetch) return pendingFetch;
                if (!_geojsonCache) return Promise.resolve();
                map.getSource(SOURCE).setData(annotate(_geojsonCache));
                return Promise.resolve();
            }
            pendingFetch = loadGeojson(basePath).then(function (geo) {
                if (map.getSource(SOURCE)) { pendingFetch = null; return; }
                map.addSource(SOURCE, {
                    type: 'geojson',
                    data: annotate(geo),
                    generateId: true
                });
                map.addLayer({
                    id: FILL,
                    type: 'fill',
                    source: SOURCE,
                    layout: { visibility: 'none' },
                    paint: {
                        'fill-color': buildFillExpression(maxValue()),
                        'fill-opacity': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            0.85,
                            0.65
                        ]
                    }
                });
                map.addLayer({
                    id: STROKE,
                    type: 'line',
                    source: SOURCE,
                    layout: { visibility: 'none' },
                    paint: {
                        'line-color': strokeColor(),
                        'line-width': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            2.5,
                            1
                        ]
                    }
                });
                attachInteractions();
                pendingFetch = null;
            }).catch(function (err) {
                console.error('IWACVis.choropleth: load failed', err);
                pendingFetch = null;
            });
            return pendingFetch;
        }

        function attachInteractions() {
            // Hover highlight via feature-state — same idiom as the
            // bubble layers, no JS work per frame.
            P.attachFeatureStateHover(map, { layer: FILL, source: SOURCE });

            map.on('click', FILL, function (e) {
                if (!e.features || !e.features[0]) return;
                var p = e.features[0].properties || {};
                var count = Number(p._iwac_count || 0);
                var html = '<strong>' + P.escapeHtml(p.name || '') + '</strong><br>' +
                    P.formatNumber(count) + ' ' + P.t(labelKey);
                P.createIwacPopup({ closeButton: true, closeOnClick: true })
                    .setLngLat(e.lngLat)
                    .setHTML(html)
                    .addTo(map);
            });
        }

        function showChoropleth() {
            return ensureLayers().then(function () {
                if (map.getLayer(FILL))   map.setLayoutProperty(FILL,   'visibility', 'visible');
                if (map.getLayer(STROKE)) map.setLayoutProperty(STROKE, 'visibility', 'visible');
                bubbleLayers.forEach(function (id) {
                    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
                });
            });
        }

        function showBubbles() {
            if (map.getLayer(FILL))   map.setLayoutProperty(FILL,   'visibility', 'none');
            if (map.getLayer(STROKE)) map.setLayoutProperty(STROKE, 'visibility', 'none');
            bubbleLayers.forEach(function (id) {
                if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
            });
        }

        function setMode(next) {
            if (next !== 'bubbles' && next !== 'choropleth') return;
            if (next === mode) return;
            mode = next;
            (mode === 'choropleth' ? showChoropleth() : Promise.resolve(showBubbles()))
                .then(function () {
                    control.refresh(mode);
                    if (typeof onModeChange === 'function') onModeChange(mode);
                });
        }

        var control = buildToggleControl(mode, function () {
            setMode(mode === 'bubbles' ? 'choropleth' : 'bubbles');
        });
        map.addControl(control, opts.position || 'top-right');

        // Theme swap path: setStyle() wipes our source + layers. Re-add
        // them on every style.load IF we're currently in choropleth
        // mode; otherwise let the next toggle re-create on demand. Bubble
        // layers are owned by the caller and re-added via their own
        // onStyleReady — we just (re-)hide them when we re-enter
        // choropleth mode.
        map.on('style.load', function () {
            if (mode === 'choropleth') showChoropleth();
        });

        return {
            getMode: function () { return mode; },
            setMode: setMode,
            /**
             * Replace the per-country counts. Recomputes the fill-color
             * expression's max value and pushes the new feature data
             * to the existing source.
             */
            updateCounts: function (newCounts) {
                countryCounts = newCounts || {};
                if (map.getLayer(FILL)) {
                    map.setPaintProperty(
                        FILL, 'fill-color',
                        buildFillExpression(maxValue())
                    );
                }
                if (map.getSource(SOURCE) && _geojsonCache) {
                    map.getSource(SOURCE).setData(annotate(_geojsonCache));
                }
            },
            destroy: function () {
                try { map.removeControl(control); }
                catch (e) { /* control may already be gone */ }
                if (map.getLayer(FILL))   { try { map.removeLayer(FILL); } catch (e) {} }
                if (map.getLayer(STROKE)) { try { map.removeLayer(STROKE); } catch (e) {} }
                if (map.getSource(SOURCE)) { try { map.removeSource(SOURCE); } catch (e) {} }
            }
        };
    };
})();
