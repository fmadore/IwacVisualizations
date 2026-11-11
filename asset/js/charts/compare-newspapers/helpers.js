/**
 * IWAC Visualizations — Compare Newspapers block: shared helpers.
 *
 * Split out of compare-newspapers.js. Carries what the panel modules
 * share: the corpus side-color resolver (used by the timeline,
 * top-subjects, map, sentiment, and newspapers panels), the unique-id
 * counter (the picker's type-switch label) and the labelled-select
 * builder (the picker and the sentiment toolbar). Hangs off IWACVis.compareNewspapers; must load before
 * every other compare-newspapers/ module and the orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/helpers: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    /* ----------------------------------------------------------------- */
    /*  Side colors                                                       */
    /*                                                                    */
    /*  Corpus A tracks the theme --primary (via getChartTokens). Corpus  */
    /*  B is the slate-blue accent declared as --iwac-vis-compare-color-b on  */
    /*  the block, which the CSS flips to a lighter shade in dark mode.   */
    /*  Read that custom property off the live block element so the       */
    /*  ECharts / MapLibre series match the CSS swatches in BOTH themes   */
    /*  — which holds only while callers read it at paint time (inside a  */
    /*  registerChart callback or onStyleReady), never once per build     */
    /*  (previously colorB was a hardcoded '#394f68' literal repeated in  */
    /*  five panels, so the charts stayed dark-blue in dark mode while    */
    /*  the CSS legend dots went light — a mismatch). Falls back to the   */
    /*  theme's --secondary (which the property aliases) when the block   */
    /*  isn't on the page. One source of truth instead of five copies.    */
    /*                                                                    */
    /*  The property arrives as whatever --secondary is written in —      */
    /*  oklch() or color-mix() on the current theme — so it goes through  */
    /*  resolveCssColor: ECharts cannot parse either form.                */
    /* ----------------------------------------------------------------- */

    function compareColors() {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var b = tokens.secondary;
        var block = document.querySelector('.iwac-vis-compare-newspapers');
        if (block && window.getComputedStyle) {
            var vb = getComputedStyle(block).getPropertyValue('--iwac-vis-compare-color-b').trim();
            var resolved = vb && ns.resolveCssColor ? ns.resolveCssColor(vb) : vb;
            if (resolved) b = resolved;
        }
        return { a: tokens.primary, b: b };
    }

    // A module-level counter keeps the type switch's label id unique even
    // when two compare-newspapers blocks render side by side. (The selects
    // mint their own ids in P.buildSelectControl.)
    var _uid = 0;

    function nextUid() {
        return ++_uid;
    }

    /**
     * A labelled select through the shared P.buildSelectControl — the
     * `data-iwac-control` handle, the label/id wiring and the shared
     * `.iwac-vis-control` skin — with the block's own label/row classes.
     * The label is a heading-style run-in here (uppercase in the sentiment
     * toolbar, beside the colon-less "Type" in the picker), so it takes no
     * colon.
     *
     * @param {Object} cfg  P.buildSelectControl's config
     * @returns {HTMLElement} the group, with `.control` and `.setOptions`
     */
    function buildSelect(cfg) {
        var own = { colon: false };
        Object.keys(cfg).forEach(function (k) { own[k] = cfg[k]; });
        return P.buildSelectControl(own);
    }

    CN.compareColors = compareColors;
    CN.nextUid = nextUid;
    CN.buildSelect = buildSelect;
})();
