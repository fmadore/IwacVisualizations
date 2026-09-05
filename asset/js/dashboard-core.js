/**
 * IWAC Visualizations — Dashboard core
 *
 * Bootstraps the `window.IWACVis` namespace, wires chart initialization
 * through the IWAC ECharts theme (iwac-theme.js) and i18n helper
 * (iwac-i18n.js), and watches `body[data-theme]` so that ECharts and
 * MapLibre instances re-render when the user toggles light/dark mode.
 *
 * Load order (set by view/common/iwac-assets.phtml, which builds the ordered
 * script list every block's on-view lazy loader injects):
 *   1. https://cdn.jsdelivr.net/npm/echarts@6/...
 *   2. asset/js/iwac-i18n.js     (no deps)
 *   3. asset/js/iwac-theme.js    (needs echarts)
 *   4. asset/js/dashboard-core.js (this file — needs all of the above)
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};

    // Cache-buster appended by P.fetchJSON (shared/panels.js) to every data
    // request. It combines two versions:
    //   1. the module version, parsed from this script's own `?v=` (Omeka's
    //      assetUrl appends `?v=<config/module.ini version>` to module assets);
    //   2. the data version — the last Sync Data time, stamped on every
    //      .iwac-vis-block as `data-version` by iwac-block-shell.phtml.
    // Data now lives in files/iwac-visualizations/ and is refreshed by the
    // admin Sync Data job WITHOUT a module bump (issue #7), so folding in the
    // data version is what busts stale data caches on a fresh pull. Either may
    // be absent (no `?v=`, or pre-first-sync) — we use whichever exist.
    // document.currentScript is set during execution of classic scripts,
    // including ones the on-view lazy loader injects async=false.
    (function () {
        var el = document.currentScript;
        var m = el && el.src ? /[?&]v=([^&#]+)/.exec(el.src) : null;
        var moduleV = m ? decodeURIComponent(m[1]) : '';
        var block = document.querySelector('.iwac-vis-block[data-version]');
        var dataV = block ? block.getAttribute('data-version') : '';
        ns.assetVersion = dataV
            ? (moduleV ? moduleV + '-' + dataV : dataV)
            : moduleV;
    })();

    function debounce(fn, ms) {
        var timer;
        return function () {
            if (timer) clearTimeout(timer);
            timer = setTimeout(fn, ms);
        };
    }

    // Ensure themes are registered even if iwac-theme.js loaded before ECharts.
    if (typeof ns.registerEChartsThemes === 'function') {
        ns.registerEChartsThemes();
    }

    /* ----------------------------------------------------------------- */
    /*  Chart tracking                                                    */
    /* ----------------------------------------------------------------- */

    /**
     * Each registered chart is an object of the form
     *   { el, render, instance, kind }
     * where `render(el, instance)` is called with a fresh instance after
     * theme changes. `kind` is 'echarts' | 'maplibre' — other types
     * can be added later.
     */
    ns._charts = [];

    /* ----------------------------------------------------------------- */
    /*  Text alternatives                                                 */
    /* ----------------------------------------------------------------- */

    function t(key, params) {
        return ns.t ? ns.t(key, params) : key;
    }

    /** The panel heading above a chart host, or '' when it stands alone. */
    function panelTitleFor(el) {
        var panel = el && el.closest ? el.closest('.iwac-vis-panel') : null;
        if (!panel) return '';
        // Direct children only: a heading rendered INSIDE the chart host
        // (the index overview's section labels) names a part, not the panel.
        for (var i = 0; i < panel.children.length; i++) {
            var node = panel.children[i];
            if (/^H[1-6]$/.test(node.tagName)) {
                return (node.textContent || '').trim();
            }
        }
        return '';
    }

    /** Normalise an option component ECharts accepts as either object or array. */
    function toArray(value) {
        if (value == null) return [];
        return Array.isArray(value) ? value : [value];
    }

    /**
     * A short, correct, localized description of what a chart shows.
     *
     * ECharts writes its own if you let it, and on this codebase that came out
     * at up to 2,506 characters — an auto-recitation of series names and data
     * points, cut off mid-list at "the first 10 items", carrying a literal
     * `NaN` on the two custom-series panels, and in ENGLISH on the French
     * site, where it was the only text alternative a screen-reader user got.
     * Setting `aria.label.description` replaces the whole generated string, so
     * what a reader hears is now the panel's own heading — already translated,
     * already the thing a sighted reader reads first — plus the shape of the
     * data and, where the chart is windowed, how to move the window.
     *
     * It reads the option the caller is ABOUT to set, not `getOption()`. The
     * previous version described the chart after the fact, which meant a deep
     * clone of the live option (series data included) plus a second, non-lazy
     * `setOption` for every render — four full update passes per registered
     * chart once the explicit re-apply was counted, and the five `lazyUpdate`
     * callers never got their deferred frame. The outgoing option carries the
     * same title, series and dataZoom; describing it before the native call
     * costs nothing.
     *
     * The counts are computed defensively and dropped entirely if anything is
     * not a plain array: announcing a wrong number is worse than announcing
     * none, and "NaN" is how the last version of this failed.
     */
    function describeOption(el, option) {
        var title = panelTitleFor(el);
        var titles = toArray(option && option.title);
        if (!title && titles[0]) {
            title = String(titles[0].text || '').trim();
        }
        if (!title) title = t('Chart');

        var series = toArray(option && option.series);
        var points = 0;
        var countable = series.length > 0;
        for (var i = 0; i < series.length; i++) {
            var d = series[i] && series[i].data;
            if (Array.isArray(d)) points += d.length;
            else { countable = false; break; }
        }

        var text;
        if (!countable || !isFinite(points) || points <= 0) {
            text = t('chart_aria_plain', { title: title });
        } else if (series.length === 1) {
            text = t('chart_aria_single', { title: title, points: points });
        } else {
            text = t('chart_aria_summary', {
                title: title, series: series.length, points: points
            });
        }

        if (hasZoom(option)) text += ' ' + t('chart_aria_zoom');
        return text;
    }

    /**
     * Does this option carry a dataZoom the keyboard handler can drive?
     * Presence is enough: a merged repaint through `ns.repaint` strips the
     * builder's `start`/`end` so the reader's window survives, and the live
     * model always reports finite bounds when the keys are pressed.
     */
    function hasZoom(option) {
        var dz = toArray(option && option.dataZoom);
        return dz.length > 0 && !!dz[0];
    }

    /** True when at least one series in an option carries a data array. */
    function seriesCarryData(series) {
        for (var i = 0; i < series.length; i++) {
            if (series[i] && Array.isArray(series[i].data)) return true;
        }
        return false;
    }

    /** Fold the description into an option's `aria` block, keeping any caller keys. */
    function ariaWith(existing, description) {
        var aria = existing && typeof existing === 'object' ? existing : {};
        aria.enabled = true;
        var label = aria.label && typeof aria.label === 'object' ? aria.label : {};
        label.enabled = true;
        label.description = description;
        aria.label = label;
        return aria;
    }

    /* ----------------------------------------------------------------- */
    /*  Keyboard reach                                                    */
    /* ----------------------------------------------------------------- */

    /**
     * Make a chart host reachable and, where it is windowed, operable.
     *
     * ECharts binds everything to the pointer: legend toggles, the dataZoom
     * slider, treemap drill, the one click-to-navigate handler. It offers no
     * keyboard layer at all, so every chart on the dashboards was
     * mouse-and-sight-only. Two things are recoverable without inventing a
     * widget: the host becomes focusable, which is what lets a screen reader
     * land on it and read the description above; and where a chart has a
     * dataZoom — the Gantt's 82 rows, the timelines' 60-odd years — the arrow
     * keys move that window, through `dispatchAction`, which is ECharts' own
     * supported entry point for exactly this.
     *
     * The listener is attached once per host, not per render: the render
     * callback re-runs on every theme swap, and a listener added there stacks
     * a duplicate each time.
     */
    /**
     * Describe a chart on EVERY `setOption`, not just the first — and do it
     * on the way IN, as part of the same update.
     *
     * Describing once after the render callback is not enough: a facet
     * change, a tab, a pagination step all call `setOption(option, true)`
     * straight on the instance, and ECharts — whose `aria.enabled` is on at
     * theme level — regenerates its own label from the new option. So
     * expanding the Gantt from 20 rows to 82 silently swapped a 108-character
     * localized description for a 2,500-character English recitation of the
     * first ten newspapers. Measured on the rig, not reasoned about.
     *
     * The description is folded into the outgoing option's `aria` block
     * before the native call, so one `setOption` stays one update pass and
     * the caller's `{ notMerge, lazyUpdate }` form passes through untouched.
     * A full rebuild (notMerge, or series carrying data) is re-described; a
     * partial merge that touches neither — a legend toggle, a layout nudge —
     * keeps the last description, which ECharts also keeps because a merge
     * leaves `aria` alone. Patching the instance is what makes this hold for
     * every caller without each one remembering.
     *
     * ECharts hangs its own label on a div INSIDE the host, which `role="img"`
     * prunes from the accessibility tree along with the rest of the subtree —
     * so the host carries the name itself or it is a focusable, unlabelled div.
     */
    function trackOptionChanges(instance, el) {
        if (!instance || instance._iwacAriaPatched) return;
        instance._iwacAriaPatched = true;
        var native = instance.setOption;
        instance.setOption = function (option, arg) {
            var description = null;
            if (option && typeof option === 'object') {
                try {
                    var base = option.baseOption || option;
                    var notMerge = arg === true
                        || !!(arg && typeof arg === 'object' && arg.notMerge);
                    var series = toArray(base.series);
                    if (notMerge || !instance._iwacAriaDescription || seriesCarryData(series)) {
                        description = describeOption(el, base);
                        instance._iwacAriaDescription = description;
                        // The same option is what "View as table" reads —
                        // kept by reference, never cloned, and only when it
                        // carries data (a legend nudge is not a repaint of
                        // the numbers).
                        instance._iwacLastOption = base;
                    } else {
                        description = instance._iwacAriaDescription;
                    }
                    base.aria = ariaWith(base.aria, description);
                } catch (e) { description = null; /* enhancement only — never let aria break a render */ }
            }
            var result = native.apply(instance, arguments);
            if (description && el && el.setAttribute) el.setAttribute('aria-label', description);
            notifyRepaint(el);
            return result;
        };
    }

    /**
     * Tell the panel its chart was repainted. The toolbar's open table
     * listens for this (it bubbles to the panel) and re-reads the option,
     * so a facet change under an open table changes the table too.
     */
    function notifyRepaint(el) {
        if (!el || typeof el.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
        try { el.dispatchEvent(new CustomEvent('iwac:repaint', { bubbles: true })); }
        catch (e) { /* enhancement only */ }
    }

    /**
     * The option a chart host was last painted with data — the one the
     * table and the CSV are built from. Null when the chart is gone or has
     * only ever shown an empty state.
     */
    ns.lastOption = function (el) {
        var live = ns.getLiveChart(el);
        return live && live._iwacLastOption ? live._iwacLastOption : null;
    };

    function makeChartFocusable(el) {
        if (!el || el._iwacKeyboard) return;
        el._iwacKeyboard = true;
        el.setAttribute('tabindex', '0');
        // ECharts writes aria-label on this same element from the description
        // above; role="img" is what makes an AT treat the pair as one labelled
        // graphic rather than an unlabelled focusable div.
        el.setAttribute('role', 'img');
        el.addEventListener('keydown', function (event) {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            var instance = ns.getLiveChart(el);
            if (!instance) return;
            var option;
            try { option = instance.getOption(); } catch (e) { return; }
            if (!hasZoom(option)) return;

            var start = Number(option.dataZoom[0].start);
            var end = Number(option.dataZoom[0].end);
            if (!isFinite(start)) start = 0;
            if (!isFinite(end)) end = 100;
            var span = Math.max(1, end - start);
            var step = Math.max(1, span / 4);
            var next;
            switch (event.key) {
                case 'ArrowRight': case 'ArrowDown': next = start + step; break;
                case 'ArrowLeft':  case 'ArrowUp':   next = start - step; break;
                case 'PageDown':                     next = start + span; break;
                case 'PageUp':                       next = start - span; break;
                case 'Home':                         next = 0; break;
                case 'End':                          next = 100 - span; break;
                default: return;
            }
            // preventDefault only once we know we are acting: an arrow key on
            // a chart with no window must still scroll the page.
            event.preventDefault();
            next = Math.max(0, Math.min(100 - span, next));
            instance.dispatchAction({ type: 'dataZoom', start: next, end: next + span });
        });
    }

    /**
     * Create an ECharts instance with the current IWAC theme applied.
     * Returns the ECharts instance. Caller is responsible for setOption().
     * Not normally called directly — prefer `ns.registerChart()`.
     */
    ns.initChart = function (el) {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis: ECharts not loaded');
            return null;
        }
        return echarts.init(el, ns.getChartTheme ? ns.getChartTheme() : null);
    };

    /**
     * Register a chart so it re-renders on theme change.
     *
     * @param {HTMLElement} el
     * @param {function(HTMLElement, echarts.ECharts): void} render
     *   Called with (el, instance) on first render and after every theme swap.
     *   Typically this calls `instance.setOption({...})`.
     * @returns {echarts.ECharts|null}
     */
    ns.registerChart = function (el, render) {
        var instance = ns.initChart(el);
        if (!instance) return null;
        var entry = { el: el, render: render, instance: instance, kind: 'echarts' };

        if (typeof ResizeObserver !== 'undefined') {
            var ro = new ResizeObserver(debounce(function () {
                if (entry.instance && !entry.instance.isDisposed()) {
                    entry.instance.resize(
                        ns.prefersReducedMotion && ns.prefersReducedMotion()
                            ? undefined
                            : { animation: { duration: 200, easing: 'cubicOut' } }
                    );
                }
            }, 150));
            ro.observe(el.parentElement || el);
            entry._resizeObserver = ro;
        }

        ns._charts.push(entry);
        makeChartFocusable(el);
        // The patch below describes the chart inside the render's own
        // setOption — no follow-up pass.
        trackOptionChanges(instance, el);
        try { render(el, instance); } catch (e) { console.error('IWACVis: render failed', e); }

        // Auto-attach the shared panel toolbar (download button) if the
        // panel-toolbar module is loaded and the chart lives inside a
        // `.iwac-vis-panel` wrapper. Silently no-ops if either is absent.
        if (ns.panels && typeof ns.panels.autoAttachPanelToolbar === 'function') {
            try { ns.panels.autoAttachPanelToolbar(el); }
            catch (e) { console.error('IWACVis: panel toolbar attach failed', e); }
        }
        return instance;
    };

    /**
     * Return the currently-live ECharts instance for a given container,
     * or null if the chart is not tracked or has been disposed.
     *
     * Theme swaps do NOT replace the instance: `applyThemeToCharts` calls
     * `setTheme()` and re-runs the render callback on the same object, so a
     * reference captured from `registerChart()` — and anything bound to it
     * with `.on()` — stays valid across a light/dark toggle. Bind those
     * handlers outside the render callback, though: the callback re-runs on
     * every swap, so an `.on()` inside it stacks a duplicate listener each
     * time.
     *
     * What this lookup guards against is teardown. A block that rebuilds a
     * subtree disposes every instance inside it and drops the entries (see
     * `disposeCharts` in compare-newspapers.js), and `pruneCharts` evicts
     * anything disposed or detached. Callers that reach for a chart well
     * after registration — download buttons, deferred UI handlers — should
     * resolve through here so they can't read from a dead instance.
     */
    ns.getLiveChart = function (el) {
        for (var i = 0; i < ns._charts.length; i++) {
            var entry = ns._charts[i];
            if (entry.el !== el || entry.kind !== 'echarts') continue;
            if (entry.instance && !entry.instance.isDisposed()) return entry.instance;
            return null;
        }
        return null;
    };

    /* ----------------------------------------------------------------- */
    /*  Repaint — keep what the reader set                                */
    /* ----------------------------------------------------------------- */

    // The option components whose presence and count define a chart's
    // "shape". Two options with the same shape can be merged: the axes,
    // legend and zoom keep their interaction state and only the series are
    // replaced. A different shape — an empty-state title where a chart was,
    // a second axis appearing — is a full rebuild.
    var SHAPE_KEYS = ['title', 'legend', 'grid', 'xAxis', 'yAxis', 'polar',
        'radiusAxis', 'angleAxis', 'radar', 'dataZoom', 'visualMap', 'tooltip',
        'axisPointer', 'toolbox', 'brush', 'geo', 'parallel', 'parallelAxis',
        'singleAxis', 'timeline', 'graphic', 'calendar', 'dataset'];

    function optionShape(base) {
        var parts = [];
        for (var i = 0; i < SHAPE_KEYS.length; i++) {
            var value = base[SHAPE_KEYS[i]];
            if (value == null) continue;
            parts.push(SHAPE_KEYS[i] + ':' + toArray(value).length);
        }
        return parts.join('|');
    }

    /** A copy of a dataZoom list with the window bounds left out. */
    function withoutWindow(dataZoom) {
        return toArray(dataZoom).map(function (z) {
            if (!z || typeof z !== 'object') return z;
            var copy = {};
            for (var k in z) {
                if (!Object.prototype.hasOwnProperty.call(z, k)) continue;
                if (k === 'start' || k === 'end' || k === 'startValue' || k === 'endValue') continue;
                copy[k] = z[k];
            }
            return copy;
        });
    }

    /**
     * Repaint a chart without discarding what the reader has set on it.
     *
     * `setOption(option, true)` — notMerge — is the safe default and every
     * facet, sort and term change used it, which is why adding a term to the
     * Ngram viewer reset its 65-year window to 0–100 and why switching the
     * sentiment model dropped every legend toggle. ECharts keeps legend
     * selection and the dataZoom window across a MERGE, and `replaceMerge`
     * lets the series list be replaced wholesale inside one — so when the
     * new option has the same shape as the last one painted here, that is
     * what this does. When it does not (the first paint, an empty-state
     * title replacing a chart, a component appearing or vanishing), it falls
     * back to a full rebuild, because a merge would leave the vanished
     * component on screen.
     *
     * The builders write `start: 0, end: 100` into every dataZoom; on a
     * merge those are dropped from the outgoing copy so the window the
     * reader dragged is the one that survives.
     *
     * @param {echarts.ECharts} instance
     * @param {Object} option  a fresh option (possibly `{baseOption, media}`)
     * @param {{lazyUpdate?: boolean, replaceMerge?: Array<string>,
     *          notMerge?: boolean}} [opts]
     * @returns {boolean} true when the paint was a merge
     */
    ns.repaint = function (instance, option, opts) {
        if (!instance || (instance.isDisposed && instance.isDisposed())) return false;
        opts = opts || {};
        var wrapped = !!(option && option.baseOption);
        var base = wrapped ? option.baseOption : option;
        var shape = base && typeof base === 'object' ? optionShape(base) : '';
        var stable = !!(shape && instance._iwacShape === shape);
        instance._iwacShape = shape;
        if (!stable || opts.notMerge) {
            instance.setOption(option, { notMerge: true, lazyUpdate: !!opts.lazyUpdate });
            return false;
        }
        var out = option;
        if (base.dataZoom) {
            var trimmed = {};
            for (var k in base) {
                if (Object.prototype.hasOwnProperty.call(base, k)) trimmed[k] = base[k];
            }
            trimmed.dataZoom = withoutWindow(base.dataZoom);
            if (wrapped) {
                out = {};
                for (var w in option) {
                    if (Object.prototype.hasOwnProperty.call(option, w)) out[w] = option[w];
                }
                out.baseOption = trimmed;
            } else {
                out = trimmed;
            }
        }
        instance.setOption(out, {
            replaceMerge: opts.replaceMerge || ['series'],
            lazyUpdate: !!opts.lazyUpdate
        });
        return true;
    };

    /** Forget a chart's shape — after `clear()`, the next repaint must rebuild. */
    ns.forgetShape = function (instance) {
        if (instance) instance._iwacShape = null;
    };

    /**
     * Register a MapLibre GL map so it gets a new basemap style on theme change.
     *
     * @param {maplibregl.Map} map
     * @param {HTMLElement} [el]  Optional container reference (for dispose tracking)
     */
    ns.registerMap = function (map, el) {
        if (!map) return;
        ns._charts.push({ el: el || null, instance: map, kind: 'maplibre' });

        // Auto-attach the shared panel toolbar (download button) to map
        // panels too, using the same closest-panel lookup as ECharts.
        // Silent no-op when panel-toolbar.js didn't load or the map
        // container isn't inside a `.iwac-vis-panel`.
        if (el && ns.panels && typeof ns.panels.autoAttachPanelToolbar === 'function') {
            try { ns.panels.autoAttachPanelToolbar(el); }
            catch (e) { console.error('IWACVis: panel toolbar attach failed', e); }
        }
    };

    /**
     * Register a plain canvas renderer so it repaints on theme change.
     *
     * The third tracked `kind`, alongside 'echarts' and 'maplibre'. It exists
     * for the d3-force graphs (shared/graph-force.js), which paint straight to
     * a 2D canvas from `getChartTokens()`: a light/dark toggle only needs the
     * tokens re-read and one repaint, and MUST NOT re-run the simulation — the
     * layout the reader arranged has to survive the swap.
     *
     * Sizing is NOT routed through here: a canvas renderer owns its own
     * ResizeObserver on its container (which a window resize triggers anyway),
     * so adding it to the window-resize sweep would only repaint twice.
     *
     * @param {HTMLElement} el
     * @param {function(): void} repaint
     * @returns {{remove: function(): void}}
     */
    ns.registerRenderer = function (el, repaint) {
        var entry = { el: el, render: repaint, instance: null, kind: 'renderer' };
        ns._charts.push(entry);
        return {
            remove: function () {
                var i = ns._charts.indexOf(entry);
                if (i >= 0) ns._charts.splice(i, 1);
            }
        };
    };

    /**
     * Return the currently-live MapLibre instance for a given container,
     * or null if the map is not tracked or has been removed. Used by
     * the panel-toolbar download button to capture the current canvas
     * without closing over a stale reference.
     */
    ns.getLiveMap = function (el) {
        for (var i = 0; i < ns._charts.length; i++) {
            var entry = ns._charts[i];
            if (entry.el !== el || entry.kind !== 'maplibre') continue;
            if (entry.instance && !entry.instance._removed) return entry.instance;
            return null;
        }
        return null;
    };

    /**
     * Free whatever an entry holds: the ECharts instance (its canvas and
     * zrender state), the MapLibre map (its WebGL context — browsers cap
     * those at about sixteen and silently lose the oldest), and the
     * ResizeObserver `registerChart` attached. Idempotent; never throws.
     */
    function releaseEntry(entry) {
        try {
            if (entry.kind === 'echarts' && entry.instance && !entry.instance.isDisposed()) {
                entry.instance.dispose();
            } else if (entry.kind === 'maplibre' && entry.instance && !entry.instance._removed
                && typeof entry.instance.remove === 'function') {
                entry.instance.remove();
            }
        } catch (e) { /* already gone */ }
        if (entry._resizeObserver) {
            try { entry._resizeObserver.disconnect(); } catch (e) { /* ignore */ }
            entry._resizeObserver = null;
        }
    }

    /**
     * Remove dead charts from the tracking array.
     *
     * "Dead" means disposed or removed — NOT detached. A host that has left
     * the document is not necessarily gone for good: the laïcité dossier
     * parks its trends chart panel outside the document between views and
     * re-attaches it, and disposing it on a theme toggle in the meantime
     * would blank the chart on the way back. So detachment is no signal
     * here; a block that throws a subtree away says so with
     * `ns.disposeWithin` below. (Canvas renderers are the exception and
     * always were: they hold no instance, so their container's presence is
     * the only liveness they have.)
     */
    ns.pruneCharts = function () {
        ns._charts = ns._charts.filter(function (c) {
            var alive = false;
            if (c.kind === 'echarts') alive = !!(c.instance && !c.instance.isDisposed());
            else if (c.kind === 'maplibre') alive = !!(c.instance && !c.instance._removed);
            // A canvas renderer has no instance to interrogate — it lives
            // exactly as long as its container is still in the document.
            else if (c.kind === 'renderer') alive = !!(c.el && c.el.isConnected);
            if (!alive) releaseEntry(c);
            return alive;
        });
    };

    /**
     * Dispose every tracked chart and map inside `root`, and forget them.
     *
     * The call to make BEFORE clearing a subtree that holds charts — a view
     * host, a detail pane, a results area — so the instances go with the
     * DOM instead of outliving it. Until v1.59.0 only compare-newspapers did
     * this (its private `disposeCharts`, promoted here); every other view
     * switch — the laïcité dossier's views, a Topic Explorer detail — left
     * the ECharts instance, its canvas and its ResizeObserver alive behind a
     * detached node, so the array grew by three or four entries per
     * interaction and the next dark-mode toggle re-rendered all of them. A
     * MapLibre map inside `root` is `remove()`d, which is also what gives
     * its WebGL context back. Returns how many entries were released.
     *
     * @param {Element} root
     * @returns {number}
     */
    ns.disposeWithin = function (root) {
        if (!root || !root.contains || !ns._charts.length) return 0;
        var kept = [];
        var released = 0;
        ns._charts.forEach(function (entry) {
            var inside = entry.el && (entry.el === root || root.contains(entry.el));
            if (!inside) { kept.push(entry); return; }
            releaseEntry(entry);
            released++;
        });
        ns._charts = kept;
        return released;
    };

    /* ----------------------------------------------------------------- */
    /*  Theme change handling                                             */
    /* ----------------------------------------------------------------- */

    /**
     * Re-render every tracked chart against the current theme.
     *
     * For ECharts we rebuild the theme from the current CSS variables
     * (via refreshThemes) and then call `instance.setTheme()` — supported
     * since ECharts 6.0.0 — followed by re-running the registered render
     * callback. setTheme alone preserves DOM state (no detach / reattach
     * flash, no re-init cost), and re-rendering immediately afterwards
     * picks up any theme tokens that callers baked into their option
     * literal via `getChartTokens()`. The ECharts 6 caveat ("multiple
     * setOption merge calls before setTheme are discarded") doesn't bite
     * us because the render callback always rebuilds the option from
     * scratch with `setOption(..., true)` — the canonical IWAC pattern.
     *
     * For MapLibre we swap the style URL. The `createIwacMap` factory
     * registers an `onStyleReady` callback that re-runs on every
     * `style.load`, so custom sources / layers / markers get rebuilt
     * automatically after the basemap swap.
     *
     * For a plain canvas renderer (kind 'renderer') we just call its repaint:
     * it reads `getChartTokens()` per frame, and its layout must survive the
     * swap untouched.
     */
    ns.applyThemeToCharts = function () {
        if (typeof ns.refreshThemes === 'function') ns.refreshThemes();
        ns.pruneCharts();
        var themeName = ns.getChartTheme ? ns.getChartTheme() : null;
        ns._charts.forEach(function (entry) {
            if (entry.kind === 'echarts') {
                if (!entry.instance || entry.instance.isDisposed()) return;
                try {
                    if (themeName && typeof entry.instance.setTheme === 'function') {
                        entry.instance.setTheme(themeName);
                    }
                    // A theme swap is a full rebuild for a render that goes
                    // through `ns.repaint`: the merged path keeps components
                    // as they are, and here they must be re-created under
                    // the new theme.
                    ns.forgetShape(entry.instance);
                    if (typeof entry.render === 'function' && entry.el) {
                        entry.render(entry.el, entry.instance);
                    }
                } catch (e) {
                    console.error('IWACVis: theme swap failed', e);
                }
            } else if (entry.kind === 'renderer') {
                // refreshThemes() above already re-read the CSS variables, so
                // the repaint picks up the new tokens. Deliberately no
                // re-layout: a force graph's positions are the reader's.
                try { entry.render(); }
                catch (e) { console.error('IWACVis: renderer repaint failed', e); }
            } else if (entry.kind === 'maplibre') {
                try {
                    // Route through P.setMapTheme when shared/maplibre.js
                    // is loaded — gives us the per-map no-op cache so a
                    // theme attribute write that didn't actually change
                    // the value can't blow away custom layers.
                    var maps = ns.panels;
                    var mode = ns.getCurrentTheme ? ns.getCurrentTheme() : 'light';
                    if (maps && typeof maps.setMapTheme === 'function') {
                        maps.setMapTheme(entry.instance, mode);
                    } else {
                        entry.instance.setStyle(ns.getBasemapStyle());
                    }
                } catch (e) { console.error('IWACVis: basemap swap failed', e); }
            }
        });
    };

    /* ----------------------------------------------------------------- */
    /*  body[data-theme] observer                                         */
    /* ----------------------------------------------------------------- */

    var _lastTheme = ns.getCurrentTheme ? ns.getCurrentTheme() : 'light';

    function handleThemeChange() {
        var now = ns.getCurrentTheme();
        if (now === _lastTheme) return;
        _lastTheme = now;
        ns.applyThemeToCharts();
    }

    function observeTheme() {
        var observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].attributeName === 'data-theme') {
                    handleThemeChange();
                    break;
                }
            }
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });

        // Follow OS pref too, but only while no explicit body attribute is set.
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
                if (!document.body.getAttribute('data-theme')) handleThemeChange();
            });
            // Reduced-motion is baked into the ECharts theme at build time
            // (iwac-theme.js buildTheme → `animation`), so a mid-session
            // preference flip needs a theme rebuild + re-render to apply.
            window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function () {
                ns.applyThemeToCharts();
            });
        }
    }

    /* ----------------------------------------------------------------- */
    /*  Window resize -> chart.resize()                                   */
    /* ----------------------------------------------------------------- */
    //
    // ECharts canvases do NOT auto-resize when their container shrinks or
    // grows. Without this, the chart keeps its initial pixel size and
    // overflows its grid cell on window resize. Debounced so we don't
    // thrash during the drag.

    var handleWindowResize = debounce(function () {
        ns.pruneCharts();
        ns._charts.forEach(function (entry) {
            try {
                // ECharts entries with a per-chart ResizeObserver are already
                // handled by that observer — skip them here to avoid double resize.
                if (entry.kind === 'echarts' && entry.instance && !entry._resizeObserver) {
                    entry.instance.resize();
                } else if (entry.kind === 'maplibre' && entry.instance) {
                    entry.instance.resize();
                }
            } catch (e) {
                // Swallow — a disposed chart shouldn't take the whole page down
            }
        });
    }, 120);

    function observeResize() {
        window.addEventListener('resize', handleWindowResize, { passive: true });
    }

    function bootstrapObservers() {
        observeTheme();
        observeResize();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapObservers);
    } else {
        bootstrapObservers();
    }

    /* ----------------------------------------------------------------- */
    /*  Shared helpers                                                    */
    /* ----------------------------------------------------------------- */

    /**
     * Resolve a CSS custom property to a concrete color string that
     * ECharts' color parser can understand (`rgb(...)` / `rgba(...)`).
     *
     * Why this exists: our theme ramps under iwac-core.css
     * (--iwac-vis-heatmap-0..4, --iwac-vis-cent-*, --iwac-vis-subj-*)
     * are defined as `color-mix(in oklab, var(--primary), var(--surface))`
     * expressions so they track the IWAC theme's --primary / --surface
     * tokens. Two things conspire against ECharts here:
     *   1. `getPropertyValue('--x')` returns the raw source — ECharts has
     *      no idea what `color-mix(...)` means and falls back to grayscale.
     *   2. `getComputedStyle(probe).color` DOES compute the expression,
     *      but modern Chromium serializes the result as
     *      `color(srgb 0.98 0.93 0.92)` (CSS Color Module Level 4).
     *      ECharts' parser doesn't understand `color()` either.
     * So we force the browser to compute the expression via an offscreen
     * probe, then if the result comes back as `color(srgb ...)`, parse it
     * ourselves and emit legacy `rgb()` / `rgba()`.
     *
     * @param {string} varName  e.g. '--iwac-vis-heatmap-2'
     * @returns {string} legacy-rgb color, or '' if undefined / unresolvable
     */
    ns.resolveCssVar = function (varName) {
        if (typeof document === 'undefined' || !document.body) return '';
        var probe = document.createElement('span');
        probe.style.cssText =
            'position:absolute;visibility:hidden;width:0;height:0;' +
            'color:var(' + varName + ',transparent)';
        document.body.appendChild(probe);
        var resolved = getComputedStyle(probe).color;
        document.body.removeChild(probe);
        if (!resolved || resolved === 'rgba(0, 0, 0, 0)') return '';

        // rgb / rgba are already Color-3-legal — fast path.
        if (/^rgba?\(/i.test(resolved)) return resolved;

        // After IWAC theme v2.0.0 reframed tokens around OKLCH, modern
        // Chromium serializes `color-mix(in oklab, …)` and `oklch(…)`
        // results as oklab(…) / oklch(…) AS-IS, not as rgb. ECharts'
        // parse → undefined → hover lift fails → orange "disappears".
        // ns._convertModernColor (defined in iwac-theme.js) does pure-JS
        // Oklab → linear sRGB → sRGB math, so the result is parseable
        // by ECharts AND accepted by MapLibre's style validator. No
        // canvas (anti-fingerprinting layers can corrupt canvas reads).
        if (typeof ns._convertModernColor === 'function') {
            var converted = ns._convertModernColor(resolved);
            if (converted) return converted;
        }
        return resolved;
    };

    /** Convert either {key: value} or array format to [{ name, value, itemId? }]. */
    ns.toEntries = function (data) {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        return Object.keys(data).map(function (k) { return { name: k, value: data[k] }; });
    };

})();
