/**
 * IWAC Visualizations — On This Day: shared primitives
 *
 * Everything the three layouts have in common: the two calendars, the
 * deterministic daily pick, item-row access, plate (thumbnail) building and
 * the segmented control the header uses twice.
 *
 * Exposed as `IWACVis.onThisDay.shared`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var H = ns.hijri;
    if (!P || !H) {
        console.warn('IWACVis.on-this-day/shared: panels.js and hijri.js must load first');
        return;
    }

    /** Widest layout's item count — the shared "cast" every layout draws from. */
    var MAX_CAST = 8;

    function pad2(n) {
        var s = String(n);
        return s.length < 2 ? '0' + s : s;
    }

    /**
     * The locale every Gregorian dateline in this block is formatted in —
     * `en-GB` for English, deliberately not the module-wide `en-US` that
     * `IWACVis.formatNumber` and `P.formatDate` use.
     *
     * The dateline is a typographic device here, not a data cell: the register
     * rows carry it under a masthead, in the grammar of a press archive. In
     * `en-US` that device rendered `08/18/1976` — a form the collection's
     * francophone West African and European readership reads as 8 December,
     * and which no scholarly citation style uses. Day-month-year is also the
     * order the corpus itself is written in, and the project's house style is
     * British English, so the two agree.
     *
     * Scoped to this file on purpose. Chart axis ticks and table cells go
     * through `P.formatDate`, whose `en-US` medium form is a different
     * decision in a different register — changing it here would silently
     * reformat twenty other blocks.
     */
    function datelineLocale() {
        return ns.locale === 'fr' ? 'fr-FR' : 'en-GB';
    }

    /* ----------------------------------------------------------------- */
    /*  Calendars                                                         */
    /* ----------------------------------------------------------------- */

    /**
     * The day the block is showing — today unless the reader chose another
     * date (the Edition layout's day navigation, or `otd.day` in the URL).
     *
     * Every dateline in the block derives from this one reference, so the
     * three older layouts follow a chosen day without knowing it exists. The
     * reference carries the CURRENT year: "15 November" is the 15 November
     * that comes round this year, and its Hijri counterpart is converted from
     * that date — always post-2000, where the client's Umm al-Qura agrees with
     * the generator's (see `hijriKey`). 29 February borrows the latest leap
     * year, since a non-leap year has no such day to convert.
     */
    var reference = null;

    function today() {
        return reference ? new Date(reference.getTime()) : new Date();
    }

    /** True for a well-formed MM-DD that names a real calendar day (29 Feb included). */
    function validDayKey(key) {
        var m = /^(\d\d)-(\d\d)$/.exec(String(key || ''));
        if (!m) return false;
        var month = parseInt(m[1], 10), day = parseInt(m[2], 10);
        return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(month);
    }

    /** Days in a month, February counted as 29 — every one has a day file. */
    function daysIn(month) {
        return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 31;
    }

    /** The Date a MM-DD stands for: this year's, or the latest leap year's 29 Feb. */
    function dateFor(key) {
        var bits = String(key).split('-');
        var month = parseInt(bits[0], 10), day = parseInt(bits[1], 10);
        var year = new Date().getFullYear();
        if (month === 2 && day === 29) {
            while (new Date(year, 1, 29).getMonth() !== 1) year--;
        }
        return new Date(year, month - 1, day);
    }

    /** Point the block at `key` (MM-DD), or back at today with a falsy key. */
    function setDay(key) {
        reference = key && validDayKey(key) && key !== gregKey(new Date()) ? dateFor(key) : null;
        todayHijri = undefined;
    }

    /** The MM-DD `offset` days from `key` — the Edition's previous / next day. */
    function shiftDay(key, offset) {
        var bits = String(key).split('-');
        // Walked in a leap year (2000), so 28 February steps to the 29th in
        // every year: the almanac has 366 day files, not this year's 365.
        return gregKey(new Date(2000, parseInt(bits[0], 10) - 1, parseInt(bits[1], 10) + offset));
    }

    /** Gregorian MM-DD — the day file to fetch. */
    function gregKey(d) {
        d = d || today();
        return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    /**
     * Today's Hijri parts, memoised — every Hijri label on the page derives
     * from this one conversion. Null where the engine has no Umm al-Qura
     * data, which is what makes the whole Hijri affordance disappear rather
     * than mislabel Gregorian numbers (see shared/hijri.js).
     */
    var todayHijri;

    function hijriParts() {
        if (todayHijri === undefined) todayHijri = H.parts(today());
        return todayHijri;
    }

    /**
     * Hijri MM-DD for today, or null — the caller then hides the toggle.
     *
     * Only ever called on *today*, which is why converting client-side is
     * safe at all: the generator buckets items with the Umm al-Qura tables
     * and ICU only agrees with those from 2000 onward (see the generator
     * docstring). Today is always in the agreeing range; historical dates
     * are never re-converted here — they carry their Hijri year in the data.
     */
    function hijriKey(gKey) {
        var h = gKey ? H.parts(dateFor(gKey)) : hijriParts();
        return h ? pad2(h.month) + '-' + pad2(h.day) : null;
    }

    /**
     * The Gregorian MM-DD on which a Hijri MM-DD falls in the current
     * cycle — what the Edition's Hijri picker and its feast shortcuts hand
     * to the day navigation, which is keyed by Gregorian day files.
     *
     * Scans the days of the CURRENT Gregorian year through the same
     * conversion `hijriKey` uses (so `hijriKey(result) === hKey` whenever
     * the date exists), never a pre-2000 date. A lunar year is eleven days
     * shorter than a solar one, so a Hijri date falls once or twice in a
     * Gregorian year:
     *
     *   - twice: the first occurrence on or after `anchor` (today's MM-DD by
     *     default), else the last one before it — the nearest upcoming, then
     *     the most recent, deterministically;
     *   - a 30th the month does not have in this cycle clamps to the 29th
     *     (Umm al-Qura months run 29 or 30 days).
     *
     * @param {string} hKey     Hijri MM-DD
     * @param {string} [anchor] Gregorian MM-DD the choice is made from
     * @returns {string|null}   Gregorian MM-DD, or null without Hijri support
     */
    function gregKeyForHijri(hKey, anchor) {
        var m = /^(\d\d)-(\d\d)$/.exec(String(hKey || ''));
        if (!m || !H.available()) return null;
        var month = parseInt(m[1], 10), day = parseInt(m[2], 10);
        if (month < 1 || month > 12 || day < 1 || day > 30) return null;
        var hits = occurrences(month, day);
        if (!hits.length && day === 30) hits = occurrences(month, 29);
        if (!hits.length) return null;
        var from = anchor && validDayKey(anchor) ? anchor : gregKey(new Date());
        for (var i = 0; i < hits.length; i++) {
            if (hits[i] >= from) return hits[i];
        }
        return hits[hits.length - 1];
    }

    /** Gregorian MM-DDs of this year whose Hijri date is month/day, in order. */
    var cycle = null;

    function occurrences(month, day) {
        var year = new Date().getFullYear();
        // One conversion pass per year, then a lookup: Hijri MM-DD -> keys.
        if (!cycle || cycle.year !== year) {
            cycle = { year: year, map: {} };
            for (var d = new Date(year, 0, 1); d.getFullYear() === year; d = new Date(year, d.getMonth(), d.getDate() + 1)) {
                var h = H.parts(d);
                if (!h) continue;
                var k = pad2(h.month) + '-' + pad2(h.day);
                (cycle.map[k] = cycle.map[k] || []).push(gregKey(d));
            }
        }
        return (cycle.map[pad2(month) + '-' + pad2(day)] || []).slice();
    }

    /** All 366 day keys, 01-01 to 12-31 with 29 February. */
    function allDayKeys() {
        var out = [], key = '01-01';
        do { out.push(key); key = shiftDay(key, 1); } while (key !== '01-01');
        return out;
    }

    /**
     * A day for the "Random date" button: uniform over `rich` (the
     * generator's list of days worth landing on), never the day on show;
     * uniform over every valid day when the list is empty or absent (an
     * older data fan-out has no `rich`).
     *
     * @param {Array<string>} rich
     * @param {string} exclude  the current MM-DD
     * @param {function(): number} [rnd]  Math.random, injectable for tests
     */
    function pickRandomDay(rich, exclude, rnd) {
        rnd = rnd || Math.random;
        var pool = (Array.isArray(rich) ? rich : []).filter(function (k) {
            return validDayKey(k) && k !== exclude;
        });
        if (!pool.length) {
            pool = allDayKeys().filter(function (k) { return k !== exclude; });
        }
        return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
    }

    /** "16 November" / "16 Jumada II" — a day `offset` away, in the calendar on show. */
    function neighbourLabel(gKey, offset, calendar) {
        var d = dateFor(shiftDay(gKey, offset));
        if (calendar === 'h') {
            var h = H.parts(d);
            if (h) return H.format(h.day, h.month);
        }
        try {
            return frenchFirst(d.toLocaleDateString(datelineLocale(), {
                day: 'numeric', month: 'long'
            }), d.getDate());
        } catch (e) {
            return gregKey(d);
        }
    }

    /** Twelve month names in the dateline locale — the Edition's date picker. */
    function monthNames() {
        var out = [];
        for (var m = 0; m < 12; m++) {
            try {
                out.push(new Date(2000, m, 1).toLocaleDateString(datelineLocale(), { month: 'long' }));
            } catch (e) {
                out.push(pad2(m + 1));
            }
        }
        return out;
    }

    /**
     * The Hijri year of the day on show — what the Edition counts Hijri
     * anniversaries from. Today's when the reference is the borrowed leap
     * year of 29 February, whose Hijri year is not this one.
     */
    function hijriYearNow() {
        var h = today().getFullYear() === new Date().getFullYear() ? hijriParts() : H.parts(new Date());
        return h ? h.year : null;
    }

    /**
     * French writes the first of the month as an ordinal, "1er janvier";
     * Intl prints the cardinal, "1 janvier". Applied to a date string that
     * starts with its day.
     */
    function frenchFirst(text, day) {
        return (ns.locale === 'fr' && day === 1) ? String(text).replace(/^1(?!\d)/, '1er') : text;
    }

    /** "29 juillet" / "29 July" — today, no year. */
    function gregToday() {
        try {
            return frenchFirst(today().toLocaleDateString(datelineLocale(), {
                day: 'numeric', month: 'long'
            }), today().getDate());
        } catch (e) {
            return gregKey();
        }
    }

    /** "29 juillet 2026" / "29 July 2026". */
    function gregTodayFull() {
        try {
            return frenchFirst(today().toLocaleDateString(datelineLocale(), {
                day: 'numeric', month: 'long', year: 'numeric'
            }), today().getDate());
        } catch (e) {
            return gregToday();
        }
    }

    /**
     * Today's Hijri day and month, carrying `hYear` — "15 Safar 1383".
     * Pass no year for today's own date ("15 Safar 1448").
     *
     * The day and month are always TODAY's: that is what the block means by
     * "on this day". Only the year varies down the list, and it comes from
     * the data rather than from a second conversion — the two converters
     * disagree on pre-2000 dates, so re-deriving it here would print a date
     * one day off from the file the item is filed under.
     */
    function hijriDate(hYear) {
        var h = hijriParts();
        if (!h) return hYear ? String(hYear) : '';
        return H.format(h.day, h.month, hYear || h.year);
    }

    /** Today's Hijri day and month, no year — "15 Safar". */
    function hijriToday() {
        var h = hijriParts();
        return h ? H.format(h.day, h.month) : '';
    }

    /**
     * An item's own publication date, abbreviated: "18 Aug 1976" /
     * "18 août 1976".
     *
     * Named months rather than a numeric triple. The all-numeric form is the
     * one place a dateline can be actively misread — `08/18/1976` is a US
     * convention that a European or West African reader parses as an invalid
     * 8 December, and there is no cue in the string to tell them otherwise.
     * An abbreviated month name is unambiguous in every locale, and it is
     * also the form the theme's press-archive register asks for: a dateline
     * under a masthead reads as type, not as a field value.
     *
     * The formatter is built once — the "see all" disclosure formats up to 91
     * of these in a single pass, and constructing an `Intl.DateTimeFormat` is
     * the expensive half of the operation.
     */
    var datelineFormat;

    function gregDate(year, dayKey) {
        var bits = String(dayKey || gregKey()).split('-');
        try {
            if (!datelineFormat) {
                datelineFormat = new Intl.DateTimeFormat(datelineLocale(), {
                    day: 'numeric', month: 'short', year: 'numeric'
                });
            }
            return frenchFirst(datelineFormat.format(
                new Date(year, parseInt(bits[0], 10) - 1, parseInt(bits[1], 10))
            ), parseInt(bits[1], 10));
        } catch (e) {
            return bits[1] + '.' + bits[0] + '.' + year;
        }
    }

    /* ----------------------------------------------------------------- */
    /*  Rows                                                              */
    /* ----------------------------------------------------------------- */

    /**
     * Positional row -> named fields.
     *
     * Tolerates the pre-v1.27 five-element row: code ships independently of
     * data (the admin's "Pull latest data" job is what refreshes the day
     * files), so a new module will render against an old fan-out until then.
     * Missing thumb / excerpt simply render as absent, not as blanks.
     */
    /**
     * The row grew twice: v1.27 added thumb / excerpt / hijri year (5 -> 8),
     * and On This Day v2 adds country, the two AI summaries and up to three
     * subject chips (-> 12):
     *
     *   [year, o_id, title, source, type, thumb, excerpt, hYear,
     *    country, summaryFr, summaryEn, subjects]
     *
     * `type` is 'a' article, 'p' periodical issue, 'v' audiovisual, 'd'
     * document, 'i' image; anything else reads as an article, as it always
     * has. `hYear` 0 means unknown. `subjects` is a list of
     * `[label, indexOId]`, read here as `{label, oId}`.
     */
    function readRow(row) {
        row = row || [];
        var subjects = [];
        if (Array.isArray(row[11])) {
            row[11].forEach(function (s) {
                if (Array.isArray(s) && s[0]) subjects.push({ label: String(s[0]), oId: s[1] || null });
            });
        }
        return {
            year:      row[0],
            oId:       row[1],
            title:     row[2] || '',
            source:    row[3] || '',
            type:      TYPES[row[4]] ? row[4] : 'a',
            thumb:     row[5] || '',
            excerpt:   row[6] || '',
            hYear:     row[7] || null,
            country:   row[8] || '',
            summaryFr: row[9] || '',
            summaryEn: row[10] || '',
            subjects:  subjects
        };
    }

    /**
     * Item types, in the order the spine stacks them and the legend lists
     * them. `badge` is the type-badge modifier (the theme's --type-* map:
     * article, publication, audiovisual, document, photograph).
     */
    var TYPE_ORDER = ['a', 'p', 'v', 'd', 'i'];
    var TYPES = {
        a: { badge: 'iwac-vis-badge--article',     label: 'otd.type_a', glyph: 'newspaper' },
        p: { badge: 'iwac-vis-badge--publication', label: 'otd.type_p', glyph: 'book-open' },
        v: { badge: 'iwac-vis-badge--audiovisual', label: 'otd.type_v', glyph: 'play' },
        d: { badge: 'iwac-vis-badge--document',    label: 'otd.type_d', glyph: 'newspaper' },
        i: { badge: 'iwac-vis-badge--photograph',  label: 'otd.type_i', glyph: 'newspaper' }
    };

    /**
     * A country in the page's language. The rows carry the canonical IWAC
     * spelling (`iwac_utils.canonical_country`), which is the French one;
     * the module prints that spelling as-is everywhere else, and of the six
     * only Bénin is spelt differently in English.
     */
    var COUNTRY_EN = { 'Bénin': 'Benin', 'Sénégal': 'Senegal', 'Cameroun': 'Cameroon', 'Tchad': 'Chad', 'Guinée': 'Guinea', 'Mauritanie': 'Mauritania' };

    function countryLabel(name) {
        if (!name) return '';
        return ns.locale === 'fr' ? name : (COUNTRY_EN[name] || name);
    }

    /**
     * "from Togo" is one phrase in English and three in French: « du Togo »,
     * « de Côte d’Ivoire », « de Guinée ». Returns what follows the
     * preposition slot of a sentence — the bare name in English, the name
     * with its « du / de » in French — so the dictionaries can say
     * "{items} from {country}" and « {items} {country} » respectively.
     */
    var FR_DU = { 'Bénin': 1, 'Burkina Faso': 1, 'Niger': 1, 'Nigeria': 1, 'Togo': 1, 'Sénégal': 1, 'Cameroun': 1, 'Tchad': 1, 'Ghana': 1, 'Mali': 1 };

    function countryFrom(name) {
        if (!name) return '';
        if (ns.locale !== 'fr') return countryLabel(name);
        return (FR_DU[name] ? 'du ' : 'de ') + String(name).replace(/'/g, '’');
    }

    /**
     * The day's countries with their counts, in the order of their names in
     * the page's language. Rows without a country (old fan-outs, or an item
     * with none) are counted by nobody.
     *
     * @param {Array} rows  raw day-file rows
     * @returns {Array<{name:string, count:number}>}
     */
    function countriesOf(rows) {
        var counts = {}, names = [];
        (rows || []).forEach(function (row) {
            var c = Array.isArray(row) ? row[8] : row && row.country;
            if (!c) return;
            if (!counts[c]) { counts[c] = 0; names.push(c); }
            counts[c]++;
        });
        names.sort(function (a, b) { return countryLabel(a).localeCompare(countryLabel(b), ns.locale === 'fr' ? 'fr' : 'en'); });
        return names.map(function (n) { return { name: n, count: counts[n] }; });
    }

    /**
     * The day's cast: `n` items spread across the collection's decades,
     * preferring ones that carry a scan.
     *
     * Buckets by YEAR RANGE, not by position in the list. The corpus is
     * heavily skewed towards the 2010s — a typical day holds 46 items of
     * which 33 are post-2013 — so cutting the list into equal-count segments
     * gives five of eight slots to one decade and renders a block promising
     * "across the decades" as a wall of recent years. Equal spans of time
     * instead put 1971 and 2024 on the same page, which is the whole point
     * of the block.
     *
     * Within a bucket, items with a thumbnail win: the two image-forward
     * layouts lead with the scan and only ~44 % of fully-dated items have
     * one. A per-date seed rotates which item represents its era, so the
     * cast changes from day to day yet is identical for every visitor.
     *
     * Empty eras are common (the collection has no 1980s Thursdays to
     * offer), so whatever the buckets leave short is backfilled from the
     * fullest ones and the result re-sorted by year.
     */
    function pickCast(items, dayKey, n) {
        n = n || MAX_CAST;
        if (!items || items.length <= n) return (items || []).slice();

        var seed = 0;
        for (var i = 0; i < dayKey.length; i++) {
            seed = (seed * 31 + dayKey.charCodeAt(i)) % 997;
        }

        var yearMin = items[0][0], yearMax = items[0][0];
        for (i = 1; i < items.length; i++) {
            if (items[i][0] < yearMin) yearMin = items[i][0];
            if (items[i][0] > yearMax) yearMax = items[i][0];
        }
        var span = (yearMax - yearMin) + 1;

        var buckets = [];
        for (i = 0; i < n; i++) buckets.push([]);
        for (i = 0; i < items.length; i++) {
            var b = Math.floor((items[i][0] - yearMin) / span * n);
            buckets[Math.min(Math.max(b, 0), n - 1)].push(i);
        }

        var taken = {};
        var picked = [];

        /** One index from `pool`, thumbnail first, rotated by the seed. */
        function draw(pool, nth) {
            var free = [], withThumb = [];
            for (var j = 0; j < pool.length; j++) {
                if (taken[pool[j]]) continue;
                free.push(pool[j]);
                if (items[pool[j]][5]) withThumb.push(pool[j]);
            }
            if (!free.length) return -1;
            var from = withThumb.length ? withThumb : free;
            var idx = from[(seed + nth) % from.length];
            taken[idx] = true;
            return idx;
        }

        buckets.forEach(function (bucket, k) {
            if (!bucket.length) return;
            var idx = draw(bucket, k);
            if (idx >= 0) picked.push(idx);
        });

        // Backfill from the most crowded eras, largest first, until full.
        var order = buckets.slice().sort(function (a, b) { return b.length - a.length; });
        for (var pass = 0; picked.length < n && pass < items.length; pass++) {
            var progressed = false;
            for (i = 0; i < order.length && picked.length < n; i++) {
                var more = draw(order[i], picked.length);
                if (more >= 0) { picked.push(more); progressed = true; }
            }
            if (!progressed) break;
        }

        picked.sort(function (a, b) { return a - b; });
        return picked.map(function (idx) { return items[idx]; });
    }

    /**
     * Evenly-spaced `n` of the cast, endpoints included.
     *
     * Layouts differ in density (5 / 6 / 8) but draw from one cast, so
     * switching views changes the rhythm without swapping the documents out
     * from under the reader.
     */
    function subset(cast, n) {
        if (!cast || cast.length <= n) return (cast || []).slice();
        if (n <= 1) return cast.slice(0, n);
        var out = [];
        for (var k = 0; k < n; k++) {
            out.push(cast[Math.round(k * (cast.length - 1) / (n - 1))]);
        }
        return out;
    }

    /* ----------------------------------------------------------------- */
    /*  Pieces                                                            */
    /* ----------------------------------------------------------------- */

    /** Same type-badge grammar as IwacSearch result rows (iwac-core.css). */
    function typeBadge(type) {
        var def = TYPES[type] || TYPES.a;
        return P.el('span', 'iwac-vis-badge ' + def.badge, P.t(def.label));
    }

    /** "Article" / "Audiovisuel" — a type's name, for the spine legend. */
    function typeLabel(type) {
        return P.t((TYPES[type] || TYPES.a).label);
    }

    /**
     * `/files/{size}/{storage id}.jpg` — same origin, so it works on any host.
     *
     * Measured on this install, Omeka's derivatives are: `square` 200×200
     * (centre-cropped), `medium` 200 px on its LONGEST side (~10 KB), `large`
     * 800 px (~130–280 KB). "Medium" being only 200 px is the surprise, and
     * it is why the layouts choose deliberately: `medium` is ample behind the
     * register's 124 px plate and far too soft behind the clipping wall's.
     * `square` is never used — Omeka crops it from the centre of the page,
     * which on a broadsheet throws away the masthead the reader recognises.
     */
    function thumbUrl(ctx, id, size) {
        return (ctx && ctx.basePath ? ctx.basePath : '')
            + '/files/' + (size || 'medium') + '/' + id + '.jpg';
    }

    function itemUrl(ctx, oId) {
        return P.itemUrl(ctx && ctx.siteBase, oId);
    }

    /**
     * The scan, or a stand-in for an unscanned document.
     *
     * More than half the fully-dated articles have no primary media, so the
     * image-forward layouts need a fallback with the same footprint. A bare
     * grey rectangle reads as a failure. The stand-in used to carry the
     * source name, but every layout already prints the source in the
     * metadata line beside it, so the name appeared twice — and a screen
     * reader announced it twice inside one link. It now carries a decorative
     * glyph of the document type (newspaper / periodical issue) instead.
     *
     * `className` carries the layout's own sizing — this helper never sets
     * dimensions, so the plate and its stand-in always share a box.
     */
    function plate(ctx, item, className, size) {
        if (!item.thumb) {
            var slip = P.el('div', className + ' iwac-vis-otd-plate--empty');
            var glyph = P.icon && P.icon((TYPES[item.type] || TYPES.a).glyph);
            if (glyph) slip.appendChild(glyph);
            return slip;
        }
        var img = document.createElement('img');
        img.className = className;
        img.src = thumbUrl(ctx, item.thumb, size);
        img.loading = 'lazy';
        img.decoding = 'async';
        // Decorative: the title next to it already names the document, and a
        // scan of unknown content cannot be described any better than that.
        img.alt = '';
        return img;
    }

    /**
     * Wrap a `<select>` so the block draws its one arrow itself.
     *
     * The selects used to borrow both halves of their arrow from the
     * theme's bare `select` rule — `appearance: none` to drop the native
     * one, a `background-image` to draw the replacement — and to reserve
     * 32 px of end padding for it, leaving the day select a 26 px content
     * box. Wherever that rule does not hold as written (the embed route and
     * the browser fixture load no theme CSS at all; an engine on
     * `appearance: base-select` renders its own `::picker-icon` as an
     * inline glyph after the value), the native triangle came back, and in
     * that narrow box it wrapped under the number. The block now says all of
     * it: no native appearance, no picker icon, no background arrow, no
     * wrapping, and one Lucide chevron in `currentColor` laid over the end
     * padding — so it is also visible in the dark theme, where the theme's
     * fixed-colour SVG all but disappears. See `.iwac-vis-otd-select`.
     *
     * @param {HTMLSelectElement} select
     * @returns {HTMLElement} the wrapper, holding the select
     */
    function selectShell(select) {
        var wrap = P.el('span', 'iwac-vis-otd-select');
        if (select.parentNode) select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        var glyph = P.icon && P.icon('chevron-down');
        if (glyph) wrap.appendChild(glyph);
        return wrap;
    }

    /**
     * Segmented control — the header uses one for the calendar and one for
     * the layout.
     *
     * The shared P.buildSegmented (aria-pressed toggles in a named group,
     * arrow keys / Home / End moving focus between them, the
     * `data-iwac-control` handle), dressed in `.iwac-vis-facets__btn` so it
     * reads as the same family as every other selection control in the
     * module; only the grouping and the count hint are local.
     *
     * @param {{label:string, options:Array<{key:string,label:string,hint?:string}>,
     *          active:string, onChange:function(string), name?:string}} cfg
     */
    function segmented(cfg) {
        var seg = P.buildSegmented({
            options: cfg.options,
            active: cfg.active,
            ariaLabel: cfg.label,
            name: cfg.name || 'otd-switch',
            onChange: cfg.onChange,
            classes: {
                root: 'iwac-vis-otd-switch',
                btn: 'iwac-vis-facets__btn',
                active: 'iwac-vis-facets__btn--active'
            }
        });
        var hints = {};
        cfg.options.forEach(function (opt) {
            if (opt.hint != null) {
                hints[opt.key] = seg.buttons[opt.key].appendChild(P.el('span', 'iwac-vis-otd-switch__hint',
                    P.formatNumber(opt.hint)));
            }
        });
        // `hints` lets the orchestrator recount the calendars when the reader
        // moves to another day, without rebuilding the control under focus.
        return { root: seg.root, setActive: seg.set, hints: hints };
    }

    /** "il y a 60 ans" / "60 years ago"; empty in the item's own year. */
    function agoLabel(year) {
        var span = new Date().getFullYear() - year;
        if (!(span > 0)) return '';
        // t() picks otd.ago_one / otd.ago_other from `count` (S14).
        return P.t('otd.ago', { count: span });
    }

    ns.onThisDay = ns.onThisDay || {};
    ns.onThisDay.shared = {
        MAX_CAST:      MAX_CAST,
        pad2:          pad2,
        gregKey:       gregKey,
        hijriKey:      hijriKey,
        validDayKey:   validDayKey,
        daysIn:        daysIn,
        setDay:        setDay,
        shiftDay:      shiftDay,
        neighbourLabel: neighbourLabel,
        monthNames:    monthNames,
        hijriYearNow:  hijriYearNow,
        gregToday:     gregToday,
        gregTodayFull: gregTodayFull,
        hijriToday:    hijriToday,
        hijriDate:     hijriDate,
        gregDate:      gregDate,
        gregKeyForHijri: gregKeyForHijri,
        pickRandomDay: pickRandomDay,
        readRow:       readRow,
        TYPE_ORDER:    TYPE_ORDER,
        countryLabel:  countryLabel,
        countryFrom:   countryFrom,
        countriesOf:   countriesOf,
        pickCast:      pickCast,
        subset:        subset,
        typeBadge:     typeBadge,
        typeLabel:     typeLabel,
        selectShell:   selectShell,
        thumbUrl:      thumbUrl,
        itemUrl:       itemUrl,
        plate:         plate,
        segmented:     segmented,
        agoLabel:      agoLabel
    };
})();
