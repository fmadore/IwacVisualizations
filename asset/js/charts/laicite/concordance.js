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
     * Does this item join the dossier on evidence a reader should treat as
     * weak? Two cases, both established by the September 2026 screen: a
     * single core-vocabulary hit (read as substantively about laïcité about
     * three times in four), and a scholarly record whose only hits sit in a
     * bibliography.
     *
     * Bundles generated before the route fields existed carry neither key,
     * so every item reads as strong and the strict filter hides nothing —
     * which is the honest behaviour when the evidence is simply unknown.
     */
    L.isWeakMember = function (item) {
        if (!item) return false;
        return item.s === 'text=1' || !!item.b;
    };

    /**
     * Badges for the shared renderer's `itemBadges` hook. Only weakness is
     * marked: a tag+text or title-hit item is the unremarkable case, and a
     * badge on every line would carry no information.
     */
    L.concordanceItemBadges = function (item) {
        var badges = [];
        if (!item) return badges;
        if (item.s === 'text=1') {
            badges.push({
                label: P.t('laicite.badge_single_mention'),
                className: 'is-single',
                title: P.t('laicite.badge_single_mention_hint')
            });
        }
        if (item.b) {
            badges.push({
                label: P.t('laicite.badge_bibliography'),
                className: 'is-bibliography',
                title: P.t('laicite.badge_bibliography_hint')
            });
        }
        return badges;
    };

    /**
     * Rows for one corpus after every facet, plus how many RECORDS the
     * strict filter removed. Pure, and exported, because the count in the
     * summary line and the rows in the list have to come from one pass:
     * computing them separately is how a "3 records hidden" line ends up
     * over a list that still shows them.
     *
     * @param {Object} payload  a per-corpus concordance bundle
     * @param {Object} state    the block state
     * @returns {{rows: Array<Object>, hiddenRecords: number}}
     */
    L.filterConcordanceRows = function (payload, state) {
        payload = payload || {};
        state = state || {};
        var items = payload.items || [];
        var rows = [];
        var hidden = {};
        (payload.rows || []).forEach(function (row) {
            if (state.kwicFrame && row.f !== state.kwicFrame) return;
            var item = items[row.i] || {};
            if (state.kwicCountry
                && (item.c || []).indexOf(state.kwicCountry) === -1) return;
            if (state.kwicQuery
                && !P.concordanceMatches(row, state.kwicQuery)) return;
            // Last, so the count reports what the STRICT rule removed from
            // what the reader's other facets had already selected.
            if (state.kwicStrict && L.isWeakMember(item)) {
                hidden[row.i] = true;
                return;
            }
            rows.push(row);
        });
        return { rows: rows, hiddenRecords: Object.keys(hidden).length };
    };

    /**
     * Create the concordance controller.
     *
     * @param {Object} cfg
     * @param {HTMLElement} [cfg.host]  defaults to a fresh element
     * @param {Object} cfg.index      laicite-concordance.json
     * @param {Object} cfg.metadata
     * @param {string} cfg.dataBase
     * @param {string} cfg.siteBase
     * @param {Object} cfg.state      shared block state
     * @param {function():void} [cfg.onLoaded]  a corpus bundle settled
     *        (loaded or failed) — the controls row re-syncs, since the
     *        country facet's options come from the loaded corpus
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
                    if (cfg.onLoaded) cfg.onLoaded();
                    render();
                });
        }

        /** Rows for the active corpus, after frame / country / text / strict. */
        function filteredRows(payload) {
            return L.filterConcordanceRows(payload, cfg.state);
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

            var filtered = filteredRows(payload);
            var rows = filtered.rows;

            var summary = P.el('div', 'iwac-vis-laicite-kwic-summary');
            summary.appendChild(P.el('p', 'iwac-vis-laicite-kwic-count',
                P.t('laicite.concordance_count', { count: rows.length })));
            // What the strict filter is costing, stated rather than left for
            // the reader to infer from a shorter list.
            if (filtered.hiddenRecords) {
                summary.appendChild(P.el('p', 'iwac-vis-laicite-kwic-hidden',
                    P.t('laicite.concordance_strict_hidden',
                        { count: filtered.hiddenRecords })));
            }
            // The honest denominator. Withheld occurrences are a rights fact
            // about the sources, not a gap in the pipeline, and hiding them
            // would let the panel imply the corpus is fully quotable.
            if (counts.withheld) {
                summary.appendChild(P.el('p', 'iwac-vis-laicite-kwic-withheld',
                    P.t('laicite.concordance_withheld', { count: counts.withheld })));
            }
            host.appendChild(summary);

            view = P.buildConcordance({
                rows: rows,
                items: payload.items || [],
                siteBase: cfg.siteBase,
                pageSize: 25,
                emptyKey: 'laicite.concordance_empty',
                taggedHintKey: 'concordance.tagged_hint',
                itemBadges: L.concordanceItemBadges,
                labelForField: function (row) {
                    return P.t('laicite.field_' + row.d);
                },
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
