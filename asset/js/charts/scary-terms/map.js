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
 * The map itself is the shared filtered places map (shared/places-map.js)
 * — the same one laicite/map.js draws; this file supplies the count under
 * the active filter, the family palette and the popup lines.
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

    function buildScaryMap(mapEl, placesData, opts) {
        var getFilter = opts.getFilter;
        var termColors = opts.termColors || {};
        return P.createFilteredPlacesMap(mapEl, {
            places: (placesData && placesData.places) || [],
            sourceId: SOURCE_ID,
            layerId: LAYER_ID,
            count: function (place) { return placeCount(place, getFilter()); },
            // The active family's palette colour, or --primary for "all".
            color: function () {
                var filter = getFilter();
                return filter.family && termColors[filter.family];
            },
            siteBase: opts.siteBase || '',
            popupLines: function (place, count) {
                var topFamilies = Object.keys(place.by_family || {}).slice(0, 3);
                var lines = [P.t('scary.matrix_articles', { count: P.formatNumber(count) })];
                if (topFamilies.length) {
                    lines.push(P.t('scary.map_top_families') + ': ' + topFamilies.join(', '));
                }
                if (place.first_year && place.last_year) {
                    lines.push(place.first_year + ' – ' + place.last_year);
                }
                return lines;
            }
        });
    }

    /**
     * Create the map view controller. Call once, the first time the map
     * view activates; afterwards call `.update()` on filter changes and
     * `.resize()` when the container becomes visible again.
     *
     * Always returns a controller: the shared map is gated (P.deferMaplibre
     * inside P.createFilteredPlacesMap), so MapLibre arriving late — an ES
     * module imported in parallel with the script chain — is replayed, and
     * "Map library unavailable" shows only when the import genuinely fails.
     *
     * @param {HTMLElement} mapEl
     * @param {Object} placesData   parsed scary-terms-places.json
     * @param {Object} opts
     * @param {function():{family:?string, country:?string}} opts.getFilter
     * @param {Object<string,string>} opts.termColors
     * @param {string} opts.siteBase
     * @returns {{update: function(), resize: function(), target: function()}}
     */
    S.createScaryMap = function (mapEl, placesData, opts) {
        return buildScaryMap(mapEl, placesData, opts);
    };

    /**
     * `<details>` fallback: ranked list of the top places under the
     * active filter — the data path for screen readers / no-WebGL.
     */
    S.buildPlacesDetails = function (placesData, filter) {
        return P.buildRankedPlacesDetails({
            places: (placesData && placesData.places) || [],
            count: function (p) { return placeCount(p, filter); },
            summary: P.t('scary.map_places_list'),
            placeLabel: P.t('scary.map_place'),
            countLabel: P.t('scary.articles_col')
        });
    };
})();
