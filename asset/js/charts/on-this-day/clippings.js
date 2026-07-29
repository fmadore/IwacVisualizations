/**
 * IWAC Visualizations — On This Day: "Clippings wall" layout
 *
 * Eight documents in a three-column mosaic of varied plate ratios, held
 * together by hairline rules rather than card frames — the frames would
 * turn the almanac into a wall of boxes.
 *
 * CSS columns fill top-to-bottom before moving right, so with the
 * year-ascending cast each column reads as roughly one era. That suits the
 * wall; the Register layout is there for anyone who wants a strict
 * chronology.
 *
 * Exposed as `IWACVis.onThisDay.clippings`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var S = ns.onThisDay && ns.onThisDay.shared;
    if (!P || !S) {
        console.warn('IWACVis.on-this-day/clippings: missing dependencies');
        return;
    }

    var COUNT = 8;

    // Cycled by position so the wall never settles into a grid. Class names
    // rather than inline aspect-ratio: the shapes are presentation.
    var RATIOS = ['43', '34', '1610', '11', '34', '43', '11', '1610'];

    function render(host, rows, ctx, mode) {
        var wall = P.el('div', 'iwac-vis-otd-clippings');

        rows.forEach(function (row, i) {
            var it = S.readRow(row);

            var link = document.createElement('a');
            link.className = 'iwac-vis-otd-clippings__cut';
            link.href = S.itemUrl(ctx, it.oId);

            // `large`: the columns run to ~340 CSS px, well past what
            // `medium` (200 px longest side) can fill. Same trade as the
            // decades layout — opt-in, image-first, lazy-loaded.
            link.appendChild(S.plate(
                ctx, it,
                'iwac-vis-otd-clippings__plate iwac-vis-otd-clippings__plate--r'
                    + RATIOS[i % RATIOS.length],
                'large'
            ));

            link.appendChild(P.el('span', 'iwac-vis-otd-clippings__year iwac-vis-otd-year',
                String(it.year)));
            link.appendChild(P.el('span', 'iwac-vis-otd-clippings__title', it.title));

            var meta = P.el('span', 'iwac-vis-otd-meta');
            meta.appendChild(S.typeBadge(it.type));
            if (it.source) {
                meta.appendChild(P.el('span', null, it.source));
            }
            if (mode.calendar === 'h' && it.hYear) {
                meta.appendChild(P.el('span', 'iwac-vis-otd-meta__date',
                    S.hijriDate(it.hYear)));
            }
            link.appendChild(meta);

            if (it.excerpt) {
                link.appendChild(P.el('span', 'iwac-vis-otd-excerpt', it.excerpt));
            }

            wall.appendChild(link);
        });

        host.appendChild(wall);
    }

    ns.onThisDay = ns.onThisDay || {};
    ns.onThisDay.clippings = { count: COUNT, render: render };
})();
