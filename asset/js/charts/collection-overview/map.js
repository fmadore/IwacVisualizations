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
    if (!P || !P.buildFacetButtons || !P.buildMapPopup) {
        console.warn('IWACVis.collection-overview/map: missing dependencies');
        return;
    }

    var ALL_KEY = '__all__';

    function render(panelEl, data, ctx) {
        var basePath = ctx && ctx.basePath ? ctx.basePath : '';
        var dataUrl = basePath + '/modules/IwacVisualizations/asset/data/collection-map.json';
        var geoUrl = basePath + '/modules/IwacVisualizations/asset/data/world_countries_simple.geojson';

        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.buildErrorState('Map library unavailable'));
            return;
        }

        panelEl.chart.appendChild(P.buildLoadingState());

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
                    panelEl.chart.appendChild(P.buildErrorState());
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

        // Pre-compute features + max count once. The max drives the radius
        // interpolation and must stay stable across theme swaps (onStyleReady
        // runs multiple times). filteredFeatures() returns the cached
        // collection so updateSource() stays a 1-liner.
        var featureResult = P.buildCountFeatures(locations, {
            toProps: function (loc) {
                return {
                    name: loc.name,
                    country: loc.country || '',
                    count: loc.count
                };
            }
        });
        var maxCount = featureResult.max;
        function filteredFeatures() { return featureResult.collection; }

        // Resolve theme tokens via ns.resolveCssVar — avoids hardcoded
        // hex values and keeps colors aligned with the active theme.
        function resolvePrimary() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--primary');
            return resolved || '#e67a14';
        }
        function resolveInk() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--ink');
            return resolved || '#18202a';
        }

        var mapInstance = null;

        function onStyleReady(map) {
            mapInstance = map;
            // Custom sources + layers get wiped by every setStyle call,
            // so we re-add them on every style.load. Guard with getSource
            // in case the callback fires twice for the same load.
            // `generateId: true` gives MapLibre a stable feature identity
            // to key feature-state on, which powers the hover highlight.
            if (!map.getSource('locations')) {
                map.addSource('locations', {
                    type: 'geojson',
                    data: filteredFeatures(),
                    generateId: true
                });
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
                        'circle-color': resolvePrimary(),
                        // Hover lift: brighter fill + thicker stroke when
                        // the cursor is over the bubble. Driven entirely
                        // by MapLibre feature-state so there's no JS work
                        // per frame — the GPU paints the transition.
                        'circle-opacity': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            1.0,
                            0.75
                        ],
                        'circle-stroke-width': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            3,
                            1.5
                        ],
                        'circle-stroke-color': resolveInk()
                    }
                });
            }
        }

        // Map-level handlers attached ONCE per map instance (not inside
        // onStyleReady). Layer-filtered handlers installed inside
        // onStyleReady would stack on every theme swap because MapLibre
        // persists filtered handlers across setStyle calls.
        function handleClick(e) {
            if (!mapInstance || !mapInstance.getLayer('location-circles')) return;
            var features = mapInstance.queryRenderedFeatures(e.point, {
                layers: ['location-circles']
            });
            if (!features.length) return;
            var f = features[0];
            var subtitle = [];
            if (f.properties.country) subtitle.push(f.properties.country);
            subtitle.push(P.t('mentions_count', {
                count: P.formatNumber(Number(f.properties.count))
            }));
            P.createIwacPopup({ closeButton: true, closeOnClick: true })
                .setLngLat(f.geometry.coordinates.slice())
                .setDOMContent(P.buildMapPopup({
                    title: f.properties.name,
                    subtitleLines: subtitle
                }))
                .addTo(mapInstance);
        }

        var map = P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 3.2,
            globe: true,
            navigation: true,
            onStyleReady: onStyleReady
        });

        if (map) {
            mapInstance = map;
            map.on('click', handleClick);
            P.attachFeatureStateHover(map, {
                layer: 'location-circles',
                source: 'locations'
            });
        }

        function updateSource() {
            if (!map) return;
            var src = map.getSource('locations');
            if (src) src.setData(filteredFeatures());
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.map = { render: render };
})();
