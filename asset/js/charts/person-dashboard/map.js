/**
 * IWAC Visualizations — Person / Entity Dashboard: locations map panel
 *
 * MapLibre bubble map of places mentioned alongside this person or
 * entity. Clicking a bubble opens a popup that lists the articles at
 * that location — title, publisher, publication date, and a link to
 * the Omeka item page — with client-side pagination when the list is
 * long. Reuses createIwacMap + createIwacPopup for theme-aware
 * basemaps and the shared popup CSS hooks.
 *
 * Popups are built as DOM nodes (not HTML strings) and handed to
 * maplibregl.Popup.setDOMContent so per-popup event listeners (prev /
 * next pagination buttons) survive, and so we don't have to escape
 * arbitrary title text back through innerHTML.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap || !P.buildMapPopup) {
        console.warn('IWACVis.person-dashboard/map: missing deps (need createIwacMap + buildMapPopup)');
        return;
    }

    function featuresFrom(locations) {
        return {
            type: 'FeatureCollection',
            features: (locations || [])
                .filter(function (l) { return l.count > 0; })
                .map(function (l, idx) {
                    return {
                        type: 'Feature',
                        // `idx` lets the click handler find the richer
                        // source record (including the articles list)
                        // from the current `locations` array — feature
                        // properties are string-coerced by MapLibre,
                        // so we can't stash the array there directly.
                        geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
                        properties: {
                            idx: idx,
                            name: l.name,
                            count: l.count
                        }
                    };
                })
        };
    }

    function render(panelEl, data, facet, ctx) {
        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Map library unavailable')));
            return;
        }

        var byRole = (data && data.locations && data.locations.by_role) || {};
        // Current-role locations snapshot — refreshed on facet change
        // so the click handler resolves the correct record.
        var currentLocations = byRole[facet.role] || [];

        // Pre-compute the max count across ALL roles so circle radius is
        // stable when the facet changes (otherwise the scale jumps).
        var maxCount = 1;
        ['all', 'subject', 'creator', 'editor'].forEach(function (role) {
            (byRole[role] || []).forEach(function (l) {
                if (l.count > maxCount) maxCount = l.count;
            });
        });

        var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';

        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        var mapInstance = null;

        function handleClick(e) {
            if (!mapInstance) return;
            if (!mapInstance.getLayer('person-location-circles')) return;
            var features = mapInstance.queryRenderedFeatures(e.point, {
                layers: ['person-location-circles']
            });
            if (!features.length) return;
            var f = features[0];
            var idx = Number(f.properties.idx);
            var loc = currentLocations[idx];
            if (!loc) return;

            var popupNode = P.buildMapPopup({
                title: loc.name,
                titleHref: loc.o_id && siteBase ? siteBase + '/item/' + loc.o_id : null,
                subtitleLines: [
                    P.formatNumber(Number(loc.count || 0)) + ' ' + P.t('Mentions').toLowerCase()
                ],
                articles: loc.articles || [],
                siteBase: siteBase
            });

            P.createIwacPopup({ closeButton: true, closeOnClick: true, maxWidth: '340px' })
                .setLngLat(f.geometry.coordinates.slice())
                .setDOMContent(popupNode)
                .addTo(mapInstance);
        }

        function handleMouseMove(e) {
            if (!mapInstance) return;
            if (!mapInstance.getLayer('person-location-circles')) return;
            var features = mapInstance.queryRenderedFeatures(e.point, {
                layers: ['person-location-circles']
            });
            mapInstance.getCanvas().style.cursor = features.length ? 'pointer' : '';
        }

        function resolvePrimary() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--primary');
            return resolved || '#e67a14';
        }
        function resolveInk() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--ink');
            return resolved || '#18202a';
        }

        var createdMap = P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 3.2,
            onStyleReady: function (m) {
                mapInstance = m;
                if (!m.getSource('person-locations')) {
                    m.addSource('person-locations', {
                        type: 'geojson',
                        data: featuresFrom(currentLocations)
                    });
                }
                if (!m.getLayer('person-location-circles')) {
                    m.addLayer({
                        id: 'person-location-circles',
                        type: 'circle',
                        source: 'person-locations',
                        paint: {
                            'circle-radius': [
                                'interpolate', ['linear'], ['get', 'count'],
                                1, 3,
                                maxCount, 24
                            ],
                            'circle-color': resolvePrimary(),
                            'circle-opacity': 0.75,
                            'circle-stroke-width': 1.5,
                            'circle-stroke-color': resolveInk()
                        }
                    });
                }
            }
        });

        // Attach click/hover handlers ONCE per map instance. MapLibre
        // persists map-level (not layer-filtered) handlers across
        // setStyle calls, so they survive theme swaps without
        // re-attachment and don't stack up on every style.load.
        if (createdMap) {
            mapInstance = createdMap;
            createdMap.on('click', handleClick);
            createdMap.on('mousemove', handleMouseMove);
        }

        facet.subscribe(function () {
            currentLocations = byRole[facet.role] || [];
            if (!mapInstance) return;
            var src = mapInstance.getSource('person-locations');
            if (src) src.setData(featuresFrom(currentLocations));
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.map = { render: render };
})();
