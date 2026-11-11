/**
 * IWAC Visualizations — Spatial Exploration: map panel
 *
 * MapLibre bubble map with three coordinated behaviours driven by the
 * shared state module:
 *
 *   - View source: every geocoded place in the collection, or — when
 *     an entity is selected — the places related to that entity (from
 *     its dashboard fan-out, including per-location article lists).
 *   - Country focus: a select above the map zooms to one of the IWAC
 *     countries carrying boundary data and filters the bubbles to
 *     places inside it. Niger and Nigeria are deliberately absent —
 *     see focusableCountries().
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

    function resolveSurface() {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        return P.normalizeColorForMapLibre(tokens.surface);
    }

    function resolveAdminRamp() {
        return ns.heatmapRamp(P.normalizeColorForMapLibre);
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
        // MapLibre arrives as a parallel ES-module import (see
        // P.whenMaplibre), so at first call the global may simply not be here
        // yet. Wait for it, then re-enter — instead of the whole block waiting
        // for a library only this panel uses.
        if (typeof maplibregl === 'undefined') {
            P.withMaplibre(panelEl.chart, function () { render(panelEl, state); });
            return;
        }

        var ctx = state.ctx;

        /**
         * Countries the focus control offers — not the same set as
         * `focus_countries`.
         *
         * `focus_countries` is the index `locations[5]` points into, so
         * it must keep all six IWAC countries for bubble labelling and
         * the country choropleth. But focusing only means something
         * where there is something to focus on, and two of the six have
         * nothing: Nigeria resolves zero geocoded places and Niger four
         * (of 544), and neither has administrative boundaries. Focusing
         * either emptied the bubble map, and in administrative mode the
         * map silently fell back to drawing Bénin's regions under a
         * dropdown that still read "Niger".
         *
         * `country_focus.countries` is exactly the set with boundary
         * files, so the generator already draws the line in the right
         * place. Payloads predating that key fall back to all six.
         */
        function focusableCountries() {
            var named = (((state.data.country_focus || {}).countries) || [])
                .map(function (entry) { return entry && entry.name; })
                .filter(Boolean);
            return named.length ? named : (state.data.focus_countries || []);
        }

        // --- Toolbar: map mode + country focus + status line -------------
        var toolbar = P.el('div', 'iwac-vis-toolbar iwac-vis-spatial-toolbar');

        var mode = 'bubbles';
        var adminLevel = 'regions';
        var adminScale = 'quantile';

        // The shared select builder, keeping the toolbar's own skin: the
        // group takes the label-wrapper class the hand-built <label>s wore,
        // the select its block layout class.
        function toolbarSelect(name, label, options, onChange) {
            var group = P.buildSelectControl({
                name: 'spatial-' + name,
                label: label,
                options: options,
                groupClass: 'iwac-vis-toolbar__label',
                labelClass: 'iwac-vis-spatial-toolbar__label',
                selectClass: 'iwac-vis-spatial-toolbar__select',
                onChange: onChange
            });
            toolbar.appendChild(group);
            return group;
        }

        var modeGroup = toolbarSelect('mode', P.t('Map mode'), [
            { value: 'bubbles', label: P.t('Place bubbles') },
            { value: 'country', label: P.t('Country choropleth') },
            { value: 'admin', label: P.t('Administrative choropleth') }
        ], onModeChange);
        var modeSelect = modeGroup.control;

        var focusSelect = toolbarSelect('focus', P.t('Country focus'),
            [{ value: '', label: P.t('Whole world') }].concat(
                focusableCountries().map(function (c) { return { value: c, label: c }; })),
            function (value) { state.setFocus(value || null); }).control;

        // Options filled per country by refreshAdminControls().
        var adminLevelGroup = toolbarSelect('admin-level', P.t('Admin level'), [], onAdminLevelChange);
        var adminLevelSelect = adminLevelGroup.control;

        var adminScaleGroup = toolbarSelect('admin-scale', P.t('Scale'), [
            { value: 'quantile', label: P.t('Quantile') },
            { value: 'linear', label: P.t('Linear') },
            { value: 'sqrt', label: P.t('Square root') }
        ], onAdminScaleChange);
        var adminScaleSelect = adminScaleGroup.control;

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
            return P.countRadius('count', Math.max(featureResult.max, 2), 3, 26);
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
            if (levels.indexOf(adminLevel) === -1) {
                adminLevel = levels[0] || 'regions';
            }
            adminLevelGroup.setOptions(levels.map(function (level) {
                return { value: level, label: P.t(level === 'prefectures' ? 'Prefectures' : 'Regions') };
            }), adminLevel);
            adminLevelSelect.disabled = levels.length <= 1;

            var showAdminControls = mode === 'admin';
            adminLevelGroup.style.display = showAdminControls ? '' : 'none';
            adminScaleGroup.style.display = showAdminControls ? '' : 'none';
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
                    var name = props.name || P.t('Unknown');
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
                '/modules/IwacVisualizations/asset/geo/' + relPath;
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
                    .setDOMContent(P.buildMapPopup({
                        title: p.name || '',
                        subtitleLines: [P.formatNumber(count) + ' ' + P.t('items')]
                    }))
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
                    .setDOMContent(P.buildMapPopup({
                        title: p.name || '',
                        subtitleLines: [
                            levelLabel + ' · ' + country,
                            P.formatNumber(count) + ' ' + P.t('items')
                        ]
                    }))
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
            // The shared classed legend (the same element the country
            // choropleth's gradient uses), in this map's own wrapper.
            adminLegend.appendChild(P.buildChoroplethLegend({
                title: P.t(adminScale === 'sqrt' ? 'Square root' : adminScale === 'linear' ? 'Linear' : 'Quantile'),
                items: items
            }));
            adminLegend.style.display = '';
        }

        // What the camera was last framed on, as country|level. The admin
        // layer is re-rendered for reasons that are not a change of view —
        // a theme swap runs onStyleReady, which called this — and a 600 ms
        // fitBounds then threw away wherever the reader had panned to.
        // Re-frame when the thing being framed changes, and not otherwise.
        var lastAdminFit = null;

        function fitToAdminBounds() {
            var bounds = currentAdminBounds();
            if (!bounds || !mapInstance) return;
            var key = currentAdminCountry() + '|' + adminLevel;
            if (key === lastAdminFit) return;
            lastAdminFit = key;
            try {
                mapInstance.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
                    { padding: P.FIT_OPTS.padding, maxZoom: 8, duration: P.mapMotion() });
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
                            'line-color': P.mapColor('--border'),
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
                mapInstance.setPaintProperty(ADMIN_STROKE, 'line-color', P.mapColor('--border'));
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
            // Leaving admin mode frees the camera; coming back should frame
            // the boundaries again rather than inherit the bubble view.
            lastAdminFit = null;
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
                m.addLayer(P.bubbleLayer({
                    id: LAYER,
                    source: SOURCE,
                    radius: radiusExpression(),
                    sortKey: 'count'
                }));
            }
            // Re-assert the country-focus filter after every style
            // (re)load — setStyle wipes layer filters with the layer.
            m.setFilter(LAYER, countryFilter());
            if (mode === 'admin') {
                renderAdminLayer();
            }
        }

        // --- Popups -------------------------------------------------------
        var hover = null;   // P.attachMapHoverPopup's handle, once the map exists

        function hoverContent(f) {
            var place = placeById[f.properties.id];
            if (!place) return null;
            var subtitle = [];
            if (place.country) subtitle.push(place.country);
            subtitle.push(P.t('mentions_count', { count: place.count }));
            var articles = place.articles || [];
            var extra = articles.length - HOVER_ITEMS;
            return {
                title: place.name,
                subtitleLines: [subtitle.join(' · ')],
                // A glance, not the list: the first few titles, unlinked
                // (no siteBase) and on one page — the pinned popup a click
                // opens is the one to read and follow.
                articles: articles.length ? articles.slice(0, HOVER_ITEMS) : undefined,
                pageSize: HOVER_ITEMS,
                more: extra > 0
                    ? P.t('more_items_click', { count: extra })
                    : P.t('Click for details')
            };
        }

        function hideHover() {
            if (hover) hover.hide();
        }

        function pinnedNode(place, articles) {
            return P.buildMapPopup({
                title: place.name,
                titleHref: ctx.siteBase ? P.itemUrl(ctx.siteBase, place.id) : null,
                subtitleLines: [
                    (place.country ? place.country + ' · ' : '') +
                        P.t('mentions_count', { count: place.count })
                ],
                articles: articles,
                siteBase: ctx.siteBase
            });
        }

        function openPinnedPopup(place, lngLat) {
            hideHover();
            try {
                mapInstance.easeTo({ center: lngLat, offset: [0, 80], duration: P.mapMotion(300) });
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
            center: P.WEST_AFRICA_VIEW.center,
            // One step wider than the shared view: this map also draws
            // administrative boundaries, which need their country in frame.
            zoom: 2.6,
            title: P.t('Places mentioned in the collection'),
            onStyleReady: onStyleReady
        });
        if (!map) {
            panelEl.chart.appendChild(P.buildErrorState('Map library unavailable'));
            return;
        }
        mapInstance = map;
        map.on('click', handleClick);
        hover = P.attachMapHoverPopup(map, {
            layer: LAYER,
            key: function (f) { return f.properties.id; },
            content: hoverContent
        });
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

        function onModeChange(value) {
            mode = value || 'bubbles';
            applyMode();
        }

        function onAdminLevelChange(value) {
            adminLevel = value || 'regions';
            renderAdminLayer().then(updateStatus);
        }

        function onAdminScaleChange(value) {
            adminScale = value || 'quantile';
            if (map.getLayer(ADMIN_FILL)) {
                map.setPaintProperty(
                    ADMIN_FILL,
                    'fill-color',
                    buildAdminFillExpression(currentAdminCounts(), adminScale)
                );
            }
            updateAdminLegend();
        }

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
                        P.t('admin_units_count', { count: units }),
                        P.t('items_count', { count: total })
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
            var bits = [P.t('places_count', { count: visible.length })];
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
            // One place is fitted too: fitBounds on a point picks the max
            // zoom, so P.fitToPoints centres it at 8 instead.
            P.fitToPoints(map, pts, { padding: P.FIT_OPTS.padding, maxZoom: 8,
                duration: P.mapMotion(), singleZoom: 8 });
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
            if (P.panelRowsChanged) P.panelRowsChanged(panelEl.panel);
        }

        function applyFocus() {
            if (P.panelRowsChanged) P.panelRowsChanged(panelEl.panel);
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
                        { padding: P.FIT_OPTS.padding, duration: P.mapMotion() });
                } catch (err) { /* ignore */ }
            } else if (!state.focusCountry) {
                map.easeTo({ center: P.WEST_AFRICA_VIEW.center, zoom: 2.6,
                    duration: P.mapMotion() });
            }
            updateStatus();
        }

        // The places on the map, as rows — the toolbar's "View as table" and
        // CSV, and the only route to them that needs no pointer. Follows
        // the selection (collection vs one entity) and the country focus.
        if (P.setPanelRows) {
            P.setPanelRows(panelEl.panel, function () {
                var focus = state.focusCountry;
                var rows = places.filter(function (p) {
                    return !focus || p.country === focus;
                }).slice().sort(function (a, b) { return b.count - a.count; });
                if (!rows.length) return null;
                return {
                    columns: [
                        { label: P.t('Place'), numeric: false },
                        { label: P.t('Country'), numeric: false },
                        { label: P.t('Count'), numeric: true }
                    ],
                    rows: rows.map(function (p) {
                        return [
                            ctx.siteBase && p.id ? { text: p.name, href: P.itemUrl(ctx.siteBase, p.id) } : p.name,
                            p.country || '',
                            p.count
                        ];
                    })
                };
            });
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
                    map.easeTo({ center: P.WEST_AFRICA_VIEW.center, zoom: 2.6,
                        duration: P.mapMotion() });
                }
            } else if (key === 'focus') {
                focusSelect.value = state.focusCountry || '';
                applyFocus();
            } else if (key === 'flyto' && state.lastFlyTo) {
                var target = state.lastFlyTo;
                map.easeTo({ center: [target.lng, target.lat],
                    zoom: Math.max(map.getZoom(), 7), duration: P.mapMotion(700) });
                var place = placeById[target.id];
                if (place) {
                    // `moveend`, not a 720 ms guess at a 700 ms easeTo: the
                    // two had to be kept in step by hand, and under
                    // prefers-reduced-motion the move is instant while the
                    // popup still waited three quarters of a second.
                    map.once('moveend', function () {
                        openPinnedPopup(place, [target.lng, target.lat]);
                    });
                }
            }
        });

        refreshAdminControls();
        updateStatus();
    }

    ns.spatialExploration = ns.spatialExploration || {};
    ns.spatialExploration.map = { render: render };
})();
