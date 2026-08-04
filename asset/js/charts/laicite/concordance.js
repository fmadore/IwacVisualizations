/**
 * IWAC Visualizations — Laïcité block: Concordance view (issue #14, view 4).
 *
 * The centrepiece: every readable occurrence in context, facetable by corpus,
 * frame, country and free text. The list renderer is the shared
 * `shared/concordance.js`; this file owns the lazy per-corpus fetch, the
 * facet state, and the honest "N of M readable here" line.
 *
 * Corpus bundles fan out into one file each and are fetched on demand, so
 * opening the block costs ~60 KB and only the corpus actually being browsed
 * is transferred.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite concordance: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    /**
     * Create the concordance controller.
     *
     * @param {Object} cfg
     * @param {HTMLElement} cfg.host
     * @param {Object} cfg.index      laicite-concordance.json
     * @param {Object} cfg.metadata
     * @param {string} cfg.dataBase
     * @param {string} cfg.siteBase
     * @param {Object} cfg.state      shared block state
     * @param {function():void} cfg.onChange  re-render request (controls row)
     */
    L.createConcordance = function (cfg) {
        // The controller owns its host element so the orchestrator can mount
        // it without this file knowing anything about view switching.
        var host = cfg.host || P.el('div', 'iwac-vis-laicite-kwic-host');
        var index = cfg.index || {};
        var metadata = cfg.metadata || {};
        // subset → undefined (not requested) | null (failed) | payload
        var cache = {};
        var pending = {};
        var view = null;

        function bySubset(subset) {
            return (index.by_subset || {})[subset] || {};
        }

        function load(subset) {
            if (pending[subset] || cache[subset] !== undefined) return;
            var file = bySubset(subset).file;
            if (!file) { cache[subset] = null; render(); return; }
            pending[subset] = true;
            P.fetchJSON(cfg.dataBase + file)
                .then(function (d) { cache[subset] = d; })
                .catch(function (err) {
                    console.warn('IWACVis.laicite: concordance bundle unavailable',
                        subset, err);
                    cache[subset] = null;
                })
                .then(function () {
                    pending[subset] = false;
                    render();
                });
        }

        /** Rows for the active corpus, after frame / country / text filters. */
        function filteredRows(payload) {
            var state = cfg.state;
            var items = payload.items || [];
            return (payload.rows || []).filter(function (row) {
                if (state.kwicFrame && row.f !== state.kwicFrame) return false;
                if (state.kwicCountry) {
                    var item = items[row.i] || {};
                    if ((item.c || []).indexOf(state.kwicCountry) === -1) return false;
                }
                if (state.kwicQuery
                    && !P.concordanceMatches(row, state.kwicQuery)) return false;
                return true;
            });
        }

        function render() {
            var state = cfg.state;
            var subset = state.kwicSubset;
            host.innerHTML = '';

            var counts = bySubset(subset);
            var payload = cache[subset];

            if (payload === undefined) {
                host.appendChild(P.buildLoadingState('laicite.concordance_loading'));
                load(subset);
                return;
            }
            if (payload === null) {
                host.appendChild(P.buildNoDataState());
                return;
            }

            var rows = filteredRows(payload);

            var summary = P.el('div', 'iwac-vis-laicite-kwic-summary');
            summary.appendChild(P.el('p', 'iwac-vis-laicite-kwic-count',
                P.t('laicite.concordance_count',
                    { count: P.formatNumber(rows.length) })));
            // The honest denominator. Withheld occurrences are a rights fact
            // about the sources, not a gap in the pipeline, and hiding them
            // would let the panel imply the corpus is fully quotable.
            if (counts.withheld) {
                summary.appendChild(P.el('p', 'iwac-vis-laicite-kwic-withheld',
                    P.t('laicite.concordance_withheld',
                        { count: P.formatNumber(counts.withheld) })));
            }
            host.appendChild(summary);

            view = P.buildConcordance({
                rows: rows,
                items: payload.items || [],
                siteBase: cfg.siteBase,
                pageSize: 25,
                emptyKey: 'laicite.concordance_empty',
                labelForFrame: function (row) {
                    return L.frameLabel(metadata, row.f);
                }
            });
            host.appendChild(view.root);
        }

        return {
            host: host,
            render: render,
            /** Which corpora have rows at all — drives the corpus selector. */
            availableSubsets: function () {
                return L.SUBSETS.filter(function (s) {
                    return (bySubset(s).emitted || 0) > 0;
                });
            },
            /** Countries present in the loaded corpus, for the country facet. */
            countriesFor: function (subset) {
                var payload = cache[subset];
                if (!payload) return [];
                var seen = {};
                (payload.items || []).forEach(function (item) {
                    (item.c || []).forEach(function (c) { seen[c] = true; });
                });
                return Object.keys(seen).sort();
            }
        };
    };
})();
