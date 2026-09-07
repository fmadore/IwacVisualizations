/**
 * IWAC Visualizations — Index Overview: All-keywords table
 *
 * Searchable + paginated table of every keyword in the current
 * dataset (subjects or spatial). Columns: keyword / occurrences /
 * articles / action. The "action" cell toggles the row in/out of the
 * compare-mode selection, which flips the chart into compare view
 * automatically.
 *
 * Rebuilt on every state change so:
 *   - switching type repopulates the table from the new dataset
 *   - Add/Remove buttons reflect the current selection set
 *   - the "disabled" state of Add respects MAX_SELECTED
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildTable) {
        console.warn('IWACVis.index-overview/keywords-table: missing dependencies');
        return;
    }

    var PAGE_SIZE = 20;

    function render(host, state) {
        host.innerHTML = '';

        var controls = P.el('div', 'iwac-vis-toolbar iwac-vis-index-table-controls');

        var searchInput = P.el('input', 'iwac-vis-control iwac-vis-index-table-search');
        searchInput.type = 'search';
        searchInput.placeholder = P.t('Search keywords');
        searchInput.setAttribute('aria-label', P.t('Search keywords'));
        controls.appendChild(searchInput);

        host.appendChild(controls);

        var tableHost = P.el('div');
        host.appendChild(tableHost);

        var query = '';
        // Build a stub table; we'll replace it whenever state changes.
        var tableApi = null;

        function allKeywordsRows() {
            var d = state.currentData();
            var list = (d && d.all_keywords) || [];
            var snap = state.get();
            var selectedSet = {};
            snap.selected.forEach(function (k) { selectedSet[k] = true; });
            var maxReached = snap.selected.length >= state.MAX_SELECTED;
            var q = query.trim().toLowerCase();

            return list
                .filter(function (item) {
                    return !q || item.keyword.toLowerCase().indexOf(q) !== -1;
                })
                .map(function (item) {
                    var isSelected = !!selectedSet[item.keyword];
                    return {
                        keyword: item.keyword,
                        total: item.total,
                        articles: item.articles,
                        __selected: isSelected,
                        __disabled: !isSelected && maxReached
                    };
                });
        }

        function buildTable() {
            var rows = allKeywordsRows();
            if (tableApi && tableApi.root && tableApi.root.parentNode) {
                tableApi.root.parentNode.removeChild(tableApi.root);
            }
            tableApi = P.buildTable({
                columns: [
                    { key: 'keyword',  label: P.t('Keyword') },
                    { key: 'total',    label: P.t('Occurrences'), render: 'number', width: '130px' },
                    { key: 'articles', label: P.t('Articles'),    render: 'number', width: '120px' },
                    {
                        key: '__action',
                        label: '',
                        width: '110px',
                        // The table builds this cell from the row it is
                        // already holding — no page arithmetic, nothing to
                        // re-attach after a pagination click.
                        render: buildActionCell,
                        card: 'action'
                    }
                ],
                rows: rows,
                pageSize: PAGE_SIZE,
                emptyMessage: P.t('No data available')
            });
            tableHost.appendChild(tableApi.root);
        }

        /** The Add / Remove button for one keyword row. */
        function buildActionCell(row, td) {
            var btn = P.el('button', 'iwac-vis-btn iwac-vis-btn--sm',
                row.__selected ? P.t('Remove') : P.t('Add'));
            btn.type = 'button';
            if (row.__disabled) btn.disabled = true;
            btn.addEventListener('click', function () {
                state.toggleKeyword(row.keyword, !row.__selected);
            });
            td.appendChild(btn);
        }

        var searchTimer = null;
        searchInput.addEventListener('input', function () {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(function () {
                query = searchInput.value || '';
                // Lightweight path: just update rows, keep current page 0
                if (tableApi) tableApi.update(allKeywordsRows(), 0);
            }, 120);
        });

        buildTable();

        // Re-render on any state change that affects the table's
        // content (type/selection). We rebuild rather than update() so
        // selection + disabled state propagate correctly.
        state.subscribe(function () {
            if (tableApi) tableApi.update(allKeywordsRows(), 0);
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.keywordsTable = { render: render };
})();
