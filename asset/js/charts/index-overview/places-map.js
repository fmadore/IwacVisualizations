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
        var places = (data && data.places) || [];
        var mentions = (data && data.place_mentions) || [];
        if (places.length === 0 && mentions.length === 0) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var loading = P.buildLoadingState();
        panelEl.chart.appendChild(loading);

        // MapLibre lands as a parallel ES-module import, so it is awaited here
        // — in the panel that draws the map — not by the whole block.
        P.lazyInit(panelEl.panel, function () {
            if (loading.parentNode) loading.parentNode.removeChild(loading);
            P.withMaplibre(panelEl.chart, function () {
                build(panelEl, places, mentions, ctx);
            });
        });
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
                if (P.panelRowsChanged) P.panelRowsChanged(panelEl.panel);
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        // The pins and bubbles as rows, following the layer facet — the
        // toolbar's table / CSV, and the pointer-free route to the places.
        // Authority places link to their item page; mentions have none.
        if (P.setPanelRows) {
            P.setPanelRows(panelEl.panel, function () {
                var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';
                var rows = [];
                if (state.layer !== LAYERS.MENTIONS) {
                    places.forEach(function (p) {
                        rows.push([
                            p.o_id && siteBase ? { text: p.title, href: siteBase + '/item/' + p.o_id } : p.title,
                            P.t('Authority pins'),
                            p.frequency || 0
                        ]);
                    });
                }
                if (state.layer !== LAYERS.AUTHORITY) {
                    mentions.forEach(function (m) {
                        rows.push([m.name, P.t('Mentions'), m.count || 0]);
                    });
                }
                rows.sort(function (a, b) { return b[2] - a[2]; });
                return rows.length ? {
                    columns: [
                        { label: P.t('Place'), numeric: false },
                        { label: P.t('Layer'), numeric: false },
                        { label: P.t('Mentions'), numeric: true }
                    ],
                    rows: rows
                } : null;
            });
        }

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

            var primary = P.mapColor('--primary');

            // Mentions layer drawn first so authority pins sit on top; the
            // mentions read as a translucent halo, primary-stroked, under
            // the solid, ink-stroked authority pins (shared bubble
            // vocabulary: maplibre.js).
            if (!map.getLayer('place-mentions-bubbles')) {
                map.addLayer(P.bubbleLayer({
                    id: 'place-mentions-bubbles',
                    source: 'places-mentions',
                    radius: P.countRadius('count', maxMentions, 3, 24),
                    sortKey: 'count',
                    color: primary,
                    stroke: primary,
                    opacity: [0.35, 0.6],
                    strokeWidth: [1, 2.5]
                }));
            }

            if (!map.getLayer('place-authority-pins')) {
                map.addLayer(P.bubbleLayer({
                    id: 'place-authority-pins',
                    source: 'places-authority',
                    radius: P.countRadius('frequency', maxFreq, 3, 18),
                    sortKey: 'frequency',
                    color: primary,
                    opacity: [0.9, 1]
                }));
            }

            applyVisibility();
        }

        // Prefer the authority pin (has o_id → linkable) when both layers
        // reported a hit at the click point — mention bubbles usually sit
        // on top of the authority pin for the same place.
        function pickAuthorityFirst(features) {
            for (var i = 0; i < features.length; i++) {
                if (features[i].layer && features[i].layer.id === 'place-authority-pins') {
                    return features[i];
                }
            }
            return features[0];
        }

        function popupFor(feat) {
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

            return {
                title: props.name || '',
                titleHref: isAuth && props.o_id && siteBase ? P.itemUrl(siteBase, props.o_id) : null,
                subtitleLines: subtitle,
                siteBase: siteBase
            };
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

        // Click + hover handlers attached ONCE per map instance, not per
        // style.load (P.attachMapClickPopup says why). One handler over
        // both layers yields one popup when they overlap at the click
        // point, which they usually do. Hover is driven by MapLibre
        // feature-state so the visual lift (opacity + stroke) happens
        // on the GPU without per-frame JS work.
        if (createdMap) {
            P.attachMapClickPopup(createdMap, {
                layers: ['place-authority-pins', 'place-mentions-bubbles'],
                pick: pickAuthorityFirst,
                content: popupFor
            });
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
