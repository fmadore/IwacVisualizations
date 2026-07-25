/**
 * IWAC Visualizations — On This Day page block (orchestrator)
 *
 * The module's one deliberate engagement hook: items published on today's
 * date (visitor-local) across the collection's decades — newspaper
 * articles and periodical issues with full publication dates. Fetches the
 * per-day file `on-this-day/{MM-DD}.json` written by
 * `scripts/generate_on_this_day.py` (366 files, ~1 KB each; every calendar
 * day has items in the current dataset).
 *
 * Pure DOM — no ECharts. When the day file is missing (pre-first data
 * sync) or empty, the whole block removes itself silently, like the Item
 * Set Dashboard: an engagement hook must never render an error state.
 *
 * The daily selection is deterministic: every visitor sees the same
 * spread-across-the-decades picks for a given date, and the picks change
 * with the date.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis on this day: missing panels — check script load order');
        return;
    }
    var P = ns.panels;

    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Loading on this day': 'Loading on this day',
            'otd.title':    'On this day',
            'otd.desc':     'Published on {date}, across the decades of the collection.',
            'otd.type_a':   'newspaper article',
            'otd.type_p':   'periodical issue',
            'otd.one_more': 'One more item published on this date is in the collection.',
            'otd.more':     '{count} more items published on this date are in the collection.'
        });
        ns.addTranslations('fr', {
            'Loading on this day': 'Chargement de « ce jour-là »',
            'otd.title':    'Ce jour-là',
            'otd.desc':     'Publiés un {date}, au fil des décennies de la collection.',
            'otd.type_a':   'article de presse',
            'otd.type_p':   'numéro de périodique',
            'otd.one_more': 'Un autre document publié à cette date figure dans la collection.',
            'otd.more':     '{count} autres documents publiés à cette date figurent dans la collection.'
        });
    }

    var MAX_ITEMS = 8;

    /** Remove the whole block (incl. server-rendered heading) — the
     *  silent-skip rule shared with the Item Set Dashboard. */

    function pad2(n) {
        var s = String(n);
        return s.length < 2 ? '0' + s : s;
    }

    function todayKey() {
        var now = new Date();
        return pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    }

    function dateLabel() {
        var now = new Date();
        try {
            return now.toLocaleDateString(
                ns.locale === 'fr' ? 'fr-FR' : 'en-US',
                { day: 'numeric', month: 'long' }
            );
        } catch (e) {
            return todayKey();
        }
    }

    /**
     * Deterministic daily pick: the items arrive year-sorted, so an
     * evenly-spaced walk covers the decades; a per-date offset inside
     * each segment rotates which item represents its era, so the list
     * changes from day to day but is identical for every visitor.
     */
    function pickSpread(items, max) {
        if (items.length <= max) return items.slice();
        var key = todayKey();
        var seed = 0;
        for (var i = 0; i < key.length; i++) {
            seed = (seed * 31 + key.charCodeAt(i)) % 997;
        }
        var step = items.length / max;
        var jitterRange = Math.max(1, Math.floor(step));
        var picked = [];
        for (var k = 0; k < max; k++) {
            var idx = Math.floor(k * step) + (seed % jitterRange);
            picked.push(items[Math.min(idx, items.length - 1)]);
        }
        return picked;
    }

    function render(container, data, ctx) {
        var items = (data && data.items) || [];
        if (!items.length) {
            P.removeBlock(container);
            return;
        }
        container.innerHTML = '';

        var panel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-otd-panel',
            P.t('otd.title'),
            P.t('otd.desc', { date: dateLabel() })
        );
        container.appendChild(panel.panel);

        var picked = pickSpread(items, MAX_ITEMS);
        var list = P.el('ul', 'iwac-vis-otd-list');
        picked.forEach(function (row) {
            var year = row[0], oId = row[1], title = row[2],
                source = row[3], type = row[4];

            var li = P.el('li', 'iwac-vis-otd-item');
            var yearEl = P.el('span', 'iwac-vis-otd-year', String(year));
            li.appendChild(yearEl);

            var body = P.el('div', 'iwac-vis-otd-body');
            var link = document.createElement('a');
            link.className = 'iwac-vis-otd-title';
            link.href = (ctx.siteBase || '') + '/item/' + encodeURIComponent(String(oId));
            link.textContent = title;
            body.appendChild(link);

            var metaText = (source ? source + ' · ' : '')
                + P.t(type === 'p' ? 'otd.type_p' : 'otd.type_a');
            body.appendChild(P.el('div', 'iwac-vis-otd-meta', metaText));

            li.appendChild(body);
            list.appendChild(li);
        });
        panel.chart.appendChild(list);

        var rest = items.length - picked.length;
        if (rest > 0) {
            var more = P.el('p', 'iwac-vis-otd-more iwac-vis-muted',
                rest === 1 ? P.t('otd.one_more') : P.t('otd.more', { count: rest }));
            panel.chart.appendChild(more);
        }
    }

    // `onError: 'remove'` is the engagement-hook contract: before the first data
    // sync there is no per-day file, and a homepage block must vanish rather
    // than render an error banner.
    P.bootBlock({
        selector:       '.iwac-vis-on-this-day',
        warnLabel:      'IWACVis on this day',
        requireECharts: false,
        load:           function (ctx) {
            return P.fetchJSON(ctx.dataBase + 'on-this-day/' + todayKey() + '.json');
        },
        render:         render,
        onError:        'remove'
    });
})();
