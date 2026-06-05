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
            panelEl.chart.appendChild(P.buildErrorState('Map library unavailable'));
            return;
        }

        var places = (data && data.places) || [];
        var mentions = (data && data.place_mentions) || [];
        if (places.length === 0 && mentions.length === 0) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var loading = P.buildLoadingState();
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

        // Pre-compute features + max counts once so the radius
        // interpolation is stable across theme swaps (onStyleReady runs
        // multiple times). minCount: 0 preserves the original
        // "include every place, even with zero frequency" behavior.
        var authResult = P.buildCountFeatures(places, {
            countKey: 'frequency',
            minCount: 0,
            toProps: function (p) {
                return {
                    name: p.title,
                    country: p.country || '',
                    frequency: p.frequency || 0,
                    o_id: p.o_id || null
                };
            }
        });
        var mentionResult = P.buildCountFeatures(mentions, {
            minCount: 0,
            toProps: function (m) {
                return { name: m.name, count: m.count || 0 };
            }
        });
        var maxFreq = authResult.max;
        var maxMentions = mentionResult.max;
        function authorityFeatures() { return authResult.collection; }
        function mentionFeatures() { return mentionResult.collection; }

        // Resolve theme tokens to legacy rgb() for MapLibre. After
        // theme v2.0.0, getComputedStyle returns oklab()/oklch() for
        // OKLCH-based tokens, which MapLibre's style validator rejects.
        // P.normalizeColorForMapLibre canvas-rasterizes them. ECharts
        // is intentionally NOT routed through this path.
        function ml(c) {
            return P.normalizeColorForMapLibre ? P.normalizeColorForMapLibre(c) : c;
        }
        function primaryColor() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--primary');
            return ml(resolved || '#e64a19');
        }
        function inkColor() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--ink');
            return ml(resolved || '#2c2f37');
        }

        var mapInstance = null;

        function onStyleReady(map) {
            mapInstance = map;

            // `generateId: true` on both sources so MapLibre has a
            // stable feature identity to key feature-state hover on.
            if (!map.getSource('places-authority')) {
                map.addSource('places-authority', {
                    type: 'geojson',
                    data: authorityFeatures(),
                    generateId: true
                });
            }
            if (!map.getSource('places-mentions')) {
                map.addSource('places-mentions', {
                    type: 'geojson',
                    data: mentionFeatures(),
                    generateId: true
                });
            }

            var primary = primaryColor();
            var stroke = inkColor();

            // Mentions layer drawn first so authority pins sit on top.
            // Both layers ship feature-state-driven hover highlights —
            // see collection-overview/map.js for the rationale.
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
                        'circle-opacity': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            0.6,
                            0.35
                        ],
                        'circle-stroke-width': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            2.5,
                            1
                        ],
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
                        'circle-opacity': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            1.0,
                            0.9
                        ],
                        'circle-stroke-width': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            3,
                            1.5
                        ],
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

            // No country subtitle line — the index dataset stores the
            // *newspaper-source* countries on each Lieu authority, not
            // the place's actual country, which led to every popup
            // showing "Bénin" (the country with the most articles).
            // The place name itself is the relevant identifier.
            var subtitle = [];
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
        // popups after a theme swap. Hover is driven by MapLibre
        // feature-state so the visual lift (opacity + stroke) happens
        // on the GPU without per-frame JS work.
        if (createdMap) {
            createdMap.on('click', handleMapClick);
            P.attachFeatureStateHover(createdMap, [
                { layer: 'place-authority-pins',   source: 'places-authority' },
                { layer: 'place-mentions-bubbles', source: 'places-mentions'  }
            ]);

            // Choropleth toggle — aggregates the index's per-place
            // frequencies up to country level. Places that lack a
            // canonical IWAC country (a small minority of authority
            // records, e.g. African capitals tagged outside the 6-
            // country scope) silently don't contribute. The choropleth
            // hides BOTH bubble layers when toggled on.
            if (typeof P.attachChoroplethToggle === 'function') {
                var countryCounts = {};
                places.forEach(function (p) {
                    var c = p.country;
                    if (!c) return;
                    countryCounts[c] = (countryCounts[c] || 0) + (p.frequency || 0);
                });
                P.attachChoroplethToggle(createdMap, {
                    countryCounts: countryCounts,
                    bubbleLayers:  ['place-authority-pins', 'place-mentions-bubbles'],
                    basePath:      (ctx && ctx.basePath) || '',
                    labelKey:      'mentions'
                });
            }
        }
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.placesMap = { render: render };
})();
