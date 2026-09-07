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
 *   - adds a zoom-only NavigationControl, and MapLibre's FullscreenControl
 *     where the panel toolbar has none. Globe is opt-in (`globe: true`):
 *     ROADMAP §4 and §10 both list globe projection as "won't do"
 *   - exposes `P.createIwacPopup()` so every popup gets the same
 *     iwac-vis-maplibre-popup class hook that our CSS targets (fixes
 *     the oversized / mis-coloured default close button)
 *
 * Usage:
 *
 *     var map = P.createIwacMap(container, {
 *         center: P.WEST_AFRICA_VIEW.center,
 *         zoom: P.WEST_AFRICA_VIEW.zoom,
 *         title: 'What this map shows',
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
    /*  Camera, motion and locale defaults                                */
    /* ----------------------------------------------------------------- */

    /**
     * The six-country region, framed once.
     *
     * Seven slightly different "West Africa" defaults had accumulated —
     * `[2,10]@3.2` four times, plus `[2.5,10.5]@3.4`, `[2.5,12]@4` and
     * `[2,10]@2.6` — so the same region opened at a different scale
     * depending on which block you were reading. This is that view; a map
     * whose subject is genuinely wider (source provenance, which spans
     * Europe and North America) passes its own and says why.
     */
    P.WEST_AFRICA_VIEW = { center: [2, 10], zoom: 3.2 };

    /**
     * `fitBounds` options, likewise. Padding was 40 / 42 / 48 / 60 and
     * maxZoom 5 / 7 / 8 across the same six countries. Spread and override
     * the one value a caller actually needs.
     */
    P.FIT_OPTS = { padding: 48, maxZoom: 7, duration: 600 };

    /**
     * A camera-animation duration that respects `prefers-reduced-motion`.
     *
     * The canvas graphs have honoured the preference since v1.30; no map
     * did, so a reader who asks the OS to stop moving things still got
     * eleven animated `easeTo`/`flyTo`/`fitBounds` calls. Zero means
     * MapLibre jumps, which is the documented way to opt out per call.
     */
    P.mapMotion = function (ms) {
        if (ns.prefersReducedMotion && ns.prefersReducedMotion()) return 0;
        return ms == null ? P.FIT_OPTS.duration : ms;
    };

    /**
     * MapLibre's own UI strings, in the site's language.
     *
     * Only the three cooperative-gesture keys were translated, so on the
     * French site every control still announced itself in English to a
     * screen reader — "Zoom in", "Enter fullscreen", "Close popup". These
     * are every key MapLibre 6.6 reads (verified against the pinned
     * bundle's `defaultLocale`) minus the ones for controls this module
     * never adds: geolocate, scale, terrain, logo.
     */
    P.mapLocale = function () {
        if (ns.locale !== 'fr') return {};
        return {
            'Map.Title': 'Carte',
            'Marker.Title': 'Repère',
            'Popup.Close': 'Fermer la fenêtre',
            'NavigationControl.ZoomIn': 'Zoom avant',
            'NavigationControl.ZoomOut': 'Zoom arrière',
            'NavigationControl.ResetBearing': 'Faire pivoter la carte ; cliquer pour revenir au nord',
            'FullscreenControl.Enter': 'Passer en plein écran',
            'FullscreenControl.Exit': 'Quitter le plein écran',
            'GlobeControl.Enable': 'Activer le globe',
            'GlobeControl.Disable': 'Désactiver le globe',
            'AttributionControl.ToggleAttribution': 'Afficher les mentions',
            'AttributionControl.MapFeedback': 'Signaler un problème sur la carte',
            'CooperativeGesturesHandler.WindowsHelpText': 'Utilisez Ctrl + molette pour zoomer la carte',
            'CooperativeGesturesHandler.MacHelpText': 'Utilisez ⌘ + molette pour zoomer la carte',
            'CooperativeGesturesHandler.MobileHelpText': 'Utilisez deux doigts pour déplacer la carte'
        };
    };

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

    /**
     * Carry the module's own SOURCES across a basemap swap, and only those.
     *
     * A source id present in the outgoing style but absent from the incoming
     * one is by definition not part of either basemap: positron and
     * dark-matter are the same style with different paint, so they declare the
     * same source ids as each other, and the graph canvas declares none. What
     * is left over is what a panel added — `spatial-places`, `net-edges`,
     * `iwac-choropleth-*`, and the ten others. The `geojson` test is the belt
     * to that braces: every source this module has ever added is inline
     * GeoJSON, so a vector or raster leftover would be a basemap's, not ours.
     *
     * Sources, deliberately, and NOT layers. `setStyle` diffs, so a source
     * whose spec is unchanged is not rebuilt: the GeoJSON is not re-parsed and
     * not re-tiled (spatial's ~544 places, the entity network's ~10k edges,
     * the choropleth polygons), and the feature-state the hover highlight
     * keys on lives on the source, so it survives too. Layers are left to be
     * dropped and re-added by `onStyleReady`, which every consumer already
     * guards with `getLayer` — and that re-add is exactly where their paint
     * colours get re-resolved from the new theme's tokens. Carrying the
     * layers as well would keep the OLD theme's colours baked into them,
     * which is the one thing a theme swap must not do.
     */
    P.carryOwnSources = function (previous, next) {
        if (!previous || !previous.sources) return next;
        var kept = {};
        var incoming = (next && next.sources) || {};
        Object.keys(previous.sources).forEach(function (id) {
            var source = previous.sources[id];
            if (!incoming[id] && source && source.type === 'geojson') {
                kept[id] = source;
            }
        });
        if (!Object.keys(kept).length) return next;
        var merged = {};
        Object.keys(incoming).forEach(function (id) { merged[id] = incoming[id]; });
        Object.keys(kept).forEach(function (id) { merged[id] = kept[id]; });
        var out = {};
        Object.keys(next || {}).forEach(function (key) { out[key] = next[key]; });
        out.sources = merged;
        return out;
    };

    P.setMapTheme = function (map, mode) {
        if (!map) return false;
        var next = mode === 'dark' ? 'dark' : 'light';
        if (map._iwacThemeMode === next) return false;
        map._iwacThemeMode = next;
        // Graph-mode maps (abstract layouts with no basemap) swap to a
        // freshly-built blank style instead of a Carto URL; their
        // custom layers are rebuilt by the same onStyleReady path with
        // colors re-resolved from the new theme's tokens.
        //
        // `transformStyle` carries the module's own GeoJSON sources over
        // (P.carryOwnSources): the data is not re-parsed or re-tiled and the
        // hover feature-state survives, while the layers are still rebuilt so
        // their paint picks up the new theme.
        var style = map._iwacStyleMode === 'graph'
            ? P.buildGraphStyle()
            : ns.getBasemapStyle(next);
        try {
            map.setStyle(style, { transformStyle: P.carryOwnSources });
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
            // The same font endpoint the positron/dark-matter basemaps
            // use, from ns.BASEMAP — an abstract graph needs Noto for its
            // node labels even though it has no basemap at all.
            glyphs: ns.BASEMAP.glyphs,
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

    /* ----------------------------------------------------------------- */
    /*  The bubble maps' shared vocabulary                                */
    /* ----------------------------------------------------------------- */

    // Where a token cannot be read (a render before the theme sheet is in,
    // a test without a stylesheet) the theme's own light values stand in.
    var TOKEN_FALLBACK = {
        '--primary': '#ce4115',
        '--ink':     '#2c2f37',
        '--border':  '#d4d6da',
        '--surface': '#fdfdfd',
        '--muted':   '#66696e'
    };

    /**
     * A theme token as a MapLibre colour: the live custom property, or the
     * fallback, normalised — the theme's OKLCH tokens otherwise serialise
     * as oklab()/oklch(), which MapLibre's style validator rejects and the
     * whole layer silently fails to load. Until v1.63.0 six map panels
     * each carried an `ml / resolvePrimary / resolveInk` trio for this.
     *
     * @param {string} varName   e.g. '--primary'
     * @param {string} [fallback]  default: the token's light value
     * @returns {string}
     */
    P.mapColor = function (varName, fallback) {
        var resolved = ns.resolveCssVar && ns.resolveCssVar(varName);
        return P.normalizeColorForMapLibre(resolved || fallback || TOKEN_FALLBACK[varName] || '');
    };

    /** `hovered` under feature-state hover (P.attachFeatureStateHover), else `resting`. */
    P.hoverCase = function (hovered, resting) {
        return ['case', ['boolean', ['feature-state', 'hover'], false], hovered, resting];
    };

    /**
     * Bubble radius from a count property, on a square root: area, not
     * diameter, grows with the count, so the same 10:1 ratio reads as
     * 10:1 on every panel. Linear made area ∝ count², and the ratio read
     * as ~3× on one map and ~100× on the next.
     *
     * @param {string} key    the feature property
     * @param {number} max    the largest count in the source
     * @param {number} minPx  radius at 0
     * @param {number} maxPx  radius at `max`
     */
    P.countRadius = function (key, max, minPx, maxPx) {
        return [
            'interpolate', ['linear'], ['sqrt', ['get', key]],
            0, minPx,
            Math.sqrt(Math.max(1, max || 1)), maxPx
        ];
    };

    /**
     * Draw the big bubbles first: a small one beside Abidjan's then sits on
     * top instead of under it, and can be hovered and clicked.
     */
    P.countSortKey = function (key) {
        return ['*', -1, ['get', key]];
    };

    /**
     * The paint every bubble layer shares — a fill, a stroke, and the hover
     * lift (brighter, thicker) feature-state hover drives.
     *
     * @param {Object} cfg
     *   radius — a number or expression (P.countRadius)
     *   color — fill (default: --primary); stroke — stroke (default: --ink)
     *   opacity — [resting, hovered] (default [0.75, 1])
     *   strokeWidth — [resting, hovered] (default [1.5, 3])
     */
    P.bubblePaint = function (cfg) {
        cfg = cfg || {};
        var opacity = cfg.opacity || [0.75, 1];
        var width = cfg.strokeWidth || [1.5, 3];
        return {
            'circle-radius': cfg.radius != null ? cfg.radius : 6,
            'circle-color': cfg.color || P.mapColor('--primary'),
            'circle-opacity': P.hoverCase(opacity[1], opacity[0]),
            'circle-stroke-width': P.hoverCase(width[1], width[0]),
            'circle-stroke-color': cfg.stroke || P.mapColor('--ink')
        };
    };

    /**
     * A circle layer on P.bubblePaint, big-first when `sortKey` names the
     * count property.
     *
     * @param {Object} cfg  id, source, [filter], [sortKey], + P.bubblePaint's
     */
    P.bubbleLayer = function (cfg) {
        var layer = { id: cfg.id, type: 'circle', source: cfg.source, paint: P.bubblePaint(cfg) };
        if (cfg.sortKey) layer.layout = { 'circle-sort-key': P.countSortKey(cfg.sortKey) };
        if (cfg.filter) layer.filter = cfg.filter;
        return layer;
    };

    /**
     * `[[west, south], [east, north]]` of `{lng, lat}` points, or null when
     * there are none. Points without finite coordinates are skipped.
     */
    P.boundsOf = function (points) {
        var w = Infinity, s = Infinity, e = -Infinity, n = -Infinity, any = false;
        (points || []).forEach(function (p) {
            if (!p || !isFinite(p.lng) || !isFinite(p.lat)) return;
            any = true;
            if (p.lng < w) w = p.lng;
            if (p.lng > e) e = p.lng;
            if (p.lat < s) s = p.lat;
            if (p.lat > n) n = p.lat;
        });
        return any ? [[w, s], [e, n]] : null;
    };

    /**
     * Fit the view to points. One point gets a centre and `singleZoom`
     * (fitBounds on a zero-area box picks the maximum zoom); several get
     * fitBounds with the padding / maxZoom / duration given. Never throws:
     * a degenerate box keeps the current view.
     *
     * @param {maplibregl.Map} map
     * @param {Array<{lng:number, lat:number}>} points
     * @param {{padding?:number, maxZoom?:number, duration?:number, singleZoom?:number}} [opts]
     * @returns {boolean} whether the view moved
     */
    P.fitToPoints = function (map, points, opts) {
        opts = opts || {};
        var pts = (points || []).filter(function (p) { return p && isFinite(p.lng) && isFinite(p.lat); });
        if (!map || !pts.length) return false;
        try {
            if (pts.length === 1) {
                if (opts.singleZoom == null) return false;
                map.setCenter([pts[0].lng, pts[0].lat]);
                map.setZoom(opts.singleZoom);
                return true;
            }
            var fit = {};
            ['padding', 'maxZoom', 'duration'].forEach(function (k) {
                if (opts[k] != null) fit[k] = opts[k];
            });
            map.fitBounds(P.boundsOf(pts), fit);
            return true;
        } catch (err) {
            return false;   // degenerate bounds — keep the current view
        }
    };

    /**
     * A popup on click on one or more layers.
     *
     * Registered ONCE on the map, never inside onStyleReady — a theme swap
     * reloads the style, and a handler registered there stacks a copy per
     * toggle until one click opens N popups. Hits are resolved through
     * queryRenderedFeatures against the layers that exist at click time,
     * so the handler survives the swap and costs nothing while the layers
     * are being rebuilt.
     *
     * @param {maplibregl.Map} map
     * @param {Object} cfg
     *   layers — a layer id, an array of ids, or a function returning them
     *   pick(features) — choose among several hits (default: the first)
     *   content(feature, e) — a P.buildMapPopup config, a DOM node, an HTML
     *     string, or null to open nothing
     *   lngLat(feature, e) — the anchor (default: a point feature's own
     *     coordinates, else the click point)
     *   popup — options for P.createIwacPopup
     *     (default { closeButton: true, closeOnClick: true })
     *   ease — `{ offset, duration }` to easeTo the anchor first, so a
     *     popup that grows downward has room
     *   onOpen(popup, feature, e) — after the popup is on the map (a
     *     caller that fills it in asynchronously)
     */
    P.attachMapClickPopup = function (map, cfg) {
        if (!map || !cfg) return;
        function layerIds() {
            var ids = typeof cfg.layers === 'function' ? cfg.layers() : cfg.layers;
            ids = Array.isArray(ids) ? ids : [ids];
            return ids.filter(function (id) { return id && map.getLayer(id); });
        }
        map.on('click', function (e) {
            var layers = layerIds();
            if (!layers.length) return;
            var hits = map.queryRenderedFeatures(e.point, { layers: layers });
            if (!hits || !hits.length) return;
            var feature = cfg.pick ? cfg.pick(hits) : hits[0];
            if (!feature) return;
            var content = cfg.content(feature, e);
            if (!content) return;
            var at = cfg.lngLat ? cfg.lngLat(feature, e)
                : (feature.geometry && feature.geometry.type === 'Point'
                    ? feature.geometry.coordinates.slice() : e.lngLat);
            if (cfg.ease) {
                try {
                    map.easeTo({ center: at, offset: cfg.ease.offset || [0, 80], duration: cfg.ease.duration || 300 });
                } catch (err) { /* map may not be ready yet */ }
            }
            var popup = P.createIwacPopup(cfg.popup || { closeButton: true, closeOnClick: true });
            if (!popup) return;
            popup.setLngLat(at);
            if (typeof content === 'string') popup.setHTML(content);
            else if (content.nodeType) popup.setDOMContent(content);
            else popup.setDOMContent(P.buildMapPopup(content));
            popup.addTo(map);
            if (cfg.onOpen) cfg.onOpen(popup, feature, e);
        });
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
     * @param {boolean} [config.globe=false]  Show the GlobeControl toggle.
     *   Opt-in: ROADMAP §4 and §10 both list globe projection as "won't do".
     * @param {boolean} [config.navigation=true]  Show the NavigationControl
     * @param {boolean} [config.fullscreen=true]  Show MapLibre's native
     *   FullscreenControl. Pass false where the panel toolbar already has one.
     * @param {string} [config.title]  What this map shows, in one phrase.
     *   Becomes MapLibre's `Map.Title` and the host's `aria-label`, so a
     *   screen reader announces the map rather than "application".
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
            defaultStyle = ns.getBasemapStyle();
        }

        var baseOptions = {
            container: container,
            style: defaultStyle,
            center: config.center || [0, 0],
            zoom: config.zoom != null ? config.zoom : 2,
            attributionControl: { compact: true },
            // The standard embedded-map etiquette: wheel zoom needs Ctrl/⌘,
            // touch pan needs two fingers, page scroll always wins. The
            // historical reason not to was MapLibre's English-only hint
            // dialog, which `locale` fixes. Opt out per map via
            // `mapOptions: { cooperativeGestures: false }`.
            cooperativeGestures: true,
            locale: config.title
                ? Object.assign(P.mapLocale(), { 'Map.Title': config.title })
                : P.mapLocale(),
            // These are flat thematic maps of one region. Rotating or
            // pitching them produces a view no reader wants and several
            // cannot undo (the compass that resets north is off, below).
            // A map that genuinely wants them turns them back on through
            // `mapOptions`.
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            // NOT preserveDrawingBuffer. Keeping the WebGL drawing buffer
            // for the whole life of every map, on every page, to serve the
            // rare PNG export is backwards: the toolbar now forces a fresh
            // render immediately before it reads the canvas
            // (`panel-toolbar.js`), which is what actually guarantees
            // pixels. `mapOptions.preserveDrawingBuffer: true` remains the
            // escape hatch.
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

        // Built-in controls.
        //
        // No compass and no pitch dial: rotation and pitch are off (above),
        // so a compass would reset a bearing nothing can change and a pitch
        // dial would visualise an angle that is always zero.
        if (config.navigation !== false) {
            map.addControl(new maplibregl.NavigationControl({
                showCompass: false,
                visualizePitch: false
            }), 'top-right');
        }
        // Globe is OPT-IN. ROADMAP §4 and §10 both list globe projection as
        // "won't do" — editorial-product register, not archival — and the
        // toggle was nonetheless shipping on ten of twelve maps because the
        // factory defaulted it on. `globe: true` still works for a map that
        // wants one.
        if (config.globe === true && typeof maplibregl.GlobeControl === 'function') {
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
        var el = typeof container === 'string' ? document.getElementById(container) : container;
        // Eleven of twelve map hosts carried no accessible name, so a screen
        // reader reached an interactive canvas and could only call it
        // "application". MapLibre's own `Map.Title` names the canvas; this
        // names the container the reader tabs into.
        if (el && config.title && !el.getAttribute('aria-label')) {
            el.setAttribute('aria-label', config.title);
        }
        if (typeof ns.registerMap === 'function') {
            ns.registerMap(map, el);
        }

        return map;
    };

    /* ----------------------------------------------------------------- */
    /*  Popups                                                            */
    /* ----------------------------------------------------------------- */

    /**
     * Create a MapLibre popup pre-scoped to the IWAC stylesheet hooks.
     *
     * Stacks an `iwac-vis-maplibre-popup` class onto the popup root so our
     * CSS can target the close button, tip and content without fighting
     * MapLibre's built-in rules.
     *
     * **The bounds are CSS now.** Keeping a popup inside its map used to be
     * ~150 lines here: six overridden methods (`addTo`, three content
     * setters, two option setters), a `resize` listener per open popup, and
     * three layout constants transcribed from MapLibre's distributed
     * stylesheet — which is a copy, and had been left citing 6.3 while the
     * pin moved to 6.6. `.iwac-vis-map` is a size container, so
     * `iwac-maplibre.css` expresses the same two guarantees directly:
     *
     *   - height ≤ half the map minus the tip, so one of the top/bottom
     *     anchors always fits;
     *   - width ≤ two thirds of the map, the matching guarantee for
     *     MapLibre's left/centre/right anchor thresholds.
     *
     * The browser re-evaluates both on every container resize, including
     * fullscreen and late content insertion, with no listener to attach and
     * none to leak.
     *
     * **One line of JavaScript survives, and it is not styling.** MapLibre
     * picks its anchor by comparing the marker's x against `maxWidth`, the
     * OPTION — not against the box CSS actually produced. Left at the 320px
     * default it reasons about a wider popup than it draws and chooses a
     * left/right anchor one threshold too early, which puts the popup
     * partly outside a narrow map. So `addTo` reads back the width the
     * container query resolved and hands MapLibre that number. It is the
     * only override, it attaches no listener, and MapLibre re-anchors on
     * every subsequent `render`, so a later resize needs nothing from here.
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
        var originalAddTo = popup.addTo;
        popup.addTo = function (map) {
            var result = originalAddTo.call(popup, map);
            syncAnchorWidth(popup);
            return result;
        };
        return popup;
    };

    /**
     * Tell MapLibre the width its own stylesheet produced, so the anchor it
     * picks is the one that actually fits. Re-entrant by construction: the
     * measured width is already the cap, so setting it as `maxWidth` cannot
     * change the measurement.
     */
    function syncAnchorWidth(popup) {
        try {
            var el = popup.getElement && popup.getElement();
            if (!el) return;
            var content = el.querySelector('.maplibregl-popup-content');
            if (!content) return;
            var width = Math.ceil(content.getBoundingClientRect().width);
            if (width > 0) popup.setMaxWidth(width + 'px');
        } catch (e) { /* best effort: a wrong anchor is not worth throwing over */ }
    }
})();
