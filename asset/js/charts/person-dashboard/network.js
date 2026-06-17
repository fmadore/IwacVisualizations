/**
 * IWAC Visualizations — Person + Entity Dashboards: network panel
 *
 * Force-directed graph of TF-IDF ranked associated entities, colored
 * by index.Type. Reuses C.network. Click a node to navigate to the
 * corresponding Omeka item. The panel ships its own toolbar with:
 *
 *   +   zoom in  (graphRoam dispatch with centre origin)
 *   −   zoom out
 *   ↺   reset view (restore)
 *   ▣   toggle legend
 *   ⬇   download chart as PNG
 *   ⛶   toggle fullscreen (Fullscreen API on the panel element)
 *
 * All buttons compose `.iwac-vis-btn` so they inherit the shared
 * border/background/focus/transition tokens. No hex literals.
 *
 * The panel opts out of the shared `.iwac-vis-panel-toolbar` via
 * `data-iwac-no-panel-toolbar="1"` (and its chart host carries the
 * `.iwac-vis-graph-host` marker class) so the two toolbars don't
 * stack on top of each other in the same corner.
 *
 * Click-vs-drag disambiguation: the node click handler navigates to
 * the Omeka item, but dragging a node also fires a `click` event at
 * mouseup if the drag distance is small. We watch Zr mousedown /
 * mouseup to set a `suppressClick` flag whenever the pointer moved
 * more than 4 pixels, so drags never accidentally navigate away.
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
        // Tell the shared panel-toolbar auto-wire to leave this panel
        // alone — we ship our own toolbar with a download button below.
        if (panelEl.panel && panelEl.panel.setAttribute) {
            panelEl.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        }

        // Build the full option only when the graph itself changes
        // (facet switch, role flip). Legend + fullscreen toggles use
        // merge-mode setOption so the force simulation doesn't restart
        // — that was the "unsettling edge movement" on every click.
        function buildFullOption() {
            // thumbnail: ECharts 6 minimap — orientation aid once the
            // user zooms/pans the 50-node graph (auto-hidden ≤640px).
            return C.network(currentGraph(), { showLegend: legendVisible, thumbnail: true });
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData(currentGraph())) {
                instance.setOption(buildFullOption(), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData(currentGraph()) && !chart) {
            panelEl.chart.appendChild(P.buildEmptyState());
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

            // Download chart as PNG. The live instance is looked up
            // through ns.getLiveChart so we never call getDataURL on a
            // disposed instance after a theme swap.
            bar.appendChild(buildButton('\u2B73', P.t('Download chart'), function () {
                var live = ns.getLiveChart && ns.getLiveChart(panelEl.chart);
                if (!live) return;
                var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
                var dataUrl = live.getDataURL({
                    type: 'png',
                    pixelRatio: 2,
                    backgroundColor: tokens.surface || '#ffffff'
                });
                if (!dataUrl) return;
                var a = document.createElement('a');
                a.download = 'iwac-associated-entities.png';
                a.href = dataUrl;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }));

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
        //
        // ECharts fires a synthetic `click` on mouseup even when the
        // user was dragging a node — if the drag distance is small,
        // the click handler below would navigate away before the user
        // finishes positioning. We watch the underlying zrender
        // mousedown / mouseup events to compute the pointer travel and
        // set `suppressClick` when it exceeds a small threshold, so
        // dragging a node (or dragging an edge's endpoint) never
        // accidentally triggers navigation. Pure clicks still fire.
        if (chart) {
            var pressX = 0, pressY = 0, suppressClick = false;
            var zr = chart.getZr && chart.getZr();
            if (zr) {
                zr.on('mousedown', function (e) {
                    pressX = e.offsetX;
                    pressY = e.offsetY;
                    suppressClick = false;
                });
                zr.on('mouseup', function (e) {
                    var dx = Math.abs(e.offsetX - pressX);
                    var dy = Math.abs(e.offsetY - pressY);
                    if (dx > 4 || dy > 4) suppressClick = true;
                });
            }
            chart.on('click', function (params) {
                if (suppressClick) return;
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
