/**
 * IWAC Visualizations — On This Day: "Decades" layout
 *
 * The header's 2 px rule becomes an axis: five documents pinned along it,
 * one per era, so the reader sees the span of the collection at a glance
 * rather than reading down a list.
 *
 * The axis is drawn per card (a border on the stem, pulled out by half the
 * grid gap so neighbours join) rather than as one absolutely-positioned
 * line. That way it stays a continuous rule at any column count — an
 * absolute line would only ever be right at the widest breakpoint, and
 * would cut across the cards once the grid wrapped.
 *
 * Exposed as `IWACVis.onThisDay.decades`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var S = ns.onThisDay && ns.onThisDay.shared;
    if (!P || !S) {
        console.warn('IWACVis.on-this-day/decades: missing dependencies');
        return;
    }

    var COUNT = 5;

    function render(host, rows, ctx, mode) {
        var grid = P.el('div', 'iwac-vis-otd-decades');

        rows.forEach(function (row) {
            var it = S.readRow(row);

            var link = document.createElement('a');
            link.className = 'iwac-vis-otd-decades__card';
            link.href = S.itemUrl(ctx, it.oId);

            // `large` (800 px longest side): the plate is ~200×150 CSS px
            // here, which `medium` at 200 px longest side would have to
            // upscale. This layout is opt-in and leads with the scan, so it
            // pays for the sharper derivative; lazy loading keeps the ones
            // below the fold off the critical path.
            link.appendChild(S.plate(ctx, it, 'iwac-vis-otd-decades__plate', 'large'));

            var stem = P.el('div', 'iwac-vis-otd-decades__stem');
            stem.appendChild(P.el('span', 'iwac-vis-otd-decades__dot'));
            stem.appendChild(P.el('span', 'iwac-vis-otd-year', String(it.year)));
            stem.appendChild(P.el('span', 'iwac-vis-otd-decades__title', it.title));

            var meta = P.el('span', 'iwac-vis-otd-meta');
            meta.appendChild(S.typeBadge(it.type));
            if (it.source) {
                meta.appendChild(P.el('span', null, it.source));
            }
            stem.appendChild(meta);

            // The date carries no day/month here (every card shares today's),
            // so in the Hijri view the lunar year is the only thing that
            // would otherwise be lost between the two calendars.
            if (mode.calendar === 'h' && it.hYear) {
                stem.appendChild(P.el('span', 'iwac-vis-otd-meta__date',
                    S.hijriDate(it.hYear)));
            }

            link.appendChild(stem);
            grid.appendChild(link);
        });

        host.appendChild(grid);
    }

    ns.onThisDay = ns.onThisDay || {};
    ns.onThisDay.decades = { count: COUNT, render: render };
})();
