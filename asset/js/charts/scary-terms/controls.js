/**
 * IWAC Visualizations — Scary Terms block: controls row.
 *
 * The view toggle, the per-view selects (country scopes, map filters),
 * the events checkbox, and the race playback bar + year slider —
 * extracted from the orchestrator's render() (REFACTORING Tier 3).
 * Selects delegate to the shared P.buildSelectControl; the view toggle is
 * a P.buildSegmented group; the slider is a P.buildYearSlider; the
 * playback timer semantics live in the shared P.createPlaybackTimer,
 * which the orchestrator instantiates and passes in via ctx.playback.
 *
 * Two entry points instead of one `render()`: `mount()` rebuilds the
 * per-view part of the row (only a change of view, or a lazy bundle
 * arriving, calls it) and `sync()` writes the state into the widgets that
 * already exist. Until v1.60.0 every control change re-rendered the whole
 * row from inside its own handler, which destroyed the control under the
 * reader's focus — pressing Play removed the Play button; a `<select>`
 * stepped with the arrow keys was gone on the first keystroke. The
 * handlers now only patch the store; the orchestrator's subscriptions
 * decide what that means for the DOM.
 *
 * Loaded after scary-terms/{i18n,helpers,trends,wordcloud,map}.js,
 * before the orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.scaryTerms controls: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var S = ns.scaryTerms = ns.scaryTerms || {};

    /**
     * The view keys this block offers, in toggle order. Exported so the
     * orchestrator can validate a `?scary.view=` value against the same list
     * the toggle is built from.
     *
     * @param {{hasCooccurrence: boolean}} opts
     * @returns {Array<{key: string, labelKey: string}>}
     */
    S.viewOptions = function (opts) {
        var views = [
            { key: 'race',    labelKey: 'scary.bar_race' },
            { key: 'trends',  labelKey: 'scary.trends' },
            { key: 'country', labelKey: 'scary.by_country' },
            { key: 'global',  labelKey: 'scary.global_view' }
        ];
        // The matrix view is only offered when the cooccurrence bundle is
        // present — older deploys won't have it yet. The wordcloud / map
        // views fetch lazily and show the shared "no data yet" state when
        // their bundle is missing.
        if (opts && opts.hasCooccurrence) {
            views.push({ key: 'matrix', labelKey: 'scary.matrix' });
        }
        views.push({ key: 'wordcloud', labelKey: 'scary.wordcloud' });
        views.push({ key: 'map', labelKey: 'scary.map' });
        return views;
    };

    /**
     * Per-block factory. Everything stateful stays on the orchestrator's
     * store; this module owns only the DOM of the controls row.
     *
     * @param {Object} ctx
     * @param {HTMLElement} ctx.controlsEl   host the row renders into
     * @param {Object} ctx.store             the orchestrator's P.createStore
     * @param {Array<number>} ctx.years
     * @param {Array<string>} ctx.availableCountries
     * @param {Array<string>} ctx.matrixCountries
     * @param {Array<string>} ctx.trendsCountries
     * @param {Array<string>} ctx.families
     * @param {boolean} ctx.hasCooccurrence  offer the matrix view?
     * @param {boolean} ctx.hasEvents        offer the events checkbox?
     * @param {function():Object|null|undefined} ctx.getWordcloudData
     * @param {function():Object|null|undefined} ctx.getPlacesData
     * @param {function():Array<string>} ctx.getMapCountries
     * @param {{play:Function, stop:Function, playing:Function}} ctx.playback
     *   the shared playback timer (P.createPlaybackTimer)
     * @param {HTMLElement} [ctx.trailing]   a persistent element for the end
     *   of the row (the copy-link button)
     * @returns {{mount: function():void, sync: function():void}}
     */
    S.createScaryControls = function (ctx) {
        var store = ctx.store;
        var state = store.state;
        var years = ctx.years;
        var controlsEl = ctx.controlsEl;

        // Persistent skeleton: the row, the view toggle at its head, the
        // per-view slot after it, and whatever the block wants at the end.
        // Everything view-specific goes into `slot` (inside the row) or
        // `tail` (under it) and only those two are cleared on mount.
        var row = null;
        var toggle = null;
        var slot = null;
        var tail = null;
        // Handles to the widgets the current view owns, for sync().
        var live = {};

        /** This block's flavor of the shared labelled-select control. */
        function scarySelect(name, labelText, options, current, onChange) {
            return P.buildSelectControl({
                name: 'scary-' + name,
                label: labelText,
                options: options,
                current: current,
                onChange: onChange,
                groupClass: 'iwac-vis-scary-country-group',
                labelClass: 'iwac-vis-scary-label',
                selectClass: 'iwac-vis-scary-select',
                idPrefix: 'iwac-vis-scary-sel-'
            });
        }

        function withAllOption(values, allLabel) {
            return [{ value: '', label: allLabel }].concat(
                values.map(function (v) { return { value: v, label: v }; }));
        }

        function ensureSkeleton() {
            if (row) return;
            row = P.el('div', 'iwac-vis-scary-controls-row');
            toggle = buildViewToggle();
            row.appendChild(toggle.root);
            slot = P.el('div', 'iwac-vis-controls-slot');
            row.appendChild(slot);
            if (ctx.trailing) row.appendChild(ctx.trailing);
            controlsEl.appendChild(row);
            tail = P.el('div', 'iwac-vis-controls-slot');
            controlsEl.appendChild(tail);
        }

        /**
         * Build the controls for the current view. Focus-safe: if the reader
         * was on a control that exists in the new view too (the toggle, the
         * copy-link button), it keeps focus.
         */
        function mount() {
            ensureSkeleton();
            P.withFocusRestored(controlsEl, function () {
                slot.innerHTML = '';
                tail.innerHTML = '';
                live = {};
                toggle.set(state.view);
                mountView();
            });
        }

        function mountView() {
            if (state.view === 'country' && ctx.availableCountries.length) {
                live.country = scarySelect('country',
                    P.t('scary.country'),
                    ctx.availableCountries.map(function (c) {
                        return { value: c, label: c };
                    }),
                    state.country,
                    function (value) { store.patch({ country: value }); }
                );
                slot.appendChild(live.country);
            }
            if (state.view === 'matrix' && ctx.matrixCountries.length) {
                // Separate selection from the country view — the matrix
                // has an "All countries" choice and a different available
                // list (only slices with enough data are emitted).
                live.matrixCountry = scarySelect('matrix-country',
                    P.t('scary.country'),
                    withAllOption(ctx.matrixCountries, P.t('scary.all_countries')),
                    state.matrixCountry || '',
                    function (value) { store.patch({ matrixCountry: value || null }); }
                );
                slot.appendChild(live.matrixCountry);
            }
            if (state.view === 'matrix') {
                tail.appendChild(buildViewDesc('scary.matrix_description'));
            }
            if (state.view === 'trends') {
                if (ctx.trendsCountries.length) {
                    live.trendsCountry = scarySelect('trends-country',
                        P.t('scary.country'),
                        withAllOption(ctx.trendsCountries, P.t('scary.all_countries')),
                        state.trendsCountry || '',
                        function (value) { store.patch({ trendsCountry: value || null }); }
                    );
                    slot.appendChild(live.trendsCountry);
                }
                if (ctx.hasEvents) {
                    slot.appendChild(buildEventsToggle());
                }
                tail.appendChild(buildViewDesc('scary.trends_description'));
            }
            if (state.view === 'wordcloud') {
                tail.appendChild(buildViewDesc('scary.wordcloud_description'));
                var wordcloudData = ctx.getWordcloudData();
                if (wordcloudData && P.buildFacetButtons) {
                    live.wcFacets = P.buildFacetButtons({
                        facets: S.buildWordcloudFacets(wordcloudData),
                        activeKey: state.wcFacet,
                        activeSubKey: state.wcSub || undefined,
                        onChange: function (evt) {
                            store.patch({ wcFacet: evt.facet, wcSub: evt.subFacet || null });
                        }
                    });
                    tail.appendChild(live.wcFacets.root);
                }
            }
            if (state.view === 'map') {
                if (ctx.getPlacesData()) {
                    // Family and country filters are mutually exclusive —
                    // the bundle has per-family and per-country splits,
                    // not their cross product. The store's reducer clears
                    // the other one; sync() then writes the cleared value
                    // into its select, which stays where it is.
                    live.mapFamily = scarySelect('map-family',
                        P.t('scary.map_family'),
                        withAllOption(ctx.families, P.t('scary.all_families')),
                        state.mapFamily,
                        function (value) { store.patch({ mapFamily: value }); }
                    );
                    slot.appendChild(live.mapFamily);
                    var mapCountries = ctx.getMapCountries();
                    if (mapCountries.length) {
                        live.mapCountry = scarySelect('map-country',
                            P.t('scary.country'),
                            withAllOption(mapCountries, P.t('scary.all_countries')),
                            state.mapCountry,
                            function (value) { store.patch({ mapCountry: value }); }
                        );
                        slot.appendChild(live.mapCountry);
                    }
                }
                tail.appendChild(buildViewDesc('scary.map_description'));
            }
            if (state.view === 'race' && years.length) {
                slot.appendChild(buildPlaybackGroup());
                tail.appendChild(buildSliderRow());
            }
        }

        /**
         * Write the state into the mounted widgets. Cheap, idempotent, and
         * the only thing a non-view change touches in this row.
         */
        function sync() {
            if (!row) return;
            toggle.set(state.view);
            if (live.country) live.country.control.value = state.country || '';
            if (live.matrixCountry) live.matrixCountry.control.value = state.matrixCountry || '';
            if (live.trendsCountry) live.trendsCountry.control.value = state.trendsCountry || '';
            if (live.events) live.events.checked = !!state.showEvents;
            if (live.mapFamily) live.mapFamily.control.value = state.mapFamily || '';
            if (live.mapCountry) live.mapCountry.control.value = state.mapCountry || '';
            if (live.playBtn) paintPlayButton(live.playBtn);
            if (live.yearLabel) live.yearLabel.textContent = String(years[state.yearIdx] || '');
            if (live.slider) live.slider.set(state.yearIdx);
        }

        function buildViewDesc(key) {
            return P.el('p', 'iwac-vis-scary-matrix-desc', P.t(key));
        }

        function buildViewToggle() {
            return P.buildSegmented({
                name: 'scary-view',
                label: P.t('scary.view_mode') + ':',
                options: S.viewOptions({ hasCooccurrence: ctx.hasCooccurrence })
                    .map(function (v) { return { key: v.key, label: P.t(v.labelKey) }; }),
                active: state.view,
                classes: {
                    root: 'iwac-vis-scary-view-toggle',
                    btn: 'iwac-vis-scary-view-btn',
                    active: 'iwac-vis-scary-view-btn--active',
                    label: 'iwac-vis-scary-label'
                },
                onChange: function (key) {
                    // Silent stop: the store notifies the row anyway. Also
                    // clears isPlaying so returning to the race view never
                    // shows a phantom pause button.
                    ctx.playback.stop(true);
                    var changes = { view: key, isPlaying: false };
                    if (key === 'country' && !state.country
                            && ctx.availableCountries.length) {
                        changes.country = ctx.availableCountries[0];
                    }
                    store.patch(changes);
                }
            });
        }

        function buildEventsToggle() {
            var label = P.el('label', 'iwac-vis-scary-check');
            var cb = P.el('input');
            cb.type = 'checkbox';
            cb.checked = state.showEvents;
            cb.setAttribute('data-iwac-control', 'scary-events');
            cb.addEventListener('change', function () {
                store.patch({ showEvents: cb.checked });
            });
            label.appendChild(cb);
            label.appendChild(P.el('span', null, P.t('scary.show_events')));
            live.events = cb;
            return label;
        }

        function paintPlayButton(btn) {
            var playing = !!state.isPlaying;
            btn.textContent = playing ? '⏸' : '▶';
            var title = playing ? P.t('scary.pause') : P.t('scary.play');
            btn.title = title;
            btn.setAttribute('aria-label', title);
            btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
        }

        function buildPlaybackGroup() {
            var group = P.el('div', 'iwac-vis-scary-playback');
            group.appendChild(ctrlButton('prev', '◀', P.t('scary.previous'), function () {
                stepTo(state.yearIdx > 0 ? state.yearIdx - 1 : 0);
            }));
            var playBtn = ctrlButton('play', '▶', P.t('scary.play'), function () {
                if (state.isPlaying) {
                    ctx.playback.stop();      // announced → onStop patches isPlaying
                } else if (state.view === 'race' && years.length) {
                    ctx.playback.play();      // rewinds at end by itself
                }
            });
            playBtn.classList.add('iwac-vis-scary-play-btn');
            paintPlayButton(playBtn);
            live.playBtn = playBtn;
            group.appendChild(playBtn);
            group.appendChild(ctrlButton('next', '▶', P.t('scary.next'), function () {
                stepTo(Math.min(state.yearIdx + 1, years.length - 1));
            }));
            group.appendChild(ctrlButton('reset', '↺', P.t('scary.reset'), function () {
                stepTo(0);
            }));
            var yearLabel = P.el('span', 'iwac-vis-scary-year-label',
                String(years[state.yearIdx] || ''));
            live.yearLabel = yearLabel;
            group.appendChild(yearLabel);
            return group;
        }

        function stepTo(idx) {
            ctx.playback.stop(true);
            store.patch({ yearIdx: idx, isPlaying: false });
        }

        function buildSliderRow() {
            // The shared slider announces the YEAR (aria-valuetext), paints
            // the filled track through the block's CSS variable, and keeps
            // its focus through every move — the row is never rebuilt on
            // input, and the playback tick reaches it through sync().
            live.slider = P.buildYearSlider({
                name: 'scary-year',
                years: years,
                index: state.yearIdx,
                fillVar: '--iwac-vis-scary-fill',
                classes: {
                    row: 'iwac-vis-scary-slider-row',
                    edge: 'iwac-vis-scary-slider-edge',
                    input: 'iwac-vis-scary-slider'
                },
                onInput: function (idx) {
                    ctx.playback.stop(true);
                    store.patch({ yearIdx: idx, isPlaying: false });
                }
            });
            return live.slider.root;
        }

        function ctrlButton(name, glyph, title, handler) {
            var btn = P.el('button', 'iwac-vis-scary-ctrl-btn', glyph);
            btn.type = 'button';
            btn.title = title;
            btn.setAttribute('aria-label', title);
            btn.setAttribute('data-iwac-control', 'scary-' + name);
            btn.addEventListener('click', handler);
            return btn;
        }

        return { mount: mount, sync: sync };
    };
})();
