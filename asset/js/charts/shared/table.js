/**
 * IWAC Visualizations — Shared reusable table
 *
 * Accessible HTML table with optional client-side pagination. Designed
 * for small-to-medium datasets rendered entirely in the DOM (no
 * virtualization).
 *
 * Supported column render modes:
 *   'text'        — escaped raw value (default)
 *   'link'        — <a href={row[linkKey]}> wrapped value
 *   'date'        — parse ISO → toLocaleDateString(IWACVis.locale)
 *   'badge'       — styled pill with i18n key lookup {i18nPrefix}{value}
 *   'thumbnail'   — lazy <img> with fallback placeholder
 *   'number'      — P.formatNumber()
 *
 * Exposed as `P.buildTable(config)`.
 *
 * Load order: after panels.js + pagination.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildPagination) {
        console.warn('IWACVis.table: panels.js + pagination.js must load first');
        return;
    }

    function formatDate(value) {
        if (!value) return '';
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        try {
            return d.toLocaleDateString(
                ns.locale === 'fr' ? 'fr-FR' : 'en-US',
                { year: 'numeric', month: 'short', day: 'numeric' }
            );
        } catch (e) {
            return d.toISOString().slice(0, 10);
        }
    }

    function buildThumbPlaceholder() {
        var div = P.el('div', 'iwac-vis-thumb-placeholder');
        div.setAttribute('aria-hidden', 'true');
        div.innerHTML =
            '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"' +
            ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
            '<path d="M14 2v6h6"/></svg>';
        return div;
    }

    function renderCell(col, row) {
        var value = row[col.key];
        var td = P.el('td', 'iwac-vis-table__cell iwac-vis-table__cell--' + (col.render || 'text'));
        if (col.width) td.style.width = col.width;

        var mode = col.render || 'text';

        if (mode === 'thumbnail') {
            if (value) {
                var img = document.createElement('img');
                img.className = 'iwac-vis-table__thumb';
                img.src = String(value);
                img.alt = '';
                img.loading = 'lazy';
                img.addEventListener('error', function () {
                    img.replaceWith(buildThumbPlaceholder());
                });
                td.appendChild(img);
            } else {
                td.appendChild(buildThumbPlaceholder());
            }
            return td;
        }

        if (value == null || value === '') {
            td.textContent = '';
            return td;
        }

        if (mode === 'link') {
            var href = row[col.linkKey || 'url'];
            if (href) {
                var a = document.createElement('a');
                a.className = 'iwac-vis-table__link';
                a.href = String(href);
                a.textContent = String(value);
                td.appendChild(a);
            } else {
                td.textContent = String(value);
            }
            return td;
        }

        if (mode === 'date') {
            td.textContent = formatDate(value);
            return td;
        }

        if (mode === 'badge') {
            var key = (col.i18nPrefix || '') + String(value);
            var label = P.t(key);
            var badge = P.el('span',
                'iwac-vis-badge iwac-vis-badge--' + String(value).toLowerCase(),
                label === key ? String(value) : label);
            td.appendChild(badge);
            return td;
        }

        if (mode === 'number') {
            td.textContent = P.formatNumber(Number(value));
            return td;
        }

        td.textContent = String(value);
        return td;
    }

    /**
     * Build a table.
     *
     * @param {Object} config
     * @param {Array<Object>} config.columns
     *   Each: { key, label, render?, linkKey?, i18nPrefix?, width? }
     * @param {Array<Object>} config.rows
     * @param {number} [config.pageSize]  Enables pagination when > 0
     * @param {number} [config.currentPage=0]
     * @param {string} [config.emptyMessage]
     * @param {string} [config.className]   Extra class for the wrapper
     * @returns {{ root: HTMLElement, update: function(Array<Object>, number=) }}
     */
    P.buildTable = function (config) {
        var columns = config.columns || [];
        var rows = config.rows || [];
        var pageSize = config.pageSize || 0;
        var currentPage = config.currentPage || 0;
        var emptyMessage = config.emptyMessage || P.t('No data available');

        var wrapper = P.el('div', 'iwac-vis-table-wrapper' +
            (config.className ? ' ' + config.className : ''));

        var tableEl = P.el('table', 'iwac-vis-table');
        var thead = P.el('thead');
        var headerRow = P.el('tr');
        columns.forEach(function (col) {
            var th = P.el('th', 'iwac-vis-table__header', col.label || '');
            if (col.width) th.style.width = col.width;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        tableEl.appendChild(thead);

        var tbody = P.el('tbody');
        tableEl.appendChild(tbody);
        wrapper.appendChild(tableEl);

        var emptyEl = P.el('div', 'iwac-vis-empty', emptyMessage);
        emptyEl.style.display = 'none';
        wrapper.appendChild(emptyEl);

        var pagination = null;
        if (pageSize > 0) {
            pagination = P.buildPagination({
                currentPage: currentPage,
                totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
                onChange: function (newPage) {
                    currentPage = newPage;
                    renderBody();
                }
            });
            wrapper.appendChild(pagination.root);
        }

        function renderBody() {
            tbody.innerHTML = '';
            if (!rows || rows.length === 0) {
                tableEl.style.display = 'none';
                emptyEl.style.display = '';
                if (pagination) pagination.root.style.display = 'none';
                return;
            }
            tableEl.style.display = '';
            emptyEl.style.display = 'none';

            var startIdx = pageSize > 0 ? currentPage * pageSize : 0;
            var endIdx = pageSize > 0 ? startIdx + pageSize : rows.length;
            var pageRows = rows.slice(startIdx, endIdx);

            pageRows.forEach(function (row) {
                var tr = P.el('tr', 'iwac-vis-table__row');
                columns.forEach(function (col) {
                    tr.appendChild(renderCell(col, row));
                });
                tbody.appendChild(tr);
            });

            if (pagination) {
                pagination.update({
                    currentPage: currentPage,
                    totalPages: Math.max(1, Math.ceil(rows.length / pageSize))
                });
            }
        }

        renderBody();

        return {
            root: wrapper,
            update: function (newRows, newPage) {
                rows = newRows || [];
                if (typeof newPage === 'number') {
                    currentPage = newPage;
                } else if (pageSize > 0 && currentPage * pageSize >= rows.length) {
                    currentPage = 0;
                }
                renderBody();
            }
        };
    };
})();
