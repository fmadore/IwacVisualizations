/**
 * IWAC Visualizations — Scary Terms block: controls row.
 *
 * The view toggle, the per-view selects (country scopes, map filters),
 * the events checkbox, and the race playback bar + year slider —
 * extracted from the orchestrator's render() (REFACTORING Tier 3).
 * Selects delegate to the shared P.buildSelectControl; the playback
 * timer semantics live in the shared P.createPlaybackTimer, which the
 * orchestrator instantiates and passes in via ctx.playback.
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
     * Per-block factory. Everything stateful stays on the orchestrator's
     * `ctx.state`; this module owns only the DOM of the controls row.
     *
     * @param {Object} ctx
     * @param {HTMLElement} ctx.controlsEl   host the row renders into
     * @param {Object} ctx.state             the orchestrator's view state
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
     * @param {function():void} ctx.draw
     * @param {{play:Function, stop:Function, playing:Function}} ctx.playback
     *   the shared playback timer (P.createPlaybackTimer)
     * @returns {{render: function():void, syncSliderPosition: function():void}}
     */
    S.createScaryControls = function (ctx) {
        var state = ctx.state;
        var years = ctx.years;
        var controlsEl = ctx.controlsEl;

        /** This block's flavor of the shared labelled-select control. */
        function scarySelect(labelText, options, current, onChange) {
            return P.buildSelectControl({
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

        function render() {
            controlsEl.innerHTML = '';
            var row = P.el('div', 'iwac-vis-scary-controls-row');
            controlsEl.appendChild(row);

            row.appendChild(buildViewToggle());

            if (state.view === 'country' && ctx.availableCountries.length) {
                row.appendChild(scarySelect(
                    P.t('scary.country'),
                    ctx.availableCountries.map(function (c) {
                        return { value: c, label: c };
                    }),
                    state.country,
                    function (value) {
                        state.country = value;
                        ctx.draw();
                    }
                ));
            }
            if (state.view === 'matrix' && ctx.matrixCountries.length) {
                // Separate selection from the country view — the matrix
                // has an "All countries" choice and a different available
                // list (only slices with enough data are emitted).
                row.appendChild(scarySelect(
                    P.t('scary.country'),
                    withAllOption(ctx.matrixCountries, P.t('scary.all_countries')),
                    state.matrixCountry || '',
                    function (value) {
                        state.matrixCountry = value || null;
                        ctx.draw();
                    }
                ));
            }
            if (state.view === 'matrix') {
                controlsEl.appendChild(buildViewDesc('scary.matrix_description'));
            }
            if (state.view === 'trends') {
                if (ctx.trendsCountries.length) {
                    row.appendChild(scarySelect(
                        P.t('scary.country'),
                        withAllOption(ctx.trendsCountries, P.t('scary.all_countries')),
                        state.trendsCountry || '',
                        function (value) {
                            state.trendsCountry = value || null;
                            ctx.draw();
                        }
                    ));
                }
                if (ctx.hasEvents) {
                    row.appendChild(buildEventsToggle());
                }
                controlsEl.appendChild(buildViewDesc('scary.trends_description'));
            }
            if (state.view === 'wordcloud') {
                controlsEl.appendChild(buildViewDesc('scary.wordcloud_description'));
                var wordcloudData = ctx.getWordcloudData();
                if (wordcloudData && P.buildFacetButtons) {
                    var facetBar = P.buildFacetButtons({
                        facets: S.buildWordcloudFacets(wordcloudData),
                        activeKey: state.wcFacet,
                        onChange: function (evt) {
                            state.wcFacet = evt.facet;
                            state.wcSub = evt.subFacet || null;
                            ctx.draw();
                        }
                    });
                    controlsEl.appendChild(facetBar.root);
                }
            }
            if (state.view === 'map') {
                if (ctx.getPlacesData()) {
                    // Family and country filters are mutually exclusive —
                    // the bundle has per-family and per-country splits,
                    // not their cross product. Selecting one resets the
                    // other.
                    row.appendChild(scarySelect(
                        P.t('scary.map_family'),
                        withAllOption(ctx.families, P.t('scary.all_families')),
                        state.mapFamily,
                        function (value) {
                            state.mapFamily = value;
                            if (value) state.mapCountry = '';
                            render();
                            ctx.draw();
                        }
                    ));
                    var mapCountries = ctx.getMapCountries();
                    if (mapCountries.length) {
                        row.appendChild(scarySelect(
                            P.t('scary.country'),
                            withAllOption(mapCountries, P.t('scary.all_countries')),
                            state.mapCountry,
                            function (value) {
                                state.mapCountry = value;
                                if (value) state.mapFamily = '';
                                render();
                                ctx.draw();
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
            group.appendChild(P.el('span', 'iwac-vis-scary-label',
                P.t('scary.view_mode') + ':'));
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
            if (ctx.hasCooccurrence) {
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
                    // Silent stop: render() below repaints the controls
                    // anyway. Also clears isPlaying so returning to the
                    // race view never shows a phantom pause button.
                    ctx.playback.stop(true);
                    state.isPlaying = false;
                    state.view = v.key;
                    if (v.key === 'country' && !state.country
                            && ctx.availableCountries.length) {
                        state.country = ctx.availableCountries[0];
                    }
                    render();
                    ctx.draw();
                });
                group.appendChild(btn);
            });
            return group;
        }

        function buildEventsToggle() {
            var label = P.el('label', 'iwac-vis-scary-check');
            var cb = P.el('input');
            cb.type = 'checkbox';
            cb.checked = state.showEvents;
            cb.addEventListener('change', function () {
                state.showEvents = cb.checked;
                ctx.draw();
            });
            label.appendChild(cb);
            label.appendChild(P.el('span', null, P.t('scary.show_events')));
            return label;
        }

        function buildPlaybackGroup() {
            var group = P.el('div', 'iwac-vis-scary-playback');
            group.appendChild(ctrlButton('◀', P.t('scary.previous'), function () {
                stepTo(state.yearIdx > 0 ? state.yearIdx - 1 : 0);
            }));
            var playBtn = ctrlButton(
                state.isPlaying ? '⏸' : '▶',
                state.isPlaying ? P.t('scary.pause') : P.t('scary.play'),
                function () {
                    if (state.isPlaying) {
                        ctx.playback.stop();      // announced → onStop re-renders
                    } else if (state.view === 'race' && years.length) {
                        ctx.playback.play();      // rewinds at end by itself
                    }
                }
            );
            playBtn.classList.add('iwac-vis-scary-play-btn');
            group.appendChild(playBtn);
            group.appendChild(ctrlButton('▶', P.t('scary.next'), function () {
                stepTo(Math.min(state.yearIdx + 1, years.length - 1));
            }));
            group.appendChild(ctrlButton('↺', P.t('scary.reset'), function () {
                stepTo(0);
            }));
            var yearLabel = P.el('span', 'iwac-vis-scary-year-label',
                String(years[state.yearIdx] || ''));
            group.appendChild(yearLabel);
            return group;
        }

        function stepTo(idx) {
            ctx.playback.stop(true);
            state.isPlaying = false;
            state.yearIdx = idx;
            render();
            ctx.draw();
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
                // Silent stop + targeted label update: re-rendering the
                // whole controls block here would steal the slider focus.
                ctx.playback.stop(true);
                state.isPlaying = false;
                state.yearIdx = parseInt(slider.value, 10) || 0;
                syncSliderFill(slider);
                var yearLabel = controlsEl.querySelector('.iwac-vis-scary-year-label');
                if (yearLabel) yearLabel.textContent = String(years[state.yearIdx]);
                ctx.draw();
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

        /** Move the slider + year label to state.yearIdx without a full
         *  re-render — the per-tick path during playback. */
        function syncSliderPosition() {
            var slider = controlsEl.querySelector('.iwac-vis-scary-slider');
            if (slider) {
                slider.value = String(state.yearIdx);
                syncSliderFill(slider);
            }
            var yearLabel = controlsEl.querySelector('.iwac-vis-scary-year-label');
            if (yearLabel) yearLabel.textContent = String(years[state.yearIdx]);
        }

        return { render: render, syncSliderPosition: syncSliderPosition };
    };
})();
