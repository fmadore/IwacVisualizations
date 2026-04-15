/**
 * IWAC Visualizations — Index Overview: Type distribution panel
 *
 * Donut chart of authority entities by type. Uses the shared C.pie
 * builder so legend + tooltip styles stay consistent across the module.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.index-overview/type-distribution: missing dependencies');
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

    function render(panelEl, data) {
        var byType = (data && data.summary && data.summary.by_type) || {};
        var entries = TYPE_ORDER
            .map(function (t) {
                return { name: P.t(TYPE_I18N[t] || t), value: byType[t] || 0 };
            })
            .filter(function (e) { return e.value > 0; });

        if (entries.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        ns.registerChart(panelEl.chart, function (el, instance) {
            instance.setOption(C.pie(entries, { nameKey: 'name', valueKey: 'value' }));
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.typeDistribution = { render: render };
})();
