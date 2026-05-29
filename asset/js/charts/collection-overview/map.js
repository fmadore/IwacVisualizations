/**
 * IWAC Visualizations — Collection Overview: World map panel
 *
 * Lazy-loaded MapLibre map with two views, switched by a segmented facet:
 *   - Places — circle bubbles per index "Lieux" place, sized by mention
 *     frequency (click → popup, hover → highlight).
 *   - By country — a 6-country choropleth fill from `country_counts`, with
 *     a Type sub-facet (All / News article / Islamic periodical / …) that
 *     re-fills by item type, plus a hover read-out of country + count.
 *
 * The Type filter lives only under "By country" because that is the only
 * data with a per-type breakdown; the place bubbles carry a single total.
 *
 * Falls back to a "map unavailable" message if maplibregl is missing.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildFacetButtons || !P.buildMapPopup) {
        console.warn('IWACVis.collection-overview/map: missing dependencies');
        return;
    }

    var ALL_KEY = '__all__';

    function render(panelEl, data, ctx) {
        var basePath = ctx && ctx.basePath ? ctx.basePath : '';
        var dataUrl = basePath + '/modules/IwacVisualizations/asset/data/collection-map.json';
        var geoUrl = basePath + '/modules/IwacVisualizations/asset/data/world_countries_simple.geojson';

        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.buildErrorState('Map library unavailable'));
            return;
        }

        panelEl.chart.appendChild(P.buildLoadingState());

        var loaded = false;
        function loadAndRender() {
            if (loaded) return;
            loaded = true;
            fetch(dataUrl)
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (mapData) {
                    panelEl.chart.innerHTML = '';
                    build(panelEl, mapData, geoUrl, basePath);
                })
                .catch(function (err) {
                    console.error('IWACVis map:', err);
                    panelEl.chart.innerHTML = '';
                    panelEl.chart.appendChild(P.buildErrorState());
                });
        }

        if (typeof IntersectionObserver !== 'undefined') {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        loadAndRender();
                        observer.disconnect();
                    }
                });
            }, { rootMargin: '200px' });
            observer.observe(panelEl.panel);
        } else {
            loadAndRender();
        }
    }

    // Map raw country spellings to their accented/unaccented twin so the
    // choropleth count keys match the polygon GeoJSON's `name` whichever
    // variant it carries. (Burkina Faso / Niger / Nigeria / Togo need no
    // alias.) The non-accent forms come straight from the dataset's raw
    // `country` field; the polygon layer uses the canonical IWAC names.
    var COUNTRY_ALIASES = {
        'Benin': 'Bénin', 'Bénin': 'Benin',
        "Cote d'Ivoire": "Côte d'Ivoire", "Côte d'Ivoire": "Cote d'Ivoire",
        'Senegal': 'Sénégal', 'Sénégal': 'Senegal'
    };
    function withAliases(counts) {
        Object.keys(counts).forEach(function (k) {
            var alias = COUNTRY_ALIASES[k];
            if (alias && counts[alias] == null) counts[alias] = counts[k];
        });
        return counts;
    }

    function build(panelEl, mapData, geoUrl, basePath) {
        var locations = mapData.locations || [];
        var countryData = mapData.country_counts || {};
        var TYPE_KEYS = ['article', 'publication', 'document', 'audiovisual', 'reference'];

        // Per-country counts for the choropleth fill. ALL_KEY uses each
        // country's grand total; a specific type reads from its by_type
        // breakdown. This is the ONLY data with a type dimension — the
        // place bubbles below carry a single total with no type split.
        var choropleth = null;
        function countryCountsFor(type) {
            var out = {};
            Object.keys(countryData).forEach(function (c) {
                var rec = countryData[c] || {};
                var v = (type === ALL_KEY)
                    ? (rec.total || 0)
                    : ((rec.by_type && rec.by_type[type]) || 0);
                if (v > 0) out[c] = v;
            });
            return withAliases(out);
        }

        // View facet: Places (point bubbles) ↔ By country (choropleth fill).
        // The Type sub-buttons hang off "By country" — they re-fill the
        // choropleth by item type. They are deliberately NOT offered for the
        // Places view: the bubble layer has no per-place type split, so a
        // type filter there was a no-op (the bug the user reported). The
        // built-in choropleth toggle button is hidden; this control drives
        // the mode instead.
        var typeSub = {};
        typeSub[ALL_KEY] = P.t('All types');
        TYPE_KEYS.forEach(function (k) { typeSub[k] = P.t('item_type_' + k); });

        var facetBar = P.buildFacetButtons({
            facets: [
                { key: 'places', label: P.t('Places') },
                { key: 'countries', label: P.t('By country'), subFacets: typeSub, renderAs: 'buttons' }
            ],
            activeKey: 'places',
            onChange: function (evt) {
                if (!choropleth) return;
                if (evt.facet === 'countries') {
                    choropleth.updateCounts(countryCountsFor(evt.subFacet || ALL_KEY));
                    choropleth.setMode('choropleth');
                } else {
                    choropleth.setMode('bubbles');
                }
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        // Pre-compute bubble features + max count once. The max drives the
        // radius interpolation and must stay stable across theme swaps
        // (onStyleReady runs multiple times).
        var featureResult = P.buildCountFeatures(locations, {
            toProps: function (loc) {
                return {
                    name: loc.name,
                    country: loc.country || '',
                    count: loc.count
                };
            }
        });
        var maxCount = featureResult.max;

        // Resolve theme tokens via ns.resolveCssVar, then normalize for
        // MapLibre — IWAC theme v2.0.0 OKLCH tokens otherwise serialize
        // as oklab()/oklch(), which MapLibre's style validator rejects.
        // P.normalizeColorForMapLibre canvas-rasterizes them into legacy
        // rgb() bytes. ECharts callers don't go through this path.
        function ml(c) {
            return P.normalizeColorForMapLibre ? P.normalizeColorForMapLibre(c) : c;
        }
        function resolvePrimary() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--primary');
            return ml(resolved || '#d86a11');
        }
        function resolveInk() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--ink');
            return ml(resolved || '#1c232d');
        }

        var mapInstance = null;

        function onStyleReady(map) {
            mapInstance = map;
            // Custom sources + layers get wiped by every setStyle call,
            // so we re-add them on every style.load. Guard with getSource
            // in case the callback fires twice for the same load.
            // `generateId: true` gives MapLibre a stable feature identity
            // to key feature-state on, which powers the hover highlight.
            if (!map.getSource('locations')) {
                map.addSource('locations', {
                    type: 'geojson',
                    data: featureResult.collection,
                    generateId: true
                });
            }
            if (!map.getSource('countries')) {
                map.addSource('countries', { type: 'geojson', data: geoUrl });
            }
            if (!map.getLayer('location-circles')) {
                map.addLayer({
                    id: 'location-circles',
                    type: 'circle',
                    source: 'locations',
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'count'],
                            1, 3,
                            maxCount, 28
                        ],
                        'circle-color': resolvePrimary(),
                        // Hover lift: brighter fill + thicker stroke when
                        // the cursor is over the bubble. Driven entirely
                        // by MapLibre feature-state so there's no JS work
                        // per frame — the GPU paints the transition.
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
        }

        // Map-level handlers attached ONCE per map instance (not inside
        // onStyleReady). Layer-filtered handlers installed inside
        // onStyleReady would stack on every theme swap because MapLibre
        // persists filtered handlers across setStyle calls.
        function handleClick(e) {
            if (!mapInstance || !mapInstance.getLayer('location-circles')) return;
            var features = mapInstance.queryRenderedFeatures(e.point, {
                layers: ['location-circles']
            });
            if (!features.length) return;
            var f = features[0];
            var subtitle = [];
            if (f.properties.country) subtitle.push(f.properties.country);
            subtitle.push(P.t('mentions_count', {
                count: P.formatNumber(Number(f.properties.count))
            }));
            P.createIwacPopup({ closeButton: true, closeOnClick: true })
                .setLngLat(f.geometry.coordinates.slice())
                .setDOMContent(P.buildMapPopup({
                    title: f.properties.name,
                    subtitleLines: subtitle
                }))
                .addTo(mapInstance);
        }

        var map = P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 3.2,
            globe: true,
            navigation: true,
            onStyleReady: onStyleReady
        });

        if (map) {
            mapInstance = map;
            map.on('click', handleClick);
            P.attachFeatureStateHover(map, {
                layer: 'location-circles',
                source: 'locations'
            });

            // Choropleth driven by the view facet above (its built-in
            // toggle button is hidden via hideDefaultControl). Starts in
            // bubbles mode filled with each country's grand total; the
            // "By country" facet switches it on and the Type sub-buttons
            // re-fill it by item type via choropleth.updateCounts(). The
            // per-country breakdown comes from country_counts (the place
            // bubbles have no type dimension). hoverInfo shows the country
            // name + count on hover so the fill isn't a silent block.
            if (typeof P.attachChoroplethToggle === 'function') {
                choropleth = P.attachChoroplethToggle(map, {
                    countryCounts:      countryCountsFor(ALL_KEY),
                    bubbleLayers:       ['location-circles'],
                    basePath:           basePath || '',
                    labelKey:           'mentions',
                    hideDefaultControl: true,
                    hoverInfo:          true
                });
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.map = { render: render };
})();
