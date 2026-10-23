/**
 * The event picker: a disclosure button that opens the exhibit's table of
 * contents, one row per event — its date in small type over its headline.
 *
 * It replaced a native <select>. A select can only show "date · headline" on
 * one truncated line, and its open list is drawn by the operating system,
 * outside the theme (a white system list on the dark site). This is a plain
 * disclosure of buttons, not an ARIA menu or listbox: Tab and Enter work as
 * on any button, and the arrow keys are an addition, not a requirement.
 */
(function () {
    'use strict';
    var ns = window.IWACVis;
    var P = ns.panels;

    /**
     * @param {string} instance  the block id, to name the panel
     * @param {{id: string, date: string, headline: string}[]} entries  narrative order
     * @param {function(string):void} choose
     */
    ns.createTimelineMenu = function (instance, entries, choose) {
        var wrap = P.el('div', 'iwac-vis-timeline__menu');
        var toggle = P.el('button', 'iwac-vis-timeline__menu-toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', instance + '-events');
        var label = P.el('span', 'iwac-vis-timeline__menu-label');
        toggle.append(label, P.icon('chevron-down'));
        var panel = P.el('div', 'iwac-vis-timeline__menu-panel');
        panel.id = instance + '-events';
        panel.hidden = true;
        var list = P.el('ol', 'iwac-vis-timeline__menu-list');
        var buttons = entries.map(function (entry) {
            var item = P.el('li');
            var button = P.el('button', 'iwac-vis-timeline__menu-item');
            button.type = 'button';
            button.dataset.menuEvent = entry.id;
            if (entry.date) button.appendChild(P.el('span', 'iwac-vis-timeline__menu-date', entry.date));
            button.appendChild(P.el('span', 'iwac-vis-timeline__menu-headline', entry.headline));
            item.appendChild(button);
            list.appendChild(item);
            return button;
        });
        panel.appendChild(list);
        wrap.append(toggle, panel);

        function current() {
            return buttons.find(function (b) { return b.getAttribute('aria-current') === 'true'; }) || buttons[0];
        }

        function onPointer(event) {
            if (!wrap.contains(event.target)) close(false);
        }

        function open() {
            panel.hidden = false;
            toggle.setAttribute('aria-expanded', 'true');
            document.addEventListener('pointerdown', onPointer, true);
            var selected = current();
            // The list scrolls on its own; never the page under it.
            list.scrollTop = selected.offsetTop - list.clientHeight / 2 + selected.offsetHeight / 2;
            selected.focus({ preventScroll: true });
        }

        function close(returnFocus) {
            if (panel.hidden) return;
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', onPointer, true);
            if (returnFocus) toggle.focus({ preventScroll: true });
        }

        toggle.addEventListener('click', function () {
            if (panel.hidden) open(); else close(true);
        });
        list.addEventListener('click', function (event) {
            var button = event.target.closest('[data-menu-event]');
            if (!button) return;
            close(true);
            choose(button.dataset.menuEvent);
        });
        wrap.addEventListener('keydown', function (event) {
            if (panel.hidden) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
                return;
            }
            var index = buttons.indexOf(document.activeElement);
            if (index < 0) return;
            var target = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
            if (target === undefined) return;
            event.preventDefault();
            buttons[Math.max(0, Math.min(buttons.length - 1, target))].focus();
        });
        wrap.addEventListener('focusout', function (event) {
            if (!event.relatedTarget || !wrap.contains(event.relatedTarget)) close(false);
        });

        return {
            element: wrap,
            close: close,
            /** Mark `id` as the current event and show `text` on the button. */
            update: function (id, text) {
                label.textContent = text;
                toggle.setAttribute('aria-label', ns.t('timeline_select') + ' · ' + text);
                buttons.forEach(function (button) {
                    if (button.dataset.menuEvent === id) button.setAttribute('aria-current', 'true');
                    else button.removeAttribute('aria-current');
                });
            }
        };
    };
}());
