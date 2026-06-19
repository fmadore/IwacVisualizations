/**
 * IWAC Visualizations — References Overview block (controller)
 *
 * Loads a single precomputed JSON bundle from
 * `asset/data/references-overview.json` (built by
 * `scripts/generate_references_overview.py`) and renders all panels
 * from it. Replaces the old client-side path that paged through the
 * Hugging Face datasets-server `/rows` endpoint at runtime — every
 * visit triggered ~9 parallel HTTP fetches and a full client-side
 * aggregation pass over 864 rows.
 *
 * Panels (in render order):
 *   1. Summary cards row
 *   2. "Period covered" subtitle
 *   3. Timeline — stacked bar of references per year, by type (wide)
 *   4. Reference types — horizontal bar
 *   5. Languages represented — pie
 *   6. Countries studied — horizontal bar
 *   7. Top authors — horizontal bar (wide)
 *   8. Top publishers — horizontal bar (wide)
 *   9. Top subjects — horizontal bar (wide)
 *  10. References breakdown — treemap country → type (wide)
 *  11. Reference provenance — MapLibre bubble map (wide)
 *  12. Subject co-occurrence — chord graph (wide)
 *  13. Author collaborations — force-directed network (wide)
 *
 * Load order: after shared/panels.js + shared/chart-options.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis references overview: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    /* ----------------------------------------------------------------- */
    /*  Translation helpers — type + language names                       */
    /* ----------------------------------------------------------------- */

    /**
     * Translate a French-source reference type (e.g. "Article de revue")
     * to the active locale via the `ref_type_<name>` i18n key. Falls
     * back to the raw name when no translation exists so unknown types
     * still render gracefully.
     */
    function translateType(type) {
        return P.translateKeyed('ref_type_', type);
    }

    /**
     * Same idea for language names: precomputed JSON ships the raw
     * French label ("Anglais"), the JS calls `lang_<name>` so the panel
     * shows "English" on the English site and "Anglais" on the French
     * one.
     */
    function translateLang(name) {
        return P.translateKeyed('lang_', name);
    }

    function translateEntries(entries, fn) {
        return (entries || []).map(function (e) {
            return { name: fn(e.name), count: e.count };
        });
    }

    function subjectGraphToChord(graph, limit) {
        graph = graph || {};
        var nodes = (graph.nodes || []).slice();
        var edges = graph.edges || [];
        if (nodes.length < 2 || edges.length === 0) {
            return { names: [], matrix: [] };
        }

        nodes.sort(function (a, b) {
            var aScore = (a.strength || 0) || (a.count || 0);
            var bScore = (b.strength || 0) || (b.count || 0);
            return bScore - aScore || (b.count || 0) - (a.count || 0);
        });
        nodes = nodes.slice(0, limit || 30);

        var indexById = {};
        var names = nodes.map(function (node, index) {
            indexById[node.id] = index;
            return node.label || node.name || node.id;
        });
        var matrix = names.map(function () {
            return names.map(function () { return 0; });
        });

        edges.forEach(function (edge) {
            var source = indexById[edge.source];
            var target = indexById[edge.target];
            if (source == null || target == null || source === target) return;
            var weight = Number(edge.weight || 0);
            matrix[source][target] += weight;
            matrix[target][source] += weight;
        });

        return { names: names, matrix: matrix };
    }

    function hasChordEdges(chord) {
        if (!chord || !Array.isArray(chord.matrix)) return false;
        for (var i = 0; i < chord.matrix.length; i++) {
            var row = chord.matrix[i] || [];
            for (var j = 0; j < row.length; j++) {
                if (i !== j && row[j] > 0) return true;
            }
        }
        return false;
    }

    function renderProvenanceMap(panelEl, mapHost, provenanceMap, siteBase) {
        var locations = (provenanceMap && provenanceMap.locations) || [];
        if (!locations.length || !P.createIwacMap || !P.buildCountFeatures) {
            mapHost.innerHTML = '';
            mapHost.appendChild(P.buildEmptyState('No provenance locations available'));
            if (panelEl) panelEl.setAttribute('data-iwac-no-panel-toolbar', '1');
            return null;
        }

        mapHost.innerHTML = '';
        var mapEl = P.el('div', 'iwac-vis-map iwac-vis-map--references-provenance');
        mapHost.appendChild(mapEl);

        var featureBundle = P.buildCountFeatures(locations, {
            countKey: 'count',
            minCount: 1,
            toProps: function (location, index) {
                return {
                    locationIndex: index,
                    name: location.name,
                    count: location.count,
                    o_id: location.o_id || '',
                    earliestYear: location.earliestYear || '',
                    latestYear: location.latestYear || ''
                };
            }
        });
        featureBundle.collection.features.forEach(function (feature, index) {
            feature.id = index;
        });

        var sourceId = 'iwac-references-provenance';
        var layerId = sourceId + '-bubbles';
        var maxCount = Math.max(featureBundle.max || 1, (provenanceMap.meta && provenanceMap.meta.maxCount) || 1);

        function addLayers(map) {
            var tokens = ns.getChartTokens ? ns.getChartTokens() : {};
            var primary = P.normalizeColorForMapLibre
                ? P.normalizeColorForMapLibre(tokens.primary || '#e64a19')
                : (tokens.primary || '#e64a19');
            var surface = P.normalizeColorForMapLibre
                ? P.normalizeColorForMapLibre(tokens.surface || '#ffffff')
                : (tokens.surface || '#ffffff');

            if (!map.getSource(sourceId)) {
                map.addSource(sourceId, {
                    type: 'geojson',
                    data: featureBundle.collection
                });
            }
            if (!map.getLayer(layerId)) {
                map.addLayer({
                    id: layerId,
                    type: 'circle',
                    source: sourceId,
                    paint: {
                        'circle-radius': [
                            'interpolate', ['linear'], ['get', 'count'],
                            1, 6,
                            maxCount, 28
                        ],
                        'circle-color': primary,
                        'circle-opacity': 0.7,
                        'circle-stroke-color': surface,
                        'circle-stroke-width': 1.5
                    }
                });
            } else {
                map.setPaintProperty(layerId, 'circle-color', primary);
                map.setPaintProperty(layerId, 'circle-stroke-color', surface);
            }

            if (!map._iwacReferencesProvenanceHandlers) {
                map._iwacReferencesProvenanceHandlers = true;
                map.on('mouseenter', layerId, function () {
                    map.getCanvas().style.cursor = 'pointer';
                });
                map.on('mouseleave', layerId, function () {
                    map.getCanvas().style.cursor = '';
                });
                map.on('click', layerId, function (event) {
                    var feature = event.features && event.features[0];
                    if (!feature) return;
                    var props = feature.properties || {};
                    var location = locations[Number(props.locationIndex)] || {};
                    var subtitle = [];
                    subtitle.push(P.t('references_count', { count: P.formatNumber(location.count || 0) }));
                    if (location.earliestYear && location.latestYear) {
                        subtitle.push(String(location.earliestYear) + '–' + String(location.latestYear));
                    }
                    var popup = P.createIwacPopup && P.createIwacPopup();
                    if (!popup) return;
                    popup
                        .setLngLat(feature.geometry.coordinates)
                        .setDOMContent(P.buildMapPopup({
                            title: location.name || props.name,
                            titleHref: location.o_id && siteBase ? siteBase + '/item/' + location.o_id : '',
                            subtitleLines: subtitle,
                            articles: location.publications || [],
                            siteBase: siteBase || '',
                            pageSize: 5
                        }))
                        .addTo(map);
                });
            }
        }

        var map = P.createIwacMap(mapEl, {
            center: [0, 10],
            zoom: 2.2,
            globe: false,
            onStyleReady: addLayers
        });

        if (map && provenanceMap.bounds) {
            map.once('load', function () {
                var bounds = provenanceMap.bounds;
                if (locations.length === 1) {
                    map.setCenter([locations[0].lng, locations[0].lat]);
                    map.setZoom(5);
                } else {
                    map.fitBounds(
                        [[bounds.west, bounds.south], [bounds.east, bounds.north]],
                        { padding: 42, maxZoom: 7, duration: 0 }
                    );
                }
            });
        }
        if (map && P.addFullscreenButton && panelEl) {
            P.addFullscreenButton(panelEl, {
                onResize: function () {
                    setTimeout(function () { map.resize(); }, 50);
                }
            });
        }
        return map;
    }

    /* ----------------------------------------------------------------- */
    /*  Layout composition                                                */
    /* ----------------------------------------------------------------- */

    function buildLayout(container, summary) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        root.appendChild(P.buildSummaryCards([
            { value: summary.total,      labelKey: 'References' },
            { value: summary.authors,    labelKey: 'Authors' },
            { value: summary.publishers, labelKey: 'Publishers' },
            { value: summary.types,      labelKey: 'Reference types' },
            { value: summary.countries,  labelKey: 'Countries' },
            { value: summary.languages,  labelKey: 'Languages' }
        ]));

        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var timelinePanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('References by type over time'));
        var typesPanel     = P.buildPanel('iwac-vis-panel', P.t('Reference types'));
        var languagesPanel = P.buildPanel('iwac-vis-panel', P.t('Languages represented'));
        var countriesPanel = P.buildPanel('iwac-vis-panel', P.t('Content by country'));
        var authorsPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Top authors'));
        var publishersPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Top publishers'));
        var subjectsPanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Top subjects'));
        var treemapPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Collection breakdown'));
        // Nested treemap (country › source) — give it room past the 320px
        // floor, matching the collection-overview breakdown panel.
        treemapPanel.chart.classList.add('iwac-vis-treemap-host');
        var provenancePanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('Reference provenance'),
            P.t('references_provenance_desc')
        );
        var subjectCooccurrencePanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('Subject co-occurrence'),
            P.t('references_subject_cooccurrence_desc')
        );
        subjectCooccurrencePanel.chart.classList.add('iwac-vis-chord-host');
        var networkPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Author collaborations'));
        // The collaboration network needs the same breathing room as
        // the entity-dashboard graph host so labels on the outer ring
        // don't clip and the force layout has somewhere to expand to.
        networkPanel.chart.classList.add('iwac-vis-graph-host');

        grid.appendChild(timelinePanel.panel);
        grid.appendChild(typesPanel.panel);
        grid.appendChild(languagesPanel.panel);
        grid.appendChild(countriesPanel.panel);
        grid.appendChild(authorsPanel.panel);
        grid.appendChild(publishersPanel.panel);
        grid.appendChild(subjectsPanel.panel);
        grid.appendChild(treemapPanel.panel);
        grid.appendChild(provenancePanel.panel);
        grid.appendChild(subjectCooccurrencePanel.panel);
        grid.appendChild(networkPanel.panel);

        return {
            timeline:  timelinePanel.chart,
            types:     typesPanel.chart,
            languages: languagesPanel.chart,
            countries: countriesPanel.chart,
            authors:   authorsPanel.chart,
            publishers: publishersPanel.chart,
            subjects:  subjectsPanel.chart,
            treemap:   treemapPanel.chart,
            provenance: provenancePanel,
            provenanceChart: provenancePanel.chart,
            subjectCooccurrence: subjectCooccurrencePanel,
            subjectCooccurrenceChart: subjectCooccurrencePanel.chart,
            network:   networkPanel,
            networkChart: networkPanel.chart
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Translation pass over the precomputed data                        */
    /* ----------------------------------------------------------------- */

    /**
     * The generator ships type names as raw French because i18n is the
     * front-end's job, not the build's. This wraps the affected fields
     * with `translateType` / `translateLang` calls so every label that
     * lands in the DOM has been routed through the active locale.
     */
    function localizeData(data) {
        // Timeline: the `countries` array is actually the stack
        // categories (reference types). Both `countries` and `series`
        // keys need the same rename so C.timeline finds matching keys.
        var timeline = data.timeline || { years: [], countries: [], series: {} };
        var translatedTypes = (timeline.countries || []).map(translateType);
        var translatedSeries = {};
        (timeline.countries || []).forEach(function (rawType, i) {
            translatedSeries[translatedTypes[i]] = timeline.series[rawType] || [];
        });
        var localizedTimeline = {
            years:     timeline.years || [],
            countries: translatedTypes,
            series:    translatedSeries
        };

        // Treemap: keep country labels as-is (they're language-neutral
        // proper nouns), but translate the inner type children.
        var treemap = data.treemap || { children: [] };
        var localizedTreemap = {
            name: treemap.name,
            children: (treemap.children || []).map(function (c) {
                return {
                    name: c.name,
                    value: c.value,
                    children: (c.children || []).map(function (t) {
                        return { name: translateType(t.name), value: t.value };
                    })
                };
            })
        };

        return {
            summary:                data.summary || {},
            timeline:               localizedTimeline,
            types:                  translateEntries(data.types, translateType),
            languages:              translateEntries(data.languages, translateLang),
            countries:              data.countries || [],
            authors:                data.authors || [],
            publishers:             data.publishers || [],
            publisher_countries:     data.publisher_countries || {},
            subjects:               data.subjects || [],
            treemap:                localizedTreemap,
            provenance_map:          data.provenance_map || { locations: [] },
            subject_cooccurrence:    data.subject_cooccurrence || { nodes: [], edges: [], meta: {} },
            author_collaborations:  data.author_collaborations || { nodes: [], edges: [] }
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function initReferencesOverview(container) {
        var loadingLabel = container.querySelector('.iwac-vis-loading span');
        if (loadingLabel) loadingLabel.textContent = P.t('Loading references overview') + '\u2026';

        var basePath = container.getAttribute('data-base-path') || '';
        var siteBase = container.getAttribute('data-site-base') || '';
        var url = basePath + '/modules/IwacVisualizations/asset/data/references-overview.json';

        P.fetchJSON(url)
            .then(function (raw) {
                if (!raw || !raw.summary || raw.summary.total === 0) {
                    container.innerHTML = '';
                    container.appendChild(P.buildEmptyState());
                    return;
                }

                var data = localizeData(raw);
                var h = buildLayout(container, data.summary);

                // 1. Timeline
                if (data.timeline.years && data.timeline.years.length > 0) {
                    ns.registerChart(h.timeline, function (el, chart) {
                        chart.setOption(C.timeline(data.timeline));
                    });
                }

                // 2. Reference types
                if (data.types.length > 0) {
                    ns.registerChart(h.types, function (el, chart) {
                        chart.setOption(C.horizontalBar(data.types));
                    });
                }

                // 3. Languages
                if (data.languages.length > 0) {
                    ns.registerChart(h.languages, function (el, chart) {
                        chart.setOption(C.pie(data.languages));
                    });
                }

                // 4. Countries
                if (data.countries.length > 0) {
                    ns.registerChart(h.countries, function (el, chart) {
                        chart.setOption(C.horizontalBar(data.countries));
                    });
                }

                // 5. Top authors
                if (data.authors.length > 0) {
                    ns.registerChart(h.authors, function (el, chart) {
                        chart.setOption(C.horizontalBar(data.authors));
                    });
                }

                // 6. Top publishers
                if (data.publishers.length > 0) {
                    ns.registerChart(h.publishers, function (el, chart) {
                        chart.setOption(C.horizontalBar(data.publishers));
                    });
                }

                // 7. Top subjects
                if (data.subjects.length > 0) {
                    ns.registerChart(h.subjects, function (el, chart) {
                        chart.setOption(C.horizontalBar(data.subjects));
                    });
                }

                // 8. Treemap country → type
                if (data.treemap.children && data.treemap.children.length > 0) {
                    ns.registerChart(h.treemap, function (el, chart) {
                        chart.setOption(C.treemap(data.treemap));
                    });
                }

                // 9. Reference provenance map
                renderProvenanceMap(h.provenance.panel, h.provenanceChart, data.provenance_map, siteBase);

                // 10. Subject co-occurrence chord
                var subjectChord = subjectGraphToChord(data.subject_cooccurrence, 30);
                if (subjectChord.names.length > 1 && hasChordEdges(subjectChord) && C.chord) {
                    var subjectChart = ns.registerChart(h.subjectCooccurrenceChart, function (el, instance) {
                        instance.setOption(C.chord(subjectChord, { minWeight: 1 }), true);
                    });
                    if (subjectChart && P.addFullscreenButton) {
                        P.addFullscreenButton(h.subjectCooccurrence.panel, {
                            onResize: function () {
                                var live = ns.getLiveChart && ns.getLiveChart(h.subjectCooccurrenceChart);
                                if (live) live.resize();
                            }
                        });
                    }
                } else {
                    h.subjectCooccurrenceChart.appendChild(P.buildEmptyState('No subject co-occurrence available'));
                    h.subjectCooccurrence.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
                }

                // 11. Author collaboration network
                var graph = data.author_collaborations;
                if (graph.nodes && graph.nodes.length > 1 && C.collaborationNetwork) {
                    var chart = ns.registerChart(h.networkChart, function (el, instance) {
                        instance.setOption(C.collaborationNetwork(graph), true);
                    });
                    // Wire a fullscreen toggle so the network panel can
                    // expand into the viewport for closer inspection,
                    // matching the cooccurrence chord and entity network
                    // panels on the person dashboard.
                    if (chart && P.addFullscreenButton) {
                        P.addFullscreenButton(h.network.panel, {
                            onResize: function () {
                                var live = ns.getLiveChart && ns.getLiveChart(h.networkChart);
                                if (live) live.resize();
                            }
                        });
                    }
                }
            })
            .catch(function (err) {
                console.error('IWACVis references overview:', err);
                container.innerHTML = '';
                container.appendChild(P.buildErrorState());
            });
    }

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis references overview: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-references-overview');
        for (var i = 0; i < containers.length; i++) {
            initReferencesOverview(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
