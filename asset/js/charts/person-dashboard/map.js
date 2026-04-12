/**
 * IWAC Visualizations — Person Dashboard: locations map panel
 *
 * MapLibre bubble map of places mentioned alongside this person.
 * Reuses createIwacMap + createIwacPopup for theme-aware basemaps.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap) {
        console.warn('IWACVis.person-dashboard/map: missing deps (need createIwacMap)');
        return;
    }

    function featuresFrom(locations) {
        return {
            type: 'FeatureCollection',
            features: (locations || [])
                .filter(function (l) { return l.count > 0; })
                .map(function (l) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
                        properties: {
                            name: l.name,
                            country: l.country || '',
                            count: l.count
                        }
                    };
                })
        };
    }

    function render(panelEl, data, facet) {
        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Map library unavailable')));
            return;
        }

        var byRole = (data && data.locations && data.locations.by_role) || {};

        // Pre-compute the max count across ALL roles so circle radius is
        // stable when the facet changes (otherwise the scale jumps).
        var maxCount = 1;
        ['all', 'subject', 'creator'].forEach(function (role) {
            (byRole[role] || []).forEach(function (l) {
                if (l.count > maxCount) maxCount = l.count;
            });
        });

        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        var map = P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 3.2,
            onStyleReady: function (m) {
                if (!m.getSource('person-locations')) {
                    m.addSource('person-locations', {
                        type: 'geojson',
                        data: featuresFrom(byRole[facet.role])
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
                            'circle-color': '#d97706',
                            'circle-opacity': 0.75,
                            'circle-stroke-width': 1.5,
                            'circle-stroke-color': '#78350f'
                        }
                    });
                }

                m.on('click', 'person-location-circles', function (e) {
                    var f = e.features && e.features[0];
                    if (!f) return;
                    P.createIwacPopup({ closeButton: true, closeOnClick: true })
                        .setLngLat(f.geometry.coordinates)
                        .setHTML(
                            '<strong>' + P.escapeHtml(f.properties.name) + '</strong><br>' +
                            (f.properties.country ? P.escapeHtml(f.properties.country) + '<br>' : '') +
                            P.formatNumber(Number(f.properties.count)) + ' ' + P.t('Mentions').toLowerCase()
                        )
                        .addTo(m);
                });
                m.on('mouseenter', 'person-location-circles', function () { m.getCanvas().style.cursor = 'pointer'; });
                m.on('mouseleave', 'person-location-circles', function () { m.getCanvas().style.cursor = ''; });
            }
        });

        facet.subscribe(function () {
            if (!map) return;
            var src = map.getSource('person-locations');
            if (src) src.setData(featuresFrom(byRole[facet.role]));
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.map = { render: render };
})();
