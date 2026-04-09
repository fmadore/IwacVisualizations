/**
 * Map chart builders: geographic origins map, self-location mini map.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var truncateLabel = ns.truncateLabel, getBasemapStyle = ns.getBasemapStyle;

    ns.charts = ns.charts || {};

    /* -- Map popup builder -- */

    function buildMapPopup(props, locItems, page, perPage, siteBase) {
        var total = locItems.length;
        var totalPages = Math.ceil(total / perPage);
        var start = page * perPage;
        var pageItems = locItems.slice(start, start + perPage);

        var h = '<div class="rv-popup-content">';
        h += '<strong>' + (props.name || '') + '</strong>';
        h += ' <span class="rv-popup-count">' + props.value + ' items</span>';

        if (pageItems.length) {
            h += '<ul class="rv-popup-items">';
            pageItems.forEach(function (it) {
                var url = siteBase ? siteBase + '/item/' + it.id : '#';
                var title = truncateLabel(it.title, 55);
                h += '<li><a href="' + url + '">' + title + '</a></li>';
            });
            h += '</ul>';
        }

        if (totalPages > 1) {
            h += '<div class="rv-popup-pagination">';
            if (page > 0) h += '<button type="button" data-page="' + (page - 1) + '">\u2190</button>';
            h += '<span>' + (page + 1) + ' / ' + totalPages + '</span>';
            if (page < totalPages - 1) h += '<button type="button" data-page="' + (page + 1) + '">\u2192</button>';
            h += '</div>';
        }

        if (props.itemId && siteBase) {
            h += '<a class="rv-popup-location-link" href="' + siteBase + '/item/' + props.itemId + '">View location page \u2192</a>';
        }

        h += '</div>';
        return h;
    }

    /* -- Geographic origins map -- */

    ns.charts.buildMap = function (el, data, siteBase, allData) {
        if (!data || !data.length || typeof maplibregl === 'undefined') return null;

        el.style.borderRadius = '6px';
        var map = new maplibregl.Map({
            container: el,
            style: getBasemapStyle(),
            center: [0, 15],
            zoom: 1.5,
            attributionControl: false,
            cooperativeGestures: true,
        });
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        if (maplibregl.GlobeControl) map.addControl(new maplibregl.GlobeControl(), 'top-right');
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
        // Attribution hidden — source info in map tiles. Users can inspect via browser.

        map.on('load', function () {

            var features = data.map(function (loc) {
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] },
                    properties: { name: loc.name, value: loc.value, itemId: loc.itemId }
                };
            });

            map.addSource('locations', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: features },
                cluster: true,
                clusterMaxZoom: 8,
                clusterRadius: 40,
            });

            map.addLayer({
                id: 'clusters', type: 'circle', source: 'locations',
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': ['step', ['get', 'point_count'], COLORS[0], 10, COLORS[1], 30, COLORS[5]],
                    'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 30, 32],
                    'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
                }
            });

            map.addLayer({
                id: 'cluster-count', type: 'symbol', source: 'locations',
                filter: ['has', 'point_count'],
                layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
                paint: { 'text-color': '#fff' }
            });

            map.addLayer({
                id: 'points', type: 'circle', source: 'locations',
                filter: ['!', ['has', 'point_count']],
                paint: {
                    'circle-color': THEME.accent,
                    'circle-radius': ['interpolate', ['linear'], ['get', 'value'], 1, 7, 50, 18, 200, 28],
                    'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85,
                }
            });

            map.addLayer({
                id: 'point-labels', type: 'symbol', source: 'locations',
                filter: ['!', ['has', 'point_count']],
                layout: { 'text-field': '{name}', 'text-size': 11, 'text-offset': [0, 1.8], 'text-anchor': 'top' },
                paint: { 'text-color': THEME.text, 'text-halo-color': THEME.border, 'text-halo-width': 1.5 }
            });

            var locationItems = {};
            data.forEach(function (loc) {
                if (loc.items && loc.items.length) locationItems[loc.name] = loc.items;
            });

            // --- GeoFlows overlay (origin → current location) ---
            var geoFlows = allData && allData.geoFlows;
            var hasFlows = geoFlows && geoFlows.links && geoFlows.links.length > 0;
            var currentColor = COLORS[2];

            if (hasFlows) {
                var flowFeatures = geoFlows.links.map(function (l) {
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
                    data: { type: 'FeatureCollection', features: flowFeatures }
                });

                // Flow lines rendered below origin points.
                map.addLayer({
                    id: 'flow-lines',
                    type: 'line',
                    source: 'flows',
                    paint: {
                        'line-color': THEME.accent,
                        'line-width': ['get', 'width'],
                        'line-opacity': 0.35
                    }
                }, 'clusters'); // insert before clusters layer

                // Current-location dots.
                var seenCurrents = {};
                var currentFeatures = [];
                geoFlows.links.forEach(function (l) {
                    var key = l.toLat + ',' + l.toLon;
                    if (!seenCurrents[key]) {
                        seenCurrents[key] = true;
                        currentFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: [l.toLon, l.toLat] },
                            properties: { name: l.to }
                        });
                    }
                });

                map.addSource('currents', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: currentFeatures }
                });

                map.addLayer({
                    id: 'current-dots',
                    type: 'circle',
                    source: 'currents',
                    paint: {
                        'circle-radius': 7,
                        'circle-color': currentColor,
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#fff',
                        'circle-opacity': 0.85
                    }
                });

                map.addLayer({
                    id: 'current-labels',
                    type: 'symbol',
                    source: 'currents',
                    layout: { 'text-field': '{name}', 'text-size': 11, 'text-offset': [0, 1.8], 'text-anchor': 'top' },
                    paint: { 'text-color': THEME.text, 'text-halo-color': THEME.border, 'text-halo-width': 1.5 }
                });
            }

            // --- Popup management (single popup at a time) ---
            var activePopup = null;
            function showPopup(lngLat, html) {
                if (activePopup) activePopup.remove();
                activePopup = new maplibregl.Popup({ offset: 12, maxWidth: '320px', className: 'rv-map-popup' })
                    .setLngLat(lngLat)
                    .setHTML(html)
                    .addTo(map);
                return activePopup;
            }

            map.on('click', 'points', function (e) {
                var props = e.features[0].properties;
                var locItems = locationItems[props.name] || [];
                var perPage = 8;

                showPopup(e.lngLat, buildMapPopup(props, locItems, 0, perPage, siteBase));

                function attachPageHandlers() {
                    var el = activePopup && activePopup.getElement();
                    if (!el) return;
                    el.querySelectorAll('[data-page]').forEach(function (btn) {
                        btn.addEventListener('click', function (evt) {
                            evt.stopPropagation();
                            var page = parseInt(btn.dataset.page, 10);
                            activePopup.setHTML(buildMapPopup(props, locItems, page, perPage, siteBase));
                            attachPageHandlers();
                        });
                    });
                }
                attachPageHandlers();
            });

            if (hasFlows) {
                map.on('click', 'flow-lines', function (e) {
                    var p = e.features[0].properties;
                    showPopup(e.lngLat,
                        '<div class="rv-popup-content"><strong>' + p.from + '</strong> \u2192 <strong>' + p.to + '</strong><br/>' + p.value + ' items</div>');
                });

                map.on('click', 'current-dots', function (e) {
                    var p = e.features[0].properties;
                    showPopup(e.lngLat,
                        '<div class="rv-popup-content"><strong>' + p.name + '</strong><br/><em>Current location</em></div>');
                });

                ['flow-lines', 'current-dots'].forEach(function (layerId) {
                    map.on('mouseenter', layerId, function () { map.getCanvas().style.cursor = 'pointer'; });
                    map.on('mouseleave', layerId, function () { map.getCanvas().style.cursor = ''; });
                });
            }

            map.on('click', 'clusters', function (e) {
                var clusterId = e.features[0].properties.cluster_id;
                map.getSource('locations').getClusterExpansionZoom(clusterId, function (err, zoom) {
                    if (err) return;
                    map.easeTo({ center: e.lngLat, zoom: zoom });
                });
            });

            map.on('mouseenter', 'points', function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'points', function () { map.getCanvas().style.cursor = ''; });
            map.on('mouseenter', 'clusters', function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'clusters', function () { map.getCanvas().style.cursor = ''; });

            // --- Fit bounds ---
            var bounds = new maplibregl.LngLatBounds();
            if (features.length) {
                features.forEach(function (f) { bounds.extend(f.geometry.coordinates); });
            }
            if (hasFlows) {
                geoFlows.links.forEach(function (l) {
                    bounds.extend([l.toLon, l.toLat]);
                });
            }
            if (!bounds.isEmpty()) {
                if (features.length === 1 && !hasFlows) {
                    map.setCenter(features[0].geometry.coordinates);
                    map.setZoom(4);
                } else {
                    map.fitBounds(bounds, { padding: 40, maxZoom: 6 });
                }
            }

            // --- Legend ---
            if (hasFlows) {
                var legend = document.createElement('div');
                legend.className = 'rv-map-legend';
                legend.innerHTML =
                    '<div class="rv-map-legend-row"><span class="rv-map-legend-dot" style="background:' + THEME.accent + '"></span> Place of Origin</div>' +
                    '<div class="rv-map-legend-row"><span class="rv-map-legend-dot" style="background:' + currentColor + '"></span> Current Location</div>' +
                    '<div class="rv-map-legend-row"><span class="rv-map-legend-line" style="background:' + THEME.accent + '"></span> Flow</div>';
                el.style.position = 'relative';
                el.appendChild(legend);
            }
        });

        return { resize: function () { map.resize(); } };
    };

    /* -- Self-location mini map -- */

    ns.charts.buildMiniMap = function (el, data) {
        if (!data || !data.lat || typeof maplibregl === 'undefined') return null;
        el.style.borderRadius = '6px';
        var map = new maplibregl.Map({
            container: el,
            style: getBasemapStyle(),
            center: [data.lon, data.lat],
            zoom: 4,
            attributionControl: false,
            scrollZoom: false,
        });
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-left');
        new maplibregl.Marker({ color: THEME.accent })
            .setLngLat([data.lon, data.lat])
            .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML('<strong>' + (data.name || '') + '</strong>'))
            .addTo(map);
        return { resize: function () { map.resize(); } };
    };
})();
