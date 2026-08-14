/**
 * IWAC Visualizations — Laïcité block: controls row (issue #14).
 *
 * The view toggle plus the per-view facets. Mutates the shared state object
 * in place and calls back into the orchestrator's `draw`, the same contract
 * `scary-terms/controls.js` uses.
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

    /**
     * @param {Object} ctx
     * @param {HTMLElement} ctx.controlsEl
     * @param {Object} ctx.state
     * @param {Object} ctx.metadata
     * @param {Array<string>} ctx.countries
     * @param {Array<string>} ctx.trendsCountries
     * @param {function():void} ctx.draw
     * @param {function():Array<string>} ctx.getConcordanceSubsets
     * @param {function(string):Array<string>} ctx.getConcordanceCountries
     */
    L.createControls = function (ctx) {
        var state = ctx.state;
        var metadata = ctx.metadata || {};

        function render() {
            ctx.controlsEl.innerHTML = '';
            var row = P.el('div', 'iwac-vis-laicite-controls-row');

            // View toggle
            var toggle = P.el('div', 'iwac-vis-laicite-views');
            toggle.setAttribute('role', 'tablist');
            VIEWS.forEach(function (v) {
                var btn = P.el('button', 'iwac-vis-laicite-view-btn', P.t(v.labelKey));
                btn.type = 'button';
                btn.setAttribute('role', 'tab');
                var active = state.view === v.key;
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
                if (active) btn.classList.add('is-active');
                btn.addEventListener('click', function () {
                    if (state.view === v.key) return;
                    state.view = v.key;
                    render();
                    ctx.draw();
                });
                toggle.appendChild(btn);
            });
            row.appendChild(toggle);

            if (state.view === 'trends') {
                renderTrendsControls(row);
            } else if (state.view === 'concordance') {
                renderConcordanceControls(row);
            } else if (state.view === 'collocates') {
                renderCollocateControls(row);
            } else if (state.view === 'actors') {
                renderActorControls(row);
            } else if (state.view === 'arenas') {
                renderArenaControls(row);
            } else if (state.view === 'sentiment') {
                renderSentimentControls(row);
            } else if (state.view === 'map') {
                renderMapControls(row);
            } else if (state.view === 'references') {
                renderReferenceControls(row);
            }

            ctx.controlsEl.appendChild(row);

            var descKey = {
                overview: 'laicite.overview_desc',
                trends: 'laicite.trends_desc',
                documents: 'laicite.documents_desc',
                concordance: 'laicite.concordance_desc'
            }[state.view];
            if (descKey) {
                ctx.controlsEl.appendChild(
                    P.el('p', 'iwac-vis-laicite-view-desc', P.t(descKey)));
            }
        }

        function renderTrendsControls(row) {
            // Axis toggle first: seasonality is a different question from the
            // year series, not a filter on it, and it takes a different set
            // of controls entirely.
            row.appendChild(P.buildSelectControl({
                label: P.t('laicite.axis_years'),
                options: [
                    { value: 'years', label: P.t('laicite.axis_years') },
                    { value: 'seasons', label: P.t('laicite.axis_seasons') }
                ],
                current: state.trendsAxis || 'years',
                idPrefix: 'laicite-trends-axis',
                onChange: function (value) {
                    state.trendsAxis = value;
                    render();
                    ctx.draw();
                }
            }));

            if (state.trendsAxis === 'seasons') {
                // Only the corpus selector applies here. The country and
                // year-scope controls would be inert — the seasonality
                // bundle is per corpus — and rendering them anyway produced
                // two competing "Corpus" dropdowns.
                var seasonSubsets = ctx.getSeasonSubsets() || [];
                if (seasonSubsets.length) {
                    if (seasonSubsets.indexOf(state.seasonSubset) === -1) {
                        state.seasonSubset = seasonSubsets[0];
                    }
                    row.appendChild(P.buildSelectControl({
                        label: P.t('laicite.scope_subset'),
                        options: seasonSubsets.map(function (k) {
                            return { value: k, label: L.subsetLabel(k) };
                        }),
                        current: state.seasonSubset,
                        idPrefix: 'laicite-season-subset',
                        onChange: function (value) {
                            state.seasonSubset = value;
                            ctx.draw();
                        }
                    }));
                }
                return;
            }

            // Country scope. Selecting a corpus clears it and vice versa —
            // the two scopes are alternatives, not a matrix, and offering
            // both at once would imply per-country-per-corpus series the
            // bundle does not carry.
            var countryOptions = [{ value: '', label: P.t('laicite.scope_global') }]
                .concat((ctx.trendsCountries || []).map(function (c) {
                    return { value: c, label: c };
                }));
            row.appendChild(P.buildSelectControl({
                label: P.t('laicite.filter_country'),
                options: countryOptions,
                current: state.trendsCountry || '',
                idPrefix: 'laicite-trends-country',
                onChange: function (value) {
                    state.trendsCountry = value || null;
                    if (value) state.trendsSubset = null;
                    render();
                    ctx.draw();
                }
            }));

            var subsetOptions = [{ value: '', label: P.t('laicite.filter_all') }]
                .concat(L.SUBSETS.map(function (s) {
                    return { value: s, label: L.subsetLabel(s) };
                }));
            row.appendChild(P.buildSelectControl({
                label: P.t('laicite.scope_subset'),
                options: subsetOptions,
                current: state.trendsSubset || '',
                idPrefix: 'laicite-trends-subset',
                onChange: function (value) {
                    state.trendsSubset = value || null;
                    if (value) state.trendsCountry = null;
                    render();
                    ctx.draw();
                }
            }));

            var evtWrap = P.el('label', 'iwac-vis-laicite-check');
            var cb = P.el('input');
            cb.type = 'checkbox';
            cb.checked = !!state.showEvents;
            cb.addEventListener('change', function () {
                state.showEvents = cb.checked;
                ctx.draw();
            });
            evtWrap.appendChild(cb);
            evtWrap.appendChild(P.el('span', null, P.t('laicite.show_events')));
            row.appendChild(evtWrap);
        }

        function renderCollocateControls(row) {
            // `colscope_`, not `scope_`: `laicite.scope_global` is already
            // the trends country selector's "All countries".
            var scopes = (L.COLLOCATE_SCOPES || []).map(function (key) {
                return { value: key, label: P.t('laicite.colscope_' + key) };
            });
            row.appendChild(P.buildSelectControl({
                label: P.t('laicite.scope_slice'),
                options: scopes,
                current: state.colScope,
                idPrefix: 'laicite-col-scope',
                onChange: function (value) {
                    state.colScope = value;
                    state.colSlice = null;
                    render();
                    ctx.draw();
                }
            }));

            var slices = ctx.getCollocateSlices(state.colScope) || [];
            if (slices.length) {
                // Labelled "Showing", not "All": this picker chooses ONE
                // slice, and labelling it "All" said the opposite.
                row.appendChild(P.buildSelectControl({
                    label: P.t('laicite.scope_showing'),
                    options: slices.map(function (k) {
                        return {
                            value: k,
                            label: L.collocateSliceLabel(state.colScope, k)
                        };
                    }),
                    current: state.colSlice || slices[0],
                    idPrefix: 'laicite-col-slice',
                    onChange: function (value) {
                        state.colSlice = value;
                        ctx.draw();
                    }
                }));
            }
        }

        /** Small helper for the Phase 3 facets, which are all one select
         *  writing one state key and redrawing. */
        function simpleSelect(row, cfg) {
            if (!cfg.options.length) return;
            row.appendChild(P.buildSelectControl({
                label: cfg.label,
                options: cfg.options,
                current: state[cfg.stateKey] || '',
                idPrefix: cfg.idPrefix,
                onChange: function (value) {
                    state[cfg.stateKey] = value;
                    // `clears` makes two facets alternatives rather than a
                    // matrix, for bundles that carry the two splits but not
                    // their cross product.
                    if (value && cfg.clears) state[cfg.clears] = '';
                    render();
                    ctx.draw();
                }
            }));
        }

        function withAll(values, label, labelFor) {
            if (!values.length) return [];
            return [{ value: '', label: label }].concat(values.map(function (v) {
                return { value: v, label: labelFor ? labelFor(v) : v };
            }));
        }

        function renderActorControls(row) {
            simpleSelect(row, {
                label: P.t('laicite.filter_type'),
                options: withAll(ctx.getActorTypes() || [],
                    P.t('laicite.filter_all'),
                    function (t) { return P.t('laicite.actor_type_' + t); }),
                stateKey: 'actorType',
                idPrefix: 'laicite-actor-type'
            });
        }

        function renderArenaControls(row) {
            simpleSelect(row, {
                label: P.t('laicite.filter_country'),
                options: withAll(ctx.getArenaCountries() || [],
                    P.t('laicite.scope_global')),
                stateKey: 'arenaCountry',
                idPrefix: 'laicite-arena-country'
            });
        }

        function renderSentimentControls(row) {
            var models = ctx.getSentimentModels() || [];
            if (!models.length) return;
            // No "all" option: the models disagree and averaging them would
            // hide exactly what makes running several of them worth the cost.
            if (models.indexOf(state.sentModel) === -1) {
                state.sentModel = models[0];
            }
            row.appendChild(P.buildSelectControl({
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
                idPrefix: 'laicite-sent-model',
                onChange: function (value) {
                    state.sentModel = value;
                    ctx.draw();
                }
            }));
        }

        function renderMapControls(row) {
            // Frame and country are alternatives, not a matrix: the bundle
            // carries per-frame and per-country splits, not their cross
            // product, so offering both at once would promise a filter the
            // data cannot honour.
            simpleSelect(row, {
                label: P.t('laicite.filter_frame'),
                options: withAll(metadata.frame_order || [],
                    P.t('laicite.filter_all'),
                    function (f) { return L.frameLabel(metadata, f); }),
                stateKey: 'mapFrame',
                idPrefix: 'laicite-map-frame',
                clears: 'mapCountry'
            });
            simpleSelect(row, {
                label: P.t('laicite.filter_country'),
                options: withAll(ctx.getPlaceCountries() || [],
                    P.t('laicite.scope_global')),
                stateKey: 'mapCountry',
                idPrefix: 'laicite-map-country',
                clears: 'mapFrame'
            });
        }

        function renderReferenceControls(row) {
            simpleSelect(row, {
                label: P.t('laicite.filter_type'),
                options: withAll(ctx.getReferenceTypes() || [],
                    P.t('laicite.filter_all')),
                stateKey: 'refType',
                idPrefix: 'laicite-ref-type'
            });
        }

        function renderConcordanceControls(row) {
            var subsets = ctx.getConcordanceSubsets();
            if (subsets.length) {
                row.appendChild(P.buildSelectControl({
                    label: P.t('laicite.scope_subset'),
                    options: subsets.map(function (s) {
                        return { value: s, label: L.subsetLabel(s) };
                    }),
                    current: state.kwicSubset,
                    idPrefix: 'laicite-kwic-subset',
                    onChange: function (value) {
                        state.kwicSubset = value;
                        state.kwicCountry = '';
                        render();
                        ctx.draw();
                    }
                }));
            }

            var frameOptions = [{ value: '', label: P.t('laicite.filter_all') }]
                .concat((metadata.frame_order || []).map(function (f) {
                    return { value: f, label: L.frameLabel(metadata, f) };
                }));
            row.appendChild(P.buildSelectControl({
                label: P.t('laicite.filter_frame'),
                options: frameOptions,
                current: state.kwicFrame || '',
                idPrefix: 'laicite-kwic-frame',
                onChange: function (value) {
                    state.kwicFrame = value || '';
                    ctx.draw();
                }
            }));

            var countries = ctx.getConcordanceCountries(state.kwicSubset) || [];
            if (countries.length > 1) {
                row.appendChild(P.buildSelectControl({
                    label: P.t('laicite.filter_country'),
                    options: [{ value: '', label: P.t('laicite.filter_all') }]
                        .concat(countries.map(function (c) {
                            return { value: c, label: c };
                        })),
                    current: state.kwicCountry || '',
                    idPrefix: 'laicite-kwic-country',
                    onChange: function (value) {
                        state.kwicCountry = value || '';
                        ctx.draw();
                    }
                }));
            }

            var searchWrap = P.el('div', 'iwac-vis-laicite-search');
            var input = P.el('input', 'iwac-vis-control iwac-vis-laicite-search-input');
            input.type = 'search';
            input.placeholder = P.t('laicite.concordance_search');
            input.value = state.kwicQuery || '';
            input.setAttribute('aria-label', P.t('laicite.concordance_search'));
            var timer = null;
            input.addEventListener('input', function () {
                if (timer) window.clearTimeout(timer);
                timer = window.setTimeout(function () {
                    state.kwicQuery = input.value;
                    ctx.draw();
                }, 200);
            });
            searchWrap.appendChild(input);
            row.appendChild(searchWrap);
        }

        return { render: render };
    };
})();
