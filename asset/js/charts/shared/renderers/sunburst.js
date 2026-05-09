/**
 * IWAC Visualizations — Sunburst renderer
 *
 * Layout-system wrapper around `IWACVis.chartOptions.sunburst`. Accepts
 * the same `{name, value?, children?}` hierarchical shape as the
 * treemap renderer so a single Python generator can emit one bundle
 * that either renderer can consume — switch by changing the `chart`
 * key on the slot.
 *
 * Data shape (one of):
 *
 *     [{name, value?, children?}, ...]                   // bare root children
 *     {children: [{name, value?, children?}, ...]}       // wrapped
 *     {name: 'Root', children: [...]}                    // named root
 *
 * Registered as `sunburst`. Predicate: ≥ 1 root child.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P  = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.sunburst: dashboard-layout.js + panels.js must load first');
        return;
    }

    function rootChildren(data) {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.children)) return data.children;
        return [];
    }

    DL.registerRenderer('sunburst', function (el, data, slot) {
        if (!ns.chartOptions || typeof ns.chartOptions.sunburst !== 'function') {
            console.warn('IWACVis.sunburst renderer: chart-options.js must be loaded');
            el.appendChild(P.buildEmptyState());
            return;
        }
        var children = rootChildren(data);
        var option = ns.chartOptions.sunburst(children, (slot && slot.options) || {});
        ns.registerChart(el, function (_e, instance) {
            instance.setOption(option, true);
        });
    });

    DL.registerMetadata('sunburst', {
        labelKey: 'Sunburst',
        descKey:  'desc_sunburst',
        hasData:  function (v) { return rootChildren(v).length > 0; }
    });
})();
