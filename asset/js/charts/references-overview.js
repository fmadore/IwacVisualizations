/**
 * IWAC Visualizations — References Overview block (controller)
 *
 * Loads a single precomputed JSON bundle from
 * `asset/data/references-overview.json` (built by
 * `scripts/generate_references_overview.py`) and renders all panels
 * from it.
 *
 * Panels (in render order), grouped as a reading path — what the
 * bibliography is, where, who wrote it, where it appeared, what it is about,
 * and what of it is digitised:
 *   1. Summary cards row
 *   2. "Period covered" subtitle
 *   3. Timeline — stacked bar of references per year, by type (wide)
 *   4. Reference types — horizontal bar      | 5. Languages by decade — stacked bar
 *   6. Countries studied — horizontal bar    | 7. Places of publication — map
 *   8. Authors over time — lifelines: a dot per year published (wide)
 *   9. Author collaborations — d3-force network, Louvain groups (wide)
 *  10. Journals and publishers — ranked bars behind a kind switch (wide)
 *  11. Subjects over time — subject × period heatmap of shares (wide)
 *  12. Subject co-occurrence — matrix ordered by cluster (wide)
 *  13. Full-text coverage — per-type digitisation bar (wide)
 *  14. Scholarly topics — one bar chart per LDA model, behind a switch (wide)
 *  15. Semantic landscape — UMAP scatter (wide)
 *
 * Panels 5, 8, 10 and 11 read keys the generator added in its 0.5.0
 * (`language_timeline`, `author_lifelines`, `venues`, `subject_trends`).
 * Code and data ship separately — the data through the Sync Data job — so
 * each falls back to the chart it replaced (pie, top-N bars) while the
 * synced bundle predates them, under that chart's own title and wording.
 *
 * The half-width panels come in pairs on purpose. "Content by country" sat
 * alone on its row for releases, half the grid empty beside it; the
 * provenance map is its natural partner (countries studied vs. places of
 * publication), and the grid also widens any half-width panel that ends up
 * alone (`P.buildChartsGrid`). The country → type treemap is gone: it
 * restated the countries and types panels.
 *
 * Panels 13–14 exist because the 2026-07 pipeline began extracting full
 * text for the bibliography (`OCR`, its own LDA run; its vector is
 * `embedding_abstract`, title + abstract, since 2026-10).
 * They are deliberately adjacent: the topic panel describes the digitised
 * subset, and the coverage panel immediately above states how large that
 * subset is, so the topic distribution is never read as a claim about the
 * whole bibliography.
 *
 * One chart PER MODEL, never a merged one: `references` is topic-modelled
 * twice (French + English) over the same `lda_topic_*` columns, so topic 3
 * exists in both with unrelated meanings. The generator keys on
 * (lda_model_name, lda_topic_id); the panel's language switch keeps that
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

    /** Subjects the co-occurrence matrix shows, the most connected first. */
    var COOCCURRENCE_LIMIT = 24;

    function renderProvenanceMap(panelEl, mapHost, provenanceMap, siteBase) {
        var locations = (provenanceMap && provenanceMap.locations) || [];
        if (!locations.length || !P.createIwacMap || !P.buildCountFeatures) {
            mapHost.innerHTML = '';
            mapHost.appendChild(P.buildEmptyState('No provenance locations available'));
            if (panelEl) panelEl.setAttribute('data-iwac-no-panel-toolbar', '1');
            return null;
        }

        mapHost.innerHTML = '';
        var mapEl = P.el('div', 'iwac-vis-map iwac-vis-map--references-provenance iwac-vis-map--row');
        mapHost.appendChild(mapEl);

        // The provenance places as rows, for the panel toolbar's table and CSV.
        if (panelEl && P.setPanelRows) {
            P.setPanelRows(panelEl, function () {
                var rows = locations.map(function (loc) {
                    var span = loc.earliestYear
                        ? (loc.latestYear && loc.latestYear !== loc.earliestYear
                            ? loc.earliestYear + '\u2013' + loc.latestYear : String(loc.earliestYear))
                        : '';
                    return [siteBase && loc.o_id ? { text: loc.name, href: P.itemUrl(siteBase, loc.o_id) } : loc.name,
                        loc.count || 0, span];
                }).sort(function (a, b) { return b[1] - a[1]; });
                return rows.length ? {
                    columns: [
                        { label: P.t('Place'), numeric: false },
                        { label: P.t('Count'), numeric: true },
                        { label: P.t('Period covered_short'), numeric: false }
                    ],
                    rows: rows
                } : null;
            });
        }

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
            if (!map.getSource(sourceId)) {
                map.addSource(sourceId, {
                    type: 'geojson',
                    data: featureBundle.collection
                });
            }
            if (!map.getLayer(layerId)) {
                // The bibliography's bubbles sit on a surface stroke rather
                // than ink: a lighter register for a lighter map.
                map.addLayer(P.bubbleLayer({
                    id: layerId,
                    source: sourceId,
                    radius: P.countRadius('count', maxCount, 6, 28),
                    sortKey: 'count',
                    stroke: P.normalizeColorForMapLibre(tokens.surface),
                    opacity: [0.7, 1],
                    strokeWidth: [1.5, 3]
                }));
            }
        }

        function popupFor(feature) {
            var props = feature.properties || {};
            var location = locations[Number(props.locationIndex)] || {};
            var subtitle = [];
            subtitle.push(P.t('references_count', { count: location.count || 0 }));
            if (location.earliestYear && location.latestYear) {
                subtitle.push(String(location.earliestYear) + '–' + String(location.latestYear));
            }
            return {
                title: location.name || props.name,
                titleHref: siteBase ? P.itemUrl(siteBase, location.o_id) : '',
                subtitleLines: subtitle,
                articles: location.publications || [],
                siteBase: siteBase || '',
                pageSize: 5
            };
        }

        // MapLibre 6 is an ES module the page loader imports in PARALLEL with
        // the classic script chain, and this panel renders on the block's
        // first paint — so reading `maplibregl` synchronously here was a race
        // that a cold cache loses. Gate it; the spinner belongs to the map
        // host, and the rest of the references dashboard is unaffected.
        return P.withMaplibre(mapEl, function () {
            var map = P.createIwacMap(mapEl, {
                // Scholarship on West Africa is published worldwide, so
                // this is a wider frame than P.WEST_AFRICA_VIEW on purpose.
                center: [0, 10],
                zoom: 2.2,
                title: P.t('Where the scholarship was published'),
                // The panel toolbar already carries a fullscreen button
                // (P.addFullscreenButton, below); a second one in the map's
                // own corner did the same thing to a different element.
                fullscreen: false,
                onStyleReady: addLayers
            });
            if (!map) return null;

            // Wired ONCE per instance, outside onStyleReady, so a theme
            // swap does not stack a copy per toggle.
            P.attachMapClickPopup(map, { layers: layerId, content: popupFor, popup: {} });
            P.attachFeatureStateHover(map, { layer: layerId, source: sourceId });

            if (provenanceMap.bounds) {
                map.once('load', function () {
                    // The generator's bounds for several locations; a single
                    // one is centred at a fixed zoom instead.
                    var b = provenanceMap.bounds;
                    P.fitToPoints(map, locations.length === 1 ? locations : [
                        { lng: b.west, lat: b.south }, { lng: b.east, lat: b.north }
                    ], { padding: P.FIT_OPTS.padding, maxZoom: P.FIT_OPTS.maxZoom,
                        duration: 0, singleZoom: 5 });
                });
            }
            if (P.addFullscreenButton && panelEl) {
                P.addFullscreenButton(panelEl, {
                    onResize: function () {
                        setTimeout(function () { map.resize(); }, 50);
                    }
                });
            }
            return map;
        });
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
            // The theme's <body> tooltip: this panel has no fullscreen control.
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var entry = list[p.dataIndex] || {};
                    var pct = entry.total
                        ? Math.round((entry.with_ocr / entry.total) * 100)
                        : 0;
                    return C.itemTooltip(translateType(entry.name || ''),
                        P.t('references_coverage_tooltip', {
                            withOcr: P.formatNumber(entry.with_ocr || 0),
                            total:   P.formatNumber(entry.total || 0),
                            pct:     pct
                        }));
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
            }]
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
            // The theme's <body> tooltip: this panel has no fullscreen control.
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var topic = list[p.dataIndex] || {};
                    var lines = ['<strong>' + P.escapeHtml(topic.label || '') + '</strong>'];
                    lines.push(P.t('references_topic_tooltip', {
                        count: topic.count || 0,
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
            }]
        };
    }

    /** A model's description, with its own document and topic counts. */
    function topicDescription(model) {
        return P.t('references_topics_desc', {
            count:  (model && model.n_docs) || 0,
            topics: P.formatNumber((model && model.n_topics) || 0)
        });
    }

    /**
     * The topic panel: one model at a time, a language switch above the
     * chart when there is more than one. The switch swaps the whole option
     * (`notMerge`) and the description, whose counts are the model's own —
     * the French and English corpora differ in size, and a description left
     * on the first model would misstate the second.
     */
    function renderTopics(panel, models) {
        var state = { index: 0 };
        var desc = panel.panel.querySelector('.iwac-vis-panel-desc');

        function languageOf(model, i) {
            return model.language ? translateLang(model.language) : P.t('Model') + ' ' + (i + 1);
        }

        if (models.length > 1 && P.buildFacetButtons) {
            var subFacets = {};
            models.forEach(function (model, i) { subFacets['m' + i] = languageOf(model, i); });
            var facetBar = P.buildFacetButtons({
                facets: [{
                    key: 'model',
                    label: P.t('Language'),
                    subFacets: subFacets,
                    renderAs: 'buttons'
                }],
                activeKey: 'model',
                onChange: function (evt) {
                    var i = Number(String(evt.subFacet || 'm0').slice(1));
                    if (!(i >= 0 && i < models.length)) i = 0;
                    state.index = i;
                    if (desc) desc.textContent = topicDescription(models[i]);
                    var live = ns.getLiveChart && ns.getLiveChart(panel.chart);
                    if (live) live.setOption(topicOption(models[i].topics), true);
                }
            });
            panel.panel.insertBefore(facetBar.root, panel.chart);
        } else if (models[0] && models[0].language) {
            var title = P.panelTitle(panel.panel);
            if (title) {
                title.textContent = P.t('references_topics_title_lang', { language: languageOf(models[0], 0) });
            }
        }

        ns.registerChart(panel.chart, function (el, chart) {
            chart.setOption(topicOption(models[state.index].topics), true);
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Semantic landscape — UMAP scatter of the embedded references       */
    /* ----------------------------------------------------------------- */
    //
    // The bibliography's counterpart to the press corpus's Semantic
    // Landscape block, as a panel rather than a block: at ~442 points
    // it is one view among several here, not a destination of its own.
    // Both are UMAP over 768-dim EmbeddingGemma 2 vectors (abstracts here,
    // full texts there), so the two
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

    function landscapeOption(landscape, facet, siteBase) {
        var pts = landscape.points;
        var types = landscape.types || [];

        return C.landscape(pts, landscapeGroups(landscape, facet), {
            siteBase: siteBase,
            // Larger than the article landscape's 4px: a few hundred
            // points can afford to be legible.
            symbolSize: 7,
            opacity: 0.75,
            tooltipBits: function (i) {
                var bits = [];
                if (pts.author && pts.author[i]) bits.push(pts.author[i]);
                var t = pts.type ? pts.type[i] : -1;
                if (t >= 0 && types[t]) bits.push(translateType(types[t]));
                if (pts.year && pts.year[i]) bits.push(String(pts.year[i]));
                return bits;
            }
        });
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
                    if (live) live.setOption(landscapeOption(landscape, state.facet, siteBase), true);
                }
            });
            panel.panel.insertBefore(facetBar.root, host);
        }

        var chart = ns.registerChart(host, function (el, instance) {
            instance.setOption(landscapeOption(landscape, state.facet, siteBase), true);
        });

        P.navigateOnClick(chart, siteBase, function (params) {
            var i = params.data && params.data[2];
            return i == null ? null : landscape.points.o_id[i];
        });
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
    /*  Period panels (generator 0.5.0)                                    */
    /* ----------------------------------------------------------------- */

    function hasLanguageTimeline(lt) {
        return !!(lt && lt.categories && lt.categories.length && lt.stackKeys && lt.stackKeys.length);
    }

    /** Works per decade, stacked by first-listed language (C.stackedBar). */
    function languageTimelineOption(lt) {
        return C.stackedBar({
            categories: lt.categories.map(function (d) { return P.t('references_decade', { decade: d }); }),
            stackKeys:  lt.stackKeys,
            series:     lt.series || {}
        }, {
            labelFor:     translateLang,
            categoryName: P.t('Decade'),
            valueName:    P.t('References')
        });
    }

    function hasLifelines(al) {
        return !!(al && al.authors && al.authors.length);
    }

    /**
     * Author lifelines: one row per author, in the order the generator lists
     * them (by first year), a hairline from their first dated work to their
     * latest and a dot for every year they published, its area following the
     * works that year. One hue for every dot: the rows already say who, and a
     * colour per author would ask the reader to match twenty swatches.
     */
    function lifelinesOption(al) {
        var authors = al.authors;
        var names = authors.map(function (a) { return a.name; });
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var maxYear = 1;
        var dots = [];
        authors.forEach(function (a, row) {
            (a.years || []).forEach(function (yc) {
                if (yc[1] > maxYear) maxYear = yc[1];
                dots.push([yc[0], row, yc[1]]);
            });
        });
        var yearLabel = function (v) { return String(Math.round(v)); };

        return {
            grid: C._grid({ left: 8, top: 16, right: 24, bottom: 32 }),
            tooltip: C._inPanelTooltip({
                trigger: 'item',
                formatter: function (p) {
                    var a = authors[p.seriesType === 'custom' ? p.dataIndex : (p.value || [])[1]] || {};
                    if (p.seriesType === 'custom') {
                        var lines = [P.t('references_lifeline_span', { first: a.first, last: a.last }),
                            P.t('references_count', { count: a.count || 0 })];
                        if (a.dated !== a.count) {
                            lines.push(P.t('references_lifeline_undated', { count: (a.count || 0) - (a.dated || 0) }));
                        }
                        return C.itemTooltip(a.name, lines);
                    }
                    return C.itemTooltip(a.name, [String(p.value[0]) + ' \u2014 '
                        + P.t('references_count', { count: p.value[2] })]);
                }
            }),
            xAxis: {
                type: 'value',
                // From the decade below the first year (always a year of margin, so
                // the first dot is not clipped, and a round label to start on).
                min: al.year_min != null ? Math.floor((al.year_min - 1) / 10) * 10 : 'dataMin',
                max: al.year_max != null ? al.year_max + 1 : 'dataMax',
                minInterval: 1,
                // The axis ends a year past the data so the last dot is not
                // clipped; that padding year is not a date anyone published
                // in, so its label is not drawn.
                axisLabel: { formatter: yearLabel, showMaxLabel: false },
                splitLine: { show: true }
            },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false },
                axisLabel: { interval: 0, width: 160, overflow: 'truncate' }
            },
            series: [{
                type: 'custom',
                name: P.t('references_lifeline_series'),
                data: authors.map(function (a, row) { return [a.first, a.last, row]; }),
                encode: { x: [0, 1], y: 2 },
                renderItem: function (params, api) {
                    var start = api.coord([api.value(0), api.value(2)]);
                    var end = api.coord([api.value(1), api.value(2)]);
                    return {
                        type: 'line',
                        shape: { x1: start[0], y1: start[1], x2: end[0], y2: end[1] },
                        style: { stroke: tokens.inkLight || tokens.muted, lineWidth: 2, opacity: 0.55 }
                    };
                },
                z: 1
            }, {
                type: 'scatter',
                name: P.t('References'),
                data: dots,
                symbolSize: function (v) { return 6 + 12 * Math.sqrt(v[2] / maxYear); },
                itemStyle: { color: palette[0], opacity: 0.9, borderColor: tokens.surface, borderWidth: 1 },
                z: 2
            }],
            // "View as table": one row per author, never the dots' pixels.
            iwacRows: function () {
                return {
                    columns: [
                        { label: P.t('Author'), numeric: false },
                        { label: P.t('References'), numeric: true },
                        { label: P.t('references_lifeline_first'), numeric: true },
                        { label: P.t('references_lifeline_last'), numeric: true }
                    ],
                    rows: authors.map(function (a) { return [a.name, a.count, a.first, a.last]; })
                };
            }
        };
    }

    function hasSubjectTrends(st) {
        return !!(st && st.periods && st.periods.length && st.subjects && st.subjects.length);
    }

    /**
     * Subject × period heatmap. A cell is coloured by its SHARE of the
     * period's dated works, not its count: the bibliography grows tenfold
     * along the axis, so counts would darken every subject's right end and
     * hide a theme that rose and fell. The tooltip carries both numbers.
     */
    function subjectTrendsOption(st) {
        var totals = st.totals || [];
        var counts = {};
        var maxShare = 0;
        var cells = (st.cells || []).map(function (c) {
            var total = totals[c[0]] || 0;
            var share = total ? c[2] / total : 0;
            if (share > maxShare) maxShare = share;
            counts[c[0] + ':' + c[1]] = c[2];
            return [c[0], c[1], share];
        });
        var option = C.heatmapMatrix({ xLabels: st.periods, yLabels: st.subjects, cells: cells }, {
            visualMin: 0,
            visualMax: maxShare || 1,
            cellBorder: true,
            yLabelWidth: 180,
            static: true,
            tooltipFormatter: function (p) {
                var v = p.value || [];
                var total = totals[v[0]] || 0;
                var count = counts[v[0] + ':' + v[1]] || 0;
                return C.itemTooltip(st.subjects[v[1]] || '', [
                    P.escapeHtml(String(st.periods[v[0]] || '')),
                    P.t('references_trend_tooltip', {
                        count: count,
                        total: P.formatNumber(total),
                        pct: total ? Math.round((count / total) * 100) : 0
                    })
                ]);
            }
        });
        if (option.visualMap) {
            [].concat(option.visualMap).forEach(function (vm) {
                vm.formatter = function (value) { return Math.round(Number(value) * 100) + '\u202f%'; };
            });
        }
        option.iwacRows = function () {
            return {
                columns: [{ label: P.t('Subject'), numeric: false }].concat(st.periods.map(function (label, i) {
                    return { label: label + ' (' + P.formatNumber(totals[i] || 0) + ')', numeric: true };
                })),
                rows: st.subjects.map(function (subject, s) {
                    return [subject].concat(st.periods.map(function (_, period) {
                        return counts[period + ':' + s] || 0;
                    }));
                })
            };
        };
        return option;
    }

    var VENUE_KEYS = ['journals', 'books', 'institutions'];
    var VENUE_LABELS = {
        journals:     'references_venue_journals',
        books:        'references_venue_books',
        institutions: 'references_venue_institutions'
    };

    /** Journal titles run long: give them the wider gutter. */
    function venueOption(entries) {
        return C.horizontalBar(entries, { maxLabelLength: 44 });
    }

    function venueKeys(venues) {
        return VENUE_KEYS.filter(function (k) { return venues && venues[k] && venues[k].length; });
    }

    /**
     * Journals, book publishers and degree-granting or research institutions,
     * one ranking at a time. The `publisher` field holds the journal for an
     * article, so a single ranking put "Cahiers d'études africaines" beside
     * "Karthala"; the kind switch keeps the three questions apart.
     */
    function renderVenues(panel, venues) {
        var keys = venueKeys(venues);
        var state = { key: keys[0] };
        if (keys.length > 1 && P.buildFacetButtons) {
            var subFacets = {};
            keys.forEach(function (k) { subFacets[k] = P.t(VENUE_LABELS[k]); });
            var facetBar = P.buildFacetButtons({
                facets: [{ key: 'venue', label: P.t('references_venue_kind'), subFacets: subFacets, renderAs: 'buttons' }],
                activeKey: 'venue',
                onChange: function (evt) {
                    var k = keys.indexOf(evt.subFacet) !== -1 ? evt.subFacet : keys[0];
                    state.key = k;
                    var live = ns.getLiveChart && ns.getLiveChart(panel.chart);
                    if (live) live.setOption(venueOption(venues[k]), true);
                }
            });
            panel.panel.insertBefore(facetBar.root, panel.chart);
        }
        ns.registerChart(panel.chart, function (el, chart) {
            chart.setOption(venueOption(venues[state.key]), true);
        });
    }

    /**
     * The subject co-occurrence graph as an ordered adjacency matrix.
     *
     * A chord of thirty subjects drew thirty arcs and several hundred ribbons
     * through one centre, which nobody could follow. A matrix keeps every pair
     * on its own cell; ordering the rows by the clusters the subjects form
     * (the same Louvain pass the author network uses) turns those clusters
     * into dark blocks along the diagonal, which is the one thing a chord was
     * supposed to show.
     */
    function cooccurrenceMatrix(graph, limit) {
        graph = graph || {};
        var nodes = (graph.nodes || []).slice();
        var edges = graph.edges || [];
        if (nodes.length < 2 || !edges.length) return null;
        nodes.sort(function (a, b) {
            var aScore = (a.strength || 0) || (a.count || 0);
            var bScore = (b.strength || 0) || (b.count || 0);
            return bScore - aScore || (b.count || 0) - (a.count || 0)
                || String(a.id).localeCompare(String(b.id));
        });
        nodes = nodes.slice(0, limit);
        var keep = {};
        nodes.forEach(function (n) { keep[n.id] = n; });
        var kept = edges.filter(function (e) {
            return keep[e.source] && keep[e.target] && e.source !== e.target;
        });
        if (!kept.length) return null;

        var community = P.collaborationCommunities
            ? P.collaborationCommunities(nodes.map(function (n) { return n.id; }), kept)
            : {};
        var order = nodes.map(function (n, i) { return { n: n, i: i }; }).sort(function (a, b) {
            var ca = community[a.n.id] || 0;
            var cb = community[b.n.id] || 0;
            return ca - cb || a.i - b.i;
        }).map(function (o) { return o.n; });
        var index = {};
        order.forEach(function (n, i) { index[n.id] = i; });
        var labels = order.map(function (n) { return n.label || n.name || n.id; });
        var cells = [];
        kept.forEach(function (e) {
            var a = index[e.source];
            var b = index[e.target];
            var w = Number(e.weight || 0);
            cells.push([a, b, w], [b, a, w]);
        });
        return { labels: labels, cells: cells, counts: order.map(function (n) { return n.count || 0; }) };
    }

    function cooccurrenceOption(m) {
        var option = C.heatmapMatrix({ xLabels: m.labels, yLabels: m.labels, cells: m.cells }, {
            cellBorder: true,
            xLabelRotate: 50,
            yLabelWidth: 170,
            static: true,
            tooltipFormatter: function (p) {
                var v = p.value || [];
                return C.itemTooltip(m.labels[v[1]] + ' \u00b7 ' + m.labels[v[0]],
                    [P.t('references_count', { count: v[2] || 0 })]);
            }
        });
        option.xAxis.axisLabel.width = 120;
        option.xAxis.axisLabel.overflow = 'truncate';
        // The panel has a fullscreen control: keep the tooltip in the chart.
        option.tooltip = C._inPanelTooltip(option.tooltip);
        return option;
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

    function buildLayout(container, data, topicModels, coverage, landscape) {
        var summary = data.summary;
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

        // Every panel is named for the embed route (`opts.key`): without a
        // key its permalink is its position, which this layout just changed.
        function panel(key, wide, title, desc) {
            return P.buildPanel('iwac-vis-panel' + (wide ? ' iwac-vis-panel--wide' : ''),
                title, desc, { key: key });
        }

        var timelinePanel   = panel('timeline', true, P.t('References by type over time'), P.t('references.timeline_desc'));
        var typesPanel      = panel('types', false, P.t('Reference types'), P.t('references.types_desc'));
        // Each period panel keeps its old title and wording while the synced
        // data predates it (see the header): the words describe the chart
        // actually drawn.
        var languagesPanel  = hasLanguageTimeline(data.language_timeline)
            ? panel('languages', false, P.t('references_languages_decade_title'), P.t('references_languages_decade_desc'))
            : panel('languages', false, P.t('Languages represented'), P.t('references.languages_desc'));
        var countriesPanel  = panel('countries', false, P.t('Content by country'), P.t('references.countries_desc'));
        // Half width beside the countries: what the works are about vs.
        // where they appeared. The map fits its own bounds, so the narrower
        // frame costs nothing but a zoom step.
        var provenancePanel = panel('provenance', false, P.t('Reference provenance'), P.t('references_provenance_desc'));
        var authorsPanel    = hasLifelines(data.author_lifelines)
            ? panel('authors', true, P.t('references_lifelines_title'),
                P.t('references_lifelines_desc', { count: data.author_lifelines.authors.length }))
            : panel('authors', true, P.t('Top authors'), P.t('references.authors_desc'));
        var networkPanel    = panel('network', true, P.t('Author collaborations'), P.t('references.network_desc'));
        var publishersPanel = venueKeys(data.venues).length
            ? panel('publishers', true, P.t('references_venues_title'), P.t('references_venues_desc'))
            : panel('publishers', true, P.t('Top publishers'), P.t('references.publishers_desc'));
        var subjectsPanel   = hasSubjectTrends(data.subject_trends)
            ? panel('subjects', true, P.t('references_subject_trends_title'), P.t('references_subject_trends_desc'))
            : panel('subjects', true, P.t('Top subjects'), P.t('references.subjects_desc'));
        var subjectCooccurrencePanel = panel('subject-cooccurrence', true,
            P.t('Subject co-occurrence'), P.t('references_subject_matrix_desc', { count: COOCCURRENCE_LIMIT }));
        var coveragePanel   = panel('coverage', true, P.t('Full-text coverage'), coverageDescription(coverage));
        // ONE panel for the topic models, with a language switch: two
        // stacked bar panels read as one long list, and the switch says
        // plainly that these are two models, not two halves of one.
        var topicsPanel = topicModels && topicModels.length
            ? panel('topics', true, P.t('Scholarly topics'), topicDescription(topicModels[0]))
            : null;
        var landscapePanel = panel('landscape', true,
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

        [timelinePanel, typesPanel, languagesPanel, countriesPanel, provenancePanel,
         authorsPanel, networkPanel, publishersPanel,
         subjectsPanel, subjectCooccurrencePanel,
         coveragePanel, topicsPanel, landscapePanel].forEach(function (entry) {
            if (entry) grid.appendChild(entry.panel);
        });

        return {
            timeline:  timelinePanel.chart,
            types:     typesPanel.chart,
            languages: languagesPanel.chart,
            countries: countriesPanel.chart,
            authors:   authorsPanel.chart,
            publishers: publishersPanel.chart,
            publishersPanel: publishersPanel,
            subjects:  subjectsPanel.chart,
            coverage:  coveragePanel,
            coverageChart: coveragePanel.chart,
            topics:    topicsPanel,
            landscape: landscapePanel,
            landscapeChart: landscapePanel.chart,
            provenance: provenancePanel,
            provenanceChart: provenancePanel.chart,
            subjectCooccurrence: subjectCooccurrencePanel,
            subjectCooccurrenceChart: subjectCooccurrencePanel.chart,
            network:   networkPanel
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

        return {
            summary:                data.summary || {},
            timeline:               localizedTimeline,
            types:                  translateEntries(data.types, translateType),
            languages:              translateEntries(data.languages, translateLang),
            countries:              data.countries || [],
            authors:                data.authors || [],
            publishers:             data.publishers || [],
            venues:                 data.venues || null,
            subjects:               data.subjects || [],
            language_timeline:      data.language_timeline || null,
            author_lifelines:       data.author_lifelines || null,
            subject_trends:         data.subject_trends || null,
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
        var h = buildLayout(container, data, topicModels, data.fulltext, landscape);

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

        // 3. Languages — by decade, or the share pie of an older bundle
        if (hasLanguageTimeline(data.language_timeline)) {
            ns.registerChart(h.languages, function (el, chart) {
                chart.setOption(languageTimelineOption(data.language_timeline), true);
            });
        } else if (data.languages.length > 0) {
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

        // 5. Authors — lifelines, or the top-N bar of an older bundle
        if (hasLifelines(data.author_lifelines)) {
            // One row per author: the host grows with them, as the Gantt does.
            h.authors.style.height = C.ganttHeight(data.author_lifelines.authors.length, 320) + 'px';
            ns.registerChart(h.authors, function (el, chart) {
                chart.setOption(lifelinesOption(data.author_lifelines), true);
            });
        } else if (data.authors.length > 0) {
            ns.registerChart(h.authors, function (el, chart) {
                chart.setOption(C.horizontalBar(data.authors));
            });
        }

        // 6. Journals and publishers, or one publisher ranking
        if (venueKeys(data.venues).length) {
            renderVenues(h.publishersPanel, data.venues);
        } else if (data.publishers.length > 0) {
            ns.registerChart(h.publishers, function (el, chart) {
                chart.setOption(C.horizontalBar(data.publishers));
            });
        }

        // 7. Subjects — over time, or the top-N bar of an older bundle
        if (hasSubjectTrends(data.subject_trends)) {
            h.subjects.style.height = C.ganttHeight(data.subject_trends.subjects.length, 320) + 'px';
            ns.registerChart(h.subjects, function (el, chart) {
                chart.setOption(subjectTrendsOption(data.subject_trends), true);
            });
        } else if (data.subjects.length > 0) {
            ns.registerChart(h.subjects, function (el, chart) {
                chart.setOption(C.horizontalBar(data.subjects));
            });
        }

        // 8. Full-text coverage per reference type
        var coverage = data.fulltext;
        if (coverage && coverage.by_type && coverage.by_type.length > 0) {
            ns.registerChart(h.coverageChart, function (el, chart) {
                chart.setOption(coverageOption(coverage.by_type));
            });
        } else {
            h.coverageChart.appendChild(P.buildEmptyState());
            h.coverage.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        }

        // 9. Scholarly topics — one chart per LDA model, behind a switch
        if (h.topics) renderTopics(h.topics, topicModels);

        // 10. Semantic landscape of the embedded references
        renderLandscape(h.landscape, h.landscapeChart, landscape, siteBase);

        // 11. Reference provenance map
        renderProvenanceMap(h.provenance.panel, h.provenanceChart, data.provenance_map, siteBase);

        // 12. Subject co-occurrence — matrix ordered by cluster
        var matrix = cooccurrenceMatrix(data.subject_cooccurrence, COOCCURRENCE_LIMIT);
        if (matrix) {
            h.subjectCooccurrenceChart.style.height = C.ganttHeight(matrix.labels.length, 320) + 140 + 'px';
            var matrixChart = ns.registerChart(h.subjectCooccurrenceChart, function (el, instance) {
                instance.setOption(cooccurrenceOption(matrix), true);
            });
            if (matrixChart && P.addFullscreenButton) {
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

        // 13. Author collaboration network — the shared d3-force renderer
        if (!P.renderCollaborationNetwork || !P.renderCollaborationNetwork(h.network, data.author_collaborations)) {
            h.network.chart.appendChild(P.buildEmptyState());
            h.network.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        }
    }

    P.bootBlock({
        selector:       '.iwac-vis-references-overview',
        warnLabel:      'IWACVis references overview',
        requireECharts: true,
        dataFile:       'references-overview.json',
        render:         render
    });

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

})();
