/**
 * IWAC Visualizations — Index Overview: Keywords state manager
 *
 * Tiny pub/sub that holds the Keyword Explorer's filter state
 * (subjects vs spatial, country / newspaper facet, view mode,
 * top-N picker, and the selected-keywords set in compare mode).
 *
 * Intentionally NOT URL-backed — unlike iwac-dashboard's keywords
 * route, this lives inside an Omeka S page block which can be
 * embedded on any page alongside other content. Hijacking the page
 * URL for block-local state would collide with other plugins and
 * muddle shareable URLs. State resets on page reload, which is the
 * correct behavior for an embedded filter.
 *
 * The state object deliberately exposes primitives + a `subscribe`
 * hook so the filters / chart / table modules can stay decoupled
 * (they don't know about each other, they only know the state
 * object).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.index-overview/keywords-state: panels.js must load first');
        return;
    }

    var DEFAULTS = {
        type:       'subject',     // 'subject' | 'spatial'
        facet:      'global',      // 'global' | 'country' | 'newspaper'
        country:    null,          // String or null
        newspaper:  null,          // String or null
        view:       'top',         // 'top' | 'compare'
        topN:       5,             // 3 | 5 | 10
        selected:   []             // array of keyword strings
    };
    var MAX_SELECTED = 10;

    /**
     * @param {{ subjects: Object, spatial: Object, metadata: Object }} datasets
     * @returns {Object} state manager
     */
    function create(datasets) {
        var state = {
            type:       DEFAULTS.type,
            facet:      DEFAULTS.facet,
            country:    DEFAULTS.country,
            newspaper:  DEFAULTS.newspaper,
            view:       DEFAULTS.view,
            topN:       DEFAULTS.topN,
            selected:   DEFAULTS.selected.slice()
        };
        var listeners = [];

        function notify() {
            for (var i = 0; i < listeners.length; i++) {
                try { listeners[i](state, manager); }
                catch (e) { console.error('IWACVis keywords-state listener:', e); }
            }
        }

        var manager = {
            DEFAULTS: DEFAULTS,
            MAX_SELECTED: MAX_SELECTED,

            /** Get a snapshot of the current state (shallow copy). */
            get: function () {
                return {
                    type: state.type,
                    facet: state.facet,
                    country: state.country,
                    newspaper: state.newspaper,
                    view: state.view,
                    topN: state.topN,
                    selected: state.selected.slice()
                };
            },

            /** The active dataset for the current `type`. */
            currentData: function () {
                return state.type === 'spatial' ? datasets.spatial : datasets.subjects;
            },

            /** Metadata block (countries, newspapers, stats). */
            metadata: function () { return datasets.metadata || {}; },

            /**
             * Derive the series selection the chart should render:
             * - in top mode: first N keywords from the available pool
             * - in compare mode: user-selected keywords intersected with
             *   the available pool (so switching facet or type safely
             *   drops keywords that are no longer present in that view)
             *
             * Returns:
             *   {
             *     years:    [...],
             *     keywords: [...],
             *     series:   { keyword: { years, counts } }
             *   }
             */
            derivedSeries: function () {
                var d = this.currentData();
                if (!d) return { years: [], keywords: [], series: {} };
                var years = d.years || [];

                // Pick the right source: global / per-country / per-newspaper
                var availablePool = [];
                var sourceSeries = d.global_series || {};
                if (state.facet === 'country' && state.country) {
                    var c = (d.by_country || {})[state.country];
                    if (c) {
                        availablePool = (c.top_keywords || []).slice();
                        sourceSeries = c.series || {};
                    }
                } else if (state.facet === 'newspaper' && state.newspaper) {
                    var n = (d.by_newspaper || {})[state.newspaper];
                    if (n) {
                        availablePool = (n.top_keywords || []).slice();
                        sourceSeries = n.series || {};
                    }
                } else {
                    availablePool = (d.top_keywords || []).slice();
                }

                var pick;
                if (state.view === 'compare') {
                    pick = state.selected.filter(function (kw) {
                        return Object.prototype.hasOwnProperty.call(sourceSeries, kw);
                    });
                } else {
                    pick = availablePool.slice(0, state.topN);
                }

                // Per-series objects only carry `counts` (aligned to
                // the top-level `years` array) to keep payload size
                // down. Callers should read `years` from the outer
                // return value, not from each series.
                var outSeries = {};
                pick.forEach(function (kw) {
                    var s = sourceSeries[kw];
                    if (s) {
                        outSeries[kw] = { counts: s.counts || [] };
                    }
                });
                return { years: years, keywords: pick, series: outSeries, available: availablePool };
            },

            set: function (key, value) {
                if (!(key in state)) return;

                // Mutually-exclusive resets: switching type clears
                // selections (keyword IDs are not stable across
                // datasets); switching facet clears the secondary
                // country/newspaper filter.
                if (key === 'type' && state.type !== value) {
                    state.selected = [];
                }
                if (key === 'facet' && state.facet !== value) {
                    state.country = null;
                    state.newspaper = null;
                }
                if (key === 'view' && state.view !== value && value === 'top') {
                    // leaving compare mode: keep selection so the user
                    // can swap back without losing picks
                }
                state[key] = value;
                notify();
            },

            toggleKeyword: function (kw, on) {
                var idx = state.selected.indexOf(kw);
                if (on == null) on = idx < 0; // toggle
                if (on) {
                    if (idx >= 0) return; // already selected
                    if (state.selected.length >= MAX_SELECTED) return;
                    state.selected.push(kw);
                    if (state.view !== 'compare') state.view = 'compare';
                } else {
                    if (idx < 0) return;
                    state.selected.splice(idx, 1);
                }
                notify();
            },

            clearSelection: function () {
                if (state.selected.length === 0) return;
                state.selected = [];
                notify();
            },

            clearAll: function () {
                state.type      = DEFAULTS.type;
                state.facet     = DEFAULTS.facet;
                state.country   = DEFAULTS.country;
                state.newspaper = DEFAULTS.newspaper;
                state.view      = DEFAULTS.view;
                state.topN      = DEFAULTS.topN;
                state.selected  = [];
                notify();
            },

            subscribe: function (fn) {
                if (typeof fn !== 'function') return function () {};
                listeners.push(fn);
                return function unsubscribe() {
                    var i = listeners.indexOf(fn);
                    if (i >= 0) listeners.splice(i, 1);
                };
            }
        };

        return manager;
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.keywordsState = { create: create };
})();
