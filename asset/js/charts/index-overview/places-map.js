/**
 * IWAC Visualizations — Index Overview: Places map
 *
 * Two circle layers on one MapLibre instance:
 *   - "authority"  → pins from `data.places` (every Lieu with parseable
 *                    Coordonnées), sized by authority frequency count
 *   - "mentions"   → bubbles from `data.place_mentions` (actual
 *                    dct:spatial mentions on content items, joined
 *                    back to the authority pins by normalized title)
 *
 * A facet bar lets the user switch between "Both" / "Authority pins" /
 * "Mentions only". Custom layers are rebuilt on every style.load so
 * they survive theme-driven basemap swaps.
 *
 * Lazy-loaded via IntersectionObserver so the MapLibre instance only
 * initialises when the panel scrolls into view.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap || !P.buildFacetButtons) {
        console.warn('IWACVis.index-overview/places-map: missing dependencies');
        return;
    }

    var LAYERS = {
        BOTH:       'both',
        AUTHORITY:  'authority',
        MENTIONS:   'mentions'
    };

    function render(panelEl, data) {
        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Map library unavailable')));
            return;
        }

        var places = (data && data.places) || [];
        var mentions = (data && data.place_mentions) || [];
        if (places.length === 0 && mentions.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var loading = P.el('div', 'iwac-vis-loading');
        loading.appendChild(P.el('div', 'iwac-vis-spinner'));
        loading.appendChild(P.el('span', null, P.t('Loading')));
        panelEl.chart.appendChild(loading);

        var built = false;
        function buildWhenVisible() {
            if (built) return;
            built = true;
            panelEl.chart.removeChild(loading);
            build(panelEl, places, mentions);
        }

        if (typeof IntersectionObserver !== 'undefined') {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        buildWhenVisible();
                        observer.disconnect();
                    }
                });
            }, { rootMargin: '200px' });
            observer.observe(panelEl.panel);
        } else {
            buildWhenVisible();
        }
    }

    function build(panelEl, places, mentions) {
        var state = { layer: LAYERS.BOTH };

        // Facet bar — "Both / Authority / Mentions"
        var types = {};
        types[LAYERS.BOTH]      = P.t('Both layers');
        types[LAYERS.AUTHORITY] = P.t('Authority pins');
        types[LAYERS.MENTIONS]  = P.t('Mentions');
        var facetBar = P.buildFacetButtons({
            facets: [{
                key: 'layer',
                label: P.t('Layer'),
                subFacets: types,
                renderAs: 'buttons'
            }],
            activeKey: 'layer',
            onChange: function (evt) {
                state.layer = evt.subFacet || LAYERS.BOTH;
                applyVisibility();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        function authorityFeatures() {
            return {
                type: 'FeatureCollection',
                features: places.map(function (p) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
                        properties: {
                            name: p.title,
                            country: p.country || '',
                            frequency: p.frequency || 0,
                            o_id: p.o_id || null
                        }
                    };
                })
            };
        }

        function mentionFeatures() {
            return {
                type: 'FeatureCollection',
                features: mentions.map(function (m) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
                        properties: {
                            name: m.name,
                            count: m.count || 0
                        }
                    };
                })
            };
        }

        // Pre-compute max counts so size interpolation is stable
        var maxFreq = 1;
        places.forEach(function (p) { if ((p.frequency || 0) > maxFreq) maxFreq = p.frequency; });
        var maxMentions = 1;
        mentions.forEach(function (m) { if ((m.count || 0) > maxMentions) maxMentions = m.count; });

        // Read theme tokens for stroke/fill so the map stays on-brand.
        // Falls back to the pre-resolved --primary via iwac-theme.
        function primaryColor() {
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            return tokens.primary || '#e67a14';
        }
        function inkColor() {
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            return tokens.ink || '#18202a';
        }

        var mapInstance = null;

        function onStyleReady(map) {
            mapInstance = map;

            if (!map.getSource('places-authority')) {
                map.addSource('places-authority', { type: 'geojson', data: authorityFeatures() });
            }
            if (!map.getSource('places-mentions')) {
                map.addSource('places-mentions', { type: 'geojson', data: mentionFeatures() });
            }

            var primary = primaryColor();
            var stroke = inkColor();

            // Mentions layer drawn first so authority pins sit on top
            if (!map.getLayer('place-mentions-bubbles')) {
                map.addLayer({
                    id: 'place-mentions-bubbles',
                    type: 'circle',
                    source: 'places-mentions',
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'count'],
                            1, 3,
                            maxMentions, 24
                        ],
                        'circle-color': primary,
                        'circle-opacity': 0.35,
                        'circle-stroke-width': 1,
                        'circle-stroke-color': primary
                    }
                });
            }

            if (!map.getLayer('place-authority-pins')) {
                map.addLayer({
                    id: 'place-authority-pins',
                    type: 'circle',
                    source: 'places-authority',
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'frequency'],
                            0, 3,
                            maxFreq, 18
                        ],
                        'circle-color': primary,
                        'circle-opacity': 0.9,
                        'circle-stroke-width': 1.5,
                        'circle-stroke-color': stroke
                    }
                });
            }

            map.on('click', 'place-authority-pins', function (e) {
                var f = e.features && e.features[0];
                if (!f) return;
                P.createIwacPopup({ closeButton: true, closeOnClick: true })
                    .setLngLat(f.geometry.coordinates)
                    .setHTML(
                        '<strong>' + P.escapeHtml(f.properties.name) + '</strong><br>' +
                        (f.properties.country ? P.escapeHtml(f.properties.country) + '<br>' : '') +
                        P.t('mentions_count', { count: P.formatNumber(Number(f.properties.frequency)) })
                    )
                    .addTo(map);
            });
            map.on('click', 'place-mentions-bubbles', function (e) {
                var f = e.features && e.features[0];
                if (!f) return;
                P.createIwacPopup({ closeButton: true, closeOnClick: true })
                    .setLngLat(f.geometry.coordinates)
                    .setHTML(
                        '<strong>' + P.escapeHtml(f.properties.name) + '</strong><br>' +
                        P.t('mentions_count', { count: P.formatNumber(Number(f.properties.count)) })
                    )
                    .addTo(map);
            });
            ['place-authority-pins', 'place-mentions-bubbles'].forEach(function (layerId) {
                map.on('mouseenter', layerId, function () { map.getCanvas().style.cursor = 'pointer'; });
                map.on('mouseleave', layerId, function () { map.getCanvas().style.cursor = ''; });
            });

            applyVisibility();
        }

        function applyVisibility() {
            if (!mapInstance) return;
            var showAuth = state.layer !== LAYERS.MENTIONS;
            var showMen  = state.layer !== LAYERS.AUTHORITY;
            if (mapInstance.getLayer('place-authority-pins')) {
                mapInstance.setLayoutProperty('place-authority-pins', 'visibility',
                    showAuth ? 'visible' : 'none');
            }
            if (mapInstance.getLayer('place-mentions-bubbles')) {
                mapInstance.setLayoutProperty('place-mentions-bubbles', 'visibility',
                    showMen ? 'visible' : 'none');
            }
        }

        P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 3.2,
            globe: true,
            navigation: true,
            onStyleReady: onStyleReady
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.placesMap = { render: render };
})();
