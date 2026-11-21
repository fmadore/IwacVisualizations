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
 * pages, carrying the reader's `albani.*` choices. A block whose setting
 * includes `overview` is the landing page and needs no other page: the
 * introduction and figures, the collection at a glance, and a card per chapter
 * (CHAPTERS); `?albani.chapter=<key>` opens one chapter in the same block. The introduction also goes with the recordings
 * section; the badges go on every page, the switches wherever a section is.
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
     * Not a section: the Sections setting's "a summary of each page", which
     * makes the block a landing page (AlbaniSermons::OVERVIEW).
     */
    var OVERVIEW = 'overview';

    /** The keys of the Sections setting (`data-sections`), as written. */
    function chosenKeys(container) {
        return ((container && container.dataset.sections) || '').split(',')
            .map(function (s) { return s.trim(); })
            .filter(Boolean);
    }

    /**
     * The sections this block shows, in page order: the editor's choice, or
     * every section when there is none. A landing page may show none; a
     * setting that names nothing this file knows shows everything.
     */
    function chosenSections(container) {
        var raw = chosenKeys(container);
        var picked = SECTIONS.filter(function (def) { return raw.indexOf(def.key) !== -1; });
        if (picked.length) return picked;
        return raw.indexOf(OVERVIEW) !== -1 ? [] : SECTIONS;
    }


    /**
     * The landing page's chapters: the exhibition in six readings, each a
     * view of the same block at its own address (`?albani.chapter=themes`).
     * The landing page lists them as cards; a chapter shows its sections
     * alone, with a way back and previous/next links. No Omeka page has to
     * exist for any of it: v2.8.0's cards described sub-pages an editor
     * had to make first, and showed nothing until then.
     */
    var CHAPTERS = [
        { key: 'recordings', title: 'albani_chapter_recordings', sections: ['corpus'] },
        { key: 'vocabulary', title: 'albani_chapter_vocabulary', sections: ['vocabulary', 'keyness'] },
        { key: 'entities',   title: 'albani_chapter_entities',   sections: ['entities'] },
        { key: 'themes',     title: 'albani_chapter_themes',     sections: ['youth', 'politics', 'overlap'] },
        { key: 'rhetoric',   title: 'albani_chapter_rhetoric',   sections: ['rhetoric'] },
        { key: 'method',     title: 'albani_chapter_method',     sections: ['method'] }
    ];

    /** The address parameter naming the open chapter. */
    var CHAPTER_PARAM = 'albani.chapter';

    /** The chapter the address opens, or null for the landing page itself. */
    function currentChapter() {
        var key;
        try { key = new URLSearchParams(window.location.search).get(CHAPTER_PARAM); }
        catch (e) { return null; }
        for (var i = 0; i < CHAPTERS.length; i++) {
            if (CHAPTERS[i].key === key) return CHAPTERS[i];
        }
        return null;
    }

    /** The chapter that holds section `key`. */
    function chapterOf(key) {
        for (var i = 0; i < CHAPTERS.length; i++) {
            if (CHAPTERS[i].sections.indexOf(key) !== -1) return CHAPTERS[i];
        }
        return null;
    }

    /**
     * This page's address with the chapter set (or removed, for null): the
     * page's other parameters kept, `albani.*` left for `carryState` to add
     * when the link is followed, so a choice made after drawing still goes.
     */
    function pageHref(chapter, sectionKey) {
        var params;
        try { params = new URLSearchParams(window.location.search); }
        catch (e) { params = null; }
        var parts = [];
        if (params) {
            params.forEach(function (value, name) {
                if (name.indexOf('albani.') !== 0) {
                    parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(value));
                }
            });
        }
        if (chapter) parts.push(CHAPTER_PARAM + '=' + encodeURIComponent(chapter.key));
        return window.location.pathname + (parts.length ? '?' + parts.join('&') : '')
            + (sectionKey ? '#albani-' + sectionKey : '');
    }

    /** The address of a chapter, and of one of its sections. */
    function chapterHref(chapter, sectionKey) {
        return pageHref(chapter, sectionKey);
    }

    /** The landing page's own address: this page with no chapter open. */
    function landingHref() {
        return pageHref(null);
    }

    /**
     * What a block shows, decided once for load() and render() alike:
     * - a landing block (`overview` ticked) with a chapter in the address
     *   shows that chapter's sections;
     * - a landing block without one shows the summary, then any section the
     *   editor ticked beside it;
     * - any other block shows its ticked sections (all when none).
     */
    function plan(container) {
        var landing = chosenKeys(container).indexOf(OVERVIEW) !== -1;
        var chapter = landing ? currentChapter() : null;
        var shown = chapter
            ? SECTIONS.filter(function (def) { return chapter.sections.indexOf(def.key) !== -1; })
            : chosenSections(container);
        return { landing: landing, chapter: chapter, shown: shown };
    }

    /**
     * One sentence per chapter for the landing page's cards. Literal keys,
     * so the dictionary check can see each one is read.
     */
    var CHAPTER_LEDE = {
        recordings: 'albani_lede_recordings',
        vocabulary: 'albani_lede_vocabulary',
        entities: 'albani_lede_entities',
        themes: 'albani_lede_themes',
        rhetoric: 'albani_lede_rhetoric',
        method: 'albani_lede_method'
    };

    /** The transcription status of a recording, as a class and a label. */
    var GLANCE_STATUS = {
        analysed: { cls: 'is-analysed', label: 'albani_status_analysed' },
        legacy: { cls: 'is-legacy', label: 'albani_status_legacy_short' },
        untranscribed: { cls: 'is-untranscribed', label: 'albani_status_none' }
    };

    /**
     * The collection at a glance, under the landing page's figures: one bar per
     * recording, dated ones in date order and the undated after a gap, each
     * as tall as it is long and shaded by how far its transcript has got.
     * Read from metadata.json alone, drawn as plain elements (no chart
     * library on the landing page). A picture with one summary label; the
     * recordings chapter holds the table a screen reader can walk.
     */
    function collectionGlance(root, metadata) {
        var recordings = (metadata.recordings || []).filter(function (r) { return r && r.dur > 0; });
        if (!recordings.length) return;
        var dated = recordings.filter(function (r) { return r.d; })
            .sort(function (a, b) { return String(a.d).localeCompare(String(b.d)); });
        var undated = recordings.filter(function (r) { return !r.d; });
        var longest = recordings.reduce(function (m, r) { return Math.max(m, r.dur); }, 0);

        var first = dated.length ? String(dated[0].y || dated[0].d).slice(0, 4) : '';
        var last = dated.length ? String(dated[dated.length - 1].y || dated[dated.length - 1].d).slice(0, 4) : '';
        var figure = P.el('figure', 'iwac-vis-albani__glance');
        figure.appendChild(P.el('figcaption', 'iwac-vis-albani__glance-title', P.t('albani_glance_title')));
        var plot = P.el('div', 'iwac-vis-albani__glance-plot');
        plot.setAttribute('role', 'img');
        plot.setAttribute('aria-label', P.t('albani_glance_label', {
            count: recordings.length, first: first, last: last
        }));
        function bar(r) {
            var status = GLANCE_STATUS[r.st] || GLANCE_STATUS.untranscribed;
            var el = P.el('span', 'iwac-vis-albani__glance-bar ' + status.cls);
            el.style.setProperty('--iwac-vis-glance-h', Math.max(6, Math.round(100 * r.dur / longest)) + '%');
            el.title = (r.t || '') + ' · ' + (r.d ? (P.formatDate ? P.formatDate(r.d) : r.d) : P.t('albani_undated'))
                + ' · ' + P.formatDuration(r.dur) + ' · ' + P.t(status.label);
            return el;
        }
        // A run of bars over its own axis, as wide as it has bars.
        function run(list, labels, cls) {
            var box = P.el('div', 'iwac-vis-albani__glance-run' + (cls ? ' ' + cls : ''));
            box.style.setProperty('--iwac-vis-glance-n', String(list.length));
            var bars = P.el('div', 'iwac-vis-albani__glance-bars');
            list.forEach(function (r) { bars.appendChild(bar(r)); });
            box.appendChild(bars);
            var axis = P.el('div', 'iwac-vis-albani__glance-axis');
            axis.setAttribute('aria-hidden', 'true');
            labels.forEach(function (text) { axis.appendChild(P.el('span', 'iwac-vis-albani__glance-tick', text)); });
            box.appendChild(axis);
            return box;
        }
        if (dated.length) plot.appendChild(run(dated, first === last ? [first] : [first, last]));
        if (undated.length) plot.appendChild(run(undated, [P.t('albani_undated')], 'iwac-vis-albani__glance-run--undated'));
        figure.appendChild(plot);

        // The key: only the statuses present.
        var key = P.el('ul', 'iwac-vis-albani__glance-key');
        Object.keys(GLANCE_STATUS).forEach(function (st) {
            if (!recordings.some(function (r) { return (GLANCE_STATUS[r.st] ? r.st : 'untranscribed') === st; })) return;
            var li = P.el('li', 'iwac-vis-albani__glance-key-item ' + GLANCE_STATUS[st].cls);
            li.appendChild(P.el('span', 'iwac-vis-albani__glance-swatch'));
            li.appendChild(document.createTextNode(P.t(GLANCE_STATUS[st].label)));
            key.appendChild(li);
        });
        figure.appendChild(key);
        figure.appendChild(P.el('p', 'iwac-vis-albani__glance-note', P.t('albani_glance_note')));
        root.appendChild(figure);
    }

    /**
     * The summary: a card per chapter, in reading order: its number, its
     * title, one sentence, the sections inside it as links straight to
     * them, and a way into the chapter.
     */
    function chapterCards(root) {
        var nav = P.el('nav', 'iwac-vis-albani__overview');
        nav.setAttribute('aria-label', P.t('albani_overview'));
        nav.appendChild(P.el('h3', 'iwac-vis-albani__overview-title', P.t('albani_overview')));
        var list = P.el('ol', 'iwac-vis-albani__cards');
        CHAPTERS.forEach(function (chapter, i) {
            var card = P.el('li', 'iwac-vis-albani__card');
            card.appendChild(P.el('span', 'iwac-vis-albani__card-number',
                (i + 1 < 10 ? '0' : '') + (i + 1)));
            var title = P.el('h4', 'iwac-vis-albani__card-title');
            title.appendChild(link('iwac-vis-albani__card-link', P.t(chapter.title), chapterHref(chapter)));
            card.appendChild(title);
            card.appendChild(P.el('p', 'iwac-vis-albani__card-text', P.t(CHAPTER_LEDE[chapter.key])));
            var inner = SECTIONS.filter(function (def) { return chapter.sections.indexOf(def.key) !== -1; });
            if (inner.length > 1) {
                var items = P.el('ul', 'iwac-vis-albani__card-sections');
                inner.forEach(function (def) {
                    var li = P.el('li', 'iwac-vis-albani__card-section');
                    li.appendChild(link('iwac-vis-albani__card-section-link', P.t(def.heading),
                        chapterHref(chapter, def.key)));
                    items.appendChild(li);
                });
                card.appendChild(items);
            }
            var more = link('iwac-vis-albani__card-more', P.t('albani_card_more'), chapterHref(chapter));
            // The title already names the chapter; this link repeats it for
            // a screen reader rather than reading "Read the chapter" six times.
            more.setAttribute('aria-label', P.t('albani_card_more_label', { chapter: P.t(chapter.title) }));
            card.appendChild(more);
            list.appendChild(card);
        });
        nav.appendChild(list);
        root.appendChild(nav);
    }

    /**
     * The foot of a chapter: the previous and next chapters by title, and
     * the way back to the summary between them.
     */
    function chapterPager(root, chapter) {
        var at = CHAPTERS.indexOf(chapter);
        var nav = P.el('nav', 'iwac-vis-albani__pager');
        nav.setAttribute('aria-label', P.t('albani_pager'));
        var prev = CHAPTERS[at - 1];
        var next = CHAPTERS[at + 1];
        if (prev) nav.appendChild(pagerLink(prev, 'iwac-vis-albani__pager-link--prev', P.t('albani_pager_prev')));
        nav.appendChild(link('iwac-vis-albani__pager-back', P.t('albani_back'), landingHref()));
        if (next) nav.appendChild(pagerLink(next, 'iwac-vis-albani__pager-link--next', P.t('albani_pager_next')));
        root.appendChild(nav);
    }

    function pagerLink(chapter, cls, label) {
        var a = link('iwac-vis-albani__pager-link ' + cls, '', chapterHref(chapter));
        a.appendChild(P.el('span', 'iwac-vis-albani__pager-label', label));
        a.appendChild(P.el('span', 'iwac-vis-albani__pager-title', P.t(chapter.title)));
        return a;
    }

    /**
     * A link into a section (`#albani-politics`) arrives before the block
     * has drawn it; once it exists, go there — and stay there while the
     * charts above it are drawn and push it down, until the reader scrolls
     * or clicks, or a few seconds pass.
     */
    function scrollToHash(root) {
        var id = (window.location.hash || '').slice(1);
        if (!/^albani-[a-z]+$/.test(id)) return;
        var target = root.querySelector('#' + id);
        if (!target || !target.scrollIntoView) return;
        target.scrollIntoView();
        if (typeof window.ResizeObserver !== 'function') return;
        var events = ['wheel', 'touchstart', 'keydown', 'mousedown'];
        var observer = new window.ResizeObserver(function () { target.scrollIntoView(); });
        function stop() {
            observer.disconnect();
            events.forEach(function (name) { window.removeEventListener(name, stop); });
        }
        observer.observe(root);
        events.forEach(function (name) { window.addEventListener(name, stop, { passive: true }); });
        setTimeout(stop, 6000);
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
                // The chapter is where the link goes, not a choice to carry.
                if (name.indexOf('albani.') === 0 && name !== CHAPTER_PARAM) keep.push([name, value]);
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
            var shown = only ? [only] : plan(ctx.container).shown;
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
     * The header. The provenance badges go on every page; the rest as `show`
     * says:
     * - `intro`: the title, the introduction, the figures and the
     *   transcription status — on the landing page, or with the recordings;
     * - `toc`: the contents — everywhere but the landing page, whose cards
     *   are its contents;
     * - `controls`: the counting scope and translations switches — wherever
     *   a section reads them.
     */
    function header(root, metadata, store, show) {
        var totals = metadata.totals || {};
        var intro = show.intro;
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
        if (show.toc) {
            var toc = P.el('nav', 'iwac-vis-albani__toc');
            toc.setAttribute('aria-label', P.t('albani_toc'));
            toc.appendChild(P.el('p', 'iwac-vis-albani__toc-title', P.t('albani_toc')));
            toc.appendChild(P.el('ol', 'iwac-vis-albani__toc-list'));
            root.appendChild(toc);
        }

        if (show.controls) scopeControls(root, store, totals);
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

        // What this block shows: a landing page's summary or one of its
        // chapters, or the sections an editor ticked.
        var view = plan(container);
        if (view.landing) {
            renderLanding(root, metadata, store, view, section);
            return;
        }

        // The sections this block shows, and — when the exhibition is spread
        // over pages — where the others are.
        var shown = view.shown;
        var pages = chosenKeys(container).length ? sitePages(container) : [];
        var local = shown.map(function (def) { return def.key; });

        header(root, metadata, store, {
            intro: local.indexOf('corpus') !== -1,
            toc: true,
            controls: local.length > 0
        });
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
        if (list) SECTIONS.forEach(function (def) {
            var href = hrefOf(def.key);
            if (!href) return;
            var here = local.indexOf(def.key) !== -1;
            var li = P.el('li', 'iwac-vis-albani__toc-item' + (here && pages.length ? ' is-here' : ''));
            li.appendChild(link('iwac-vis-albani__toc-link', P.t(def.heading), href));
            list.appendChild(li);
        });

        pager(root, pages);
    }

    /**
     * A landing block. Without a chapter in the address: the introduction,
     * the figures and a card per chapter, then any section ticked beside
     * the summary. With one: a way back, the chapter's title, the switches,
     * its sections, and the previous/next chapters.
     */
    function renderLanding(root, metadata, store, view, section) {
        if (view.chapter) {
            root.appendChild(link('iwac-vis-albani__back', P.t('albani_back'), landingHref()));
            // A one-section chapter's section heading already names it.
            if (view.chapter.sections.length > 1) {
                root.appendChild(P.el('h3', 'iwac-vis-block-header__title iwac-vis-albani__chapter-title',
                    P.t(view.chapter.title)));
            }
        }
        header(root, metadata, store, {
            intro: !view.chapter,
            toc: false,
            controls: view.shown.length > 0
        });
        if (!view.chapter) {
            collectionGlance(root, metadata);
            chapterCards(root);
        }
        view.shown.forEach(section);

        // "How this was made": the method on this view, or its chapter.
        var jump = root.querySelector('.iwac-vis-albani__jump');
        if (jump) {
            var local = root.querySelector('[data-iwac-section="method"] > .iwac-vis-section-heading');
            if (local) {
                jump.href = '#' + local.id;
            } else {
                jump.href = chapterHref(chapterOf('method'), 'method');
                carryState(jump);
            }
        }

        if (view.chapter) chapterPager(root, view.chapter);
        scrollToHash(root);
    }
})();
