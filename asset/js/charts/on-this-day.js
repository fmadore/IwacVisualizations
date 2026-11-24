/**
 * IWAC Visualizations — On This Day page block (orchestrator)
 *
 * The module's one deliberate engagement hook: items dated today across
 * the collection's decades — newspaper articles, periodical issues,
 * audiovisual recordings, documents and images with a full date.
 *
 * Two calendars, four layouts, one cast. The block fetches today's
 * Gregorian day file and, in parallel, the Umm al-Qura one for the same
 * moment (`on-this-day/h/{MM-DD}.json`); both are written by
 * `scripts/generate_on_this_day.py`. Each calendar picks its own documents
 * — the same lunar date across the decades is a different set of items than
 * the same solar date. The reader chooses the layout (Register / Decades /
 * Clippings / Edition); the page editor chooses which one it opens on.
 *
 * The Edition layout adds day navigation — previous / next day, a day +
 * month picker in the calendar on show, "Today", "Random date" and, in the
 * Hijri calendar, shortcuts to the major dates — so the block can show a
 * day other than today. The layout switch sits in the footer row as a
 * native select, so the masthead carries only the calendar switch. The
 * chosen day, calendar, layout, the Edition's lead item and its country
 * filter are the block's URL state (`otd.day`, `otd.cal`, `otd.layout`,
 * `otd.item`, `otd.country`), so a view can be shared and embedded; today's
 * own date never appears in the address. `otd.year`, which links carried
 * before the lead became an item, is still read and resolved to that year's
 * best item. The other layouts follow a chosen day too: every dateline
 * reads the one reference date in shared.js.
 *
 * Pure DOM — no ECharts. When the day file is ABSENT (404 — pre-first data
 * sync) or empty, the whole block removes itself silently, like the Item Set
 * Dashboard: an engagement hook must never render an error state over content
 * that was never published. The Hijri file is optional on exactly the same
 * grounds — module code ships independently of the data fan-out, so a module
 * updated before the admin's next "Pull latest data" run simply hides the
 * calendar toggle rather than offering a tab that 404s.
 *
 * A day file that exists but does not ARRIVE is a different thing, and gets a
 * different answer: the fetch is bounded (LOAD_TIMEOUT_MS) and a stalled or
 * failed request swaps the spinner for a quiet note and a retry control. See
 * `fail()`. The server-rendered `<noscript>` line that covers the third case —
 * no scripting at all — lives in the block template.
 *
 * The daily selection is deterministic: every visitor sees the same
 * spread-across-the-decades picks for a given date, and the picks change
 * with the date.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis on this day: missing panels — check script load order');
        return;
    }
    var P = ns.panels;

    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'otd.title':      'On this day',
            'otd.desc':       'Articles, periodical issues, audiovisual recordings, documents and images dated {date}, across the collection’s years.',
            'otd.desc_h':     'Items published on {date} in the converted Islamic (Hijri) calendar, across the collection’s years. Converted dates may differ from local lunar observations.',
            'otd.type_a':     'Article',
            'otd.type_p':     'Periodical',
            'otd.type_v':     'Audiovisual',
            'otd.type_d':     'Document',
            'otd.type_i':     'Image',
            'otd.n_countries':       '{count} countries',
            'otd.n_countries_one':   '{count} country',
            'otd.n_countries_other': '{count} countries',
            'otd.n_titles':          '{count} newspapers',
            'otd.n_titles_one':      '{count} newspaper',
            'otd.n_titles_other':    '{count} newspapers',
            'otd.ed_scale_geo':         '{items} from {countries} and {titles}, {from}–{to}.',
            'otd.ed_scale_geo_same':    '{items} from {countries} and {titles}, all from {year}.',
            'otd.ed_scale_geo_nt':      '{items} from {countries}, {from}–{to}.',
            'otd.ed_scale_geo_nt_same': '{items} from {countries}, all from {year}.',
            'otd.ed_month_h':       'Hijri month',
            'otd.ed_random':        'Random date',
            'otd.ed_feasts':        'Major dates of the Hijri year',
            'otd.feast_ashura':     'Ashura',
            'otd.feast_mawlid':     'Mawlid (Maouloud)',
            'otd.feast_ramadan':    'Ramadan',
            'otd.feast_korite':     'Eid al-Fitr (Korité)',
            'otd.feast_tabaski':    'Eid al-Adha (Tabaski)',
            'otd.ed_legend':        'Item types',
            'otd.ed_exact':         'Exactly {count} years ago',
            'otd.ed_exact_h':       'Exactly {count} Hijri years ago',
            'otd.ago':        '{count} years ago',
            'otd.ago_one':    '{count} year ago',
            'otd.ago_other':  '{count} years ago',
            'otd.calendar':   'Calendar',
            'otd.cal_g':      'Gregorian',
            'otd.cal_h':      'Hijri',
            'otd.view':       'Layout',
            'otd.view_register':  'Register',
            'otd.view_decades':   'Decades',
            'otd.view_clippings': 'Clippings',
            'otd.view_edition':   'Edition',
            'otd.ed_scale':         '{count} items on this date, from {from} to {to}.',
            'otd.ed_scale_same':    '{count} items on this date, all from {year}.',
            'otd.ed_scale_single':  'One item on this date, from {year}.',
            'otd.ed_caveat_h':      'Converted dates may differ from local lunar observations.',
            'otd.ed_nav':           'Other dates',
            'otd.ed_prev':          'Previous day, {date}',
            'otd.ed_next':          'Next day, {date}',
            'otd.ed_choose':        'Choose a date',
            'otd.ed_month':         'Month',
            'otd.ed_today':         'Today',
            'otd.ed_spine':         'Years with items on {date}',
            'otd.ed_tick':          '{year}, {count} items',
            'otd.ed_tick_one':      '{year}, {count} item',
            'otd.ed_tick_other':    '{year}, {count} items',
            'otd.ed_ago_h':         '{count} Hijri years ago',
            'otd.ed_ago_h_one':     '{count} Hijri year ago',
            'otd.ed_ago_h_other':   '{count} Hijri years ago',
            'otd.ed_briefs':        'Also on this date',
            'otd.ed_err_day':       'Couldn’t load that date.',
            'otd.ed_scale_c':         '{items} from {country} and {titles}, {from}–{to}.',
            'otd.ed_scale_c_same':    '{items} from {country} and {titles}, all from {year}.',
            'otd.ed_scale_c_nt':      '{items} from {country}, {from}–{to}.',
            'otd.ed_scale_c_nt_same': '{items} from {country}, all from {year}.',
            'otd.ed_country':       'Country',
            'otd.ed_country_all':   'All',
            'otd.ed_pager':         '{n} / {count} in {year}',
            'otd.ed_pager_group':   'Items from {year}',
            'otd.ed_pager_prev':    'Previous item from {year}',
            'otd.ed_pager_next':    'Next item from {year}',
            'otd.ed_promote':       'Show as lead',
            'otd.ed_promote_named': 'Show as lead: {title}',
            'otd.ed_subjects':      'Subjects',
            'otd.ed_cta_a':         'Read the item',
            'otd.ed_cta_v':         'Watch the recording',
            'otd.ed_cta_i':         'See the image',
            'otd.ai_summary':       'AI-generated summary',
            'otd.shown_c':          '{shown} of the {count} items from {country} that carry this date.',
            'otd.all_shown_c':       'The {count} items from {country} that carry this date.',
            'otd.all_shown_c_one':   'The only item from {country} that carries this date.',
            'otd.all_shown_c_other': 'The {count} items from {country} that carry this date.',
            'otd.listed_c':         'All {count} items from {country} that carry this date.',
            'otd.shown':      '{shown} of the {count} items in the collection that carry this date.',
            'otd.all_shown':        'The {count} items in the collection that carry this date.',
            'otd.all_shown_one':    'The only item in the collection that carries this date.',
            'otd.all_shown_other':  'The {count} items in the collection that carry this date.',
            'otd.listed':           'All {count} items in the collection that carry this date.',
            'otd.show_all':   'See all',
            'otd.collapse':   'Close the list',
            'otd.err':        'Couldn’t load today’s items.',
            'otd.retry':      'Try again'
        });
        ns.addTranslations('fr', {
            'Loading on this day': 'Chargement de «\u00a0ce jour-là\u00a0»',
            'otd.title':      'Ce jour-là',
            'otd.desc':       'Articles, numéros de périodiques, enregistrements audiovisuels, documents et images datés du {date}, au fil des années de la collection.',
            'otd.desc_h':     'Documents publiés le {date} selon le calendrier islamique (hégirien) converti, au fil des années de la collection. Les dates converties peuvent différer des observations lunaires locales.',
            'otd.type_a':     'Article',
            'otd.type_p':     'Périodique',
            'otd.type_v':     'Audiovisuel',
            'otd.type_d':     'Document',
            'otd.type_i':     'Image',
            'otd.n_countries':       '{count} pays',
            'otd.n_countries_one':   '{count} pays',
            'otd.n_countries_other': '{count} pays',
            'otd.n_titles':          '{count} titres',
            'otd.n_titles_one':      '{count} titre',
            'otd.n_titles_other':    '{count} titres',
            'otd.ed_scale_geo':         '{items} de {countries} et {titles}, de {from} à {to}.',
            'otd.ed_scale_geo_same':    '{items} de {countries} et {titles}, tous de {year}.',
            'otd.ed_scale_geo_nt':      '{items} de {countries}, de {from} à {to}.',
            'otd.ed_scale_geo_nt_same': '{items} de {countries}, tous de {year}.',
            'otd.ed_month_h':       'Mois hégirien',
            'otd.ed_random':        'Date au hasard',
            'otd.ed_feasts':        'Grandes dates de l’année hégirienne',
            'otd.feast_ashura':     'Achoura',
            'otd.feast_mawlid':     'Maouloud',
            'otd.feast_ramadan':    'Ramadan',
            'otd.feast_korite':     'Korité',
            'otd.feast_tabaski':    'Tabaski',
            'otd.ed_legend':        'Types de documents',
            'otd.ed_exact':         'il y a exactement {count} ans',
            'otd.ed_exact_h':       'il y a exactement {count} années hégiriennes',
            'otd.ago':        'il y a {count} ans',
            'otd.ago_one':    'il y a {count} an',
            'otd.ago_other':  'il y a {count} ans',
            'otd.calendar':   'Calendrier',
            'otd.cal_g':      'Grégorien',
            'otd.cal_h':      'Hijri',
            'otd.view':       'Présentation',
            'otd.view_register':  'Registre',
            'otd.view_decades':   'Décennies',
            'otd.view_clippings': 'Coupures',
            'otd.view_edition':   'Édition',
            'otd.ed_scale':         '{count} documents à cette date, de {from} à {to}.',
            'otd.ed_scale_same':    '{count} documents à cette date, tous de {year}.',
            'otd.ed_scale_single':  'Un seul document à cette date, de {year}.',
            'otd.ed_caveat_h':      'Les dates converties peuvent différer des observations lunaires locales.',
            'otd.ed_nav':           'Autres dates',
            'otd.ed_prev':          'Jour précédent, {date}',
            'otd.ed_next':          'Jour suivant, {date}',
            'otd.ed_choose':        'Choisir une date',
            'otd.ed_month':         'Mois',
            'otd.ed_today':         'Aujourd’hui',
            'otd.ed_spine':         'Années comptant des documents le {date}',
            'otd.ed_tick':          '{year}, {count} documents',
            'otd.ed_tick_one':      '{year}, {count} document',
            'otd.ed_tick_other':    '{year}, {count} documents',
            'otd.ed_ago_h':         'il y a {count} années hégiriennes',
            'otd.ed_ago_h_one':     'il y a {count} année hégirienne',
            'otd.ed_ago_h_other':   'il y a {count} années hégiriennes',
            'otd.ed_briefs':        'Également à cette date',
            'otd.ed_err_day':       'Impossible de charger cette date.',
            'otd.ed_scale_c':         '{items} {country} et {titles}, de {from} à {to}.',
            'otd.ed_scale_c_same':    '{items} {country} et {titles}, tous de {year}.',
            'otd.ed_scale_c_nt':      '{items} {country}, de {from} à {to}.',
            'otd.ed_scale_c_nt_same': '{items} {country}, tous de {year}.',
            'otd.ed_country':       'Pays',
            'otd.ed_country_all':   'Tous',
            'otd.ed_pager':         '{n} / {count} en {year}',
            'otd.ed_pager_group':   'Documents de {year}',
            'otd.ed_pager_prev':    'Document précédent de {year}',
            'otd.ed_pager_next':    'Document suivant de {year}',
            'otd.ed_promote':       'Voir en Une',
            'otd.ed_promote_named': 'Voir en Une : {title}',
            'otd.ed_subjects':      'Sujets',
            'otd.ed_cta_a':         'Lire le document',
            'otd.ed_cta_v':         'Voir l’enregistrement',
            'otd.ed_cta_i':         'Voir l’image',
            'otd.ai_summary':       'Résumé généré par IA',
            'otd.shown_c':          '{shown} des {count} documents {country} qui portent cette date.',
            'otd.all_shown_c':       'Les {count} documents {country} qui portent cette date.',
            'otd.all_shown_c_one':   'Le seul document {country} qui porte cette date.',
            'otd.all_shown_c_other': 'Les {count} documents {country} qui portent cette date.',
            'otd.listed_c':         'Les {count} documents {country} qui portent cette date.',
            'otd.shown':      '{shown} des {count} documents de la collection qui portent cette date.',
            'otd.all_shown':        'Les {count} documents de la collection qui portent cette date.',
            'otd.all_shown_one':    'Le seul document de la collection qui porte cette date.',
            'otd.all_shown_other':  'Les {count} documents de la collection qui portent cette date.',
            'otd.listed':           'Les {count} documents de la collection qui portent cette date.',
            'otd.show_all':   'Tout voir',
            'otd.collapse':   'Fermer la liste',
            'otd.err':        'Impossible de charger les documents du jour.',
            'otd.retry':      'Réessayer'
        });
    }

    var S = ns.onThisDay && ns.onThisDay.shared;
    if (!S) {
        console.warn('IWACVis on this day: missing shared module — check script load order');
        return;
    }

    /** Layout key -> module. Order is the order of the switcher. */
    var LAYOUTS = [
        { key: 'register',  labelKey: 'otd.view_register',  module: 'register' },
        { key: 'decades',   labelKey: 'otd.view_decades',   module: 'decades' },
        { key: 'clippings', labelKey: 'otd.view_clippings', module: 'clippings' },
        { key: 'edition',   labelKey: 'otd.view_edition',   module: 'edition' }
    ];
    var DEFAULT_LAYOUT = 'register';
    var STORE_KEY = 'iwac-vis-otd-layout';

    /**
     * How long the block waits for its day file before saying so.
     *
     * `fetch` carries no timeout of its own, so a request that never answers —
     * a captive portal, a proxy that swallows the connection, a phone that
     * lost the network between the HTML and the JSON — leaves the promise
     * pending for as long as the tab is open, and the spinner spinning for
     * exactly that long. That was the block's only failure mode without a
     * visible end: a 404 removes the block, a 500 removes the block, an
     * unanswered request span forever.
     *
     * Twelve seconds is well past what a 7 KB same-origin file needs and still
     * inside the span a reader will wait before deciding a page is broken.
     *
     * It is also what bounds the spinner for a reduced-motion reader. Measured
     * on the live stack: the theme's global `prefers-reduced-motion` reset
     * (`animation-duration: 0.01ms !important`) outranks iwac-core.css's own
     * 2 s spinner rule, so that reader gets a STATIC ring — which is fine for
     * a wait that ends, and was the one thing this block could not promise.
     * Now it can.
     */
    var LOAD_TIMEOUT_MS = 12000;

    function layoutFor(key) {
        for (var i = 0; i < LAYOUTS.length; i++) {
            if (LAYOUTS[i].key === key) return ns.onThisDay[LAYOUTS[i].module] || null;
        }
        return null;
    }

    /** Reader's own choice beats the block setting; both beat the default. */
    function initialLayout(container) {
        var stored = null;
        try {
            stored = window.localStorage.getItem(STORE_KEY);
        } catch (e) { /* private mode — fall through to the block setting */ }
        var candidates = [stored, container.dataset.layout, DEFAULT_LAYOUT];
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i] && layoutFor(candidates[i])) return candidates[i];
        }
        return DEFAULT_LAYOUT;
    }

    /**
     * The day the address asks for (`otd.day=MM-DD`), or null. Read before
     * the first fetch, so a shared link loads its own day's files rather
     * than today's and then a second pair; the store's URL binding reads
     * the same parameter again once the block exists.
     */
    function urlDay() {
        try {
            var key = new URLSearchParams(window.location.search).get('otd.day');
            return key && S.validDayKey(key) ? key : null;
        } catch (e) {
            return null;
        }
    }

    function rememberLayout(key) {
        try {
            window.localStorage.setItem(STORE_KEY, key);
        } catch (e) { /* nothing to do — the choice just does not persist */ }
    }

    /* ----------------------------------------------------------------- */
    /*  Full-day index (the "see all" disclosure)                         */
    /* ----------------------------------------------------------------- */

    /**
     * Every item for the day as a compact ruled index — no plates, no
     * ledes. The day file already holds the whole list (a median of 36
     * items, up to 91), so this costs no request; it is deliberately not a
     * link out to search, which cannot express "this day, any year".
     */
    function buildIndex(items, ctx, mode) {
        var list = P.el('ul', 'iwac-vis-otd-index');
        items.forEach(function (row) {
            var it = S.readRow(row);
            var link = document.createElement('a');
            link.className = 'iwac-vis-otd-index__row';
            link.href = S.itemUrl(ctx, it.oId);

            link.appendChild(P.el('span', 'iwac-vis-otd-index__year', String(it.year)));
            link.appendChild(P.el('span', 'iwac-vis-otd-index__title', it.title));

            var meta = P.el('span', 'iwac-vis-otd-meta');
            meta.appendChild(S.typeBadge(it.type));
            if (it.source) meta.appendChild(P.el('span', null, it.source));
            if (mode.calendar === 'h' && it.hYear) {
                meta.appendChild(P.el('span', 'iwac-vis-otd-meta__date',
                    S.hijriDate(it.hYear)));
            }
            link.appendChild(meta);

            var li = P.el('li');
            li.appendChild(link);
            list.appendChild(li);
        });
        return list;
    }

    /**
     * The copy-embed control, placed by the block itself (the template sets
     * `data-embed-own`, so embed.js adds none). It sits in the footer row
     * beside the see-all toggle: the panel toolbar's floating corner is this
     * block's section rule, and moved into the flow it became a lone button
     * on a line of its own under the whole almanac. Null inside an embed and
     * wherever embed.js did not load.
     */
    function buildEmbedButton(container, layout) {
        var E = ns.embed;
        if (!E || !E.makeButton) return null;
        if (document.body && document.body.classList.contains('iwac-embed-body')) return null;
        var slug = container.getAttribute('data-embed-slug');
        if (!slug) return null;
        var base = container.getAttribute('data-embed-base')
            || container.getAttribute('data-site-base') || '';
        return E.makeButton({
            src: function () {
                // The embed route renders without the block's setting, so the
                // layout on screen travels in the URL even when the address
                // bar does not carry it (a block configured to open on it).
                var query = E.stateQuery(container);
                if (layout && !/(^|&)otd\.layout=/.test(query)) {
                    query = (query ? query + '&' : '') + 'otd.layout=' + encodeURIComponent(layout);
                }
                return E.url(base, slug, '', query);
            },
            snippetTitle: P.t('otd.title'),
            height: 720
        });
    }

    /**
     * "Layout: Edition" — the layout switch, as a compact native select at
     * the head of the footer's actions. It was four buttons in the masthead,
     * ahead of every document; the choice it makes is a reader preference
     * (kept in localStorage, the editor's setting the default, `otd.layout`
     * in the address), not something to read before the day itself.
     */
    function buildLayoutSelect(active, onChange) {
        var group = P.buildSelectControl({
            label: P.t('otd.view'),
            options: LAYOUTS.map(function (l) { return { value: l.key, label: P.t(l.labelKey) }; }),
            current: active,
            name: 'otd-layout',
            idPrefix: 'iwac-vis-otd-layout-',
            groupClass: 'iwac-vis-otd-foot__layout',
            labelClass: 'iwac-vis-otd-foot__label',
            selectClass: 'iwac-vis-otd-foot__select',
            onChange: onChange
        });
        S.selectShell(group.control);
        return group;
    }

    function buildFooter(container, items, shown, ctx, mode, onLayout) {
        var foot = P.el('div', 'iwac-vis-otd-foot');
        var layoutPick = buildLayoutSelect(mode.layout, onLayout);

        // One figure pair the reader can check at a glance — "6 of the 61"
        // beside "See all" — rather than "55 more" beside "See all 61",
        // which made them do the subtraction. With the list open the line
        // describes the list instead.
        var all = shown >= items.length;
        // Filtered to one country, the line — and the list it opens — are
        // that country's, like everything above it.
        var c = mode.country ? '_c' : '';
        var from = mode.country ? S.countryFrom(mode.country) : '';
        function line(key, params) {
            params.country = from;
            return P.t(key + c, params);
        }
        var count = P.el('span', 'iwac-vis-otd-foot__count',
            all ? line('otd.all_shown', { count: items.length })
                : line('otd.shown', { shown: shown, count: items.length }));
        foot.appendChild(count);

        // Nothing to reveal when the layout already shows the whole day.
        if (all) {
            var only = P.el('div', 'iwac-vis-otd-foot__actions');
            only.appendChild(layoutPick);
            var lone = buildEmbedButton(container, mode.layout);
            if (lone) only.appendChild(lone);
            foot.appendChild(only);
            return foot;
        }

        var actions = P.el('div', 'iwac-vis-otd-foot__actions');
        actions.appendChild(layoutPick);

        // The module's quiet outlined control — what a bare <button> renders
        // as in the theme — not a bare uppercase text link: the block's other
        // controls are all buttons, and this one was the odd one out.
        var panel = null;
        var btn = P.el('button', 'iwac-vis-btn iwac-vis-otd-foot__toggle');
        btn.type = 'button';
        btn.setAttribute('aria-expanded', 'false');
        P.setIcon(btn, 'chevron-down', P.t('otd.show_all'));
        btn.addEventListener('click', function () {
            var open = btn.getAttribute('aria-expanded') === 'true';
            if (open) {
                if (panel) panel.hidden = true;
                btn.setAttribute('aria-expanded', 'false');
                P.setIcon(btn, 'chevron-down', P.t('otd.show_all'));
                count.textContent = line('otd.shown', { shown: shown, count: items.length });
                return;
            }
            if (!panel) {
                panel = buildIndex(items, ctx, mode);
                foot.parentNode.insertBefore(panel, foot.nextSibling);
                btn.setAttribute('aria-controls', panel.id ||
                    (panel.id = 'iwac-vis-otd-index-' + Math.random().toString(36).slice(2, 8)));
            }
            panel.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            P.setIcon(btn, 'chevron-down', P.t('otd.collapse'));
            count.textContent = line('otd.listed', { count: items.length });
        });
        actions.appendChild(btn);

        var embed = buildEmbedButton(container, mode.layout);
        if (embed) actions.appendChild(embed);

        foot.appendChild(actions);
        return foot;
    }

    /* ----------------------------------------------------------------- */
    /*  Render                                                            */
    /* ----------------------------------------------------------------- */

    function render(container, data, ctx) {
        var sets = setsOf(data);
        if (!sets.g.length) {
            P.removeBlock(container);
            return;
        }
        var hasHijri = sets.h.length > 0 && data.hijriKey;
        S.setDay(data.gregKey);

        container.innerHTML = '';
        var panel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-otd-panel',
            P.t('otd.title'),
            null,
            // <h2>, not the panel default <h4>. This block is a page block on
            // a homepage whose only other heading is the masthead <h1>, so an
            // <h4> here left the outline reading h1 → h4 — two empty levels a
            // screen-reader user has to step over, and a false claim that the
            // almanac is subordinate to some h3 that does not exist. The look
            // is unchanged: see the panel-title rule in iwac-core.css.
            { heading: 'h2' }
        );
        container.appendChild(panel.panel);

        var todayKey = S.gregKey(new Date());
        // `item` is the Edition's lead (an o_id; 0 = the ranked default).
        // `year` is what shared links carried before the lead became an
        // item: still read — the Edition resolves it to that year's best
        // item and rewrites the address to `otd.item` — never written.
        // `country` narrows the Edition to one country ('' = all).
        var state = {
            calendar: 'g', layout: initialLayout(container), day: data.gregKey,
            year: 0, item: 0, country: ''
        };
        var store = P.createStore(state, {
            reduce: function (s, keys) {
                function has(k) { return keys.indexOf(k) !== -1; }
                var out = {};
                // A new day or calendar is a new page: the lead and the
                // country the reader chose on the old one mean nothing there
                // (a link that names them with its day keeps them).
                if (has('day') || has('calendar')) {
                    if (!has('year') && s.year) out.year = 0;
                    if (!has('item') && s.item) out.item = 0;
                    if (!has('country') && s.country) out.country = '';
                }
                // Only the Edition filters by country.
                if (has('layout') && !has('country') && s.country && s.layout !== 'edition') {
                    out.country = '';
                }
                return out;
            }
        });
        var url = P.bindUrlState(store, {
            prefix: 'otd',
            root: container,
            keys: [
                { key: 'day', 'default': todayKey, validate: S.validDayKey },
                { key: 'calendar', param: 'cal', 'default': 'g',
                    validate: function (v) { return v === 'g' || (v === 'h' && !!hasHijri); } },
                { key: 'layout', 'default': DEFAULT_LAYOUT,
                    values: LAYOUTS.map(function (l) { return l.key; }) },
                { key: 'year', 'default': 0,
                    validate: function (v) { return v === 0 || (v >= 1900 && v <= 2100 && v % 1 === 0); } },
                { key: 'item', 'default': 0,
                    validate: function (v) { return v >= 0 && v % 1 === 0 && v < 1e9; } },
                // Checked against the day on every draw (`draw`); here only
                // that it is a plausible name.
                { key: 'country', 'default': '',
                    validate: function (v) { return typeof v === 'string' && v.length <= 60; } }
            ]
        });

        /** Put `changes` in the state and the address without a redraw. */
        function quietly(changes) {
            var touched = store.patch(changes, { silent: true });
            if (touched.length) url.sync(touched);
        }
        // A link that names a day the load did not fetch cannot happen —
        // urlDay() and the binding read the same parameter — but the
        // fetched day is the truth either way.
        state.day = data.gregKey;

        /* -- masthead ------------------------------------------------- */
        var head = P.el('div', 'iwac-vis-otd-head');
        var headline = P.el('span', 'iwac-vis-otd-head__date');
        var subline = P.el('span', 'iwac-vis-otd-head__sub');
        var desc = P.el('p', 'iwac-vis-otd-head__desc');

        // The panel's heading is the block's accessible heading; the date
        // belongs inside it so the heading reads "On this day, 29 July"
        // rather than leaving the date as an orphaned display line. The two
        // are separate flex lines visually, but the heading is announced as
        // one string — hence the explicit separator, without which it read
        // as "On this day29 July".
        var title = panel.panel.querySelector('h2');
        title.appendChild(document.createTextNode(' '));
        title.appendChild(headline);

        var titles = P.el('div', 'iwac-vis-otd-head__titles');
        titles.appendChild(subline);
        head.appendChild(titles);

        var controls = P.el('div', 'iwac-vis-otd-head__controls');
        var calendarSwitch = null;
        if (hasHijri) {
            calendarSwitch = S.segmented({
                label: P.t('otd.calendar'),
                active: state.calendar,
                options: [
                    { key: 'g', label: P.t('otd.cal_g'), hint: sets.g.length },
                    { key: 'h', label: P.t('otd.cal_h'), hint: sets.h.length }
                ],
                onChange: function (key) { store.patch({ calendar: key }); }
            });
            controls.appendChild(calendarSwitch.root);
        }
        // The layout switch is in the footer row (`buildFooter`): four
        // buttons here put twelve controls between the date and the first
        // document. The calendar stays, because it changes what the date is.
        head.appendChild(controls);

        panel.chart.appendChild(head);
        panel.chart.appendChild(desc);

        /* -- body ----------------------------------------------------- */
        var body = P.el('div', 'iwac-vis-otd-body');
        // Reserved so switching layout or calendar does not bounce the page
        // under whatever the reader is looking at further down.
        body.setAttribute('aria-live', 'polite');
        panel.chart.appendChild(body);

        function chooseLayout(key) {
            if (!layoutFor(key)) return;
            rememberLayout(key);
            store.patch({ layout: key });
        }

        /**
         * The generator's list of days worth landing on (`metadata.json`
         * `rich`), fetched once, on the first "Random date". An older fan-out
         * has no such list, or no file: either way the answer is an empty
         * list and `S.pickRandomDay` falls back to any valid day.
         */
        var richPromise = null;
        function richDays() {
            if (!richPromise) {
                richPromise = P.fetchJSON(ctx.dataBase + 'on-this-day/metadata.json')
                    .then(function (meta) {
                        return meta && Array.isArray(meta.rich) ? meta.rich : [];
                    })
                    .catch(function () { return []; });
            }
            return richPromise;
        }

        /* -- another day ---------------------------------------------- */
        var daySeq = 0;
        var firstEdition = true;

        /**
         * Fetch `key`'s two files, then show it. The page keeps the current
         * day until the new one has arrived; a stale answer (the reader
         * stepped on again meanwhile) is dropped. A failure leaves the day
         * as it was, with one quiet line in the folio.
         */
        function goToDay(key) {
            if (!S.validDayKey(key) || key === state.day) return;
            var mine = ++daySeq;
            body.setAttribute('aria-busy', 'true');
            loadDayBounded(ctx, key).then(function (next) {
                if (mine !== daySeq) return;
                body.removeAttribute('aria-busy');
                var nextSets = setsOf(next);
                if (!nextSets.g.length) throw new Error('empty day file');
                data = next;
                sets = nextSets;
                if (calendarSwitch) {
                    if (calendarSwitch.hints.g) calendarSwitch.hints.g.textContent = P.formatNumber(sets.g.length);
                    if (calendarSwitch.hints.h) calendarSwitch.hints.h.textContent = P.formatNumber(sets.h.length);
                }
                var patch = { day: key, year: 0, item: 0, country: '' };
                if (state.calendar === 'h' && !sets.h.length) {
                    patch.calendar = 'g';
                    if (calendarSwitch) calendarSwitch.setActive('g');
                }
                store.patch(patch);
            }).catch(function (err) {
                if (mine !== daySeq) return;
                body.removeAttribute('aria-busy');
                console.warn('IWACVis on this day:', err);
                var folio = body.querySelector('.iwac-vis-otd-folio');
                if (folio && !folio.querySelector('.iwac-vis-otd-folio__err')) {
                    var note = P.el('p', 'iwac-vis-otd-folio__err', P.t('otd.ed_err_day'));
                    note.setAttribute('role', 'status');
                    folio.appendChild(note);
                }
            });
        }

        function draw() {
            S.setDay(state.day);
            var hijri = state.calendar === 'h' && sets.h.length > 0;
            var items = hijri ? sets.h : sets.g;
            var edition = state.layout === 'edition';

            // The country filter: offered when the day spans three countries
            // or more; a name the day does not hold falls back to all, and
            // leaves the address.
            var countries = edition ? S.countriesOf(items) : [];
            var offered = countries.length >= 3;
            var country = '';
            if (offered && state.country) {
                countries.forEach(function (c) { if (c.name === state.country) country = c.name; });
            }
            if (state.country && !country) quietly({ country: '' });
            var dayCount = items.length;
            if (country) {
                items = items.filter(function (row) { return S.readRow(row).country === country; });
            }

            var mode = {
                calendar: hijri ? 'h' : 'g',
                layout: state.layout,
                dayKey: hijri ? data.hijriKey : data.gregKey,
                gregKey: data.gregKey,
                isToday: data.gregKey === todayKey,
                country: country,
                filter: offered ? {
                    countries: countries,
                    total: dayCount,
                    active: country,
                    onChange: function (name) { store.patch({ country: name }); }
                } : null,
                leadItem: state.item,
                leadYear: state.year,
                onLead: function (oId) { store.patch({ item: oId, year: 0 }); },
                onResolve: function (oId) { quietly({ item: oId, year: 0 }); },
                nav: {
                    go: goToDay,
                    today: function () { goToDay(todayKey); },
                    random: function () {
                        richDays().then(function (rich) {
                            goToDay(S.pickRandomDay(rich, state.day));
                        });
                    }
                },
                animate: edition && firstEdition
            };
            if (edition) firstEdition = false;

            headline.textContent = hijri ? S.hijriDate() : S.gregToday();
            subline.textContent = hijri ? S.gregTodayFull() : S.hijriDate();
            desc.textContent = P.t(hijri ? 'otd.desc_h' : 'otd.desc',
                { date: hijri ? S.hijriToday() : S.gregToday() });
            // The Edition states the day's scale in its own folio line.
            desc.hidden = edition;
            panel.panel.classList.toggle('iwac-vis-otd-panel--edition', edition);

            var layout = layoutFor(state.layout) || layoutFor(DEFAULT_LAYOUT);
            var shown = layout.all
                ? items
                : S.subset(S.pickCast(items, mode.dayKey, S.MAX_CAST), layout.count);

            P.withFocusRestored(panel.panel, function () {
                body.innerHTML = '';
                body.className = 'iwac-vis-otd-body iwac-vis-otd-body--' + state.layout;
                var count = layout.render(body, shown, ctx, mode);
                body.appendChild(buildFooter(container, items,
                    typeof count === 'number' ? count : shown.length, ctx, mode, chooseLayout));
            });
        }

        store.subscribe(draw, { keys: ['calendar', 'layout', 'day', 'country'] });
        draw();
    }

    function setsOf(data) {
        return {
            g: (data.greg && data.greg.items) || [],
            h: (data.hijri && data.hijri.items) || []
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Load — and the two different ways it can fail                     */
    /* ----------------------------------------------------------------- */

    /** One day's two files — `key` (MM-DD), else the address's day, else today's. */
    function loadDay(ctx, signal, key) {
        var gregKey = key || urlDay() || S.gregKey(new Date());
        var hijriKey = S.hijriKey(gregKey);
        var opts = signal ? { signal: signal } : null;
        return Promise.all([
            P.fetchJSON(ctx.dataBase + 'on-this-day/' + gregKey + '.json', opts),
            // Optional by design — see the header note. Resolving the
            // rejection here rather than letting Promise.all reject keeps
            // a missing Hijri fan-out from taking the block down with it.
            hijriKey
                ? P.fetchJSON(ctx.dataBase + 'on-this-day/h/' + hijriKey + '.json', opts)
                    .catch(function () { return null; })
                : null
        ]).then(function (both) {
            return {
                greg: both[0], hijri: both[1],
                gregKey: gregKey, hijriKey: hijriKey
            };
        });
    }

    /**
     * `loadDay`, bounded by LOAD_TIMEOUT_MS.
     *
     * The pending request is aborted rather than merely ignored, so a stalled
     * connection stops holding one of the browser's per-origin slots while the
     * rest of the homepage is still loading. A late resolution after the
     * timeout is dropped: `settled` makes this promise answer exactly once.
     */
    function loadDayBounded(ctx, key) {
        var controller = typeof AbortController !== 'undefined'
            ? new AbortController()
            : null;
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = window.setTimeout(function () {
                if (settled) return;
                settled = true;
                if (controller) controller.abort();
                reject(new Error('timed out after ' + LOAD_TIMEOUT_MS + ' ms'));
            }, LOAD_TIMEOUT_MS);
            function finish(fn) {
                return function (value) {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timer);
                    fn(value);
                };
            }
            loadDay(ctx, controller && controller.signal, key)
                .then(finish(resolve), finish(reject));
        });
    }

    /**
     * What the block says when the day never arrived.
     *
     * Deliberately NOT the shared `.iwac-vis-error` banner: that is a 180 px
     * centred box in `--error` red, which on a homepage shouts "this site is
     * broken" about a feature nobody asked for. This is a note in the block's
     * own register instead — one hairline rule, one line of text, one quiet
     * control — and it REPLACES the spinner rather than joining it.
     */
    function buildFallback(container, ctx) {
        var box = P.el('div', 'iwac-vis-otd-fallback');
        // It stands where a live region stood, so it has to be one: a
        // screen-reader user who heard "Loading on this day…" would otherwise
        // get silence where the outcome belongs.
        box.setAttribute('role', 'status');
        box.setAttribute('aria-live', 'polite');

        // The block keeps its standing head in every state it renders. Without
        // it the failure is an unattributed line on a homepage — the reader is
        // told that something did not load, but not what — and the <h2> the
        // outline gained would quietly disappear on exactly the path where a
        // screen-reader user most needs to know which block is speaking.
        box.appendChild(P.el('h2', 'iwac-vis-otd-fallback__eyebrow', P.t('otd.title')));

        var row = P.el('div', 'iwac-vis-otd-fallback__row');
        row.appendChild(P.el('p', 'iwac-vis-otd-fallback__msg', P.t('otd.err')));

        // A bare <button> is the QUIET control in this theme — outlined, flat,
        // no halo (2.10 inverted the default). `.iwac-vis-btn` is the module's
        // own spelling of that grammar. Nothing here may render as a submit
        // control, which the theme still paints filled and glowing: a failed
        // engagement hook does not get to be the loudest thing on the page.
        var retry = P.el('button', 'iwac-vis-btn iwac-vis-otd-fallback__retry',
            P.t('otd.retry'));
        retry.type = 'button';
        retry.addEventListener('click', function () { attempt(container, ctx); });
        row.appendChild(retry);

        box.appendChild(row);
        return box;
    }

    /**
     * Route a failure to the right outcome.
     *
     * A 404 still removes the block outright — that is the engagement-hook
     * contract, and it means something specific: the per-day fan-out has not
     * been published into files/ yet (a fresh install before the admin's first
     * "Pull latest data" run). There is nothing the reader can retry.
     *
     * Everything else — a stalled request, a dropped connection, a 500, a
     * truncated body — is a failure that a second attempt can plausibly fix,
     * and the reader is better served by being told than by watching a
     * spinner. That distinction is why `onError: 'remove'` alone was not
     * enough: it treated both as "leave no trace", so the one case where the
     * block COULD recover was the one case it never offered to.
     */
    function fail(container, ctx, err) {
        if (/\bHTTP 404\b/.test(String((err && err.message) || ''))) {
            P.removeBlock(container);
            return;
        }
        console.warn('IWACVis on this day:', err);
        container.innerHTML = '';
        container.appendChild(buildFallback(container, ctx));
    }

    /** One attempt, spinner included — also the retry button's whole job. */
    function attempt(container, ctx) {
        container.innerHTML = '';
        container.appendChild(P.buildLoadingState('Loading on this day'));
        loadDayBounded(ctx).then(
            function (data) { render(container, data, ctx); },
            function (err) { fail(container, ctx, err); }
        );
    }

    P.bootBlock({
        selector:       '.iwac-vis-on-this-day',
        warnLabel:      'IWACVis on this day',
        requireECharts: false,
        load:           loadDayBounded,
        render:         render,
        onError:        function (container, err, ctx) { fail(container, ctx, err); }
    });
})();
