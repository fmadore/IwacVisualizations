/**
 * IWAC Visualizations — Scary Terms block (orchestrator)
 *
 * Self-contained controller for the Scary Terms page block. Fetches the
 * precomputed JSON files in `files/iwac-visualizations/`, builds the DOM
 * (metric cards + controls + chart/map + term definitions), and drives
 * the view modes:
 *
 *   - race      animated year-by-year "bar chart race" (1961–2025)
 *   - trends    per-family time series with historical-event annotations
 *   - country   top families for a single selected country
 *   - global    top families across the whole collection
 *   - matrix    term × term co-occurrence heatmap
 *   - wordcloud vocabulary of matching articles (echarts-wordcloud)
 *   - map       MapLibre bubble map of tagged places (lazy data fetch)
 *
 * Term family colors come from the registered IWAC ECharts palette so
 * dark / light modes + admin-configured primary colors flow through.
 *
 * Data fetch strategy: the four original bundles + the small trends /
 * events sidecars load up front (missing files resolve to null so the
 * block degrades gracefully on deploys whose data predates them); the
 * heavier wordcloud / places bundles are fetched only when their view
 * first activates.
 *
 * Dependencies (in load order before this file):
 *   echarts → echarts-wordcloud → maplibre-gl → iwac-i18n.js →
 *   iwac-theme.js → dashboard-core.js → panels.js → responsive.js →
 *   chart-options.js → facet-buttons.js → maplibre.js → map-popup.js →
 *   scary-terms/{i18n,helpers,trends,wordcloud,map}.js
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis.scaryTerms: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    // Stateless builders + i18n strings live in companion files
    // (scary-terms/helpers.js, i18n.js, trends.js, wordcloud.js, map.js),
    // loaded before this orchestrator. Alias the builders locally so the
    // call sites below read exactly as they did before the split.
    var SH = ns.scaryTerms || {};
    var buildTermColorMap = SH.buildTermColorMap;
    var buildMetricCards = SH.buildMetricCards;
    var buildTermDefinitions = SH.buildTermDefinitions;
    var buildCumulativeSnapshots = SH.buildCumulativeSnapshots;

    var DATA_FILES = {
        metadata:     'scary-terms-metadata.json',
        temporal:     'scary-terms-temporal.json',
        countries:    'scary-terms-countries.json',
        global:       'scary-terms-global.json',
        cooccurrence: 'scary-terms-cooccurrence.json',
        trends:       'scary-terms-trends.json',
        events:       'scary-terms-events.json',
        wordcloud:    'scary-terms-wordcloud.json',
        places:       'scary-terms-places.json'
    };

    var TOP_N = 10;
    var RACE_TICK_MS = 1000;


    // ---------------------------------------------------------------------
    //  Boot
    // ---------------------------------------------------------------------

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis.scaryTerms: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-scary');
        for (var i = 0; i < containers.length; i++) {
            initBlock(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ---------------------------------------------------------------------
    //  Per-block initialization
    // ---------------------------------------------------------------------

    function initBlock(container) {
        var basePath = container.dataset.basePath || '';
        var dataBase = basePath + '/files/iwac-visualizations/';

        function optional(name) {
            // Optional bundles — older deploys may not have them yet.
            // Fall back to null so the orchestrator degrades the view.
            return fetchJSON(dataBase + DATA_FILES[name]).catch(function () { return null; });
        }

        Promise.all([
            fetchJSON(dataBase + DATA_FILES.metadata),
            fetchJSON(dataBase + DATA_FILES.temporal),
            fetchJSON(dataBase + DATA_FILES.countries),
            fetchJSON(dataBase + DATA_FILES.global),
            optional('cooccurrence'),
            optional('trends'),
            optional('events')
        ]).then(function (results) {
            render(container, {
                metadata:     results[0],
                temporal:     results[1],
                countries:    results[2],
                global:       results[3],
                cooccurrence: results[4],
                trends:       results[5],
                events:       results[6]
            }, dataBase);
        }).catch(function (err) {
            console.error('IWACVis.scaryTerms:', err);
            container.innerHTML = '';
            container.appendChild(P.buildFetchErrorState(err));
        });
    }

    // Delegates to the shared helper (same-origin credentials + `?v=`
    // cache-busting come from P.fetchJSON since v1.3.0).
    function fetchJSON(url) {
        return P.fetchJSON(url);
    }

    // ---------------------------------------------------------------------
    //  Layout
    // ---------------------------------------------------------------------

    function render(container, bundle, dataBase) {
        var metadata     = bundle.metadata     || {};
        var temporal     = bundle.temporal     || {};
        var countries    = bundle.countries    || {};
        var globalData   = bundle.global       || {};
        var cooccurrence = bundle.cooccurrence || null;
        var trendsData   = bundle.trends       || null;
        var eventsData   = bundle.events       || null;

        var families = metadata.term_families || [];
        var termColors = buildTermColorMap(families);

        var years = [];
        if (metadata.year_range && metadata.year_range.length === 2) {
            for (var y = metadata.year_range[0]; y <= metadata.year_range[1]; y++) {
                years.push(y);
            }
        }
        var availableCountries = (metadata.countries || []).slice();

        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-scary-root');
        container.appendChild(root);

        // 1. Header
        var header = P.el('div', 'iwac-vis-scary-header');
        header.appendChild(P.el('h3', 'iwac-vis-scary-title', P.t('scary.title')));
        header.appendChild(P.el('p', 'iwac-vis-scary-desc', P.t('scary.description')));
        root.appendChild(header);

        // 2. Metric cards
        root.appendChild(buildMetricCards(metadata, globalData));

        // 3. Controls
        var controlsEl = P.el('div', 'iwac-vis-scary-controls');
        root.appendChild(controlsEl);

        // 4. Chart panel — ECharts host + MapLibre host (map view only)
        //    + the per-view <details> fallback host.
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-scary-panel');
        var chartHeader = P.el('div', 'iwac-vis-scary-chart-header');
        var chartTitle = P.el('h4', 'iwac-vis-scary-chart-title');
        var topBadge   = P.el('span', 'iwac-vis-scary-badge');
        chartHeader.appendChild(chartTitle);
        chartHeader.appendChild(topBadge);
        panel.appendChild(chartHeader);
        var chartEl = P.el('div', 'iwac-vis-chart iwac-vis-scary-chart');
        panel.appendChild(chartEl);
        var mapEl = P.el('div', 'iwac-vis-map iwac-vis-scary-map');
        mapEl.setAttribute('aria-label', P.t('scary.map_chart_title'));
        panel.appendChild(mapEl);
        var detailsHost = P.el('div', 'iwac-vis-scary-details-host');
        panel.appendChild(detailsHost);
        root.appendChild(panel);

        // 5. Term definitions
        root.appendChild(buildTermDefinitions(metadata));

        // Pre-compute one cumulative snapshot per year. The bar chart race
        // shows running totals (matching the iwac-dashboard semantics), so
        // bars grow monotonically as the race advances — they never shrink.
        // The x-axis intentionally adapts per frame: pinning it to the final
        // total made every early year render as a sliver against a ~4500-
        // wide scale, which was the user's top complaint.
        var cumulativeByYearIdx = buildCumulativeSnapshots(temporal, years);

        var matrixCountries = cooccurrence && cooccurrence.countries
            ? Object.keys(cooccurrence.countries).sort()
            : [];
        var trendsCountries = trendsData && trendsData.by_country
            ? Object.keys(trendsData.by_country).sort()
            : [];

        var state = {
            view: 'race',
            country: availableCountries[0] || null,
            matrixCountry: null,   // null = global; otherwise one of matrixCountries
            trendsCountry: null,   // null = global
            showEvents: true,
            wcFacet: 'global',
            wcSub: null,
            mapFamily: '',         // '' = all families
            mapCountry: '',        // '' = all countries (article country)
            yearIdx: 0,
            isPlaying: false,
            timer: null
        };

        // Lazy bundles: undefined = not requested, null = failed / absent,
        // object = loaded. Fetch flags stop duplicate requests.
        var wordcloudData;
        var placesData;
        var wordcloudRequested = false;
        var placesRequested = false;
        var mapController = null;
        var mapCountries = [];

        // Holds the CURRENT ECharts instance. dashboard-core re-runs this
        // render callback with a fresh instance on every theme swap
        // (dispose + reinit), so we must capture the new instance here
        // rather than closing over the initial return value — otherwise
        // draw() keeps calling setOption on a disposed chart after the
        // first light/dark toggle and the chart goes blank.
        var currentInstance = null;
        ns.registerChart(chartEl, function (el, instance) {
            currentInstance = instance;
            draw();
        });

        function draw() {
            if (!currentInstance || currentInstance.isDisposed()) return;
            // Toggle view-specific modifier classes on the panel so CSS
            // can bump the chart min-height for dense views (the 12×12
            // matrix) and swap the ECharts host for the MapLibre host.
            panel.classList.toggle('iwac-vis-scary-panel--matrix', state.view === 'matrix');
            panel.classList.toggle('iwac-vis-scary-panel--map', state.view === 'map');
            currentInstance.hideLoading();
            detailsHost.innerHTML = '';

            var option = null;
            if (state.view === 'race') {
                var year = years[state.yearIdx];
                var yearData = (cumulativeByYearIdx[state.yearIdx] || []).slice(0, TOP_N);
                option = C.scaryTerms({
                    entries: yearData,
                    termColors: termColors
                });
                chartTitle.textContent = P.t('scary.chart_title') + ' — ' + year;
                topBadge.textContent = yearData[0]
                    ? P.t('scary.top_term') + ': ' + yearData[0][0]
                    : '';
            } else if (state.view === 'country') {
                var c = state.country;
                var cData = ((countries[c] || {}).data || []);
                option = C.scaryTerms({
                    entries: cData,
                    termColors: termColors
                });
                chartTitle.textContent = P.t('scary.country_chart_title', { country: c || '' });
                topBadge.textContent = cData[0]
                    ? P.t('scary.top_term') + ': ' + cData[0][0]
                    : '';
            } else if (state.view === 'matrix') {
                var slice = resolveMatrixSlice();
                option = buildMatrixOption(slice);
                var matrixCountry = state.matrixCountry;
                chartTitle.textContent = matrixCountry
                    ? P.t('scary.matrix_country_chart_title', { country: matrixCountry })
                    : P.t('scary.matrix_chart_title');
                topBadge.textContent = slice && slice.total_articles
                    ? P.t('scary.matrix_articles', { count: P.formatNumber(slice.total_articles) })
                    : '';
            } else if (state.view === 'trends') {
                option = drawTrends();
            } else if (state.view === 'wordcloud') {
                option = drawWordcloud();
            } else if (state.view === 'map') {
                drawMap();
                chartTitle.textContent = P.t('scary.map_chart_title');
                topBadge.textContent = '';
            } else {
                var gData = globalData.data || [];
                option = C.scaryTerms({
                    entries: gData,
                    termColors: termColors
                });
                chartTitle.textContent = P.t('scary.global_chart_title');
                topBadge.textContent = gData[0]
                    ? P.t('scary.top_term') + ': ' + gData[0][0]
                    : '';
            }
            if (option) currentInstance.setOption(option, { notMerge: true, lazyUpdate: true });
        }

        // -----------------------------------------------------------------
        //  Trends view (issue #2)
        //
        //  Line chart per family. Global series derive from the trends
        //  bundle when present, else from the temporal bundle (so the view
        //  works on deploys whose data predates scary-terms-trends.json —
        //  minus the per-country scope). Event annotations come from the
        //  hand-curated events sidecar.
        // -----------------------------------------------------------------

        function resolveTrendsSeries() {
            if (trendsData && trendsData.years && trendsData.years.length) {
                var series = state.trendsCountry
                    ? (trendsData.by_country || {})[state.trendsCountry]
                    : trendsData.global;
                return {
                    years: trendsData.years,
                    families: trendsData.families || families,
                    series: series || {}
                };
            }
            return {
                years: years,
                families: families,
                series: SH.buildTrendsSeriesFromTemporal(temporal, years, families)
            };
        }

        function drawTrends() {
            var tr = resolveTrendsSeries();
            chartTitle.textContent = state.trendsCountry
                ? P.t('scary.trends_country_chart_title', { country: state.trendsCountry })
                : P.t('scary.trends_chart_title');
            topBadge.textContent = '';
            if (eventsData) {
                var details = SH.buildEventsDetails(eventsData, state.trendsCountry);
                if (details) detailsHost.appendChild(details);
            }
            return SH.buildTrendsOption({
                years: tr.years,
                families: tr.families,
                series: tr.series,
                termColors: termColors,
                events: eventsData,
                showEvents: state.showEvents,
                country: state.trendsCountry,
                compact: chartEl.clientWidth > 0 && chartEl.clientWidth < 640
            });
        }

        // -----------------------------------------------------------------
        //  Word cloud view (issue #4) — lazy bundle
        // -----------------------------------------------------------------

        function loadWordcloud() {
            if (wordcloudRequested) return;
            wordcloudRequested = true;
            if (currentInstance && !currentInstance.isDisposed()) {
                currentInstance.showLoading();
            }
            fetchJSON(dataBase + DATA_FILES.wordcloud)
                .then(function (d) { wordcloudData = d; })
                .catch(function (err) {
                    console.warn('IWACVis.scaryTerms: wordcloud bundle unavailable', err);
                    wordcloudData = null;
                })
                .then(function () {
                    if (state.view === 'wordcloud') {
                        renderControls();
                        draw();
                    }
                });
        }

        function drawWordcloud() {
            chartTitle.textContent = P.t('scary.wordcloud_chart_title');
            if (wordcloudData === undefined) {
                topBadge.textContent = '';
                loadWordcloud();
                if (currentInstance && !currentInstance.isDisposed()
                    && wordcloudData === undefined) {
                    currentInstance.showLoading();
                }
                return null;
            }
            if (wordcloudData === null) {
                topBadge.textContent = '';
                return P.emptyChartOption('Visualization data is not available yet.');
            }
            var slice = SH.wordcloudSlice(wordcloudData, state.wcFacet, state.wcSub);
            topBadge.textContent = slice.total_articles
                ? P.t('scary.matrix_articles', { count: P.formatNumber(slice.total_articles) })
                : '';
            if (!slice.data || !slice.data.length) {
                return P.emptyChartOption();
            }
            var details = SH.buildWordListDetails(slice);
            if (details) detailsHost.appendChild(details);
            return C.wordcloud(slice.data);
        }

        // -----------------------------------------------------------------
        //  Map view (issue #3) — lazy bundle + persistent MapLibre instance
        // -----------------------------------------------------------------

        function mapFilter() {
            return {
                family: state.mapFamily || null,
                country: state.mapCountry || null
            };
        }

        function loadPlaces() {
            if (placesRequested) return;
            placesRequested = true;
            mapEl.innerHTML = '';
            mapEl.appendChild(P.buildLoadingState());
            fetchJSON(dataBase + DATA_FILES.places)
                .then(function (d) { placesData = d; })
                .catch(function (err) {
                    console.warn('IWACVis.scaryTerms: places bundle unavailable', err);
                    placesData = null;
                })
                .then(function () {
                    if (placesData) {
                        var seen = {};
                        (placesData.places || []).forEach(function (p) {
                            Object.keys(p.by_country || {}).forEach(function (cc) {
                                seen[cc] = true;
                            });
                        });
                        mapCountries = Object.keys(seen).sort();
                    }
                    if (state.view === 'map') {
                        renderControls();
                        draw();
                    }
                });
        }

        function drawMap() {
            if (placesData === undefined) {
                loadPlaces();
                return;
            }
            if (placesData === null) {
                mapEl.innerHTML = '';
                mapEl.appendChild(P.buildNoDataState());
                return;
            }
            if (!mapController) {
                mapEl.innerHTML = '';
                mapController = SH.createScaryMap(mapEl, placesData, {
                    getFilter: mapFilter,
                    termColors: termColors,
                    siteBase: container.dataset.siteBase
                        || container.dataset.embedBase || ''
                });
                if (!mapController) {
                    mapEl.appendChild(P.buildErrorState());
                    return;
                }
            } else {
                mapController.update();
            }
            // The container was display:none until this view activated —
            // MapLibre needs an explicit resize to fill it.
            window.setTimeout(function () {
                if (mapController) mapController.resize();
            }, 0);
            var details = SH.buildPlacesDetails(placesData, mapFilter());
            if (details) detailsHost.appendChild(details);
        }

        // -----------------------------------------------------------------
        //  Co-occurrence matrix
        //
        //  ECharts heatmap with category × category axes. Data is the
        //  precomputed term × term matrix keyed by the canonical term
        //  order from metadata.term_families. Uses the IWAC palette
        //  primary + surface tokens for the color ramp so light / dark
        //  theme swaps track automatically via dashboard-core's
        //  dispose+reinit path (the registerChart callback wraps draw()).
        // -----------------------------------------------------------------

        function resolveMatrixSlice() {
            if (!cooccurrence) return null;
            if (state.matrixCountry && cooccurrence.countries
                && cooccurrence.countries[state.matrixCountry]) {
                return cooccurrence.countries[state.matrixCountry];
            }
            return cooccurrence.global || null;
        }

        function buildMatrixOption(slice) {
            // Resolve every color through CSS custom properties so the
            // matrix tracks the IWAC theme's --primary / --surface /
            // --ink / --muted tokens on light/dark swap. Fallbacks are
            // only consulted when the theme isn't installed. Never
            // hardcode hex values in chart code.
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            var primaryResolved = (ns.resolveCssVar && ns.resolveCssVar('--primary'))
                || tokens.primary || '#e64a19';
            var surfaceResolved = (ns.resolveCssVar && ns.resolveCssVar('--surface-raised'))
                || tokens.surfaceRaised || tokens.surface || '#fafaf9';
            var inkResolved = (ns.resolveCssVar && ns.resolveCssVar('--ink'))
                || tokens.ink || '#2c2f37';
            var mutedResolved = (ns.resolveCssVar && ns.resolveCssVar('--muted'))
                || tokens.muted || '#767880';
            var borderResolved = (ns.resolveCssVar && ns.resolveCssVar('--border'))
                || tokens.border || '#d4d6da';

            if (!cooccurrence || !slice) {
                return {
                    graphic: [{
                        type: 'text',
                        left: 'center',
                        top: 'middle',
                        style: {
                            text: P.t('scary.matrix_empty'),
                            fill: mutedResolved,
                            font: '14px ' + (tokens.fontFamily ||
                                '"Public Sans", system-ui, -apple-system, sans-serif')
                        }
                    }]
                };
            }
            var terms = (cooccurrence.terms || []).slice();
            var matrix = slice.matrix || [];
            var maxVal = Math.max(1, slice.max_cooccurrence || 1);

            // Flatten to [xIdx, yIdx, value] triples. The diagonal is
            // left as 0 because self-co-occurrence is meaningless —
            // the tooltip covers the per-term totals via term_counts.
            var data = [];
            for (var i = 0; i < terms.length; i++) {
                for (var j = 0; j < terms.length; j++) {
                    if (i === j) continue;
                    var v = (matrix[i] && matrix[i][j]) || 0;
                    data.push([i, j, v]);
                }
            }

            return {
                tooltip: {
                    trigger: 'item',
                    formatter: function (p) {
                        var x = terms[p.value[0]];
                        var y = terms[p.value[1]];
                        var count = p.value[2];
                        return P.t('scary.matrix_pair_tooltip', {
                            a: x,
                            b: y,
                            count: P.formatNumber(count || 0)
                        });
                    }
                },
                grid: {
                    left: 120,
                    right: 24,
                    top: 30,
                    bottom: 70,
                    containLabel: true
                },
                xAxis: {
                    type: 'category',
                    data: terms,
                    axisLabel: {
                        rotate: 45,
                        interval: 0,
                        color: mutedResolved
                    },
                    axisLine:  { lineStyle: { color: borderResolved } },
                    splitArea: { show: false },
                    axisTick:  { show: false }
                },
                yAxis: {
                    type: 'category',
                    data: terms.slice(),
                    inverse: true,
                    axisLabel: { interval: 0, color: mutedResolved },
                    axisLine:  { lineStyle: { color: borderResolved } },
                    splitArea: { show: false },
                    axisTick:  { show: false }
                },
                visualMap: {
                    min: 0,
                    max: maxVal,
                    calculable: true,
                    orient: 'horizontal',
                    left: 'center',
                    bottom: 4,
                    itemWidth: 14,
                    itemHeight: 140,
                    textStyle: { color: mutedResolved },
                    inRange: {
                        color: [surfaceResolved, primaryResolved]
                    }
                },
                series: [{
                    type: 'heatmap',
                    data: data,
                    label: {
                        show: true,
                        formatter: function (p) {
                            var v = p.value[2];
                            return v > 0 ? v : '';
                        },
                        color: inkResolved,
                        fontSize: 11
                    },
                    itemStyle: { borderColor: surfaceResolved, borderWidth: 1 },
                    emphasis: {
                        itemStyle: {
                            borderColor: primaryResolved,
                            borderWidth: 2
                        }
                    },
                    progressive: 0,
                    animation: false
                }]
            };
        }

        // -----------------------------------------------------------------
        //  Controls rendering
        //
        //  Re-renders the controls row whenever the view mode changes so
        //  the country dropdown / playback bar / slider / facet bar appear
        //  only for the relevant view. The chart itself is not
        //  reinitialized.
        // -----------------------------------------------------------------

        function renderControls() {
            controlsEl.innerHTML = '';
            var row = P.el('div', 'iwac-vis-scary-controls-row');
            controlsEl.appendChild(row);

            row.appendChild(buildViewToggle());

            if (state.view === 'country' && availableCountries.length) {
                row.appendChild(buildCountrySelect());
            }
            if (state.view === 'matrix' && matrixCountries.length) {
                row.appendChild(buildMatrixCountrySelect());
            }
            if (state.view === 'matrix') {
                controlsEl.appendChild(buildViewDesc('scary.matrix_description'));
            }
            if (state.view === 'trends') {
                if (trendsCountries.length) {
                    row.appendChild(buildSelectGroup(
                        P.t('scary.country'),
                        [{ value: '', label: P.t('scary.all_countries') }].concat(
                            trendsCountries.map(function (cc) {
                                return { value: cc, label: cc };
                            })),
                        state.trendsCountry || '',
                        function (value) {
                            state.trendsCountry = value || null;
                            draw();
                        }
                    ));
                }
                if (eventsData) {
                    row.appendChild(buildEventsToggle());
                }
                controlsEl.appendChild(buildViewDesc('scary.trends_description'));
            }
            if (state.view === 'wordcloud') {
                controlsEl.appendChild(buildViewDesc('scary.wordcloud_description'));
                if (wordcloudData && P.buildFacetButtons) {
                    var facetBar = P.buildFacetButtons({
                        facets: SH.buildWordcloudFacets(wordcloudData),
                        activeKey: state.wcFacet,
                        onChange: function (evt) {
                            state.wcFacet = evt.facet;
                            state.wcSub = evt.subFacet || null;
                            draw();
                        }
                    });
                    controlsEl.appendChild(facetBar.root);
                }
            }
            if (state.view === 'map') {
                if (placesData) {
                    // Family and country filters are mutually exclusive —
                    // the bundle has per-family and per-country splits,
                    // not their cross product. Selecting one resets the
                    // other.
                    row.appendChild(buildSelectGroup(
                        P.t('scary.map_family'),
                        [{ value: '', label: P.t('scary.all_families') }].concat(
                            families.map(function (f) {
                                return { value: f, label: f };
                            })),
                        state.mapFamily,
                        function (value) {
                            state.mapFamily = value;
                            if (value) state.mapCountry = '';
                            renderControls();
                            draw();
                        }
                    ));
                    if (mapCountries.length) {
                        row.appendChild(buildSelectGroup(
                            P.t('scary.country'),
                            [{ value: '', label: P.t('scary.all_countries') }].concat(
                                mapCountries.map(function (cc) {
                                    return { value: cc, label: cc };
                                })),
                            state.mapCountry,
                            function (value) {
                                state.mapCountry = value;
                                if (value) state.mapFamily = '';
                                renderControls();
                                draw();
                            }
                        ));
                    }
                }
                controlsEl.appendChild(buildViewDesc('scary.map_description'));
            }
            if (state.view === 'race' && years.length) {
                row.appendChild(buildPlaybackGroup());
                controlsEl.appendChild(buildSliderRow());
            }
        }

        function buildViewDesc(key) {
            return P.el('p', 'iwac-vis-scary-matrix-desc', P.t(key));
        }

        function buildViewToggle() {
            var group = P.el('div', 'iwac-vis-scary-view-toggle');
            group.appendChild(P.el('span', 'iwac-vis-scary-label', P.t('scary.view_mode') + ':'));
            var views = [
                { key: 'race',    label: P.t('scary.bar_race') },
                { key: 'trends',  label: P.t('scary.trends') },
                { key: 'country', label: P.t('scary.by_country') },
                { key: 'global',  label: P.t('scary.global_view') }
            ];
            // The matrix view is only offered when the cooccurrence
            // bundle is present — older deploys won't have it yet. The
            // wordcloud / map views fetch lazily and show the shared
            // "no data yet" state when their bundle is missing.
            if (cooccurrence) {
                views.push({ key: 'matrix', label: P.t('scary.matrix') });
            }
            views.push({ key: 'wordcloud', label: P.t('scary.wordcloud') });
            views.push({ key: 'map', label: P.t('scary.map') });
            views.forEach(function (v) {
                var btn = P.el('button', 'iwac-vis-scary-view-btn', v.label);
                btn.type = 'button';
                if (state.view === v.key) {
                    btn.classList.add('iwac-vis-scary-view-btn--active');
                }
                btn.addEventListener('click', function () {
                    if (state.view === v.key) return;
                    pauseTimer();
                    state.view = v.key;
                    if (v.key === 'country' && !state.country && availableCountries.length) {
                        state.country = availableCountries[0];
                    }
                    renderControls();
                    draw();
                });
                group.appendChild(btn);
            });
            return group;
        }

        /**
         * Generic labelled <select> control — used by the trends country
         * scope and the map view's family / country filters.
         *
         * @param {string} labelText already-translated label
         * @param {Array<{value: string, label: string}>} options
         * @param {string} current   currently-selected value
         * @param {function(string)} onChange
         */
        function buildSelectGroup(labelText, options, current, onChange) {
            var group = P.el('div', 'iwac-vis-scary-country-group');
            var label = P.el('label', 'iwac-vis-scary-label', labelText + ':');
            var select = P.el('select', 'iwac-vis-scary-select');
            var selectId = 'iwac-vis-scary-sel-' + Math.random().toString(36).slice(2, 8);
            select.id = selectId;
            label.htmlFor = selectId;
            options.forEach(function (o) {
                var opt = P.el('option', null, o.label);
                opt.value = o.value;
                if (o.value === current) opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener('change', function () {
                onChange(select.value);
            });
            group.appendChild(label);
            group.appendChild(select);
            return group;
        }

        function buildEventsToggle() {
            var label = P.el('label', 'iwac-vis-scary-check');
            var cb = P.el('input');
            cb.type = 'checkbox';
            cb.checked = state.showEvents;
            cb.addEventListener('change', function () {
                state.showEvents = cb.checked;
                draw();
            });
            label.appendChild(cb);
            label.appendChild(P.el('span', null, P.t('scary.show_events')));
            return label;
        }

        function buildCountrySelect() {
            var group = P.el('div', 'iwac-vis-scary-country-group');
            var label = P.el('label', 'iwac-vis-scary-label', P.t('scary.country') + ':');
            var select = P.el('select', 'iwac-vis-scary-select');
            var selectId = 'iwac-vis-scary-country-' + Math.random().toString(36).slice(2, 8);
            select.id = selectId;
            label.htmlFor = selectId;
            availableCountries.forEach(function (c) {
                var opt = P.el('option', null, c);
                opt.value = c;
                if (c === state.country) opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener('change', function () {
                state.country = select.value;
                draw();
            });
            group.appendChild(label);
            group.appendChild(select);
            return group;
        }

        function buildMatrixCountrySelect() {
            // Separate from buildCountrySelect so the two views keep
            // independent selections (the matrix has an "All countries"
            // choice and a different available-country list — only
            // slices with enough data are emitted).
            var group = P.el('div', 'iwac-vis-scary-country-group');
            var label = P.el('label', 'iwac-vis-scary-label', P.t('scary.country') + ':');
            var select = P.el('select', 'iwac-vis-scary-select');
            var selectId = 'iwac-vis-scary-matrix-country-' + Math.random().toString(36).slice(2, 8);
            select.id = selectId;
            label.htmlFor = selectId;

            var allOpt = P.el('option', null, P.t('scary.all_countries'));
            allOpt.value = '';
            if (!state.matrixCountry) allOpt.selected = true;
            select.appendChild(allOpt);

            matrixCountries.forEach(function (c) {
                var opt = P.el('option', null, c);
                opt.value = c;
                if (c === state.matrixCountry) opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener('change', function () {
                state.matrixCountry = select.value || null;
                draw();
            });
            group.appendChild(label);
            group.appendChild(select);
            return group;
        }

        function buildPlaybackGroup() {
            var group = P.el('div', 'iwac-vis-scary-playback');
            group.appendChild(ctrlButton('◀', P.t('scary.previous'), stepBackward));
            var isAtEnd = state.yearIdx >= years.length - 1;
            var playBtn = ctrlButton(
                state.isPlaying ? '⏸' : '▶',
                state.isPlaying ? P.t('scary.pause') : P.t('scary.play'),
                state.isPlaying ? pause : play
            );
            playBtn.classList.add('iwac-vis-scary-play-btn');
            if (isAtEnd && !state.isPlaying) {
                // Allow pressing play at the end — it will rewind.
            }
            group.appendChild(playBtn);
            group.appendChild(ctrlButton('▶', P.t('scary.next'), stepForward));
            group.appendChild(ctrlButton('↺', P.t('scary.reset'), reset));
            var yearLabel = P.el('span', 'iwac-vis-scary-year-label',
                                 String(years[state.yearIdx] || ''));
            group.appendChild(yearLabel);
            return group;
        }

        function buildSliderRow() {
            var sliderRow = P.el('div', 'iwac-vis-scary-slider-row');
            sliderRow.appendChild(P.el('span', 'iwac-vis-scary-slider-edge',
                                       String(years[0])));
            var slider = P.el('input', 'iwac-vis-scary-slider');
            slider.type = 'range';
            slider.min = '0';
            slider.max = String(years.length - 1);
            slider.value = String(state.yearIdx);
            slider.step = '1';
            slider.setAttribute('aria-label', P.t('Year'));
            syncSliderFill(slider);
            slider.addEventListener('input', function () {
                pauseTimer();
                state.isPlaying = false;
                state.yearIdx = parseInt(slider.value, 10) || 0;
                syncSliderFill(slider);
                // Reach into the sibling year label without re-rendering
                // the whole controls block (cheaper; avoids slider focus loss).
                var yearLabel = controlsEl.querySelector('.iwac-vis-scary-year-label');
                if (yearLabel) yearLabel.textContent = String(years[state.yearIdx]);
                draw();
            });
            sliderRow.appendChild(slider);
            sliderRow.appendChild(P.el('span', 'iwac-vis-scary-slider-edge',
                                       String(years[years.length - 1])));
            return sliderRow;
        }

        /**
         * Paint the left-side progress fill of a range input by writing
         * the ``--iwac-vis-scary-fill`` CSS variable. Called on slider
         * build, on user input, and on every playback tick so the
         * gradient stops match the current yearIdx.
         */
        function syncSliderFill(slider) {
            var max = parseFloat(slider.max) || 1;
            var val = parseFloat(slider.value) || 0;
            var pct = max > 0 ? (val / max) * 100 : 0;
            slider.style.setProperty('--iwac-vis-scary-fill', pct + '%');
        }

        function ctrlButton(glyph, title, handler) {
            var btn = P.el('button', 'iwac-vis-scary-ctrl-btn', glyph);
            btn.type = 'button';
            btn.title = title;
            btn.setAttribute('aria-label', title);
            btn.addEventListener('click', handler);
            return btn;
        }

        // -----------------------------------------------------------------
        //  Playback
        // -----------------------------------------------------------------

        function pauseTimer() {
            if (state.timer) {
                window.clearInterval(state.timer);
                state.timer = null;
            }
        }

        function play() {
            if (state.view !== 'race' || !years.length) return;
            if (state.yearIdx >= years.length - 1) state.yearIdx = 0;
            state.isPlaying = true;
            pauseTimer();
            state.timer = window.setInterval(function () {
                if (state.yearIdx >= years.length - 1) {
                    pause();
                    return;
                }
                state.yearIdx++;
                syncSliderPosition();
                draw();
            }, RACE_TICK_MS);
            renderControls();
            draw();
        }

        function pause() {
            pauseTimer();
            state.isPlaying = false;
            renderControls();
        }

        function stepBackward() {
            pauseTimer();
            state.isPlaying = false;
            if (state.yearIdx > 0) state.yearIdx--;
            renderControls();
            draw();
        }

        function stepForward() {
            pauseTimer();
            state.isPlaying = false;
            if (state.yearIdx < years.length - 1) state.yearIdx++;
            renderControls();
            draw();
        }

        function reset() {
            pauseTimer();
            state.isPlaying = false;
            state.yearIdx = 0;
            renderControls();
            draw();
        }

        function syncSliderPosition() {
            var slider = controlsEl.querySelector('.iwac-vis-scary-slider');
            if (slider) {
                slider.value = String(state.yearIdx);
                syncSliderFill(slider);
            }
            var yearLabel = controlsEl.querySelector('.iwac-vis-scary-year-label');
            if (yearLabel) yearLabel.textContent = String(years[state.yearIdx]);
        }

        // Initial paint
        renderControls();
        draw();
    }

})();
