/**
 * IWAC Visualizations — Horizontal bar renderer
 *
 * Layout-system wrapper around `IWACVis.chartOptions.horizontalBar`.
 * Used by any layout slot that wants a generic top-N horizontal bar
 * without writing a bespoke renderer per chart key.
 *
 * Data shape — plain array of `{name, value}` objects, or a keyed
 * `{key: count, …}` map. The renderer routes both through
 * `ns.toEntries` so callers don't have to normalize beforehand.
 *
 * Slot options (`slot.options`) pass straight through to
 * `C.horizontalBar` (e.g. `valueName`, `categoryName`, `maxBars`,
 * `maxLabelLength`).
 *
 * Registered as `horizontalBar`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.horizontal-bar: dashboard-layout.js + panels.js must load first');
        return;
    }

    DL.registerRenderer('horizontalBar', function (el, data, slot) {
        if (!ns.chartOptions || typeof ns.chartOptions.horizontalBar !== 'function') {
            console.warn('IWACVis.horizontal-bar renderer: chart-options.js must be loaded');
            el.appendChild(P.buildEmptyState());
            return;
        }
        var entries = ns.toEntries ? ns.toEntries(data) : (Array.isArray(data) ? data : []);
        if (!entries.length) {
            el.appendChild(P.buildEmptyState());
            return;
        }
        var option = ns.chartOptions.horizontalBar(entries, (slot && slot.options) || {});
        ns.registerChart(el, function (_e, instance) {
            instance.setOption(option, true);
        });
    });

    DL.registerMetadata('horizontalBar', {
        labelKey: 'Top values',
        descKey:  'desc_horizontal_bar',
        hasData:  function (v) {
            if (!v) return false;
            if (Array.isArray(v))     return v.length > 0;
            if (typeof v === 'object') return Object.keys(v).length > 0;
            return false;
        }
    });
})();
