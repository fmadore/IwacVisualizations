/**
 * IWAC Visualizations — Compare Newspapers block: shared helpers.
 *
 * Split out of compare-newspapers.js. Carries the two bits of state
 * shared across panel modules: the corpus side-color resolver (used by
 * the timeline, top-subjects, map, sentiment, and newspapers panels)
 * and the unique-id counter (used by the picker and the sentiment
 * toolbar). Hangs off IWACVis.compareNewspapers; must load before
 * every other compare-newspapers/ module and the orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/helpers: missing panels — check script load order');
        return;
    }
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    /* ----------------------------------------------------------------- */
    /*  Side colors                                                       */
    /*                                                                    */
    /*  Corpus A tracks the theme --primary (via getChartTokens). Corpus  */
    /*  B is the slate-blue accent declared as --iwac-compare-color-b on  */
    /*  the block, which the CSS flips to a lighter shade in dark mode.   */
    /*  Read that custom property off the live block element so the       */
    /*  ECharts / MapLibre series match the CSS swatches in BOTH themes   */
    /*  (previously colorB was a hardcoded '#394f68' literal repeated in  */
    /*  five panels, so the charts stayed dark-blue in dark mode while    */
    /*  the CSS legend dots went light — a mismatch). Falls back to the   */
    /*  literal when the block / theme isn't resolvable. One source of    */
    /*  truth instead of five copy-pasted blocks.                         */
    /* ----------------------------------------------------------------- */

    function compareColors() {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var b = '#394f68';
        var block = document.querySelector('.iwac-vis-compare-newspapers');
        if (block && window.getComputedStyle) {
            var vb = getComputedStyle(block).getPropertyValue('--iwac-compare-color-b');
            if (vb && vb.trim()) b = vb.trim();
        }
        return { a: tokens.primary || '#e64a19', b: b };
    }

    // One counter per block instance isn't worth the plumbing — a module-
    // level counter guarantees each select on the page gets a unique id,
    // even if two compare-newspapers blocks render side by side. Shared
    // here because both the picker and the sentiment toolbar draw from
    // the same sequence.
    var _uid = 0;

    function nextUid() {
        return ++_uid;
    }

    CN.compareColors = compareColors;
    CN.nextUid = nextUid;
})();
