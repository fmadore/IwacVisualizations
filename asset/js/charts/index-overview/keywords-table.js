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

        var controls = P.el('div', 'iwac-vis-index-table-controls');

        var searchInput = P.el('input', 'iwac-vis-index-table-search');
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
                        render: 'action'   // custom — handled below via a DOM walk
                    }
                ],
                rows: rows,
                pageSize: PAGE_SIZE,
                emptyMessage: P.t('No data available')
            });
            tableHost.appendChild(tableApi.root);
            wireActionButtons();
        }

        /**
         * P.buildTable doesn't know about custom cell actions, so we
         * walk the rendered rows after each render and inject a button
         * into the last `<td>`. Re-runs after pagination / update.
         */
        function wireActionButtons() {
            var trs = tableApi.root.querySelectorAll('.iwac-vis-table__row');
            var rows = allKeywordsRows();
            // Page slice must match P.buildTable's internal cursor,
            // which we do not have direct access to. Read it from
            // pagination indicator: "Page X / Y".
            var indicator = tableApi.root.querySelector('.iwac-vis-pagination__indicator');
            var page = 0;
            if (indicator) {
                var m = /(\d+)\s*\/\s*\d+/.exec(indicator.textContent || '');
                if (m) page = Math.max(0, parseInt(m[1], 10) - 1);
            }
            var startIdx = page * PAGE_SIZE;

            trs.forEach(function (tr, i) {
                var row = rows[startIdx + i];
                if (!row) return;
                var cells = tr.querySelectorAll('td');
                var actionCell = cells[cells.length - 1];
                if (!actionCell) return;
                actionCell.innerHTML = '';
                var btn = P.el('button', 'iwac-vis-btn iwac-vis-btn--sm',
                    row.__selected ? P.t('Remove') : P.t('Add'));
                btn.type = 'button';
                if (row.__disabled) btn.disabled = true;
                btn.addEventListener('click', function () {
                    state.toggleKeyword(row.keyword, !row.__selected);
                });
                actionCell.appendChild(btn);
            });
        }

        // Re-wire buttons after every pagination click — P.buildTable
        // rewrites the tbody in-place, so we observe it with a
        // MutationObserver rather than patching the table module.
        function installRewireObserver() {
            var tbody = tableApi.root.querySelector('tbody');
            if (!tbody) return;
            var mo = new MutationObserver(function () { wireActionButtons(); });
            mo.observe(tbody, { childList: true });
        }

        var searchTimer = null;
        searchInput.addEventListener('input', function () {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(function () {
                query = searchInput.value || '';
                // Lightweight path: just update rows, keep current page 0
                if (tableApi) tableApi.update(allKeywordsRows(), 0);
                wireActionButtons();
            }, 120);
        });

        buildTable();
        installRewireObserver();

        // Re-render on any state change that affects the table's
        // content (type/selection). We rebuild rather than update() so
        // selection + disabled state propagate correctly.
        state.subscribe(function () {
            if (tableApi) tableApi.update(allKeywordsRows(), 0);
            wireActionButtons();
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.keywordsTable = { render: render };
})();
