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
 * **Below the theme's `sm` these stop being tables.** A column grid needs
 * width a phone does not have: at 375px the audiovisual panel's six
 * headers printed one letter per line, turning a 40-pixel header band into
 * a 340-pixel one. So every cell also carries a *card role* — which cell
 * is the picture, which is the headline, which are labelled data — and the
 * stylesheet re-lays the same rows as stacked records inside a container
 * query. The role is inferred from the render mode, so no caller had to
 * change; `col.card` overrides it where the guess would be wrong.
 *
 * The ARIA roles emitted here are what make that safe. Changing `display`
 * on a table strips its implicit table semantics in every engine, which
 * would leave a screen reader with an unlabelled run of text exactly where
 * the visual labels appear. Declaring the roles explicitly keeps the
 * accessibility tree a real table with real column headers at every width
 * — which is also why the visual labels are `aria-hidden`: the header is
 * still there, and announcing both would name every field twice.
 *
 * Exposed as `P.buildTable(config)`; `P.tableCardCell` lets a hand-rolled
 * table (the Laïcité corpus table) opt into the same treatment.
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

    var CARD_ROLES = {
        media:  1,  /* thumbnail — floated, the text flows beside it */
        title:  1,  /* the record's headline */
        badge:  1,  /* a pill, joins the metadata line */
        row:    1,  /* labelled datum that needs a line of its own */
        meta:   1,  /* labelled datum that flows with its neighbours */
        action: 1   /* a control, on its own line under the record */
    };

    /**
     * Resolve one card role per column.
     *
     * The inference reads the render mode, which is already a statement
     * about what the value is. The one judgement call is the headline:
     * the first link column, or — in a table with no links at all, like
     * All keywords — the first plain column.
     *
     * That promotion stands down only for a caller who has said something
     * about the headline: an explicit `title`, or an explicit `row` on a
     * column that would otherwise have become one. Press reprints demotes
     * both of its article links that way, because the pair is the finding
     * and crowning one of them would state a precedence the data does not
     * have. A `card: 'action'` on a button column says nothing about the
     * headline and must not suppress it — reading that as "the caller has
     * spoken" left All keywords with a keyword column formatted as one
     * more anonymous datum and no headline at all.
     */
    function resolveCardRoles(columns) {
        var demoted = columns.some(function (col) {
            return col.card === 'title' || col.card === 'row';
        });
        var titleTaken = false;

        var roles = columns.map(function (col) {
            if (col.card && CARD_ROLES[col.card]) {
                if (col.card === 'title') titleTaken = true;
                return col.card;
            }
            var mode = col.render || 'text';
            if (mode === 'thumbnail') return 'media';
            if (mode === 'badge') return 'badge';
            if (mode === 'link') {
                if (titleTaken) return 'row';
                titleTaken = true;
                return 'title';
            }
            return 'meta';
        });

        if (!titleTaken && !demoted) {
            for (var i = 0; i < roles.length; i++) {
                if (roles[i] === 'meta') { roles[i] = 'title'; break; }
            }
        }
        return roles;
    }

    /**
     * The label a card cell prints in place of the column header it can no
     * longer sit under. Hidden from assistive technology — see the module
     * docblock — and omitted for an empty cell, so a record never shows a
     * field name with nothing after it.
     */
    P.tableCardLabel = function (label) {
        if (!label) return null;
        var span = P.el('span', 'iwac-vis-table__cell-label', label);
        span.setAttribute('aria-hidden', 'true');
        return span;
    };

    /**
     * Tag an already-built cell with a card role and, for the labelled
     * roles, prepend its column label. For tables built by hand rather
     * than through `buildTable`.
     */
    P.tableCardCell = function (cell, role, label) {
        if (!cell || !CARD_ROLES[role]) return cell;
        cell.className = (cell.className ? cell.className + ' ' : '') +
            'iwac-vis-table__cell--card-' + role;
        if ((role === 'meta' || role === 'row') && label) {
            var span = P.tableCardLabel(label);
            if (span) cell.insertBefore(span, cell.firstChild);
        }
        return cell;
    };

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

    function renderCell(col, row, role) {
        var value = row[col.key];
        var td = P.el('td', 'iwac-vis-table__cell' +
            ' iwac-vis-table__cell--' + (col.render || 'text') +
            ' iwac-vis-table__cell--card-' + role);
        td.setAttribute('role', 'cell');
        // A custom property, not `style.width`: an inline width would
        // outrank the stylesheet at every width, including the one where
        // the cell has stopped being a column.
        if (col.width) td.style.setProperty('--iwac-vis-col-w', col.width);

        var mode = col.render || 'text';

        if (mode === 'thumbnail') {
            if (value) {
                var img = document.createElement('img');
                img.className = 'iwac-vis-table__thumb';
                img.src = String(value);
                img.alt = '';
                // Intrinsic dimensions so the browser reserves space
                // before CSS loads; the --iwac-vis-thumb-* ramp still
                // owns the rendered size at each breakpoint.
                img.width = 56;
                img.height = 56;
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

        if (role === 'meta' || role === 'row') {
            var cardLabel = P.tableCardLabel(col.label);
            if (cardLabel) td.appendChild(cardLabel);
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
                td.appendChild(document.createTextNode(String(value)));
            }
            return td;
        }

        if (mode === 'date') {
            td.appendChild(document.createTextNode(P.formatDate(value)));
            return td;
        }

        if (mode === 'badge') {
            var key = (col.i18nPrefix || '') + String(value);
            var badgeText = P.t(key);
            var badge = P.el('span',
                'iwac-vis-badge iwac-vis-badge--' + String(value).toLowerCase(),
                badgeText === key ? String(value) : badgeText);
            td.appendChild(badge);
            return td;
        }

        if (mode === 'number') {
            td.appendChild(document.createTextNode(P.formatNumber(Number(value))));
            return td;
        }

        td.appendChild(document.createTextNode(String(value)));
        return td;
    }

    /**
     * Build a table.
     *
     * @param {Object} config
     * @param {Array<Object>} config.columns
     *   Each: { key, label, render?, linkKey?, i18nPrefix?, width?, card? }
     *   `card` is one of media / title / badge / row / meta / action and
     *   overrides the role inferred from `render` — see resolveCardRoles.
     * @param {Array<Object>} config.rows
     * @param {number} [config.pageSize]  Enables pagination when > 0
     * @param {number} [config.currentPage=0]
     * @param {string} [config.emptyMessage]
     * @param {string} [config.className]   Extra class for the wrapper
     * @param {boolean} [config.cards=true] Set false to keep the column
     *   grid at every width — for a table narrow enough to survive one.
     * @returns {{ root: HTMLElement, update: function(Array<Object>, number=) }}
     */
    P.buildTable = function (config) {
        var columns = config.columns || [];
        var rows = config.rows || [];
        var pageSize = config.pageSize || 0;
        var currentPage = config.currentPage || 0;
        var emptyMessage = config.emptyMessage || P.t('No data available');
        var cardRoles = resolveCardRoles(columns);

        var wrapper = P.el('div', 'iwac-vis-table-wrapper' +
            (config.cards === false ? '' : ' iwac-vis-table-wrapper--cards') +
            (config.className ? ' ' + config.className : ''));

        var tableEl = P.el('table', 'iwac-vis-table');
        tableEl.setAttribute('role', 'table');
        var thead = P.el('thead');
        thead.setAttribute('role', 'rowgroup');
        var headerRow = P.el('tr');
        headerRow.setAttribute('role', 'row');
        columns.forEach(function (col) {
            var th = P.el('th', 'iwac-vis-table__header', col.label || '');
            th.setAttribute('role', 'columnheader');
            th.setAttribute('scope', 'col');
            if (col.width) th.style.setProperty('--iwac-vis-col-w', col.width);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        tableEl.appendChild(thead);

        var tbody = P.el('tbody');
        tbody.setAttribute('role', 'rowgroup');
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
                tr.setAttribute('role', 'row');
                columns.forEach(function (col, i) {
                    tr.appendChild(renderCell(col, row, cardRoles[i]));
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
