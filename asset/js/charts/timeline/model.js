/** Calendar geometry only: displayed dates always retain their source precision. */
(function () {
    'use strict';
    var ns = window.IWACVis;
    var M = ns.timelineModel = {};

    M.bound = function (value, upper) {
        var parts = String(value).split('-').map(Number);
        var date = new Date(0);
        date.setUTCHours(0, 0, 0, 0);
        // setUTCFullYear avoids Date.UTC's special interpretation of 0–99.
        date.setUTCFullYear(parts[0], (parts[1] || (upper ? 12 : 1)) - 1, parts[2] || 1);
        if (upper && parts.length < 3) {
            date.setUTCMonth(date.getUTCMonth() + 1, 0);
        }
        return date.getTime();
    };

    var DAY = 86400000;

    /**
     * The axis scale: a time → pixel function that is monotonic but not
     * linear. On a linear scale an exhibit whose events crowd into a few
     * years (sixteen of the intégrisme exhibit's twenty-one fall in 1991–1995)
     * stacked its cards ten lanes deep, while decades with one event took
     * most of the track. Here the track is cut at each card's date; every
     * stretch between two cards first gets a fixed share — about half a card,
     * so neighbours alternate between two lanes instead of piling up — and
     * the rest of the width is shared by the square root of each stretch's
     * duration, so a long gap stays visibly longer without swallowing the
     * track. Range ends are not cuts: their lines are interpolated.
     *
     * @param {number[]} anchors  every card's date (ms)
     * @param {number} min        the earliest date the track shows
     * @param {number} max        the latest
     * @param {number} room       the pixels available (track minus one card)
     * @param {number} spacing    the fixed share between two cards
     * @returns {function(number):number}
     */
    M.scale = function (anchors, min, max, room, spacing) {
        var cards = new Set(anchors);
        var knots = Array.from(new Set([min, max].concat(anchors))).sort(function (a, b) { return a - b; });
        if (knots.length < 2) return function () { return 0; };
        var fixed = [];
        var soft = [];
        for (var i = 1; i < knots.length; i++) {
            fixed.push(cards.has(knots[i - 1]) && cards.has(knots[i]) ? spacing : 0);
            soft.push(Math.sqrt((knots[i] - knots[i - 1]) / DAY));
        }
        var sum = function (list) { return list.reduce(function (a, b) { return a + b; }, 0); };
        var fixedTotal = sum(fixed);
        var softTotal = sum(soft) || 1;
        // Too narrow for the fixed shares: shrink them all alike.
        var shrink = fixedTotal > room ? room / fixedTotal : 1;
        var rest = Math.max(0, room - fixedTotal * shrink);
        var px = [0];
        for (var j = 0; j < fixed.length; j++) {
            px.push(px[j] + fixed[j] * shrink + soft[j] / softTotal * rest);
        }
        return function (time) {
            if (time <= knots[0]) return 0;
            for (var k = 1; k < knots.length; k++) {
                if (time <= knots[k]) {
                    return px[k - 1] + (time - knots[k - 1]) / (knots[k] - knots[k - 1]) * (px[k] - px[k - 1]);
                }
            }
            return px[px.length - 1];
        };
    };

    /**
     * Year labels for a non-linear scale: decades first, then fives, then
     * single years, each kept only where it leaves `gap` pixels to every
     * label already kept — so a stretched span reads year by year and a
     * compressed one shows only its decades.
     *
     * @returns {Array<{year: number, x: number}>}
     */
    M.ticks = function (layout, gap) {
        var first = new Date(layout.min).getUTCFullYear();
        var last = new Date(layout.max).getUTCFullYear();
        var kept = [];
        [100, 50, 10, 5, 2, 1].forEach(function (step) {
            if ((last - first) / step > 400) return;
            for (var year = Math.ceil(first / step) * step; year <= last; year += step) {
                var at = layout.x(M.bound(String(year), false));
                var clear = kept.every(function (tick) { return tick.year !== year && Math.abs(tick.x - at) >= gap; });
                if (clear) kept.push({ year: year, x: at });
            }
        });
        return kept.sort(function (a, b) { return a.year - b.year; });
    };

    /**
     * Place each event's card on the axis, TimelineJS-style: the card's start
     * edge stands on the event's date — the middle of its period for a point,
     * the first day for a range, whose line then runs on to its end — on the
     * scale above. A card that would overlap one already placed takes the
     * next lane down.
     *
     * @param {Array} events  {id, start, end?, order}
     * @param {number} width  the track's width
     * @param {number} card   one card's width
     * @returns {{positions: Array, lanes: number, min: number, max: number, x: function(number):number}}
     */
    M.layout = function (events, width, card) {
        var starts = events.map(function (e) { return M.bound(e.start, false); });
        var ends = events.map(function (e) { return M.bound(e.end || e.start, true); });
        var min = Math.min.apply(null, starts);
        var max = Math.max.apply(null, ends);
        // A year/month-only point sits within that period, never purports
        // to be an event known to have happened on January 1st.
        var anchors = events.map(function (e, i) { return e.end ? starts[i] : (starts[i] + ends[i]) / 2; });
        var x = M.scale(anchors, min, Math.max(max, min + DAY), width - card, card * 0.55);
        var lanes = [];
        var positions = events.map(function (event, i) {
            return { id: event.id, start: starts[i], end: ends[i], range: Boolean(event.end), event: event };
        }).sort(function (a, b) { return a.start - b.start || a.event.order - b.event.order; });
        positions.forEach(function (p) {
            p.x = x(p.range ? p.start : (p.start + p.end) / 2);
            p.endX = x(p.end);
            var right = Math.max(p.x + card, p.range ? p.endX : 0);
            var lane = lanes.findIndex(function (end) { return end + 8 < p.x; });
            if (lane < 0) lane = lanes.length;
            lanes[lane] = right;
            p.lane = lane;
        });
        return { positions: positions, lanes: lanes.length, min: min, max: max, x: x };
    };

    M.fragment = function (slug, id, instance) {
        return '#timeline=' + encodeURIComponent(slug) + '&slide=' + encodeURIComponent(id)
            + '&block=' + encodeURIComponent(instance);
    };

    M.linkedEvent = function (hash, slug, instance, ids, isFirst) {
        var params = new URLSearchParams(hash.replace(/^#/, ''));
        if (params.get('timeline') === slug
            && (params.has('block') ? params.get('block') === instance : isFirst)
            && ids.indexOf(params.get('slide')) !== -1) return params.get('slide');
        // Server-rendered links work before enhancement and without JS.
        var nativeId = hash.slice(1);
        return ids.find(function (id) { return nativeId === instance + '-' + id; }) || null;
    };
}());
