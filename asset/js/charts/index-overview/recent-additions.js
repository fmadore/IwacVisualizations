/**
 * IWAC Visualizations — Index Overview: Recent authority additions table
 *
 * Shows the N most recently added authority records (no content items)
 * — the newest persons, places, organisations, events, topics that
 * curators have added to the index. Uses the shared reusable table
 * component with a thumbnail / title / type / added_date layout.
 *
 * Kept small (20 rows, no pagination) so it sits comfortably in the
 * overview grid without pushing the rest of the layout offscreen.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildTable) {
        console.warn('IWACVis.index-overview/recent-additions: missing dependencies');
        return;
    }

    var TYPE_I18N = {
        'Personnes':            'Persons',
        'Lieux':                'Places',
        'Organisations':        'Organizations',
        'Sujets':               'Subjects',
        '\u00c9v\u00e9nements': 'Events'
    };

    function render(panelEl, data, ctx) {
        var rows = (data && data.recent_additions) || [];
        if (rows.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';

        // Convert data rows → table rows with URL + translated type label
        var tableRows = rows.map(function (r) {
            return {
                thumbnail: r.thumbnail,
                title:     r.title,
                type:      P.t(TYPE_I18N[r.type] || r.type || ''),
                added:     r.added_date,
                url:       r.o_id && siteBase ? siteBase + '/item/' + r.o_id : null
            };
        });

        var table = P.buildTable({
            columns: [
                { key: 'thumbnail', label: '',            render: 'thumbnail', width: '64px' },
                { key: 'title',     label: P.t('Title'),  render: 'link', linkKey: 'url' },
                { key: 'type',      label: P.t('Type') },
                { key: 'added',     label: P.t('Added'),  render: 'date', width: '120px' }
            ],
            rows: tableRows,
            emptyMessage: P.t('No data available')
        });

        panelEl.chart.appendChild(table.root);
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.recentAdditions = { render: render };
})();
