/**
 * IWAC Visualizations — Block bootstrapping
 *
 * Part of the `IWACVis.panels` namespace, split out of the ~1,000-line
 * panels.js in v1.23.0 along its own section boundaries — the same split the
 * chart-options family already uses. Each part extends the same `P` object,
 * so load order among them does not matter; only that panels.js itself loads
 * first (it creates the namespace) and that all of them load before any block
 * controller.
 *
 * The per-item dashboard boot helper and the shared force-graph panel
 * chrome (toolbar + click-through) that graph panels hand off to.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels = ns.panels || {};

    /* ----------------------------------------------------------------- */
    /*  Page-block boot                                                   */
    /* ----------------------------------------------------------------- */

    /** Where every precomputed bundle lives, under the site base path. */
    P.DATA_BASE = '/files/iwac-visualizations/';

    /**
     * Boot a page block: wait for the DOM (and ECharts), find every matching
     * container, read its data-* attributes, fetch the block's bundle, hand it
     * to `render`, and show the shared error banner when the fetch fails.
     *
     * The page-block twin of `bootPerItemDashboard` below. Every orchestrator
     * hand-rolled the same ~25-line epilogue — echarts guard, querySelectorAll
     * loop, ctx from the dataset, `fetchJSON(basePath +
     * '/files/iwac-visualizations/…')`, `.catch` → console.error + clear +
     * `buildFetchErrorState`, then the readyState two-branch boot — which is
     * also why the data directory was spelled out in 25 separate files.
     *
     * @param {Object} opts
     * @param {string} opts.selector   Container selector, e.g. '.iwac-vis-ngram'.
     * @param {string} [opts.warnLabel='IWACVis block']  console prefix.
     * @param {boolean} [opts.requireECharts=true]  Skip (with a warning) when
     *                                  ECharts is absent. Map-only blocks pass false.
     * @param {string} [opts.dataFile]  Bundle name under files/iwac-visualizations/.
     *                                  Mutually exclusive with `load`.
     * @param {function(HTMLElement, Object):void} [opts.beforeLoad]  Runs against
     *                                  the container before the fetch starts — for
     *                                  blocks that adjust their spinner copy while
     *                                  loading.
     * @param {function(Object):Promise} [opts.load]  Custom loader for blocks that
     *                                  need several bundles or a chained fetch.
     *                                  Receives ctx, returns a promise of whatever
     *                                  `render` expects.
     * @param {function(HTMLElement, *, Object):void} opts.render  (container, data, ctx)
     * @param {'banner'|'remove'|function} [opts.onError='banner']
     *                                  'banner'  → clear the container, show the
     *                                              shared fetch-error state;
     *                                  'remove'  → delete the block outright (the
     *                                              engagement-hook contract: On This
     *                                              Day must never render an error);
     *                                  function  → (container, err, ctx), full control.
     * @param {boolean} [opts.clearOnError=true]  Whether 'banner' empties the
     *                                  container first. False keeps server-rendered
     *                                  content (e.g. a prerendered summary) in place.
     */
    P.bootBlock = function (opts) {
        var label = opts.warnLabel || 'IWACVis block';

        function handleError(container, err, ctx, retry) {
            if (typeof opts.onError === 'function') {
                opts.onError(container, err, ctx);
                return;
            }
            if (opts.onError === 'remove') {
                P.removeBlock(container);
                return;
            }
            console.error(label + ':', err);
            if (opts.clearOnError !== false) container.innerHTML = '';
            container.appendChild(P.buildFetchErrorState(err, null, retry));
        }

        function initOne(container) {
            var basePath = container.dataset.basePath || '';
            var ctx = {
                container: container,
                basePath: basePath,
                siteBase: container.dataset.siteBase || '',
                dataBase: basePath + P.DATA_BASE
            };
            // One attempt, spinner included — also the retry button's whole
            // job. A custom `load` owns its own fetch and may not be
            // re-runnable, so only the built-in path offers the control.
            function attempt(withSpinner) {
                var loading;
                try {
                    if (withSpinner) {
                        container.innerHTML = '';
                        container.appendChild(P.buildLoadingState());
                    }
                    if (opts.beforeLoad) opts.beforeLoad(container, ctx);
                    loading = opts.load
                        ? opts.load(ctx)
                        : P.fetchJSON(ctx.dataBase + opts.dataFile,
                            { timeoutMs: P.FETCH_TIMEOUT_MS });
                } catch (err) {
                    handleError(container, err, ctx, opts.load ? null : retry);
                    return;
                }
                Promise.resolve(loading)
                    .then(function (data) { opts.render(container, data, ctx); })
                    .catch(function (err) {
                        handleError(container, err, ctx, opts.load ? null : retry);
                    });
            }
            function retry() { attempt(true); }
            attempt(false);
        }

        function run() {
            if (opts.requireECharts !== false && typeof echarts === 'undefined') {
                console.warn(label + ': ECharts not loaded');
                return;
            }
            var containers = document.querySelectorAll(opts.selector);
            for (var i = 0; i < containers.length; i++) initOne(containers[i]);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    };

    /**
     * Remove a block from the page entirely, heading included.
     *
     * The contract for blocks that are safe to place on a homepage: when their
     * data is absent they leave no trace rather than rendering an error banner
     * (On This Day before the first data sync; Item Set Dashboard on an item set
     * with no matching corpus). Both hand-rolled this; it also backs
     * `bootBlock`'s `onError: 'remove'`.
     *
     * Climbs to the `.iwac-vis-block` wrapper so the heading goes with it; falls
     * back to emptying the container when there is no wrapper to find.
     */
    P.removeBlock = function (container) {
        var block = container.closest ? container.closest('.iwac-vis-block') : null;
        if (block && block.parentNode) {
            block.parentNode.removeChild(block);
        } else {
            container.innerHTML = '';
        }
    };

    /* ----------------------------------------------------------------- */
    /*  Per-item resource-page dashboard boot                             */
    /* ----------------------------------------------------------------- */

    /**
     * Boot a per-item resource-page dashboard (person / entity / article /
     * publication / reference / minimal item).
     *
     * Collapses the identical scaffold the per-item orchestrators used to
     * hand-roll: wait for ECharts + the DOM, find every matching container,
     * read its data-* attributes, fetch the item's JSON, swap the loading
     * spinner for an `<classToken>__body` wrapper, optionally mount a header
     * (stats / facet / metric cards) above the grid, then dispatch the panel
     * grid through `IWACVis.dashboardLayout.render(body, layout, slices,
     * ctx)`. On fetch failure it shows the shared error banner with a retry
     * control — or, for blocks whose bundle legitimately may not exist,
     * removes the block outright.
     *
     * Call once at module load (it wires its own DOMContentLoaded).
     *
     * @param {Object} opts
     * @param {string} opts.selector    Container selector, e.g. '.iwac-vis-person'.
     * @param {string} opts.classToken  BEM token for the loading + body classes,
     *                                   e.g. 'person' → '.iwac-vis-person__loading'
     *                                   / 'iwac-vis-person__body'.
     * @param {string} [opts.dataDir]   Fan-out directory under files/iwac-visualizations/:
     *                                   the bundle is `<dataDir>/<itemId>.json`.
     * @param {string} [opts.dataFile]  One shared bundle instead of a fan-out (the
     *                                   minimal-item block reads the whole template
     *                                   summary and scopes it in `slices`). Containers
     *                                   need no data-item-id then.
     * @param {string} opts.layout      Registered dashboardLayout key.
     * @param {string} [opts.warnLabel] console prefix for warnings / errors.
     * @param {boolean} [opts.requireECharts=true]  Skip (with a warning) when
     *                                   ECharts is absent. A dashboard whose
     *                                   layout holds no ECharts renderer — the
     *                                   sparkline-and-cards ones — passes false
     *                                   and renders regardless, as it always did.
     * @param {'banner'|'remove'} [opts.onError='banner']  'remove' deletes the
     *                                   block, heading included, on failure — the
     *                                   contract for dashboards whose bundle is
     *                                   normally absent (a reference the generator
     *                                   has not covered).
     * @param {function(HTMLElement, Object):boolean} [opts.skip]  True → drop the
     *                                   spinner and render nothing: the markup
     *                                   already says there is nothing to show.
     * @param {function():Object} [opts.makeFacet]  Build the facet object placed on
     *                                   ctx.facet (defaults to a no-op facet).
     * @param {function(Object, Object):(Object|null)} [opts.slices]  Shape the
     *                                   fetched bundle into the object the layout's
     *                                   slots read (defaults to the bundle itself).
     *                                   Return null for "this bundle carries nothing
     *                                   for this item" → the shared empty state.
     * @param {function(body, data, ctx):void} [opts.mountHeader]  Optional hook to
     *                                   mount stats / facet markup above the grid;
     *                                   runs after ctx.facet and ctx.slices are set.
     */
    P.bootPerItemDashboard = function (opts) {
        var DL = ns.dashboardLayout;
        var label = opts.warnLabel || 'IWACVis dashboard';
        if (!DL) {
            console.warn(label + ': dashboardLayout not loaded');
            return;
        }

        function noopFacet() {
            return { role: 'all', subscribe: function () {}, set: function () {} };
        }

        function initOne(container) {
            var itemId = container.dataset.itemId;
            if (!itemId && !opts.dataFile) return;

            var ctx = {
                container: container,
                basePath:  container.dataset.basePath || '',
                siteBase:  container.dataset.siteBase || '',
                itemId:    itemId
            };
            var url = ctx.basePath + P.DATA_BASE
                + (opts.dataFile ? opts.dataFile : opts.dataDir + '/' + itemId + '.json');
            var loadingSel = '.iwac-vis-' + opts.classToken + '__loading';

            // Bounded (fetchJSON's default timeout), and re-attemptable. The
            // dashboards mount on view, so a stalled fetch used to leave the
            // reader looking at a spinner that had already been scrolled to
            // and would never resolve — the same failure On This Day fixed
            // for itself in v1.49.0, still live on every person, entity and
            // article page.
            // `state` is whichever spinner-or-banner currently stands in for
            // the dashboard, so a retry replaces exactly that node and nothing
            // else in the container — the article block also carries a
            // server-rendered sentiment panel here.
            var state = container.querySelector(loadingSel);
            function swapState(el) {
                if (state && state.parentNode) state.parentNode.replaceChild(el, state);
                else container.appendChild(el);
                state = el;
            }
            function dropState() {
                if (state && state.parentNode) state.parentNode.removeChild(state);
                state = null;
            }

            if (typeof opts.skip === 'function' && opts.skip(container, ctx)) {
                dropState();
                return;
            }

            function fail(err) {
                if (opts.onError === 'remove') {
                    console.warn(label + ':', err);
                    P.removeBlock(container);
                    return;
                }
                console.error(label + ':', err);
                swapState(P.buildFetchErrorState(err, null, function () {
                    swapState(P.buildLoadingState());
                    attempt();
                }));
            }

            function attempt() {
                P.fetchJSON(url)
                    .then(function (data) {
                        dropState();

                        ctx.data  = data;
                        ctx.facet = (opts.makeFacet && opts.makeFacet()) || noopFacet();
                        var slices = typeof opts.slices === 'function'
                            ? opts.slices(data, ctx)
                            : data;
                        if (slices == null) {
                            container.appendChild(P.buildEmptyState());
                            return;
                        }
                        ctx.slices = slices;

                        var body = P.el('div', 'iwac-vis-' + opts.classToken + '__body');
                        container.appendChild(body);
                        if (opts.mountHeader) opts.mountHeader(body, data, ctx);

                        DL.render(body, opts.layout, slices, ctx);
                    })
                    .catch(fail);
            }
            attempt();
        }

        function run() {
            if (opts.requireECharts !== false && typeof echarts === 'undefined') {
                console.warn(label + ': ECharts not loaded');
                return;
            }
            var containers = document.querySelectorAll(opts.selector);
            for (var i = 0; i < containers.length; i++) initOne(containers[i]);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    };

    /* ----------------------------------------------------------------- */
    /*  Force-graph panel chrome (toolbar + click-through)                */
    /* ----------------------------------------------------------------- */

    /**
     * Build the shared 6-button toolbar for a force-graph panel (zoom in /
     * out / reset / legend toggle / PNG download / fullscreen) and append
     * it to `panelEl.chart`. Owns the legend-visibility state so the panel's
     * `buildFullOption` can read it back via the returned `isLegendVisible()`.
     *
     * Buttons compose `.iwac-vis-btn .iwac-vis-graph-toolbar__btn` so they
     * inherit the shared border/background/focus tokens (no hex literals).
     * Legend + fullscreen use merge-mode `setOption` so the force layout
     * never restarts.
     *
     * @param {{panel: HTMLElement, chart: HTMLElement}} panelEl
     * @param {ECharts} chart  the registered chart instance
     * @param {Object} [opts]
     * @param {string} [opts.downloadName='iwac-chart.png']  PNG filename
     * @param {boolean} [opts.legendToggle=true]  pass false for graphs
     *   without a legend (the button would only shift the series bounds)
     * @returns {{el: HTMLElement, isLegendVisible: function():boolean}}
     */
    P.buildGraphPanelToolbar = function (panelEl, chart, opts) {
        opts = opts || {};
        var ZOOM = 1.4;
        var legendVisible = true;
        var isFullscreen = false;

        // graphRoam silently no-ops unless the dispatch carries pixel
        // originX/originY — always anchor on the chart's geometric centre.
        function dispatchZoom(factor) {
            chart.dispatchAction({
                type: 'graphRoam',
                zoom: factor,
                originX: chart.getWidth() / 2,
                originY: chart.getHeight() / 2
            });
        }
        function btn(label, title, onClick) {
            var b = P.el('button', 'iwac-vis-btn iwac-vis-graph-toolbar__btn', label);
            b.type = 'button';
            b.setAttribute('aria-label', title);
            b.title = title;
            b.addEventListener('click', onClick);
            return b;
        }

        var bar = P.el('div', 'iwac-vis-graph-toolbar');

        bar.appendChild(btn('+', P.t('Zoom in'), function () {
            if (!chart.isDisposed()) dispatchZoom(ZOOM);
        }));
        bar.appendChild(btn('−', P.t('Zoom out'), function () {
            if (!chart.isDisposed()) dispatchZoom(1 / ZOOM);
        }));
        bar.appendChild(btn('↺', P.t('Reset view'), function () {
            if (!chart.isDisposed()) chart.dispatchAction({ type: 'restore' });
        }));

        if (opts.legendToggle !== false) {
            var legendBtn = btn('▤', P.t('Toggle legend'), function () {
                if (chart.isDisposed()) return;
                legendVisible = !legendVisible;
                chart.setOption({
                    legend: [{ show: legendVisible }],
                    series: [{ bottom: legendVisible ? 56 : 16 }]
                });
                legendBtn.classList.toggle('iwac-vis-graph-toolbar__btn--pressed', !legendVisible);
            });
            bar.appendChild(legendBtn);
        }

        // Look the live instance up through ns.getLiveChart so we never
        // call getDataURL on an instance disposed by a panel teardown.
        bar.appendChild(btn('⭳', P.t('Download chart'), function () {
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
            a.download = opts.downloadName || 'iwac-chart.png';
            a.href = dataUrl;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }));

        var fullBtn = btn('⛶', P.t('Toggle fullscreen'), function () {
            var host = panelEl.panel;
            if (!host) return;
            if (!document.fullscreenElement) {
                if (host.requestFullscreen) host.requestFullscreen();
            } else if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        });
        bar.appendChild(fullBtn);

        // Self-cleaning (same rule as panel-toolbar.js): once the panel has
        // left the document the listener removes itself rather than holding
        // a detached panel and a disposed chart for the life of the page.
        var onFullscreenChange = function () {
            var host = panelEl.panel;
            if (!host || !document.body.contains(host)) {
                document.removeEventListener('fullscreenchange', onFullscreenChange);
                return;
            }
            isFullscreen = (document.fullscreenElement === host);
            host.classList.toggle('iwac-vis-panel--fullscreen', isFullscreen);
            fullBtn.classList.toggle('iwac-vis-graph-toolbar__btn--pressed', isFullscreen);
            // Give the browser a frame to apply the new size.
            setTimeout(function () { if (!chart.isDisposed()) chart.resize(); }, 50);
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);

        panelEl.chart.appendChild(bar);

        return { el: bar, isLegendVisible: function () { return legendVisible; } };
    };

    /**
     * Wire click-to-navigate on a force-graph, suppressing the synthetic
     * `click` ECharts fires at mouseup after a node drag. Watches zrender
     * mousedown/mouseup: a pointer travel > 4px marks the gesture a drag,
     * so positioning a node never navigates away. Pure clicks on a node
     * invoke `onNode(nodeData, params)`; the caller decides routing (and
     * any centre-node guard).
     *
     * @param {ECharts} chart
     * @param {function(Object, Object):void} onNode
     */
    P.attachGraphClickThrough = function (chart, onNode) {
        var pressX = 0, pressY = 0, suppressClick = false;
        var zr = chart.getZr && chart.getZr();
        if (zr) {
            zr.on('mousedown', function (e) {
                pressX = e.offsetX;
                pressY = e.offsetY;
                suppressClick = false;
            });
            zr.on('mouseup', function (e) {
                if (Math.abs(e.offsetX - pressX) > 4 || Math.abs(e.offsetY - pressY) > 4) {
                    suppressClick = true;
                }
            });
        }
        chart.on('click', function (params) {
            if (suppressClick) return;
            if (params.dataType !== 'node') return;
            onNode(params.data || {}, params);
        });
    };
})();
