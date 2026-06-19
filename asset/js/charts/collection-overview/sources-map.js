/**
 * IWAC Visualizations — Collection Overview: Source locations panel
 *
 * Final migration slice from iwac-dashboard's `/spatial/sources` route:
 * a MapLibre bubble map of source repositories/platforms plus a ranked
 * table. Data is bundled into `collection-overview.json` as `sources_map`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildTable || !P.buildMapPopup) {
        console.warn('IWACVis.collection-overview/sources-map: missing dependencies');
        return;
    }

    function render(panelEl, data, ctx) {
        var bundle = (data && data.sources_map) || {};
        var sources = bundle.sources || [];
        var meta = bundle.metadata || {};

        panelEl.chart.classList.add('iwac-vis-chart--auto');

        if (sources.length === 0) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var mapped = sources.filter(function (source) {
            return source.lat != null && source.lng != null;
        });

        panelEl.chart.appendChild(P.el(
            'p',
            'iwac-vis-source-map__meta',
            P.t('source_map_summary', {
                sources: P.formatNumber(meta.total_sources || sources.length),
                mapped: P.formatNumber(meta.sources_with_coordinates || mapped.length),
                items: P.formatNumber(meta.total_items || 0)
            })
        ));

        if (mapped.length > 0) {
            renderMap(panelEl, mapped, ctx || {});
        } else {
            panelEl.chart.appendChild(P.buildEmptyState(P.t('No mapped sources')));
        }

        renderTable(panelEl, sources, ctx || {});
    }

    function renderTable(panelEl, sources, ctx) {
        var siteBase = ctx.siteBase || '';
        var rows = sources.map(function (source) {
            var countries = source.countries || [];
            var countryLabel = countries.slice(0, 3).join(', ');
            if (countries.length > 3) {
                countryLabel += ' +' + (countries.length - 3);
            }
            return {
                name: source.name,
                url: source.o_id && siteBase ? siteBase + '/item/' + source.o_id : '',
                count: source.count || 0,
                countries: countryLabel,
                coordinates: source.lat != null && source.lng != null ? '✓' : '—'
            };
        });

        var table = P.buildTable({
            columns: [
                { key: 'name', label: P.t('Source'), render: 'link', linkKey: 'url' },
                { key: 'count', label: P.t('Count'), render: 'number', width: '9rem' },
                { key: 'countries', label: P.t('Countries') },
                { key: 'coordinates', label: P.t('Coordinates'), width: '8rem' }
            ],
            rows: rows,
            pageSize: 12,
            className: 'iwac-vis-source-map__table'
        });
        panelEl.chart.appendChild(table.root);
    }

    function renderMap(panelEl, mappedSources, ctx) {
        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.buildErrorState(P.t('Map library unavailable')));
            return;
        }

        var mapContainer = P.el('div', 'iwac-vis-map iwac-vis-source-map__map');
        panelEl.chart.appendChild(mapContainer);
        mapContainer.appendChild(P.buildLoadingState());

        var loaded = false;
        function loadAndRender() {
            if (loaded) return;
            loaded = true;
            mapContainer.innerHTML = '';
            buildMap(mapContainer, mappedSources, ctx);
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

    function buildMap(mapContainer, mappedSources, ctx) {
        var featureResult = P.buildCountFeatures(mappedSources, {
            toProps: function (source, idx) {
                return {
                    idx: idx,
                    name: source.name,
                    count: source.count || 0,
                    countries: (source.countries || []).join(', '),
                    o_id: source.o_id || ''
                };
            }
        });

        var maxCount = featureResult.max;
        var mapInstance = null;
        var fitDone = false;

        function ml(color) {
            return P.normalizeColorForMapLibre ? P.normalizeColorForMapLibre(color) : color;
        }
        function resolvePrimary() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--primary');
            return ml(resolved || '#e64a19');
        }
        function resolveInk() {
            var resolved = ns.resolveCssVar && ns.resolveCssVar('--ink');
            return ml(resolved || '#2c2f37');
        }

        function fitToSources(map) {
            if (fitDone || mappedSources.length < 2 || typeof maplibregl.LngLatBounds !== 'function') {
                return;
            }
            var bounds = new maplibregl.LngLatBounds();
            mappedSources.forEach(function (source) {
                bounds.extend([source.lng, source.lat]);
            });
            map.fitBounds(bounds, {
                padding: 48,
                maxZoom: 5,
                duration: 0
            });
            fitDone = true;
        }

        function onStyleReady(map) {
            mapInstance = map;
            if (!map.getSource('source-locations')) {
                map.addSource('source-locations', {
                    type: 'geojson',
                    data: featureResult.collection,
                    generateId: true
                });
            }
            if (!map.getLayer('source-circles')) {
                map.addLayer({
                    id: 'source-circles',
                    type: 'circle',
                    source: 'source-locations',
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'count'],
                            1, 6,
                            maxCount, 30
                        ],
                        'circle-color': resolvePrimary(),
                        'circle-opacity': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            1.0,
                            0.76
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
            fitToSources(map);
        }

        function sourceUrl(source) {
            return source.o_id && ctx.siteBase ? ctx.siteBase + '/item/' + source.o_id : '';
        }

        function typeBreakdown(source) {
            var byType = source.by_type || {};
            return Object.keys(byType).sort().map(function (key) {
                return P.t('item_type_' + key) + ': ' + P.formatNumber(byType[key]);
            }).join(' · ');
        }

        function handleClick(e) {
            if (!mapInstance || !mapInstance.getLayer('source-circles')) return;
            var features = mapInstance.queryRenderedFeatures(e.point, {
                layers: ['source-circles']
            });
            if (!features.length) return;
            var feature = features[0];
            var source = mappedSources[Number(feature.properties.idx)];
            if (!source) return;

            var subtitle = [];
            subtitle.push(P.t('items_count', { count: P.formatNumber(source.count || 0) }));
            if (source.countries && source.countries.length) {
                subtitle.push(source.countries.slice(0, 4).join(', ') +
                    (source.countries.length > 4 ? ' +' + (source.countries.length - 4) : ''));
            }
            var breakdown = typeBreakdown(source);
            if (breakdown) subtitle.push(breakdown);

            P.createIwacPopup({ closeButton: true, closeOnClick: true })
                .setLngLat(feature.geometry.coordinates.slice())
                .setDOMContent(P.buildMapPopup({
                    title: source.name,
                    titleHref: sourceUrl(source),
                    subtitleLines: subtitle
                }))
                .addTo(mapInstance);
        }

        var map = P.createIwacMap(mapContainer, {
            center: [0, 16],
            zoom: 1.8,
            globe: true,
            navigation: true,
            onStyleReady: onStyleReady
        });

        if (map) {
            mapInstance = map;
            map.on('click', handleClick);
            P.attachFeatureStateHover(map, {
                layer: 'source-circles',
                source: 'source-locations'
            });
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.sourcesMap = { render: render };
})();
