/**
 * IWAC Visualizations — Compare Newspapers block: metrics row.
 *
 * Split out of compare-newspapers.js. Builds the side-by-side summary
 * grid (total items / words / period / unique subjects / places /
 * newspapers / languages / pages) from the two corpus summaries.
 * Hangs off IWACVis.compareNewspapers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/metrics: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    function buildMetrics(dataA, dataB) {
        var grid = P.el('div', 'iwac-vis-compare-metrics');

        var metrics = [
            { labelKey: 'Total items',      pick: function (d) { return d.summary.total_items; }, numeric: true },
            { labelKey: 'Total words',      pick: function (d) { return d.summary.total_words; }, numeric: true },
            { labelKey: 'Period covered',   pick: function (d) {
                if (d.summary.year_min && d.summary.year_max) {
                    return d.summary.year_min + '\u2013' + d.summary.year_max;
                }
                return '\u2014';
            }, numeric: false },
            { labelKey: 'Unique subjects',  pick: function (d) { return d.summary.unique_subjects; }, numeric: true },
            { labelKey: 'Places mentioned', pick: function (d) { return d.summary.unique_spatial; }, numeric: true },
            { labelKey: 'Newspapers',       pick: function (d) { return d.summary.unique_newspapers; }, numeric: true },
            { labelKey: 'Languages',        pick: function (d) { return d.summary.unique_languages; }, numeric: true },
            { labelKey: 'Total pages',      pick: function (d) { return d.summary.total_pages; }, numeric: true, skipIfZero: true }
        ];

        metrics.forEach(function (m) {
            var vA = m.pick(dataA);
            var vB = m.pick(dataB);
            if (m.skipIfZero && !vA && !vB) return;

            var card = P.el('div', 'iwac-vis-compare-metric');
            card.appendChild(P.el('div', 'iwac-vis-compare-metric__label', P.t(m.labelKey)));
            var pair = P.el('div', 'iwac-vis-compare-metric__pair');
            var valueCls = 'iwac-vis-compare-metric__value' + (m.numeric ? '' : ' iwac-vis-compare-metric__value--text');
            var a = P.el('div', valueCls,
                m.numeric ? P.formatNumber(vA || 0) : String(vA));
            a.dataset.side = 'A';
            a.title = dataA.name;
            var b = P.el('div', valueCls,
                m.numeric ? P.formatNumber(vB || 0) : String(vB));
            b.dataset.side = 'B';
            b.title = dataB.name;
            pair.appendChild(a);
            pair.appendChild(b);
            card.appendChild(pair);
            grid.appendChild(card);
        });

        return grid;
    }

    CN.buildMetrics = buildMetrics;
})();
