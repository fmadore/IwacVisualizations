/**
 * IWAC Visualizations — On This Day page block (orchestrator)
 *
 * The module's one deliberate engagement hook: items published on today's
 * date across the collection's decades — newspaper articles and periodical
 * issues with full publication dates.
 *
 * Two calendars, three layouts, one cast. The block fetches today's
 * Gregorian day file and, in parallel, the Umm al-Qura one for the same
 * moment (`on-this-day/h/{MM-DD}.json`); both are written by
 * `scripts/generate_on_this_day.py`. Each calendar picks its own documents
 * — the same lunar date across the decades is a different set of items than
 * the same solar date. The reader chooses the layout (Register / Decades /
 * Clippings); the page editor chooses which one it opens on.
 *
 * Pure DOM — no ECharts. When the day file is missing (pre-first data sync)
 * or empty, the whole block removes itself silently, like the Item Set
 * Dashboard: an engagement hook must never render an error state. The Hijri
 * file is optional on exactly the same grounds — module code ships
 * independently of the data fan-out, so a module updated before the admin's
 * next "Pull latest data" run simply hides the calendar toggle rather than
 * offering a tab that 404s.
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
            'Loading on this day': 'Loading on this day',
            'otd.title':      'On this day',
            'otd.desc':       'Published on {date}, across the decades of the collection.',
            'otd.desc_h':     'Published on {date}, across the decades of the collection: the same lunar date, one Gregorian year to the next.',
            'otd.type_a':     'Article',
            'otd.type_p':     'Periodical',
            'otd.ago':        '{count} years ago',
            'otd.ago_one':    '1 year ago',
            'otd.calendar':   'Calendar',
            'otd.cal_g':      'Gregorian',
            'otd.cal_h':      'Hijri',
            'otd.view':       'Layout',
            'otd.view_register':  'Register',
            'otd.view_decades':   'Decades',
            'otd.view_clippings': 'Clippings',
            'otd.one_more':   'One more item in the collection carries this date.',
            'otd.more':       '{count} more items in the collection carry this date.',
            'otd.show_all':   'See all {count}',
            'otd.collapse':   'Close the list'
        });
        ns.addTranslations('fr', {
            'Loading on this day': 'Chargement de « ce jour-là »',
            'otd.title':      'Ce jour-là',
            'otd.desc':       'Publiés un {date}, au fil des décennies de la collection.',
            'otd.desc_h':     'Publi\u00e9s un {date}, au fil des d\u00e9cennies de la collection : la m\u00eame date lunaire, d\u2019une ann\u00e9e gr\u00e9gorienne \u00e0 l\u2019autre.',
            'otd.type_a':     'Article',
            'otd.type_p':     'Périodique',
            'otd.ago':        'il y a {count} ans',
            'otd.ago_one':    'il y a 1 an',
            'otd.calendar':   'Calendrier',
            'otd.cal_g':      'Grégorien',
            'otd.cal_h':      'Hijri',
            'otd.view':       'Présentation',
            'otd.view_register':  'Registre',
            'otd.view_decades':   'Décennies',
            'otd.view_clippings': 'Coupures',
            'otd.one_more':   'Un autre document de la collection porte cette date.',
            'otd.more':       '{count} autres documents de la collection portent cette date.',
            'otd.show_all':   'Tout voir ({count})',
            'otd.collapse':   'Fermer la liste'
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
        { key: 'clippings', labelKey: 'otd.view_clippings', module: 'clippings' }
    ];
    var DEFAULT_LAYOUT = 'register';
    var STORE_KEY = 'iwac-vis-otd-layout';

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

    function buildFooter(items, shown, ctx, mode) {
        var rest = items.length - shown;
        var foot = P.el('div', 'iwac-vis-otd-foot');

        foot.appendChild(P.el('span', 'iwac-vis-otd-foot__count',
            rest === 1 ? P.t('otd.one_more')
                : rest > 0 ? P.t('otd.more', { count: rest })
                : ''));

        var panel = null;
        var btn = P.el('button', 'iwac-vis-otd-foot__toggle',
            P.t('otd.show_all', { count: items.length }));
        btn.type = 'button';
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', function () {
            var open = btn.getAttribute('aria-expanded') === 'true';
            if (open) {
                if (panel) panel.hidden = true;
                btn.setAttribute('aria-expanded', 'false');
                btn.textContent = P.t('otd.show_all', { count: items.length });
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
            btn.textContent = P.t('otd.collapse');
        });
        foot.appendChild(btn);

        return foot;
    }

    /* ----------------------------------------------------------------- */
    /*  Render                                                            */
    /* ----------------------------------------------------------------- */

    function render(container, data, ctx) {
        var sets = {
            g: (data.greg && data.greg.items) || [],
            h: (data.hijri && data.hijri.items) || []
        };
        if (!sets.g.length) {
            P.removeBlock(container);
            return;
        }
        var hasHijri = sets.h.length > 0 && data.hijriKey;

        container.innerHTML = '';
        var panel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-otd-panel',
            P.t('otd.title')
        );
        container.appendChild(panel.panel);

        var state = { calendar: 'g', layout: initialLayout(container) };

        /* -- masthead ------------------------------------------------- */
        var head = P.el('div', 'iwac-vis-otd-head');
        var headline = P.el('span', 'iwac-vis-otd-head__date');
        var subline = P.el('span', 'iwac-vis-otd-head__sub');
        var desc = P.el('p', 'iwac-vis-otd-head__desc');

        // The panel's <h4> is the block's accessible heading; the date
        // belongs inside it so the heading reads "On this day, 29 July"
        // rather than leaving the date as an orphaned display line. The two
        // are separate flex lines visually, but the heading is announced as
        // one string — hence the explicit separator, without which it read
        // as "On this day29 July".
        var h4 = panel.panel.querySelector('h4');
        h4.appendChild(document.createTextNode(' '));
        h4.appendChild(headline);

        var titles = P.el('div', 'iwac-vis-otd-head__titles');
        titles.appendChild(subline);
        head.appendChild(titles);

        var controls = P.el('div', 'iwac-vis-otd-head__controls');
        if (hasHijri) {
            controls.appendChild(S.segmented({
                label: P.t('otd.calendar'),
                active: 'g',
                options: [
                    { key: 'g', label: P.t('otd.cal_g'), hint: sets.g.length },
                    { key: 'h', label: P.t('otd.cal_h'), hint: sets.h.length }
                ],
                onChange: function (key) { state.calendar = key; draw(); }
            }).root);
        }
        controls.appendChild(S.segmented({
            label: P.t('otd.view'),
            active: state.layout,
            options: LAYOUTS.map(function (l) {
                return { key: l.key, label: P.t(l.labelKey) };
            }),
            onChange: function (key) {
                state.layout = key;
                rememberLayout(key);
                draw();
            }
        }).root);
        head.appendChild(controls);

        panel.chart.appendChild(head);
        panel.chart.appendChild(desc);

        /* -- body ----------------------------------------------------- */
        var body = P.el('div', 'iwac-vis-otd-body');
        // Reserved so switching layout or calendar does not bounce the page
        // under whatever the reader is looking at further down.
        body.setAttribute('aria-live', 'polite');
        panel.chart.appendChild(body);

        function draw() {
            var hijri = state.calendar === 'h';
            var items = hijri ? sets.h : sets.g;
            var mode = {
                calendar: state.calendar,
                dayKey: hijri ? data.hijriKey : data.gregKey
            };

            headline.textContent = hijri ? S.hijriDate() : S.gregToday();
            subline.textContent = hijri ? S.gregTodayFull() : S.hijriDate();
            desc.textContent = P.t(hijri ? 'otd.desc_h' : 'otd.desc',
                { date: hijri ? S.hijriToday() : S.gregToday() });

            var layout = layoutFor(state.layout) || layoutFor(DEFAULT_LAYOUT);
            var cast = S.pickCast(items, mode.dayKey, S.MAX_CAST);
            var shown = S.subset(cast, layout.count);

            body.innerHTML = '';
            body.className = 'iwac-vis-otd-body iwac-vis-otd-body--' + state.layout;
            layout.render(body, shown, ctx, mode);
            body.appendChild(buildFooter(items, shown.length, ctx, mode));
        }

        draw();
    }

    // `onError: 'remove'` is the engagement-hook contract: before the first data
    // sync there is no per-day file, and a homepage block must vanish rather
    // than render an error banner.
    P.bootBlock({
        selector:       '.iwac-vis-on-this-day',
        warnLabel:      'IWACVis on this day',
        requireECharts: false,
        load:           function (ctx) {
            var gregKey = S.gregKey();
            var hijriKey = S.hijriKey();
            return Promise.all([
                P.fetchJSON(ctx.dataBase + 'on-this-day/' + gregKey + '.json'),
                // Optional by design — see the header note. Resolving the
                // rejection here rather than letting Promise.all reject keeps
                // a missing Hijri fan-out from taking the block down with it.
                hijriKey
                    ? P.fetchJSON(ctx.dataBase + 'on-this-day/h/' + hijriKey + '.json')
                        .catch(function () { return null; })
                    : null
            ]).then(function (both) {
                return {
                    greg: both[0], hijri: both[1],
                    gregKey: gregKey, hijriKey: hijriKey
                };
            });
        },
        render:         render,
        onError:        'remove'
    });
})();
