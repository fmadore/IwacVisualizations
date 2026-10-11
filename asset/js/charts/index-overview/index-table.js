/**
 * IWAC Visualizations — Index Overview: Full index ledger
 *
 * Searchable + type-filterable + paginated list of every authority
 * record in the IWAC index. Backed by `data.index_table`, which the
 * generator ships as ~4,700 slim rows (title / type / frequency /
 * first / last / countries). All filtering is done client-side so the
 * block only ever fetches one JSON file.
 *
 * Layout: [search input] + [type facet bar] above a running count,
 * the ledger, and the shared pager beneath.
 *
 * A ledger, not a table. It was a five-column `P.buildTable`, and the
 * Countries column took whatever width the other four left — which, for
 * an entry cited across the region, was nearly all of it: the type,
 * mentions and years columns were squeezed until "Places" broke over two
 * lines and "6447" over two more. Each entry is now one record in the
 * theme's result-row grammar (IwacSearch's rows, the theme's
 * `.resource-list`): a dateline of type dot and years, the Besley title,
 * a quiet interpunct line of countries, and the mention count as a
 * right-aligned figure. Hairlines between records, no boxes.
 *
 * Sort order is fixed at "frequency desc, title asc" — the generator
 * pre-sorts so the most relevant entities come first, which is why the
 * list is an `<ol>` whose `start` follows the page. The title opens the
 * Omeka item page (which hosts the per-entity dashboard via the
 * Visualizations resource-page block).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildPagination || !P.buildFacetButtons) {
        console.warn('IWACVis.index-overview/index-table: missing dependencies');
        return;
    }

    var TYPE_ORDER = ['Personnes', 'Lieux', 'Organisations', 'Sujets', 'Événements'];
    // Raw type → the modifier that picks its `--type-entity-*` dot. Whole
    // names, not a composed stem, so the dead-CSS guard can see each one.
    var TYPE_CLASS = {
        Personnes: 'iwac-vis-index-ledger__type--personnes',
        Lieux: 'iwac-vis-index-ledger__type--lieux',
        Organisations: 'iwac-vis-index-ledger__type--organisations',
        Sujets: 'iwac-vis-index-ledger__type--sujets',
        'Événements': 'iwac-vis-index-ledger__type--evenements'
    };
    var ALL_KEY = '__all__';
    var PAGE_SIZE = 30;

    function normalise(str) {
        return String(str || '').toLowerCase();
    }

    function yearsText(r) {
        var first = r.first, last = r.last;
        if (first == null && last == null) return '';
        if (first == null || last == null || first === last) {
            return String(first != null ? first : last);
        }
        return P.t('coverage_range', { min: first, max: last });
    }

    function buildRow(r, siteBase) {
        var li = P.el('li', 'iwac-vis-index-ledger__row');
        var body = P.el('div', 'iwac-vis-index-ledger__body');

        var dateline = P.el('p', 'iwac-vis-index-ledger__dateline');
        var typeClass = TYPE_CLASS[r.type];
        var type = P.el('span',
            'iwac-vis-index-ledger__type' + (typeClass ? ' ' + typeClass : ''),
            P.entityTypeLabel(r.type));
        dateline.appendChild(type);
        var years = yearsText(r);
        if (years) {
            // The interpunct rides inside the type's no-wrap box, so a
            // dateline that wraps on a phone opens its second line on the
            // years rather than on a stray dot.
            var sep = P.el('span', 'iwac-vis-index-ledger__sep', '·');
            sep.setAttribute('aria-hidden', 'true');
            type.appendChild(sep);
            dateline.appendChild(P.el('span', 'iwac-vis-index-ledger__years', years));
        }
        body.appendChild(dateline);

        var title = P.el('p', 'iwac-vis-index-ledger__title');
        if (r.o_id && siteBase) {
            var a = P.el('a', 'iwac-vis-index-ledger__link', r.title);
            a.href = siteBase + '/item/' + r.o_id;
            title.appendChild(a);
        } else {
            title.textContent = r.title;
        }
        body.appendChild(title);

        var countries = r.countries || [];
        if (countries.length) {
            var line = P.el('p', 'iwac-vis-index-ledger__countries');
            line.appendChild(P.el('span', 'iwac-vis-index-ledger__label', P.t('Countries')));
            countries.forEach(function (c) {
                // A real space between names: the interpunct is drawn by
                // CSS, and without one a screen reader runs the countries
                // together as a single word.
                line.appendChild(document.createTextNode(' '));
                line.appendChild(P.el('span', 'iwac-vis-index-ledger__country', c));
            });
            body.appendChild(line);
        }
        li.appendChild(body);

        var n = r.frequency || 0;
        var figure = P.el('p', 'iwac-vis-index-ledger__figure');
        figure.appendChild(P.el('span', 'iwac-vis-index-ledger__count', P.formatNumber(n)));
        figure.appendChild(document.createTextNode(' '));
        figure.appendChild(P.el('span', 'iwac-vis-index-ledger__unit',
            P.t('index.mentions_unit', { count: n })));
        li.appendChild(figure);

        return li;
    }

    function render(panelEl, data, ctx) {
        var all = (data && data.index_table) || [];
        if (all.length === 0) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';
        var state = { query: '', type: ALL_KEY, page: 0 };
        var rows = all;

        // Controls row — search input + type facet
        var controls = P.el('div', 'iwac-vis-toolbar iwac-vis-index-table-controls');

        var searchInput = P.el('input', 'iwac-vis-control iwac-vis-index-table-search');
        searchInput.type = 'search';
        searchInput.placeholder = P.t('Search entities');
        searchInput.setAttribute('aria-label', P.t('Search entities'));
        controls.appendChild(searchInput);

        var types = { __all__: P.t('All types') };
        TYPE_ORDER.forEach(function (t) { types[t] = P.entityTypeLabel(t); });
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
                filter();
            }
        });
        controls.appendChild(facetBar.root);
        panelEl.panel.insertBefore(controls, panelEl.chart);

        var root = P.el('div', 'iwac-vis-index-ledger-wrapper');
        var count = P.el('p', 'iwac-vis-index-ledger-count');
        count.setAttribute('aria-live', 'polite');
        root.appendChild(count);

        var list = P.el('ol', 'iwac-vis-index-ledger');
        root.appendChild(list);

        var empty = P.el('div', 'iwac-vis-empty', P.t('No data available'));
        root.appendChild(empty);

        var pager = P.buildPagination({
            currentPage: 0,
            totalPages: 1,
            onChange: function (p) {
                state.page = p;
                paint();
                // Keep the reader's place: a page turn from the pager at the
                // foot of the list would otherwise land mid-way down the next.
                if (list.getBoundingClientRect().top < 0 && list.scrollIntoView) {
                    list.scrollIntoView({ block: 'start', behavior: 'instant' });
                }
            }
        });
        root.appendChild(pager.root);
        panelEl.chart.appendChild(root);

        function filter() {
            var q = state.query.trim().toLowerCase();
            var t = state.type;
            rows = all.filter(function (r) {
                if (t !== ALL_KEY && r.type !== t) return false;
                if (q && normalise(r.title).indexOf(q) === -1) return false;
                return true;
            });
            state.page = 0;
            paint();
        }

        function paint() {
            var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
            var start = state.page * PAGE_SIZE;
            count.textContent = P.t('index.entries_count', { count: rows.length });

            list.innerHTML = '';
            list.start = start + 1;
            rows.slice(start, start + PAGE_SIZE).forEach(function (r) {
                list.appendChild(buildRow(r, siteBase));
            });
            list.hidden = rows.length === 0;
            empty.hidden = rows.length !== 0;
            pager.update({ currentPage: state.page, totalPages: totalPages });
        }

        paint();

        // Debounce search input (very light — big deal for 4,700 rows)
        var searchTimer = null;
        searchInput.addEventListener('input', function () {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(function () {
                state.query = searchInput.value || '';
                filter();
            }, 120);
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.indexTable = { render: render };
})();
