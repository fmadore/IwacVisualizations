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
    if (!P || !P.createIwacMap || !P.buildFacetButtons || !P.buildMapPopup) {
        console.warn('IWACVis.index-overview/places-map: missing dependencies');
        return;
    }

    var LAYERS = {
        BOTH:       'both',
        AUTHORITY:  'authority',
        MENTIONS:   'mentions'
    };

    function render(panelEl, data, ctx) {
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
            build(panelEl, places, mentions, ctx);
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

    function build(panelEl, places, mentions, ctx) {
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

        // Resolve theme tokens to legacy rgb() form for MapLibre —
        // MapLibre's style parser rejects `hsl(..., calc(...), ...)`
        // and `color-mix()`, which is what getChartTokens() returns
        // when the theme's --primary is defined as a calc-based hsl
        // expression. ns.resolveCssVar uses an offscreen probe to
        // compute the expression into a plain rgb() value that
        // MapLibre understands.
        function primaryColor() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--primary');
            return resolved || '#e67a14';
        }
        function inkColor() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--ink');
            return resolved || '#18202a';
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

            applyVisibility();
        }

        // Click + hover handlers attached ONCE per map (outside
        // onStyleReady). Two reasons:
        //   1. Separate per-layer handlers fire twice when the two
        //      layers overlap at the same coordinates (which they
        //      usually do — mention bubbles sit on top of the
        //      authority pin for the same place). A single handler
        //      queryRenderedFeatures-ing both layers yields a single
        //      popup regardless of how many layers reported a hit.
        //   2. Attaching inside onStyleReady would stack additional
        //      handlers on every theme swap since MapLibre's filtered
        //      event handlers persist across setStyle calls.
        function handleMapClick(e) {
            if (!mapInstance) return;
            var layerIds = [];
            if (mapInstance.getLayer('place-authority-pins'))   layerIds.push('place-authority-pins');
            if (mapInstance.getLayer('place-mentions-bubbles')) layerIds.push('place-mentions-bubbles');
            if (layerIds.length === 0) return;

            var features = mapInstance.queryRenderedFeatures(e.point, { layers: layerIds });
            if (!features.length) return;

            // Prefer the authority pin (has o_id → linkable) when both
            // layers reported a hit at the click point.
            var feat = null;
            for (var i = 0; i < features.length; i++) {
                if (features[i].layer && features[i].layer.id === 'place-authority-pins') {
                    feat = features[i];
                    break;
                }
            }
            if (!feat) feat = features[0];

            var props = feat.properties || {};
            var isAuth = feat.layer && feat.layer.id === 'place-authority-pins';
            var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';

            var subtitle = [];
            if (isAuth && props.country) subtitle.push(props.country);
            if (isAuth && props.frequency != null) {
                subtitle.push(P.t('mentions_count', { count: P.formatNumber(Number(props.frequency)) }));
            } else if (!isAuth && props.count != null) {
                subtitle.push(P.t('mentions_count', { count: P.formatNumber(Number(props.count)) }));
            }

            var popupNode = P.buildMapPopup({
                title: props.name || '',
                titleHref: isAuth && props.o_id && siteBase ? siteBase + '/item/' + props.o_id : null,
                subtitleLines: subtitle,
                siteBase: siteBase
            });

            P.createIwacPopup({ closeButton: true, closeOnClick: true })
                .setLngLat(feat.geometry.coordinates.slice())
                .setDOMContent(popupNode)
                .addTo(mapInstance);
        }

        function handleMouseMove(e) {
            if (!mapInstance) return;
            var layerIds = [];
            if (mapInstance.getLayer('place-authority-pins'))   layerIds.push('place-authority-pins');
            if (mapInstance.getLayer('place-mentions-bubbles')) layerIds.push('place-mentions-bubbles');
            if (layerIds.length === 0) return;
            var features = mapInstance.queryRenderedFeatures(e.point, { layers: layerIds });
            mapInstance.getCanvas().style.cursor = features.length ? 'pointer' : '';
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

        var createdMap = P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 3.2,
            globe: true,
            navigation: true,
            onStyleReady: onStyleReady
        });

        // Click + hover handlers attached ONCE per map instance, not
        // per style.load — see the comment above handleMapClick for
        // why re-attaching inside onStyleReady would double-fire
        // popups after a theme swap.
        if (createdMap) {
            createdMap.on('click', handleMapClick);
            createdMap.on('mousemove', handleMouseMove);
        }
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.placesMap = { render: render };
})();
