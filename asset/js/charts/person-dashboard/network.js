/**
 * IWAC Visualizations — Person Dashboard: neighbors network panel
 *
 * Force-directed graph of TF-IDF ranked associated entities, color-
 * coded by index.Type. Reuses C.network. Click a node to navigate to
 * the corresponding Omeka item page. The panel also exposes zoom
 * in/out/reset buttons that dispatch ECharts' graphRoam / restore
 * actions, since pinch-to-zoom on a touchpad isn't always discoverable.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.network) {
        console.warn('IWACVis.person-dashboard/network: missing deps (need C.network)');
        return;
    }

    var ZOOM_FACTOR = 1.4;

    /**
     * ECharts' `graphRoam` action silently no-ops unless the dispatch
     * carries `originX`/`originY` in pixel coordinates — there is no
     * default anchor, so without them the roam helper has nothing to
     * scale around. Anchor every dispatched zoom on the chart's
     * geometric center.
     */
    function dispatchZoom(chart, factor) {
        chart.dispatchAction({
            type: 'graphRoam',
            zoom: factor,
            originX: chart.getWidth() / 2,
            originY: chart.getHeight() / 2
        });
    }

    function buildToolbar(getChart) {
        var bar = P.el('div', 'iwac-vis-graph-toolbar');

        function btn(label, title, handler) {
            var b = P.el('button', 'iwac-vis-btn iwac-vis-graph-toolbar__btn', label);
            b.type = 'button';
            b.setAttribute('aria-label', title);
            b.title = title;
            b.addEventListener('click', function () {
                var c = getChart();
                if (c && !c.isDisposed()) handler(c);
            });
            return b;
        }

        bar.appendChild(btn('+', P.t('Zoom in'), function (c) {
            dispatchZoom(c, ZOOM_FACTOR);
        }));
        bar.appendChild(btn('\u2212', P.t('Zoom out'), function (c) {
            dispatchZoom(c, 1 / ZOOM_FACTOR);
        }));
        bar.appendChild(btn('\u21BA', P.t('Reset view'), function (c) {
            c.dispatchAction({ type: 'restore' });
        }));

        return bar;
    }

    function render(panelEl, data, facet, ctx) {
        var byRole = (data && data.network && data.network.by_role) || {};

        function currentGraph() {
            return byRole[facet.role] || { nodes: [], edges: [] };
        }

        function hasData(g) { return g && g.nodes && g.nodes.length > 1; }

        // Wrap the chart container so the toolbar can sit on top of it.
        panelEl.chart.classList.add('iwac-vis-graph-host');

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var g = currentGraph();
            if (hasData(g)) {
                instance.setOption(C.network(g), true);
            } else {
                instance.clear();
            }
        });

        if (chart) {
            panelEl.chart.appendChild(buildToolbar(function () { return chart; }));
        }

        if (!hasData(currentGraph()) && !chart) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        if (chart) {
            chart.on('click', function (params) {
                if (params.dataType !== 'node') return;
                var node = params.data || {};
                if (node.entityType === 'center') return;
                if (node.o_id && ctx && ctx.siteBase) {
                    window.location.href = ctx.siteBase + '/item/' + node.o_id;
                }
            });
        }

        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                var g = currentGraph();
                if (hasData(g)) {
                    chart.setOption(C.network(g), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.network = { render: render };
})();
