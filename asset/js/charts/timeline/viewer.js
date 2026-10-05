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
        var controls = P.el('div', 'iwac-vis-timeline__controls');
        var views = P.el('div', 'iwac-vis-timeline__views');
        views.setAttribute('role', 'group');
        views.setAttribute('aria-label', ns.t('timeline_views'));

        function button(label, className) {
            var el = P.el('button', className, ns.t(label));
            el.type = 'button';
            return el;
        }
        var narrative = button('timeline_narrative', 'iwac-vis-timeline__view');
        var all = button('timeline_all_events', 'iwac-vis-timeline__view');
        views.append(narrative, all);
        var selectLabel = P.el('label', 'iwac-vis-timeline__select-label', ns.t('timeline_select'));
        var select = P.el('select', 'iwac-vis-control iwac-vis-timeline__select');
        select.id = instance + '-select';
        selectLabel.htmlFor = select.id;
        articles.forEach(function (article, i) {
            var heading = article.querySelector('h3').textContent;
            var label = article.dataset.dateLabel;
            var option = P.el('option', '', i === 0 ? ns.t('timeline_intro') : label + ' · ' + heading);
            option.value = ids[i];
            select.appendChild(option);
        });
        selectLabel.appendChild(select);
        controls.append(views, selectLabel);
        section.insertBefore(controls, stage);
        var navigation = P.el('div', 'iwac-vis-timeline__navigation');
        var previous = button('timeline_previous', 'iwac-vis-timeline__previous');
        var next = button('timeline_next', 'iwac-vis-timeline__next');
        var progress = P.el('span', 'iwac-vis-timeline__progress');
        navigation.append(previous, progress, next);
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
                label: article.dataset.dateLabel + ' · ' + article.querySelector('h3').textContent };
        }), function (id) { view = 'narrative'; choose(id, true); });

        function render(announce) {
            root.dataset.view = view;
            articles.forEach(function (article, i) { article.hidden = view === 'narrative' && i !== current; });
            narrative.setAttribute('aria-pressed', String(view === 'narrative'));
            all.setAttribute('aria-pressed', String(view === 'list'));
            previous.disabled = current === 0;
            next.disabled = current === articles.length - 1;
            navigation.hidden = view === 'list';
            axis.element.hidden = view === 'list';
            select.value = ids[current];
            progress.textContent = current === 0 ? ns.t('timeline_intro')
                : ns.t('timeline_progress').replace('{current}', String(current)).replace('{total}', String(articles.length - 1));
            axis.update(ids[current], announce);
            if (announce) status.textContent = progress.textContent + ' · ' + articles[current].querySelector('h3').textContent;
        }

        function choose(id, publish) {
            var index = ids.indexOf(id);
            if (index < 0) return;
            current = index;
            if (publish) history.replaceState(history.state, '', M.fragment(slug, id, instance));
            render(publish);
            if (document.activeElement === previous && previous.disabled
                || document.activeElement === next && next.disabled) stage.focus({ preventScroll: true });
        }

        function followHash() {
            var first = Array.from(document.querySelectorAll('.iwac-vis-timeline'))
                .find(function (el) { return el.dataset.timeline === slug; }) === root;
            var id = M.linkedEvent(location.hash, slug, instance, ids, first);
            if (id) { view = 'narrative'; choose(id, false); }
        }
        previous.addEventListener('click', function () { choose(ids[Math.max(0, current - 1)], true); });
        next.addEventListener('click', function () { choose(ids[Math.min(ids.length - 1, current + 1)], true); });
        select.addEventListener('change', function () { view = 'narrative'; choose(select.value, true); });
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
                || event.target.closest('input, select, textarea, a, [contenteditable="true"]')) return;
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
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
                choose(ids[Math.max(0, Math.min(ids.length - 1, current + (dx < 0 ? 1 : -1)))], true);
            }
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
        return { destroy: function () { axis.destroy(); window.removeEventListener('hashchange', followHash); } };
    };
}());
