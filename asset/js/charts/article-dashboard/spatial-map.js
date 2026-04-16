/**
 * IWAC Visualizations — Article Dashboard: spatial coverage map
 *
 * MapLibre map with one pin per place named in this article's Dublin
 * Core Spatial Coverage field, geocoded through the IWAC authority
 * index. For a single article the count per place is always 1, so
 * bubbles render at a uniform small radius — we're not conveying
 * magnitude here, just "here are the places this article talks about".
 *
 * Popup shows the place name with a link to the authority page. No
 * article list in the popup — the reader IS on the article page.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap || !P.createIwacPopup) {
        console.warn('IWACVis.article-dashboard/spatial-map: missing deps (need createIwacMap + createIwacPopup)');
        return;
    }

    var SOURCE_ID = 'article-spatial';
    var LAYER_ID  = 'article-spatial-circles';

    function resolvePrimary() {
        var resolved = ns.resolveCssVar && ns.resolveCssVar('--primary');
        return resolved || '#e67a14';
    }
    function resolveInk() {
        var resolved = ns.resolveCssVar && ns.resolveCssVar('--ink');
        return resolved || '#18202a';
    }

    function featuresFrom(pins) {
        // Use the shared helper: it validates lat/lng and emits a
        // proper FeatureCollection with generateId-friendly props.
        return P.buildCountFeatures(pins, {
            countKey: 'count',
            toProps: function (p, idx) {
                return { idx: idx, name: p.name, o_id: p.o_id };
            },
            // Missing count → 1 so every parseable place gets a pin
            // (the Python precompute doesn't write a count field on
            // article spatial pins; they're boolean presence signals).
            minCount: 0
        }).collection;
    }

    function render(panelEl, data, facet, ctx) {
        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.buildErrorState
                ? P.buildErrorState('Map library unavailable')
                : P.el('div', 'iwac-vis-error', P.t('Map library unavailable')));
            return;
        }

        var pins = (data && data.spatial) || [];
        if (pins.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        // Ensure every pin has a count field (the generator might not
        // always emit one; the map layer's paint expression reads it).
        pins = pins.map(function (p) {
            return { o_id: p.o_id, name: p.name, lat: p.lat, lng: p.lng, count: p.count != null ? p.count : 1 };
        });

        var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';

        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        var mapInstance = null;

        function handleClick(e) {
            if (!mapInstance || !mapInstance.getLayer(LAYER_ID)) return;
            var features = mapInstance.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
            if (!features.length) return;
            var f = features[0];
            var idx = Number(f.properties.idx);
            var pin = pins[idx];
            if (!pin) return;

            var popupNode = P.el('div', 'iwac-vis-map-popup');
            var title;
            if (pin.o_id && siteBase) {
                title = P.el('a', 'iwac-vis-map-popup__title');
                title.href = siteBase + '/item/' + pin.o_id;
                title.textContent = pin.name;
            } else {
                title = P.el('div', 'iwac-vis-map-popup__title', pin.name);
            }
            popupNode.appendChild(title);

            var coords = f.geometry.coordinates.slice();
            P.createIwacPopup({ closeButton: true, closeOnClick: true, maxWidth: '260px' })
                .setLngLat(coords)
                .setDOMContent(popupNode)
                .addTo(mapInstance);
        }

        var createdMap = P.createIwacMap(mapContainer, {
            // Centered on West Africa (roughly where IWAC content lives)
            // so the initial frame makes sense even before the first
            // pin renders.
            center: [2, 10],
            zoom: 3.2,
            onStyleReady: function (m) {
                mapInstance = m;
                if (!m.getSource(SOURCE_ID)) {
                    m.addSource(SOURCE_ID, {
                        type: 'geojson',
                        data: featuresFrom(pins),
                        generateId: true
                    });
                }
                if (!m.getLayer(LAYER_ID)) {
                    m.addLayer({
                        id: LAYER_ID,
                        type: 'circle',
                        source: SOURCE_ID,
                        paint: {
                            // Uniform radius — count is ~1 for every
                            // pin on an article map, so a gradient
                            // would be visual noise.
                            'circle-radius': 7,
                            'circle-color': resolvePrimary(),
                            'circle-opacity': [
                                'case',
                                ['boolean', ['feature-state', 'hover'], false],
                                1.0,
                                0.8
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

                    // Auto-fit to the pins. Single-pin maps stay at the
                    // default zoom to avoid the "infinite zoom" that
                    // fitBounds produces on a zero-size bounding box.
                    if (pins.length > 1) {
                        try {
                            var bounds = new maplibregl.LngLatBounds();
                            pins.forEach(function (p) {
                                if (typeof p.lng === 'number' && typeof p.lat === 'number') {
                                    bounds.extend([p.lng, p.lat]);
                                }
                            });
                            if (!bounds.isEmpty()) {
                                m.fitBounds(bounds, { padding: 40, maxZoom: 7, duration: 0 });
                            }
                        } catch (err) { /* bounds object API varies across builds */ }
                    } else if (pins.length === 1) {
                        m.jumpTo({ center: [pins[0].lng, pins[0].lat], zoom: 5 });
                    }
                }
            }
        });

        if (createdMap) {
            mapInstance = createdMap;
            createdMap.on('click', handleClick);
            if (P.attachFeatureStateHover) {
                P.attachFeatureStateHover(createdMap, {
                    layer: LAYER_ID,
                    source: SOURCE_ID
                });
            }
        }
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.spatialMap = { render: render };
})();
