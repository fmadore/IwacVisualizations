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

    function render(panelEl, data, ctx) {
        var activity = (data && data.activity) || {};
        var availableTypes = TYPE_ORDER.filter(function (t) {
            return (activity[t] || []).length > 0;
        });
        if (availableTypes.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var state = { activeType: availableTypes[0] };

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
                if (chart && !chart.isDisposed()) {
                    chart.setOption(C.gantt(activity[state.activeType] || []), true);
                }
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            instance.setOption(C.gantt(activity[state.activeType] || []), true);
        });

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
