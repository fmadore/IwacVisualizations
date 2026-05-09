/**
 * IWAC Visualizations — Treemap renderer
 *
 * Layout-system wrapper around `IWACVis.chartOptions.treemap`. Accepts
 * the same `{name, value?, children?}` hierarchical shape as the
 * sunburst renderer.
 *
 * Data shape (one of):
 *
 *     {name: 'Root', children: [{name, value?, children?}, ...]}  // canonical
 *     [{name, value?, children?}, ...]                            // bare root children
 *     {children: [...]}                                            // wrapped
 *
 * Slot options (`slot.options`):
 *   - `rootName` (string)  Display name on the breadcrumb root crumb.
 *
 * Registered as `treemap`. Predicate: ≥ 1 root child.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.treemap: dashboard-layout.js + panels.js must load first');
        return;
    }

    function toCanonical(data) {
        if (!data) return { children: [] };
        if (Array.isArray(data)) return { children: data };
        if (Array.isArray(data.children)) return data;
        return { children: [] };
    }

    DL.registerRenderer('treemap', function (el, data, slot) {
        if (!ns.chartOptions || typeof ns.chartOptions.treemap !== 'function') {
            console.warn('IWACVis.treemap renderer: chart-options.js must be loaded');
            el.appendChild(P.buildEmptyState());
            return;
        }
        var tree = toCanonical(data);
        var option = ns.chartOptions.treemap(tree, (slot && slot.options) || {});
        ns.registerChart(el, function (_e, instance) {
            instance.setOption(option, true);
        });
    });

    DL.registerMetadata('treemap', {
        labelKey: 'Treemap',
        descKey:  'desc_treemap',
        hasData:  function (v) {
            var c = toCanonical(v).children;
            return Array.isArray(c) && c.length > 0;
        }
    });
})();
