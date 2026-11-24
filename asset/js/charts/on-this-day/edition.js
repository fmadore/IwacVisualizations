/**
 * IWAC Visualizations — On This Day: "Edition" layout
 *
 * The day composed as one front page rather than a list:
 *
 *   folio      the scale of the day in one sentence, between a double rule
 *              and a hairline, beside previous / next day, a day + month
 *              picker in the calendar on show, "Today" and "Random date";
 *              in the Hijri calendar, a row of shortcuts to the major
 *              dates under it;
 *   spine      one hairline axis from the decade of the day's first year to
 *              this year, a stack of dots for every year that has an item
 *              on this date, coloured by type — how the day recurs across
 *              the decades, at a glance. Each year is a button: choosing
 *              one makes that year's item the lead;
 *   lead       the chosen item at real size: the scan as a large clipping,
 *              top-anchored in a 4:5 hairline frame, beside a display
 *              headline, the dateline (type, source, country, date), a
 *              four-line lede (excerpt or summary, AI text marked), up to
 *              three subjects and a link to the record — or, when the item
 *              has no scan, set in type alone, larger, with no image slot.
 *              A year with several items gets a pager ("2 / 4 in 2011");
 *   briefs     six more items as typeset briefs in ruled newspaper columns,
 *              each of which can be promoted to the lead.
 *
 * The lead is an ITEM (`mode.leadItem`, `otd.item`); `mode.leadYear` is the
 * pre-v2 `otd.year`, resolved to that year's best item. The orchestrator
 * hands over the day already narrowed to one country when the reader chose
 * one (`mode.filter` carries the chips).
 *
 * Unlike the three older layouts it takes the WHOLE day (`all: true`), not
 * the shared eight-item cast: the spine has to show every year.
 *
 * Exposed as `IWACVis.onThisDay.edition`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var S = ns.onThisDay && ns.onThisDay.shared;
    if (!P || !S) {
        console.warn('IWACVis.on-this-day/edition: missing dependencies');
        return;
    }

    var BRIEFS = 6;

    /**
     * The axis opens on the decade of the day's own first year (see
     * `axisFrom`). It used to open on a fixed 1960, the collection's first
     * decade, so that 1996 stayed where it was as the reader stepped from
     * day to day. That cost more than it bought: most days begin in the
     * 1990s, so a third to a half of every axis was empty decades, and on a
     * phone — where the spine scrolls at ~14 px a year — the empty part was
     * the part the spine opened on. The trade is deliberate and owned: the
     * axis now moves between days, and a year's position is comparable
     * within a day, not across days.
     */
    function axisFrom(firstYear) {
        return Math.floor(firstYear / 10) * 10;
    }

    /** Most sources / countries a year's tooltip names before "+n". */
    var TIP_LIST = 3;

    /**
     * Centre-to-centre distance between two year controls, in CSS px. The
     * controls are 28 px wide (WCAG 2.5.8 asks for 24), and the corpus
     * crowds the 2010s — at a true scale, consecutive years sit 17 px apart
     * on a desktop. See `layoutTicks`.
     */
    var TICK_GAP = 28;
    var AXIS_PAD = 20;

    /** Px per year of a spine that scrolls (a phone): ~1 000 px for 67 years. */
    var YEAR_MIN = 14;

    /** Dots drawn per year; a busier year says its full count in its name. */
    var MAX_DOTS = 6;

    /** Round anniversaries, rarest first — see `rankLead`. */
    var ANNIVERSARIES = [75, 60, 50, 40, 30, 25, 20, 10];

    /**
     * The Hijri shortcuts, in the order of the lunar year, under the names
     * the francophone West African press prints: Achoura, Maouloud,
     * Ramadan, Korité, Tabaski (English pairs the international name with
     * the local one). Keyed by Hijri MM-DD; `S.gregKeyForHijri` turns each
     * into the Gregorian day file it falls on this cycle.
     */
    var FEASTS = [
        { key: '01-10', label: 'otd.feast_ashura' },
        { key: '03-12', label: 'otd.feast_mawlid' },
        { key: '09-01', label: 'otd.feast_ramadan' },
        { key: '10-01', label: 'otd.feast_korite' },
        { key: '12-10', label: 'otd.feast_tabaski' }
    ];

    /** A dot's colour class per item type: the theme's --type-* map. */
    var DOT_CLASS = {
        a: 'iwac-vis-otd-tick__dot--article',
        p: 'iwac-vis-otd-tick__dot--publication',
        v: 'iwac-vis-otd-tick__dot--audiovisual',
        d: 'iwac-vis-otd-tick__dot--document',
        i: 'iwac-vis-otd-tick__dot--photograph'
    };

    /** A year's items in type order (stable inside a type). */
    function sortByType(group) {
        return group.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
            return (S.TYPE_ORDER.indexOf(a.it.type) - S.TYPE_ORDER.indexOf(b.it.type)) || (a.i - b.i);
        }).map(function (x) { return x.it; });
    }

    /** "A, B, C +2" — distinct values, most frequent first. */
    function nameList(values) {
        var seen = {}, order = [];
        values.forEach(function (v) {
            if (!v) return;
            if (!seen[v]) { seen[v] = 0; order.push(v); }
            seen[v]++;
        });
        order.sort(function (a, b) { return seen[b] - seen[a]; });
        var shown = order.slice(0, TIP_LIST).join(', ');
        return order.length > TIP_LIST ? shown + ' +' + (order.length - TIP_LIST) : shown;
    }

    /** The year's sources and countries, one line each, empty ones dropped. */
    function tipFacts(group) {
        return [
            nameList(group.map(function (it) { return it.source; })),
            nameList(group.map(function (it) { return S.countryLabel(it.country); }))
        ].filter(Boolean);
    }

    function reducedMotion() {
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (e) {
            return false;
        }
    }

    /* ----------------------------------------------------------------- */
    /*  Lead selection                                                    */
    /* ----------------------------------------------------------------- */

    /** Years since the item, in the calendar on show (lunar years in Hijri mode). */
    function yearsAgo(it, mode) {
        if (mode.calendar === 'h') {
            var now = S.hijriYearNow();
            return now && it.hYear ? now - it.hYear : null;
        }
        return new Date().getFullYear() - it.year;
    }

    /**
     * The day's lead, chosen without randomness so the page is the same for
     * every visitor all day long, and testable:
     *
     *   1. the item with the most to show: scan and excerpt, then scan
     *      alone, then excerpt alone. A scan always leads when the day has
     *      one — the clipping is what the front page is for;
     *   2. among equals, a round anniversary — 75, 60, 50, 40, 30, 25, 20 or
     *      10 years ago, counted in the calendar on show, the rarer (larger)
     *      first. It breaks a tie; it never puts a text-only item ahead of
     *      a scanned one;
     *   3. then the oldest item, then the day file's own order.
     *
     * The year spine lets the reader override it; `bestOf` applies the same
     * order inside the one year they pick.
     *
     * @returns {number} index into `items`
     */
    function rankLead(items, mode) {
        var best = -1, bestKey = null;
        items.forEach(function (it, i) {
            var key = leadKey(it, mode, i);
            if (best < 0 || compareKeys(key, bestKey) < 0) {
                best = i;
                bestKey = key;
            }
        });
        return best;
    }

    /** Whether an item has copy to set as a lede: its excerpt or a summary. */
    function hasText(it) {
        return !!(it.excerpt || it.summaryFr || it.summaryEn);
    }

    function quality(it) {
        return (it.thumb ? 2 : 0) + (hasText(it) ? 1 : 0);
    }

    function leadKey(it, mode, index) {
        var ago = yearsAgo(it, mode);
        var round = ANNIVERSARIES.indexOf(ago);
        return [-quality(it), round >= 0 ? round : ANNIVERSARIES.length, it.year, index];
    }

    function compareKeys(a, b) {
        for (var i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
        }
        return 0;
    }

    /**
     * One year's items, best first, by rules 1 and 3 above — the order the
     * lead's per-year pager walks. Indices into `items`.
     */
    function rankYear(items, year, mode) {
        var pool = [];
        items.forEach(function (it, i) {
            if (it.year !== year) return;
            var key = leadKey(it, mode, i);
            key[1] = 0; // anniversary rank is moot inside one year
            pool.push({ i: i, key: key });
        });
        pool.sort(function (a, b) { return compareKeys(a.key, b.key); });
        return pool.map(function (p) { return p.i; });
    }

    /** The best item of one year, or -1. */
    function bestOf(items, year, mode) {
        var ranked = rankYear(items, year, mode);
        return ranked.length ? ranked[0] : -1;
    }

    /**
     * The lead the address asks for. `otd.item` (an o_id) wins when the day
     * — after any country filter — holds it; `otd.year`, the key shared
     * links carried before the lead became an item, resolves to that year's
     * best item; anything else, or nothing, is the ranked default.
     *
     * @returns {{index:number, stale:boolean}} `stale` when the address
     *   named a lead this set does not hold
     */
    function resolveLead(items, mode) {
        var i;
        if (mode.leadItem) {
            for (i = 0; i < items.length; i++) {
                if (items[i].oId === mode.leadItem) return { index: i, stale: false };
            }
        }
        if (mode.leadYear) {
            i = bestOf(items, mode.leadYear, mode);
            if (i >= 0) return { index: i, stale: !!mode.leadItem };
        }
        return { index: rankLead(items, mode), stale: !!(mode.leadItem || mode.leadYear) };
    }

    /**
     * The copy a lead sets under its headline, and whether a model wrote it.
     *
     * The excerpt is the item's own words, in its own language (mostly
     * French). The summaries are AI-generated descriptions, written in both
     * languages for articles and documents. So the French page prefers the
     * excerpt, and the English page the English summary — an English reader
     * gets prose they can read, marked as a model's — then the excerpt, then
     * the French summary.
     *
     * @returns {{text:string, ai:boolean, lang:string}} `lang` only where the
     *   language is known (the summaries); empty text when there is none
     */
    function ledeText(it, locale) {
        if (locale === 'fr') {
            if (it.excerpt) return { text: it.excerpt, ai: false, lang: '' };
            if (it.summaryFr) return { text: it.summaryFr, ai: true, lang: 'fr' };
            return { text: '', ai: false, lang: '' };
        }
        if (it.summaryEn) return { text: it.summaryEn, ai: true, lang: 'en' };
        if (it.excerpt) return { text: it.excerpt, ai: false, lang: '' };
        if (it.summaryFr) return { text: it.summaryFr, ai: true, lang: 'fr' };
        return { text: '', ai: false, lang: '' };
    }

    /**
     * A brief's two lines: always the excerpt when there is one — a brief is
     * a cutting — else the page language's summary (the English page falling
     * back to the French one), marked as a model's.
     */
    function briefText(it, locale) {
        if (it.excerpt) return { text: it.excerpt, ai: false, lang: '' };
        if (locale !== 'fr' && it.summaryEn) return { text: it.summaryEn, ai: true, lang: 'en' };
        if (it.summaryFr) return { text: it.summaryFr, ai: true, lang: 'fr' };
        return { text: '', ai: false, lang: '' };
    }

    /**
     * The briefs: `n` items spread across the day's years, chronological,
     * preferring ones with an excerpt — a brief is headline, source and two
     * lines of copy, and without the copy it is a ledger row.
     *
     * Delegates the spread to `S.pickCast`, which buckets by year and
     * prefers whatever sits in a row's sixth slot. Here that slot carries
     * "has an excerpt" instead of "has a scan", through a proxy row that
     * remembers where it came from.
     */
    function pickBriefs(items, exclude, dayKey, n) {
        var proxy = [];
        items.forEach(function (it, i) {
            if (i === exclude) return;
            proxy.push([it.year, i, '', '', '', hasText(it) ? '1' : '']);
        });
        return S.pickCast(proxy, dayKey + ':briefs', n).map(function (row) { return row[1]; });
    }

    /* ----------------------------------------------------------------- */
    /*  Spine geometry                                                    */
    /* ----------------------------------------------------------------- */

    /**
     * Positions for the year controls along a track of `width` px.
     *
     * Each year wants its true place on a linear scale, but neighbours must
     * stay `gap` apart to remain separate 24 px+ targets. That is an
     * isotonic least-squares problem: subtract `i * gap` from each ideal
     * position, fit a non-decreasing sequence by pool-adjacent-violators
     * (equal weights, so each pool takes its mean), add the gaps back. A
     * crowded run (2013–2020) fans out around its own centre; an isolated
     * year does not move at all. When even that cannot fit — a phone holding
     * thirty years — the track grows and the spine scrolls.
     *
     * @returns {{width:number, x:Array<number>}}
     */
    function layoutTicks(years, from, to, width, gap, pad) {
        var n = years.length;
        var span = Math.max(1, to - from);
        var need = (n - 1) * gap + 2 * pad;
        // Once the track has to scroll anyway, give it room enough for a
        // near-true scale (YEAR_MIN px a year), rather than squeezing the
        // empty decades to nothing to fit the crowded ones.
        var w = need > width ? Math.max(need, span * YEAR_MIN + 2 * pad) : width;
        var pools = [];
        years.forEach(function (y, i) {
            var ideal = pad + (y - from) / span * (w - 2 * pad);
            pools.push({ sum: ideal - i * gap, count: 1 });
            while (pools.length > 1) {
                var b = pools[pools.length - 1], a = pools[pools.length - 2];
                if (a.sum / a.count <= b.sum / b.count) break;
                a.sum += b.sum;
                a.count += b.count;
                pools.pop();
            }
        });
        var lo = pad, hi = w - pad - (n - 1) * gap;
        var x = [];
        pools.forEach(function (p) {
            var q = Math.min(Math.max(p.sum / p.count, lo), hi);
            for (var k = 0; k < p.count; k++) x.push(q + x.length * gap);
        });
        return { width: w, x: x };
    }

    /**
     * Year -> px through the laid-out ticks, linear between them: the decade
     * labels must agree with the dots, so the axis stretches where a crowded
     * run fanned out and nowhere else. Monotone by construction.
     */
    function scaleThrough(years, x, from, to, width, pad) {
        var ys = [from], xs = [pad];
        years.forEach(function (y, i) {
            if (y > ys[ys.length - 1]) { ys.push(y); xs.push(x[i]); }
        });
        if (to > ys[ys.length - 1]) { ys.push(to); xs.push(width - pad); }
        return function (year) {
            if (year <= ys[0]) return xs[0];
            for (var i = 1; i < ys.length; i++) {
                if (year <= ys[i]) {
                    return xs[i - 1] + (year - ys[i - 1]) / (ys[i] - ys[i - 1]) * (xs[i] - xs[i - 1]);
                }
            }
            return xs[xs.length - 1];
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Folio: the scale sentence and the day navigation                  */
    /* ----------------------------------------------------------------- */

    /**
     * The folio's one sentence. `country` (a canonical name) when the reader
     * filtered the day to one country: the sentence then names it — "8 items
     * from Togo and 3 newspapers, 1994–2016." — rather than "from 1 country".
     */
    function scaleSentence(items, country) {
        // Min / max rather than first / last: the day files are written
        // year-ascending, but nothing here should depend on it.
        var from = Infinity, to = -Infinity;
        items.forEach(function (it) {
            if (it.year < from) from = it.year;
            if (it.year > to) to = it.year;
        });
        if (items.length === 1) return P.t('otd.ed_scale_single', { year: String(from) });

        // With geography (v2 rows): "22 items from 4 countries and 7
        // newspapers, 1994–2016." Each count carries its own plural, so the
        // sentence is assembled from three counted phrases. Old rows carry
        // no country, and keep the sentence they always had.
        var countries = {}, sources = {}, nCountries = 0, nSources = 0;
        items.forEach(function (it) {
            if (it.country && !countries[it.country]) { countries[it.country] = true; nCountries++; }
            if (it.source && !sources[it.source]) { sources[it.source] = true; nSources++; }
        });
        if (nCountries) {
            var parts = {
                items: P.t('items_count', { count: items.length }),
                countries: P.t('otd.n_countries', { count: nCountries }),
                country: country ? S.countryFrom(country) : '',
                titles: P.t('otd.n_titles', { count: nSources }),
                from: String(from),
                to: String(to),
                year: String(from)
            };
            var key = (country ? 'otd.ed_scale_c' : 'otd.ed_scale_geo') + (nSources ? '' : '_nt');
            return P.t(from === to ? key + '_same' : key, parts);
        }

        if (from === to) return P.t('otd.ed_scale_same', { count: items.length, year: String(from) });
        return P.t('otd.ed_scale', { count: items.length, from: String(from), to: String(to) });
    }

    /**
     * The day + month picker, in the calendar on show. Navigation is keyed
     * by Gregorian day files, so a Hijri choice is turned into the
     * Gregorian day it falls on this cycle (`S.gregKeyForHijri`).
     */
    function buildPicker(mode, nav) {
        var hijri = mode.calendar === 'h';
        var pick = P.el('div', 'iwac-vis-otd-daynav__pick');
        var uid = Math.random().toString(36).slice(2, 8);

        var month, day, monthNames;
        if (hijri) {
            var hk = (S.hijriKey(mode.gregKey) || '01-01').split('-');
            month = parseInt(hk[0], 10);
            day = parseInt(hk[1], 10);
            monthNames = [];
            for (var hm = 1; hm <= 12; hm++) monthNames.push(ns.hijri.monthName(hm));
        } else {
            var parts = mode.gregKey.split('-');
            month = parseInt(parts[0], 10);
            day = parseInt(parts[1], 10);
            monthNames = S.monthNames();
        }
        var maxDay = function (m) { return hijri ? 30 : S.daysIn(m); };

        // Named for everyone, shown to no one: the two selects read as one
        // date, and the label beside them was a third thing to read before
        // the first document.
        var label = P.el('label', 'iwac-vis-otd-daynav__label', P.t('otd.ed_choose'));
        label.htmlFor = 'iwac-vis-otd-day-' + uid;
        pick.appendChild(label);

        var daySel = P.el('select', 'iwac-vis-control iwac-vis-otd-daynav__day');
        daySel.id = 'iwac-vis-otd-day-' + uid;
        daySel.setAttribute('data-iwac-control', 'otd-day');
        for (var d = 1; d <= maxDay(month); d++) {
            var opt = P.el('option', null, ns.locale === 'fr' && d === 1 ? '1er' : String(d));
            opt.value = String(d);
            daySel.appendChild(opt);
        }
        daySel.value = String(day);

        var monthSel = P.el('select', 'iwac-vis-control iwac-vis-otd-daynav__month');
        monthSel.setAttribute('data-iwac-control', 'otd-month');
        monthSel.setAttribute('aria-label', P.t(hijri ? 'otd.ed_month_h' : 'otd.ed_month'));
        monthNames.forEach(function (name, m) {
            var o = P.el('option', null, name);
            o.value = String(m + 1);
            monthSel.appendChild(o);
        });
        monthSel.value = String(month);

        function chosen() {
            var m = parseInt(monthSel.value, 10);
            var dd = Math.min(parseInt(daySel.value, 10), maxDay(m));
            var key = S.pad2(m) + '-' + S.pad2(dd);
            return hijri ? S.gregKeyForHijri(key) : key;
        }
        function go() {
            var key = chosen();
            if (key) nav.go(key);
        }
        daySel.addEventListener('change', go);
        monthSel.addEventListener('change', go);

        pick.appendChild(S.selectShell(daySel));
        pick.appendChild(S.selectShell(monthSel));
        return pick;
    }

    /** Achoura · Maouloud · Ramadan · Korité · Tabaski — Hijri mode only. */
    function buildFeasts(mode, nav) {
        var current = S.hijriKey(mode.gregKey);
        var row = P.el('nav', 'iwac-vis-otd-feasts');
        row.setAttribute('aria-label', P.t('otd.ed_feasts'));
        var list = P.el('ul', 'iwac-vis-otd-feasts__list');
        FEASTS.forEach(function (f) {
            var btn = P.el('button', 'iwac-vis-otd-feast', P.t(f.label));
            btn.type = 'button';
            btn.setAttribute('data-iwac-control', 'otd-feast-' + f.key);
            btn.setAttribute('data-hijri', f.key);
            if (f.key === current) btn.setAttribute('aria-current', 'date');
            btn.addEventListener('click', function () {
                var key = S.gregKeyForHijri(f.key);
                if (key) nav.go(key);
            });
            var li = P.el('li');
            li.appendChild(btn);
            list.appendChild(li);
        });
        row.appendChild(list);
        return row;
    }

    /**
     * "All 26 · Benin 5 · Burkina Faso 5 · Côte d'Ivoire 8 · Togo 8" — the
     * day narrowed to one country. The orchestrator offers it (`mode.filter`)
     * only when the whole day spans three countries or more, and does the
     * filtering itself, so the footer's count and "See all" list follow it.
     * The calendar switch's grammar: pressed chips in a named group, every
     * chip a tab stop, the arrow keys moving along the row.
     */
    function buildCountryFilter(filter) {
        var slugs = {};
        var options = [{ key: 'all', label: P.t('otd.ed_country_all'), hint: filter.total }];
        filter.countries.forEach(function (c, i) {
            // A `data-iwac-control` handle has to be a plain token for the
            // focus to come back to the chip after the redraw.
            var slug = 'c' + i + '-' + String(c.name).normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
            slugs[slug] = c.name;
            options.push({ key: slug, label: S.countryLabel(c.name), hint: c.count });
        });
        var active = 'all';
        Object.keys(slugs).forEach(function (k) { if (slugs[k] === filter.active) active = k; });
        var seg = S.segmented({
            label: P.t('otd.ed_country'),
            name: 'otd-country',
            active: active,
            options: options,
            onChange: function (key) { filter.onChange(slugs[key] || ''); }
        });
        seg.root.classList.add('iwac-vis-otd-countries');
        return seg.root;
    }

    function buildFolio(items, mode) {
        var folio = P.el('div', 'iwac-vis-otd-folio');

        var scale = P.el('p', 'iwac-vis-otd-folio__scale',
            scaleSentence(items, mode.filter && mode.filter.active));
        if (mode.calendar === 'h') {
            scale.appendChild(document.createTextNode(' '));
            scale.appendChild(P.el('span', 'iwac-vis-otd-folio__note', P.t('otd.ed_caveat_h')));
        }
        folio.appendChild(scale);

        var nav = mode.nav;
        if (!nav) {
            if (mode.filter) folio.appendChild(buildCountryFilter(mode.filter));
            return folio;
        }

        var bar = P.el('nav', 'iwac-vis-otd-daynav');
        bar.setAttribute('aria-label', P.t('otd.ed_nav'));

        function stepButton(offset, icon, keyName, cls) {
            var label = S.neighbourLabel(mode.gregKey, offset, mode.calendar);
            var btn = P.el('button', 'iwac-vis-btn iwac-vis-otd-daynav__step ' + cls);
            btn.type = 'button';
            btn.setAttribute('data-iwac-control', 'otd-' + cls.split('--')[1]);
            btn.setAttribute('aria-label', P.t(keyName, { date: label }));
            var glyph = P.icon && P.icon(icon);
            var text = P.el('span', null, label);
            if (offset < 0) {
                if (glyph) btn.appendChild(glyph);
                btn.appendChild(text);
            } else {
                btn.appendChild(text);
                if (glyph) btn.appendChild(glyph);
            }
            btn.addEventListener('click', function () {
                nav.go(S.shiftDay(mode.gregKey, offset));
            });
            return btn;
        }

        bar.appendChild(stepButton(-1, 'chevron-left', 'otd.ed_prev', 'iwac-vis-otd-daynav__step--prev'));

        // Day + month, in the order the page's language writes a date — both
        // locales here put the day first ("15 November", "15 novembre"),
        // and the Hijri convention is day-month too ("15 Safar").
        bar.appendChild(buildPicker(mode, nav));

        bar.appendChild(stepButton(1, 'chevron-right', 'otd.ed_next', 'iwac-vis-otd-daynav__step--next'));

        var todayBtn = P.el('button', 'iwac-vis-btn iwac-vis-otd-daynav__today', P.t('otd.ed_today'));
        todayBtn.type = 'button';
        todayBtn.setAttribute('data-iwac-control', 'otd-today');
        // Present but inert on today itself, so the row keeps its shape and
        // the focus a reader parked on it does not fall to <body>.
        if (mode.isToday) todayBtn.setAttribute('aria-disabled', 'true');
        todayBtn.addEventListener('click', function () {
            if (todayBtn.getAttribute('aria-disabled') === 'true') return;
            nav.today();
        });
        bar.appendChild(todayBtn);

        if (nav.random) {
            var randomBtn = P.el('button', 'iwac-vis-btn iwac-vis-otd-daynav__random');
            randomBtn.type = 'button';
            randomBtn.setAttribute('data-iwac-control', 'otd-random');
            P.setIcon(randomBtn, 'shuffle', P.t('otd.ed_random'));
            randomBtn.addEventListener('click', function () { nav.random(); });
            bar.appendChild(randomBtn);
        }

        folio.appendChild(bar);
        if (mode.filter) folio.appendChild(buildCountryFilter(mode.filter));
        if (mode.calendar === 'h') folio.appendChild(buildFeasts(mode, nav));
        return folio;
    }

    /* ----------------------------------------------------------------- */
    /*  Lead                                                              */
    /* ----------------------------------------------------------------- */

    /**
     * One "· value" of a meta line. The interpunct travels with the value it
     * introduces, so a line that wraps never ends on a dangling "·" (a long
     * source name — "Association des élèves et étudiants musulmans au Togo"
     * — used to leave one at the end of the line and the next value alone
     * on the line below).
     */
    function metaPart(meta, text, cls) {
        var part = P.el('span', 'iwac-vis-otd-meta__part');
        part.appendChild(P.el('span', 'iwac-vis-otd-meta__sep', '·'));
        part.appendChild(P.el('span', cls || null, text));
        meta.appendChild(part);
    }

    /** "● PERIODICAL · ISLAM INFO · CÔTE D'IVOIRE · 24 NOV 2006". */
    function dateline(it, mode) {
        var meta = P.el('p', 'iwac-vis-otd-meta iwac-vis-otd-lead__dateline');
        meta.appendChild(S.typeBadge(it.type));
        if (it.source) metaPart(meta, it.source);
        if (it.country) metaPart(meta, S.countryLabel(it.country), 'iwac-vis-otd-meta__country');
        metaPart(meta, mode.calendar === 'h' ? S.hijriDate(it.hYear) : S.gregDate(it.year, mode.dayKey),
            'iwac-vis-otd-meta__date');
        return meta;
    }

    function agoText(it, mode) {
        var ago = yearsAgo(it, mode);
        if (!(ago > 0)) return '';
        return P.t(mode.calendar === 'h' ? 'otd.ed_ago_h' : 'otd.ago', { count: ago });
    }

    /** "Read the item" / "Watch the recording" / "See the image", by type. */
    var CTA = { v: 'otd.ed_cta_v', i: 'otd.ed_cta_i' };

    /**
     * The AI provenance mark: the module's own (the laïcité dossier's) — a
     * sparkle and a quiet --ink-light label in words, never a colour alone.
     * The theme's EU "AI GENERATED" plate is a theme asset the module cannot
     * address from the embed route, so it is not borrowed here.
     */
    function aiLabel(cls) {
        var label = P.el('p', 'iwac-vis-otd-ai ' + cls);
        var glyph = P.icon && P.icon('sparkles');
        if (glyph) {
            glyph.setAttribute('aria-hidden', 'true');
            label.appendChild(glyph);
        }
        label.appendChild(P.el('span', null, P.t('otd.ai_summary')));
        return label;
    }

    /** Up to three index records, each a link to its page — the lead only. */
    function subjectList(it, ctx) {
        var subjects = (it.subjects || []).slice(0, 3);
        if (!subjects.length) return null;
        var list = P.el('ul', 'iwac-vis-otd-subjects');
        list.setAttribute('aria-label', P.t('otd.ed_subjects'));
        subjects.forEach(function (s) {
            var li = P.el('li');
            var chip;
            if (s.oId) {
                chip = document.createElement('a');
                chip.href = S.itemUrl(ctx, s.oId);
            } else {
                chip = document.createElement('span');
            }
            chip.className = 'iwac-vis-otd-subject';
            chip.textContent = s.label;
            li.appendChild(chip);
            list.appendChild(li);
        });
        return list;
    }

    /**
     * "1 / 4 in 2011  ‹ ›" — the lead's year holds more than one item. The
     * buttons cycle the year's items in rank order and wrap, so neither is
     * ever disabled under a reader's focus; their `data-iwac-control` handles
     * are how focus finds them again in the rebuilt lead.
     */
    function buildPager(pos, count, year, onStep) {
        var pager = P.el('div', 'iwac-vis-otd-pager');
        pager.setAttribute('role', 'group');
        pager.setAttribute('aria-label', P.t('otd.ed_pager_group', { year: String(year) }));
        function step(dir, icon, key) {
            var btn = P.el('button', 'iwac-vis-btn iwac-vis-otd-pager__btn');
            btn.type = 'button';
            btn.setAttribute('data-iwac-control', 'otd-pager-' + (dir < 0 ? 'prev' : 'next'));
            btn.setAttribute('aria-label', P.t(key, { year: String(year) }));
            var glyph = P.icon && P.icon(icon);
            if (glyph) btn.appendChild(glyph);
            else btn.textContent = dir < 0 ? '‹' : '›';
            btn.addEventListener('click', function () { onStep(dir); });
            return btn;
        }
        pager.appendChild(P.el('span', 'iwac-vis-otd-pager__count',
            P.t('otd.ed_pager', { n: String(pos + 1), count: String(count), year: String(year) })));
        pager.appendChild(step(-1, 'chevron-left', 'otd.ed_pager_prev'));
        pager.appendChild(step(1, 'chevron-right', 'otd.ed_pager_next'));
        return pager;
    }

    /**
     * @param {Object} it
     * @param {Object} ctx
     * @param {Object} mode
     * @param {HTMLElement} [pager]  from buildPager, when the year holds more
     */
    function buildLead(it, ctx, mode, pager) {
        var href = S.itemUrl(ctx, it.oId);
        var lead = P.el('article', 'iwac-vis-otd-lead' + (it.thumb ? '' : ' iwac-vis-otd-lead--type'));
        lead.setAttribute('data-year', String(it.year));
        lead.setAttribute('data-o-id', String(it.oId));
        // The plate's shape follows the item's: a page is a portrait, a
        // recording's frame and a photograph are not (see the stylesheet).
        lead.setAttribute('data-type', it.type);

        if (it.thumb) {
            // A second way into the same record for a pointer; the headline
            // is the one a keyboard or a screen reader meets.
            var plate = document.createElement('a');
            plate.className = 'iwac-vis-otd-lead__plate';
            plate.href = href;
            plate.tabIndex = -1;
            plate.setAttribute('aria-hidden', 'true');
            var img = document.createElement('img');
            img.className = 'iwac-vis-otd-lead__scan';
            // `large` (800 px on the longest side): the frame runs to ~470
            // CSS px wide on a desktop and the whole phone width, where
            // `medium` (200 px) is a blur. One image per page, lazy, and the
            // frame's aspect-ratio holds its box before it arrives.
            img.src = S.thumbUrl(ctx, it.thumb, 'large');
            img.width = 800;
            img.height = 1000;
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            // A storage id that no longer resolves sets the lead in type
            // rather than leaving a broken-image frame on a front page.
            img.addEventListener('error', function () {
                if (plate.parentNode) plate.parentNode.removeChild(plate);
                lead.classList.add('iwac-vis-otd-lead--type');
            });
            plate.appendChild(img);
            lead.appendChild(plate);
        }

        var text = P.el('div', 'iwac-vis-otd-lead__text');

        var kicker = P.el('p', 'iwac-vis-otd-lead__kicker');
        kicker.appendChild(P.el('span', 'iwac-vis-otd-year iwac-vis-otd-lead__year', String(it.year)));
        // A round anniversary is said in words ("Exactly 20 years ago") and
        // set in the primary: the colour is never the only signal.
        var years = yearsAgo(it, mode);
        var exact = ANNIVERSARIES.indexOf(years) >= 0;
        var ago = exact
            ? P.t(mode.calendar === 'h' ? 'otd.ed_exact_h' : 'otd.ed_exact', { count: years })
            : agoText(it, mode);
        if (ago) {
            kicker.appendChild(P.el('span',
                'iwac-vis-otd-lead__ago' + (exact ? ' iwac-vis-otd-lead__ago--exact' : ''), ago));
        }
        text.appendChild(kicker);
        if (pager) text.appendChild(pager);

        var body = P.el('div', 'iwac-vis-otd-lead__body');
        // A long headline steps down the scale: at full display size a
        // 130-character title ran to six lines and pushed the lede below
        // the scan.
        var title = P.el('h3', 'iwac-vis-otd-lead__title'
            + (it.title.length > 80 ? ' iwac-vis-otd-lead__title--long' : ''));
        var link = document.createElement('a');
        link.href = href;
        link.textContent = it.title;
        title.appendChild(link);
        body.appendChild(title);

        body.appendChild(dateline(it, mode));

        var lede = ledeText(it, ns.locale);
        if (lede.text) {
            if (lede.ai) body.appendChild(aiLabel('iwac-vis-otd-lead__ai'));
            var para = P.el('p', 'iwac-vis-otd-lead__lede', lede.text);
            if (lede.lang) para.lang = lede.lang;
            body.appendChild(para);
        }

        var subjects = subjectList(it, ctx);
        if (subjects) body.appendChild(subjects);

        // A second way into the record, worded by what the reader will find
        // there. Out of the tab order and the accessibility tree, like the
        // scan plate: the headline is the link a keyboard or a screen reader
        // meets, and two adjacent links with different names for one target
        // would only be heard twice.
        var cta = document.createElement('a');
        cta.className = 'iwac-vis-otd-lead__cta';
        cta.href = href;
        cta.tabIndex = -1;
        cta.setAttribute('aria-hidden', 'true');
        cta.appendChild(P.el('span', null, P.t(CTA[it.type] || 'otd.ed_cta_a')));
        var arrow = P.icon && P.icon('arrow-right');
        if (arrow) cta.appendChild(arrow);
        body.appendChild(cta);

        text.appendChild(body);
        lead.appendChild(text);
        return lead;
    }

    /* ----------------------------------------------------------------- */
    /*  Briefs                                                            */
    /* ----------------------------------------------------------------- */

    /**
     * @param {function(): void} [onPromote]  makes this brief the lead
     */
    function buildBrief(it, ctx, mode, onPromote) {
        var brief = P.el('li', 'iwac-vis-otd-brief');
        brief.setAttribute('data-o-id', String(it.oId));

        var head = P.el('p', 'iwac-vis-otd-brief__stamp');
        head.appendChild(P.el('span', 'iwac-vis-otd-year iwac-vis-otd-brief__year', String(it.year)));
        var ago = agoText(it, mode);
        if (ago) head.appendChild(P.el('span', 'iwac-vis-otd-brief__ago', ago));
        brief.appendChild(head);

        var title = P.el('h4', 'iwac-vis-otd-brief__title');
        var link = document.createElement('a');
        link.href = S.itemUrl(ctx, it.oId);
        link.textContent = it.title;
        title.appendChild(link);
        brief.appendChild(title);

        var meta = P.el('p', 'iwac-vis-otd-meta');
        meta.appendChild(S.typeBadge(it.type));
        if (it.source) metaPart(meta, it.source);
        if (it.country) metaPart(meta, S.countryLabel(it.country), 'iwac-vis-otd-meta__country');
        if (mode.calendar === 'h' && it.hYear) metaPart(meta, S.hijriDate(it.hYear), 'iwac-vis-otd-meta__date');
        brief.appendChild(meta);

        var copy = briefText(it, ns.locale);
        if (copy.text) {
            if (copy.ai) brief.appendChild(aiLabel('iwac-vis-otd-brief__ai'));
            var para = P.el('p', 'iwac-vis-otd-excerpt iwac-vis-otd-brief__copy', copy.text);
            if (copy.lang) para.lang = copy.lang;
            brief.appendChild(para);
        }

        if (onPromote) {
            // Quiet and secondary: the title is still the way to the record.
            // Its name carries the title, so a list of six "Show as lead"
            // buttons is not six identical names out of context.
            var promote = P.el('button', 'iwac-vis-otd-brief__promote', P.t('otd.ed_promote'));
            promote.type = 'button';
            promote.setAttribute('aria-label', P.t('otd.ed_promote_named', { title: it.title }));
            promote.addEventListener('click', onPromote);
            brief.appendChild(promote);
        }
        return brief;
    }

    /* ----------------------------------------------------------------- */
    /*  Render                                                            */
    /* ----------------------------------------------------------------- */

    /**
     * @param {HTMLElement} host
     * @param {Array} rows   the whole day, year-ascending
     * @param {Object} ctx
     * @param {Object} mode  calendar, dayKey, gregKey, isToday, leadYear,
     *                       onLead(year), nav {go(key), today()}, animate
     * @returns {number} how many items the page shows (lead + briefs)
     */
    function render(host, rows, ctx, mode) {
        var items = rows.map(S.readRow);
        if (!items.length) return 0;

        var root = P.el('div', 'iwac-vis-otd-edition' + (mode.animate && !reducedMotion() ? ' is-drawing' : ''));
        root.appendChild(buildFolio(items, mode));

        /* -- spine ------------------------------------------------------ */
        var years = [], byYear = {};
        items.forEach(function (it) {
            if (!byYear[it.year]) { byYear[it.year] = []; years.push(it.year); }
            byYear[it.year].push(it);
        });
        years.sort(function (a, b) { return a - b; });
        var from = axisFrom(years[0]);
        var to = Math.max(new Date().getFullYear(), years[years.length - 1]);

        var defaultLead = rankLead(items, mode);
        var resolved = resolveLead(items, mode);
        var leadIndex = resolved.index;
        // An old `otd.year` link, or an `otd.item` this set does not hold:
        // the address is rewritten to the lead actually on show.
        if ((resolved.stale || (mode.leadYear && !mode.leadItem)) && mode.onResolve) {
            mode.onResolve(leadIndex === defaultLead ? 0 : items[leadIndex].oId);
        }

        var spine = P.el('div', 'iwac-vis-otd-spine');
        var scroller = P.el('div', 'iwac-vis-otd-spine__scroller');
        var track = P.el('div', 'iwac-vis-otd-spine__track');
        var axis = P.el('div', 'iwac-vis-otd-spine__axis');
        axis.setAttribute('aria-hidden', 'true');
        var scaleRow = P.el('div', 'iwac-vis-otd-spine__scale');
        scaleRow.setAttribute('aria-hidden', 'true');
        var ticksRow = P.el('div', 'iwac-vis-otd-spine__ticks');
        ticksRow.setAttribute('role', 'toolbar');
        ticksRow.setAttribute('aria-label', P.t('otd.ed_spine', {
            date: mode.calendar === 'h' ? S.hijriToday() : S.gregToday()
        }));

        // Each year's description — sources, countries, the item it would
        // lead with — lives in a hidden node the tick points at. The visible
        // tooltip repeats it for a pointer or a keyboard and is aria-hidden,
        // so a screen reader hears it once, after the tick's own name.
        var descs = P.el('div', 'iwac-vis-otd-spine__descs');
        descs.hidden = true;
        var uid = Math.random().toString(36).slice(2, 8);
        var typesPresent = {};

        var ticks = years.map(function (year) {
            var group = byYear[year];
            var btn = P.el('button', 'iwac-vis-otd-tick');
            btn.type = 'button';
            btn.setAttribute('data-year', String(year));
            btn.setAttribute('aria-label', P.t('otd.ed_tick', { year: String(year), count: group.length }));
            btn.tabIndex = -1;

            var desc = P.el('span', null, tipFacts(group).concat([bestTitle(year)]).filter(Boolean).join('. '));
            desc.id = 'iwac-vis-otd-tick-' + uid + '-' + year;
            descs.appendChild(desc);
            btn.setAttribute('aria-describedby', desc.id);

            // Stacked by type, so a year's colours group rather than
            // interleave; a busier year says its full count in its name.
            var dots = P.el('span', 'iwac-vis-otd-tick__dots');
            dots.setAttribute('aria-hidden', 'true');
            sortByType(group).slice(0, MAX_DOTS).forEach(function (it) {
                typesPresent[it.type] = true;
                dots.appendChild(P.el('span', 'iwac-vis-otd-tick__dot ' + DOT_CLASS[it.type]));
            });
            group.forEach(function (it) { typesPresent[it.type] = true; });
            btn.appendChild(dots);
            var label = P.el('span', 'iwac-vis-otd-tick__year', String(year));
            label.setAttribute('aria-hidden', 'true');
            btn.appendChild(label);
            btn.addEventListener('click', function () { choose(year, true); });
            ticksRow.appendChild(btn);
            return btn;
        });

        function bestTitle(year) {
            var i = bestOf(items, year, mode);
            return i >= 0 ? items[i].title : '';
        }

        // Roving focus: one tab stop for the whole spine, arrows along it.
        ticksRow.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { hideTip(); return; }
            var at = ticks.indexOf(document.activeElement);
            if (at < 0) return;
            var next = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(at + 1, ticks.length - 1);
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(at - 1, 0);
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = ticks.length - 1;
            if (next === null) return;
            e.preventDefault();
            focusTick(next);
        });

        function focusTick(i) {
            ticks.forEach(function (t, k) { t.tabIndex = k === i ? 0 : -1; });
            ticks[i].focus({ preventScroll: true });
            reveal(ticks[i], false);
            showTip(ticks[i]);
        }

        /**
         * Scroll the spine — never the page — to bring a control into view:
         * centred when `centre`, otherwise only if it is outside the view.
         * Reads the tick's laid-out `left`, so it is right only after
         * `place()`; `place()` calls it last, every time.
         */
        function reveal(btn, centre) {
            if (!btn) return;
            var view = scroller.clientWidth;
            var max = scroller.scrollWidth - view;
            if (!(view > 0) || max <= 0) return;
            var x = parseFloat(btn.style.left) || 0;
            if (!centre && x >= scroller.scrollLeft + TICK_GAP && x <= scroller.scrollLeft + view - TICK_GAP) return;
            scroller.scrollLeft = Math.min(max, Math.max(0, Math.round(x - view / 2)));
        }

        /** What a re-layout keeps in view: the tick under focus, else the lead. */
        function anchorTick() {
            var at = ticks.indexOf(document.activeElement);
            return at >= 0 ? ticks[at] : ticks[years.indexOf(items[leadIndex].year)];
        }

        track.appendChild(ticksRow);
        track.appendChild(axis);
        track.appendChild(scaleRow);
        scroller.appendChild(track);
        spine.appendChild(scroller);
        spine.appendChild(descs);

        /* -- legend: only the types this day holds ---------------------- */
        var present = S.TYPE_ORDER.filter(function (t) { return typesPresent[t]; });
        if (present.length) {
            var legend = P.el('ul', 'iwac-vis-otd-spine__legend');
            legend.setAttribute('aria-label', P.t('otd.ed_legend'));
            present.forEach(function (t) {
                var li = P.el('li', 'iwac-vis-otd-spine__key');
                var swatch = P.el('span', 'iwac-vis-otd-tick__dot ' + DOT_CLASS[t]);
                swatch.setAttribute('aria-hidden', 'true');
                li.appendChild(swatch);
                li.appendChild(P.el('span', null, S.typeLabel(t)));
                legend.appendChild(li);
            });
            spine.appendChild(legend);
        }

        /* -- tooltip ---------------------------------------------------- */
        // A child of the spine, not of the scroller: the scroller's
        // overflow would clip it at both ends of the track.
        var tip = P.el('div', 'iwac-vis-otd-tip');
        tip.setAttribute('aria-hidden', 'true');
        tip.hidden = true;
        spine.appendChild(tip);
        var tipFor = null;

        function showTip(btn) {
            var year = parseInt(btn.getAttribute('data-year'), 10);
            var group = byYear[year];
            if (!group) return;
            tip.innerHTML = '';
            tip.appendChild(P.el('p', 'iwac-vis-otd-tip__head',
                String(year) + ' · ' + P.t('items_count', { count: group.length })));
            tipFacts(group).forEach(function (line) {
                tip.appendChild(P.el('p', 'iwac-vis-otd-tip__line', line));
            });
            var title = bestTitle(year);
            if (title) tip.appendChild(P.el('p', 'iwac-vis-otd-tip__title', title));
            tip.hidden = false;
            tipFor = btn;
            positionTip();
        }

        function positionTip() {
            if (!tipFor || tip.hidden) return;
            var box = spine.getBoundingClientRect();
            var at = tipFor.getBoundingClientRect();
            // Off the visible part of the spine: say nothing rather than
            // point at a year the reader cannot see.
            if (at.right < box.left || at.left > box.right) { hideTip(); return; }
            // Over the year's figure, which stands on its dots — the
            // button itself is taller than the stack it carries.
            var face = tipFor.querySelector('.iwac-vis-otd-tick__year');
            var top = face ? face.getBoundingClientRect().top : at.top;
            var w = tip.offsetWidth;
            var x = at.left + at.width / 2 - box.left - w / 2;
            tip.style.left = Math.max(0, Math.min(box.width - w, x)) + 'px';
            tip.style.top = (top - box.top - tip.offsetHeight - 6) + 'px';
        }

        function hideTip() {
            tip.hidden = true;
            tipFor = null;
        }

        ticks.forEach(function (btn) {
            // A pointer that hovers; never a tap, which already chooses.
            btn.addEventListener('pointerenter', function (e) {
                if (e.pointerType !== 'touch') showTip(btn);
            });
            btn.addEventListener('pointerleave', function () {
                if (tipFor === btn && document.activeElement !== btn) hideTip();
            });
            // Keyboard focus only: a tap focuses the button too, but not
            // visibly, and the tooltip follows `:focus-visible`.
            btn.addEventListener('focus', function () {
                var visible = true;
                try { visible = btn.matches(':focus-visible'); } catch (err) { /* old engine: show it */ }
                if (visible) showTip(btn);
            });
            btn.addEventListener('blur', function () { if (tipFor === btn) hideTip(); });
        });
        scroller.addEventListener('scroll', positionTip, { passive: true });
        root.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !tip.hidden) hideTip();
        });

        root.appendChild(spine);

        /**
         * Lay the ticks out for the scroller's width, then put the anchor
         * tick back in view. A scroller with no width yet (the block was
         * rendered hidden, or before its column settled) is left alone: the
         * ResizeObserver lays it out when the width arrives.
         *
         * The reveal lives HERE, not once after the first layout. That was
         * the phone bug: the spine was revealed exactly once, synchronously
         * at render, and every later `place()` — the ResizeObserver's, when
         * the scroller's width changed after render — rebuilt the track
         * without it. A first pass that measured no width laid a 900 px
         * track that did not scroll (so `reveal` returned early), and the
         * re-layout that followed left the now-scrolling spine at
         * scrollLeft 0: the empty 1960s, no dots.
         *
         * @returns {boolean} whether it could lay out
         */
        function place(centre) {
            var avail = scroller.clientWidth;
            if (!(avail > 0)) {
                if (typeof ResizeObserver !== 'undefined') return false;
                avail = 900;
            }
            var laid = layoutTicks(years, from, to, avail, TICK_GAP, AXIS_PAD);
            track.style.width = laid.width + 'px';
            spine.classList.toggle('iwac-vis-otd-spine--scrolls', laid.width > avail + 1);
            ticks.forEach(function (btn, i) {
                btn.style.left = laid.x[i] + 'px';
                // A unitless CSS number (never locale-formatted): 0 at the axis' start, 1 at its end.
                btn.style.setProperty('--iwac-vis-otd-delay', String(Math.round(laid.x[i] / laid.width * 1000) / 1000));
            });
            var scale = scaleThrough(years, laid.x, from, to, laid.width, AXIS_PAD);
            scaleRow.innerHTML = '';
            var last = -Infinity;
            for (var dec = Math.ceil(from / 10) * 10; dec <= to; dec += 10) {
                var x = scale(dec);
                if (x - last < 44) continue;
                var mark = P.el('span', 'iwac-vis-otd-spine__decade', String(dec));
                mark.style.left = x + 'px';
                scaleRow.appendChild(mark);
                last = x;
            }
            reveal(anchorTick(), centre !== false);
            positionTip();
            return true;
        }

        /* -- lead ------------------------------------------------------- */
        var leadSlot = P.el('div', 'iwac-vis-otd-lead-slot');
        leadSlot.setAttribute('aria-live', 'polite');

        /** The lead for `items[index]`, with its year's pager when it has one. */
        function leadFor(index) {
            var it = items[index];
            var ranked = rankYear(items, it.year, mode);
            var pager = null;
            if (ranked.length > 1) {
                var pos = ranked.indexOf(index);
                pager = buildPager(pos, ranked.length, it.year, function (dir) {
                    setLead(ranked[(pos + dir + ranked.length) % ranked.length], { fromReader: true });
                });
            }
            return buildLead(it, ctx, mode, pager);
        }

        var currentLead = leadFor(leadIndex);
        leadSlot.appendChild(currentLead);
        root.appendChild(leadSlot);

        /* -- briefs ----------------------------------------------------- */
        // Seven drawn, six shown: when the reader lifts one of them into
        // the lead, the seventh closes the gap and nothing else moves.
        var briefPool = pickBriefs(items, defaultLead, mode.dayKey, BRIEFS + 1);
        var briefsWrap = P.el('section', 'iwac-vis-otd-briefs');
        var briefsHead = P.el('h3', 'iwac-vis-otd-briefs__head', P.t('otd.ed_briefs'));
        briefsHead.id = 'iwac-vis-otd-briefs-' + Math.random().toString(36).slice(2, 8);
        briefsWrap.setAttribute('aria-labelledby', briefsHead.id);
        briefsWrap.appendChild(briefsHead);
        var briefList = P.el('ul', 'iwac-vis-otd-briefs__list');
        briefsWrap.appendChild(briefList);

        function paintBriefs() {
            briefList.innerHTML = '';
            var shown = 0;
            briefPool.forEach(function (i) {
                if (i === leadIndex || shown >= BRIEFS) return;
                briefList.appendChild(buildBrief(items[i], ctx, mode, function () {
                    setLead(i, { fromReader: true, focusHeadline: true });
                }));
                shown++;
            });
            briefsWrap.hidden = shown === 0;
            return shown;
        }
        var briefCount = paintBriefs();
        root.appendChild(briefsWrap);

        function markTicks() {
            var year = items[leadIndex].year;
            ticks.forEach(function (btn, i) {
                var on = years[i] === year;
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.classList.toggle('is-lead', on);
            });
            // The tab stop follows the lead unless the reader is moving
            // along the spine right now.
            if (ticks.indexOf(document.activeElement) < 0) {
                ticks.forEach(function (btn, i) { btn.tabIndex = years[i] === year ? 0 : -1; });
            }
        }

        /** Make `year`'s best item the lead; `fromReader` persists the choice. */
        function choose(year, fromReader) {
            setLead(bestOf(items, year, mode), { fromReader: fromReader });
        }

        /**
         * Make `items[index]` the lead — the one path for a spine year, the
         * pager and a promoted brief. `fromReader` writes the choice to the
         * address (`otd.item`, 0 for the ranked default). Focus: a pager
         * button the reader pressed is found again in the rebuilt lead by its
         * handle; a promoted brief sends focus to the new headline, scrolling
         * the lead into view only when it is off the screen.
         */
        function setLead(index, opts) {
            opts = opts || {};
            if (index < 0 || index === leadIndex) return;
            var active = document.activeElement;
            var handle = active && currentLead.contains(active)
                ? active.getAttribute('data-iwac-control') : null;
            leadIndex = index;
            markTicks();
            reveal(ticks[years.indexOf(items[index].year)], false);
            var next = leadFor(index);
            swapLead(next);
            paintBriefs();
            if (opts.fromReader && mode.onLead) {
                mode.onLead(leadIndex === defaultLead ? 0 : items[leadIndex].oId);
            }
            var target = null;
            if (handle) target = next.querySelector('[data-iwac-control="' + handle + '"]');
            else if (opts.focusHeadline) target = next.querySelector('.iwac-vis-otd-lead__title a');
            if (opts.focusHeadline) bringIntoView(next);
            if (target) {
                try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
            }
        }

        /** Scroll the page to the lead only if its headline is off the screen. */
        function bringIntoView(lead) {
            var head = lead.querySelector('.iwac-vis-otd-lead__title') || lead;
            var box = head.getBoundingClientRect();
            var vh = window.innerHeight || document.documentElement.clientHeight;
            if (box.top >= 0 && box.bottom <= vh) return;
            try {
                leadSlot.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
            } catch (e) {
                leadSlot.scrollIntoView(true);
            }
        }

        /**
         * Cross-fade inside the lead's own box. Old and new share one grid
         * cell, so the box holds the taller of the two while they overlap,
         * and the height it reaches is kept as a floor afterwards: the page
         * below never jumps, on the way in or on the way out.
         */
        function swapLead(next) {
            var prev = currentLead;
            currentLead = next;
            if (reducedMotion()) {
                leadSlot.replaceChild(next, prev);
                return;
            }
            next.classList.add('is-entering');
            leadSlot.appendChild(next);
            prev.classList.add('is-leaving');
            var floor = leadSlot.offsetHeight;
            leadSlot.style.minHeight = floor + 'px';
            // Two frames: the entering lead must paint at opacity 0 once
            // before the class that fades it in arrives.
            window.requestAnimationFrame(function () {
                window.requestAnimationFrame(function () { next.classList.remove('is-entering'); });
            });
            var done = false;
            function finish() {
                if (done) return;
                done = true;
                if (prev.parentNode) prev.parentNode.removeChild(prev);
            }
            prev.addEventListener('transitionend', finish);
            window.setTimeout(finish, 400);
        }

        markTicks();
        host.appendChild(root);
        var laidOut = place();

        // Once the reader moves the spine themselves, a later re-layout
        // keeps their tick or the lead in view (`place` reveals without
        // centring) but the settling pass below no longer re-centres.
        var readerScrolled = false;
        ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach(function (type) {
            scroller.addEventListener(type, function () { readerScrolled = true; }, { passive: true });
        });

        // Re-lay the spine when the block's width changes (a rotated phone,
        // a resized window, a column that settles after render, or a block
        // rendered while hidden); nothing else in the page depends on pixels.
        if (typeof ResizeObserver !== 'undefined') {
            var lastWidth = laidOut ? scroller.clientWidth : 0;
            var ro = new ResizeObserver(function () {
                if (!root.isConnected) { ro.disconnect(); return; }
                if (scroller.clientWidth === lastWidth) return;
                lastWidth = scroller.clientWidth;
                place(!readerScrolled);
            });
            ro.observe(scroller);
        }

        // And once more after the first paint: an offset set in the task that
        // created the scroller is not kept by every engine (WebKit's async
        // scrolling can drop it), and the draw-in must end on the lead.
        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
                if (root.isConnected && !readerScrolled) reveal(anchorTick(), true);
            });
        });

        if (root.classList.contains('is-drawing')) {
            // The draw-in plays once; afterwards the classes it keys on are
            // gone, so a re-layout can never replay it.
            window.setTimeout(function () { root.classList.remove('is-drawing'); }, 1400);
        }

        return 1 + briefCount;
    }

    ns.onThisDay = ns.onThisDay || {};
    ns.onThisDay.edition = {
        all: true,
        count: Infinity,
        render: render,
        // Exposed for the unit tests: the rules the page claims to follow.
        rankLead: rankLead,
        rankYear: rankYear,
        resolveLead: resolveLead,
        ledeText: ledeText,
        briefText: briefText,
        layoutTicks: layoutTicks,
        axisFrom: axisFrom,
        scaleSentence: scaleSentence,
        bestOf: bestOf
    };
})();
