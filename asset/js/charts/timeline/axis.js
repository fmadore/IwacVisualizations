/**
 * The chronology under the narrative, drawn as TimelineJS draws it: one card
 * per event — its image's thumbnail, its date and its headline — standing on
 * the event's date, in as many lanes as overlapping cards need. A range's
 * line runs on from its card to the end of the period.
 *
 * The cards are built once; a resize only moves them, so a loaded thumbnail
 * and a focused card survive it.
 */
(function () {
    'use strict';
    var ns = window.IWACVis;
    var P = ns.panels;
    var M = ns.timelineModel;

    /** Media without an image still says what it is. */
    var MEDIA_ICON = { map: 'map-pin', link: 'link' };

    ns.createTimelineAxis = function (host, events, choose) {
        var wrap = P.el('nav', 'iwac-vis-timeline__axis');
        wrap.setAttribute('aria-label', ns.t('timeline_axis'));
        var hint = P.el('p', 'iwac-vis-timeline__axis-hint', ns.t('timeline_axis_hint'));
        var viewport = P.el('div', 'iwac-vis-timeline__axis-scroll');
        var track = P.el('div', 'iwac-vis-timeline__track');
        viewport.appendChild(track);
        wrap.append(hint, viewport);
        host.appendChild(wrap);
        var buttons = new Map();
        var ranges = new Map();
        var current = null;
        var previousWidth = 0;

        function card(event) {
            var marker = P.el('button', 'iwac-vis-timeline__marker');
            marker.type = 'button';
            marker.dataset.timelineMarker = event.id;
            marker.setAttribute('aria-label', event.label);
            marker.title = event.label;
            var face = null;
            if (event.thumb) {
                face = P.el('span', 'iwac-vis-timeline__marker-media');
                var img = document.createElement('img');
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.src = event.thumb;
                // A thumbnail that fails leaves a text card, not a broken image.
                img.addEventListener('error', function () {
                    face.remove();
                    marker.classList.add('is-text');
                });
                face.appendChild(img);
            } else if (MEDIA_ICON[event.media]) {
                face = P.el('span', 'iwac-vis-timeline__marker-media');
                face.appendChild(P.icon(MEDIA_ICON[event.media]));
            }
            if (face) marker.appendChild(face);
            else marker.classList.add('is-text');
            var text = P.el('span', 'iwac-vis-timeline__marker-text');
            text.append(P.el('span', 'iwac-vis-timeline__marker-date', event.date),
                P.el('span', 'iwac-vis-timeline__marker-headline', event.headline));
            marker.appendChild(text);
            marker.addEventListener('click', function () { choose(event.id); });
            return marker;
        }

        events.forEach(function (event) {
            var marker = card(event);
            buttons.set(event.id, marker);
            track.appendChild(marker);
            if (event.end) {
                var range = P.el('span', 'iwac-vis-timeline__range');
                range.setAttribute('aria-hidden', 'true');
                ranges.set(event.id, range);
                track.appendChild(range);
            }
        });

        function draw() {
            var available = viewport.clientWidth;
            if (!available || available === previousWidth) return;
            previousWidth = available;
            var sample = buttons.values().next().value;
            var cardWidth = sample.offsetWidth;
            var cardHeight = sample.offsetHeight;
            var gap = Math.round(cardHeight / 4);
            var lane = cardHeight + gap;
            // Room for every card side by side at 4/5 of its width: the
            // track scrolls rather than stacking a dozen lanes.
            var width = Math.max(available, events.length * cardWidth * 0.8);
            var layout = M.layout(events, width, cardWidth);
            track.style.width = width + 'px';
            track.style.setProperty('--iwac-vis-timeline-lanes', String(layout.lanes));
            track.style.setProperty('--iwac-vis-timeline-lane', lane + 'px');
            track.querySelectorAll('.iwac-vis-timeline__tick').forEach(function (tick) { tick.remove(); });
            var firstYear = new Date(layout.min).getUTCFullYear();
            var lastYear = new Date(layout.max).getUTCFullYear();
            var step = Math.max(1, Math.ceil((lastYear - firstYear) / (width / 160) / 5) * 5);
            for (var year = Math.ceil(firstYear / step) * step; year <= lastYear; year += step) {
                var tick = P.el('span', 'iwac-vis-timeline__tick', String(year));
                tick.setAttribute('aria-hidden', 'true');
                tick.style.left = layout.x(M.bound(String(year), false)) + 'px';
                track.appendChild(tick);
            }
            layout.positions.forEach(function (position) {
                var marker = buttons.get(position.id);
                marker.style.left = position.x + 'px';
                marker.style.top = position.lane * lane + 'px';
                var range = ranges.get(position.id);
                if (range) {
                    range.style.left = position.x + 'px';
                    range.style.width = Math.max(1, position.endX - position.x) + 'px';
                    range.style.top = (position.lane * lane + cardHeight + gap / 2) + 'px';
                }
            });
            update(current, false);
        }

        function update(id, scroll) {
            current = id;
            buttons.forEach(function (button, key) {
                if (key === id) button.setAttribute('aria-current', 'step');
                else button.removeAttribute('aria-current');
            });
            ranges.forEach(function (bar, key) { bar.classList.toggle('is-current', key === id); });
            var button = buttons.get(id);
            if (scroll && button) {
                viewport.scrollLeft = button.offsetLeft + button.offsetWidth / 2 - viewport.clientWidth / 2;
            }
        }
        var observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
        if (observer) observer.observe(viewport);
        draw();
        return { update: update, element: wrap, destroy: function () { if (observer) observer.disconnect(); } };
    };
}());
