/**
 * IWAC Visualizations — Entities panel (top N per type, tabbed, paginated)
 *
 * The "top entities" panel two overviews draw — the Collection Overview's
 * most-cited entities and the Index Overview's top entities — from the
 * same `{ type: [{name, count, o_id}] }` map: a segmented control per
 * entity type, a horizontal bar of ten at a time, a pager beneath, and a
 * click on a bar opening the entity's item page (which the per-entity
 * dashboard block then fills). Until v1.63.0 each overview carried its
 * own copy of this panel; only the order of the type tabs differed.
 *
 * `aria-pressed`, not a tablist, for the type switch: the chart host it
 * drives is already `role="img"` carrying its own description
 * (dashboard-core), and a tabpanel role would have to replace that. A
 * toggle group is the honest shape, and it announces the selected state
 * the bare `--active` class did not.
 *
 * Dependencies: panels.js (P.el, P.navigateOnClick), panels-controls.js
 * (P.buildSegmented), pagination.js (P.buildPagination),
 * chart-options-hbar.js (C.entities, read at call time).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildSegmented || !P.buildPagination) {
        console.warn('IWACVis.entities-panel: missing dependencies');
        return;
    }

    var TYPE_I18N = {
        'Personnes':            'Persons',
        'Lieux':                'Places',
        'Organisations':        'Organizations',
        'Sujets':               'Subjects',
        'Événements': 'Events'
    };
    var DEFAULT_ORDER = ['Personnes', 'Organisations', 'Lieux', 'Sujets', 'Événements'];
    var PAGE_SIZE = 10;

    /**
     * Render the panel into `panelEl` (a P.buildPanel result).
     *
     * @param {{panel: HTMLElement, chart: HTMLElement}} panelEl
     * @param {Object<string, Array<{name:string, count:number, o_id?:number}>>} topEntities
     *   entity type → entries, best first (the generator's top N)
     * @param {{siteBase?: string}} ctx
     * @param {Object} [opts]
     *   typeOrder — the tab order; types with no entries are skipped
     *   pageSize — bars per page (default 10)
     *   maxLabelLength — middle-ellipsis width for C.entities (default 30)
     * @returns {{tabs: Object, pagination: Object}|null} null when there
     *   is nothing to show (an empty state is rendered instead)
     */
    P.buildEntitiesPanel = function (panelEl, topEntities, ctx, opts) {
        opts = opts || {};
        var C = ns.chartOptions;
        topEntities = topEntities || {};
        var order = opts.typeOrder || DEFAULT_ORDER;
        var pageSize = opts.pageSize || PAGE_SIZE;
        var maxLabelLength = opts.maxLabelLength || 30;

        var availableTypes = order.filter(function (type) {
            return (topEntities[type] || []).length > 0;
        });
        if (!availableTypes.length || !C || !C.entities) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return null;
        }

        var state = { type: availableTypes[0], page: 0 };

        function entries() {
            var all = topEntities[state.type] || [];
            var start = state.page * pageSize;
            return all.slice(start, start + pageSize);
        }
        function totalPages() {
            return Math.max(1, Math.ceil((topEntities[state.type] || []).length / pageSize));
        }
        function option() {
            return C.entities(entries(), { maxLabelLength: maxLabelLength });
        }

        var tabs = P.buildSegmented({
            name: 'entity-type',
            ariaLabel: P.t('Entity type'),
            options: availableTypes.map(function (type) {
                return { key: type, label: P.t(TYPE_I18N[type] || type) };
            }),
            active: state.type,
            onChange: function (type) {
                state.type = type;
                state.page = 0;
                rerender();
            }
        });
        panelEl.panel.insertBefore(tabs.root, panelEl.chart);

        var pagination = P.buildPagination({
            currentPage: 0,
            totalPages: totalPages(),
            onChange: function (page) {
                state.page = page;
                rerender();
            }
        });
        panelEl.panel.appendChild(pagination.root);

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            instance.setOption(option(), true);
        });
        P.navigateOnClick(chart, ctx && ctx.siteBase, function (params) {
            var item = params.data;
            return item && item.o_id ? item.o_id : null;
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                // A merge, not a rebuild: the bars are named items, so a
                // page or type change animates between the two lists.
                if (ns.repaint) ns.repaint(chart, option());
                else chart.setOption(option(), true);
            }
            pagination.update({ currentPage: state.page, totalPages: totalPages() });
        }

        return { tabs: tabs, pagination: pagination };
    };
})();
