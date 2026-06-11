/**
 * IWAC Visualizations — Compare Newspapers block: overlap columns.
 *
 * Split out of compare-newspapers.js. Builds the three-column panel of
 * clickable tags (only-A / shared / only-B) used twice per comparison —
 * once for subject overlap, once for spatial coverage overlap. Hangs
 * off IWACVis.compareNewspapers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/overlap: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    var DEFAULT_TOP_OVERLAP = 12;

    function computeOverlap(listA, listB, topN) {
        var mapA = {};
        var mapB = {};
        (listA || []).forEach(function (e) { mapA[e.name] = e; });
        (listB || []).forEach(function (e) { mapB[e.name] = e; });

        var shared = [];
        var onlyA = [];
        var onlyB = [];

        Object.keys(mapA).forEach(function (name) {
            if (Object.prototype.hasOwnProperty.call(mapB, name)) {
                shared.push({
                    name: name,
                    countA: mapA[name].count,
                    countB: mapB[name].count,
                    combined: mapA[name].count + mapB[name].count,
                    o_id: mapA[name].o_id || mapB[name].o_id
                });
            } else {
                onlyA.push({ name: name, count: mapA[name].count, o_id: mapA[name].o_id });
            }
        });
        Object.keys(mapB).forEach(function (name) {
            if (!Object.prototype.hasOwnProperty.call(mapA, name)) {
                onlyB.push({ name: name, count: mapB[name].count, o_id: mapB[name].o_id });
            }
        });

        shared.sort(function (a, b) { return b.combined - a.combined; });
        onlyA.sort(function (a, b) { return b.count - a.count; });
        onlyB.sort(function (a, b) { return b.count - a.count; });

        return {
            shared: shared.slice(0, topN),
            onlyA: onlyA.slice(0, topN),
            onlyB: onlyB.slice(0, topN),
            sharedTotal: shared.length,
            onlyATotal: onlyA.length,
            onlyBTotal: onlyB.length
        };
    }

    function buildOverlapList(items, kind, ctx) {
        var ul = P.el('ul', 'iwac-vis-compare-overlap__list');
        items.forEach(function (item) {
            // Wrap each tag in an <a> when the o:id resolved — that points
            // to the authority-record page for the entity (Lieu / Sujet /
            // Personne / etc.), matching what the rest of the theme does
            // for index links.
            var tag;
            if (item.o_id && ctx && ctx.siteBase) {
                tag = P.el('a', 'iwac-vis-compare-overlap__tag');
                tag.href = ctx.siteBase + '/item/' + item.o_id;
            } else {
                tag = P.el('li', 'iwac-vis-compare-overlap__tag');
            }
            tag.appendChild(P.el('strong', null, item.name));
            if (kind === 'shared') {
                tag.appendChild(P.el('span', null, ' \u00b7 '
                    + P.formatNumber(item.countA) + ' / ' + P.formatNumber(item.countB)));
            } else {
                tag.appendChild(P.el('span', null, ' \u00b7 ' + P.formatNumber(item.count)));
            }
            if (tag.tagName.toLowerCase() === 'a') {
                var li = P.el('li');
                li.style.listStyle = 'none';
                li.style.margin = '0';
                li.appendChild(tag);
                ul.appendChild(li);
            } else {
                ul.appendChild(tag);
            }
        });
        return ul;
    }

    function buildOverlapPanel(titleKey, listA, listB, dataA, dataB, ctx) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t(titleKey)));
        var grid = P.el('div', 'iwac-vis-compare-overlap');
        panel.appendChild(grid);

        var overlap = computeOverlap(listA, listB, DEFAULT_TOP_OVERLAP);

        function makeCol(kind, titleText, total, items) {
            var col = P.el('div', 'iwac-vis-compare-overlap__col');
            col.dataset.kind = kind;
            var title = P.el('div', 'iwac-vis-compare-overlap__title', titleText);
            title.appendChild(P.el('span', 'iwac-vis-compare-overlap__count',
                ' \u00b7 ' + P.formatNumber(total)));
            col.appendChild(title);
            if (items.length === 0) {
                col.appendChild(P.el('div', 'iwac-vis-compare-overlap__empty', P.t('No overlap')));
            } else {
                col.appendChild(buildOverlapList(items, kind, ctx));
            }
            return col;
        }

        grid.appendChild(makeCol('only-a',
            P.t('Only in A', { name: dataA.name }),
            overlap.onlyATotal, overlap.onlyA));
        grid.appendChild(makeCol('shared',
            P.t('Shared'), overlap.sharedTotal, overlap.shared));
        grid.appendChild(makeCol('only-b',
            P.t('Only in B', { name: dataB.name }),
            overlap.onlyBTotal, overlap.onlyB));

        return panel;
    }

    CN.buildOverlapPanel = buildOverlapPanel;
})();
