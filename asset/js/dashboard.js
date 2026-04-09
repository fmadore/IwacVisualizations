/**
 * Dashboard orchestrator.
 *
 * Reads chart builders, layouts, labels, and descriptions from
 * the window.RV namespace (populated by the modular JS files)
 * and wires up async + inline dashboard rendering.
 *
 * Load order:
 *   1. dashboard-core.js          (THEME, COLORS, helpers)
 *   2. dashboard-layouts.js       (per-resource-type layouts)
 *   3. dashboard-charts-basic.js  (timeline, pie, bar, word cloud)
 *   4. dashboard-charts-advanced.js (gantt, heatmap, chord, sankey, sunburst, stacked)
 *   5. dashboard-charts-map.js    (geographic map, mini map)
 *   6. dashboard-collab-network.js (collaboration network)
 *   7. dashboard-registry.js      (CHART_MAP, labels, descriptions)
 *   8. dashboard.js               (this file — orchestrator)
 */
(function () {
    'use strict';

    var ns = window.RV;
    if (!ns) return;

    /* ------------------------------------------------------------------ */
    /*  Render dashboard                                                   */
    /* ------------------------------------------------------------------ */

    function renderDashboard(container, data, siteBase) {
        var layout = (ns.LAYOUTS && ns.LAYOUTS[data.resourceType]) || ns.DEFAULT_LAYOUT;
        var chartKeys = layout.order;

        var html = '<div class="dashboard-header">'
            + '<h3>Visualizations</h3>'
            + '<span class="dashboard-total">' + (data.totalItems || 0) + ' items</span>'
            + '</div>'
            + '<div class="dashboard-charts">';

        chartKeys.forEach(function (key) {
            var d = data[key];
            var hasData = Array.isArray(d) ? d.length > 0 : (d && Object.keys(d).length > 0);
            if (!hasData) return;
            // Skip basic timeline when stacked timeline is available (redundant).
            if (key === 'timeline' && data.stackedTimeline && data.stackedTimeline.years && data.stackedTimeline.years.length > 0) return;
            var wide = layout.wide.indexOf(key) >= 0 ? ' chart-panel-wide' : '';
            var tall = layout.tall.indexOf(key) >= 0 ? ' chart-container-tall' : '';
            var desc = (ns.CHART_DESCRIPTIONS && ns.CHART_DESCRIPTIONS[key]) || '';
            html += '<div class="chart-panel' + wide + '">'
                + '<h4>' + ((ns.CHART_LABELS && ns.CHART_LABELS[key]) || key) + '</h4>'
                + (desc ? '<p class="chart-description">' + desc + '</p>' : '')
                + '<div class="chart-container' + tall + '" data-chart="' + key + '"></div>'
                + '</div>';
        });
        html += '</div>';
        container.innerHTML = html;

        var charts = [];
        chartKeys.forEach(function (key) {
            var el = container.querySelector('[data-chart="' + key + '"]');
            if (el && data[key] && ns.CHART_MAP && ns.CHART_MAP[key]) {
                var chart = ns.CHART_MAP[key](el, data[key], siteBase, data);
                if (chart) {
                    charts.push(chart);
                    ns.attachToolbar(el.closest('.chart-panel'), chart);
                }
            }
        });

        var timer;
        window.addEventListener('resize', function () {
            clearTimeout(timer);
            timer = setTimeout(function () { charts.forEach(function (c) { c.resize(); }); }, 100);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Async dashboard (precomputed JSON)                                 */
    /* ------------------------------------------------------------------ */

    function initAsyncDashboard(container) {
        var itemId = container.dataset.itemId;
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        var moduleBase = basePath + '/modules/IwacVisualizations/asset/data/';
        var url = moduleBase + 'item-dashboards/' + itemId + '.json';

        fetch(url).then(function (r) {
            if (!r.ok) throw new Error('not found');
            return r.json();
        }).then(function (data) {
            if (!data || !data.totalItems) { container.innerHTML = ''; return; }
            container.innerHTML = '';
            renderDashboard(container, data, siteBase);
        }).catch(function () { container.innerHTML = ''; });
    }

    /* ------------------------------------------------------------------ */
    /*  Inline dashboard (data-dashboard attribute)                        */
    /* ------------------------------------------------------------------ */

    function initInlineDashboard(container) {
        var raw = container.getAttribute('data-dashboard');
        if (!raw) return;
        var data;
        try { data = JSON.parse(raw); } catch (e) { return; }
        var siteBase = container.dataset.siteBase || '';
        renderDashboard(container.parentElement || container, data, siteBase);
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                               */
    /* ------------------------------------------------------------------ */

    function init() {
        if (typeof echarts === 'undefined') return;
        var async = document.querySelectorAll('.dashboard-async-container');
        for (var i = 0; i < async.length; i++) initAsyncDashboard(async[i]);
        var inline = document.querySelectorAll('.dashboard-container');
        for (var j = 0; j < inline.length; j++) initInlineDashboard(inline[j]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
