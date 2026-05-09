/**
 * IWAC Visualizations — Dashboard panels bridge
 *
 * Registers thin wrappers around the existing per-panel render modules
 * (`IWACVis.personDashboard.timeline`, `IWACVis.articleDashboard.network`,
 * etc.) into `IWACVis.dashboardLayout`, exposing each as a renderer
 * keyed under a stable `iwac*` name. Person, Entity, and Article
 * orchestrators consume those renderer keys from declarative slot
 * arrays via `IWACVis.dashboardLayout.render()`.
 *
 * Why a bridge instead of editing every panel module:
 *   1. The panel modules already work — they have a stable
 *      `(panelEl, data, facet, ctx)` signature, careful render
 *      callbacks, network observers, etc. Migrating them in-place
 *      would touch ~9 person panels + 2 article panels.
 *   2. The dashboardLayout renderer signature is
 *      `(el, slice, slot, ctx)` — narrower (`el` is the
 *      `.iwac-vis-chart` only, the surrounding `.iwac-vis-panel` is
 *      provided by the layout system). The bridge reconstructs the
 *      `panelEl` shape the legacy modules expect.
 *
 * Load order: this file MUST load AFTER all per-panel module IIFEs
 * (so `ns.personDashboard.*` and `ns.articleDashboard.*` are
 * populated) and BEFORE the orchestrator (so the orchestrator can
 * just call `DL.render(rootEl, layoutKey, data, ctx)` without
 * worrying about which renderer is registered yet). Templates load
 * it as the LAST entry in their `panels` array.
 *
 * Each renderer reads the legacy module via a getter so the bridge
 * resolves the actual function lazily — keeps the bridge robust to
 * load-order edge cases (e.g. a panel module that fails to load
 * silently disables its slot rather than throwing inside DL.render).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var DL = ns.dashboardLayout;
    var P  = ns.panels;
    if (!DL || !P) {
        console.warn('IWACVis.dashboard-panels-bridge: dashboard-layout.js + panels.js must load first');
        return;
    }

    /**
     * Build a renderer that delegates to one of the legacy
     * `(panelEl, data, facet, ctx)` panel modules. The slice argument
     * is intentionally ignored — every legacy panel module reads from
     * the full data bundle on `ctx.data`. Slot.dataAccessor is set to
     * `IWACVis.dashboardLayout.fullSlice` (or equivalent) by the
     * orchestrator so empty-payload predicates can run against the
     * full bundle.
     *
     * @param {function():{render: Function}} modGetter
     *   Lazy lookup of the panel module — ensures we observe the most
     *   recent `ns.personDashboard.<name>` even if the module file
     *   loaded after this bridge for some reason.
     */
    function bridge(modGetter) {
        return function (el, _slice, _slot, ctx) {
            var mod = modGetter();
            if (!mod || typeof mod.render !== 'function') return;
            // Reconstruct the (panel, chart) pair the legacy modules
            // expect. dashboardLayout passes us the inner chart element
            // (`.iwac-vis-chart`); its parent is the surrounding
            // `.iwac-vis-panel` that buildPanel produced.
            var panelEl = { panel: el.parentElement, chart: el };
            var data  = (ctx && ctx.data)  || {};
            var facet = (ctx && ctx.facet) || { role: 'all', subscribe: function () {}, set: function () {} };
            try {
                mod.render(panelEl, data, facet, ctx);
            } catch (e) {
                console.error('IWACVis.dashboard-panels-bridge: legacy renderer failed', e);
                el.innerHTML = '';
                el.appendChild(P.buildErrorState());
            }
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Person + Entity panels (the personDashboard module exposes 9)    */
    /* ----------------------------------------------------------------- */

    var pdGet = function (name) {
        return function () {
            var pd = ns.personDashboard;
            return pd && pd[name];
        };
    };

    DL.registerRenderer('iwacTimeline',     bridge(pdGet('timeline')));
    DL.registerRenderer('iwacHeatmap',      bridge(pdGet('heatmap')));
    DL.registerRenderer('iwacNewspapers',   bridge(pdGet('newspapers')));
    DL.registerRenderer('iwacCountries',    bridge(pdGet('countries')));
    DL.registerRenderer('iwacTopics',       bridge(pdGet('topics')));
    DL.registerRenderer('iwacSentiment',    bridge(pdGet('sentiment')));
    DL.registerRenderer('iwacEntityNet',    bridge(pdGet('network')));
    DL.registerRenderer('iwacCoOccurrence', bridge(pdGet('cooccurrence')));
    DL.registerRenderer('iwacEntityMap',    bridge(pdGet('map')));

    /* ----------------------------------------------------------------- */
    /*  Article panels (the articleDashboard module exposes 2)            */
    /* ----------------------------------------------------------------- */

    var adGet = function (name) {
        return function () {
            var ad = ns.articleDashboard;
            return ad && ad[name];
        };
    };

    DL.registerRenderer('iwacArticleNetwork', bridge(adGet('network')));
    DL.registerRenderer('iwacArticleFurther', bridge(adGet('furtherReading')));

    /* ----------------------------------------------------------------- */
    /*  Convenience accessor                                              */
    /* ----------------------------------------------------------------- */

    /**
     * Identity slot.dataAccessor — passes the whole data bundle
     * through as the slot's slice. Use this on every slot whose
     * legacy renderer reads from the full bundle (i.e. all of the
     * person / entity / article panels). Centralised so orchestrators
     * don't each define their own.
     */
    DL.fullSlice = function (data) { return data; };
})();
