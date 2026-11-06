/**
 * IWAC Visualizations — Albani Zaria sermons block (orchestrator, issue #31)
 *
 * An exhibition, not a dashboard: short curated sections, each with its
 * instruments and a way back to the recordings.
 *
 *   header      who, what, and how much of it is readable today; the
 *               provenance badges (machine transcription, seed lexicon,
 *               draft glosses); the contents, one link per section
 *   1 corpus    every recording on a date × running-time axis, and listed
 *   2 vocabulary  Hausa exposition / Arabic citation, never pooled; the
 *               formulae as a ledger with their spread across recordings
 *   people and places  a map of the places named, ledgers of the people and
 *               organisations, from a hand-curated list (albani-sermons/entities.js)
 *   3 youth     the lexicon, a recording × category profile, collocates,
 *               network, passages
 *   4 politics  the same instrument on the political lexicon
 *   5 overlap   the score (recording × 20-minute segment), which terms
 *               meet, the words around them, where to listen
 *   6 keyness   signature cards: what sets each recording, period and
 *               segment kind apart
 *   method      how it was made, in plain terms, with its sources
 *               (albani-sermons/method.js)
 *
 * Data: metadata, lexicon and vocabulary (≈ 80 KB) load with the block;
 * every other bundle under files/iwac-visualizations/albani-sermons/ is
 * fetched when its section first nears the viewport (`A.lazy`).
 *
 * One piece of state, the counting scope (all segments, or monologue
 * only), lives in a P.createStore and is URL-addressable; every section
 * subscribes to it.
 *
 * A single-panel embed (`/iwac-embed/albani-sermons/albani-score`) builds
 * the one section that holds its panel, from the bundles that section
 * reads, and renders its deferred part at once: no header, no other
 * section, no other fetch. Each section module claims its panel keys
 * (A.claimPanels), which is how the key finds its section; a key no
 * section claims builds the whole exhibition, and embed.js finds what it
 * can in it, as before.
 *
 * Dependencies (in load order before this file): the block bundle in
 * asset/js/bundles.json — albani-sermons/{i18n,helpers,corpus,vocabulary,
 * theme,overlap,keyness,method}.js.
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

    /** The recording the politics caveat is about: Demokuradiyyah. */
    var DEMOCRACY_RECORDING = '15850';

    /**
     * The sections in page order: the block-level bundles each reads
     * beyond metadata.json (which every one does), and how to build it.
     * Each fetches its own deferred bundles itself (A.lazy).
     */
    var SECTIONS = [
        { key: 'corpus', heading: 'albani_corpus_heading', needs: [],
            build: function (s, b, store, fetch, ctx) { A.renderCorpus(s, b.metadata, ctx); } },
        { key: 'vocabulary', heading: 'albani_vocab_heading', intro: 'albani_vocab_intro', needs: ['vocabulary'],
            build: function (s, b, store) { A.renderVocabulary(s, b.vocabulary, store, b.metadata); } },
        { key: 'entities', heading: 'albani_entities_heading', intro: 'albani_entities_intro', needs: [],
            build: function (s, b, store, fetch, ctx) { A.renderEntities(s, b, store, fetch, ctx); } },
        { key: 'youth', heading: 'albani_youth_heading', intro: 'albani_youth_intro', needs: ['lexicon'],
            build: function (s, b, store, fetch, ctx) { A.renderTheme(s, 'youth', b, store, fetch, ctx); } },
        { key: 'politics', heading: 'albani_politics_heading', intro: 'albani_politics_intro', needs: ['lexicon'],
            build: function (s, b, store, fetch, ctx) {
                // The caveat names Demokuradiyyah (15850), so it waits on that
                // recording alone, not on any re-transcription in progress.
                if ((b.metadata.recordings || []).some(function (r) {
                    return r.o === DEMOCRACY_RECORDING && r.st !== 'analysed';
                })) {
                    s.appendChild(A.note(P.t('albani_politics_caveat'), 'iwac-vis-albani__caveat'));
                }
                A.renderTheme(s, 'politics', b, store, fetch, ctx);
            } },
        { key: 'overlap', heading: 'albani_overlap_heading', intro: 'albani_overlap_intro', needs: ['lexicon'],
            build: function (s, b, store, fetch, ctx) { A.renderOverlap(s, b, store, fetch, ctx); } },
        { key: 'keyness', heading: 'albani_keyness_heading', intro: 'albani_keyness_intro', needs: [],
            build: function (s, b, store, fetch, ctx) { A.renderKeyness(s, b, fetch, ctx); } },
        { key: 'method', heading: 'albani_method', intro: 'albani_method_lead', needs: [],
            build: function (s, b) { A.renderMethod(s, b.metadata); } }
    ];

    /** The section a single-panel embed needs, or null for the whole block. */
    function onlySection(ctx) {
        var key = A.sectionOf(ctx.embedPanel);
        for (var i = 0; i < SECTIONS.length; i++) {
            if (SECTIONS[i].key === key) return SECTIONS[i];
        }
        return null;
    }

    P.bootBlock({
        selector:       '.iwac-vis-albani',
        warnLabel:      'IWACVis.albaniSermons',
        requireECharts: true,
        load: function (ctx) {
            var fetch = A.fetcher(ctx);
            ctx.fetchBundle = fetch;
            var only = onlySection(ctx);
            var names = ['metadata', 'lexicon', 'vocabulary'].filter(function (name) {
                return name === 'metadata' || !only || only.needs.indexOf(name) !== -1;
            });
            return Promise.all(names.map(function (name) { return fetch(name + '.json'); }))
                .then(function (results) {
                    var bundle = {};
                    names.forEach(function (name, i) { bundle[name] = results[i]; });
                    return bundle;
                });
        },
        render: function (container, bundle, ctx) {
            render(container, bundle, ctx);
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
        badges.appendChild(A.badge(P.t('albani_badge_entities'), P.t('albani_badge_entities_hint')));
        if (metadata.gloss_status && metadata.gloss_status !== 'validated') {
            badges.appendChild(A.badge(P.t('albani_badge_glosses'), P.t('albani_badge_glosses_hint')));
        }
        // To the plain-language methods at the foot of the block; its href
        // is set once that section exists.
        badges.appendChild(P.el('a', 'iwac-vis-albani__jump', P.t('albani_method_jump')));
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

        // The contents, filled once the sections exist (render()).
        var toc = P.el('nav', 'iwac-vis-albani__toc');
        toc.setAttribute('aria-label', P.t('albani_toc'));
        toc.appendChild(P.el('p', 'iwac-vis-albani__toc-title', P.t('albani_toc')));
        toc.appendChild(P.el('ol', 'iwac-vis-albani__toc-list'));
        root.appendChild(toc);

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
        // One switch for every chart's translations, rather than a button on
        // each: the choice is the reader's, not the chart's.
        var glosses = P.buildSegmented({
            name: 'albani-glosses',
            label: P.t('albani_glosses_label'),
            active: store.get('glosses'),
            options: [
                { key: 'on', label: P.t('albani_glosses_on') },
                { key: 'off', label: P.t('albani_glosses_off') }
            ],
            onChange: function (key) { store.patch({ glosses: key }); }
        });
        store.subscribe(function () { glosses.set(store.get('glosses')); }, { keys: ['glosses'] });
        scopeRow.appendChild(glosses.root);
        scopeRow.appendChild(A.note(P.t('albani_scope_desc', { count: totals.segments_exchange || 0 }),
            'iwac-vis-albani__scope-desc'));
        root.appendChild(scopeRow);
    }

    function render(container, bundle, ctx) {
        var metadata = bundle.metadata = bundle.metadata || {};
        var params = metadata.params || {};
        var fetch = ctx.fetchBundle || A.fetcher(ctx);
        ctx.siteBase = container.dataset.siteBase || container.dataset.embedBase || ctx.siteBase || '';

        var store = P.createStore({ scope: 'all', glosses: 'on' });
        if (P.bindUrlState) {
            P.bindUrlState(store, {
                prefix: 'albani',
                root: container,
                keys: [
                    { key: 'scope', values: A.SCOPES, default: 'all' },
                    { key: 'glosses', values: ['on', 'off'], default: 'on' }
                ]
            });
        }
        // Registered before any section subscribes, so every redraw the
        // switch triggers already reads the new value.
        A.labelGlosses = store.get('glosses') !== 'off';
        store.subscribe(function () { A.labelGlosses = store.get('glosses') !== 'off'; }, { keys: ['glosses'] });

        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-albani__root');
        container.appendChild(root);

        function section(def) {
            var s = A.section(root, def.key, P.t(def.heading),
                def.intro ? P.t(def.intro, { window: params.overlap_window || 10 }) : '');
            def.build(s, bundle, store, fetch, ctx);
            return s;
        }

        // A single-panel embed: its section alone, its deferred part
        // rendered now — nothing in a frame scrolls it into view. The scope
        // and translation switches live in the header it skips; the URL
        // still sets both.
        var only = onlySection(ctx);
        if (only) {
            P.flushLazy(section(only));
            return;
        }

        header(root, metadata, store);
        SECTIONS.forEach(section);

        // The header's jump link, now that the method section has its id.
        var jump = root.querySelector('.iwac-vis-albani__jump');
        var heading = root.querySelector('[data-iwac-section="method"] > .iwac-vis-section-heading');
        if (jump && heading) jump.href = '#' + heading.id;

        // The contents: one link per section, in page order.
        var list = root.querySelector('.iwac-vis-albani__toc-list');
        root.querySelectorAll('.iwac-vis-albani__section > .iwac-vis-section-heading').forEach(function (h) {
            var li = P.el('li', 'iwac-vis-albani__toc-item');
            var a = P.el('a', 'iwac-vis-albani__toc-link', h.textContent);
            a.href = '#' + h.id;
            li.appendChild(a);
            list.appendChild(li);
        });
    }
})();
