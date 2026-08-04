/**
 * IWAC Visualizations — shared concordance (KWIC) renderer.
 *
 * Keyword-in-context lines: left context, highlighted match, right context,
 * each linking back to its item page. Nothing in shared/ did highlighted-
 * snippet lists before; this was written for the Laïcité block (issue #14),
 * where reading the actual sentences is the point rather than a nice-to-have,
 * and lives in shared/ from the start because Term Trends, Distinctive
 * Vocabulary and Topic Explorer would all be better with a "show me the
 * lines" affordance.
 *
 * Rows are rendered from a NORMALIZED payload — item identity lives once in
 * an `items` table and each row carries an index into it — because a
 * denormalized bundle repeats every title and URL per occurrence and roughly
 * triples the transfer size.
 *
 * The caller owns filtering and paging; this module owns presentation only.
 *
 * Dependencies: panels.js (P), pagination.js (P.buildPagination).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.concordance: panels.js must load first');
        return;
    }
    var P = ns.panels;

    /**
     * Build a paginated concordance list.
     *
     * @param {Object} cfg
     * @param {Array<Object>} cfg.rows       normalized rows: {i, f, d, l, m, r}
     * @param {Array<Object>} cfg.items      item table: {o, t, u, y, c, n?, g?}
     * @param {string} [cfg.siteBase]        site root for item links
     * @param {number} [cfg.pageSize=25]
     * @param {function(Object):string} [cfg.labelForFrame]
     * @param {function(Object, Object):Node} [cfg.renderMeta]  custom meta line
     * @param {string} [cfg.emptyKey]        i18n key when there are no rows
     * @param {string} [cfg.className]       extra class on the root
     * @returns {{root: HTMLElement, update: function(Array, Array=), page: function():number}}
     */
    P.buildConcordance = function (cfg) {
        var pageSize = cfg.pageSize || 25;
        var rows = cfg.rows || [];
        var items = cfg.items || [];
        var siteBase = cfg.siteBase || '';
        var labelForFrame = cfg.labelForFrame || function (r) { return r.f; };
        var page = 0;

        var root = P.el('div', 'iwac-vis-kwic ' + (cfg.className || ''));
        var list = P.el('ol', 'iwac-vis-kwic-list');
        root.appendChild(list);

        var pager = P.buildPagination({
            currentPage: 0,
            totalPages: 1,
            onChange: function (p) {
                page = p;
                paint();
                // Keep the reader's place: jump back to the top of the list
                // rather than leaving them mid-page after a page turn.
                if (root.scrollIntoView) {
                    root.scrollIntoView({ block: 'nearest' });
                }
            }
        });
        root.appendChild(pager.root);

        function itemFor(row) {
            return items[row.i] || {};
        }

        function buildRow(row) {
            var item = itemFor(row);
            var li = P.el('li', 'iwac-vis-kwic-row');

            var line = P.el('p', 'iwac-vis-kwic-line');
            line.appendChild(P.el('span', 'iwac-vis-kwic-left', row.l || ''));
            line.appendChild(P.el('mark', 'iwac-vis-kwic-match', row.m || ''));
            line.appendChild(P.el('span', 'iwac-vis-kwic-right', row.r || ''));
            li.appendChild(line);

            if (cfg.renderMeta) {
                var custom = cfg.renderMeta(row, item);
                if (custom) li.appendChild(custom);
                return li;
            }

            var meta = P.el('p', 'iwac-vis-kwic-meta');
            if (item.u || (siteBase && item.o)) {
                var a = P.el('a', 'iwac-vis-kwic-title', item.t || item.o || '');
                a.href = item.u || (siteBase + '/item/' + item.o);
                meta.appendChild(a);
            } else {
                meta.appendChild(P.el('span', 'iwac-vis-kwic-title', item.t || ''));
            }
            var bits = [];
            if (item.n) bits.push(item.n);
            if (item.y) bits.push(String(item.y));
            if (item.c && item.c.length) bits.push(item.c.join(', '));
            if (bits.length) {
                meta.appendChild(P.el('span', 'iwac-vis-kwic-sep', ' · '));
                meta.appendChild(P.el('span', 'iwac-vis-kwic-source', bits.join(' · ')));
            }
            var chip = P.el('span', 'iwac-vis-kwic-frame', labelForFrame(row));
            meta.appendChild(chip);
            // Mark items carrying the curated authority tag, so the reader can
            // see at a glance which lines are also indexed under the concept
            // rather than only using the word.
            if (item.g) {
                var tag = P.el('span', 'iwac-vis-kwic-tagged', P.t('tagged'));
                tag.title = P.t('concordance.tagged_hint');
                meta.appendChild(tag);
            }
            li.appendChild(meta);
            return li;
        }

        function paint() {
            list.innerHTML = '';
            var total = rows.length;
            var totalPages = Math.max(1, Math.ceil(total / pageSize));
            if (page >= totalPages) page = totalPages - 1;
            if (!total) {
                pager.update({ currentPage: 0, totalPages: 1 });
                list.appendChild(P.el('li', 'iwac-vis-kwic-empty',
                    P.t(cfg.emptyKey || 'No data available')));
                return;
            }
            list.setAttribute('start', String(page * pageSize + 1));
            rows.slice(page * pageSize, (page + 1) * pageSize)
                .forEach(function (row) { list.appendChild(buildRow(row)); });
            pager.update({ currentPage: page, totalPages: totalPages });
        }

        paint();

        return {
            root: root,
            page: function () { return page; },
            update: function (newRows, newItems) {
                rows = newRows || [];
                if (newItems) items = newItems;
                page = 0;
                paint();
            }
        };
    };

    /**
     * Case- and accent-insensitive substring test over a KWIC row's text,
     * for the free-text filter box. Folding matches the generator's own
     * matching, so a reader searching "laicite" finds "laïcité".
     */
    P.concordanceMatches = function (row, needle) {
        if (!needle) return true;
        var hay = P.foldAccents((row.l || '') + ' ' + (row.m || '') + ' ' + (row.r || ''));
        return hay.indexOf(P.foldAccents(needle)) !== -1;
    };
})();
