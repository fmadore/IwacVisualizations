/**
 * IWAC Visualizations — Collection Overview: World map panel
 *
 * Lazy-loaded MapLibre map with circle markers sized by item count.
 * Faceted by item type via a button group. Choropleth overlay is NOT
 * rendered in v1 — the GeoJSON source is still loaded so a future
 * enhancement can add it with a few lines.
 *
 * Falls back to a "map unavailable" message if maplibregl is missing.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/map: missing dependencies');
        return;
    }

    var ALL_KEY = '__all__';

    function render(panelEl, data, ctx) {
        var basePath = ctx && ctx.basePath ? ctx.basePath : '';
        var dataUrl = basePath + '/modules/IwacVisualizations/asset/data/collection-map.json';
        var geoUrl = basePath + '/modules/IwacVisualizations/asset/data/world_countries_simple.geojson';

        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Map library unavailable')));
            return;
        }

        var loading = P.el('div', 'iwac-vis-loading');
        loading.appendChild(P.el('div', 'iwac-vis-spinner'));
        loading.appendChild(P.el('span', null, P.t('Loading')));
        panelEl.chart.appendChild(loading);

        var loaded = false;
        function loadAndRender() {
            if (loaded) return;
            loaded = true;
            fetch(dataUrl)
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (mapData) {
                    panelEl.chart.innerHTML = '';
                    build(panelEl, mapData, geoUrl);
                })
                .catch(function (err) {
                    console.error('IWACVis map:', err);
                    panelEl.chart.innerHTML = '';
                    panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
                });
        }

        if (typeof IntersectionObserver !== 'undefined') {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        loadAndRender();
                        observer.disconnect();
                    }
                });
            }, { rootMargin: '200px' });
            observer.observe(panelEl.panel);
        } else {
            loadAndRender();
        }
    }

    function build(panelEl, mapData, geoUrl) {
        var state = { type: ALL_KEY };
        var locations = mapData.locations || [];

        var types = {};
        types[ALL_KEY] = P.t('All types');
        ['article', 'publication', 'document', 'audiovisual', 'reference'].forEach(function (t) {
            types[t] = P.t('item_type_' + t);
        });
        var facetBar = P.buildFacetButtons({
            facets: [{
                key: 'type',
                label: P.t('Type'),
                subFacets: types,
                renderAs: 'buttons'
            }],
            activeKey: 'type',
            onChange: function (evt) {
                state.type = evt.subFacet || ALL_KEY;
                updateSource();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        function filteredFeatures() {
            return {
                type: 'FeatureCollection',
                features: locations
                    .filter(function (loc) { return loc.count > 0; })
                    .map(function (loc) {
                        return {
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
                            properties: {
                                name: loc.name,
                                country: loc.country || '',
                                count: loc.count
                            }
                        };
                    })
            };
        }

        // Pre-compute the max count so the radius interpolation is stable
        // across theme swaps (onStyleReady runs multiple times).
        var maxCount = 1;
        (mapData.locations || []).forEach(function (l) {
            if (l.count > maxCount) maxCount = l.count;
        });

        function onStyleReady(map) {
            // Custom sources + layers get wiped by every setStyle call,
            // so we re-add them on every style.load. Guard with getSource
            // in case the callback fires twice for the same load.
            if (!map.getSource('locations')) {
                map.addSource('locations', { type: 'geojson', data: filteredFeatures() });
            }
            if (!map.getSource('countries')) {
                map.addSource('countries', { type: 'geojson', data: geoUrl });
            }
            if (!map.getLayer('location-circles')) {
                map.addLayer({
                    id: 'location-circles',
                    type: 'circle',
                    source: 'locations',
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'count'],
                            1, 3,
                            maxCount, 28
                        ],
                        'circle-color': '#d97706',
                        'circle-opacity': 0.75,
                        'circle-stroke-width': 1.5,
                        'circle-stroke-color': '#78350f'
                    }
                });
            }

            // Layer-bound handlers need to be re-attached on each style
            // load because the target layer is recreated.
            map.on('click', 'location-circles', function (e) {
                var f = e.features && e.features[0];
                if (!f) return;
                P.createIwacPopup({ closeButton: true, closeOnClick: true })
                    .setLngLat(f.geometry.coordinates)
                    .setHTML(
                        '<strong>' + P.escapeHtml(f.properties.name) + '</strong><br>' +
                        (f.properties.country ? P.escapeHtml(f.properties.country) + '<br>' : '') +
                        P.formatNumber(Number(f.properties.count)) + ' mentions'
                    )
                    .addTo(map);
            });
            map.on('mouseenter', 'location-circles', function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'location-circles', function () { map.getCanvas().style.cursor = ''; });
        }

        var map = P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 3.2,
            globe: true,
            navigation: true,
            onStyleReady: onStyleReady
        });

        function updateSource() {
            if (!map) return;
            var src = map.getSource('locations');
            if (src) src.setData(filteredFeatures());
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.map = { render: render };
})();
