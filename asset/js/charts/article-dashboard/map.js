/**
 * IWAC Visualizations — Article Dashboard: spatial coverage panel
 *
 * MapLibre pins for the places tagged in this article's
 * `dcterms:spatial`, geocoded through the IWAC authority index. The
 * generator has emitted this `spatial` array since the article dashboards
 * shipped — its docstring even called it "consumed by the mini MapLibre
 * panel" — but the panel itself was never built, so the data rode along
 * in ~12k files unread and the README described a view nobody could see.
 *
 * Deliberately simpler than the person / entity locations map:
 *
 *   - **Uniform pin radius.** Every place is mentioned exactly once by a
 *     single article, so there is no count to scale by. Interpolating a
 *     radius over a constant would imply a magnitude that isn't there.
 *   - **No choropleth toggle.** Country fills answer "where does the
 *     collection look", a corpus-level question; one article's handful of
 *     pins cannot support it.
 *   - **Popup is a link, not a list.** The place's authority page carries
 *     the full picture; repeating a one-item article list here would be
 *     noise.
 *
 * The panel elides itself when the article has no geocoded place, which
 * is the common case for undated wire copy and for places absent from the
 * authority index.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap || !P.buildMapPopup) {
        console.warn('IWACVis.article-dashboard/map: missing deps (need createIwacMap + buildMapPopup)');
        return;
    }

    var SOURCE_ID = 'article-places';
    var LAYER_ID  = 'article-place-circles';

    /** Normalize a resolved token for MapLibre paint (rejects oklab/oklch). */
    function ml(colour) {
        return P.normalizeColorForMapLibre ? P.normalizeColorForMapLibre(colour) : colour;
    }

    function resolve(varName, fallback) {
        var resolved = ns.resolveCssVar && ns.resolveCssVar(varName);
        return ml(resolved || fallback);
    }

    function featuresFrom(places) {
        return {
            type: 'FeatureCollection',
            features: places.map(function (place, idx) {
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [place.lng, place.lat] },
                    properties: { idx: idx, name: place.name || '' }
                };
            })
        };
    }

    function render(panelEl, data, facet, ctx) {
        var places = ((data && data.spatial) || []).filter(function (p) {
            return p && typeof p.lat === 'number' && typeof p.lng === 'number';
        });
        if (!places.length) {
            panelEl.chart.appendChild(P.buildEmptyState('No geocoded places'));
            return;
        }
        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.buildErrorState('Map library unavailable'));
            return;
        }

        var siteBase = (ctx && ctx.siteBase) || '';
        var host = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(host);

        var mapInstance = null;

        function handleClick(e) {
            if (!mapInstance || !mapInstance.getLayer(LAYER_ID)) return;
            var hits = mapInstance.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
            if (!hits.length) return;
            var place = places[Number(hits[0].properties.idx)];
            if (!place) return;
            P.createIwacPopup({ closeButton: true, closeOnClick: true, maxWidth: '300px' })
                .setLngLat(hits[0].geometry.coordinates.slice())
                .setDOMContent(P.buildMapPopup({
                    title: place.name,
                    titleHref: place.o_id && siteBase
                        ? siteBase + '/item/' + place.o_id
                        : null,
                    subtitleLines: [P.t('article_place_subtitle')],
                    articles: [],
                    siteBase: siteBase
                }))
                .addTo(mapInstance);
        }

        var created = P.createIwacMap(host, {
            center: [2, 10],
            zoom: 3.2,
            onStyleReady: function (m) {
                mapInstance = m;
                if (!m.getSource(SOURCE_ID)) {
                    m.addSource(SOURCE_ID, {
                        type: 'geojson',
                        data: featuresFrom(places),
                        generateId: true
                    });
                }
                if (!m.getLayer(LAYER_ID)) {
                    m.addLayer({
                        id: LAYER_ID,
                        type: 'circle',
                        source: SOURCE_ID,
                        paint: {
                            'circle-radius': 7,
                            'circle-color': resolve('--primary', '#ce4115'),
                            'circle-opacity': [
                                'case',
                                ['boolean', ['feature-state', 'hover'], false],
                                1.0,
                                0.78
                            ],
                            'circle-stroke-width': [
                                'case',
                                ['boolean', ['feature-state', 'hover'], false],
                                3,
                                1.5
                            ],
                            'circle-stroke-color': resolve('--ink', '#13161c')
                        }
                    });
                }
            }
        });

        if (!created) return;
        mapInstance = created;
        created.on('click', handleClick);
        if (P.attachFeatureStateHover) {
            P.attachFeatureStateHover(created, { layer: LAYER_ID, source: SOURCE_ID });
        }

        // Fit to the article's own pins: a world view would leave two
        // neighbouring towns indistinguishable. A single pin gets a fixed
        // zoom instead, since fitBounds on a zero-area box picks the max.
        created.once('load', function () {
            if (places.length === 1) {
                created.setCenter([places[0].lng, places[0].lat]);
                created.setZoom(6);
                return;
            }
            var west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
            places.forEach(function (p) {
                if (p.lng < west) west = p.lng;
                if (p.lng > east) east = p.lng;
                if (p.lat < south) south = p.lat;
                if (p.lat > north) north = p.lat;
            });
            try {
                created.fitBounds([[west, south], [east, north]],
                    { padding: 48, maxZoom: 7, duration: 0 });
            } catch (err) { /* degenerate bounds — keep the default view */ }
        });
    }

    ns.dashboardLayout = ns.dashboardLayout || {};
    if (ns.dashboardLayout.registerRenderer) {
        ns.dashboardLayout.registerRenderer('iwacArticleMap', function (el, slice, slot, dctx) {
            // The layout system hands renderers the chart element; this
            // panel wants the panel wrapper (it appends its own map host),
            // so adapt rather than change the shared contract.
            render({ chart: el }, slice, null, dctx);
        });
        ns.dashboardLayout.registerMetadata('iwacArticleMap', {
            hasData: function (slice) {
                return !!(slice && slice.spatial && slice.spatial.length);
            }
        });
    }

    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.map = { render: render };
})();
