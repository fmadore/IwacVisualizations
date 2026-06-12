/**
 * IWAC Visualizations — Spatial Exploration: map panel
 *
 * MapLibre bubble map with three coordinated behaviours driven by the
 * shared state module:
 *
 *   - View source: every geocoded place in the collection, or — when
 *     an entity is selected — the places related to that entity (from
 *     its dashboard fan-out, including per-location article lists).
 *   - Country focus: a select above the map zooms to one of the six
 *     IWAC countries and filters the bubbles to places inside it.
 *   - Popups: hovering a bubble shows the place, its count and (in
 *     entity mode) the first few related items; clicking pins the full
 *     paginated item list (shared P.buildMapPopup). In collection mode
 *     the click list is lazily fetched from the place's own dashboard.
 *
 * The choropleth toggle (P.attachChoroplethToggle) fills the six IWAC
 * countries with item counts — collection-wide by default, the
 * selected entity's per-country counts when one is active.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap || !P.buildMapPopup) {
        console.warn('IWACVis.spatial-exploration/map: missing deps (need createIwacMap + buildMapPopup)');
        return;
    }

    var SOURCE = 'spatial-places';
    var LAYER = 'spatial-place-circles';
    var HOVER_ITEMS = 4;

    function ml(c) {
        return P.normalizeColorForMapLibre ? P.normalizeColorForMapLibre(c) : c;
    }
    function resolvePrimary() {
        var resolved = ns.resolveCssVar && ns.resolveCssVar('--primary');
        return ml(resolved || '#e64a19');
    }
    function resolveInk() {
        var resolved = ns.resolveCssVar && ns.resolveCssVar('--ink');
        return ml(resolved || '#2c2f37');
    }

    function render(panelEl, state) {
        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.buildErrorState('Map library unavailable'));
            return;
        }

        var ctx = state.ctx;

        // --- Toolbar: country focus + status line ------------------------
        var toolbar = P.el('div', 'iwac-vis-spatial-toolbar');
        var focusLabel = P.el('label', 'iwac-vis-spatial-toolbar__label', P.t('Country focus'));
        var focusSelect = P.el('select', 'iwac-vis-spatial-toolbar__select');
        focusLabel.appendChild(focusSelect);
        var worldOpt = P.el('option', null, P.t('Whole world'));
        worldOpt.value = '';
        focusSelect.appendChild(worldOpt);
        (state.data.focus_countries || []).forEach(function (c) {
            var opt = P.el('option', null, c);
            opt.value = c;
            focusSelect.appendChild(opt);
        });
        focusSelect.addEventListener('change', function () {
            state.setFocus(focusSelect.value || null);
        });
        toolbar.appendChild(focusLabel);
        var status = P.el('span', 'iwac-vis-spatial-toolbar__status');
        toolbar.appendChild(status);
        panelEl.panel.insertBefore(toolbar, panelEl.chart);

        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        // --- Current view (collection vs entity) -------------------------
        // Each place record: { id, name, lat, lng, count, country,
        // articles|null }. Articles only exist in entity mode.
        function currentPlaces() {
            var sel = state.selection;
            if (sel) {
                if (sel.status !== 'ready') return [];
                return sel.locations.map(function (l) {
                    return {
                        id: l.o_id, name: l.name, lat: l.lat, lng: l.lng,
                        count: l.count,
                        country: state.locationCountry(l.o_id) || '',
                        articles: l.articles || []
                    };
                });
            }
            return (state.data.locations || []).map(function (row) {
                return {
                    id: row[0], name: row[1], lat: row[2], lng: row[3],
                    count: row[4],
                    country: row[5] >= 0 ? state.data.focus_countries[row[5]] : '',
                    articles: null
                };
            });
        }

        var places = currentPlaces();
        var placeById = {};
        var featureResult = null;

        function rebuildFeatures() {
            placeById = {};
            places.forEach(function (p) { placeById[p.id] = p; });
            featureResult = P.buildCountFeatures(places, {
                toProps: function (p) {
                    return { id: p.id, name: p.name, count: p.count, country: p.country };
                }
            });
        }
        rebuildFeatures();

        function radiusExpression() {
            return [
                'interpolate', ['linear'], ['get', 'count'],
                1, 3,
                Math.max(featureResult.max, 2), 26
            ];
        }

        function countryFilter() {
            return state.focusCountry
                ? ['==', ['get', 'country'], state.focusCountry]
                : null;
        }

        var mapInstance = null;

        function onStyleReady(m) {
            mapInstance = m;
            if (!m.getSource(SOURCE)) {
                m.addSource(SOURCE, {
                    type: 'geojson',
                    data: featureResult.collection,
                    generateId: true
                });
            }
            if (!m.getLayer(LAYER)) {
                m.addLayer({
                    id: LAYER,
                    type: 'circle',
                    source: SOURCE,
                    paint: {
                        'circle-radius': radiusExpression(),
                        'circle-color': resolvePrimary(),
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
            // Re-assert the country-focus filter after every style
            // (re)load — setStyle wipes layer filters with the layer.
            m.setFilter(LAYER, countryFilter());
        }

        // --- Popups -------------------------------------------------------
        var hoverPopup = null;
        var hoverId = null;

        function hoverNode(place) {
            var node = P.el('div', 'iwac-vis-map-popup');
            var header = P.el('div', 'iwac-vis-map-popup__header');
            header.appendChild(P.el('strong', 'iwac-vis-map-popup__title', place.name));
            var subtitle = [];
            if (place.country) subtitle.push(place.country);
            subtitle.push(P.t('mentions_count', { count: P.formatNumber(place.count) }));
            header.appendChild(P.el('div', 'iwac-vis-map-popup__subtitle', subtitle.join(' · ')));
            node.appendChild(header);

            if (place.articles && place.articles.length) {
                var list = P.el('ul', 'iwac-vis-map-popup__list');
                place.articles.slice(0, HOVER_ITEMS).forEach(function (a) {
                    var li = P.el('li', 'iwac-vis-map-popup__item');
                    li.appendChild(P.el('span', 'iwac-vis-map-popup__item-title', a.title));
                    var metaBits = [];
                    if (a.publisher) metaBits.push(a.publisher);
                    if (a.date) metaBits.push(P.formatDate(a.date));
                    if (metaBits.length) {
                        li.appendChild(P.el('div', 'iwac-vis-map-popup__meta', metaBits.join(' · ')));
                    }
                    list.appendChild(li);
                });
                node.appendChild(list);
                var extra = place.articles.length - HOVER_ITEMS;
                node.appendChild(P.el('div', 'iwac-vis-map-popup__more',
                    extra > 0
                        ? P.t('more_items_click', { count: P.formatNumber(extra) })
                        : P.t('Click for details')));
            } else {
                node.appendChild(P.el('div', 'iwac-vis-map-popup__more', P.t('Click for details')));
            }
            return node;
        }

        function showHover(e) {
            if (!mapInstance) return;
            var f = e.features && e.features[0];
            if (!f) return;
            var place = placeById[f.properties.id];
            if (!place) return;
            if (hoverId !== place.id) {
                hoverId = place.id;
                if (!hoverPopup) {
                    hoverPopup = P.createIwacPopup({
                        closeButton: false,
                        closeOnClick: false,
                        offset: 10
                    });
                }
                hoverPopup
                    .setLngLat(f.geometry.coordinates.slice())
                    .setDOMContent(hoverNode(place))
                    .addTo(mapInstance);
            }
        }

        function hideHover() {
            hoverId = null;
            if (hoverPopup) hoverPopup.remove();
        }

        function pinnedNode(place, articles) {
            return P.buildMapPopup({
                title: place.name,
                titleHref: ctx.siteBase ? ctx.siteBase + '/item/' + place.id : null,
                subtitleLines: [
                    (place.country ? place.country + ' · ' : '') +
                        P.t('mentions_count', { count: P.formatNumber(place.count) })
                ],
                articles: articles,
                siteBase: ctx.siteBase
            });
        }

        function openPinnedPopup(place, lngLat) {
            hideHover();
            try {
                mapInstance.easeTo({ center: lngLat, offset: [0, 80], duration: 300 });
            } catch (e) { /* map may not be ready yet */ }

            var popup = P.createIwacPopup({ closeButton: true, closeOnClick: true, maxWidth: '340px' })
                .setLngLat(lngLat)
                .addTo(mapInstance);

            if (place.articles) {
                popup.setDOMContent(pinnedNode(place, place.articles));
                return;
            }
            // Collection mode — the world payload carries no item lists
            // (payload diet). Each place is itself an index entity, so its
            // dashboard fan-out has the articles mentioning it: use the
            // place's own entry in its locations section.
            popup.setDOMContent(pinnedNode(place, []));
            state.fetchDashboard('Lieux', place.id)
                .then(function (d) {
                    if (!popup.isOpen()) return;
                    var locs = (d.locations && d.locations.by_role && d.locations.by_role.all) || [];
                    var own = null;
                    for (var i = 0; i < locs.length; i++) {
                        if (locs[i].o_id === place.id) { own = locs[i]; break; }
                    }
                    popup.setDOMContent(pinnedNode(place, (own && own.articles) || []));
                })
                .catch(function (err) {
                    console.error('IWACVis.spatial-exploration: place fetch failed', err);
                });
        }

        function handleClick(e) {
            if (!mapInstance || !mapInstance.getLayer(LAYER)) return;
            var features = mapInstance.queryRenderedFeatures(e.point, { layers: [LAYER] });
            if (!features.length) return;
            var place = placeById[features[0].properties.id];
            if (!place) return;
            openPinnedPopup(place, features[0].geometry.coordinates.slice());
        }

        // --- Map ----------------------------------------------------------
        var map = P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 2.6,
            globe: true,
            navigation: true,
            onStyleReady: onStyleReady
        });
        if (!map) {
            panelEl.chart.appendChild(P.buildErrorState('Map library unavailable'));
            return;
        }
        mapInstance = map;
        map.on('click', handleClick);
        map.on('mousemove', LAYER, showHover);
        map.on('mouseleave', LAYER, hideHover);
        P.attachFeatureStateHover(map, { layer: LAYER, source: SOURCE });

        // --- Choropleth (items per country) -------------------------------
        function currentCountryCounts() {
            var sel = state.selection;
            if (sel && sel.status === 'ready') {
                var counts = {};
                (sel.countries || []).forEach(function (entry) {
                    if (entry.name) counts[entry.name] = entry.count;
                });
                return counts;
            }
            return state.data.country_counts || {};
        }

        var choropleth = null;
        if (typeof P.attachChoroplethToggle === 'function') {
            choropleth = P.attachChoroplethToggle(map, {
                countryCounts: currentCountryCounts(),
                bubbleLayers: [LAYER],
                basePath: ctx.basePath || '',
                labelKey: 'items',
                hoverInfo: true
            });
        }

        // --- State reactions -----------------------------------------------
        function updateStatus() {
            var sel = state.selection;
            var visible = places.filter(function (p) {
                return !state.focusCountry || p.country === state.focusCountry;
            });
            if (sel && sel.status === 'loading') {
                status.textContent = P.t('Loading');
                return;
            }
            var bits = [P.t('places_count', { count: P.formatNumber(visible.length) })];
            if (sel && sel.status === 'ready') bits.unshift(sel.label);
            status.textContent = bits.join(' · ');
            if (visible.length === 0 && sel && sel.status === 'ready') {
                status.textContent = sel.label + ' · ' + P.t('No mapped places');
            }
        }

        function fitToPlaces(list) {
            var pts = list.filter(function (p) {
                return !state.focusCountry || p.country === state.focusCountry;
            });
            if (!pts.length) return;
            var w = 180, s = 90, e = -180, n = -90;
            pts.forEach(function (p) {
                if (p.lng < w) w = p.lng;
                if (p.lng > e) e = p.lng;
                if (p.lat < s) s = p.lat;
                if (p.lat > n) n = p.lat;
            });
            try {
                map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 8, duration: 600 });
            } catch (err) { /* degenerate bounds */ }
        }

        function applyView() {
            places = currentPlaces();
            rebuildFeatures();
            var src = map.getSource(SOURCE);
            if (src) src.setData(featureResult.collection);
            if (map.getLayer(LAYER)) {
                map.setPaintProperty(LAYER, 'circle-radius', radiusExpression());
            }
            if (choropleth) choropleth.updateCounts(currentCountryCounts());
            updateStatus();
        }

        function applyFocus() {
            if (map.getLayer(LAYER)) {
                map.setFilter(LAYER, countryFilter());
            }
            var bounds = state.focusCountry &&
                (state.data.country_bounds || {})[state.focusCountry];
            if (bounds) {
                try {
                    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
                        { padding: 40, duration: 600 });
                } catch (err) { /* ignore */ }
            } else if (!state.focusCountry) {
                map.easeTo({ center: [2, 10], zoom: 2.6, duration: 600 });
            }
            updateStatus();
        }

        state.subscribe(function (key) {
            if (key === 'selection') {
                hideHover();
                applyView();
                var sel = state.selection;
                if (sel && sel.status === 'ready' && sel.locations.length) {
                    fitToPlaces(places);
                } else if (!sel) {
                    map.easeTo({ center: [2, 10], zoom: 2.6, duration: 600 });
                }
            } else if (key === 'focus') {
                focusSelect.value = state.focusCountry || '';
                applyFocus();
            } else if (key === 'flyto' && state.lastFlyTo) {
                var target = state.lastFlyTo;
                map.easeTo({ center: [target.lng, target.lat], zoom: Math.max(map.getZoom(), 7), duration: 700 });
                var place = placeById[target.id];
                if (place) {
                    setTimeout(function () {
                        openPinnedPopup(place, [target.lng, target.lat]);
                    }, 720);
                }
            }
        });

        updateStatus();
    }

    ns.spatialExploration = ns.spatialExploration || {};
    ns.spatialExploration.map = { render: render };
})();
