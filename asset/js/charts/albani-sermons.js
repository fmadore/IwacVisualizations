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
 * The exhibition can be spread over a page and its sub-pages: each block
 * shows the sections its Sections setting names (`data-sections`; all when
 * absent), and fetches only the bundles those read. Such a block is also
 * told which page shows which section (`data-pages`, built server-side
 * from every Albani block on the site), so its contents, its "How this was
 * made" link and the previous/next links at its foot reach the other
 * pages, carrying the reader's `albani.*` choices. The introduction and the
 * figures go with the recordings section; the badges, contents and
 * switches go on every page.
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
            build: function (s, b, store, fetch, ctx) { A.renderKeyness(s, b, store, fetch, ctx); } },
        { key: 'rhetoric', heading: 'albani_rhetoric_heading', intro: 'albani_rhetoric_intro', needs: [],
            build: function (s, b, store, fetch, ctx) { A.renderRhetoric(s, b, store, fetch, ctx); } },
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

    /**
     * The sections this block shows, in page order: the editor's choice
     * (`data-sections`, the block's Sections setting), or every section when
     * there is none or it names nothing this file knows.
     */
    function chosenSections(container) {
        var raw = ((container && container.dataset.sections) || '').split(',')
            .map(function (s) { return s.trim(); });
        var picked = SECTIONS.filter(function (def) { return raw.indexOf(def.key) !== -1; });
        return picked.length ? picked : SECTIONS;
    }

    /**
     * Where each section lives when the exhibition is spread over pages:
     * `data-pages`, `[{url, title, current, sections}]` in exhibition order
     * (Site\BlockLayout\AlbaniSermons::pageMap). Empty for a block showing
     * every section, or a malformed list.
     */
    function sitePages(container) {
        var pages;
        try { pages = JSON.parse((container && container.dataset.pages) || '[]'); }
        catch (e) { return []; }
        if (!Array.isArray(pages)) return [];
        return pages.filter(function (p) {
            return p && typeof p.url === 'string' && Array.isArray(p.sections);
        });
    }

    /**
     * The address of section `key`: its anchor when this page shows it, the
     * page that does otherwise (the current page first, then the first page
     * listing it), or null when no page shows it.
     */
    function sectionHref(key, local, pages) {
        if (local.indexOf(key) !== -1) return '#albani-' + key;
        for (var i = 0; i < pages.length; i++) {
            if (!pages[i].current && pages[i].sections.indexOf(key) !== -1) {
                return pages[i].url + '#albani-' + key;
            }
        }
        return null;
    }

    /**
     * A link to another page of the exhibition carries the reader's counting
     * scope and translation choice (`albani.*` in the address), read when it
     * is followed rather than when it is drawn.
     */
    function carryState(a) {
        a.addEventListener('click', function () {
            var params;
            try { params = new URLSearchParams(window.location.search); }
            catch (e) { return; }
            var keep = [];
            params.forEach(function (value, name) {
                if (name.indexOf('albani.') === 0) keep.push([name, value]);
            });
            if (!keep.length) return;
            var url;
            try { url = new URL(a.href, window.location.href); }
            catch (e) { return; }
            keep.forEach(function (pair) { url.searchParams.set(pair[0], pair[1]); });
            a.href = url.toString();
        });
    }

    /** One link of the exhibition, to this page's anchor or another page. */
    function link(cls, text, href) {
        var a = P.el('a', cls, text);
        a.href = href;
        if (href.charAt(0) !== '#') carryState(a);
        return a;
    }

    /**
     * The previous and next pages of a spread-out exhibition, at the foot of
     * the block, named by their titles. Nothing for a single page.
     */
    function pager(root, pages) {
        var at = -1;
        pages.forEach(function (p, i) { if (p.current) at = i; });
        if (at === -1 || pages.length < 2) return;
        var nav = P.el('nav', 'iwac-vis-albani__pager');
        nav.setAttribute('aria-label', P.t('albani_pager'));
        [
            { page: pages[at - 1], cls: 'iwac-vis-albani__pager-link--prev', label: P.t('albani_pager_prev') },
            { page: pages[at + 1], cls: 'iwac-vis-albani__pager-link--next', label: P.t('albani_pager_next') }
        ].forEach(function (side) {
            if (!side.page) return;
            var a = link('iwac-vis-albani__pager-link ' + side.cls, '', side.page.url);
            a.appendChild(P.el('span', 'iwac-vis-albani__pager-label', side.label));
            a.appendChild(P.el('span', 'iwac-vis-albani__pager-title', side.page.title || ''));
            nav.appendChild(a);
        });
        root.appendChild(nav);
    }

    P.bootBlock({
        selector:       '.iwac-vis-albani',
        warnLabel:      'IWACVis.albaniSermons',
        requireECharts: true,
        load: function (ctx) {
            var fetch = A.fetcher(ctx);
            ctx.fetchBundle = fetch;
            // A single-panel embed, or a page showing some sections, fetches
            // only what its sections read.
            var only = onlySection(ctx);
            var shown = only ? [only] : chosenSections(ctx.container);
            var names = ['metadata', 'lexicon', 'vocabulary'].filter(function (name) {
                return name === 'metadata' || shown.some(function (def) {
                    return def.needs.indexOf(name) !== -1;
                });
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

    /**
     * The header. `intro` (the title, the introduction, the figures and the
     * transcription status) goes with the recordings section — the whole
     * exhibition, or the page an exhibition spread over pages opens on. The
     * provenance badges, the contents and the two switches every section
     * reads go on every page.
     */
    function header(root, metadata, store, intro) {
        var totals = metadata.totals || {};
        if (intro) {
            var head = P.el('div', 'iwac-vis-block-header iwac-vis-albani__header');
            head.appendChild(P.el('h3', 'iwac-vis-block-header__title', P.t('albani_title')));
            head.appendChild(P.el('p', 'iwac-vis-block-header__desc', P.t('albani_intro')));
            root.appendChild(head);
        }

        var badges = P.el('div', 'iwac-vis-albani__badges');
        badges.appendChild(A.badge(P.t('albani_badge_asr'), P.t('albani_badge_asr_hint')));
        if (metadata.lexicon_status !== 'validated') {
            badges.appendChild(A.badge(P.t('albani_badge_seed'), P.t('albani_badge_seed_hint')));
        }
        if (metadata.entities_status !== 'validated') {
            badges.appendChild(A.badge(P.t('albani_badge_entities'), P.t('albani_badge_entities_hint')));
        }
        if (metadata.gloss_status && metadata.gloss_status !== 'validated') {
            badges.appendChild(A.badge(P.t('albani_badge_glosses'), P.t('albani_badge_glosses_hint')));
        }
        // To the plain-language methods, on this page or another; render()
        // sets its href, or drops it when no page shows them.
        badges.appendChild(P.el('a', 'iwac-vis-albani__jump', P.t('albani_method_jump')));
        root.appendChild(badges);

        if (intro) introFigures(root, metadata, totals);

        // The contents, filled once the sections exist (render()).
        var toc = P.el('nav', 'iwac-vis-albani__toc');
        toc.setAttribute('aria-label', P.t('albani_toc'));
        toc.appendChild(P.el('p', 'iwac-vis-albani__toc-title', P.t('albani_toc')));
        toc.appendChild(P.el('ol', 'iwac-vis-albani__toc-list'));
        root.appendChild(toc);

        scopeControls(root, store, totals);
    }

    /** The figures and the transcription status, under the introduction. */
    function introFigures(root, metadata, totals) {
        root.appendChild(P.buildSummaryCards([
            { value: totals.recordings, labelKey: 'albani_kpi_recordings' },
            { value: totals.analysed, labelKey: 'albani_kpi_analysed', featured: true },
            { value: P.formatTotalDuration(totals.seconds_counted != null ? totals.seconds_counted : totals.seconds_analysed),
                labelKey: 'albani_kpi_hours', text: true },
            { value: totals.words, labelKey: 'albani_kpi_words' },
            { value: totals.segments_counted != null ? totals.segments_counted : totals.segments,
                labelKey: 'albani_kpi_segments' }
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
    }

    /** The counting scope and the translations switch: every section reads them. */
    function scopeControls(root, store, totals) {
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

        // The sections this block shows, and — when the exhibition is spread
        // over pages — where the others are.
        var shown = chosenSections(container);
        var pages = shown === SECTIONS ? [] : sitePages(container);
        var local = shown.map(function (def) { return def.key; });

        header(root, metadata, store, local.indexOf('corpus') !== -1);
        shown.forEach(section);

        // A section's anchor on this page: its heading's id, which A.section
        // suffixes when the page holds two blocks.
        function anchor(key) {
            var h = root.querySelector('[data-iwac-section="' + key + '"] > .iwac-vis-section-heading');
            return h ? '#' + h.id : null;
        }
        function hrefOf(key) {
            return local.indexOf(key) !== -1 ? anchor(key) : sectionHref(key, local, pages);
        }

        // The header's jump link, to the method section wherever it is.
        var jump = root.querySelector('.iwac-vis-albani__jump');
        var methodHref = hrefOf('method');
        if (jump && methodHref) {
            jump.href = methodHref;
            if (methodHref.charAt(0) !== '#') carryState(jump);
        } else if (jump) {
            jump.parentNode.removeChild(jump);
        }

        // The contents: one link per section, in exhibition order — this
        // page's to their anchors (marked as here), the others' to the page
        // that shows them; a section no page shows is left out.
        var list = root.querySelector('.iwac-vis-albani__toc-list');
        SECTIONS.forEach(function (def) {
            var href = hrefOf(def.key);
            if (!href) return;
            var here = local.indexOf(def.key) !== -1;
            var li = P.el('li', 'iwac-vis-albani__toc-item' + (here && pages.length ? ' is-here' : ''));
            li.appendChild(link('iwac-vis-albani__toc-link', P.t(def.heading), href));
            list.appendChild(li);
        });

        pager(root, pages);
    }
})();
