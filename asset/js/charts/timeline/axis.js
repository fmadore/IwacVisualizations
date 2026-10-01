(function () {
    'use strict';
    var ns = window.IWACVis;
    var P = ns.panels;
    var M = ns.timelineModel;
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
        var current = null;
        var previousWidth = 0;

        function draw() {
            var style = getComputedStyle(host);
            var font = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
            var control = style.getPropertyValue('--size-control-lg').trim();
            var unit = parseFloat(control) || 2.75;
            var hit = unit * (/rem$/.test(control) || !control ? font : 1);
            var width = Math.max(viewport.clientWidth, events.length * hit * 1.5, hit * 8);
            if (width === previousWidth) return;
            previousWidth = width;
            var focused = document.activeElement && document.activeElement.dataset.timelineMarker;
            var layout = M.layout(events, width, hit * 2);
            track.replaceChildren();
            buttons.clear();
            track.style.width = width + 'px';
            track.style.height = (layout.lanes + 1) * hit + 'px';
            var firstYear = new Date(layout.min).getUTCFullYear();
            var lastYear = new Date(layout.max).getUTCFullYear();
            var step = Math.max(1, Math.ceil((lastYear - firstYear) / 8 / 5) * 5);
            for (var year = Math.ceil(firstYear / step) * step; year <= lastYear; year += step) {
                var tick = P.el('span', 'iwac-vis-timeline__tick', String(year));
                tick.setAttribute('aria-hidden', 'true');
                tick.style.left = (hit + (M.bound(String(year), false) - layout.min)
                    / Math.max(layout.max - layout.min, 86400000) * (width - hit * 2)) + 'px';
                track.appendChild(tick);
            }
            layout.positions.forEach(function (position) {
                if (position.range) {
                    var range = P.el('span', 'iwac-vis-timeline__range');
                    range.setAttribute('aria-hidden', 'true');
                    range.dataset.rangeId = position.id;
                    range.style.left = position.x + 'px';
                    range.style.width = Math.max(1, position.endX - position.x) + 'px';
                    range.style.top = (position.lane + 0.5) * hit + 'px';
                    track.appendChild(range);
                }
                var marker = P.el('button', 'iwac-vis-timeline__marker', position.event.start.slice(0, 4));
                marker.type = 'button';
                marker.dataset.timelineMarker = position.id;
                marker.setAttribute('aria-label', position.event.label);
                marker.title = position.event.label;
                marker.style.left = position.x + 'px';
                marker.style.top = position.lane * hit + 'px';
                marker.addEventListener('click', function () { choose(position.id); });
                track.appendChild(marker);
                buttons.set(position.id, marker);
            });
            update(current, false);
            if (focused && buttons.has(focused)) buttons.get(focused).focus({ preventScroll: true });
        }

        function update(id, scroll) {
            current = id;
            buttons.forEach(function (button, key) {
                if (key === id) button.setAttribute('aria-current', 'step');
                else button.removeAttribute('aria-current');
            });
            track.querySelectorAll('[data-range-id]').forEach(function (bar) {
                bar.classList.toggle('is-current', bar.dataset.rangeId === id);
            });
            var button = buttons.get(id);
            if (scroll && button) viewport.scrollLeft = button.offsetLeft - viewport.clientWidth / 2;
        }
        var observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
        if (observer) observer.observe(viewport);
        draw();
        return { update: update, element: wrap, destroy: function () { if (observer) observer.disconnect(); } };
    };
}());
