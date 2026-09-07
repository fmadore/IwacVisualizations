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

    /**
     * The one step down from the theme's base chart type size, for axis
     * labels that must fit a dense grid — heatmap rows, matrix columns,
     * calendar month names.
     *
     * It lives HERE, in panels.js, rather than in chart-options.js: this
     * file is in `shared.core` and loads first, so a block that skips the
     * chart-options bundle still gets a number rather than `undefined` —
     * which ECharts would silently replace with its own 12px default.
     *
     * A number, not a token: `readTokens()` reads colours and the body font
     * family, and the theme's `--text-*` scale is expressed in `rem`, which
     * ECharts cannot consume (a canvas has no cascade to resolve it against).
     * What this replaces is the literal appearing at four different values —
     * 15 in `special`, 7 in `hbar`, 3 in `bar`, 3 in `graph` — for what is
     * one decision.
     */
    P.AXIS_FONT_SM = 10;

    /**
     * Below this width a chart is drawn in its compact form — fewer labels,
     * tighter grid, stacked legend.
     *
     * The rule is the ELEMENT's width, never the viewport's: an embed 400 px
     * wide on a desktop screen is narrow, and a panel in a wide layout on a
     * tablet is not. `laicite/arenas.js` read `window.innerWidth` and so laid
     * a 400 px embed out in three columns.
     */
    P.COMPACT_MAX = 600;

    P.isCompact = function (el) {
        if (!el) return false;
        var w = el.clientWidth
            || (el.getBoundingClientRect && el.getBoundingClientRect().width)
            || 0;
        // A width of zero means "not laid out yet", not "infinitely narrow".
        return w > 0 && w < P.COMPACT_MAX;
    };

    /**
     * A control's label with its colon: `Country:` in English, `Pays :` in
     * French, where typography puts a space before a two-part punctuation
     * mark. Two call sites concatenated `label + ':'` and got the English
     * form on both sites.
     */
    P.labelColon = function (label) {
        return String(label == null ? '' : label) + (ns.locale === 'fr' ? ' :' : ':');
    };

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
     * - Bounds the wait: `P.FETCH_TIMEOUT_MS` by default, `timeoutMs` to
     *   override, `timeoutMs: 0` to opt out (see below).
     *
     * @param {string} url
     * @param {Object} [opts]  Extra fetch options merged over the defaults.
     * @param {number} [opts.timeoutMs]  Abort and reject after this long
     *   (default `P.FETCH_TIMEOUT_MS`; 0 disables the bound).
     * @returns {Promise<any>} parsed JSON body
     */
    /**
     * In-flight requests, by resolved URL.
     *
     * Two blocks can want the same bundle on one page — item-set-dashboard
     * and compare-newspapers both fetch `compare-newspapers/index.json`, and
     * every `.iwac-vis-minimal-item` container on an item page fetches
     * `template-summary.json` — and each was issuing its own request. Two
     * panels wrote private memos to work around it; this retires both.
     *
     * Only the IN-FLIGHT promise is shared: the entry is dropped when it
     * settles, so this is request de-duplication and not a response cache.
     * A caller that wants a fresh read after a data sync still gets one, and
     * a failure is not remembered.
     */
    var inFlight = {};

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
        // Bounded BY DEFAULT since v1.59.0. The two boot helpers passed the
        // timeout explicitly; the other 34 call sites — every lazy sidecar,
        // every secondary bundle, three per-item dashboards — did not, so a
        // stalled connection still left an eternal spinner everywhere the
        // boot helpers were not in the path. Opt out with `timeoutMs: 0`.
        var timeoutMs = Number(P.FETCH_TIMEOUT_MS) || 0;
        if (opts) {
            for (var k in opts) {
                if (!Object.prototype.hasOwnProperty.call(opts, k)) continue;
                if (k === 'timeoutMs') { timeoutMs = Number(opts[k]) || 0; continue; }
                init[k] = opts[k];
            }
        }
        // A caller with its own `signal` or custom init is asking for its own
        // request; only the plain shape is shareable.
        var shareable = !opts || (!opts.signal && !opts.method && !opts.body);
        if (shareable && inFlight[u]) return inFlight[u];

        var promise = runFetch(u, init, timeoutMs);
        if (!shareable) return promise;
        inFlight[u] = promise;
        var forget = function () { delete inFlight[u]; };
        promise.then(forget, forget);
        return promise;
    };

    function runFetch(u, init, timeoutMs) {
        if (!timeoutMs || typeof setTimeout !== 'function') return doFetch(u, init);

        // Bounded. `fetch` carries no timeout, so a request that never answers
        // — a captive portal, a proxy that swallows the connection, a phone
        // that lost the network between the HTML and the JSON — leaves the
        // promise pending for as long as the tab is open and whatever spinner
        // is waiting on it spinning for exactly that long. On This Day learned
        // this in v1.49.0 and grew its own AbortController race; the per-item
        // dashboards and every page block did not, so a stalled connection was
        // still an eternal spinner on an item page.
        //
        // The pending request is ABORTED, not merely ignored, so it stops
        // holding one of the browser's per-origin slots while the rest of the
        // page is still loading. `settled` makes the promise answer once, so a
        // late resolution after the timeout is dropped.
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (controller && !init.signal) init.signal = controller.signal;
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                if (controller) controller.abort();
                reject(new Error('timed out after ' + timeoutMs + ' ms for ' + u));
            }, timeoutMs);
            function finish(fn) {
                return function (value) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    fn(value);
                };
            }
            doFetch(u, init).then(finish(resolve), finish(reject));
        });
    }

    function doFetch(u, init) {
        return fetch(u, init).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + u);
            return r.json();
        });
    }

    /**
     * How long a block waits for its bundle before saying so.
     *
     * Deliberately looser than On This Day's 12 s: that block fetches one 7 KB
     * day file, while these fetch precomputed bundles that run to hundreds of
     * kilobytes, over connections this project's readers actually have. The
     * number that matters is not "fast" but "finite" — it is the difference
     * between a wait that ends and a spinner that does not.
     */
    P.FETCH_TIMEOUT_MS = 30000;

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
     * Aggregate runtime, in the largest unit that keeps the figure legible.
     *
     * `formatDuration` above renders ONE item's runtime as the h:mm:ss every
     * video player uses. A *sum* of runtimes is a different quantity and reads
     * wrong in that clock format: "281:24:00" is a timestamp, not a size, and
     * a reader compares it against the next bar by counting digits. So a total
     * arrives as "281 h", minutes below the hour, and one decimal only while
     * the leading digit alone would round two distinct channels together.
     *
     * Returns '' for anything non-positive, matching `formatDuration`, so a
     * caller can treat "no runtime recorded" as "render nothing".
     */
    P.formatTotalDuration = function (seconds) {
        var total = Math.round(Number(seconds));
        if (!isFinite(total) || total <= 0) return '';
        if (total < 3600) {
            return P.t('duration_minutes', { count: Math.max(1, Math.round(total / 60)) });
        }
        var hours = total / 3600;
        // One decimal under 10 h, where the integer part is too coarse to
        // separate neighbouring bars; whole hours above it, where it isn't.
        var shown = hours < 10
            ? Math.round(hours * 10) / 10
            : Math.round(hours);
        return P.t('duration_hours', { count: P.formatNumber(shown) });
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
     *
     * Pass `onRetry` and the error banner carries a Try-again control. A
     * timeout or a dropped connection is the one failure here that is worth
     * re-attempting from the same page, and a banner that only announces the
     * failure leaves reloading the whole document as the reader's only move.
     * The no-data banner never gets one: nothing the reader can do makes an
     * unpublished bundle appear.
     */
    P.buildFetchErrorState = function (err, messageKey, onRetry) {
        var msg = err && err.message ? String(err.message) : '';
        if (/\bHTTP 404\b/.test(msg)) return P.buildNoDataState();
        var el = P.buildErrorState(messageKey);
        if (typeof onRetry === 'function') {
            var btn = P.el('button', 'iwac-vis-btn iwac-vis-error__retry', P.t('Try again'));
            btn.type = 'button';
            btn.addEventListener('click', onRetry);
            el.appendChild(btn);
        }
        return el;
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
     * Build a `.iwac-vis-panel` wrapper with a title heading, an
     * optional description paragraph, and a `.iwac-vis-chart` child
     * that the controller can pass to `IWACVis.registerChart`.
     *
     * The heading defaults to `<h4>`, which is right for one panel among
     * several inside a dashboard whose own `<h3>` names the section. A block
     * that is the only thing on its own patch of page — a page block dropped
     * straight under the page's `<h1>` — passes `{ heading: 'h2' }` so the
     * document outline does not skip two levels. The LOOK does not follow the
     * level: `.iwac-vis-panel > h2` and `> h3` are styled alongside
     * `.iwac-vis-block h4` in iwac-core.css precisely so promoting a heading
     * stays an outline decision and never a type-scale one.
     *
     * `P.panelHeadingLevel` derives the right level from the block's own
     * heading where a caller has one to read.
     *
     * @param {string} className e.g. "iwac-vis-panel" or "iwac-vis-panel iwac-vis-panel--wide"
     * @param {string} titleText already-translated title
     * @param {string} [descriptionText] already-translated description shown below the title
     * @param {Object} [opts]
     * @param {string} [opts.heading='h4'] element for the panel title
     * @returns {{panel: HTMLElement, chart: HTMLElement}}
     */
    P.buildPanel = function (className, titleText, descriptionText, opts) {
        var panel = P.el('div', className);
        // `opts.key` names this panel for the embed route. Without one the
        // slug falls back to the panel's position in document order, which
        // is only stable while the block always renders the same panels in
        // the same order — and three blocks do not: sentiment-atlas inserts
        // panels per model, periodicals removes one when a bundle is short,
        // and anything built after the embed layer's settle window is never
        // enumerated at all. A named panel keeps its permalink regardless.
        if (opts && opts.key) panel.setAttribute('data-iwac-panel', opts.key);
        panel.appendChild(P.el((opts && opts.heading) || 'h4', null, titleText));
        if (descriptionText) {
            panel.appendChild(P.el('p', 'iwac-vis-panel-desc', descriptionText));
        }
        var chart = P.el('div', 'iwac-vis-chart');
        panel.appendChild(chart);
        return { panel: panel, chart: chart };
    };

    /**
     * The heading level a panel should take inside `el`'s block: one step
     * below whatever the block's own heading turned out to be.
     *
     * The block heading is a `headingLevel` decision made in PHP per surface
     * (iwac-block-shell.phtml), and v1.52.0 promoted the item-set block's to
     * `<h2>` so it stopped reading as a subsection of nothing. That left the
     * panels below it at their `<h4>` default, which turned an out-of-order
     * level into a SKIPPED one — h1 → h2 → h4 — and a skipped level is the
     * harder failure for anyone navigating by headings: it reads as a missing
     * section rather than a misplaced one.
     *
     * Read from the rendered DOM rather than plumbed through as another
     * parameter, because the block heading is the thing that actually has to
     * be matched, and it is right there. Falls back to `h4` — the level that
     * has always been correct under an `<h3>` block heading — whenever there
     * is no block wrapper or no heading in it.
     *
     * @param {Element} el  anything inside the block (the dashboard body).
     * @returns {string} 'h3' | 'h4' | 'h5'
     */
    P.panelHeadingLevel = function (el) {
        var block = el && el.closest ? el.closest('.iwac-vis-block') : null;
        if (!block) return 'h4';
        for (var i = 0; i < block.children.length; i++) {
            var m = /^H([2-4])$/.exec(block.children[i].tagName);
            if (m) return 'h' + (Number(m[1]) + 1);
        }
        return 'h4';
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
    /**
     * Build a grid's panels from one declaration, append them in order, and
     * return them keyed by name.
     *
     * WHY THIS AND NOT `dashboardLayout` (Tier 8 / S15)
     * ------------------------------------------------
     * The audit asked for the overviews to move onto `dashboardLayout`, and
     * measuring first said otherwise. What is actually repeated in those
     * blocks is panel CONSTRUCTION - a `buildPanel` line, an `appendChild`
     * line and an entry in the returned map, three times per panel - and
     * `dashboardLayout` is a RENDER dispatcher: it owns the drawing too, and
     * decides which panels exist from the data. These blocks decide from
     * their own facet state and draw through their own `draw()`. That
     * mismatch is exactly why the finding had to list six capabilities the
     * dispatcher was missing (interstitial rows, `slot.empty`, `chartClass`,
     * lazy slots, `byKey`, a facet hook) - each one is a render dispatcher
     * being taught not to dispatch.
     *
     * So the shared thing is the construction, and the blocks keep their
     * rendering. `references-overview` went from 74 lines to 34, and
     * `collection-overview` from 41 to 21, with no change to what either
     * draws.
     *
     * The measurement also revised the finding's scale downward: it counted
     * "~700 lines" across nine blocks, but v1.63.0's consolidation (E6-E10)
     * had already absorbed most of that. The nine blocks hold 66
     * `buildPanel` calls between them today, and three of them (press
     * bylines, lexical metrics, item-set dashboard) hold two or three each -
     * where any indirection would cost more than it saves. Those are left
     * alone.
     *
     * @param {HTMLElement} grid   the `buildChartsGrid()` container
     * @param {Array} specs        one entry per panel:
     *        {
     *          key:        'timeline',        // required; the returned map's key
     *          title:      'Items per year',  // required; already translated
     *          desc:       '...',             // optional description line
     *          wide:       true,              // adds `--wide`
     *          tall:       true,              // adds `--tall`
     *          className:  'iwac-vis-...',    // extra classes on the panel
     *          chartClass: 'iwac-vis-...',    // extra classes on the CHART host,
     *                                         //   for the height reservations
     *                                         //   (graph, treemap, chord)
     *          panelKey:   'timeline',        // `data-iwac-panel`; defaults to key
     *          skip:       false              // omit this panel entirely
     *        }
     * @returns {Object} `key -> {panel, chart}`, in declaration order
     */
    P.buildPanelSet = function (grid, specs) {
        var out = {};
        (specs || []).forEach(function (spec) {
            if (!spec || spec.skip) return;
            var className = 'iwac-vis-panel';
            if (spec.wide) className += ' iwac-vis-panel--wide';
            if (spec.tall) className += ' iwac-vis-panel--tall';
            if (spec.className) className += ' ' + spec.className;
            var built = P.buildPanel(className, spec.title, spec.desc || null, {
                key: spec.panelKey || spec.key
            });
            if (spec.chartClass) {
                spec.chartClass.split(/\s+/).forEach(function (cls) {
                    if (cls) built.chart.classList.add(cls);
                });
            }
            grid.appendChild(built.panel);
            out[spec.key] = built;
        });
        return out;
    };

    P.buildChartsGrid = function () {
        return P.el('div', 'iwac-vis-overview-grid');
    };

    /* ----------------------------------------------------------------- */
    /*  Item links                                                        */
    /* ----------------------------------------------------------------- */

    /**
     * The public page of an Omeka item, under the current site.
     *
     * One place for the `siteBase + '/item/' + o_id` build every card,
     * popup and click handler needs. The id is URL-encoded — Omeka ids
     * are integers, so this is a no-op today and a guard for the day a
     * slug or a stray string reaches it. Returns '' when there is no id,
     * so a caller can write `if (href)`; an empty site base yields a
     * site-relative `/item/<id>`, which is what a link inside a page
     * should carry when the block cannot tell which site it is on.
     *
     * @param {string} siteBase  e.g. "/s/westafrica"
     * @param {number|string} oId
     * @returns {string}
     */
    P.itemUrl = function (siteBase, oId) {
        if (oId == null || oId === '') return '';
        return (siteBase || '') + '/item/' + encodeURIComponent(String(oId));
    };

    /**
     * Send the reader to an item when a chart datum is clicked.
     *
     * `pick(params)` reads the id off the ECharts click params (a named
     * bar's `data.o_id`, a landscape point's index resolved through the
     * bundle, …) and returns it, or null / undefined for "not this one".
     * Without a site base — an embed rendered outside a site — nothing is
     * wired, matching the module's rule that a chart never navigates to a
     * page it cannot address.
     *
     * @param {ECharts|null} chart  as returned by ns.registerChart
     * @param {string} siteBase
     * @param {function(Object):(number|string|null|undefined)} pick
     */
    P.navigateOnClick = function (chart, siteBase, pick) {
        if (!chart || !siteBase) return;
        chart.on('click', function (params) {
            var href = P.itemUrl(siteBase, pick(params));
            if (href) window.location.href = href;
        });
    };
})();
