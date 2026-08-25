/**
 * IWAC Visualizations — Index Overview: Activity gantt panel
 *
 * Per-entity first→last occurrence bars, grouped by type. A type facet
 * selects which entity family to show (one at a time, since 150 rows
 * of mixed types would be unreadable). Each family is capped at the
 * top 30 entities by frequency server-side.
 *
 * Reuses the shared C.gantt builder (originally designed for the
 * newspaper coverage panel) — it expects `{ name, country, type,
 * year_min, year_max, total }` per entry, which matches what the
 * generator emits.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.index-overview/activity-gantt: missing dependencies');
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
    /** Rows the collapsed view shows \u2014 the C.gantt default, stated here. */
    var WINDOW_SIZE = 20;

    function render(panelEl, data, ctx) {
        var activity = (data && data.activity) || {};
        var availableTypes = TYPE_ORDER.filter(function (t) {
            return (activity[t] || []).length > 0;
        });
        if (availableTypes.length === 0) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var state = { activeType: availableTypes[0] };

        function rows() {
            return activity[state.activeType] || [];
        }

        var types = {};
        availableTypes.forEach(function (t) { types[t] = P.t(TYPE_I18N[t] || t); });
        var facetBar = P.buildFacetButtons({
            facets: [{
                key: 'type',
                label: P.t('Type'),
                subFacets: types,
                renderAs: 'buttons'
            }],
            activeKey: 'type',
            onChange: function (evt) {
                if (!evt.subFacet) return;
                state.activeType = evt.subFacet;
                disclosure.update(rows().length);
                redraw();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        // Each family is capped at 30 entities server-side and C.gantt windows
        // the first 20 of those behind a slider — so the panel was showing 20
        // of 30 of a top-30 and saying none of it. Two thirds of a cap is not
        // a reading of "temporal extent"; state it, and offer the rest.
        //
        // `update()` on every facet change: the families are not all the same
        // size, and it collapses itself back when the remaining rows fit,
        // which keeps a 12-row family from stranding a tall empty panel.
        var disclosure = P.buildWindowDisclosure({
            windowSize: WINDOW_SIZE,
            total:      rows().length,
            noteKey:    'activity_window_note',
            allKey:     'activity_window_all',
            showAllKey: 'window_show_all',
            showTopKey: 'window_show_top',
            onToggle:   redraw
        });
        panelEl.panel.insertBefore(disclosure.root, panelEl.chart);

        function optionFor(list) {
            return C.gantt(list, {
                windowSize: WINDOW_SIZE,
                expanded:   disclosure.isExpanded()
            });
        }

        /** The host owns the height — see collection-overview/gantt.js. */
        function applyHeight(rowCount) {
            panelEl.chart.style.height = disclosure.isExpanded()
                ? C.ganttHeight(rowCount) + 'px'
                : '';
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var list = rows();
            applyHeight(list.length);
            instance.resize();
            instance.setOption(optionFor(list), true);
        });

        function redraw() {
            if (!chart || chart.isDisposed()) return;
            var list = rows();
            applyHeight(list.length);
            chart.resize();
            chart.setOption(optionFor(list), true);
        }

        if (chart) {
            chart.on('click', function (params) {
                var entry = params.data && params.data.entry;
                var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';
                if (entry && entry.o_id && siteBase) {
                    window.location.href = siteBase + '/item/' + entry.o_id;
                }
            });
        }
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.activityGantt = { render: render };
})();
