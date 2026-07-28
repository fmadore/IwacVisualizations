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
 *  11. Full-text coverage — per-type digitisation bar (wide)
 *  12. Scholarly topics — one horizontal-bar panel per LDA model (wide)
 *  13. Reference provenance — MapLibre bubble map (wide)
 *  14. Subject co-occurrence — chord graph (wide)
 *  15. Author collaborations — force-directed network (wide)
 *
 * Panels 11–12 exist because the 2026-07 pipeline began extracting full
 * text for the bibliography (`OCR`, `embedding_OCR`, its own LDA run).
 * They are deliberately adjacent: the topic panels describe the digitised
 * subset, and the coverage panel immediately above states how large that
 * subset is, so the topic distribution is never read as a claim about the
 * whole bibliography.
 *
 * One topic panel PER MODEL, never a merged one: `references` is
 * topic-modelled twice (French + English) over the same `lda_topic_*`
 * columns, so topic 3 exists in both with unrelated meanings. The
 * generator keys on (lda_model_name, lda_topic_id); this file keeps that
 * separation visible in the UI instead of flattening it away.
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
    /*  Full-text coverage + topics (2026-07 references full text)        */
    /* ----------------------------------------------------------------- */

    /**
     * Per-type digitisation bar: how many references of each genre have
     * extracted full text. Value is the digitised count, not the share —
     * a 1-of-1 genre would otherwise plot as 100% and read as the
     * best-covered category in the bibliography. The tooltip carries the
     * share alongside both absolute numbers.
     */
    function coverageOption(byType) {
        var list = (byType || []).filter(function (e) { return e && e.total > 0; });
        return {
            grid: C._grid ? C._grid({ left: 8, top: 8, bottom: 8, right: 48 }) : undefined,
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var entry = list[p.dataIndex] || {};
                    var pct = entry.total
                        ? Math.round((entry.with_ocr / entry.total) * 100)
                        : 0;
                    return '<strong>' + P.escapeHtml(translateType(entry.name || '')) + '</strong><br>'
                        + P.t('references_coverage_tooltip', {
                            withOcr: P.formatNumber(entry.with_ocr || 0),
                            total:   P.formatNumber(entry.total || 0),
                            pct:     pct
                        });
                }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLabel: { width: 180, overflow: 'truncate' },
                data: list.map(function (e) { return translateType(e.name); })
            },
            series: [{
                type: 'bar',
                data: list.map(function (e) { return e.with_ocr; }),
                barMaxWidth: 22,
                itemStyle: { borderRadius: [0, 4, 4, 0] },
                label: { show: true, position: 'right', formatter: function (p) {
                    var entry = list[p.dataIndex] || {};
                    return P.formatNumber(entry.with_ocr || 0) + '/' + P.formatNumber(entry.total || 0);
                } }
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
    }

    /**
     * One model's topics as a horizontal bar of reference counts. The
     * tooltip lists the topic's most representative references (highest
     * `lda_topic_prob`) — the payload ships five per topic, which is what
     * makes an LDA label like "soufisme confrérie tidjaniyya" checkable
     * against actual titles instead of taken on faith.
     */
    function topicOption(topics) {
        var list = topics || [];
        return {
            grid: C._grid ? C._grid({ left: 8, top: 8, bottom: 8, right: 40 }) : undefined,
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var topic = list[p.dataIndex] || {};
                    var lines = ['<strong>' + P.escapeHtml(topic.label || '') + '</strong>'];
                    lines.push(P.t('references_topic_tooltip', {
                        count: P.formatNumber(topic.count || 0),
                        pct:   Math.round((topic.share || 0) * 100)
                    }));
                    (topic.items || []).slice(0, 5).forEach(function (item) {
                        lines.push('&middot; ' + P.escapeHtml(item.title || ''));
                    });
                    return lines.join('<br>');
                }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLabel: { width: 200, overflow: 'truncate' },
                data: list.map(function (t) {
                    return (P.topicShortLabel && P.topicShortLabel(t.label)) || t.label || ('#' + t.topic_id);
                })
            },
            series: [{
                type: 'bar',
                data: list.map(function (t) { return t.count; }),
                barMaxWidth: 22,
                itemStyle: { borderRadius: [0, 4, 4, 0] },
                label: { show: true, position: 'right' }
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Semantic landscape — UMAP scatter of the embedded references       */
    /* ----------------------------------------------------------------- */
    //
    // The bibliography's counterpart to the press corpus's Semantic
    // Landscape block, as a panel rather than a block: at ~423 points
    // it is one view among several here, not a destination of its own.
    // Both are UMAP over 768-dim gemini-embedding-2 vectors, so the two
    // maps are built the same way — but they are separate projections
    // and coordinates are NOT comparable across them.

    var LANDSCAPE_FACETS = ['type', 'country', 'decade'];
    var LANDSCAPE_FACET_LABEL = { type: 'Type', country: 'Country', decade: 'Decade' };

    function landscapeHasPoints(landscape) {
        return !!(landscape && landscape.points &&
                  landscape.points.o_id && landscape.points.o_id.length);
    }

    /** Which facets the bundle can actually colour by. */
    function landscapeFacets(landscape) {
        return LANDSCAPE_FACETS.filter(function (f) {
            var table = f === 'type' ? landscape.types
                      : f === 'country' ? landscape.countries
                      : landscape.decades;
            return table && table.length > 1;
        });
    }

    /**
     * Bucket point indices by the active facet's category. Points whose
     * category is missing (-1) land in "Other" rather than vanishing —
     * a reference with no recorded country is still a reference, and
     * dropping it would quietly shrink the map when the facet changes.
     */
    function landscapeGroups(landscape, facet) {
        var pts = landscape.points;
        var table = facet === 'type' ? (landscape.types || [])
                  : facet === 'country' ? (landscape.countries || [])
                  : (landscape.decades || []);
        var column = pts[facet] || [];
        var other = P.t('Other');

        var groups = {};
        var order = [];
        for (var i = 0; i < pts.o_id.length; i++) {
            var idx = column[i];
            var name = idx >= 0 && table[idx] != null ? table[idx] : other;
            if (facet === 'type') name = translateType(name);
            if (!groups[name]) { groups[name] = []; order.push(name); }
            groups[name].push(i);
        }
        // Decades read chronologically; the rest by size, "Other" last.
        if (facet === 'decade') order.sort();
        else order.sort(function (a, b) { return groups[b].length - groups[a].length; });
        var tail = order.indexOf(other);
        if (tail !== -1) order.splice(order.length - 1, 0, order.splice(tail, 1)[0]);
        return { groups: groups, order: order };
    }

    function landscapeOption(landscape, facet) {
        var pts = landscape.points;
        var grouped = landscapeGroups(landscape, facet);
        var types = landscape.types || [];

        return {
            legend: {
                type: 'scroll',
                bottom: 0,
                itemWidth: 12,
                itemHeight: 10,
                data: grouped.order.slice()
            },
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    var i = p.data[2];
                    var bits = [];
                    if (pts.author && pts.author[i]) bits.push(pts.author[i]);
                    var t = pts.type ? pts.type[i] : -1;
                    if (t >= 0 && types[t]) bits.push(translateType(types[t]));
                    if (pts.year && pts.year[i]) bits.push(String(pts.year[i]));
                    return '<strong>' + P.escapeHtml(pts.title[i] || '') + '</strong>'
                        + (bits.length ? '<br>' + P.escapeHtml(bits.join(' · ')) : '');
                }
            },
            grid: { left: 8, right: 8, top: 8, bottom: 36 },
            // UMAP coordinates carry no unit — only relative position is
            // meaningful — so the axes are hidden rather than labelled
            // with numbers a reader could mistake for a measurement.
            xAxis: { type: 'value', scale: true, show: false },
            yAxis: { type: 'value', scale: true, show: false },
            dataZoom: [
                { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
                { type: 'inside', yAxisIndex: 0, filterMode: 'none' }
            ],
            series: grouped.order.map(function (name) {
                return {
                    name: name,
                    type: 'scatter',
                    // Larger than the article landscape's 4px: a few
                    // hundred points can afford to be legible.
                    symbolSize: 7,
                    itemStyle: { opacity: 0.75 },
                    emphasis: { itemStyle: { opacity: 1 } },
                    // [x, y, point-index] — the index feeds tooltip + click.
                    data: grouped.groups[name].map(function (i) {
                        return [pts.x[i], pts.y[i], i];
                    })
                };
            }),
            animation: false
        };
    }

    /**
     * Draw the landscape panel, or explain why there is nothing to draw.
     *
     * The generator ships an empty-state contract (same keys, no points)
     * when umap-learn is missing or too few references are embedded, so
     * this reads `meta.reason` and says which rather than rendering a
     * bare "no data" box the reader can't act on.
     */
    function renderLandscape(panel, host, landscape, siteBase) {
        var meta = (landscape && landscape.meta) || {};
        if (!landscapeHasPoints(landscape)) {
            var messageKey = meta.reason === 'umap_not_installed'
                ? 'references_landscape_empty_umap'
                : meta.reason === 'too_few_embeddings'
                    ? 'references_landscape_empty_few'
                    : 'references_landscape_empty';
            host.appendChild(P.buildEmptyState(P.t(messageKey)));
            panel.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
            return;
        }

        var facets = landscapeFacets(landscape);
        if (!facets.length) facets = ['type'];
        var state = { facet: facets[0] };

        if (facets.length > 1 && P.buildFacetButtons) {
            var subFacets = {};
            facets.forEach(function (f) { subFacets[f] = P.t(LANDSCAPE_FACET_LABEL[f]); });
            var facetBar = P.buildFacetButtons({
                facets: [{
                    key: 'facet',
                    label: P.t('Color by'),
                    subFacets: subFacets,
                    renderAs: 'buttons'
                }],
                activeKey: 'facet',
                onChange: function (evt) {
                    var f = evt.subFacet || facets[0];
                    if (facets.indexOf(f) === -1) f = facets[0];
                    state.facet = f;
                    var live = ns.getLiveChart && ns.getLiveChart(host);
                    // `true` — each facet produces a different series
                    // set, so a merged update would leave the previous
                    // facet's groups on the canvas.
                    if (live) live.setOption(landscapeOption(landscape, state.facet), true);
                }
            });
            panel.panel.insertBefore(facetBar.root, host);
        }

        var chart = ns.registerChart(host, function (el, instance) {
            instance.setOption(landscapeOption(landscape, state.facet), true);
        });

        if (chart && siteBase) {
            chart.on('click', function (params) {
                var i = params.data && params.data[2];
                if (i == null) return;
                var oId = landscape.points.o_id[i];
                if (oId != null) window.location.href = siteBase + '/item/' + oId;
            });
        }
        if (chart && P.addFullscreenButton) {
            P.addFullscreenButton(panel.panel, {
                onResize: function () {
                    var live = ns.getLiveChart && ns.getLiveChart(host);
                    if (live) live.resize();
                }
            });
        }
    }

    /**
     * The landscape's description, carrying its denominators for the
     * same reason the coverage panel does — except here the stakes are
     * higher, because a scatter of every point *looks* exhaustive. The
     * embedded half is not a random sample of the bibliography: it is
     * what IWAC could obtain and digitise.
     */
    function landscapeDescription(landscape) {
        var meta = (landscape && landscape.meta) || {};
        if (!meta.total) return P.t('references_landscape_desc');
        return P.t('references_landscape_desc_full', {
            embedded: P.formatNumber(meta.embedded || 0),
            total:    P.formatNumber(meta.total || 0),
            pct:      Math.round(((meta.embedded || 0) / meta.total) * 100)
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Layout composition                                                */
    /* ----------------------------------------------------------------- */

    /**
     * The coverage panel's own description, with the denominators
     * interpolated. Stating them in the panel prose — rather than only in
     * a tooltip — is deliberate: the topic panels directly below describe
     * this subset, not the whole bibliography, and that qualification
     * should survive a screenshot.
     */
    function coverageDescription(coverage) {
        if (!coverage || !coverage.total) return P.t('references_coverage_desc');
        return P.t('references_coverage_desc_full', {
            withOcr:   P.formatNumber(coverage.with_ocr || 0),
            total:     P.formatNumber(coverage.total || 0),
            pct:       Math.round((coverage.with_ocr / coverage.total) * 100),
            words:     P.formatNumber(coverage.words_total || 0),
            median:    P.formatNumber(coverage.words_median || 0),
            published: P.formatNumber(coverage.public_content || 0)
        });
    }

    function buildLayout(container, summary, topicModels, coverage, landscape) {
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
        var coveragePanel  = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('Full-text coverage'),
            coverageDescription(coverage)
        );
        // One panel per LDA model. The heading names the model's language
        // so "topic 3" in the French corpus is never mistaken for "topic 3"
        // in the English one — they come from different models.
        var topicPanels = (topicModels || []).map(function (model) {
            var language = model.language ? translateLang(model.language) : '';
            var panel = P.buildPanel(
                'iwac-vis-panel iwac-vis-panel--wide',
                language
                    ? P.t('references_topics_title_lang', { language: language })
                    : P.t('Scholarly topics'),
                P.t('references_topics_desc', {
                    count:  P.formatNumber(model.n_docs || 0),
                    topics: P.formatNumber(model.n_topics || 0)
                })
            );
            return { model: model, panel: panel.panel, chart: panel.chart };
        });
        var landscapePanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('Semantic landscape of the literature'),
            // With no projection there is nothing for the description to
            // describe — "covers 0 of 867 references" over an empty box
            // reads as a broken panel. The empty state says why instead.
            landscapeHasPoints(landscape) ? landscapeDescription(landscape) : null
        );
        // A scatter needs room to separate; reuse the graph host's 640px
        // reservation rather than the 320px default, as the landscape
        // block does.
        landscapePanel.chart.classList.add('iwac-vis-graph-host');
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
        grid.appendChild(coveragePanel.panel);
        topicPanels.forEach(function (entry) { grid.appendChild(entry.panel); });
        grid.appendChild(landscapePanel.panel);
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
            coverage:  coveragePanel,
            coverageChart: coveragePanel.chart,
            topicPanels: topicPanels,
            landscape: landscapePanel,
            landscapeChart: landscapePanel.chart,
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
            author_collaborations:  data.author_collaborations || { nodes: [], edges: [] },
            // Left raw on purpose: reference types are translated at the
            // point of use inside the coverage tooltip / axis, and topic
            // labels are LDA top-word lists — machine output in the
            // corpus language, not translatable UI copy.
            fulltext:               data.fulltext || null,
            topics:                 (data.topics && data.topics.models) || []
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function render(container, raw, ctx) {
        var siteBase = ctx.siteBase;
        if (!raw || !raw.summary || raw.summary.total === 0) {
            container.innerHTML = '';
            container.appendChild(P.buildEmptyState());
            return;
        }

        var data = localizeData(raw);
        // Only models that actually produced topics get a panel — a
        // pipeline run that has not reached the English references yet
        // should leave no empty box behind.
        var topicModels = data.topics.filter(function (m) {
            return m && m.topics && m.topics.length > 0;
        });
        var landscape = raw.semantic_landscape || null;
        var h = buildLayout(container, data.summary, topicModels, data.fulltext, landscape);

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

        // 9. Full-text coverage per reference type
        var coverage = data.fulltext;
        if (coverage && coverage.by_type && coverage.by_type.length > 0) {
            ns.registerChart(h.coverageChart, function (el, chart) {
                chart.setOption(coverageOption(coverage.by_type));
            });
        } else {
            h.coverageChart.appendChild(P.buildEmptyState());
            h.coverage.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        }

        // 10. Scholarly topics — one panel per LDA model
        h.topicPanels.forEach(function (entry) {
            ns.registerChart(entry.chart, function (el, chart) {
                chart.setOption(topicOption(entry.model.topics));
            });
        });

        // 11. Semantic landscape of the embedded references
        renderLandscape(h.landscape, h.landscapeChart, landscape, siteBase);

        // 12. Reference provenance map
        renderProvenanceMap(h.provenance.panel, h.provenanceChart, data.provenance_map, siteBase);

        // 13. Subject co-occurrence chord
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

        // 14. Author collaboration network
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
    }

    P.bootBlock({
        selector:       '.iwac-vis-references-overview',
        warnLabel:      'IWACVis references overview',
        requireECharts: true,
        dataFile:       'references-overview.json',
        beforeLoad:     function (container) {
            var loadingLabel = container.querySelector('.iwac-vis-loading span');
            if (loadingLabel) loadingLabel.textContent = P.t('Loading references overview') + '\u2026';
        },
        render:         render
    });

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

})();
