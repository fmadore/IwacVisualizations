/**
 * IWAC Visualizations — Laïcité block: controls row (issue #14).
 *
 * The view toggle plus the per-view facets. Patches the orchestrator's
 * store and never redraws on its own — the same contract
 * `scary-terms/controls.js` uses.
 *
 * `mount()` builds the controls for the current view; `sync()` writes the
 * state into them. Only a change of view (or a lazy bundle arriving with
 * the options a select needs) remounts. Every other change — a corpus
 * clearing the country, a scope repopulating its slice list, a frame
 * clearing the country on the map — is done IN PLACE, so the `<select>`
 * the reader is stepping through with the arrow keys is still there for
 * the next keystroke. Until v1.60.0 each of those rebuilt the whole row
 * from inside its own change handler.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite controls: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    // Ordered by what a reader needs first, not by build phase: the dossier
    // and the sources, then the language, then the context.
    var VIEWS = [
        { key: 'overview', labelKey: 'laicite.view_overview' },
        { key: 'trends', labelKey: 'laicite.view_trends' },
        { key: 'documents', labelKey: 'laicite.view_documents' },
        { key: 'concordance', labelKey: 'laicite.view_concordance' },
        { key: 'collocates', labelKey: 'laicite.view_collocates' },
        { key: 'corpora', labelKey: 'laicite.view_corpora' },
        { key: 'actors', labelKey: 'laicite.view_actors' },
        { key: 'arenas', labelKey: 'laicite.view_arenas' },
        { key: 'sentiment', labelKey: 'laicite.view_sentiment' },
        { key: 'map', labelKey: 'laicite.view_map' },
        // After the map and before the bibliography: like the map it
        // places items in a space, and like the map it is a way into the
        // corpus rather than a claim about it.
        { key: 'semantic', labelKey: 'laicite.view_semantic' },
        // Circulation and bylines both answer "where did this text come
        // from", so they sit together, after the views about what it says
        // and before the bibliography.
        { key: 'circulation', labelKey: 'laicite.view_circulation' },
        { key: 'bylines', labelKey: 'laicite.view_bylines' },
        { key: 'references', labelKey: 'laicite.view_references' }
    ];

    /** The view keys, for the orchestrator's URL validation. */
    L.VIEW_KEYS = VIEWS.map(function (v) { return v.key; });

    /**
     * @param {Object} ctx
     * @param {HTMLElement} ctx.controlsEl
     * @param {Object} ctx.store            the orchestrator's P.createStore
     * @param {Object} ctx.metadata
     * @param {Array<string>} ctx.countries
     * @param {Array<string>} ctx.trendsCountries
     * @param {function():Array<string>} ctx.getConcordanceSubsets
     * @param {function(string):Array<string>} ctx.getConcordanceCountries
     * @param {HTMLElement} [ctx.trailing]  persistent end-of-row element
     */
    L.createControls = function (ctx) {
        var store = ctx.store;
        var state = store.state;
        var metadata = ctx.metadata || {};

        var row = null;
        var toggle = null;
        var slot = null;
        var tail = null;
        var live = {};

        function ensureSkeleton() {
            if (row) return;
            row = P.el('div', 'iwac-vis-laicite-controls-row');
            toggle = P.buildSegmented({
                name: 'laicite-view',
                ariaLabel: P.t('laicite.title'),
                options: VIEWS.map(function (v) {
                    return { key: v.key, label: P.t(v.labelKey) };
                }),
                active: state.view,
                classes: {
                    root: 'iwac-vis-chip-row iwac-vis-laicite-views',
                    btn: 'iwac-vis-laicite-view-btn',
                    active: 'is-active'
                },
                onChange: function (key) { store.patch({ view: key }); }
            });
            row.appendChild(toggle.root);
            slot = P.el('div', 'iwac-vis-controls-slot');
            row.appendChild(slot);
            if (ctx.trailing) row.appendChild(ctx.trailing);
            ctx.controlsEl.appendChild(row);
            tail = P.el('div', 'iwac-vis-controls-slot');
            ctx.controlsEl.appendChild(tail);
        }

        function mount() {
            ensureSkeleton();
            P.withFocusRestored(ctx.controlsEl, function () {
                slot.innerHTML = '';
                tail.innerHTML = '';
                live = {};
                toggle.set(state.view);

                if (state.view === 'trends') {
                    mountTrendsControls();
                } else if (state.view === 'concordance') {
                    mountConcordanceControls();
                } else if (state.view === 'collocates') {
                    mountCollocateControls();
                } else if (state.view === 'actors') {
                    mountSimple('actorType', 'laicite-actor-type', P.t('laicite.filter_type'),
                        withAll(ctx.getActorTypes() || [], P.t('laicite.filter_all'),
                            function (t) { return P.t('laicite.actor_type_' + t); }));
                } else if (state.view === 'arenas') {
                    mountSimple('arenaCountry', 'laicite-arena-country', P.t('laicite.filter_country'),
                        withAll(ctx.getArenaCountries() || [], P.t('laicite.scope_global')));
                } else if (state.view === 'sentiment') {
                    mountSentimentControls();
                } else if (state.view === 'map') {
                    mountMapControls();
                } else if (state.view === 'references') {
                    mountSimple('refType', 'laicite-ref-type', P.t('laicite.filter_type'),
                        withAll(ctx.getReferenceTypes() || [], P.t('laicite.filter_all')));
                }

                var descKey = {
                    overview: 'laicite.overview_desc',
                    trends: 'laicite.trends_desc',
                    documents: 'laicite.documents_desc',
                    concordance: 'laicite.concordance_desc'
                }[state.view];
                if (descKey) {
                    tail.appendChild(P.el('p', 'iwac-vis-laicite-view-desc', P.t(descKey)));
                }
                sync();
            });
        }

        /** Write the state into whatever is mounted. */
        function sync() {
            if (!row) return;
            toggle.set(state.view);
            Object.keys(live).forEach(function (key) {
                var entry = live[key];
                if (entry && typeof entry.sync === 'function') entry.sync();
            });
        }

        /** One select bound to one state key, synced by value. */
        function select(stateKey, cfg) {
            var group = P.buildSelectControl({
                name: cfg.idPrefix,
                label: cfg.label,
                options: cfg.options,
                current: cfg.current !== undefined ? cfg.current : (state[stateKey] || ''),
                idPrefix: cfg.idPrefix,
                onChange: cfg.onChange || function (value) {
                    var changes = {};
                    changes[stateKey] = cfg.nullable ? (value || null) : value;
                    store.patch(changes);
                }
            });
            group.sync = cfg.sync || function () {
                group.control.value = state[stateKey] == null ? '' : String(state[stateKey]);
            };
            return group;
        }

        function mountSimple(stateKey, idPrefix, label, options) {
            if (!options.length) return;
            live[stateKey] = select(stateKey, {
                label: label, options: options, idPrefix: idPrefix
            });
            slot.appendChild(live[stateKey]);
        }

        function withAll(values, label, labelFor) {
            if (!values.length) return [];
            return [{ value: '', label: label }].concat(values.map(function (v) {
                return { value: v, label: labelFor ? labelFor(v) : v };
            }));
        }

        function mountTrendsControls() {
            // Axis toggle first: seasonality is a different question from the
            // year series, not a filter on it, and it takes a different set
            // of controls entirely — so BOTH sets are built here and the
            // axis decides which is hidden. Switching the axis then keeps the
            // axis select under the reader's focus instead of rebuilding it.
            live.trendsAxis = select('trendsAxis', {
                label: P.t('laicite.axis_years'),
                options: [
                    { value: 'years', label: P.t('laicite.axis_years') },
                    { value: 'seasons', label: P.t('laicite.axis_seasons') }
                ],
                current: state.trendsAxis || 'years',
                idPrefix: 'laicite-trends-axis'
            });
            slot.appendChild(live.trendsAxis);

            // Only the corpus selector applies to seasons. The country and
            // year-scope controls would be inert — the seasonality bundle is
            // per corpus — and rendering them anyway produced two competing
            // "Corpus" dropdowns.
            var seasonSubsets = ctx.getSeasonSubsets() || [];
            if (seasonSubsets.length) {
                live.seasonSubset = select('seasonSubset', {
                    label: P.t('laicite.scope_subset'),
                    options: seasonSubsets.map(function (k) {
                        return { value: k, label: L.subsetLabel(k) };
                    }),
                    current: seasonSubsets.indexOf(state.seasonSubset) === -1
                        ? seasonSubsets[0] : state.seasonSubset,
                    idPrefix: 'laicite-season-subset'
                });
                slot.appendChild(live.seasonSubset);
            }

            // Country scope. Selecting a corpus clears it and vice versa —
            // the two scopes are alternatives, not a matrix (the store's
            // reducer applies that rule), and offering both at once would
            // imply per-country-per-corpus series the bundle does not carry.
            live.trendsCountry = select('trendsCountry', {
                label: P.t('laicite.filter_country'),
                options: [{ value: '', label: P.t('laicite.scope_global') }]
                    .concat((ctx.trendsCountries || []).map(function (c) {
                        return { value: c, label: c };
                    })),
                idPrefix: 'laicite-trends-country',
                nullable: true
            });
            slot.appendChild(live.trendsCountry);

            live.trendsSubset = select('trendsSubset', {
                label: P.t('laicite.scope_subset'),
                options: [{ value: '', label: P.t('laicite.filter_all') }]
                    .concat(L.SUBSETS.map(function (s) {
                        return { value: s, label: L.subsetLabel(s) };
                    })),
                idPrefix: 'laicite-trends-subset',
                nullable: true
            });
            slot.appendChild(live.trendsSubset);

            var evtWrap = P.el('label', 'iwac-vis-laicite-check');
            var cb = P.el('input');
            cb.type = 'checkbox';
            cb.checked = !!state.showEvents;
            cb.setAttribute('data-iwac-control', 'laicite-events');
            cb.addEventListener('change', function () {
                store.patch({ showEvents: cb.checked });
            });
            evtWrap.appendChild(cb);
            evtWrap.appendChild(P.el('span', null, P.t('laicite.show_events')));
            slot.appendChild(evtWrap);
            live.showEvents = {
                sync: function () {
                    cb.checked = !!state.showEvents;
                    var seasons = state.trendsAxis === 'seasons';
                    if (live.seasonSubset) live.seasonSubset.hidden = !seasons;
                    live.trendsCountry.hidden = seasons;
                    live.trendsSubset.hidden = seasons;
                    evtWrap.hidden = seasons;
                }
            };
        }

        function mountCollocateControls() {
            // `colscope_`, not `scope_`: `laicite.scope_global` is already
            // the trends country selector's "All countries".
            live.colScope = select('colScope', {
                label: P.t('laicite.scope_slice'),
                options: (L.COLLOCATE_SCOPES || []).map(function (key) {
                    return { value: key, label: P.t('laicite.colscope_' + key) };
                }),
                idPrefix: 'laicite-col-scope'
            });
            slot.appendChild(live.colScope);

            // Labelled "Showing", not "All": this picker chooses ONE slice,
            // and labelling it "All" said the opposite. Its options depend
            // on the scope, so a scope change repopulates it in place.
            function sliceOptions() {
                return (ctx.getCollocateSlices(state.colScope) || []).map(function (k) {
                    return { value: k, label: L.collocateSliceLabel(state.colScope, k) };
                });
            }
            var options = sliceOptions();
            live.colSlice = select('colSlice', {
                label: P.t('laicite.scope_showing'),
                options: options,
                current: state.colSlice || (options[0] && options[0].value) || '',
                idPrefix: 'laicite-col-slice',
                sync: function () {
                    var opts = sliceOptions();
                    live.colSlice.hidden = !opts.length;
                    if (opts.length) {
                        live.colSlice.setOptions(opts, state.colSlice || opts[0].value);
                    }
                }
            });
            live.colSlice.hidden = !options.length;
            slot.appendChild(live.colSlice);
        }

        function mountSentimentControls() {
            var models = ctx.getSentimentModels() || [];
            if (!models.length) return;
            // No "all" option: the models disagree and averaging them would
            // hide exactly what makes running several of them worth the cost.
            if (models.indexOf(state.sentModel) === -1) {
                store.patch({ sentModel: models[0] }, { silent: true });
            }
            live.sentModel = select('sentModel', {
                label: P.t('laicite.filter_model'),
                // Shared label table, not a `laicite.model_*` msgid per
                // model: these are proper nouns, so the block's en and fr
                // catalogs held byte-identical copies of the same three
                // strings, and a model added upstream got its raw id
                // printed into the picker until someone noticed.
                options: models.map(function (m) {
                    return { value: m, label: P.sentimentModelLabel(m) };
                }),
                current: state.sentModel,
                idPrefix: 'laicite-sent-model'
            });
            slot.appendChild(live.sentModel);
        }

        function mountMapControls() {
            // Frame and country are alternatives, not a matrix: the bundle
            // carries per-frame and per-country splits, not their cross
            // product, so offering both at once would promise a filter the
            // data cannot honour. The reducer clears the other one.
            var frames = withAll(metadata.frame_order || [], P.t('laicite.filter_all'),
                function (f) { return L.frameLabel(metadata, f); });
            if (frames.length) {
                live.mapFrame = select('mapFrame', {
                    label: P.t('laicite.filter_frame'),
                    options: frames,
                    idPrefix: 'laicite-map-frame'
                });
                slot.appendChild(live.mapFrame);
            }
            var countries = withAll(ctx.getPlaceCountries() || [], P.t('laicite.scope_global'));
            if (countries.length) {
                live.mapCountry = select('mapCountry', {
                    label: P.t('laicite.filter_country'),
                    options: countries,
                    idPrefix: 'laicite-map-country'
                });
                slot.appendChild(live.mapCountry);
            }
        }

        function mountConcordanceControls() {
            var subsets = ctx.getConcordanceSubsets();
            if (subsets.length) {
                live.kwicSubset = select('kwicSubset', {
                    label: P.t('laicite.scope_subset'),
                    options: subsets.map(function (s) {
                        return { value: s, label: L.subsetLabel(s) };
                    }),
                    current: state.kwicSubset,
                    idPrefix: 'laicite-kwic-subset'
                });
                slot.appendChild(live.kwicSubset);
            }

            live.kwicFrame = select('kwicFrame', {
                label: P.t('laicite.filter_frame'),
                options: [{ value: '', label: P.t('laicite.filter_all') }]
                    .concat((metadata.frame_order || []).map(function (f) {
                        return { value: f, label: L.frameLabel(metadata, f) };
                    })),
                idPrefix: 'laicite-kwic-frame'
            });
            slot.appendChild(live.kwicFrame);

            // The country list follows the corpus; a corpus change (which
            // also clears the country, in the reducer) repopulates it here
            // and hides it when the corpus has a single country.
            function countryOptions() {
                var countries = ctx.getConcordanceCountries(state.kwicSubset) || [];
                if (countries.length < 2) return [];
                return [{ value: '', label: P.t('laicite.filter_all') }]
                    .concat(countries.map(function (c) { return { value: c, label: c }; }));
            }
            var countries = countryOptions();
            live.kwicCountry = select('kwicCountry', {
                label: P.t('laicite.filter_country'),
                options: countries,
                idPrefix: 'laicite-kwic-country',
                sync: function () {
                    var opts = countryOptions();
                    live.kwicCountry.hidden = !opts.length;
                    if (opts.length) live.kwicCountry.setOptions(opts, state.kwicCountry || '');
                }
            });
            live.kwicCountry.hidden = !countries.length;
            slot.appendChild(live.kwicCountry);

            var searchWrap = P.el('div', 'iwac-vis-laicite-search');
            var input = P.el('input', 'iwac-vis-control iwac-vis-laicite-search-input');
            input.type = 'search';
            input.placeholder = P.t('laicite.concordance_search');
            input.value = state.kwicQuery || '';
            input.setAttribute('aria-label', P.t('laicite.concordance_search'));
            input.setAttribute('data-iwac-control', 'laicite-kwic-query');
            var timer = null;
            input.addEventListener('input', function () {
                if (timer) window.clearTimeout(timer);
                timer = window.setTimeout(function () {
                    store.patch({ kwicQuery: input.value });
                }, 200);
            });
            searchWrap.appendChild(input);
            slot.appendChild(searchWrap);
            live.kwicQuery = {
                sync: function () {
                    // Never overwrite what the reader is typing: the store
                    // lags the input by the debounce.
                    var doc = input.ownerDocument || document;
                    if (doc.activeElement === input) return;
                    if (input.value !== (state.kwicQuery || '')) input.value = state.kwicQuery || '';
                }
            };
        }

        return { mount: mount, sync: sync };
    };
})();
