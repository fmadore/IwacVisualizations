/**
 * Geographic flow map: origin → current location arcs on MapLibre.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 *
 * Data format:
 *   { nodes: [{ name, lat, lon, itemId }],
 *     links: [{ from, fromLat, fromLon, to, toLat, toLon, value }] }
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;

    ns.charts = ns.charts || {};

    ns.charts.buildGeoFlows = function (el, data) {
        if (!data || !data.links || data.links.length < 1) return;
        if (typeof maplibregl === 'undefined') return;

        var map = new maplibregl.Map({
            container: el,
            style: ns.getBasemapStyle(),
            center: [10, 5],
            zoom: 2.5,
            attributionControl: false,
            cooperativeGestures: true
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }));

        map.on('load', function () {
            // Build GeoJSON for flow arcs.
            var features = data.links.map(function (l) {
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [[l.fromLon, l.fromLat], [l.toLon, l.toLat]]
                    },
                    properties: {
                        from: l.from, to: l.to, value: l.value,
                        width: Math.max(1, Math.min(6, Math.sqrt(l.value)))
                    }
                };
            });

            map.addSource('flows', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: features }
            });

            map.addLayer({
                id: 'flow-lines',
                type: 'line',
                source: 'flows',
                paint: {
                    'line-color': THEME.accent,
                    'line-width': ['get', 'width'],
                    'line-opacity': 0.5
                }
            });

            // Origin and current location markers.
            var seenOrigins = {};
            var seenCurrents = {};
            var originFeatures = [];
            var currentFeatures = [];

            data.links.forEach(function (l) {
                var oKey = l.fromLat + ',' + l.fromLon;
                if (!seenOrigins[oKey]) {
                    seenOrigins[oKey] = true;
                    originFeatures.push({
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [l.fromLon, l.fromLat] },
                        properties: { name: l.from, type: 'origin' }
                    });
                }
                var cKey = l.toLat + ',' + l.toLon;
                if (!seenCurrents[cKey]) {
                    seenCurrents[cKey] = true;
                    currentFeatures.push({
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [l.toLon, l.toLat] },
                        properties: { name: l.to, type: 'current' }
                    });
                }
            });

            map.addSource('origins', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: originFeatures }
            });
            map.addSource('currents', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: currentFeatures }
            });

            map.addLayer({
                id: 'origin-dots',
                type: 'circle',
                source: 'origins',
                paint: {
                    'circle-radius': 5,
                    'circle-color': COLORS[1],
                    'circle-stroke-width': 1,
                    'circle-stroke-color': THEME.border
                }
            });

            map.addLayer({
                id: 'current-dots',
                type: 'circle',
                source: 'currents',
                paint: {
                    'circle-radius': 5,
                    'circle-color': COLORS[2],
                    'circle-stroke-width': 1,
                    'circle-stroke-color': THEME.border
                }
            });

            // Tooltips.
            ['flow-lines', 'origin-dots', 'current-dots'].forEach(function (layerId) {
                map.on('mouseenter', layerId, function () { map.getCanvas().style.cursor = 'pointer'; });
                map.on('mouseleave', layerId, function () { map.getCanvas().style.cursor = ''; });
            });

            map.on('click', 'flow-lines', function (e) {
                var p = e.features[0].properties;
                new maplibregl.Popup({ className: 'rv-map-popup' })
                    .setLngLat(e.lngLat)
                    .setHTML('<div class="rv-popup-content"><strong>' + p.from + '</strong> \u2192 <strong>' + p.to + '</strong><br/>' + p.value + ' items</div>')
                    .addTo(map);
            });

            map.on('click', 'origin-dots', function (e) {
                var p = e.features[0].properties;
                new maplibregl.Popup({ className: 'rv-map-popup' })
                    .setLngLat(e.lngLat)
                    .setHTML('<div class="rv-popup-content"><strong>' + p.name + '</strong><br/><em>Origin</em></div>')
                    .addTo(map);
            });

            map.on('click', 'current-dots', function (e) {
                var p = e.features[0].properties;
                new maplibregl.Popup({ className: 'rv-map-popup' })
                    .setLngLat(e.lngLat)
                    .setHTML('<div class="rv-popup-content"><strong>' + p.name + '</strong><br/><em>Current location</em></div>')
                    .addTo(map);
            });

            // Fit bounds to all points.
            var bounds = new maplibregl.LngLatBounds();
            data.links.forEach(function (l) {
                bounds.extend([l.fromLon, l.fromLat]);
                bounds.extend([l.toLon, l.toLat]);
            });
            map.fitBounds(bounds, { padding: 40, maxZoom: 8 });
        });

        // MapLibre map — no ECharts instance returned.
        return null;
    };
})();
