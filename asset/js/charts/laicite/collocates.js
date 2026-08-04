/**
 * IWAC Visualizations — Laïcité block: Collocates view (issue #14, view 5).
 *
 * What laïcité keeps company with, and when that changed. Log-likelihood
 * scored over a ±5-token window, ranked by log-ratio effect size, sliceable
 * globally / by decade / by country / by corpus.
 *
 * Rendered as a ranked list with proportional bars rather than a chart: a
 * keyness result is a ranking with several numbers per row (effect size,
 * raw count, document spread, whether the token is a catalogued name), and
 * a bar chart shows one of them while hiding the rest. The list keeps all
 * four visible and stays readable to a screen reader.
 *
 * Also renders the implicit-lexicon panel, which shares the same statistical
 * machinery and — measured — reports a negative result.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite collocates: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    L.COLLOCATE_SCOPES = [
        'global', 'by_source_type', 'by_subset', 'by_decade', 'by_country'
    ];

    /** The slice keys available for the active scope. */
    L.collocateSlices = function (bundle, scope) {
        if (!bundle || scope === 'global') return [];
        return Object.keys(bundle[scope] || {}).sort();
    };

    /**
     * Display label for one slice key. Corpus and source-type keys are
     * translated; decades and country names are already display-ready.
     */
    L.collocateSliceLabel = function (scope, key) {
        if (scope === 'by_subset') return L.subsetLabel(key);
        if (scope === 'by_source_type') return P.t('laicite.source_' + key);
        return key;
    };

    /** Rows for the active scope + slice. */
    function rowsFor(bundle, state) {
        if (!bundle) return [];
        if (state.colScope === 'global') return bundle.global || [];
        var group = bundle[state.colScope] || {};
        var key = state.colSlice && group[state.colSlice]
            ? state.colSlice
            : Object.keys(group).sort()[0];
        return group[key] || [];
    }

    /**
     * @param {Object} cfg {bundle, implicit, metadata, state, siteBase}
     */
    L.buildCollocates = function (cfg) {
        var bundle = cfg.bundle;
        var host = P.el('div', 'iwac-vis-laicite-collocates');

        var panel = P.el('div', 'iwac-vis-panel');
        panel.appendChild(P.el('h4', null, P.t('laicite.collocates_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.collocates_desc')));

        if (!bundle) {
            panel.appendChild(P.buildNoDataState());
            host.appendChild(panel);
            return host;
        }

        var scope = cfg.state.colScope;
        var rows = rowsFor(bundle, cfg.state);
        if (!rows.length) {
            panel.appendChild(P.buildEmptyState('laicite.collocates_empty'));
        } else {
            panel.appendChild(buildRankedList(rows));
        }

        // Method note. A keyness panel that does not say what it was scored
        // against is unreadable as evidence, so the reference corpus and the
        // temporal caveat are stated inline rather than left to the docs.
        // The bundle carries an English prose copy of each note for anyone
        // reading the JSON directly; the panel renders the catalog so the
        // French site is not half-translated.
        var method = P.el('div', 'iwac-vis-laicite-method');
        method.appendChild(P.el('p', null, P.t('laicite.collocates_reference')));
        if (scope === 'by_source_type') {
            method.appendChild(P.el('p', null,
                P.t('laicite.collocates_source_scope')));
        }
        if (scope === 'by_decade') {
            method.appendChild(P.el('p', null,
                P.t('laicite.collocates_decade_scope')));
        }
        // A corpus that is offered nowhere in the picker has to be accounted
        // for, or its absence reads as "nothing to see" instead of "too few
        // documents to test". Same rule the generator follows when it logs
        // its dropped slices.
        var dropped = bundle.dropped_slices || {};
        if (scope === 'by_subset' && (dropped.subsets || []).length) {
            method.appendChild(P.el('p', 'iwac-vis-laicite-method-dropped',
                P.t('laicite.collocates_dropped', {
                    slices: dropped.subsets.map(function (k) {
                        return L.subsetLabel(k);
                    }).join(', '),
                    docs: bundle.min_document_frequency
                })));
        }
        method.appendChild(P.el('p', 'iwac-vis-laicite-method-stats',
            P.t('laicite.collocates_method', {
                window: bundle.window,
                docs: bundle.min_document_frequency
            })));
        panel.appendChild(method);
        host.appendChild(panel);

        host.appendChild(L.buildImplicitPanel(cfg.implicit));
        return host;
    };

    function buildRankedList(rows) {
        var max = rows.reduce(function (m, r) {
            return Math.max(m, r.log_ratio || 0);
        }, 0) || 1;

        var list = P.el('ol', 'iwac-vis-laicite-collocate-list');
        rows.forEach(function (row) {
            var li = P.el('li', 'iwac-vis-laicite-collocate');

            var head = P.el('div', 'iwac-vis-laicite-collocate-head');
            head.appendChild(P.el('span', 'iwac-vis-laicite-collocate-token',
                row.token));
            // Catalogued entity names are kept and flagged rather than
            // dropped — "who was speaking laïcité in this decade" is a
            // finding, but the reader should know it is a name.
            if (row.proper) {
                head.appendChild(L.chip(P.t('laicite.is_name'), 'is-name',
                    P.t('laicite.is_name_hint')));
            }
            li.appendChild(head);

            var bar = P.el('div', 'iwac-vis-laicite-collocate-bar');
            var fill = P.el('span', 'iwac-vis-laicite-collocate-fill');
            fill.style.width = Math.max(2, (row.log_ratio / max) * 100) + '%';
            bar.appendChild(fill);
            li.appendChild(bar);

            var meta = P.el('p', 'iwac-vis-laicite-collocate-meta');
            meta.textContent = P.t('laicite.collocate_stats', {
                lr: (row.log_ratio || 0).toFixed(2),
                count: P.formatNumber(row.count || 0),
                docs: P.formatNumber(row.documents || 0)
            });
            li.appendChild(meta);
            list.appendChild(li);
        });
        return list;
    }

    /**
     * The implicit-lexicon panel (review idea A).
     *
     * Branches on the generator's verdict. When no shared vocabulary was
     * found it states that plainly and shows the evidence — the
     * document-spread histogram — instead of rendering a ranked list of
     * single-document words, which would read as a discovery when it is the
     * opposite of one.
     */
    L.buildImplicitPanel = function (implicit) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-laicite-implicit');
        panel.appendChild(P.el('h4', null, P.t('laicite.implicit_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.implicit_desc')));

        if (!implicit) {
            panel.appendChild(P.buildNoDataState());
            return panel;
        }

        var sizes = implicit.slice_sizes || {};
        panel.appendChild(P.el('p', 'iwac-vis-laicite-implicit-sizes',
            P.t('laicite.implicit_sizes', {
                tagged: P.formatNumber(sizes.tagged_only || 0),
                said: P.formatNumber(sizes.said || 0)
            })));

        if (implicit.has_vocabulary && (implicit.terms || []).length) {
            panel.appendChild(buildRankedList(implicit.terms));
            return panel;
        }

        var verdict = P.el('div', 'iwac-vis-laicite-verdict');
        verdict.appendChild(P.el('p', 'iwac-vis-laicite-verdict-text',
            P.t('laicite.implicit_negative')));
        var d = implicit.diagnostics || {};
        verdict.appendChild(P.el('p', 'iwac-vis-laicite-verdict-stats',
            P.t('laicite.implicit_diagnostics', {
                significant: d.significant_terms || 0,
                surviving: d.surviving_terms || 0,
                docs: implicit.min_documents || 0
            })));
        verdict.appendChild(buildSpread(d.document_spread || {}));
        panel.appendChild(verdict);
        return panel;
    };

    /** The histogram that carries the negative result's whole argument:
     *  significant terms piled at "appears in exactly 1 document". */
    function buildSpread(spread) {
        var keys = ['1', '2', '3', '4', '5'];
        var max = keys.reduce(function (m, k) {
            return Math.max(m, spread[k] || 0);
        }, 0) || 1;
        var wrap = P.el('div', 'iwac-vis-laicite-spread');
        wrap.appendChild(P.el('p', 'iwac-vis-laicite-spread-title',
            P.t('laicite.implicit_spread')));
        var chart = P.el('div', 'iwac-vis-laicite-spread-bars');
        keys.forEach(function (k) {
            var n = spread[k] || 0;
            var col = P.el('div', 'iwac-vis-laicite-spread-col');
            var bar = P.el('span', 'iwac-vis-laicite-spread-bar');
            bar.style.height = Math.max(2, (n / max) * 100) + '%';
            col.appendChild(P.el('span', 'iwac-vis-laicite-spread-n', String(n)));
            col.appendChild(bar);
            col.appendChild(P.el('span', 'iwac-vis-laicite-spread-label',
                k === '5' ? '5+' : k));
            chart.appendChild(col);
        });
        wrap.appendChild(chart);
        wrap.appendChild(P.el('p', 'iwac-vis-laicite-spread-axis',
            P.t('laicite.implicit_spread_axis')));
        return wrap;
    }
})();
