/**
 * IWAC Visualizations — Scary Terms block: Map view controller (issue #3).
 *
 * MapLibre bubble map of geocoded places tagged on articles that contain
 * "scary" terms, driven by the precomputed scary-terms-places.json.
 * Bubble size = matching-article count under the active filter; bubble
 * color = the active family's palette color, or --primary for "all
 * families". Family and country filters are mutually exclusive (the
 * bundle carries per-family and per-article-country splits, not their
 * cross product — the v1 simplification issue #4 accepted).
 *
 * Reuses the shared map stack end to end: P.createIwacMap (theme-aware
 * basemap + swap-on-toggle), P.buildCountFeatures, feature-state hover,
 * P.createIwacPopup + P.buildMapPopup. Every color handed to a MapLibre
 * paint property goes through P.normalizeColorForMapLibre — the theme's
 * OKLCH tokens otherwise serialize as oklab(...) and the layer fails to
 * load.
 *
 * Loaded after scary-terms/helpers.js, before the orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.scaryTerms map: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var S = ns.scaryTerms = ns.scaryTerms || {};

    var SOURCE_ID = 'iwac-scary-places';
    var LAYER_ID = 'iwac-scary-place-circles';

    /** Count for one place under the active filter (0 = hidden). */
    function placeCount(place, filter) {
        if (filter.family) return (place.by_family || {})[filter.family] || 0;
        if (filter.country) return (place.by_country || {})[filter.country] || 0;
        return place.total || 0;
    }
    S.placeCount = placeCount;

    /**
     * Create the map view controller. Call once, the first time the map
     * view activates; afterwards call `.update()` on filter changes and
     * `.resize()` when the container becomes visible again.
     *
     * @param {HTMLElement} mapEl
     * @param {Object} placesData   parsed scary-terms-places.json
     * @param {Object} opts
     * @param {function():{family:?string, country:?string}} opts.getFilter
     * @param {Object<string,string>} opts.termColors
     * @param {string} opts.siteBase
     * @returns {{update: function(), resize: function(), map: Object}|null}
     */
    S.createScaryMap = function (mapEl, placesData, opts) {
        var places = (placesData && placesData.places) || [];
        var getFilter = opts.getFilter;
        var termColors = opts.termColors || {};
        var siteBase = opts.siteBase || '';

        function activeColor(filter) {
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            var raw = (filter.family && termColors[filter.family])
                || tokens.primary || '#e64a19';
            return P.normalizeColorForMapLibre(raw);
        }

        function buildFeatures(filter) {
            var items = [];
            places.forEach(function (place, idx) {
                var count = placeCount(place, filter);
                if (count <= 0) return;
                items.push({
                    lng: place.lng,
                    lat: place.lat,
                    count: count,
                    idx: idx
                });
            });
            return P.buildCountFeatures(items, {
                countKey: 'count',
                toProps: function (item) {
                    return { count: item.count, idx: item.idx };
                }
            });
        }

        function paintFor(filter, max) {
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            var stroke = P.normalizeColorForMapLibre(tokens.surface || '#ffffff');
            return {
                'circle-color': activeColor(filter),
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
                // sqrt scaling keeps the few dominant places from
                // swallowing the Sahel — same treatment as the other
                // IWAC bubble maps.
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
                var filter = getFilter();
                var built = buildFeatures(filter);
                m.addSource(SOURCE_ID, {
                    type: 'geojson',
                    generateId: true,
                    data: built.collection
                });
                var paint = paintFor(filter, built.max);
                m.addLayer({
                    id: LAYER_ID,
                    type: 'circle',
                    source: SOURCE_ID,
                    paint: paint
                });
            }
        });
        if (!map) return null;

        // Hover + click wiring — ONCE per map instance, outside
        // onStyleReady, so handlers don't stack on theme swaps.
        P.attachFeatureStateHover(map, { layer: LAYER_ID, source: SOURCE_ID });

        map.on('click', LAYER_ID, function (e) {
            var f = e.features && e.features[0];
            if (!f) return;
            var place = places[f.properties.idx];
            if (!place) return;

            var filter = getFilter();
            var topFamilies = Object.keys(place.by_family || {}).slice(0, 3);
            var lines = [
                P.t('scary.matrix_articles', {
                    count: P.formatNumber(placeCount(place, filter))
                })
            ];
            if (topFamilies.length) {
                lines.push(P.t('scary.map_top_families') + ': ' + topFamilies.join(', '));
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
                if (!src) return; // style reload in flight — onStyleReady rebuilds
                var filter = getFilter();
                var built = buildFeatures(filter);
                src.setData(built.collection);
                var paint = paintFor(filter, built.max);
                Object.keys(paint).forEach(function (prop) {
                    try { map.setPaintProperty(LAYER_ID, prop, paint[prop]); } catch (e) {}
                });
            }
        };
    };

    /**
     * `<details>` fallback: ranked list of the top places under the
     * active filter — the data path for screen readers / no-WebGL.
     */
    S.buildPlacesDetails = function (placesData, filter) {
        var places = (placesData && placesData.places) || [];
        var ranked = places.map(function (p) {
            return { place: p, count: placeCount(p, filter) };
        }).filter(function (r) { return r.count > 0; });
        if (!ranked.length) return null;
        ranked.sort(function (a, b) { return b.count - a.count; });

        var details = P.el('details', 'iwac-vis-scary-details');
        details.appendChild(P.el('summary', null, P.t('scary.map_places_list')));
        var table = P.el('table', 'iwac-vis-scary-details-table');
        var thead = P.el('thead');
        var headRow = P.el('tr');
        headRow.appendChild(P.el('th', null, P.t('scary.map_place')));
        headRow.appendChild(P.el('th', null, P.t('scary.articles_col')));
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
    };
})();
