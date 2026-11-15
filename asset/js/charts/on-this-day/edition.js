/**
 * IWAC Visualizations — On This Day: "Edition" layout
 *
 * The day composed as one front page rather than a list:
 *
 *   folio      the scale of the day in one sentence, between a double rule
 *              and a hairline, beside previous / next day, a month + day
 *              picker and "Today";
 *   spine      one hairline axis from the collection's first decade to this
 *              year, a stack of dots for every year that has an item on
 *              this date — how the day recurs across sixty years, at a
 *              glance. Each year is a button: choosing one makes that
 *              year's item the lead;
 *   lead       the chosen item at real size: the scan as a large clipping,
 *              top-anchored in a hairline frame, beside a display headline,
 *              the excerpt as a lede and the dateline — or, when the item
 *              has no scan, set in type alone, larger, with no image slot;
 *   briefs     six more items as typeset briefs in ruled newspaper columns.
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
     * The axis opens on the collection's first decade, not on the day's own
     * first year: fully-dated items begin in 1961 (measured on the 2026-08
     * fan-out), and a fixed origin is what lets a reader stepping from day
     * to day see the pattern move — 1996 stays where it was. A day holding
     * anything older widens it.
     */
    var AXIS_FROM = 1960;

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

    function quality(it) {
        return (it.thumb ? 2 : 0) + (it.excerpt ? 1 : 0);
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

    /** The best item of one year, by rules 1 and 3 above. */
    function bestOf(items, year, mode) {
        var pool = [];
        items.forEach(function (it, i) { if (it.year === year) pool.push(i); });
        var pick = -1, pickKey = null;
        pool.forEach(function (i) {
            var key = leadKey(items[i], mode, i);
            key[1] = 0; // anniversary rank is moot inside one year
            if (pick < 0 || compareKeys(key, pickKey) < 0) {
                pick = i;
                pickKey = key;
            }
        });
        return pick;
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
            proxy.push([it.year, i, '', '', '', it.excerpt ? '1' : '']);
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

    function scaleSentence(items) {
        // Min / max rather than first / last: the day files are written
        // year-ascending, but nothing here should depend on it.
        var from = Infinity, to = -Infinity;
        items.forEach(function (it) {
            if (it.year < from) from = it.year;
            if (it.year > to) to = it.year;
        });
        if (items.length === 1) return P.t('otd.ed_scale_single', { year: String(from) });
        if (from === to) return P.t('otd.ed_scale_same', { count: items.length, year: String(from) });
        return P.t('otd.ed_scale', { count: items.length, from: String(from), to: String(to) });
    }

    function buildFolio(items, mode) {
        var folio = P.el('div', 'iwac-vis-otd-folio');

        var scale = P.el('p', 'iwac-vis-otd-folio__scale', scaleSentence(items));
        if (mode.calendar === 'h') {
            scale.appendChild(document.createTextNode(' '));
            scale.appendChild(P.el('span', 'iwac-vis-otd-folio__note', P.t('otd.ed_caveat_h')));
        }
        folio.appendChild(scale);

        var nav = mode.nav;
        if (!nav) return folio;

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

        // Month + day, in the order the page's language writes a date — both
        // locales here put the day first ("15 November", "15 novembre").
        var pick = P.el('div', 'iwac-vis-otd-daynav__pick');
        var parts = mode.gregKey.split('-');
        var month = parseInt(parts[0], 10), day = parseInt(parts[1], 10);
        var uid = Math.random().toString(36).slice(2, 8);

        var label = P.el('label', 'iwac-vis-otd-daynav__label', P.t('otd.ed_choose'));
        label.htmlFor = 'iwac-vis-otd-day-' + uid;
        pick.appendChild(label);

        var daySel = P.el('select', 'iwac-vis-control iwac-vis-otd-daynav__day');
        daySel.id = 'iwac-vis-otd-day-' + uid;
        daySel.setAttribute('data-iwac-control', 'otd-day');
        for (var d = 1; d <= S.daysIn(month); d++) {
            var opt = P.el('option', null, ns.locale === 'fr' && d === 1 ? '1er' : String(d));
            opt.value = String(d);
            daySel.appendChild(opt);
        }
        daySel.value = String(day);

        var monthSel = P.el('select', 'iwac-vis-control iwac-vis-otd-daynav__month');
        monthSel.setAttribute('data-iwac-control', 'otd-month');
        monthSel.setAttribute('aria-label', P.t('otd.ed_month'));
        S.monthNames().forEach(function (name, m) {
            var o = P.el('option', null, name);
            o.value = String(m + 1);
            monthSel.appendChild(o);
        });
        monthSel.value = String(month);

        function chosen() {
            var m = parseInt(monthSel.value, 10);
            var dd = Math.min(parseInt(daySel.value, 10), S.daysIn(m));
            return S.pad2(m) + '-' + S.pad2(dd);
        }
        daySel.addEventListener('change', function () { nav.go(chosen()); });
        monthSel.addEventListener('change', function () { nav.go(chosen()); });

        pick.appendChild(daySel);
        pick.appendChild(monthSel);
        bar.appendChild(pick);

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

        folio.appendChild(bar);
        return folio;
    }

    /* ----------------------------------------------------------------- */
    /*  Lead                                                              */
    /* ----------------------------------------------------------------- */

    function dateline(it, mode) {
        var meta = P.el('p', 'iwac-vis-otd-meta iwac-vis-otd-lead__dateline');
        meta.appendChild(S.typeBadge(it.type));
        if (it.source) {
            meta.appendChild(P.el('span', 'iwac-vis-otd-meta__sep', '·'));
            meta.appendChild(P.el('span', null, it.source));
        }
        meta.appendChild(P.el('span', 'iwac-vis-otd-meta__sep', '·'));
        meta.appendChild(P.el('span', 'iwac-vis-otd-meta__date',
            mode.calendar === 'h' ? S.hijriDate(it.hYear) : S.gregDate(it.year, mode.dayKey)));
        return meta;
    }

    function agoText(it, mode) {
        var ago = yearsAgo(it, mode);
        if (!(ago > 0)) return '';
        return P.t(mode.calendar === 'h' ? 'otd.ed_ago_h' : 'otd.ago', { count: ago });
    }

    function buildLead(it, ctx, mode) {
        var href = S.itemUrl(ctx, it.oId);
        var lead = P.el('article', 'iwac-vis-otd-lead' + (it.thumb ? '' : ' iwac-vis-otd-lead--type'));
        lead.setAttribute('data-year', String(it.year));

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
        var ago = agoText(it, mode);
        if (ago) kicker.appendChild(P.el('span', 'iwac-vis-otd-lead__ago', ago));
        text.appendChild(kicker);

        var title = P.el('h3', 'iwac-vis-otd-lead__title');
        var link = document.createElement('a');
        link.href = href;
        link.textContent = it.title;
        title.appendChild(link);
        text.appendChild(title);

        if (it.excerpt) text.appendChild(P.el('p', 'iwac-vis-otd-lead__lede', it.excerpt));
        text.appendChild(dateline(it, mode));

        lead.appendChild(text);
        return lead;
    }

    /* ----------------------------------------------------------------- */
    /*  Briefs                                                            */
    /* ----------------------------------------------------------------- */

    function buildBrief(it, ctx, mode) {
        var brief = P.el('li', 'iwac-vis-otd-brief');

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
        if (it.source) {
            meta.appendChild(P.el('span', 'iwac-vis-otd-meta__sep', '·'));
            meta.appendChild(P.el('span', null, it.source));
        }
        if (mode.calendar === 'h' && it.hYear) {
            meta.appendChild(P.el('span', 'iwac-vis-otd-meta__sep', '·'));
            meta.appendChild(P.el('span', 'iwac-vis-otd-meta__date', S.hijriDate(it.hYear)));
        }
        brief.appendChild(meta);

        if (it.excerpt) brief.appendChild(P.el('p', 'iwac-vis-otd-excerpt iwac-vis-otd-brief__copy', it.excerpt));
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
        var years = [], counts = {};
        items.forEach(function (it) {
            if (!counts[it.year]) { counts[it.year] = 0; years.push(it.year); }
            counts[it.year]++;
        });
        years.sort(function (a, b) { return a - b; });
        var from = Math.min(AXIS_FROM, Math.floor(years[0] / 10) * 10);
        var to = Math.max(new Date().getFullYear(), years[years.length - 1]);

        var defaultLead = rankLead(items, mode);
        var leadIndex = defaultLead;
        if (mode.leadYear && counts[mode.leadYear]) leadIndex = bestOf(items, mode.leadYear, mode);

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

        var ticks = years.map(function (year) {
            var btn = P.el('button', 'iwac-vis-otd-tick');
            btn.type = 'button';
            btn.setAttribute('data-year', String(year));
            btn.setAttribute('aria-label', P.t('otd.ed_tick', { year: String(year), count: counts[year] }));
            btn.tabIndex = -1;
            var dots = P.el('span', 'iwac-vis-otd-tick__dots');
            dots.setAttribute('aria-hidden', 'true');
            for (var k = 0; k < Math.min(counts[year], MAX_DOTS); k++) {
                dots.appendChild(P.el('span', 'iwac-vis-otd-tick__dot'));
            }
            btn.appendChild(dots);
            var label = P.el('span', 'iwac-vis-otd-tick__year', String(year));
            label.setAttribute('aria-hidden', 'true');
            btn.appendChild(label);
            btn.addEventListener('click', function () { choose(year, true); });
            ticksRow.appendChild(btn);
            return btn;
        });

        // Roving focus: one tab stop for the whole spine, arrows along it.
        ticksRow.addEventListener('keydown', function (e) {
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
            reveal(ticks[i]);
        }

        /** Scroll the spine — never the page — to bring a control into view. */
        function reveal(btn) {
            if (scroller.scrollWidth <= scroller.clientWidth) return;
            var x = parseFloat(btn.style.left) || 0;
            var view = scroller.clientWidth;
            if (x < scroller.scrollLeft + TICK_GAP || x > scroller.scrollLeft + view - TICK_GAP) {
                scroller.scrollLeft = Math.max(0, x - view / 2);
            }
        }

        track.appendChild(ticksRow);
        track.appendChild(axis);
        track.appendChild(scaleRow);
        scroller.appendChild(track);
        spine.appendChild(scroller);
        root.appendChild(spine);

        function place() {
            var avail = scroller.clientWidth || 900;
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
        }

        /* -- lead ------------------------------------------------------- */
        var leadSlot = P.el('div', 'iwac-vis-otd-lead-slot');
        leadSlot.setAttribute('aria-live', 'polite');
        var currentLead = buildLead(items[leadIndex], ctx, mode);
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
                briefList.appendChild(buildBrief(items[i], ctx, mode));
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
            var next = bestOf(items, year, mode);
            if (next < 0 || next === leadIndex) return;
            leadIndex = next;
            markTicks();
            swapLead(buildLead(items[leadIndex], ctx, mode));
            paintBriefs();
            if (fromReader && mode.onLead) {
                mode.onLead(leadIndex === defaultLead ? 0 : year);
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
        place();

        // Re-lay the spine when the block's width changes (a rotated phone,
        // a resized window); nothing else in the page depends on pixels.
        if (typeof ResizeObserver !== 'undefined') {
            var lastWidth = scroller.clientWidth;
            var ro = new ResizeObserver(function () {
                if (!root.isConnected) { ro.disconnect(); return; }
                if (scroller.clientWidth === lastWidth) return;
                lastWidth = scroller.clientWidth;
                place();
            });
            ro.observe(scroller);
        }

        var leadTick = ticks[years.indexOf(items[leadIndex].year)];
        if (leadTick) reveal(leadTick);

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
        layoutTicks: layoutTicks
    };
})();
