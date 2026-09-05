/**
 * IWAC Visualizations — Laïcité block: Map (issue #14, view 10).
 *
 * MapLibre bubble map of the geocoded places tagged on dossier items.
 * Bubble size = items under the active filter; colour = the active frame's
 * palette colour, or --primary when no frame is selected.
 *
 * The map itself is the shared filtered places map (shared/places-map.js)
 * — the same one scary-terms/map.js draws; this file supplies the count
 * under the active filter, the frame palette and the popup lines.
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
                // The shared map is gated (P.deferMaplibre inside): the
                // controller is live at once and replays what is called
                // before MapLibre arrives.
                controller = createMap(mapEl, bundle, cfg);
                // The host was display:none until this view activated, so
                // MapLibre measured a zero-height container.
                window.setTimeout(function () { controller.resize(); }, 0);
            },
            update: function () { if (controller) controller.update(); }
        };
    };

    function createMap(mapEl, bundle, cfg) {
        var state = cfg.state;
        var frameColors = cfg.frameColors || {};
        return P.createFilteredPlacesMap(mapEl, {
            places: bundle.places || [],
            sourceId: SOURCE_ID,
            layerId: LAYER_ID,
            count: function (place) { return placeCount(place, state); },
            // The active frame's palette colour, or --primary for no frame.
            color: function () { return state.mapFrame && frameColors[state.mapFrame]; },
            siteBase: cfg.siteBase || '',
            popupLines: function (place, count) {
                var lines = [P.t('laicite.map_items', { count: P.formatNumber(count) })];
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
                return lines;
            }
        });
    }

    /** `<details>` fallback — the data path for screen readers and no-WebGL. */
    function buildPlacesDetails(bundle, state) {
        return P.buildRankedPlacesDetails({
            places: bundle.places || [],
            count: function (p) { return placeCount(p, state); },
            summary: P.t('laicite.map_places_list'),
            placeLabel: P.t('laicite.map_place'),
            countLabel: P.t('laicite.items')
        });
    }
})();
