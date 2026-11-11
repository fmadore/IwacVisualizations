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
    if (!P || !C || !P.buildFacetButtons || !P.buildWindowedGantt) {
        console.warn('IWACVis.index-overview/activity-gantt: missing dependencies');
        return;
    }

    var TYPE_ORDER = ['Personnes', 'Lieux', 'Organisations', 'Sujets', '\u00c9v\u00e9nements'];
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
        availableTypes.forEach(function (t) { types[t] = P.entityTypeLabel(t); });
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
                if (gantt) gantt.update();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        // Each family is capped at 30 entities server-side and C.gantt windows
        // the first 20 of those behind a slider — so the panel was showing 20
        // of 30 of a top-30 and saying none of it. Two thirds of a cap is not
        // a reading of "temporal extent"; state it, and offer the rest.
        //
        // `gantt.update()` on every facet change: the families are not all the same
        // size, and it collapses itself back when the remaining rows fit,
        // which keeps a 12-row family from stranding a tall empty panel.
        var gantt = P.buildWindowedGantt({
            host:       panelEl.chart,
            panel:      panelEl.panel,
            rows:       rows,
            windowSize: WINDOW_SIZE,
            noteKey:    'activity_window_note',
            allKey:     'activity_window_all'
        });

        P.navigateOnClick(gantt.chart, ctx && ctx.siteBase, function (params) {
            var entry = params.data && params.data.entry;
            return entry && entry.o_id ? entry.o_id : null;
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.activityGantt = { render: render };
})();
