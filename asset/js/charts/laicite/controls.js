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

    var VIEWS = [
        { key: 'overview', labelKey: 'laicite.view_overview' },
        { key: 'trends', labelKey: 'laicite.view_trends' },
        { key: 'documents', labelKey: 'laicite.view_documents' },
        { key: 'concordance', labelKey: 'laicite.view_concordance' }
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
