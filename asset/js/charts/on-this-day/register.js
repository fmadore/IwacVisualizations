/**
 * IWAC Visualizations — On This Day: "Register" layout
 *
 * Ruled rows, six documents: year figure · scan · title / provenance /
 * lede. The densest of the three and the closest to the theme's editorial
 * grammar, so it is the default.
 *
 * Exposed as `IWACVis.onThisDay.register`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var S = ns.onThisDay && ns.onThisDay.shared;
    if (!P || !S) {
        console.warn('IWACVis.on-this-day/register: missing dependencies');
        return;
    }

    var COUNT = 6;

    function render(host, rows, ctx, mode) {
        var list = P.el('ul', 'iwac-vis-otd-register');

        rows.forEach(function (row) {
            var it = S.readRow(row);

            var link = document.createElement('a');
            link.className = 'iwac-vis-otd-register__row';
            link.href = S.itemUrl(ctx, it.oId);

            var stamp = P.el('div', 'iwac-vis-otd-register__stamp');
            stamp.appendChild(P.el('span', 'iwac-vis-otd-year', String(it.year)));
            var ago = S.agoLabel(it.year);
            if (ago) stamp.appendChild(P.el('span', 'iwac-vis-otd-register__ago', ago));
            link.appendChild(stamp);

            // `medium` (200 px longest side, ~10 KB): ample behind a 124 px
            // plate, and this is the default layout — the one that has to
            // stay cheap on a homepage.
            link.appendChild(S.plate(ctx, it, 'iwac-vis-otd-register__plate', 'medium'));

            var body = P.el('div', 'iwac-vis-otd-register__body');
            body.appendChild(P.el('span', 'iwac-vis-otd-register__title', it.title));

            var meta = P.el('span', 'iwac-vis-otd-meta');
            meta.appendChild(S.typeBadge(it.type));
            if (it.source) {
                meta.appendChild(P.el('span', 'iwac-vis-otd-meta__sep', '·'));
                meta.appendChild(P.el('span', null, it.source));
            }
            meta.appendChild(P.el('span', 'iwac-vis-otd-meta__sep', '·'));
            meta.appendChild(P.el('span', 'iwac-vis-otd-meta__date',
                mode.calendar === 'h'
                    ? S.hijriDate(it.hYear)
                    : S.gregDate(it.year, mode.dayKey)));
            body.appendChild(meta);

            if (it.excerpt) {
                body.appendChild(P.el('span', 'iwac-vis-otd-excerpt', it.excerpt));
            }

            link.appendChild(body);
            var li = P.el('li');
            li.appendChild(link);
            list.appendChild(li);
        });

        host.appendChild(list);
    }

    ns.onThisDay = ns.onThisDay || {};
    ns.onThisDay.register = { count: COUNT, render: render };
})();
