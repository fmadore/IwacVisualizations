/**
 * IWAC Visualizations — Albani Zaria sermons, section 2: vocabulary.
 *
 * Two layers, never pooled: the Hausa exposition and the Arabic citation
 * (a heuristic classification — the Arabic is transliterated), plus the
 * religious formulae counted as phrases. Pooled, the formulae alone would
 * top every list. The word cloud and the frequency list read the same
 * terms; the list carries the dispersion a cloud cannot show. The formulae
 * are a ledger, each with a strip of its rate in every recording.
 *
 * Depends on: albani-sermons/helpers.js, shared/table.js, the word-cloud
 * extension (C.wordcloud falls back to bars without it).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.albaniSermons) return;
    var P = ns.panels;
    var C = ns.chartOptions;
    var A = ns.albaniSermons;

    var CLOUD_WORDS = 120;
    var LIST_WORDS = 40;

    /** Rate bins (per 10,000 words) for the formula strips, on the
     *  module's heat ramp; 0 is the empty cell. */
    var STRIP_BINS = [1, 4, 10];

    function stripBin(rate) {
        if (!rate) return 0;
        for (var i = 0; i < STRIP_BINS.length; i++) {
            if (rate < STRIP_BINS[i]) return i + 1;
        }
        return STRIP_BINS.length + 1;
    }

    /**
     * The formulae as a typeset ledger: the phrase, its count, and a strip
     * with one cell per recording (A.recordingOrder), shaded by its rate
     * there. The strip is what a bar could not say — whether a formula is
     * the preacher's constant habit or the sound of one lesson.
     */
    function formulaLedger(section, metadata, store) {
        var recs = A.recordingOrder(metadata);
        var panel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('albani_formulae'),
            P.t('albani_formulae_desc'), { key: 'albani-formulae' });
        panel.chart.classList.add('iwac-vis-albani__list-host');
        section.appendChild(panel.panel);
        var list = P.el('ol', 'iwac-vis-albani__ledger');
        panel.chart.appendChild(list);
        var key = P.el('p', 'iwac-vis-albani__ledger-key', P.t('albani_formulae_strip_key'));
        panel.panel.appendChild(key);

        function refresh(formulae) {
            var scope = store.get('scope');
            list.innerHTML = '';
            key.hidden = !formulae.some(function (f) { return f.by; });
            formulae.forEach(function (f) {
                var li = P.el('li', 'iwac-vis-albani__ledger-row');
                li.appendChild(P.el('span', 'iwac-vis-albani__ledger-phrase', f.label));
                var count = P.el('span', 'iwac-vis-albani__ledger-count', P.formatNumber(f.n));
                li.appendChild(count);
                li.appendChild(P.el('span', 'iwac-vis-albani__ledger-spread',
                    P.t('albani_formulae_spread', {
                        count: f.r || 0, total: P.formatNumber(recs.length) })));
                // Data built before the strips existed carries no `by`.
                if (!f.by) {
                    list.appendChild(li);
                    return;
                }
                var strip = P.el('span', 'iwac-vis-albani__strip');
                strip.setAttribute('aria-hidden', 'true');
                recs.forEach(function (r) {
                    var n = (f.by || {})[r.o] || 0;
                    var rate = A.per10k(n, A.scopeWords(r, scope));
                    var cell = P.el('span', 'iwac-vis-albani__strip-cell iwac-vis-albani__strip-cell--' + stripBin(rate));
                    cell.title = A.recordingLabel(r) + ' — ' + P.t('albani_formulae_cell', {
                        count: n, rate: P.formatDecimal(rate, 1) });
                    strip.appendChild(cell);
                });
                li.appendChild(strip);
                list.appendChild(li);
            });
        }
        return { refresh: refresh };
    }

    A.renderVocabulary = function (section, vocabulary, store, metadata) {
        var scopes = (vocabulary && vocabulary.scopes) || {};
        var state = { layer: 'ha' };

        function current() {
            var scope = scopes[store.get('scope')] || scopes.all || {};
            return {
                scope: scope,
                layer: ((scope.layers || {})[state.layer]) || { terms: [] }
            };
        }

        var layerControl = P.buildSegmented({
            name: 'albani-layer',
            label: P.t('albani_layer_label'),
            active: state.layer,
            options: [
                { key: 'ha', label: P.t('albani_layer_ha') },
                { key: 'ar', label: P.t('albani_layer_ar') }
            ],
            onChange: function (key) {
                state.layer = key;
                refresh();
            }
        });
        var controls = P.el('div', 'iwac-vis-albani__controls');
        controls.appendChild(layerControl.root);
        controls.appendChild(A.badge(P.t('albani_badge_heuristic')));
        section.appendChild(controls);

        var grid = P.el('div', 'iwac-vis-albani__grid');
        section.appendChild(grid);

        var cloudDesc = P.el('p', 'iwac-vis-panel-desc');
        var cloud = A.chartPanel(grid, P.t('albani_vocab_cloud'), null, function (built) {
            var terms = current().layer.terms || [];
            return C.wordcloud(terms.slice(0, CLOUD_WORDS).map(function (t) { return [t.w, t.n]; }), built.chart);
        }, { key: 'albani-vocab-cloud', before: [cloudDesc], chartClass: 'iwac-vis-albani__cloud' });

        var listPanel = P.buildPanel('iwac-vis-panel', P.t('albani_vocab_list'),
            P.t('albani_vocab_list_desc'), { key: 'albani-vocab-list' });
        listPanel.chart.classList.add('iwac-vis-albani__table-host');
        grid.appendChild(listPanel.panel);
        var table = P.buildTable({
            columns: [
                { key: 'w', label: P.t('albani_col_word'), card: 'title' },
                { key: 'n', label: P.t('albani_col_count'), card: 'row' },
                { key: 's', label: P.t('albani_col_segments'), card: 'row' },
                { key: 'r', label: P.t('albani_col_recordings'), card: 'row' }
            ],
            rows: [],
            pageSize: 10,
            // Four short columns fit a half-width panel; as cards each word
            // took a screenful.
            cards: false
        });
        listPanel.chart.appendChild(table.root);

        var ledger = formulaLedger(section, metadata, store);

        function refresh() {
            var cur = current();
            var share = 0;
            var total = 0;
            Object.keys(cur.scope.layers || {}).forEach(function (k) {
                total += cur.scope.layers[k].running || 0;
            });
            total += cur.scope.formula_tokens || 0;
            if (total) share = ((cur.scope.layers.ar || {}).running || 0) / total * 100;
            cloudDesc.textContent = state.layer === 'ar'
                ? P.t('albani_vocab_cloud_desc_ar', { share: P.formatPercent(share, 2) })
                : P.t('albani_vocab_cloud_desc_ha');
            table.update((cur.layer.terms || []).slice(0, LIST_WORDS).map(function (t) {
                return { w: t.w, n: P.formatNumber(t.n), s: P.formatNumber(t.s), r: P.formatNumber(t.r) };
            }), 0);
            cloud.redraw();
            ledger.refresh(cur.scope.formulae || []);
        }

        refresh();
        store.subscribe(refresh, { keys: ['scope'] });
    };
})();
