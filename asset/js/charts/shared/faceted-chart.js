/**
 * IWAC Visualizations — Shared faceted-chart helper
 *
 * Collapses the ~30 lines of boilerplate every faceted panel used to
 * ship: (1) register an ECharts instance with a render function that
 * checks for data and calls `setOption(..., true)` or `instance.clear()`,
 * (2) if no data AND registration failed, drop an empty-state banner
 * into the panel, and (3) optionally subscribe to a shared facet
 * observer so the chart re-renders on facet change.
 *
 * Usage — with an external facet observer (person / entity dashboards):
 *
 *     P.buildFacetedChart(panelEl, {
 *         facet: facet,
 *         getData: function () { return byRole[facet.role] || defaultSlice; },
 *         hasData: function (slice) { return slice.years && slice.years.length > 0; },
 *         buildOption: function (slice) { return C.timeline(slice); }
 *     });
 *
 * Usage — with locally-held state (collection-overview panels):
 *
 *     var state = { facet: 'global' };
 *     var ctrl = P.buildFacetedChart(panelEl, {
 *         getData: currentEntries,
 *         buildOption: function (e) { return C.pie(e, { nameKey: 'name', valueKey: 'count' }); }
 *     });
 *     var facetBar = P.buildFacetButtons({
 *         // ...
 *         onChange: function (evt) { state.facet = evt.facet; ctrl.rerender(); }
 *     });
 *     panelEl.panel.insertBefore(facetBar.root, panelEl.chart);
 *
 * Dependencies: panels.js, dashboard-core.js (for ns.registerChart).
 * Load order: after dashboard-core.js + panels.js, before any panel
 * module that calls P.buildFacetedChart.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.faceted-chart: panels.js must load first');
        return;
    }

    function defaultHasData(d) {
        if (d == null) return false;
        if (Array.isArray(d)) return d.length > 0;
        if (d.cells && Array.isArray(d.cells)) return d.cells.length > 0;
        if (d.years && Array.isArray(d.years)) return d.years.length > 0;
        if (typeof d === 'object') return Object.keys(d).length > 0;
        return Boolean(d);
    }

    /**
     * @param {{panel: HTMLElement, chart: HTMLElement}} panelEl  Output of P.buildPanel
     * @param {Object} opts
     * @param {function():*} opts.getData
     *   Returns the current data snapshot. Called on every render.
     * @param {function(*):Object} opts.buildOption
     *   Returns an ECharts option object for the given data snapshot.
     *   Only called when hasData(data) is true.
     * @param {function(*):boolean} [opts.hasData]
     *   Optional data predicate. Default: truthy + array/object length check.
     * @param {string} [opts.emptyKey='No data available']
     *   i18n key used if the chart can't render at all.
     * @param {{subscribe: function(Function):*}} [opts.facet]
     *   Optional facet observer. When provided, the returned rerender is
     *   auto-wired to `facet.subscribe`.
     * @returns {{chart: any, rerender: function(), showEmpty: function()}}
     */
    P.buildFacetedChart = function (panelEl, opts) {
        var getData = opts.getData;
        var buildOption = opts.buildOption;
        var hasData = opts.hasData || defaultHasData;
        var emptyKey = opts.emptyKey || 'No data available';

        function setOrClear(instance) {
            var d = getData();
            if (hasData(d)) {
                instance.setOption(buildOption(d), true);
            } else {
                instance.clear();
            }
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            setOrClear(instance);
        });

        if (!hasData(getData()) && !chart) {
            panelEl.chart.appendChild(P.buildEmptyState(emptyKey));
        }

        function rerender() {
            if (chart && !chart.isDisposed()) setOrClear(chart);
        }

        if (opts.facet && typeof opts.facet.subscribe === 'function') {
            opts.facet.subscribe(rerender);
        }

        return {
            chart: chart,
            rerender: rerender,
            showEmpty: function () {
                panelEl.chart.appendChild(P.buildEmptyState(emptyKey));
            }
        };
    };
})();
