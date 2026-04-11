/**
 * IWAC Visualizations — Collection Overview: Recent additions panel
 *
 * Reads `data.recent_additions` (list of up to 100 items) and renders a
 * paginated, thumbnail-enabled table using P.buildTable. URLs are built
 * on the client from ctx.siteBase + '/item/' + o_id, so the link respects
 * the current Omeka site locale (afrique_ouest / westafrica) automatically.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildTable) {
        console.warn('IWACVis.collection-overview/recent-additions: missing dependencies');
        return;
    }

    function render(chartEl, data, ctx) {
        var items = (data && data.recent_additions) || [];
        if (items.length === 0) {
            chartEl.appendChild(P.el('div', 'iwac-vis-empty', P.t('No recent additions')));
            return;
        }

        var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';
        var enriched = items.map(function (it) {
            var copy = {};
            for (var k in it) { if (Object.prototype.hasOwnProperty.call(it, k)) copy[k] = it[k]; }
            copy.url = it.o_id != null && siteBase ? siteBase + '/item/' + it.o_id : '';
            return copy;
        });

        var tbl = P.buildTable({
            columns: [
                { key: 'thumbnail',  label: '',                render: 'thumbnail', width: '72px' },
                { key: 'title',      label: P.t('Title'),      render: 'link', linkKey: 'url' },
                { key: 'source',     label: P.t('Source') },
                { key: 'added_date', label: P.t('Added'),      render: 'date', width: '140px' }
            ],
            rows: enriched,
            pageSize: 20,
            emptyMessage: P.t('No recent additions'),
            className: 'iwac-vis-table--recent'
        });

        chartEl.appendChild(tbl.root);
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.recentAdditions = { render: render };
})();
