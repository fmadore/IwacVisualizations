/**
 * IWAC Visualizations — Filtered places map + its ranked-list fallback
 *
 * The bubble map two dossier blocks draw over a precomputed places bundle
 * — the laïcité dossier's tagged places and the scary-terms block's —
 * where the count under a bubble depends on the reader's active filter
 * (a frame, a term family, a country) and changes without a reload:
 * `update()` re-counts every place, hides the ones at zero, re-scales the
 * radii to the new maximum and recolours the layer for the active filter.
 * Until v1.63.0 the two blocks carried the same ~230 lines each.
 *
 * Reuses the shared map stack end to end: P.createIwacMap (theme-aware
 * basemap that swaps on toggle), P.buildCountFeatures, the bubble
 * vocabulary in maplibre.js (P.bubbleLayer / P.countRadius / P.mapColor),
 * feature-state hover, P.attachMapClickPopup + P.buildMapPopup. Every
 * colour handed to a paint property goes through
 * P.normalizeColorForMapLibre: the theme's OKLCH tokens otherwise
 * serialise as oklab(...) and the whole layer silently fails to load.
 *
 * The factory is gated here, once: MapLibre 6 is an ES module the loader
 * imports in parallel with the script chain, so P.deferMaplibre hands
 * back a controller immediately, holds the map spinner in `mapEl`, and
 * replays `update()` / `resize()` calls made before the map exists.
 *
 * Load order: after maplibre.js + map-popup.js, before the two blocks.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap || !P.bubbleLayer || !P.buildMapPopup) {
        console.warn('IWACVis.places-map: missing deps (maplibre.js + map-popup.js must load first)');
        return;
    }

    /**
     * @param {HTMLElement} mapEl
     * @param {Object} cfg
     *   places — [{name, lng, lat, o_id, …}], the bundle's places
     *   sourceId, layerId — this map's MapLibre ids
     *   count(place) — items under the active filter (0 = hidden); read
     *     afresh on every update, so it should close over live state
     *   color() — the raw colour for the active filter, or nothing for
     *     --primary; normalised here
     *   popupLines(place, count) — the lines under the popup's title
     *   siteBase — for the popup's title link (P.itemUrl)
     *   center, zoom — default [2.5, 12] / 4, the six countries
     * @returns {{resize: function(), update: function()}} a controller,
     *   live at once (P.deferMaplibre replays calls until the map exists)
     */
    P.createFilteredPlacesMap = function (mapEl, cfg) {
        return P.deferMaplibre(mapEl, function () {
            return buildFilteredPlacesMap(mapEl, cfg);
        }, ['resize', 'update']);
    };

    function buildFilteredPlacesMap(mapEl, cfg) {
        var places = cfg.places || [];
        var SOURCE_ID = cfg.sourceId;
        var LAYER_ID = cfg.layerId;
        var siteBase = cfg.siteBase || '';

        function activeColor() {
            var raw = cfg.color && cfg.color();
            return raw ? P.normalizeColorForMapLibre(raw) : P.mapColor('--primary');
        }

        function buildFeatures() {
            var items = [];
            places.forEach(function (place, idx) {
                var count = cfg.count(place);
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
            return P.bubblePaint({
                // sqrt scaling so Abidjan and Ouagadougou do not swallow
                // the Sahel — the same treatment as every IWAC bubble map.
                radius: P.countRadius('count', max, 3, 24),
                color: activeColor(),
                stroke: P.normalizeColorForMapLibre(tokens.surface || '#ffffff'),
                opacity: [0.7, 0.95],
                strokeWidth: [1, 2]
            });
        }

        var map = P.createIwacMap(mapEl, {
            center: cfg.center || [2.5, 12],
            zoom: cfg.zoom != null ? cfg.zoom : 4,
            onStyleReady: function (m) {
                var built = buildFeatures();
                // Guarded like every other map panel: a style that already
                // carries the source (a future transformStyle swap, a
                // double-fired load) gets its data refreshed, not a second
                // addSource that throws inside the style-ready wrapper.
                if (m.getSource(SOURCE_ID)) {
                    m.getSource(SOURCE_ID).setData(built.collection);
                } else {
                    m.addSource(SOURCE_ID, {
                        type: 'geojson',
                        generateId: true,
                        data: built.collection
                    });
                }
                if (!m.getLayer(LAYER_ID)) {
                    var layer = P.bubbleLayer({ id: LAYER_ID, source: SOURCE_ID, sortKey: 'count' });
                    layer.paint = paintFor(built.max);
                    m.addLayer(layer);
                }
            }
        });
        if (!map) return null;

        // Wired ONCE per instance, outside onStyleReady, so handlers do not
        // stack up every time the theme toggle reloads the style.
        P.attachFeatureStateHover(map, { layer: LAYER_ID, source: SOURCE_ID });
        P.attachMapClickPopup(map, {
            layers: LAYER_ID,
            content: function (f) {
                var place = places[f.properties.idx];
                if (!place) return null;
                return {
                    title: place.name,
                    titleHref: siteBase ? P.itemUrl(siteBase, place.o_id) : null,
                    subtitleLines: cfg.popupLines ? cfg.popupLines(place, cfg.count(place)) : []
                };
            },
            lngLat: function (f) {
                var place = places[f.properties.idx];
                return [place.lng, place.lat];
            }
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

    /**
     * The map's `<details>` fallback: the places ranked by their count
     * under the active filter, as a table — the data path for screen
     * readers and for a browser without WebGL.
     *
     * @param {Object} cfg
     *   places, count(place) — as for the map
     *   summary — the `<summary>` text
     *   placeLabel, countLabel — the column headings
     *   limit — rows (default 50)
     * @returns {HTMLElement|null} null when nothing ranks
     */
    P.buildRankedPlacesDetails = function (cfg) {
        var ranked = (cfg.places || []).map(function (p) {
            return { place: p, count: cfg.count(p) };
        }).filter(function (r) { return r.count > 0; });
        if (!ranked.length) return null;
        ranked.sort(function (a, b) { return b.count - a.count; });

        var details = P.el('details', 'iwac-vis-places-details');
        details.appendChild(P.el('summary', null, cfg.summary));
        var table = P.el('table', 'iwac-vis-table');
        var thead = P.el('thead');
        var headRow = P.el('tr');
        headRow.appendChild(P.el('th', null, cfg.placeLabel));
        headRow.appendChild(P.el('th', null, cfg.countLabel));
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = P.el('tbody');
        ranked.slice(0, cfg.limit || 50).forEach(function (r) {
            var tr = P.el('tr');
            tr.appendChild(P.el('td', null, r.place.name));
            tr.appendChild(P.el('td', null, P.formatNumber(r.count)));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        details.appendChild(table);
        return details;
    };
})();
