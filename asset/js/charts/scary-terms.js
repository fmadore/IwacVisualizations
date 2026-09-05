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
 *   scary-terms/{i18n,helpers,trends,wordcloud,map,controls}.js
 *
 * State lives in one P.createStore; the controls row patches it and the
 * subscriptions at the foot of render() turn a change into a remount, a
 * sync or a redraw. View, country and race year are URL-addressable
 * (`?scary.view=…`) through P.bindUrlState.
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

    P.bootBlock({
        selector:       '.iwac-vis-scary',
        warnLabel:      'IWACVis.scaryTerms',
        requireECharts: true,
        // Four required bundles plus three optional ones — older deploys may
        // not carry the latter, so they resolve to null and the orchestrator
        // degrades the corresponding views.
        load:           function (ctx) {
            function optional(name) {
                return P.fetchJSON(ctx.dataBase + DATA_FILES[name])
                    .catch(function () { return null; });
            }
            return Promise.all([
                P.fetchJSON(ctx.dataBase + DATA_FILES.metadata),
                P.fetchJSON(ctx.dataBase + DATA_FILES.temporal),
                P.fetchJSON(ctx.dataBase + DATA_FILES.countries),
                P.fetchJSON(ctx.dataBase + DATA_FILES.global),
                optional('cooccurrence'),
                optional('trends'),
                optional('events')
            ]);
        },
        render:         function (container, results, ctx) {
            render(container, {
                metadata:     results[0],
                temporal:     results[1],
                countries:    results[2],
                global:       results[3],
                cooccurrence: results[4],
                trends:       results[5],
                events:       results[6]
            }, ctx.dataBase);
        }
    });

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
        var header = P.el('div', 'iwac-vis-block-header iwac-vis-scary-header');
        header.appendChild(P.el('h3', 'iwac-vis-block-header__title', P.t('scary.title')));
        header.appendChild(P.el('p', 'iwac-vis-block-header__desc', P.t('scary.description')));
        // Reciprocal of the link the Laïcité block's `concurrence` frame
        // card carries. These bundles are anonymous aggregates with no
        // o:id, so this block cannot say in WHICH items intégrisme and
        // laïcité co-occur — the Laïcité generator re-counts the same
        // three word families per item precisely so that question has an
        // answer somewhere. Without a path between the two blocks that
        // answer sits in a place no reader of this one would find.
        var toLaicite = ns.embed && ns.embed.crossBlockLink
            ? ns.embed.crossBlockLink('laicite', P.t('scary.cross_laicite'))
            : null;
        if (toLaicite) header.appendChild(toLaicite);
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
            isPlaying: false
        };

        // One store over that object. Controls patch it; the subscriptions
        // at the foot of this function decide what a change means: a new
        // view remounts the controls row, anything else syncs the widgets
        // in place and redraws. The cross-field rule the map selects used
        // to apply inside their own handlers lives here instead.
        var store = P.createStore(state, {
            reduce: function (st, changed) {
                var extra = {};
                if (changed.indexOf('mapFamily') !== -1 && st.mapFamily) extra.mapCountry = '';
                if (changed.indexOf('mapCountry') !== -1 && st.mapCountry) extra.mapFamily = '';
                return extra;
            }
        });

        // The view, the country and the race year are addressable:
        // `?scary.view=trends&scary.country=Togo`. Defaults are omitted, the
        // address bar is replaced (no history entry per click), and inside
        // an embed frame the same code runs against the frame's own URL.
        var viewKeys = SH.viewOptions({ hasCooccurrence: !!cooccurrence })
            .map(function (v) { return v.key; });
        var url = P.bindUrlState ? P.bindUrlState(store, {
            prefix: 'scary',
            keys: [
                { key: 'view', values: viewKeys },
                { key: 'country', values: availableCountries },
                { key: 'trendsCountry', param: 'trends', values: trendsCountries },
                { key: 'yearIdx', param: 'year',
                  serialize: function (idx) { return years[idx]; },
                  parse: function (raw) {
                      var idx = years.indexOf(parseInt(raw, 10));
                      return idx === -1 ? undefined : idx;
                  } }
            ]
        }) : null;

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
                compact: chartEl.clientWidth > 0 && chartEl.clientWidth < 600 /* sm */
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
            P.fetchJSON(dataBase + DATA_FILES.wordcloud)
                .then(function (d) { wordcloudData = d; })
                .catch(function (err) {
                    console.warn('IWACVis.scaryTerms: wordcloud bundle unavailable', err);
                    wordcloudData = null;
                })
                .then(function () {
                    // A bundle arriving is structural (the facet bar can
                    // only be built from it), so this is a remount.
                    if (state.view === 'wordcloud') {
                        controls.mount();
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
            P.fetchJSON(dataBase + DATA_FILES.places)
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
                        controls.mount();
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
                // Never null: the controller is MapLibre-gated and owns its
                // own spinner / "Map library unavailable" banner inside mapEl.
                mapController = SH.createScaryMap(mapEl, placesData, {
                    getFilter: mapFilter,
                    termColors: termColors,
                    siteBase: container.dataset.siteBase
                        || container.dataset.embedBase || ''
                });
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
            if (!cooccurrence || !slice) {
                // Themed "no data" note — the matrix view can be offered
                // while a per-country slice is missing.
                var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
                var mutedResolved = (ns.resolveCssVar && ns.resolveCssVar('--muted'))
                    || tokens.muted || '#767880';
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

            // Flatten to [xIdx, yIdx, value] triples. The diagonal is
            // left out because self-co-occurrence is meaningless — the
            // tooltip covers the per-term totals via term_counts. Zero
            // cells stay in so the full grid paints on the ramp base.
            var cells = [];
            for (var i = 0; i < terms.length; i++) {
                for (var j = 0; j < terms.length; j++) {
                    if (i === j) continue;
                    cells.push([i, j, (matrix[i] && matrix[i][j]) || 0]);
                }
            }

            return C.heatmapMatrix(
                { xLabels: terms, yLabels: terms, cells: cells },
                {
                    visualMax: Math.max(1, slice.max_cooccurrence || 1),
                    cellLabels: true,
                    cellBorder: true,
                    xLabelRotate: 45,
                    tooltipFormatter: function (p) {
                        return P.t('scary.matrix_pair_tooltip', {
                            a: terms[p.value[0]],
                            b: terms[p.value[1]],
                            count: P.formatNumber(p.value[2] || 0)
                        });
                    }
                }
            );
        }

        // -----------------------------------------------------------------
        //  Controls + playback
        //
        //  The controls row (view toggle, per-view selects, playback bar,
        //  slider) lives in scary-terms/controls.js; the race timer's
        //  state machine is the shared P.createPlaybackTimer. Neither
        //  touches the DOM of the other: the timer patches the store and
        //  the row's sync() moves the slider and the play glyph.
        // -----------------------------------------------------------------

        var playback = P.createPlaybackTimer({
            tickMs: RACE_TICK_MS,
            isAtEnd: function () { return state.yearIdx >= years.length - 1; },
            rewind: function () { store.patch({ yearIdx: 0 }); },
            advance: function () { store.patch({ yearIdx: state.yearIdx + 1 }); },
            onPlay: function () { store.patch({ isPlaying: true }); },
            onStop: function () { store.patch({ isPlaying: false }); }
        });

        var controls = SH.createScaryControls({
            controlsEl: controlsEl,
            store: store,
            years: years,
            availableCountries: availableCountries,
            matrixCountries: matrixCountries,
            trendsCountries: trendsCountries,
            families: families,
            hasCooccurrence: !!cooccurrence,
            hasEvents: !!eventsData,
            getWordcloudData: function () { return wordcloudData; },
            getPlacesData: function () { return placesData; },
            getMapCountries: function () { return mapCountries; },
            playback: playback,
            trailing: url && P.buildCopyLinkButton
                ? P.buildCopyLinkButton({ href: url.href })
                : null
        });

        // What a change means. Order matters within one flush: the row is
        // remounted (view) or synced (anything) before the chart redraws.
        store.subscribe(function () { controls.mount(); }, { keys: ['view'] });
        store.subscribe(function () { controls.sync(); });
        store.subscribe(function () { draw(); }, {
            keys: ['view', 'country', 'matrixCountry', 'trendsCountry', 'showEvents',
                   'wcFacet', 'wcSub', 'mapFamily', 'mapCountry', 'yearIdx']
        });

        // Initial paint
        controls.mount();
        draw();
    }

})();
