/**
 * Compare view data unification: ensures consistent colors and decal
 * patterns across paired charts by aligning category order.
 *
 * When two datasets share categories (e.g. both have "French"), this
 * module ensures they appear at the same index so the chart builders
 * assign the same color from COLORS[].
 *
 * Registers into window.RV.unifyForComparison.
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;

    ns.unifyForComparison = {};

    /**
     * Build a unified ordering of category names from both datasets.
     * Both sides will use this order so index i → same category → same color.
     */
    ns.unifyForComparison.buildUnifiedOrder = function (leftData, rightData, key) {
        var leftEntries = extractEntries(leftData, key);
        var rightEntries = extractEntries(rightData, key);

        var totals = {};
        leftEntries.forEach(function (e) { totals[e.name] = (totals[e.name] || 0) + e.value; });
        rightEntries.forEach(function (e) { totals[e.name] = (totals[e.name] || 0) + e.value; });

        return Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
    };

    /**
     * Reorder an array-of-{name,value} dataset to match a unified order.
     * Entries not present in the data are dropped (zero-value items filtered out).
     */
    ns.unifyForComparison.reorderEntries = function (data, key, unifiedOrder) {
        if (!data || !data[key]) return data;
        var entries = extractEntries(data, key);
        var lookup = {};
        entries.forEach(function (e) { lookup[e.name] = e; });

        var reordered = unifiedOrder.map(function (name) {
            return lookup[name] || { name: name, value: 0 };
        }).filter(function (e) { return e.value > 0; });

        var copy = {};
        for (var k in data) { copy[k] = data[k]; }
        copy[key] = reordered;
        return copy;
    };

    /**
     * Unify stacked timeline/area series so both sides use the same
     * series order (and thus same colors per resource type).
     */
    ns.unifyForComparison.unifyStackedSeries = function (leftData, rightData, key) {
        if (!leftData || !leftData[key] || !rightData || !rightData[key]) return;
        var leftSeries = leftData[key].series || [];
        var rightSeries = rightData[key].series || [];

        var totals = {};
        leftSeries.forEach(function (s) {
            var sum = s.data.reduce(function (a, b) { return a + b; }, 0);
            totals[s.name] = (totals[s.name] || 0) + sum;
        });
        rightSeries.forEach(function (s) {
            var sum = s.data.reduce(function (a, b) { return a + b; }, 0);
            totals[s.name] = (totals[s.name] || 0) + sum;
        });
        var order = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });

        function reorderSeries(seriesArr, years) {
            var lookup = {};
            seriesArr.forEach(function (s) { lookup[s.name] = s; });
            return order.map(function (name) {
                if (lookup[name]) return lookup[name];
                return { name: name, data: years.map(function () { return 0; }) };
            }).filter(function (s) {
                return s.data.some(function (v) { return v > 0; });
            });
        }

        leftData[key] = {
            years: leftData[key].years,
            series: reorderSeries(leftSeries, leftData[key].years)
        };
        rightData[key] = {
            years: rightData[key].years,
            series: reorderSeries(rightSeries, rightData[key].years)
        };
    };

    /* -- Internal helpers -- */

    function extractEntries(data, key) {
        if (!data || !data[key]) return [];
        var d = data[key];
        if (Array.isArray(d)) return d;
        return Object.keys(d).map(function (k) { return { name: k, value: d[k] }; });
    }
})();
