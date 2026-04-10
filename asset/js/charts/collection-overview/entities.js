/**
 * IWAC Visualizations — Collection Overview: Entities panel
 *
 * Rewritten panel module for top-cited index entities. Features:
 *   - Tabs for each entity type (Personnes, Organisations, Lieux, Sujets, Événements)
 *   - Client-side pagination (10 per page, up to 50 total per type)
 *   - Middle-ellipsis label truncation via C.entities maxLabelLength
 *   - Click on a bar → navigate to /item/<o_id>
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildPagination) {
        console.warn('IWACVis.collection-overview/entities: missing dependencies');
        return;
    }

    var ENTITY_TYPE_I18N = {
        'Personnes':            'Persons',
        'Organisations':        'Organizations',
        'Lieux':                'Places',
        'Sujets':               'Subjects',
        '\u00c9v\u00e9nements': 'Events'
    };
    var ENTITY_TYPE_ORDER = [
        'Personnes', 'Organisations', 'Lieux', 'Sujets', '\u00c9v\u00e9nements'
    ];
    var PAGE_SIZE = 10;

    function render(panelEl, data, ctx) {
        var topEntities = (data && data.top_entities) || {};
        var availableTypes = ENTITY_TYPE_ORDER.filter(function (type) {
            return (topEntities[type] || []).length > 0;
        });

        if (availableTypes.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var state = { typeIdx: 0, page: 0 };

        // Tabs row (inserted before the chart container)
        var tabsBar = P.el('div', 'iwac-vis-tabs');
        var tabButtons = availableTypes.map(function (type, idx) {
            var btn = P.el('button', 'iwac-vis-tab', P.t(ENTITY_TYPE_I18N[type] || type));
            btn.type = 'button';
            btn.dataset.entityIdx = String(idx);
            if (idx === 0) btn.classList.add('iwac-vis-tab--active');
            tabsBar.appendChild(btn);
            return btn;
        });
        panelEl.panel.insertBefore(tabsBar, panelEl.chart);

        // Pagination control (placed AFTER the chart container)
        var pagination = P.buildPagination({
            currentPage: 0,
            totalPages: totalPagesFor(state.typeIdx),
            onChange: function (newPage) {
                state.page = newPage;
                rerender();
            }
        });
        panelEl.panel.appendChild(pagination.root);

        function currentEntries() {
            var type = availableTypes[state.typeIdx];
            var all = topEntities[type] || [];
            var start = state.page * PAGE_SIZE;
            return all.slice(start, start + PAGE_SIZE);
        }

        function totalPagesFor(typeIdx) {
            var type = availableTypes[typeIdx];
            var all = topEntities[type] || [];
            return Math.max(1, Math.ceil(all.length / PAGE_SIZE));
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            instance.setOption(C.entities(currentEntries(), { maxLabelLength: 30 }), true);
        });

        if (chart) {
            chart.on('click', function (params) {
                var item = params.data;
                var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';
                if (item && item.o_id && siteBase) {
                    window.location.href = siteBase + '/item/' + item.o_id;
                }
            });
        }

        function rerender() {
            if (chart && !chart.isDisposed()) {
                chart.setOption(C.entities(currentEntries(), { maxLabelLength: 30 }), true);
            }
            pagination.update({
                currentPage: state.page,
                totalPages: totalPagesFor(state.typeIdx)
            });
        }

        tabsBar.addEventListener('click', function (evt) {
            var btn = evt.target.closest('[data-entity-idx]');
            if (!btn) return;
            var idx = parseInt(btn.dataset.entityIdx, 10);
            if (isNaN(idx) || idx === state.typeIdx) return;
            state.typeIdx = idx;
            state.page = 0;
            tabButtons.forEach(function (b, i) {
                b.classList.toggle('iwac-vis-tab--active', i === idx);
            });
            rerender();
        });
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.entities = { render: render };
})();
