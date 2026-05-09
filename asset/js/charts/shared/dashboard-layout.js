/**
 * IWAC Visualizations — Dashboard layout system
 *
 * Declarative entity-dashboard composition. Inspired by the WissKI
 * dashboard's `entityDashboardLayouts.ts` + `ChartSlot` dispatcher,
 * adapted to vanilla JS so per-entity orchestrators become 5–20-line
 * layout arrays instead of 200-line bespoke controllers.
 *
 * Three registries hang off `IWACVis.dashboardLayout`:
 *
 *   1. `metadata[chartKey]`  — default i18n title / desc keys + an
 *                              optional `hasData(slice)` predicate.
 *   2. `renderers[chartKey]` — `(panelEl, slice, slot, ctx) => void`,
 *                              registered by individual renderer modules
 *                              under `shared/renderers/<name>.js`.
 *   3. `layouts[layoutKey]`  — array of slot objects (or function
 *                              returning an array) per entity type.
 *
 * Slot shape:
 *
 *     {
 *       chart:        'calendarHeatmap',           // required, → renderer key
 *       wide:         true,                        // optional, applies --wide modifier
 *       tall:         true,                        // optional, applies --tall modifier
 *       title:        'Year × month heatmap',      // optional, i18n key (else metadata.labelKey)
 *       description:  'desc_year_month_heatmap',   // optional, i18n key (else metadata.descKey)
 *       dataKey:      'heatmap',                   // optional, key into the data bundle (default = chart)
 *       dataAccessor: function (data) {...},       // optional, alternative to dataKey
 *       hasData:      function (slice) {...},      // optional, slot-level override of metadata.hasData
 *       cond:         function (slice, ctx) {...}, // optional, hard-gate before rendering
 *       className:    'iwac-vis-panel--accent',    // optional, extra class on the panel wrapper
 *       options:      {...}                        // optional, opaque blob passed to the renderer as `slot.options`
 *     }
 *
 * `shouldRender(slot, slice)` filters slots whose data is empty, so
 * dashboards never display "No data available" placeholders. The
 * predicate cascade is: `slot.cond` → `slot.hasData` →
 * `metadata[chartKey].hasData` → lenient fallback.
 *
 * Fragments — reusable sub-arrays of slots — let multiple layouts share
 * common compositions (e.g. "the standard time-series row"). Register
 * via `defineFragment(name, slots)`, reference via
 * `{ fragment: 'name' }` in any layout array; `render()` flattens
 * them at dispatch time.
 *
 * Dependencies: panels.js, dashboard-core.js, iwac-i18n.js.
 * Load order: after panels.js (always loaded), before any renderer
 * module that registers itself or any orchestrator that calls
 * `IWACVis.dashboardLayout.render()`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.dashboardLayout: panels.js must load first');
        return;
    }

    var DL = ns.dashboardLayout = ns.dashboardLayout || {};

    DL.metadata  = DL.metadata  || {};
    DL.renderers = DL.renderers || {};
    DL.layouts   = DL.layouts   || {};
    DL.fragments = DL.fragments || {};

    /* ----------------------------------------------------------------- */
    /*  Registration                                                      */
    /* ----------------------------------------------------------------- */

    /**
     * Register default i18n keys + optional `hasData` predicate for a
     * chart key. Called once per renderer, typically at the bottom of
     * the renderer's IIFE.
     *
     * @param {string} chartKey
     * @param {{
     *     labelKey?: string,
     *     descKey?:  string,
     *     hasData?:  function(*): boolean
     * }} meta
     */
    DL.registerMetadata = function (chartKey, meta) {
        if (!chartKey) return;
        DL.metadata[chartKey] = meta || {};
    };

    /**
     * Register a renderer for a chart key. The renderer is a plain
     * function — no class, no lifecycle hooks. It receives the empty
     * `.iwac-vis-chart` element and the slice of data for this slot;
     * it is responsible for calling `IWACVis.registerChart` (for
     * ECharts) or rendering directly into the element (for inline-SVG
     * sparklines, card strips, etc).
     *
     * @param {string} chartKey
     * @param {function(HTMLElement, *, Object, Object): void} fn
     */
    DL.registerRenderer = function (chartKey, fn) {
        if (!chartKey || typeof fn !== 'function') return;
        DL.renderers[chartKey] = fn;
    };

    DL.hasRenderer = function (chartKey) {
        return typeof DL.renderers[chartKey] === 'function';
    };

    /**
     * Register a layout. Either an array of slot objects, or a function
     * that returns one (`function(data, ctx) -> Array<Slot>`). Use the
     * function form when slot composition depends on what the data
     * actually contains (e.g. show the AI sentiment panel only if the
     * person has any AI-rated mentions).
     */
    DL.register = function (layoutKey, layout) {
        if (!layoutKey) return;
        DL.layouts[layoutKey] = layout;
    };

    /**
     * Define a reusable fragment — a named slice of slots that one or
     * more layouts include. References are written as
     * `{ fragment: 'fragmentName' }` and flattened at render time.
     */
    DL.defineFragment = function (name, slots) {
        if (!name || !Array.isArray(slots)) return;
        DL.fragments[name] = slots.slice();
    };

    /* ----------------------------------------------------------------- */
    /*  Empty-payload predicates                                          */
    /* ----------------------------------------------------------------- */

    /**
     * Shared predicates for the common "is this slice empty?" shapes.
     * Renderers reference one of these via metadata.hasData (or wrap
     * their own predicate around them).
     *
     * Keeping these centralized — rather than re-deriving "empty array"
     * vs "empty network" vs "empty geo" inline in every orchestrator —
     * is what kills "No data available" placeholders in practice.
     */
    DL.isEmpty = {
        list: function (v) {
            return !Array.isArray(v) || v.length === 0;
        },
        keyed: function (v) {
            return v == null || typeof v !== 'object' ||
                   Object.keys(v).length === 0;
        },
        timeline: function (v) {
            return !v || !Array.isArray(v.years) || v.years.length === 0;
        },
        network: function (v) {
            return !v || !Array.isArray(v.nodes) || v.nodes.length === 0 ||
                   !Array.isArray(v.links) || v.links.length === 0;
        },
        chord: function (v) {
            // A chord needs ≥ 2 nodes and ≥ 1 link to be visually
            // meaningful — a single-node chord is just a labeled dot.
            return !v || !Array.isArray(v.nodes) || v.nodes.length < 2 ||
                   !Array.isArray(v.links) || v.links.length === 0;
        },
        graph: function (v) { return DL.isEmpty.network(v); },
        geo: function (v) {
            if (!v) return true;
            if (Array.isArray(v))           return v.length === 0;
            if (Array.isArray(v.features))  return v.features.length === 0;
            if (Array.isArray(v.points))    return v.points.length === 0;
            if (Array.isArray(v.locations)) return v.locations.length === 0;
            return false;
        },
        hierarchical: function (v) {
            return !v || !Array.isArray(v.children) || v.children.length === 0;
        },
        cells: function (v) {
            return !v || !Array.isArray(v.cells) || v.cells.length === 0;
        },
        radar: function (v) {
            return !v || !Array.isArray(v.indicators) || v.indicators.length < 3 ||
                   !Array.isArray(v.series) || v.series.length === 0;
        }
    };

    /* ----------------------------------------------------------------- */
    /*  shouldRender                                                      */
    /* ----------------------------------------------------------------- */

    /**
     * Decide whether a slot's slice has enough data to render. Cascade:
     *   1. `slot.cond(slice, ctx)` — hard gate, evaluated first.
     *   2. `slot.hasData(slice)`   — slot-level override.
     *   3. metadata[chart].hasData  — renderer-declared default.
     *   4. lenient fallback        — non-null + non-empty.
     */
    DL.shouldRender = function (slot, slice, ctx) {
        if (!slot) return false;
        if (typeof slot.cond === 'function' && !slot.cond(slice, ctx)) return false;
        if (typeof slot.hasData === 'function') return !!slot.hasData(slice);
        var meta = DL.metadata[slot.chart];
        if (meta && typeof meta.hasData === 'function') return !!meta.hasData(slice);
        if (slice == null) return false;
        if (Array.isArray(slice))     return slice.length > 0;
        if (typeof slice === 'object') return Object.keys(slice).length > 0;
        return Boolean(slice);
    };

    /* ----------------------------------------------------------------- */
    /*  Internals                                                         */
    /* ----------------------------------------------------------------- */

    /**
     * Read the data slice for a slot from the shared bundle. Slots can
     * override either by `dataKey` (string, looked up on the bundle)
     * or by `dataAccessor` (function, given the whole bundle). Default:
     * `data[slot.chart]`.
     */
    function dataFor(slot, data) {
        if (typeof slot.dataAccessor === 'function') return slot.dataAccessor(data);
        var key = slot.dataKey || slot.chart;
        return data ? data[key] : undefined;
    }

    /**
     * Translate either an i18n key, a function, or an already-translated
     * string. Functions receive `(slice, ctx)`; strings are run through
     * `IWACVis.t` so callers can pass either localized text or a key.
     */
    function resolveLabel(value, slice, ctx) {
        if (value == null) return '';
        if (typeof value === 'function') return value(slice, ctx) || '';
        return P.t(value);
    }

    /**
     * Flatten `{ fragment: 'name' }` references against the registered
     * fragments table. Non-references pass through untouched.
     */
    function expandFragments(slots) {
        var out = [];
        for (var i = 0; i < slots.length; i++) {
            var s = slots[i];
            if (!s) continue;
            if (s.fragment && DL.fragments[s.fragment]) {
                var frag = DL.fragments[s.fragment];
                for (var j = 0; j < frag.length; j++) out.push(frag[j]);
            } else {
                out.push(s);
            }
        }
        return out;
    }

    /* ----------------------------------------------------------------- */
    /*  render                                                            */
    /* ----------------------------------------------------------------- */

    /**
     * Build the responsive grid and populate one panel per slot whose
     * data passes `shouldRender`. Panels are wired to the existing
     * `P.buildPanel` shell so the panel-toolbar download button +
     * theme observer pick them up automatically.
     *
     * @param {HTMLElement} rootEl     Container the grid is appended into.
     * @param {string}      layoutKey  Registered layout name.
     * @param {Object}      data       Shared data bundle. Each slot reads
     *                                 `data[slot.chart]` (or its `dataKey`
     *                                 / `dataAccessor` override) for its
     *                                 own slice.
     * @param {Object}      [ctx]      Per-orchestrator context (siteBase,
     *                                 itemId, facet, etc.) passed straight
     *                                 through to renderers.
     * @returns {{grid: HTMLElement, rendered: Array<{slot: Object, panel: Object}>}|null}
     */
    DL.render = function (rootEl, layoutKey, data, ctx) {
        if (!rootEl) return null;
        var def = DL.layouts[layoutKey];
        if (def == null) {
            console.warn('IWACVis.dashboardLayout: unknown layout "' + layoutKey + '"');
            return null;
        }
        var raw = typeof def === 'function' ? def(data, ctx) : def;
        if (!Array.isArray(raw)) return null;

        var slots = expandFragments(raw);
        var grid  = P.buildChartsGrid();
        rootEl.appendChild(grid);

        var rendered = [];
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            if (!slot || !slot.chart) continue;

            var slice = dataFor(slot, data);
            if (!DL.shouldRender(slot, slice, ctx)) continue;

            var renderer = DL.renderers[slot.chart];
            if (typeof renderer !== 'function') {
                if (!ctx || ctx.warnMissing !== false) {
                    console.warn(
                        'IWACVis.dashboardLayout: no renderer registered for "' +
                        slot.chart + '" — slot skipped'
                    );
                }
                continue;
            }

            var meta  = DL.metadata[slot.chart] || {};
            var title = resolveLabel(slot.title       != null ? slot.title       : meta.labelKey, slice, ctx);
            var desc  = resolveLabel(slot.description != null ? slot.description : meta.descKey,  slice, ctx);

            var classes = 'iwac-vis-panel';
            if (slot.wide)      classes += ' iwac-vis-panel--wide';
            if (slot.tall)      classes += ' iwac-vis-panel--tall';
            if (slot.className) classes += ' ' + slot.className;

            var panelEl = P.buildPanel(classes, title, desc || null);
            grid.appendChild(panelEl.panel);

            try {
                renderer(panelEl.chart, slice, slot, ctx || {});
                rendered.push({ slot: slot, panel: panelEl });
            } catch (e) {
                console.error('IWACVis.dashboardLayout: renderer "' + slot.chart + '" failed', e);
                panelEl.chart.innerHTML = '';
                panelEl.chart.appendChild(P.buildErrorState());
            }
        }
        return { grid: grid, rendered: rendered };
    };

    /* ----------------------------------------------------------------- */
    /*  Convenience: list registered renderers                            */
    /* ----------------------------------------------------------------- */

    /** Return the keys of every registered renderer. Useful for debug. */
    DL.listRenderers = function () {
        return Object.keys(DL.renderers).sort();
    };
})();
