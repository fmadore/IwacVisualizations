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

    M.layout = function (events, width, hitWidth) {
        var starts = events.map(function (e) { return M.bound(e.start, false); });
        var ends = events.map(function (e) { return M.bound(e.end || e.start, true); });
        var min = Math.min.apply(null, starts);
        var max = Math.max.apply(null, ends);
        var span = Math.max(max - min, 86400000);
        var lanes = [];
        var positions = events.map(function (event, i) {
            return { id: event.id, start: starts[i], end: ends[i], range: Boolean(event.end), event: event };
        }).sort(function (a, b) { return a.start - b.start || a.event.order - b.event.order; });
        positions.forEach(function (p) {
            // A year/month-only point sits within that period, never purports
            // to be an event known to have happened on January 1st.
            var point = p.range ? p.start : (p.start + p.end) / 2;
            p.x = hitWidth / 2 + (point - min) / span * (width - hitWidth);
            p.endX = hitWidth / 2 + (p.end - min) / span * (width - hitWidth);
            var left = p.x - hitWidth / 2;
            var right = Math.max(p.x + hitWidth / 2, p.range ? p.endX : 0);
            var lane = lanes.findIndex(function (end) { return end + 8 < left; });
            if (lane < 0) lane = lanes.length;
            lanes[lane] = right;
            p.lane = lane;
        });
        return { positions: positions, lanes: lanes.length, min: min, max: max };
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
