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

    function locale() {
        return ns.locale === 'fr' ? 'fr-FR' : 'en-US';
    }

    /* ----------------------------------------------------------------- */
    /*  Calendars                                                         */
    /* ----------------------------------------------------------------- */

    function today() {
        return new Date();
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
    function hijriKey() {
        var h = hijriParts();
        return h ? pad2(h.month) + '-' + pad2(h.day) : null;
    }

    /** "29 juillet" / "July 29" — today, no year. */
    function gregToday() {
        try {
            return today().toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
        } catch (e) {
            return gregKey();
        }
    }

    /** "29 juillet 2026" / "July 29, 2026". */
    function gregTodayFull() {
        try {
            return today().toLocaleDateString(locale(), {
                day: 'numeric', month: 'long', year: 'numeric'
            });
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

    /** An item's own publication date, in the locale's numeric form. */
    function gregDate(year, dayKey) {
        var bits = String(dayKey || gregKey()).split('-');
        try {
            return new Date(year, parseInt(bits[0], 10) - 1, parseInt(bits[1], 10))
                .toLocaleDateString(locale(), {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                });
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
    function readRow(row) {
        row = row || [];
        return {
            year:    row[0],
            oId:     row[1],
            title:   row[2] || '',
            source:  row[3] || '',
            type:    row[4] === 'p' ? 'p' : 'a',
            thumb:   row[5] || '',
            excerpt: row[6] || '',
            hYear:   row[7] || null
        };
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
        var isPub = type === 'p';
        return P.el(
            'span',
            'iwac-vis-badge ' + (isPub ? 'iwac-vis-badge--publication' : 'iwac-vis-badge--article'),
            P.t(isPub ? 'otd.type_p' : 'otd.type_a')
        );
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
        return (ctx && ctx.siteBase ? ctx.siteBase : '')
            + '/item/' + encodeURIComponent(String(oId));
    }

    /**
     * The scan, or a catalogue-slip stand-in bearing the source name.
     *
     * More than half the fully-dated articles have no primary media, so the
     * image-forward layouts need a fallback with the same footprint. A grey
     * rectangle reads as a failure; a typographic slip reads as an entry
     * that simply has not been scanned.
     *
     * `className` carries the layout's own sizing — this helper never sets
     * dimensions, so the plate and its stand-in always share a box.
     */
    function plate(ctx, item, className, size) {
        if (!item.thumb) {
            var slip = P.el('div', className + ' iwac-vis-otd-plate--empty');
            slip.appendChild(P.el('span', 'iwac-vis-otd-plate__slip', item.source || ''));
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
     * Segmented control — the header uses one for the calendar and one for
     * the layout.
     *
     * Reuses `.iwac-vis-facets__btn` so it reads as the same family as every
     * other selection control in the module; only the grouping is local.
     * Buttons carry `aria-pressed` because this is a set of toggles, not
     * navigation.
     *
     * @param {{label:string, options:Array<{key:string,label:string,hint?:string}>,
     *          active:string, onChange:function(string)}} cfg
     */
    function segmented(cfg) {
        var root = P.el('div', 'iwac-vis-otd-switch');
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', cfg.label);

        var buttons = {};
        function setActive(key) {
            Object.keys(buttons).forEach(function (k) {
                var on = k === key;
                buttons[k].classList.toggle('iwac-vis-facets__btn--active', on);
                buttons[k].setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        }

        cfg.options.forEach(function (opt) {
            var btn = P.el('button', 'iwac-vis-facets__btn');
            btn.type = 'button';
            btn.appendChild(document.createTextNode(opt.label));
            if (opt.hint != null) {
                btn.appendChild(P.el('span', 'iwac-vis-otd-switch__hint',
                    P.formatNumber(opt.hint)));
            }
            btn.addEventListener('click', function () {
                if (btn.getAttribute('aria-pressed') === 'true') return;
                setActive(opt.key);
                cfg.onChange(opt.key);
            });
            buttons[opt.key] = btn;
            root.appendChild(btn);
        });

        setActive(cfg.active);
        return { root: root, setActive: setActive };
    }

    /** "il y a 60 ans" / "60 years ago"; empty in the item's own year. */
    function agoLabel(year) {
        var span = new Date().getFullYear() - year;
        if (!(span > 0)) return '';
        return P.t(span === 1 ? 'otd.ago_one' : 'otd.ago', { count: span });
    }

    ns.onThisDay = ns.onThisDay || {};
    ns.onThisDay.shared = {
        MAX_CAST:      MAX_CAST,
        pad2:          pad2,
        gregKey:       gregKey,
        hijriKey:      hijriKey,
        gregToday:     gregToday,
        gregTodayFull: gregTodayFull,
        hijriToday:    hijriToday,
        hijriDate:     hijriDate,
        gregDate:      gregDate,
        readRow:       readRow,
        pickCast:      pickCast,
        subset:        subset,
        typeBadge:     typeBadge,
        thumbUrl:      thumbUrl,
        itemUrl:       itemUrl,
        plate:         plate,
        segmented:     segmented,
        agoLabel:      agoLabel
    };
})();
