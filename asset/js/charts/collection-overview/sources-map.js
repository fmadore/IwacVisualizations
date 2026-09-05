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
        var mapContainer = P.el('div', 'iwac-vis-map iwac-vis-source-map__map');
        panelEl.chart.appendChild(mapContainer);
        mapContainer.appendChild(P.buildLoadingState());

        // MapLibre is imported in parallel with the script chain, so its
        // global may not exist yet at render() time — wait for it here, in the
        // one panel that needs it, rather than holding the block back.
        P.lazyInit(panelEl.panel, function () {
            mapContainer.innerHTML = '';
            P.withMaplibre(mapContainer, function () {
                buildMap(mapContainer, mappedSources, ctx);
            });
        });
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
        var fitDone = false;

        function fitToSources(map) {
            if (fitDone || mappedSources.length < 2) return;
            P.fitToPoints(map, mappedSources, { padding: 48, maxZoom: 5, duration: 0 });
            fitDone = true;
        }

        function onStyleReady(map) {
            if (!map.getSource('source-locations')) {
                map.addSource('source-locations', {
                    type: 'geojson',
                    data: featureResult.collection,
                    generateId: true
                });
            }
            if (!map.getLayer('source-circles')) {
                map.addLayer(P.bubbleLayer({
                    id: 'source-circles',
                    source: 'source-locations',
                    radius: P.countRadius('count', maxCount, 6, 30),
                    sortKey: 'count'
                }));
            }
            fitToSources(map);
        }

        function sourceUrl(source) {
            return ctx.siteBase ? P.itemUrl(ctx.siteBase, source.o_id) : '';
        }

        function typeBreakdown(source) {
            var byType = source.by_type || {};
            return Object.keys(byType).sort().map(function (key) {
                return P.t('item_type_' + key) + ': ' + P.formatNumber(byType[key]);
            }).join(' · ');
        }

        function popupFor(feature) {
            var source = mappedSources[Number(feature.properties.idx)];
            if (!source) return null;

            var subtitle = [];
            subtitle.push(P.t('items_count', { count: P.formatNumber(source.count || 0) }));
            if (source.countries && source.countries.length) {
                subtitle.push(source.countries.slice(0, 4).join(', ') +
                    (source.countries.length > 4 ? ' +' + (source.countries.length - 4) : ''));
            }
            var breakdown = typeBreakdown(source);
            if (breakdown) subtitle.push(breakdown);

            return { title: source.name, titleHref: sourceUrl(source), subtitleLines: subtitle };
        }

        var map = P.createIwacMap(mapContainer, {
            center: [0, 16],
            zoom: 1.8,
            globe: true,
            navigation: true,
            onStyleReady: onStyleReady
        });

        if (map) {
            P.attachMapClickPopup(map, { layers: 'source-circles', content: popupFor });
            P.attachFeatureStateHover(map, {
                layer: 'source-circles',
                source: 'source-locations'
            });
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.sourcesMap = { render: render };
})();
