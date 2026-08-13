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
     * Accent-insensitive, case-insensitive search folding — NFD
     * decomposition with the combining diacritical marks (U+0300–U+036F)
     * stripped, so "Bénin" matches "benin". The canonical fold for every
     * search box / picker in the module.
     */
    P.foldAccents = function (str) {
        return String(str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
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
        return s === '' || [
            'unknown', 'inconnu', 'n/a', 'na', 'none', 'null', '—'
        ].indexOf(s) !== -1;
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
    /*  On-view lazy init                                                 */
    /* ----------------------------------------------------------------- */

    /**
     * Run `render` exactly once, the first time `target` nears the
     * viewport (IntersectionObserver with a rootMargin pre-trigger).
     * Falls back to an immediate call when IntersectionObserver is
     * unavailable. Replaces the arm-render-disconnect boilerplate that
     * was copy-pasted across the map / wordcloud / deferred-fetch panels.
     *
     * @param {Element}  target  element to observe
     * @param {Function} render  called exactly once
     * @param {Object}   [opts]  { rootMargin: '200px' }
     * @returns {Function} trigger — call to force the render immediately
     *                     (still one-shot)
     */
    P.lazyInit = function (target, render, opts) {
        var fired = false;
        function fire() {
            if (fired) return;
            fired = true;
            render();
        }
        if (typeof IntersectionObserver === 'undefined') {
            fire();
            return fire;
        }
        var observer = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) {
                    observer.disconnect();
                    fire();
                    return;
                }
            }
        }, { rootMargin: (opts && opts.rootMargin) || '200px' });
        observer.observe(target);
        return fire;
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
     * Runtime in clock form: `M:SS` under an hour, `H:MM:SS` above it —
     * the convention every video player uses, so a reader recognises it
     * without a unit label. Input is seconds (the `duration` field the
     * template-summary generator emits, normalised from ISO-8601
     * `dcterms:extent`). Returns '' for anything non-positive so callers
     * can treat "no runtime recorded" as "render nothing".
     */
    P.formatDuration = function (seconds) {
        var total = Math.round(Number(seconds));
        if (!isFinite(total) || total <= 0) return '';
        var h = Math.floor(total / 3600);
        var m = Math.floor((total % 3600) / 60);
        var s = total % 60;
        var pad = function (n) { return n < 10 ? '0' + n : String(n); };
        return h > 0
            ? h + ':' + pad(m) + ':' + pad(s)
            : m + ':' + pad(s);
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

    /**
     * Derive a short display label from an LDA topic's ' - '-joined word
     * list: the first two words joined with a middle dot — the same split
     * the Topic Explorer treemap derives its cell names from. Falls back
     * to "Topic <id>" when the label is empty and an id is supplied, else
     * to '' so callers can skip unlabeled topics.
     */
    P.topicShortLabel = function (label, id) {
        var name = String(label || '').split(' - ').slice(0, 2).join(' · ').trim();
        if (name) return name;
        return id != null ? (P.t('Topic') + ' ' + id) : '';
    };

    /* ----------------------------------------------------------------- */
    /*  Status banners (loading / empty / error)                          */
    /* ----------------------------------------------------------------- */

    /**
     * Announce a status banner to assistive technology.
     *
     * Each of these banners marks a state change a sighted user reads at a
     * glance — "loading", "nothing here", "that failed". Without a live region
     * a screen-reader user gets silence: the dashboards fetch for one to three
     * seconds and then swap the spinner for content with no cue at either end.
     * `polite` (not `assertive`) so it waits for a gap rather than interrupting.
     */
    function announce(el) {
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        return el;
    }

    /** Spinner + translated message. Default key "Loading". */
    P.buildLoadingState = function (messageKey) {
        var el = announce(P.el('div', 'iwac-vis-loading'));
        var spinner = P.el('div', 'iwac-vis-spinner');
        // Decorative: the adjacent text carries the meaning.
        spinner.setAttribute('aria-hidden', 'true');
        el.appendChild(spinner);
        el.appendChild(P.el('span', null, P.t(messageKey || 'Loading')));
        return el;
    };

    /** Empty-state banner. Default key "No data available". */
    P.buildEmptyState = function (messageKey) {
        return announce(P.el('div', 'iwac-vis-empty', P.t(messageKey || 'No data available')));
    };

    /** Error banner. Default key "Failed to load". */
    P.buildErrorState = function (messageKey) {
        return announce(P.el('div', 'iwac-vis-error', P.t(messageKey || 'Failed to load')));
    };

    /**
     * "No data yet" banner — distinct from buildEmptyState (an empty slice of
     * an otherwise-loaded dataset). This one means the data file itself has not
     * been published into files/iwac-visualizations/ yet, e.g. before the first
     * "Pull latest data" sync (issue #7). Reuses the empty-state styling.
     */
    P.buildNoDataState = function (messageKey) {
        return announce(P.el('div', 'iwac-vis-empty iwac-vis-nodata',
            P.t(messageKey || 'Visualization data is not available yet.')));
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
     * Values run through `formatNumber` by default, so callers must pass the
     * RAW number, not a pre-formatted string — formatting twice yields "NaN".
     * Pass `text: true` for a card whose value is not a figure (a year span,
     * a language, an issue number) to render it verbatim instead.
     *
     * @param {Array<{value:number|string|null, labelKey:string,
     *                featured?:boolean, text?:boolean}>} cards
     * @returns {HTMLElement}
     */
    P.buildSummaryCards = function (cards) {
        var cardsEl = P.el('div', 'iwac-vis-overview-summary');
        cards.forEach(function (c) {
            if (c == null || c.value == null) return;
            var cls = 'iwac-vis-summary-card';
            if (c.featured) cls += ' iwac-vis-summary-card--featured';
            var card = P.el('div', cls);
            // `labelParams` lets a caller interpolate into the msgid —
            // needed wherever the label names something that varies at
            // runtime (an AI model, say), which otherwise forces one
            // msgid per possible value and breaks the moment a new value
            // appears in the data.
            card.appendChild(P.el('div', 'iwac-vis-summary-card__label',
                P.t(c.labelKey, c.labelParams)));
            card.appendChild(P.el('div', 'iwac-vis-summary-card__value',
                c.text ? String(c.value) : P.formatNumber(c.value)));
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
