(function () {
    'use strict';
    var ns = window.IWACVis;
    var P = ns.panels;
    var M = ns.timelineModel;

    ns.enhanceTimeline = function (root) {
        if (root.dataset.timelineReady) return;
        var articles = Array.from(root.querySelectorAll('[data-event-id]'));
        if (!articles.length) return;
        articles.sort(function (a, b) { return Number(a.dataset.order) - Number(b.dataset.order); });
        var ids = articles.map(function (el) { return el.dataset.eventId; });
        var slug = root.dataset.timeline;
        var instance = root.dataset.instance;
        var view = root.dataset.layout === 'list' ? 'list' : 'narrative';
        var current = Math.max(0, ids.indexOf(root.dataset.startSlide || 'intro'));
        var section = root.querySelector('.iwac-vis-timeline__reading');
        var stage = root.querySelector('.iwac-vis-timeline__events');
        var headline = function (article) { return article.querySelector('h3').textContent; };
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

        function button(label, className, icon, iconAfter) {
            var el = P.el('button', className);
            el.type = 'button';
            if (!icon) {
                el.textContent = ns.t(label);
                return el;
            }
            el.append(P.icon(icon), P.el('span', '', ns.t(label)));
            if (iconAfter) el.appendChild(el.firstChild);
            return el;
        }

        /*  One toolbar above the stage carries every control a reader uses
         *  repeatedly — the view, the step buttons, the event picker and
         *  fullscreen — so none of them moves when an event changes. */
        var toolbar = P.el('div', 'iwac-vis-timeline__controls');
        var views = P.el('div', 'iwac-vis-timeline__views');
        views.setAttribute('role', 'group');
        views.setAttribute('aria-label', ns.t('timeline_views'));
        var narrative = button('timeline_narrative', 'iwac-vis-timeline__view');
        var all = button('timeline_all_events', 'iwac-vis-timeline__view');
        views.append(narrative, all);
        var pager = P.el('div', 'iwac-vis-timeline__pager');
        var previous = P.iconButton('chevron-left', ns.t('timeline_previous'), null, 'iwac-vis-timeline__step');
        var next = P.iconButton('chevron-right', ns.t('timeline_next'), null, 'iwac-vis-timeline__step');
        var menu = ns.createTimelineMenu(instance, articles.map(function (article, i) {
            return i === 0 ? { id: ids[i], date: '', headline: ns.t('timeline_intro') }
                : { id: ids[i], date: article.dataset.dateLabel, headline: headline(article) };
        }), function (id) { choose(id, true, view === 'list' ? 'list' : 'top'); });
        pager.append(previous, menu.element, next);
        var fullscreen = P.iconButton('maximize', ns.t('Toggle fullscreen'), null, 'iwac-vis-timeline__fullscreen');
        toolbar.append(views, pager, fullscreen);
        section.insertBefore(toolbar, stage);

        // The same steps after the event, for a reader who has scrolled to its end.
        var navigation = P.el('div', 'iwac-vis-timeline__navigation');
        var previousEnd = button('timeline_previous', 'iwac-vis-timeline__previous', 'chevron-left');
        var nextEnd = button('timeline_next', 'iwac-vis-timeline__next', 'chevron-right', true);
        var progress = P.el('span', 'iwac-vis-timeline__progress');
        navigation.append(previousEnd, progress, nextEnd);
        section.appendChild(navigation);
        var status = P.el('span', 'iwac-vis-timeline__status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        section.appendChild(status);
        stage.tabIndex = 0;
        var axis = ns.createTimelineAxis(section, articles.slice(1).map(function (article) {
            return { id: article.dataset.eventId, start: article.dataset.start, end: article.dataset.end,
                order: Number(article.dataset.order),
                label: article.dataset.dateLabel + ' · ' + headline(article) };
        }), function (id) { view = 'narrative'; choose(id, true, 'below'); });

        var newTab = P.el('span', 'iwac-vis-timeline__status', ns.t('timeline_new_tab'));
        newTab.id = instance + '-new-tab';
        newTab.hidden = true;
        section.appendChild(newTab);
        root.querySelectorAll('a[target="_blank"]').forEach(function (link) {
            link.setAttribute('aria-describedby', newTab.id);
        });

        P.bindFullscreen(fullscreen, root, {
            stateClass: 'iwac-vis-timeline--fullscreen',
            onChange: function (full) {
                P.setIcon(fullscreen, full ? 'minimize' : 'maximize');
                axis.update(ids[current], true);
            }
        });

        function render(announce) {
            root.dataset.view = view;
            articles.forEach(function (article, i) { article.classList.toggle('is-current', i === current); });
            narrative.setAttribute('aria-pressed', String(view === 'narrative'));
            all.setAttribute('aria-pressed', String(view === 'list'));
            previous.disabled = previousEnd.disabled = current === 0;
            next.disabled = nextEnd.disabled = current === articles.length - 1;
            navigation.hidden = view === 'list';
            axis.element.hidden = view === 'list';
            var text = current === 0 ? ns.t('timeline_intro')
                : ns.t('timeline_progress').replace('{current}', String(current)).replace('{total}', String(articles.length - 1));
            progress.textContent = text;
            menu.update(ids[current], text);
            axis.update(ids[current], announce);
            if (announce) status.textContent = text + ' · ' + headline(articles[current]);
        }

        /**
         * A step taken from below the stage (the closing pager, the axis)
         * turns the page: when the event's start has scrolled away, bring
         * the toolbar and heading back, as a book reader would. A step from
         * the toolbar never scrolls — the toolbar is already where the
         * reader is looking, and the stage below it keeps one height.
         */
        function reveal(origin) {
            var behavior = reduceMotion && reduceMotion.matches ? 'auto' : 'smooth';
            if (origin === 'list') {
                articles[current].scrollIntoView({ block: 'start', behavior: behavior });
            } else if (origin === 'below' && stage.getBoundingClientRect().top < 0) {
                toolbar.scrollIntoView({ block: 'start', behavior: behavior });
            }
        }

        function choose(id, publish, origin) {
            var index = ids.indexOf(id);
            if (index < 0) return;
            current = index;
            if (publish) history.replaceState(history.state, '', M.fragment(slug, id, instance));
            render(publish);
            reveal(origin);
            var stranded = [previous, next, previousEnd, nextEnd].indexOf(document.activeElement) !== -1
                && document.activeElement.disabled;
            if (stranded) stage.focus({ preventScroll: true });
        }

        function step(delta, origin) {
            choose(ids[Math.max(0, Math.min(ids.length - 1, current + delta))], true, origin);
        }

        function followHash() {
            var first = Array.from(document.querySelectorAll('.iwac-vis-timeline'))
                .find(function (el) { return el.dataset.timeline === slug; }) === root;
            var id = M.linkedEvent(location.hash, slug, instance, ids, first);
            if (id) { view = 'narrative'; choose(id, false); }
        }
        previous.addEventListener('click', function () { step(-1, 'top'); });
        next.addEventListener('click', function () { step(1, 'top'); });
        previousEnd.addEventListener('click', function () { step(-1, 'below'); });
        nextEnd.addEventListener('click', function () { step(1, 'below'); });
        narrative.addEventListener('click', function () { view = 'narrative'; render(false); });
        all.addEventListener('click', function () { view = 'list'; render(false); });
        root.querySelectorAll('[data-event-link]').forEach(function (link) {
            link.href = M.fragment(slug, link.dataset.eventLink, instance);
            link.addEventListener('click', function (event) {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                choose(link.dataset.eventLink, true);
            });
        });
        root.addEventListener('keydown', function (event) {
            if (view !== 'narrative' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
                || event.target.closest('input, select, textarea, a, [contenteditable="true"], .iwac-vis-timeline__menu')) return;
            var index = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: ids.length - 1 }[event.key];
            if (index === undefined) return;
            event.preventDefault();
            // Arrow/Home/End on an axis marker retain visible keyboard focus.
            var marker = event.target.closest('[data-timeline-marker]');
            choose(ids[Math.max(0, Math.min(ids.length - 1, index))], true);
            if (marker) {
                var selected = root.querySelector('[data-timeline-marker][aria-current="step"]');
                if (selected) selected.focus({ preventScroll: true });
                else stage.focus({ preventScroll: true });
            }
        });
        var touch = null;
        stage.addEventListener('pointerdown', function (event) {
            if (event.pointerType !== 'touch' || view !== 'narrative'
                || event.target.closest('a, button, input, select, textarea')) return;
            touch = { x: event.clientX, y: event.clientY, id: event.pointerId };
        });
        stage.addEventListener('pointercancel', function () { touch = null; });
        stage.addEventListener('pointerup', function (event) {
            if (!touch || touch.id !== event.pointerId) return;
            var dx = event.clientX - touch.x;
            var dy = event.clientY - touch.y;
            touch = null;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) step(dx < 0 ? 1 : -1, 'below');
        });
        // Image failures preserve caption/citation and an ordinary source link.
        root.querySelectorAll('img').forEach(function (img) {
            function failedImage() {
                img.hidden = true;
                if (!img.parentElement.querySelector('span')) img.parentElement.appendChild(P.el('span', '', img.alt));
            }
            img.addEventListener('error', failedImage);
            if (img.complete && !img.naturalWidth) failedImage();
        });
        window.addEventListener('hashchange', followHash);
        root.dataset.timelineReady = 'true';
        followHash();
        render(false);
        // Page blocks are normally static; tests/admin previews can dispose explicitly.
        return { destroy: function () { axis.destroy(); menu.close(false); window.removeEventListener('hashchange', followHash); } };
    };
}());
