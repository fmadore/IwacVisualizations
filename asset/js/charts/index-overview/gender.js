/**
 * IWAC Visualizations — Index Overview: Persons gender breakdown
 *
 * Donut chart of M / F / Unknown buckets over persons. Rendered only
 * when the `gender` block exists AND at least one bucket is non-zero.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.index-overview/gender: missing dependencies');
        return;
    }

    var LABELS = { 'M': 'Male', 'F': 'Female', 'Unknown': 'Unknown' };

    function render(panelEl, data) {
        var gender = (data && data.gender) || {};
        var entries = Object.keys(LABELS)
            .map(function (k) { return { name: P.t(LABELS[k]), value: gender[k] || 0 }; })
            .filter(function (e) { return e.value > 0; });

        if (entries.length === 0) {
            panelEl.panel.style.display = 'none';
            return;
        }

        ns.registerChart(panelEl.chart, function (el, instance) {
            instance.setOption(C.pie(entries, { nameKey: 'name', valueKey: 'value' }));
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.gender = { render: render };
})();
