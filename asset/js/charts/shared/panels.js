/**
 * IWAC Visualizations — Shared panel helpers
 *
 * DOM + layout primitives reused by every block controller (collection
 * overview, references overview, future per-template blocks).
 *
 * Everything is hung off `window.IWACVis.panels` so the block controllers
 * can compose layouts without re-implementing the small stuff.
 *
 * Dependencies: iwac-i18n.js (for IWACVis.t / formatNumber), dashboard-core.js
 * Load order: after iwac-i18n.js + iwac-theme.js + dashboard-core.js,
 *             before any block controller that calls P.*.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels = ns.panels || {};

    /* ----------------------------------------------------------------- */
    /*  DOM helpers                                                       */
    /* ----------------------------------------------------------------- */

    /** Create an element with optional class name + text content. */
    P.el = function (tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };

    /** Escape characters that are unsafe for HTML interpolation. */
    P.escapeHtml = function (str) {
        return String(str).replace(/[&<>"']/g, function (c) {
            return ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[c];
        });
    };

    /**
     * Defensive filter for "Unknown" values. The Python generator already
     * skips empty / unknown countries, but the JSON could be stale and the
     * live-fetched references subset can still produce them, so every
     * chart builder calls this before rendering.
     */
    P.isUnknown = function (value) {
        if (value == null) return true;
        var s = String(value).trim().toLowerCase();
        return s === '' || s === 'unknown';
    };

    /* ----------------------------------------------------------------- */
    /*  JSON fetch                                                        */
    /* ----------------------------------------------------------------- */

    /**
     * Shared JSON fetch for module data files — the single fetch path
     * every orchestrator / panel should use instead of bare fetch().
     *
     * - Appends `?v=<asset version>` (module version + last data-sync stamp,
     *   resolved by dashboard-core.js) so data served from
     *   files/iwac-visualizations/ busts browser caches whenever the module
     *   updates OR a fresh data pull lands (issue #7).
     * - Sends same-origin credentials and a JSON Accept header.
     * - Rejects on non-2xx with the URL in the error message.
     *
     * @param {string} url
     * @param {Object} [opts]  Extra fetch options merged over the defaults.
     * @returns {Promise<any>} parsed JSON body
     */
    P.fetchJSON = function (url, opts) {
        var u = url;
        if (ns.assetVersion && !/[?&]v=/.test(u)) {
            u += (u.indexOf('?') === -1 ? '?' : '&')
                + 'v=' + encodeURIComponent(ns.assetVersion);
        }
        var init = {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
        };
        if (opts) {
            for (var k in opts) {
                if (Object.prototype.hasOwnProperty.call(opts, k)) init[k] = opts[k];
            }
        }
        return fetch(u, init).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + u);
            return r.json();
        });
    };

    /* ----------------------------------------------------------------- */
    /*  i18n + number formatting shortcuts                                */
    /* ----------------------------------------------------------------- */

    P.t = function (key, params) { return ns.t(key, params); };

    P.formatNumber = function (n) {
        return ns.formatNumber ? ns.formatNumber(n) : String(n);
    };

    /**
     * Locale-aware date formatter used by every popup / table cell that
     * displays a publication date. Accepts an ISO-8601 string or anything
     * Date can parse; returns a localized medium-style date. On parse
     * failure it gracefully falls back to the first ten characters of
     * the input (the ISO date slice), so bad data never leaks through as
     * "Invalid Date".
     */
    P.formatDate = function (value, opts) {
        if (!value) return '';
        var str = String(value).slice(0, 10);
        var d = new Date(str);
        // Unparseable input (e.g. the publications subset's range dates
        // like "2009-05/2009-08") passes through verbatim — slicing it
        // to 10 chars would cut mid-range ("2009-05/20").
        if (isNaN(d.getTime())) return String(value);
        try {
            return d.toLocaleDateString(
                ns.locale === 'fr' ? 'fr-FR' : 'en-US',
                opts || { year: 'numeric', month: 'short', day: 'numeric' }
            );
        } catch (e) {
            return str;
        }
    };

    /**
     * Translate a raw (French-source) label via a prefixed i18n key,
     * falling back to the raw value when no translation exists. Centralizes
     * the pattern used for reference types (`ref_type_<name>`), language
     * names (`lang_<name>`), etc. — the precomputed JSON ships the French
     * label and the JS localizes it per active site language.
     */
    P.translateKeyed = function (prefix, name) {
        var key = prefix + name;
        var translated = P.t(key);
        return translated === key ? name : translated;
    };

    /* ----------------------------------------------------------------- */
    /*  Status banners (loading / empty / error)                          */
    /* ----------------------------------------------------------------- */

    /** Spinner + translated message. Default key "Loading". */
    P.buildLoadingState = function (messageKey) {
        var el = P.el('div', 'iwac-vis-loading');
        el.appendChild(P.el('div', 'iwac-vis-spinner'));
        el.appendChild(P.el('span', null, P.t(messageKey || 'Loading')));
        return el;
    };

    /** Empty-state banner. Default key "No data available". */
    P.buildEmptyState = function (messageKey) {
        return P.el('div', 'iwac-vis-empty', P.t(messageKey || 'No data available'));
    };

    /** Error banner. Default key "Failed to load". */
    P.buildErrorState = function (messageKey) {
        return P.el('div', 'iwac-vis-error', P.t(messageKey || 'Failed to load'));
    };

    /**
     * "No data yet" banner — distinct from buildEmptyState (an empty slice of
     * an otherwise-loaded dataset). This one means the data file itself has not
     * been published into files/iwac-visualizations/ yet, e.g. before the first
     * "Pull latest data" sync (issue #7). Reuses the empty-state styling.
     */
    P.buildNoDataState = function (messageKey) {
        return P.el('div', 'iwac-vis-empty iwac-vis-nodata',
            P.t(messageKey || 'Visualization data is not available yet.'));
    };

    /**
     * Pick the right banner for a failed P.fetchJSON. A 404 means the data tree
     * has not been delivered into files/ yet → a graceful "no data yet" state;
     * any other failure is a real error. Drop-in for buildErrorState() inside a
     * fetch `.catch(function (err) { … })` — just pass the caught error.
     */
    P.buildFetchErrorState = function (err, messageKey) {
        var msg = err && err.message ? String(err.message) : '';
        return /\bHTTP 404\b/.test(msg)
            ? P.buildNoDataState()
            : P.buildErrorState(messageKey);
    };

    /**
     * ECharts option fragment overlaying a centered "no data" message —
     * for chart panels that `setOption` a placeholder when their slice is
     * empty (so the chart host keeps its reserved height instead of
     * collapsing). Pass a custom i18n key (e.g. 'Not rated') or default to
     * "No data available".
     */
    P.emptyChartOption = function (messageKey) {
        return {
            title: {
                text: P.t(messageKey || 'No data available'),
                left: 'center', top: 'middle',
                textStyle: { fontSize: 13, fontWeight: 'normal' }
            }
        };
    };

    /* ----------------------------------------------------------------- */
    /*  GeoJSON feature builder for count-sized bubble maps               */
    /* ----------------------------------------------------------------- */

    /**
     * Build a GeoJSON FeatureCollection from a list of records that each
     * carry lng/lat and a count-like numeric property. Returns both the
     * feature collection and the max count across surviving features, so
     * callers can drive a single `interpolate` expression in their
     * MapLibre paint spec without re-scanning the data.
     *
     * @param {Array<Object>} items   Records with lng, lat, and countKey
     * @param {Object} [opts]
     * @param {string} [opts.countKey='count']  Property holding the size metric
     * @param {number} [opts.minCount=1]  Items below this are dropped (strict <)
     * @param {function(item, idx):Object} [opts.toProps]
     *   Builds the feature `properties` object. Defaults to `{ [countKey]: count }`.
     *   Receives the original item and its (pre-filter) index so callers can
     *   stash an index lookup back into a richer source array.
     * @returns {{ max: number, collection: GeoJSON.FeatureCollection }}
     */
    /* ----------------------------------------------------------------- */
    /*  MapLibre feature-state hover wiring                               */
    /* ----------------------------------------------------------------- */

    /**
     * Wire up `feature-state`-driven hover highlights for one or more
     * MapLibre layers. The modern idiom: instead of swapping the CSS
     * cursor only, we track which feature is under the cursor and flip
     * its `hover` feature state. Paint expressions that reference
     * `['case', ['boolean', ['feature-state', 'hover'], false], <hover>, <normal>]`
     * then render a real visual change (brighter opacity, thicker
     * stroke, etc.) — all on the GPU, zero JS work per frame.
     *
     * Call this ONCE per map instance, outside `onStyleReady()`, so
     * handlers don't stack on every theme swap. The hover state
     * naturally resets on each style reload because new sources
     * generate fresh ids.
     *
     * Prerequisite: each passed source must be created with
     * `{type: 'geojson', generateId: true, ...}` so MapLibre has a
     * stable feature identity to key the state on.
     *
     * @param {maplibregl.Map} map
     * @param {Array<{layer: string, source: string}>|{layer: string, source: string}} layers
     *   One or more (layer, source) pairs to track. Pass a single object
     *   for the common single-layer case, or an array for multi-layer
     *   maps where the topmost hovered feature wins.
     * @returns {function()} detach — call to remove listeners + clear state
     */
    P.attachFeatureStateHover = function (map, layers) {
        if (!map) return function () {};
        var items = Array.isArray(layers) ? layers : [layers];
        var hovered = null; // { source, id }

        function clearHover() {
            if (hovered) {
                map.setFeatureState(
                    { source: hovered.source, id: hovered.id },
                    { hover: false }
                );
                hovered = null;
            }
        }

        function onMove(e) {
            // Filter to layers that are actually on the map right now
            // so theme swaps (which temporarily wipe custom layers)
            // don't throw on query.
            var active = items.filter(function (it) { return map.getLayer(it.layer); });
            if (active.length === 0) {
                clearHover();
                map.getCanvas().style.cursor = '';
                return;
            }
            var layerIds = active.map(function (it) { return it.layer; });
            var features = map.queryRenderedFeatures(e.point, { layers: layerIds });
            if (features.length === 0) {
                clearHover();
                map.getCanvas().style.cursor = '';
                return;
            }
            map.getCanvas().style.cursor = 'pointer';

            var f = features[0];
            if (f.id == null) return; // source missing generateId:true
            // Resolve source via the layer the hit came from.
            var src = null;
            for (var i = 0; i < active.length; i++) {
                if (f.layer && f.layer.id === active[i].layer) {
                    src = active[i].source;
                    break;
                }
            }
            if (!src) return;
            if (hovered && hovered.source === src && hovered.id === f.id) return;

            clearHover();
            hovered = { source: src, id: f.id };
            map.setFeatureState(
                { source: src, id: f.id },
                { hover: true }
            );
        }

        function onLeave() {
            clearHover();
            map.getCanvas().style.cursor = '';
        }

        map.on('mousemove', onMove);
        map.on('mouseleave', onLeave);

        return function detach() {
            clearHover();
            map.off('mousemove', onMove);
            map.off('mouseleave', onLeave);
        };
    };

    P.buildCountFeatures = function (items, opts) {
        opts = opts || {};
        var countKey = opts.countKey || 'count';
        var minCount = opts.minCount != null ? opts.minCount : 1;
        var toProps = opts.toProps;
        var max = 1;
        var features = [];
        (items || []).forEach(function (item, idx) {
            var c = Number(item[countKey] || 0);
            if (c < minCount) return;
            if (c > max) max = c;
            var props;
            if (toProps) {
                props = toProps(item, idx);
            } else {
                props = {};
                props[countKey] = c;
            }
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
                properties: props
            });
        });
        return {
            max: max,
            collection: { type: 'FeatureCollection', features: features }
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Layout primitives                                                 */
    /* ----------------------------------------------------------------- */

    /**
     * Build a `.iwac-vis-panel` wrapper with an `<h4>` title, an
     * optional description paragraph, and a `.iwac-vis-chart` child
     * that the controller can pass to `IWACVis.registerChart`.
     *
     * @param {string} className e.g. "iwac-vis-panel" or "iwac-vis-panel iwac-vis-panel--wide"
     * @param {string} titleText already-translated title
     * @param {string} [descriptionText] already-translated description shown below the title
     * @returns {{panel: HTMLElement, chart: HTMLElement}}
     */
    P.buildPanel = function (className, titleText, descriptionText) {
        var panel = P.el('div', className);
        panel.appendChild(P.el('h4', null, titleText));
        if (descriptionText) {
            panel.appendChild(P.el('p', 'iwac-vis-panel-desc', descriptionText));
        }
        var chart = P.el('div', 'iwac-vis-chart');
        panel.appendChild(chart);
        return { panel: panel, chart: chart };
    };

    /**
     * Build the row of summary stat cards at the top of an overview block.
     *
     * Pass `featured: true` on a card to render it with the masthead
     * treatment (`iwac-vis-summary-card--featured`) — used for a single
     * headline stat such as "Total items" on the collection overview.
     *
     * @param {Array<{value:number|null, labelKey:string, featured?:boolean}>} cards
     * @returns {HTMLElement}
     */
    P.buildSummaryCards = function (cards) {
        var cardsEl = P.el('div', 'iwac-vis-overview-summary');
        cards.forEach(function (c) {
            if (c == null || c.value == null) return;
            var cls = 'iwac-vis-summary-card';
            if (c.featured) cls += ' iwac-vis-summary-card--featured';
            var card = P.el('div', cls);
            card.appendChild(P.el('div', 'iwac-vis-summary-card__label', P.t(c.labelKey)));
            card.appendChild(P.el('div', 'iwac-vis-summary-card__value', P.formatNumber(c.value)));
            cardsEl.appendChild(card);
        });
        return cardsEl;
    };

    /**
     * Build a "Period covered: YYYY – YYYY" subtitle paragraph. Returns
     * null when min/max are missing so the controller can just skip
     * appending it.
     */
    P.buildPeriodSubtitle = function (yearMin, yearMax) {
        if (!yearMin || !yearMax) return null;
        var p = P.el('p', 'iwac-vis-overview-subtitle');
        p.textContent = P.t('period_covered', { min: yearMin, max: yearMax });
        return p;
    };

    /**
     * Build an empty `.iwac-vis-overview-grid` that children can be
     * appended into. The CSS handles responsive columns and `--wide`
     * full-width panels.
     */
    P.buildChartsGrid = function () {
        return P.el('div', 'iwac-vis-overview-grid');
    };

    /* ----------------------------------------------------------------- */
    /*  Per-item resource-page dashboard boot                             */
    /* ----------------------------------------------------------------- */

    /**
     * Boot a per-item resource-page dashboard (person / entity / article).
     *
     * Collapses the identical scaffold the three per-item orchestrators
     * used to hand-roll: wait for ECharts + the DOM, find every matching
     * container, read its data-* attributes, fetch the per-item JSON, swap
     * the loading spinner for an `<classToken>__body` wrapper, optionally
     * mount a header (stats / facet) above the grid, then dispatch the
     * panel grid through `IWACVis.dashboardLayout.render(body, layout, data,
     * ctx)`. On fetch failure it removes the spinner and shows the shared
     * error banner.
     *
     * Call once at module load (it wires its own DOMContentLoaded).
     *
     * @param {Object} opts
     * @param {string} opts.selector    Container selector, e.g. '.iwac-vis-person'.
     * @param {string} opts.classToken  BEM token for the loading + body classes,
     *                                   e.g. 'person' → '.iwac-vis-person__loading'
     *                                   / 'iwac-vis-person__body'.
     * @param {string} opts.dataDir     asset/data subdirectory, e.g. 'person-dashboards'.
     * @param {string} opts.layout      Registered dashboardLayout key.
     * @param {string} [opts.warnLabel] console prefix for warnings / errors.
     * @param {function():Object} [opts.makeFacet]  Build the facet object placed on
     *                                   ctx.facet (defaults to a no-op facet).
     * @param {function(body, data, ctx):void} [opts.mountHeader]  Optional hook to
     *                                   mount stats / facet markup above the grid;
     *                                   runs after ctx.facet is set.
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
            if (!itemId) return;

            var ctx = {
                basePath: container.dataset.basePath || '',
                siteBase: container.dataset.siteBase || '',
                itemId:   itemId
            };
            var url = ctx.basePath + '/files/iwac-visualizations/'
                + opts.dataDir + '/' + itemId + '.json';
            var loadingSel = '.iwac-vis-' + opts.classToken + '__loading';

            P.fetchJSON(url)
                .then(function (data) {
                    var loading = container.querySelector(loadingSel);
                    if (loading) loading.remove();

                    var body = P.el('div', 'iwac-vis-' + opts.classToken + '__body');
                    container.appendChild(body);

                    ctx.data  = data;
                    ctx.facet = (opts.makeFacet && opts.makeFacet()) || noopFacet();
                    if (opts.mountHeader) opts.mountHeader(body, data, ctx);

                    DL.render(body, opts.layout, data, ctx);
                })
                .catch(function (err) {
                    console.error(label + ':', err);
                    var loading = container.querySelector(loadingSel);
                    if (loading) loading.remove();
                    container.appendChild(P.buildFetchErrorState(err));
                });
        }

        function run() {
            if (typeof echarts === 'undefined') {
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

        // Look the live instance up through ns.getLiveChart so we never
        // call getDataURL on an instance disposed by a theme swap.
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

        document.addEventListener('fullscreenchange', function () {
            var host = panelEl.panel;
            if (!host) return;
            isFullscreen = (document.fullscreenElement === host);
            host.classList.toggle('iwac-vis-panel--fullscreen', isFullscreen);
            fullBtn.classList.toggle('iwac-vis-graph-toolbar__btn--pressed', isFullscreen);
            // Give the browser a frame to apply the new size.
            setTimeout(function () { if (!chart.isDisposed()) chart.resize(); }, 50);
        });

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
