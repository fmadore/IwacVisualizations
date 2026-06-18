/**
 * IWAC Visualizations — Index Overview: Full index table
 *
 * Searchable + type-filterable + paginated table of every authority
 * record in the IWAC index. Backed by `data.index_table`, which the
 * generator ships as ~4,700 slim rows (title / type / frequency /
 * first / last / countries). All filtering is done client-side so the
 * block only ever fetches one JSON file.
 *
 * Layout: [search input] + [type facet bar] above the table,
 * pagination below (shared pagination.js via P.buildTable).
 *
 * Sort order is fixed at "frequency desc, title asc" — the generator
 * pre-sorts so the most relevant entities bubble to the top. Click a
 * row to open the Omeka item page (which hosts the per-entity
 * dashboard via the Visualizations resource-page block).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildTable) {
        console.warn('IWACVis.index-overview/index-table: missing dependencies');
        return;
    }

    var TYPE_ORDER = ['Personnes', 'Lieux', 'Organisations', 'Sujets', '\u00c9v\u00e9nements'];
    var TYPE_I18N = {
        'Personnes':            'Persons',
        'Lieux':                'Places',
        'Organisations':        'Organizations',
        'Sujets':               'Subjects',
        '\u00c9v\u00e9nements': 'Events'
    };
    var ALL_KEY = '__all__';
    var PAGE_SIZE = 25;

    function normalise(str) {
        return String(str || '').toLowerCase();
    }

    function render(panelEl, data, ctx) {
        var all = (data && data.index_table) || [];
        if (all.length === 0) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';
        var state = { query: '', type: ALL_KEY };

        // Controls row — search input + type facet
        var controls = P.el('div', 'iwac-vis-index-table-controls');

        var searchInput = P.el('input', 'iwac-vis-index-table-search');
        searchInput.type = 'search';
        searchInput.placeholder = P.t('Search entities');
        searchInput.setAttribute('aria-label', P.t('Search entities'));
        controls.appendChild(searchInput);

        var types = { __all__: P.t('All types') };
        TYPE_ORDER.forEach(function (t) { types[t] = P.t(TYPE_I18N[t] || t); });
        var facetBar = P.buildFacetButtons({
            facets: [{
                key: 'type',
                label: P.t('Type'),
                subFacets: types,
                renderAs: 'buttons'
            }],
            activeKey: 'type',
            onChange: function (evt) {
                state.type = evt.subFacet || ALL_KEY;
                update();
            }
        });
        controls.appendChild(facetBar.root);
        panelEl.panel.insertBefore(controls, panelEl.chart);

        // Row shape fed to P.buildTable
        function rowsForState() {
            var q = state.query.trim().toLowerCase();
            var t = state.type;
            var filtered = all.filter(function (r) {
                if (t !== ALL_KEY && r.type !== t) return false;
                if (q && normalise(r.title).indexOf(q) === -1) return false;
                return true;
            });
            return filtered.map(function (r) {
                return {
                    title:     r.title,
                    type:      P.t(TYPE_I18N[r.type] || r.type || ''),
                    frequency: r.frequency || 0,
                    first:     r.first,
                    last:      r.last,
                    span:      (r.first != null && r.last != null) ? (r.first + ' \u2013 ' + r.last) : '',
                    countries: (r.countries || []).join(', '),
                    url:       r.o_id && siteBase ? siteBase + '/item/' + r.o_id : null
                };
            });
        }

        var table = P.buildTable({
            columns: [
                { key: 'title',     label: P.t('Title'),     render: 'link',   linkKey: 'url' },
                { key: 'type',      label: P.t('Type') },
                { key: 'frequency', label: P.t('Mentions'),  render: 'number' },
                { key: 'span',      label: P.t('Period covered_short') },
                { key: 'countries', label: P.t('Countries') }
            ],
            rows: rowsForState(),
            pageSize: PAGE_SIZE,
            emptyMessage: P.t('No data available'),
            className: 'iwac-vis-index-table'
        });
        panelEl.chart.appendChild(table.root);

        function update() {
            table.update(rowsForState(), 0);
        }

        // Debounce search input (very light — big deal for 4,700 rows)
        var searchTimer = null;
        searchInput.addEventListener('input', function () {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(function () {
                state.query = searchInput.value || '';
                update();
            }, 120);
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.indexTable = { render: render };
})();
