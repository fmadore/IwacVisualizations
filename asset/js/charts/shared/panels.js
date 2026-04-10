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
    /*  i18n + number formatting shortcuts                                */
    /* ----------------------------------------------------------------- */

    P.t = function (key, params) { return ns.t(key, params); };

    P.formatNumber = function (n) {
        return ns.formatNumber ? ns.formatNumber(n) : String(n);
    };

    /* ----------------------------------------------------------------- */
    /*  Layout primitives                                                 */
    /* ----------------------------------------------------------------- */

    /**
     * Build a `.iwac-vis-panel` wrapper with an `<h4>` title and a
     * `.iwac-vis-chart` child that the controller can pass to
     * `IWACVis.registerChart`.
     *
     * @param {string} className e.g. "iwac-vis-panel" or "iwac-vis-panel iwac-vis-panel--wide"
     * @param {string} titleText already-translated title
     * @returns {{panel: HTMLElement, chart: HTMLElement}}
     */
    P.buildPanel = function (className, titleText) {
        var panel = P.el('div', className);
        panel.appendChild(P.el('h4', null, titleText));
        var chart = P.el('div', 'iwac-vis-chart');
        panel.appendChild(chart);
        return { panel: panel, chart: chart };
    };

    /**
     * Build the row of summary stat cards at the top of an overview block.
     *
     * @param {Array<{value:number|null, labelKey:string}>} cards
     * @returns {HTMLElement}
     */
    P.buildSummaryCards = function (cards) {
        var cardsEl = P.el('div', 'iwac-vis-overview-summary');
        cards.forEach(function (c) {
            if (c == null || c.value == null) return;
            var card = P.el('div', 'iwac-vis-summary-card');
            card.appendChild(P.el('div', 'iwac-vis-summary-card__value', P.formatNumber(c.value)));
            card.appendChild(P.el('div', 'iwac-vis-summary-card__label', P.t(c.labelKey)));
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
})();
