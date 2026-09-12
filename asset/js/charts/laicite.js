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
 * State lives in one P.createStore; the controls row patches it and the
 * subscriptions at the foot of render() turn a change into a remount, a
 * sync or a redraw. The view, the trends scope, the concordance corpus /
 * frame / query are URL-addressable (`?laicite.view=…`) through
 * P.bindUrlState.
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
            trendsSubset: 'articles',
            trendsField: 'fulltext',
            trendsMetric: 'rate',
            trendsPrecision: '',
            trendsOutlet: '',
            trendsAxis: 'years',
            seasonSubset: 'articles',
            colScope: 'by_language',
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
            state: state,
            onLoaded: function () { if (controls) controls.sync(); }
        });

        // Default the concordance to the first corpus that actually has rows,
        // so the view never opens on an empty list.
        var available = concordance.availableSubsets();
        if (available.length && available.indexOf(state.kwicSubset) === -1) {
            state.kwicSubset = available[0];
        }

        // One store over that object. The controls patch it; the
        // subscriptions at the foot of this function turn a change into a
        // remount (view), a sync (anything) and a redraw. The cross-field
        // rules that six change handlers used to apply by hand — a corpus
        // clears the country and vice versa, a scope resets its slice, a
        // frame clears the map country — live in the reducer, once.
        var trendsCountries = trends && trends.by_country
            ? Object.keys(trends.by_country).sort() : [];
        // The four country keys are ONE choice (S4). Each view spells its
        // empty value differently — the timeline uses null, the three select-
        // driven views use '' — and they used to move independently, so a
        // reader who picked Togo on the timeline had to pick it again on the
        // map, the arenas and the concordance. The reducer keeps them in
        // step, and only for a country the dossier actually holds: an unknown
        // value would narrow a view to nothing.
        var COUNTRY_KEYS = ['trendsCountry', 'kwicCountry', 'arenaCountry', 'mapCountry'];
        if (trends && trends.research) {
            trendsCountries = Array.from(new Set(trends.research.cells.map(function (r) { return r.country; }).filter(Boolean))).sort();
        }
        var knownCountries = (metadata.countries || []).slice();

        var store = P.createStore(state, {
            reduce: function (st, changed) {
                var extra = {};
                var has = function (k) { return changed.indexOf(k) !== -1; };
                if (has('trendsSubset')) extra.trendsOutlet = '';
                if (has('colScope')) extra.colSlice = null;
                if (has('kwicSubset')) extra.kwicCountry = '';
                if (has('mapFrame') && st.mapFrame) extra.mapCountry = '';
                if (has('mapCountry') && st.mapCountry) extra.mapFrame = '';

                // Whichever country key the reader touched wins for all four.
                var moved = null;
                for (var i = 0; i < COUNTRY_KEYS.length; i++) {
                    if (has(COUNTRY_KEYS[i])) { moved = COUNTRY_KEYS[i]; break; }
                }
                if (moved) {
                    var value = st[moved] || '';
                    var shareable = !value || knownCountries.indexOf(value) !== -1;
                    if (shareable) {
                        COUNTRY_KEYS.forEach(function (k) {
                            if (k === moved) return;
                            // null for the timeline, '' for the selects.
                            extra[k] = k === 'trendsCountry' ? (value || null) : value;
                        });
                    }
                }
                return extra;
            }
        });

        // The citable state is addressable: `?laicite.view=trends&
        // laicite.country=Togo`, `?laicite.view=concordance&laicite.q=école`.
        var url = P.bindUrlState ? P.bindUrlState(store, {
            prefix: 'laicite',
            keys: [
                { key: 'view', values: L.VIEW_KEYS },
                { key: 'trendsCountry', param: 'country', values: trendsCountries },
                { key: 'trendsSubset', param: 'subset', values: L.SUBSETS },
                { key: 'trendsAxis', param: 'axis', values: ['years', 'seasons'] },
                { key: 'trendsField', param: 'field', values: ['title', 'fulltext', 'union'] },
                { key: 'trendsMetric', param: 'metric', values: ['rate', 'matches', 'hits'] },
                { key: 'trendsPrecision', param: 'precision', values: ['', 'broad_'] },
                { key: 'kwicSubset', param: 'corpus', values: available },
                { key: 'kwicFrame', param: 'frame', values: frames },
                { key: 'kwicQuery', param: 'q' }
            ]
        }) : null;

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
                            // A bundle arriving is structural — the selects
                            // it feeds can only be built now — so remount.
                            controls.mount();
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
            store: store,
            metadata: metadata,
            countries: metadata.countries || [],
            trendsCountries: trendsCountries,
            research: trends && trends.research,
            trailing: url && P.buildCopyLinkButton
                ? P.buildCopyLinkButton({ href: url.href })
                : null,
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
                    // Silent: the select was just mounted on this same value.
                    store.patch({ seasonSubset: subsets[0] }, { silent: true });
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
                if (L.researchTable && cov.gregorian_exposure) {
                    var seasonEvidence = P.el('details');
                    seasonEvidence.appendChild(P.el('summary', null, P.t('laicite.research_inspect')));
                    ['gregorian', 'hijri'].forEach(function (calendar) {
                        seasonEvidence.appendChild(P.el('h5', null, P.t('laicite.' + calendar)));
                        var names = P.t('laicite.' + (calendar === 'gregorian' ? 'months' : 'hijri_months')).split(',');
                        seasonEvidence.appendChild(L.researchTable([P.t('laicite.' + calendar),
                            P.t('laicite.research_selected'), P.t('laicite.research_eligible')], names.map(function (name, i) {
                            return [name, cov[calendar][i], cov[calendar + '_exposure'][i]];
                        })));
                    });
                    detailsHost.appendChild(seasonEvidence);
                }
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
                compact: P.isCompact(chartEl)
            });
            currentInstance.setOption(option, { notMerge: true, lazyUpdate: true });
            if (L.buildTrendEvidence) detailsHost.appendChild(L.buildTrendEvidence(trends, state));
            if (events && state.trendsSubset !== 'references') {
                var details = L.buildEventsDetails(events, state, siteBase);
                if (details) detailsHost.appendChild(details);
            }
        }

        /**
         * The view currently in `viewHost`, and what built it — `null` while
         * a loading or empty state is showing. Read by `draw()` for the
         * in-place update path below (Tier 8 / S17).
         */
        var active = null;

        function draw() {
            // A change WITHIN the current view, to a view that can absorb
            // it: no teardown (Tier 8 / S17). Clearing `viewHost` for an
            // actor-type or a reference-type change disposed live charts and
            // built new ones, which cost the transition, churned the theme
            // observer's registrations, collapsed the host to zero height
            // and so jumped the scroll, and re-announced the whole region to
            // a screen reader. A builder that exposes `update` says it can
            // repaint itself from the new state; one that does not falls
            // through to the rebuild below, unchanged.
            if (active && active.key === state.view
                && typeof active.built.update === 'function') {
                active.built.update(state);
                return;
            }
            active = null;

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
                    if (parked.places && outgoing === parked.places.root) continue;
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
                    store.patch({ view: 'concordance' });
                }));
                viewHost.appendChild(L.buildSubsetTable(metadata));
                if (L.buildResearch) viewHost.appendChild(L.buildResearch(trends && trends.research));
                viewHost.appendChild(L.buildVideos(metadata, siteBase));
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
                viewHost.appendChild(L.buildSourceComparisons(siteBase));
                viewHost.appendChild(L.buildDocumentDossier(
                    bundle.documents, metadata, {
                        siteBase: siteBase,
                        frameColors: frameColors,
                        onFocusYear: function (year, country) {
                            var changes = { view: 'trends' };
                            if (country) changes.trendsCountry = country;
                            store.patch(changes);
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
                // Parked, not rebuilt. Every other lazy view is cheap to
                // build again; this one is a WebGL context, and browsers cap
                // live contexts at about sixteen and silently lose the oldest
                // — flipping between views often enough used to leave the map
                // blank. v1.59.0 stopped it leaking; this stops it churning.
                mountParked('places', 'map', function () {
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
                return;                       // `active` stays null: the next
            }                                 // draw must build for real.
            var built = build();
            viewHost.appendChild(built.root);
            built.mount();
            active = { key: state.view, built: built };
        }

        /** Views whose built root is kept across switches, by key. */
        var parked = {};

        /**
         * `mountLazy` for a view that is expensive to rebuild: the first
         * visit builds and remembers it, later visits re-attach the same
         * nodes and re-run its `update`. The same shape scary-terms uses for
         * its map. `draw()` skips a parked root when disposing the outgoing
         * view, and re-attaching is what makes MapLibre re-measure.
         */
        function mountParked(bundleName, key, build) {
            if (!ensure([bundleName])) {
                viewHost.appendChild(P.buildLoadingState());
                return;
            }
            if (!parked[key]) {
                parked[key] = build();
                viewHost.appendChild(parked[key].root);
                parked[key].mount();
                active = { key: state.view, built: parked[key] };
                return;
            }
            viewHost.appendChild(parked[key].root);
            if (parked[key].update) parked[key].update(state);
            if (parked[key].resize) parked[key].resize();
            active = { key: state.view, built: parked[key] };
        }

        // What a change means. Within one flush the row is remounted (view)
        // or synced (anything) before the view redraws.
        store.subscribe(function () { controls.mount(); }, { keys: ['view'] });
        store.subscribe(function () { controls.sync(); });
        store.subscribe(function () { draw(); });

        controls.mount();
        draw();
    }
})();
