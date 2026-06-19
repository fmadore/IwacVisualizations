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
 *   - Map mode: switch between place bubbles, the six-country
 *     choropleth, and an administrative-boundary choropleth for the
 *     countries ported from IWAC-spatial-overview's Country Focus view.
 *   - Popups: hovering a bubble shows the place, its count and (in
 *     entity mode) the first few related items; clicking pins the full
 *     paginated item list (shared P.buildMapPopup). In collection mode
 *     the click list is lazily fetched from the place's own dashboard.
 *
 * The country choropleth fills the six IWAC countries with item counts
 * — collection-wide by default, the selected entity's per-country
 * counts when one is active. The administrative mode is collection-wide
 * and uses lazy-loaded region / prefecture polygons.
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
    var ADMIN_SOURCE = 'spatial-admin-boundaries';
    var ADMIN_FILL = 'spatial-admin-boundaries-fill';
    var ADMIN_STROKE = 'spatial-admin-boundaries-stroke';
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

    function resolveBorder() {
        var resolved = ns.resolveCssVar && ns.resolveCssVar('--border');
        return ml(resolved || '#d4d6da');
    }

    function resolveSurface() {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        return ml(tokens.surface || '#fdfdfd');
    }

    function resolveAdminRamp() {
        var resolve = ns.resolveCssVar || function () { return ''; };
        var stops = [
            resolve('--iwac-vis-heatmap-0'),
            resolve('--iwac-vis-heatmap-1'),
            resolve('--iwac-vis-heatmap-2'),
            resolve('--iwac-vis-heatmap-3'),
            resolve('--iwac-vis-heatmap-4')
        ].filter(Boolean).map(ml);
        if (stops.length < 2) {
            stops = [resolveSurface(), resolvePrimary()];
        }
        return stops;
    }

    function quantile(sortedValues, q) {
        if (!sortedValues.length) return 0;
        var pos = (sortedValues.length - 1) * q;
        var base = Math.floor(pos);
        var rest = pos - base;
        if (sortedValues[base + 1] != null) {
            return sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base]);
        }
        return sortedValues[base];
    }

    function uniqueSorted(values) {
        var seen = {};
        return values
            .map(function (v) { return Math.round(Number(v)); })
            .filter(function (v) {
                if (!isFinite(v) || seen[v]) return false;
                seen[v] = true;
                return true;
            })
            .sort(function (a, b) { return a - b; });
    }

    function adminThresholds(counts, scaleType, bucketCount) {
        var values = [];
        Object.keys(counts || {}).forEach(function (k) {
            var v = Number(counts[k] || 0);
            if (v > 0) values.push(v);
        });
        values.sort(function (a, b) { return a - b; });
        if (values.length < 2) return [];
        var min = values[0];
        var max = values[values.length - 1];
        if (min === max) return [];

        var raw = [];
        for (var i = 1; i < bucketCount; i++) {
            if (scaleType === 'linear') {
                raw.push(min + (max - min) * i / bucketCount);
            } else if (scaleType === 'sqrt') {
                var sMin = Math.sqrt(min);
                var sMax = Math.sqrt(max);
                raw.push(Math.pow(sMin + (sMax - sMin) * i / bucketCount, 2));
            } else {
                raw.push(quantile(values, i / bucketCount));
            }
        }
        return uniqueSorted(raw);
    }

    function buildAdminFillExpression(counts, scaleType) {
        var ramp = resolveAdminRamp();
        var zero = resolveSurface();
        var thresholds = adminThresholds(counts, scaleType, ramp.length);
        var expr = ['step', ['get', '_iwac_count'], zero, 1, ramp[0]];
        for (var i = 0; i < thresholds.length; i++) {
            expr.push(thresholds[i] + 1, ramp[Math.min(i + 1, ramp.length - 1)]);
        }
        return expr;
    }

    function buildLegendItems(counts, scaleType) {
        var ramp = resolveAdminRamp();
        var values = [];
        Object.keys(counts || {}).forEach(function (k) {
            var v = Number(counts[k] || 0);
            if (v > 0) values.push(v);
        });
        values.sort(function (a, b) { return a - b; });
        if (!values.length) return [];
        var min = values[0];
        var max = values[values.length - 1];
        var thresholds = adminThresholds(counts, scaleType, ramp.length);
        if (!thresholds.length) {
            return [{ color: ramp[Math.min(2, ramp.length - 1)], label: P.formatNumber(max) }];
        }
        var items = [];
        var start = min;
        for (var i = 0; i <= thresholds.length; i++) {
            var end = i < thresholds.length ? thresholds[i] : max;
            items.push({
                color: ramp[Math.min(i, ramp.length - 1)],
                label: P.formatNumber(start) + '–' + P.formatNumber(end)
            });
            start = end + 1;
        }
        return items;
    }

    function render(panelEl, state) {
        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.buildErrorState('Map library unavailable'));
            return;
        }

        var ctx = state.ctx;

        // --- Toolbar: map mode + country focus + status line -------------
        var toolbar = P.el('div', 'iwac-vis-spatial-toolbar');

        var mode = 'bubbles';
        var adminLevel = 'regions';
        var adminScale = 'quantile';

        var modeLabel = P.el('label', 'iwac-vis-spatial-toolbar__label', P.t('Map mode'));
        var modeSelect = P.el('select', 'iwac-vis-spatial-toolbar__select');
        [
            ['bubbles', P.t('Place bubbles')],
            ['country', P.t('Country choropleth')],
            ['admin', P.t('Administrative choropleth')]
        ].forEach(function (entry) {
            var opt = P.el('option', null, entry[1]);
            opt.value = entry[0];
            modeSelect.appendChild(opt);
        });
        modeLabel.appendChild(modeSelect);
        toolbar.appendChild(modeLabel);

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

        var adminLevelLabel = P.el('label', 'iwac-vis-spatial-toolbar__label', P.t('Admin level'));
        var adminLevelSelect = P.el('select', 'iwac-vis-spatial-toolbar__select');
        adminLevelLabel.appendChild(adminLevelSelect);
        toolbar.appendChild(adminLevelLabel);

        var adminScaleLabel = P.el('label', 'iwac-vis-spatial-toolbar__label', P.t('Scale'));
        var adminScaleSelect = P.el('select', 'iwac-vis-spatial-toolbar__select');
        [
            ['quantile', P.t('Quantile')],
            ['linear', P.t('Linear')],
            ['sqrt', P.t('Square root')]
        ].forEach(function (entry) {
            var opt = P.el('option', null, entry[1]);
            opt.value = entry[0];
            adminScaleSelect.appendChild(opt);
        });
        adminScaleLabel.appendChild(adminScaleSelect);
        toolbar.appendChild(adminScaleLabel);

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
        var adminGeoCache = {};
        var adminInteractionsAttached = false;
        var adminLegend = P.el('div', 'iwac-vis-spatial-admin-legend');
        adminLegend.style.display = 'none';
        mapContainer.appendChild(adminLegend);

        function countryFocusData() {
            return state.data.country_focus || {};
        }

        function adminCountries() {
            return countryFocusData().countries || [];
        }

        function adminCountryConfig(country) {
            var entries = adminCountries();
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].name === country) return entries[i];
            }
            return null;
        }

        function firstAdminCountry() {
            var entries = adminCountries();
            return entries.length ? entries[0].name : null;
        }

        function currentAdminCountry() {
            return adminCountryConfig(state.focusCountry)
                ? state.focusCountry
                : firstAdminCountry();
        }

        function currentAdminLevelData() {
            var country = currentAdminCountry();
            return (((countryFocusData().counts || {})[country] || {})[adminLevel]) || null;
        }

        function currentAdminCounts() {
            var levelData = currentAdminLevelData();
            return (levelData && (levelData.countsArticles || levelData.countsMentions)) || {};
        }

        function currentAdminMapPath() {
            var country = currentAdminCountry();
            return (((countryFocusData().maps || {})[country] || {})[adminLevel]) || null;
        }

        function currentAdminBounds() {
            var country = currentAdminCountry();
            return (((countryFocusData().bounds || {})[country] || {})[adminLevel]) || null;
        }

        function refreshAdminControls() {
            var cfg = adminCountryConfig(currentAdminCountry());
            var levels = (cfg && cfg.levels) || [];
            adminLevelSelect.innerHTML = '';
            levels.forEach(function (level) {
                var opt = P.el('option', null, P.t(level === 'prefectures' ? 'Prefectures' : 'Regions'));
                opt.value = level;
                adminLevelSelect.appendChild(opt);
            });
            if (levels.indexOf(adminLevel) === -1) {
                adminLevel = levels[0] || 'regions';
            }
            adminLevelSelect.value = adminLevel;
            adminLevelSelect.disabled = levels.length <= 1;

            var showAdminControls = mode === 'admin';
            adminLevelLabel.style.display = showAdminControls ? '' : 'none';
            adminScaleLabel.style.display = showAdminControls ? '' : 'none';
            adminScaleSelect.value = adminScale;
        }

        function setLayerVisibility(id, visible) {
            if (!mapInstance || !mapInstance.getLayer(id)) return;
            mapInstance.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }

        function annotateAdminGeojson(geo, counts) {
            return {
                type: 'FeatureCollection',
                features: (geo.features || []).map(function (feature) {
                    var props = feature.properties || {};
                    var name = props.name || 'Unknown';
                    return {
                        type: 'Feature',
                        geometry: feature.geometry,
                        properties: {
                            name: name,
                            _iwac_count: Number(counts[name] || 0)
                        }
                    };
                })
            };
        }

        function loadAdminGeojson(relPath) {
            if (!relPath) return Promise.resolve(null);
            var key = relPath;
            if (adminGeoCache[key]) return Promise.resolve(adminGeoCache[key]);
            var url = (ctx.basePath || '') +
                '/modules/IwacVisualizations/asset/data/' + relPath;
            return P.fetchJSON(url).then(function (geo) {
                adminGeoCache[key] = geo;
                return geo;
            });
        }

        function attachAdminInteractions() {
            if (adminInteractionsAttached || !mapInstance) return;
            adminInteractionsAttached = true;

            var hoverPopup = P.createIwacPopup({ closeButton: false, closeOnClick: false });
            mapInstance.on('mousemove', ADMIN_FILL, function (e) {
                if (mode !== 'admin' || !e.features || !e.features[0]) return;
                var p = e.features[0].properties || {};
                var count = Number(p._iwac_count || 0);
                hoverPopup
                    .setLngLat(e.lngLat)
                    .setHTML('<strong>' + P.escapeHtml(p.name || '') + '</strong><br>' +
                        P.formatNumber(count) + ' ' + P.t('items'))
                    .addTo(mapInstance);
            });
            mapInstance.on('mouseleave', ADMIN_FILL, function () {
                hoverPopup.remove();
            });
            mapInstance.on('click', ADMIN_FILL, function (e) {
                if (mode !== 'admin' || !e.features || !e.features[0]) return;
                var p = e.features[0].properties || {};
                var count = Number(p._iwac_count || 0);
                var levelLabel = P.t(adminLevel === 'prefectures' ? 'Prefecture' : 'Region');
                var country = currentAdminCountry() || '';
                P.createIwacPopup({ closeButton: true, closeOnClick: true })
                    .setLngLat(e.lngLat)
                    .setHTML('<strong>' + P.escapeHtml(p.name || '') + '</strong><br>' +
                        P.escapeHtml(levelLabel + ' · ' + country) + '<br>' +
                        P.formatNumber(count) + ' ' + P.t('items'))
                    .addTo(mapInstance);
            });
        }

        function updateAdminLegend() {
            var counts = currentAdminCounts();
            var items = buildLegendItems(counts, adminScale);
            adminLegend.innerHTML = '';
            if (mode !== 'admin' || !items.length) {
                adminLegend.style.display = 'none';
                return;
            }
            adminLegend.appendChild(P.el('div', 'iwac-vis-spatial-admin-legend__title',
                P.t(adminScale === 'sqrt' ? 'Square root' : adminScale === 'linear' ? 'Linear' : 'Quantile')));
            items.forEach(function (item) {
                var row = P.el('div', 'iwac-vis-spatial-admin-legend__row');
                var swatch = P.el('span', 'iwac-vis-spatial-admin-legend__swatch');
                swatch.style.background = item.color;
                row.appendChild(swatch);
                row.appendChild(P.el('span', null, item.label));
                adminLegend.appendChild(row);
            });
            adminLegend.style.display = '';
        }

        function fitToAdminBounds() {
            var bounds = currentAdminBounds();
            if (!bounds || !mapInstance) return;
            try {
                mapInstance.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
                    { padding: 40, maxZoom: 8, duration: 600 });
            } catch (err) { /* ignore */ }
        }

        function renderAdminLayer() {
            refreshAdminControls();
            if (mode !== 'admin' || !mapInstance) return Promise.resolve();
            var requestedCountry = currentAdminCountry();
            var requestedLevel = adminLevel;
            var requestedPath = currentAdminMapPath();
            if (!requestedCountry) {
                updateAdminLegend();
                return Promise.resolve();
            }
            return loadAdminGeojson(requestedPath).then(function (geo) {
                if (mode !== 'admin' ||
                        requestedCountry !== currentAdminCountry() ||
                        requestedLevel !== adminLevel) {
                    return;
                }
                if (!geo || !mapInstance) return;
                var data = annotateAdminGeojson(geo, currentAdminCounts());
                if (!mapInstance.getSource(ADMIN_SOURCE)) {
                    mapInstance.addSource(ADMIN_SOURCE, {
                        type: 'geojson',
                        data: data,
                        generateId: true
                    });
                } else {
                    mapInstance.getSource(ADMIN_SOURCE).setData(data);
                }
                if (!mapInstance.getLayer(ADMIN_FILL)) {
                    mapInstance.addLayer({
                        id: ADMIN_FILL,
                        type: 'fill',
                        source: ADMIN_SOURCE,
                        paint: {
                            'fill-color': buildAdminFillExpression(currentAdminCounts(), adminScale),
                            'fill-opacity': [
                                'case',
                                ['boolean', ['feature-state', 'hover'], false],
                                0.88,
                                0.68
                            ]
                        }
                    }, mapInstance.getLayer(LAYER) ? LAYER : undefined);
                }
                if (!mapInstance.getLayer(ADMIN_STROKE)) {
                    mapInstance.addLayer({
                        id: ADMIN_STROKE,
                        type: 'line',
                        source: ADMIN_SOURCE,
                        paint: {
                            'line-color': resolveBorder(),
                            'line-width': [
                                'case',
                                ['boolean', ['feature-state', 'hover'], false],
                                2,
                                0.9
                            ]
                        }
                    }, mapInstance.getLayer(LAYER) ? LAYER : undefined);
                }
                mapInstance.setPaintProperty(
                    ADMIN_FILL,
                    'fill-color',
                    buildAdminFillExpression(currentAdminCounts(), adminScale)
                );
                mapInstance.setPaintProperty(ADMIN_STROKE, 'line-color', resolveBorder());
                attachAdminInteractions();
                setLayerVisibility(ADMIN_FILL, true);
                setLayerVisibility(ADMIN_STROKE, true);
                setLayerVisibility(LAYER, false);
                updateAdminLegend();
                fitToAdminBounds();
            }).catch(function (err) {
                console.error('IWACVis.spatial-exploration: admin GeoJSON load failed', err);
                updateAdminLegend();
            });
        }

        function hideAdminLayer() {
            setLayerVisibility(ADMIN_FILL, false);
            setLayerVisibility(ADMIN_STROKE, false);
            adminLegend.style.display = 'none';
        }

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
            if (mode === 'admin') {
                renderAdminLayer();
            }
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
                hoverInfo: true,
                hideDefaultControl: true
            });
        }

        function ensureAdminFocus() {
            if (mode !== 'admin') return;
            if (adminCountryConfig(state.focusCountry)) return;
            var first = firstAdminCountry();
            if (first) state.setFocus(first);
        }

        function applyMode() {
            modeSelect.value = mode;
            ensureAdminFocus();
            refreshAdminControls();
            if (mode === 'country') {
                hideAdminLayer();
                if (choropleth) choropleth.setMode('choropleth');
                updateStatus();
                return;
            }
            if (choropleth) choropleth.setMode('bubbles');
            if (mode === 'admin') {
                renderAdminLayer();
            } else {
                hideAdminLayer();
                setLayerVisibility(LAYER, true);
            }
            updateStatus();
        }

        modeSelect.addEventListener('change', function () {
            mode = modeSelect.value || 'bubbles';
            applyMode();
        });

        adminLevelSelect.addEventListener('change', function () {
            adminLevel = adminLevelSelect.value || 'regions';
            renderAdminLayer().then(updateStatus);
        });

        adminScaleSelect.addEventListener('change', function () {
            adminScale = adminScaleSelect.value || 'quantile';
            if (map.getLayer(ADMIN_FILL)) {
                map.setPaintProperty(
                    ADMIN_FILL,
                    'fill-color',
                    buildAdminFillExpression(currentAdminCounts(), adminScale)
                );
            }
            updateAdminLegend();
        });

        // --- State reactions -----------------------------------------------
        function updateStatus() {
            if (mode === 'admin') {
                var levelData = currentAdminLevelData();
                var counts = currentAdminCounts();
                var units = Object.keys(counts).length;
                var total = levelData && levelData.total != null
                    ? Number(levelData.total)
                    : Object.keys(counts).reduce(function (sum, key) {
                        return sum + Number(counts[key] || 0);
                    }, 0);
                var country = currentAdminCountry();
                status.textContent = country
                    ? [
                        country,
                        P.t(adminLevel === 'prefectures' ? 'Prefectures' : 'Regions'),
                        P.t('admin_units_count', { count: P.formatNumber(units) }),
                        P.t('items_count', { count: P.formatNumber(total) })
                    ].join(' · ')
                    : P.t('No administrative data');
                return;
            }
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
            if (mode === 'admin') {
                refreshAdminControls();
                renderAdminLayer().then(updateStatus);
                return;
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
                if (mode === 'admin') {
                    renderAdminLayer().then(updateStatus);
                    return;
                }
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

        refreshAdminControls();
        updateStatus();
    }

    ns.spatialExploration = ns.spatialExploration || {};
    ns.spatialExploration.map = { render: render };
})();
