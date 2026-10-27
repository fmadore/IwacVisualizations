/**
 * IWAC Visualizations — Albani Zaria sermons block (orchestrator, issue #31)
 *
 * An exhibition, not a dashboard: short curated sections, each with its
 * instruments and a way back to the recordings.
 *
 *   header      who, what, and how much of it is readable today; the
 *               provenance badges (machine transcription, seed lexicon)
 *   1 corpus    every recording on a date × running-time axis, and listed
 *   2 vocabulary  Hausa exposition / Arabic citation, never pooled; formulae
 *   3 youth     the lexicon, its intensity, collocates, network, passages
 *   4 politics  the same instrument on the political lexicon
 *   5 overlap   where the two vocabularies meet
 *   6 keyness   what sets each recording, period and segment kind apart
 *   method      how the figures are made
 *
 * Data: metadata, lexicon and vocabulary (≈ 80 KB) load with the block;
 * every other bundle under files/iwac-visualizations/albani-sermons/ is
 * fetched when its section first nears the viewport (`A.lazy`).
 *
 * One piece of state, the counting scope (all segments, or monologue
 * only), lives in a P.createStore and is URL-addressable; every section
 * subscribes to it.
 *
 * Dependencies (in load order before this file): the block bundle in
 * asset/js/bundles.json — albani-sermons/{i18n,helpers,corpus,vocabulary,
 * theme,overlap,keyness}.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions || !ns.albaniSermons) {
        console.warn('IWACVis.albaniSermons: missing panels, chartOptions or helpers — check script load order');
        return;
    }
    var P = ns.panels;
    var A = ns.albaniSermons;

    P.bootBlock({
        selector:       '.iwac-vis-albani',
        warnLabel:      'IWACVis.albaniSermons',
        requireECharts: true,
        load: function (ctx) {
            var fetch = A.fetcher(ctx);
            ctx.fetchBundle = fetch;
            return Promise.all([
                fetch('metadata.json'),
                fetch('lexicon.json'),
                fetch('vocabulary.json')
            ]);
        },
        render: function (container, results, ctx) {
            render(container, {
                metadata: results[0],
                lexicon: results[1],
                vocabulary: results[2]
            }, ctx);
        }
    });

    function header(root, metadata, store) {
        var totals = metadata.totals || {};
        var head = P.el('div', 'iwac-vis-block-header iwac-vis-albani__header');
        head.appendChild(P.el('h3', 'iwac-vis-block-header__title', P.t('albani_title')));
        head.appendChild(P.el('p', 'iwac-vis-block-header__desc', P.t('albani_intro')));
        root.appendChild(head);

        var badges = P.el('div', 'iwac-vis-albani__badges');
        badges.appendChild(A.badge(P.t('albani_badge_asr'), P.t('albani_badge_asr_hint')));
        if (metadata.lexicon_status !== 'validated') {
            badges.appendChild(A.badge(P.t('albani_badge_seed'), P.t('albani_badge_seed_hint')));
        }
        root.appendChild(badges);

        root.appendChild(P.buildSummaryCards([
            { value: totals.recordings, labelKey: 'albani_kpi_recordings' },
            { value: totals.analysed, labelKey: 'albani_kpi_analysed', featured: true },
            { value: P.formatTotalDuration(totals.seconds_analysed), labelKey: 'albani_kpi_hours', text: true },
            { value: totals.words, labelKey: 'albani_kpi_words' },
            { value: totals.segments, labelKey: 'albani_kpi_segments' }
        ]));

        var status = P.el('div', 'iwac-vis-albani__status');
        status.appendChild(A.note(P.t('albani_status', {
            analysed: P.formatNumber(totals.analysed || 0),
            total: P.formatNumber(totals.recordings || 0)
        })));
        var legacy = (metadata.recordings || []).filter(function (r) { return r.st === 'legacy'; });
        if (legacy.length) {
            status.appendChild(A.note(P.t('albani_status_legacy', {
                titles: legacy.map(function (r) { return r.t; }).join(', ')
            })));
        }
        if (totals.untranscribed) {
            status.appendChild(A.note(P.t('albani_status_untranscribed', { count: totals.untranscribed })));
        }
        root.appendChild(status);

        // The counting scope: every section reads it.
        var scopeRow = P.el('div', 'iwac-vis-albani__scope');
        var control = P.buildSegmented({
            name: 'albani-scope',
            label: P.t('albani_scope_label'),
            active: store.get('scope'),
            options: [
                { key: 'all', label: P.t('albani_scope_all') },
                { key: 'monologue', label: P.t('albani_scope_monologue') }
            ],
            onChange: function (key) { store.patch({ scope: key }); }
        });
        store.subscribe(function () { control.set(store.get('scope')); }, { keys: ['scope'] });
        scopeRow.appendChild(control.root);
        scopeRow.appendChild(A.note(P.t('albani_scope_desc', { count: totals.segments_exchange || 0 }),
            'iwac-vis-albani__scope-desc'));
        root.appendChild(scopeRow);
    }

    function render(container, bundle, ctx) {
        var metadata = bundle.metadata || {};
        var params = metadata.params || {};
        var fetch = ctx.fetchBundle || A.fetcher(ctx);
        ctx.siteBase = container.dataset.siteBase || container.dataset.embedBase || ctx.siteBase || '';

        var store = P.createStore({ scope: 'all' });
        if (P.bindUrlState) {
            P.bindUrlState(store, {
                prefix: 'albani',
                keys: [{ key: 'scope', values: A.SCOPES, default: 'all' }]
            });
        }

        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-albani__root');
        container.appendChild(root);

        header(root, metadata, store);

        A.renderCorpus(A.section(root, 'corpus', P.t('albani_corpus_heading')), metadata, ctx);
        A.renderVocabulary(A.section(root, 'vocabulary', P.t('albani_vocab_heading'),
            P.t('albani_vocab_intro')), bundle.vocabulary, store);

        A.renderTheme(A.section(root, 'youth', P.t('albani_youth_heading'), P.t('albani_youth_intro')),
            'youth', bundle, store, fetch, ctx);

        var politics = A.section(root, 'politics', P.t('albani_politics_heading'), P.t('albani_politics_intro'));
        if ((metadata.recordings || []).some(function (r) { return r.st === 'legacy'; })) {
            politics.appendChild(A.note(P.t('albani_politics_caveat'), 'iwac-vis-albani__caveat'));
        }
        A.renderTheme(politics, 'politics', bundle, store, fetch, ctx);

        A.renderOverlap(A.section(root, 'overlap', P.t('albani_overlap_heading'),
            P.t('albani_overlap_intro', { window: params.overlap_window || 10 })), bundle, store, fetch, ctx);
        A.renderKeyness(A.section(root, 'keyness', P.t('albani_keyness_heading'),
            P.t('albani_keyness_intro')), bundle, fetch);

        var method = P.el('details', 'iwac-vis-albani__method');
        method.appendChild(P.el('summary', null, P.t('albani_method')));
        method.appendChild(P.el('p', null, P.t('albani_method_body')));
        root.appendChild(method);
    }
})();
