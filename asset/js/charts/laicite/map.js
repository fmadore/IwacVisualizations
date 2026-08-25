/**
 * IWAC Visualizations — Laïcité block: Map (issue #14, view 10).
 *
 * MapLibre bubble map of the geocoded places tagged on dossier items.
 * Bubble size = items under the active filter; colour = the active frame's
 * palette colour, or --primary when no frame is selected.
 *
 * Reuses the shared map stack end to end — P.createIwacMap (theme-aware
 * basemap that swaps on toggle), P.buildCountFeatures, feature-state hover,
 * P.createIwacPopup + P.buildMapPopup — exactly as scary-terms/map.js does.
 * Every colour handed to a MapLibre paint property goes through
 * P.normalizeColorForMapLibre: the theme's OKLCH tokens otherwise serialize
 * as oklab(...) and the whole layer silently fails to load.
 *
 * What the map does NOT claim: a place appears only when the IWAC index
 * holds coordinates for it, so this is a map of what is catalogued, not of
 * everything the dossier mentions. The panel says so under the map.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite map: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    var SOURCE_ID = 'iwac-laicite-places';
    var LAYER_ID = 'iwac-laicite-place-circles';

    /** Items for one place under the active filter (0 = hidden). */
    function placeCount(place, state) {
        if (state.mapFrame) return (place.by_frame || {})[state.mapFrame] || 0;
        if (state.mapCountry) return (place.by_country || {})[state.mapCountry] || 0;
        return place.items || 0;
    }
    L.laicitePlaceCount = placeCount;

    /** Countries the bundle can actually filter on. */
    L.placeCountries = function (bundle) {
        var seen = {};
        ((bundle || {}).places || []).forEach(function (p) {
            Object.keys(p.by_country || {}).forEach(function (c) { seen[c] = true; });
        });
        return Object.keys(seen).sort();
    };

    /**
     * @param {Object} cfg {bundle, metadata, state, frameColors, siteBase}
     * @returns {{root: HTMLElement, mount: function():void}}
     */
    L.buildMap = function (cfg) {
        var bundle = cfg.bundle;
        var root = P.el('div', 'iwac-vis-laicite-map-view');

        var panel = P.el('div', 'iwac-vis-panel');
        panel.appendChild(P.el('h4', null, P.t('laicite.map_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc', P.t('laicite.map_desc')));

        if (!bundle || !(bundle.places || []).length) {
            panel.appendChild(P.buildNoDataState());
            root.appendChild(panel);
            return { root: root, mount: function () {} };
        }

        var mapEl = P.el('div', 'iwac-vis-map iwac-vis-laicite-map');
        panel.appendChild(mapEl);

        var details = buildPlacesDetails(bundle, cfg.state);
        if (details) panel.appendChild(details);

        var method = P.el('div', 'iwac-vis-laicite-method');
        method.appendChild(P.el('p', null, P.t('laicite.map_note')));
        method.appendChild(P.el('p', 'iwac-vis-laicite-method-stats',
            P.t('laicite.map_method', {
                places: P.formatNumber((bundle.places || []).length),
                min: bundle.min_items
            })));
        panel.appendChild(method);
        root.appendChild(panel);

        var controller = null;
        return {
            root: root,
            mount: function () {
                // MapLibre 6 is an ES module the loader imports in parallel
                // with the script chain, so it may not be here even on a view
                // the reader had to click into. `P.deferMaplibre` hands back a
                // controller immediately, holds the map spinner in `mapEl`, and
                // replays whatever was called meanwhile.
                controller = P.deferMaplibre(mapEl, function () {
                    return createMap(mapEl, bundle, cfg);
                }, ['resize', 'update']);
                // The host was display:none until this view activated, so
                // MapLibre measured a zero-height container.
                window.setTimeout(function () { controller.resize(); }, 0);
            },
            update: function () { if (controller) controller.update(); }
        };
    };

    function createMap(mapEl, bundle, cfg) {
        var places = bundle.places || [];
        var state = cfg.state;
        var frameColors = cfg.frameColors || {};
        var siteBase = cfg.siteBase || '';

        function activeColor() {
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            var raw = (state.mapFrame && frameColors[state.mapFrame])
                || tokens.primary || '#ce4115';
            return P.normalizeColorForMapLibre(raw);
        }

        function buildFeatures() {
            var items = [];
            places.forEach(function (place, idx) {
                var count = placeCount(place, state);
                if (count <= 0) return;
                items.push({ lng: place.lng, lat: place.lat, count: count, idx: idx });
            });
            return P.buildCountFeatures(items, {
                countKey: 'count',
                toProps: function (item) {
                    return { count: item.count, idx: item.idx };
                }
            });
        }

        function paintFor(max) {
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            var stroke = P.normalizeColorForMapLibre(tokens.surface || '#ffffff');
            return {
                'circle-color': activeColor(),
                'circle-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.95, 0.7
                ],
                'circle-stroke-color': stroke,
                'circle-stroke-width': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    2, 1
                ],
                // sqrt scaling so Abidjan and Ouagadougou do not swallow
                // the Sahel — the same treatment as every IWAC bubble map.
                'circle-radius': [
                    'interpolate', ['linear'], ['sqrt', ['get', 'count']],
                    0, 3,
                    Math.sqrt(Math.max(1, max)), 24
                ]
            };
        }

        var map = P.createIwacMap(mapEl, {
            center: [2.5, 12],
            zoom: 4,
            onStyleReady: function (m) {
                var built = buildFeatures();
                m.addSource(SOURCE_ID, {
                    type: 'geojson',
                    generateId: true,
                    data: built.collection
                });
                m.addLayer({
                    id: LAYER_ID,
                    type: 'circle',
                    source: SOURCE_ID,
                    paint: paintFor(built.max)
                });
            }
        });
        if (!map) return null;

        // Wired ONCE per instance, outside onStyleReady, so handlers do not
        // stack up every time the theme toggle reloads the style.
        P.attachFeatureStateHover(map, { layer: LAYER_ID, source: SOURCE_ID });

        map.on('click', LAYER_ID, function (e) {
            var f = e.features && e.features[0];
            if (!f) return;
            var place = places[f.properties.idx];
            if (!place) return;

            var lines = [P.t('laicite.map_items', {
                count: P.formatNumber(placeCount(place, state))
            })];
            var topFrames = Object.keys(place.by_frame || {})
                .sort(function (a, b) {
                    return (place.by_frame[b] || 0) - (place.by_frame[a] || 0);
                })
                .slice(0, 3)
                .map(function (frame) {
                    return L.frameLabel(cfg.metadata || {}, frame);
                });
            if (topFrames.length) {
                lines.push(P.t('laicite.map_top_frames') + ': ' + topFrames.join(', '));
            }
            if (place.first_year && place.last_year) {
                lines.push(place.first_year + ' – ' + place.last_year);
            }
            P.createIwacPopup()
                .setLngLat([place.lng, place.lat])
                .setDOMContent(P.buildMapPopup({
                    title: place.name,
                    titleHref: siteBase ? siteBase + '/item/' + place.o_id : null,
                    subtitleLines: lines
                }))
                .addTo(map);
        });

        return {
            map: map,
            resize: function () {
                try { map.resize(); } catch (e) { /* container mid-toggle */ }
            },
            update: function () {
                var src = map.getSource(SOURCE_ID);
                if (!src) return;   // style reload in flight — onStyleReady rebuilds
                var built = buildFeatures();
                src.setData(built.collection);
                var paint = paintFor(built.max);
                Object.keys(paint).forEach(function (prop) {
                    try { map.setPaintProperty(LAYER_ID, prop, paint[prop]); } catch (e) {}
                });
            }
        };
    }

    /** `<details>` fallback — the data path for screen readers and no-WebGL. */
    function buildPlacesDetails(bundle, state) {
        var ranked = (bundle.places || []).map(function (p) {
            return { place: p, count: placeCount(p, state) };
        }).filter(function (r) { return r.count > 0; });
        if (!ranked.length) return null;
        ranked.sort(function (a, b) { return b.count - a.count; });

        var details = P.el('details', 'iwac-vis-timeline-details');
        details.appendChild(P.el('summary', null, P.t('laicite.map_places_list')));
        var table = P.el('table', 'iwac-vis-table');
        var thead = P.el('thead');
        var headRow = P.el('tr');
        headRow.appendChild(P.el('th', null, P.t('laicite.map_place')));
        headRow.appendChild(P.el('th', null, P.t('laicite.items')));
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = P.el('tbody');
        ranked.slice(0, 50).forEach(function (r) {
            var tr = P.el('tr');
            tr.appendChild(P.el('td', null, r.place.name));
            tr.appendChild(P.el('td', null, P.formatNumber(r.count)));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        details.appendChild(table);
        return details;
    }
})();
