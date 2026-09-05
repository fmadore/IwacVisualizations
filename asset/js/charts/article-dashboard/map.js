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
        // MapLibre arrives as a parallel ES-module import (see
        // P.whenMaplibre), so at first call the global may simply not be here
        // yet. Wait for it, then re-enter — instead of the whole block waiting
        // for a library only this panel uses.
        if (typeof maplibregl === 'undefined') {
            P.withMaplibre(panelEl.chart, function () {
                render(panelEl, data, facet, ctx);
            });
            return;
        }

        var siteBase = (ctx && ctx.siteBase) || '';
        var host = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(host);

        function popupFor(hit) {
            var place = places[Number(hit.properties.idx)];
            if (!place) return null;
            return {
                title: place.name,
                titleHref: siteBase ? P.itemUrl(siteBase, place.o_id) : null,
                subtitleLines: [P.t('article_place_subtitle')],
                articles: [],
                siteBase: siteBase
            };
        }

        var created = P.createIwacMap(host, {
            center: [2, 10],
            zoom: 3.2,
            onStyleReady: function (m) {
                if (!m.getSource(SOURCE_ID)) {
                    m.addSource(SOURCE_ID, {
                        type: 'geojson',
                        data: featuresFrom(places),
                        generateId: true
                    });
                }
                if (!m.getLayer(LAYER_ID)) {
                    // A fixed radius: an article's places are a handful of
                    // equal pins, not a count encoding.
                    m.addLayer(P.bubbleLayer({
                        id: LAYER_ID,
                        source: SOURCE_ID,
                        radius: 7,
                        opacity: [0.78, 1]
                    }));
                }
            }
        });

        if (!created) return;
        P.attachMapClickPopup(created, {
            layers: LAYER_ID,
            content: popupFor,
            popup: { closeButton: true, closeOnClick: true, maxWidth: '300px' }
        });
        P.attachFeatureStateHover(created, { layer: LAYER_ID, source: SOURCE_ID });

        // Fit to the article's own pins: a world view would leave two
        // neighbouring towns indistinguishable. A single pin gets a fixed
        // zoom instead, since fitBounds on a zero-area box picks the max.
        created.once('load', function () {
            P.fitToPoints(created, places, { padding: 48, maxZoom: 7, duration: 0, singleZoom: 6 });
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
