/**
 * IWAC Visualizations — Laïcité block (orchestrator, issue #14)
 *
 * A dossier on secularism across the whole IWAC corpus, in fourteen views:
 *
 *   - overview     KPIs, the tag-vs-text Venn, the per-corpus table,
 *                  the rights note and the frame legend
 *   - trends       annotated timeline, scoped globally / by country / by
 *                  corpus, with a Gregorian-vs-lunar seasonality axis
 *   - documents    the archival dossier
 *   - concordance  KWIC lines, lazy-loaded per corpus
 *   - collocates   log-likelihood collocates, sliced by source type /
 *                  corpus / decade / country, plus the implicit-lexicon
 *                  result
 *   - corpora      press vs periodicals on token-normalised rates, plus the
 *                  per-outlet frame fingerprints
 *   - actors       the authority records speaking laïcité, by decade
 *   - arenas       frame × decade × country shares — what is contested
 *   - sentiment    per-model AI framing against a whole-corpus baseline
 *   - map          geocoded places tagged on dossier items
 *   - semantic     UMAP map of the press half, and a check on the frames
 *   - circulation  near-duplicate copy across outlets: does it circulate?
 *   - bylines      who signs the beat, always beside its denominator
 *   - references   the scholarship, on its own axis
 *
 * Data strategy: the four small bundles (metadata, trends, documents,
 * countries) plus the committed events sidecar load up front — about 60 KB
 * together. The concordance index is small too; the per-corpus KWIC bundles
 * are fetched only when that view first activates, and only for the corpus
 * being browsed. Every Phase 2 and Phase 3 bundle loads the same way, on
 * first activation of the view that needs it.
 *
 * Missing files resolve to null so the block degrades gracefully on deploys
 * whose data predates them.
 *
 * Dependencies (in load order before this file):
 *   echarts → iwac-i18n.js → iwac-theme.js → dashboard-core.js → panels.js →
 *   pagination.js → facet-buttons.js → maplibre stack → annotated-timeline.js →
 *   concordance.js → laicite/{i18n,helpers,overview,trends,documents,
 *   concordance,collocates,corpora,actors,arenas,sentiment,map,semantic,
 *   circulation,bylines,references,controls}.js
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis.laicite: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite || {};

    var DATA_FILES = {
        metadata:    'laicite-metadata.json',
        trends:      'laicite-trends.json',
        documents:   'laicite-documents.json',
        countries:   'laicite-countries.json',
        events:      'laicite-events.json',
        concordance: 'laicite-concordance.json',
        collocates:  'laicite-collocates.json',
        implicit:    'laicite-implicit.json',
        corpora:     'laicite-corpora.json',
        seasonality: 'laicite-seasonality.json',
        actors:      'laicite-actors.json',
        arenas:      'laicite-arenas.json',
        sentiment:   'laicite-sentiment.json',
        places:      'laicite-places.json',
        references:  'laicite-references.json',
        semantic:    'laicite-semantic.json',
        circulation: 'laicite-circulation.json',
        bylines:     'laicite-bylines.json'
    };

    P.bootBlock({
        selector:       '.iwac-vis-laicite',
        warnLabel:      'IWACVis.laicite',
        requireECharts: true,
        load: function (ctx) {
            function optional(name) {
                return P.fetchJSON(ctx.dataBase + DATA_FILES[name])
                    .catch(function () { return null; });
            }
            return Promise.all([
                P.fetchJSON(ctx.dataBase + DATA_FILES.metadata),
                optional('trends'),
                optional('documents'),
                optional('countries'),
                optional('events'),
                optional('concordance')
            ]);
        },
        render: function (container, results, ctx) {
            render(container, {
                metadata:    results[0],
                trends:      results[1],
                documents:   results[2],
                countries:   results[3],
                events:      results[4],
                concordance: results[5]
            }, ctx);
        }
    });

    // ---------------------------------------------------------------------
    //  Layout
    // ---------------------------------------------------------------------

    function render(container, bundle, ctx) {
        var metadata = bundle.metadata || {};
        var trends = bundle.trends;
        var events = bundle.events;
        var siteBase = container.dataset.siteBase
            || container.dataset.embedBase || '';

        var frames = metadata.frame_order || [];
        var frameColors = L.buildFrameColorMap(frames);

        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-laicite-root');
        container.appendChild(root);

        // 1. Header
        var header = P.el('div', 'iwac-vis-block-header iwac-vis-laicite-header');
        header.appendChild(P.el('h3', 'iwac-vis-block-header__title',
            P.t('laicite.title')));
        header.appendChild(P.el('p', 'iwac-vis-block-header__desc',
            P.t('laicite.description')));
        root.appendChild(header);

        // 2. KPI row + authority link
        root.appendChild(L.buildMetricCards(metadata));
        var authority = L.buildAuthorityLink(metadata, siteBase);
        if (authority) root.appendChild(authority);

        // 3. Controls
        var controlsEl = P.el('div', 'iwac-vis-laicite-controls');
        root.appendChild(controlsEl);

        // 4. View host — one container per view, shown one at a time.
        var viewHost = P.el('div', 'iwac-vis-laicite-viewhost');
        root.appendChild(viewHost);

        var chartPanel = P.el('div', 'iwac-vis-panel iwac-vis-laicite-chart-panel');
        var chartTitle = P.el('h4', 'iwac-vis-laicite-chart-title');
        chartPanel.appendChild(chartTitle);
        var chartEl = P.el('div', 'iwac-vis-chart iwac-vis-laicite-chart');
        chartPanel.appendChild(chartEl);
        var detailsHost = P.el('div', 'iwac-vis-laicite-details-host');
        chartPanel.appendChild(detailsHost);

        var state = {
            view: 'overview',
            trendsCountry: null,
            trendsSubset: null,
            trendsAxis: 'years',
            seasonSubset: 'articles',
            colScope: 'global',
            colSlice: null,
            showEvents: true,
            kwicSubset: 'articles',
            kwicFrame: '',
            kwicCountry: '',
            kwicQuery: '',
            actorType: '',
            arenaCountry: '',
            sentModel: '',
            mapFrame: '',
            mapCountry: '',
            refType: ''
        };

        var concordance = L.createConcordance({
            index: bundle.concordance,
            metadata: metadata,
            dataBase: ctx.dataBase,
            siteBase: siteBase,
            state: state
        });

        // Default the concordance to the first corpus that actually has rows,
        // so the view never opens on an empty list.
        var available = concordance.availableSubsets();
        if (available.length && available.indexOf(state.kwicSubset) === -1) {
            state.kwicSubset = available[0];
        }

        // Phase 2 bundles load on first activation of their view — the
        // block opens on the overview, and none of these are needed there.
        // undefined = not requested, null = failed/absent, object = loaded.
        var lazy = {};
        var lazyPending = {};

        function ensure(names, after) {
            var missing = names.filter(function (n) {
                return lazy[n] === undefined && !lazyPending[n];
            });
            if (!missing.length) {
                var ready = names.every(function (n) {
                    return lazy[n] !== undefined;
                });
                if (ready && after) after();
                return ready;
            }
            missing.forEach(function (name) {
                lazyPending[name] = true;
                P.fetchJSON(ctx.dataBase + DATA_FILES[name])
                    .then(function (d) { lazy[name] = d; })
                    .catch(function (err) {
                        console.warn('IWACVis.laicite: bundle unavailable',
                            name, err);
                        lazy[name] = null;
                    })
                    .then(function () {
                        lazyPending[name] = false;
                        var ready = names.every(function (n) {
                            return lazy[n] !== undefined;
                        });
                        if (ready) {
                            controls.render();
                            draw();
                        }
                    });
            });
            return false;
        }

        // The timeline chart is the only ECharts instance this block owns
        // directly (the lazy views register their own). dashboard-core keeps
        // the SAME instance across a theme swap — `setTheme()` on it, then
        // this callback again — so capturing it here is belt-and-braces: it
        // keeps draw() correct if that contract ever changes, at no cost.
        var currentInstance = null;
        ns.registerChart(chartEl, function (el, instance) {
            currentInstance = instance;
            if (state.view === 'trends') drawTrends();
        });

        var controls = L.createControls({
            controlsEl: controlsEl,
            state: state,
            metadata: metadata,
            countries: metadata.countries || [],
            trendsCountries: trends && trends.by_country
                ? Object.keys(trends.by_country).sort() : [],
            draw: draw,
            getConcordanceSubsets: function () {
                return concordance.availableSubsets();
            },
            getConcordanceCountries: function (subset) {
                return concordance.countriesFor(subset);
            },
            getCollocateSlices: function (scope) {
                return L.collocateSlices(lazy.collocates, scope);
            },
            getSeasonSubsets: function () {
                var byS = (lazy.seasonality || {}).by_subset || {};
                return Object.keys(byS).filter(function (k) {
                    // Only corpora that actually carry lunar dates: offering
                    // scholarship here would show an all-zero lunar panel.
                    return (byS[k].hijri_coverage || 0) > 0;
                });
            },
            getActorTypes: function () { return L.actorTypes(lazy.actors); },
            getArenaCountries: function () { return L.arenaCountries(lazy.arenas); },
            getSentimentModels: function () {
                return L.sentimentModels(lazy.sentiment);
            },
            getPlaceCountries: function () { return L.placeCountries(lazy.places); },
            getReferenceTypes: function () {
                return L.referenceTypes(lazy.references);
            }
        });

        function drawTrends() {
            if (!currentInstance || currentInstance.isDisposed()) return;
            detailsHost.innerHTML = '';

            if (state.trendsAxis === 'seasons') {
                chartTitle.textContent = P.t('laicite.seasonality_title');
                if (!ensure(['seasonality'])) {
                    currentInstance.showLoading();
                    return;
                }
                currentInstance.hideLoading();
                var season = lazy.seasonality;
                if (!season) {
                    currentInstance.setOption(P.emptyChartOption(),
                        { notMerge: true });
                    return;
                }
                var subsets = Object.keys((season.by_subset || {}));
                if (subsets.indexOf(state.seasonSubset) === -1 && subsets.length) {
                    state.seasonSubset = subsets[0];
                }
                currentInstance.setOption(
                    L.seasonalityOption(season, state.seasonSubset, metadata),
                    { notMerge: true, lazyUpdate: true });
                var note = P.el('div', 'iwac-vis-laicite-season-note');
                note.appendChild(P.el('p', null, P.t('laicite.seasonality_desc')));
                var cov = (season.by_subset || {})[state.seasonSubset] || {};
                note.appendChild(P.el('p', 'iwac-vis-laicite-season-coverage',
                    P.t('laicite.seasonality_coverage', {
                        hijri: P.formatNumber(cov.hijri_coverage || 0),
                        items: P.formatNumber(cov.items || 0)
                    })));
                detailsHost.appendChild(note);
                return;
            }

            chartTitle.textContent = L.trendsTitle(state);
            currentInstance.hideLoading();
            if (!trends) {
                currentInstance.setOption(
                    P.emptyChartOption('Visualization data is not available yet.'),
                    { notMerge: true });
                return;
            }
            var option = L.buildTrendsOption({
                trends: trends,
                metadata: metadata,
                events: events,
                state: state,
                frameColors: frameColors,
                compact: chartEl.clientWidth > 0 && chartEl.clientWidth < 600
            });
            currentInstance.setOption(option, { notMerge: true, lazyUpdate: true });
            if (events) {
                var details = L.buildEventsDetails(events, state, siteBase);
                if (details) detailsHost.appendChild(details);
            }
        }

        function draw() {
            // Release the outgoing view's charts and map before their nodes
            // are thrown away — every lazy view builds fresh ones, and until
            // v1.59.0 each visit to the sentiment view left four ECharts
            // instances alive behind detached nodes and each visit to the
            // map view leaked a WebGL context. Two children are parked, not
            // rebuilt, and must survive: the trends chart panel and the
            // concordance host.
            if (ns.disposeWithin) {
                for (var i = viewHost.children.length - 1; i >= 0; i--) {
                    var outgoing = viewHost.children[i];
                    if (outgoing === chartPanel || outgoing === concordance.host) continue;
                    ns.disposeWithin(outgoing);
                }
            }
            viewHost.innerHTML = '';
            if (state.view === 'overview') {
                viewHost.appendChild(L.buildVenn(metadata, function (cell) {
                    // "Tagged, never says it" has no concordance lines by
                    // definition — those items carry no text match — so the
                    // Venn only routes the two cells that do.
                    if (cell === 'tagged_only') return;
                    state.view = 'concordance';
                    controls.render();
                    draw();
                }));
                viewHost.appendChild(L.buildSubsetTable(metadata));
                viewHost.appendChild(L.buildRightsNote(metadata));
                viewHost.appendChild(L.buildFrameLegend(metadata, frameColors));
            } else if (state.view === 'trends') {
                viewHost.appendChild(chartPanel);
                drawTrends();
                if (currentInstance && !currentInstance.isDisposed()) {
                    // The host was display:none until this view activated.
                    window.setTimeout(function () {
                        if (currentInstance && !currentInstance.isDisposed()) {
                            currentInstance.resize();
                        }
                    }, 0);
                }
            } else if (state.view === 'documents') {
                viewHost.appendChild(L.buildDocumentDossier(
                    bundle.documents, metadata, {
                        siteBase: siteBase,
                        frameColors: frameColors,
                        onFocusYear: function (year, country) {
                            state.view = 'trends';
                            if (country) {
                                state.trendsCountry = country;
                                state.trendsSubset = null;
                            }
                            controls.render();
                            draw();
                            void year;
                        }
                    }));
            } else if (state.view === 'concordance') {
                viewHost.appendChild(concordance.host);
                concordance.render();
            } else if (state.view === 'collocates') {
                if (!ensure(['collocates', 'implicit'])) {
                    viewHost.appendChild(P.buildLoadingState());
                    return;
                }
                viewHost.appendChild(L.buildCollocates({
                    bundle: lazy.collocates,
                    implicit: lazy.implicit,
                    metadata: metadata,
                    state: state,
                    siteBase: siteBase
                }));
            } else if (state.view === 'corpora') {
                mountLazy('corpora', function () {
                    return L.buildCorpora({
                        bundle: lazy.corpora,
                        metadata: metadata,
                        state: state,
                        frameColors: frameColors
                    });
                });
            } else if (state.view === 'actors') {
                mountLazy('actors', function () {
                    return L.buildActors({
                        bundle: lazy.actors,
                        state: state,
                        siteBase: siteBase
                    });
                });
            } else if (state.view === 'arenas') {
                mountLazy('arenas', function () {
                    return L.buildArenas({
                        bundle: lazy.arenas,
                        metadata: metadata,
                        state: state,
                        frameColors: frameColors
                    });
                });
            } else if (state.view === 'sentiment') {
                mountLazy('sentiment', function () {
                    return L.buildSentiment({
                        bundle: lazy.sentiment,
                        state: state
                    });
                });
            } else if (state.view === 'map') {
                mountLazy('places', function () {
                    return L.buildMap({
                        bundle: lazy.places,
                        metadata: metadata,
                        state: state,
                        frameColors: frameColors,
                        siteBase: siteBase
                    });
                });
            } else if (state.view === 'semantic') {
                mountLazy('semantic', function () {
                    return L.buildSemantic({
                        bundle: lazy.semantic,
                        metadata: metadata,
                        state: state,
                        frameColors: frameColors,
                        siteBase: siteBase
                    });
                });
            } else if (state.view === 'circulation') {
                mountLazy('circulation', function () {
                    return L.buildCirculation({
                        bundle: lazy.circulation,
                        siteBase: siteBase
                    });
                });
            } else if (state.view === 'bylines') {
                mountLazy('bylines', function () {
                    return L.buildBylines({ bundle: lazy.bylines });
                });
            } else if (state.view === 'references') {
                mountLazy('references', function () {
                    return L.buildReferences({
                        bundle: lazy.references,
                        state: state,
                        siteBase: siteBase
                    });
                });
            }
        }

        /**
         * Fetch-then-build for the views whose bundle is lazy. `build`
         * returns {root, mount}; mount runs only after the nodes are in the
         * document, because ECharts and MapLibre both size themselves off a
         * mounted container and would otherwise measure zero.
         */
        function mountLazy(bundleName, build) {
            if (!ensure([bundleName])) {
                viewHost.appendChild(P.buildLoadingState());
                return;
            }
            var built = build();
            viewHost.appendChild(built.root);
            built.mount();
        }

        controls.render();
        draw();
    }
})();
