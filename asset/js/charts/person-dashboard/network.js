/**
 * IWAC Visualizations — Person + Entity Dashboards: network panel
 *
 * Force-directed graph of TF-IDF ranked associated entities, colored
 * by index.Type. Reuses C.network. Click a node to navigate to the
 * corresponding Omeka item. The panel exposes four toolbar buttons:
 *
 *   +   zoom in  (graphRoam dispatch with centre origin)
 *   −   zoom out
 *   ↺   reset view (restore)
 *   ▣   toggle legend
 *   ⛶   toggle fullscreen (Fullscreen API on the panel element)
 *
 * All buttons compose `.iwac-vis-btn` so they inherit the shared
 * border/background/focus/transition tokens. No hex literals.
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
     * graphRoam silently no-ops unless the dispatch carries pixel
     * originX/originY. Always anchor on the chart's geometric centre.
     */
    function dispatchZoom(chart, factor) {
        chart.dispatchAction({
            type: 'graphRoam',
            zoom: factor,
            originX: chart.getWidth() / 2,
            originY: chart.getHeight() / 2
        });
    }

    function buildButton(label, title, onClick) {
        var b = P.el('button', 'iwac-vis-btn iwac-vis-graph-toolbar__btn', label);
        b.type = 'button';
        b.setAttribute('aria-label', title);
        b.title = title;
        b.addEventListener('click', onClick);
        return b;
    }

    function render(panelEl, data, facet, ctx) {
        var byRole = (data && data.network && data.network.by_role) || {};
        // Panel-local UI state. Survives facet changes.
        var legendVisible = true;
        var isFullscreen = false;

        function currentGraph() {
            return byRole[facet.role] || { nodes: [], edges: [] };
        }

        function hasData(g) { return g && g.nodes && g.nodes.length > 1; }

        panelEl.chart.classList.add('iwac-vis-graph-host');

        // Build the full option only when the graph itself changes
        // (facet switch, role flip). Legend + fullscreen toggles use
        // merge-mode setOption so the force simulation doesn't restart
        // — that was the "unsettling edge movement" on every click.
        function buildFullOption() {
            return C.network(currentGraph(), { showLegend: legendVisible });
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData(currentGraph())) {
                instance.setOption(buildFullOption(), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData(currentGraph()) && !chart) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        // ---------------- Toolbar ----------------
        if (chart) {
            var bar = P.el('div', 'iwac-vis-graph-toolbar');

            bar.appendChild(buildButton('+', P.t('Zoom in'), function () {
                if (!chart.isDisposed()) dispatchZoom(chart, ZOOM_FACTOR);
            }));
            bar.appendChild(buildButton('\u2212', P.t('Zoom out'), function () {
                if (!chart.isDisposed()) dispatchZoom(chart, 1 / ZOOM_FACTOR);
            }));
            bar.appendChild(buildButton('\u21BA', P.t('Reset view'), function () {
                if (!chart.isDisposed()) chart.dispatchAction({ type: 'restore' });
            }));

            // Legend toggle — merge mode so only legend.show and the
            // series bottom margin change. No force rerun, no edge
            // jumps. The series margin expands/shrinks to cover the
            // space the legend used to occupy.
            var legendBtn = buildButton('\u25A4', P.t('Toggle legend'), function () {
                if (chart.isDisposed()) return;
                legendVisible = !legendVisible;
                chart.setOption({
                    legend: [{ show: legendVisible }],
                    series: [{ bottom: legendVisible ? 56 : 16 }]
                });
                legendBtn.classList.toggle('iwac-vis-graph-toolbar__btn--pressed', !legendVisible);
            });
            bar.appendChild(legendBtn);

            // Fullscreen — Fullscreen API on the panel wrapper. The
            // panel gets `.iwac-vis-panel--fullscreen` for layout and
            // ECharts is re-sized via chart.resize() on the change event.
            var fullBtn = buildButton('\u26F6', P.t('Toggle fullscreen'), function () {
                var host = panelEl.panel;
                if (!host) return;
                if (!document.fullscreenElement) {
                    if (host.requestFullscreen) host.requestFullscreen();
                } else if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            });
            bar.appendChild(fullBtn);

            // React to native fullscreen changes (user pressing Esc etc.)
            document.addEventListener('fullscreenchange', function () {
                var host = panelEl.panel;
                if (!host) return;
                isFullscreen = (document.fullscreenElement === host);
                host.classList.toggle('iwac-vis-panel--fullscreen', isFullscreen);
                fullBtn.classList.toggle('iwac-vis-graph-toolbar__btn--pressed', isFullscreen);
                // Give the browser a frame to apply the new size.
                setTimeout(function () {
                    if (!chart.isDisposed()) chart.resize();
                }, 50);
            });

            panelEl.chart.appendChild(bar);
        }

        // ---------------- Click-through ----------------
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

        // ---------------- Facet reactivity ----------------
        // Role flips DO change the graph (different nodes + edges), so
        // rebuild the full option. Force layout runs once synchronously
        // because layoutAnimation is disabled in C.network.
        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                if (hasData(currentGraph())) {
                    chart.setOption(buildFullOption(), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.network = { render: render };
})();
