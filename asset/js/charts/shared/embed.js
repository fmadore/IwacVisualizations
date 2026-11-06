/**
 * IWAC Visualizations — Shared embed helpers
 *
 * One home for everything the "embed this visualization" feature needs, so
 * the embed format (iframe markup + host-side resize listener) lives in
 * exactly ONE place and is reused by:
 *   - the on-page copy-embed buttons added to live-site panels,
 *   - the /iwac-embed snippet gallery, and
 *   - the selection side of the single-panel embed route.
 *
 * Mirrors the DRE (ResourceVisualizations) embed module, adapted to IWAC's
 * per-block orchestrators. DRE has a central chart-key registry (RV.LAYOUTS)
 * so a single chart is addressed by name; IWAC has 12 bespoke orchestrators
 * with no such registry, so a single panel is addressed by its POSITION among
 * the rendered `.iwac-vis-panel` elements (slug `panel-<n>`). The enumeration
 * is deterministic, so the gallery side and the embed side agree on slugs
 * without a registry. Slugs are stable per site/locale (the same orchestrator
 * produces the same panel order every time).
 *
 * Depends on: the window.IWACVis namespace. The on-page button path also uses
 * IWACVis.panels (panel-toolbar.js) when present. Load after panels.js +
 * panel-toolbar.js, before the block orchestrators.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var E = ns.embed = ns.embed || {};

    /* ----------------------------------------------------------------- */
    /*  Snippet + URL + clipboard (the one shared embed format)           */
    /* ----------------------------------------------------------------- */

    // Host-side resize listener — the SINGLE shared copy. Pasted once per host
    // page (guarded by window.__iwacEmbedResize), it resizes each iframe to the
    // height the embed posts (paired with the reporter in
    // view/iwac-visualizations/layout/embed.phtml). The escaped <\/script>
    // keeps a copied snippet from closing an inline <script> on the host page;
    // its runtime value is a real </script>.
    E.RESIZE_LISTENER =
        '<script>(function(){if(window.__iwacEmbedResize)return;window.__iwacEmbedResize=1;'
        + "window.addEventListener('message',function(e){if(!e.data||e.data.type!=='iwac-embed-height')return;"
        + 'var f=document.getElementsByTagName(\'iframe\');for(var i=0;i<f.length;i++){'
        // `<\/script>`: the escape does nothing in JS, and everything if this
        // source is ever inlined into a page — an unescaped `</script>` would
        // end the tag mid-string.
        // eslint-disable-next-line no-useless-escape
        + "if(f[i].contentWindow===e.source){f[i].style.height=e.data.height+'px';}}});})();<\/script>";

    /** Build the copy-paste embed snippet (iframe + the resize listener). */
    E.snippet = function (src, title, height) {
        // Strip double-quotes so the title can't break out of the attribute.
        var safeTitle = String(title || '').replace(/"/g, '');
        return '<iframe src="' + src + '" title="' + safeTitle + '"'
            + ' loading="lazy" scrolling="no" style="width:100%;border:0;height:'
            + (height || 600) + 'px"></iframe>\n' + E.RESIZE_LISTENER;
    };

    /**
     * Absolute embed URL for a block, an optional panel slug, and an
     * optional query string (no leading `?`) — a configured block's
     * choice (`preset=ocr`) and the view a panel belongs to
     * (`laicite.view=trends`).
     */
    E.url = function (siteBase, slug, panelSlug, query) {
        var origin = (window.location && window.location.origin) || '';
        return origin + (siteBase || '') + '/iwac-embed/' + slug + (panelSlug ? '/' + panelSlug : '')
            + (query ? '?' + query : '');
    };

    /**
     * The query string an embed of this block needs: the configuration the
     * server rendered it with (`data-embed-query`), then the view state the
     * reader has reached.
     *
     * A block that makes its views addressable (`P.bindUrlState`, Topic
     * Explorer's `?topic=`) names its parameters on its root in
     * `data-url-state` — `laicite` owns `laicite.view`, `laicite.country`
     * and the rest. Laïcité's trends chart only exists while that view is
     * showing, so its embed without `laicite.view=trends` would frame the
     * overview and find nothing to pin. The pairs are copied as the address
     * bar spells them (the store keeps `,` and `:` readable); another
     * block's parameters on the same page stay behind.
     */
    E.stateQuery = function (blockEl) {
        if (!blockEl) return '';
        var parts = [];
        var fixed = blockEl.getAttribute('data-embed-query');
        if (fixed) parts.push(fixed);
        var names = (blockEl.getAttribute('data-url-state') || '').split(/\s+/).filter(Boolean);
        var search = (window.location && window.location.search) || '';
        if (names.length && search.length > 1) {
            search.slice(1).split('&').forEach(function (pair) {
                var key;
                try { key = decodeURIComponent(pair.split('=')[0].replace(/\+/g, ' ')); }
                catch (e) { return; }
                for (var i = 0; i < names.length; i++) {
                    if (key === names[i] || key.indexOf(names[i] + '.') === 0) {
                        parts.push(pair);
                        return;
                    }
                }
            });
        }
        return parts.join('&');
    };

    /**
     * An `<a>` pointing at a sibling block, or null when one cannot
     * honestly be built.
     *
     * Blocks that treat the same material from different angles want to
     * point at each other — Laïcité's `concurrence` frame and Scary Terms
     * are the same three word families counted for two different
     * questions, and a reader who finds one has no way to reach the
     * other. The obstacle is that a page block cannot know where an admin
     * mounted another block: that is per-site editorial placement, and
     * nothing in the block's own data records it.
     *
     * So the target is the module's own `/iwac-embed/<slug>` route, which
     * this module serves and which therefore always resolves. Both ends
     * of any such pair must be registered `embeddable` in BlockRegistry.
     *
     * Null inside an embed: forwarding a reader from one chrome-less
     * iframe page to another is not a kindness, and an embed dropped in
     * someone else's site should not grow outbound navigation.
     *
     * @param {string} slug   block slug from src/Site/BlockRegistry.php
     * @param {string} label  already-translated, reader-facing link text
     * @returns {HTMLElement|null}
     */
    E.crossBlockLink = function (slug, label) {
        if (!slug || !label) return null;
        if (document.body && document.body.classList.contains('iwac-embed-body')) return null;
        var blockEl = document.querySelector('.iwac-vis-block[data-embed-base]')
            || document.querySelector('.iwac-vis-block');
        if (!blockEl) return null;
        var base = blockEl.getAttribute('data-embed-base')
            || blockEl.getAttribute('data-site-base') || '';

        var link = document.createElement('a');
        link.className = 'iwac-vis-cross-block';
        link.href = E.url(base, slug);
        link.textContent = label;
        return link;
    };

    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* best-effort */ }
        document.body.removeChild(ta);
    }

    /** Copy text; resolves whether via the async clipboard API or the fallback. */
    E.copyToClipboard = function (text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text)['catch'](function () { fallbackCopy(text); });
        }
        fallbackCopy(text);
        return Promise.resolve();
    };

    /** Translate shim — iwac-i18n may be absent on the bare gallery page. */
    function t(s) { return (ns.t ? ns.t(s) : s); }

    /* ----------------------------------------------------------------- */
    /*  Panel enumeration (stable slugs without a registry)               */
    /* ----------------------------------------------------------------- */

    /**
     * Enumerate the top-level panels of a rendered block, stamping each with
     * a `data-iwac-panel` slug. "Top-level" excludes panels nested inside
     * another panel (e.g. a fullscreen clone). Returns [{ el, slug, title }].
     *
     * **A panel's own key wins over its position.** Positional slugs
     * (`panel-0`, `panel-1`, …) are only stable while a block always renders
     * the same panels in the same order, and three do not: sentiment-atlas
     * inserts panels per model, periodicals drops one when a bundle is short,
     * and a panel built after the settle window never gets counted. Each of
     * those silently renumbers every panel after it, so an embed permalink
     * starts showing a different chart. `P.buildPanel(…, { key })` sets the
     * attribute up front and this reads it back; positions remain the
     * fallback, and are numbered so an unkeyed panel cannot collide with a
     * keyed one.
     */
    E.enumeratePanels = function (blockEl) {
        if (!blockEl) return [];
        var all = blockEl.querySelectorAll('.iwac-vis-panel');
        var out = [];
        var used = {};
        for (var i = 0; i < all.length; i++) {
            var p = all[i];
            if (p.parentElement && p.parentElement.closest('.iwac-vis-panel')) continue;
            var slug = p.getAttribute('data-iwac-panel') || ('panel-' + out.length);
            // Two panels claiming one key would make the permalink ambiguous;
            // suffix the later ones rather than silently shadowing.
            if (used[slug]) slug = slug + '-' + used[slug];
            used[slug] = (used[slug] || 0) + 1;
            p.setAttribute('data-iwac-panel', slug);
            // At any level: a panel promoted to <h2>/<h3> was listed untitled.
            var heading = ns.panels && ns.panels.panelTitle ? ns.panels.panelTitle(p) : null;
            out.push({ el: p, slug: slug, title: heading ? (heading.textContent || '').trim() : '' });
        }
        return out;
    };

    /* ----------------------------------------------------------------- */
    /*  Copy-embed button                                                 */
    /* ----------------------------------------------------------------- */

    function renderBtn(btn, icon, labelTxt) {
        ns.panels.setIcon(btn, icon, labelTxt);
    }

    /**
     * A copy-embed-code button. opts: { src, snippetTitle, height, label }.
     * `src` is a URL or a function returning one, read at click time — the
     * reader may have changed the view since the button was made.
     * With `label` it renders an icon + text (whole-block button); otherwise
     * icon-only (the dense panel toolbar). Reuses the shared `.iwac-vis-btn`
     * skin so it follows the IWAC theme like every other control.
     */
    E.makeButton = function (opts) {
        var labelTxt = opts.label || '';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'iwac-vis-btn iwac-vis-embed-btn'
            + (labelTxt ? ' iwac-vis-embed-btn--labeled' : '');
        btn.title = t('Copy embed code');
        btn.setAttribute('aria-label', t('Copy embed code'));
        renderBtn(btn, 'code', labelTxt);
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var src = typeof opts.src === 'function' ? opts.src() : opts.src;
            E.copyToClipboard(E.snippet(src, opts.snippetTitle || opts.title, opts.height))
                .then(function () {
                    btn.classList.add('iwac-vis-embed-btn--copied');
                    renderBtn(btn, 'check', labelTxt ? t('Copied!') : '');
                    clearTimeout(btn._iwacT);
                    btn._iwacT = setTimeout(function () {
                        btn.classList.remove('iwac-vis-embed-btn--copied');
                        renderBtn(btn, 'code', labelTxt);
                    }, 1600);
                });
        });
        return btn;
    };

    function ensureToolbar(panelEl) {
        var P = ns.panels;
        if (P && P.ensureToolbar) return P.ensureToolbar(panelEl);
        // Fallback (panel-toolbar.js not loaded) — mirror its container.
        var bar = panelEl.querySelector(':scope > .iwac-vis-panel-toolbar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'iwac-vis-panel-toolbar';
            panelEl.appendChild(bar);
        }
        return bar;
    }

    function addPanelButton(blockEl, panelEl, base, slug, title) {
        var bar = ensureToolbar(panelEl);
        if (!bar || bar.querySelector('.iwac-vis-embed-btn')) return; // idempotent
        bar.appendChild(E.makeButton({
            // The panel's slug is re-read too: enumeration may have renamed a
            // positional panel since this button was made.
            src: function () {
                return E.url(base, slug, panelEl.getAttribute('data-iwac-panel') || '', E.stateQuery(blockEl));
            },
            snippetTitle: title,
            height: 520
        }));
    }

    /**
     * The one button of a block that has no panels to pin — a Pipeline
     * Explainer diagram, a timeline — at the block's foot. The block opts in
     * with `data-embed-whole`; a block that will build panels must not, since
     * it has none either while its data is still loading.
     */
    function addWholeButton(blockEl, base, slug) {
        if (blockEl.querySelector(':scope > .iwac-vis-embed-whole')) return; // idempotent
        var heading = blockEl.querySelector('h2, h3, h4');
        var row = document.createElement('div');
        row.className = 'iwac-vis-embed-whole';
        row.appendChild(E.makeButton({
            src: function () { return E.url(base, slug, '', E.stateQuery(blockEl)); },
            snippetTitle: heading ? (heading.textContent || '').trim() : document.title,
            label: t('Copy embed code'),
            height: 600
        }));
        blockEl.appendChild(row);
    }

    /**
     * Add a copy-embed button to every panel of an embeddable block, or the
     * one whole-block button to a block declared `data-embed-whole`.
     * The block opts in by carrying `data-embed-slug` (+ `data-site-base`).
     * No-op inside an embed (we never offer copy buttons within a frame) or
     * for a block with no embed slug. Idempotent: it runs again whenever the
     * block's panels change (`watchPanels`).
     */
    E.addEmbedButtons = function (blockEl) {
        if (!blockEl) return;
        if (document.body && document.body.classList.contains('iwac-embed-body')) return;
        var slug = blockEl.getAttribute('data-embed-slug');
        if (!slug) return;
        // data-embed-base is always emitted alongside data-embed-slug; fall
        // back to data-site-base for safety.
        var siteBase = blockEl.getAttribute('data-embed-base')
            || blockEl.getAttribute('data-site-base') || '';
        // A block that places its own copy-embed control (On This Day puts it
        // in its footer row, beside the see-all toggle) gets none from here.
        if (blockEl.hasAttribute('data-embed-own')) return;
        if (blockEl.hasAttribute('data-embed-whole')) {
            addWholeButton(blockEl, siteBase, slug);
            return;
        }
        E.enumeratePanels(blockEl).forEach(function (info) {
            addPanelButton(blockEl, info.el, siteBase, slug, info.title);
        });
    };

    /* ----------------------------------------------------------------- */
    /*  Single-panel embed selection                                     */
    /* ----------------------------------------------------------------- */

    /**
     * Re-measure after the single-panel layout settles.
     *
     * This used to fire seven synthetic `window.resize` events over 1.5
     * seconds and hope one of them landed after the reflow — which also woke
     * every other resize listener on the page six more times than necessary.
     * A ResizeObserver on the block answers when the layout actually changes,
     * and `IWACVis.resizeCharts()` re-measures the instances the module
     * tracks rather than broadcasting to the window.
     */
    function nudgeResize(blockEl) {
        var resize = function () {
            if (ns.resizeCharts) ns.resizeCharts();
            else { try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ } }
        };
        resize();
        if (!blockEl || typeof ResizeObserver === 'undefined') return;
        // One observer, disconnected once the box has stopped changing —
        // the panel is full-bleed from here on and its own per-chart
        // observers take over.
        var settle = null;
        var ro = new ResizeObserver(function () {
            resize();
            if (settle) clearTimeout(settle);
            settle = setTimeout(function () { ro.disconnect(); }, 500);
        });
        ro.observe(blockEl);
    }

    // Never hidden by isolate(): they render nothing, and a stylesheet or a
    // data island a block keeps beside its panels must keep working.
    var INERT = /^(SCRIPT|STYLE|LINK|TEMPLATE)$/;

    /**
     * Hide everything in the block but `target` and the wrappers around it:
     * at each step from the panel up to the block root, every sibling. That
     * is the block's header, its figures strip, its controls row, the other
     * sections — a single-panel embed used to hide only the other PANELS, so
     * `/iwac-embed/laicite/panel-1` framed its table under the dossier's
     * whole masthead, tabs and view switch. Hidden, not removed, for the
     * reason the panels are. Idempotent: run again when content lands late.
     */
    function isolate(blockEl, target) {
        for (var node = target; node && node !== blockEl; node = node.parentElement) {
            var parent = node.parentElement;
            if (!parent) return;
            for (var sib = parent.firstElementChild; sib; sib = sib.nextElementSibling) {
                if (sib === node || INERT.test(sib.tagName) || sib.style.display === 'none') continue;
                sib.style.display = 'none';
            }
        }
    }

    /**
     * Single-panel embed: keep only the requested panel, full-bleed. An
     * orchestrator may build only the part that holds it (`ctx.embedPanel`,
     * P.embedPanel); most build the whole block, so we prune the rest
     * here either way. Everything else is
     * hidden (not removed) so ECharts/MapLibre instances are never
     * disposed mid-flight. Unknown slug → leave the whole block intact and
     * return false.
     */
    E.selectPanel = function (blockEl, slug) {
        var target = null;
        E.enumeratePanels(blockEl).forEach(function (info) { if (info.slug === slug) target = info.el; });
        if (!target) return false;
        blockEl.classList.add('iwac-vis-block--single-panel');
        target.setAttribute('data-iwac-panel-active', '1');
        isolate(blockEl, target);
        nudgeResize(blockEl);
        return true;
    };

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

    // Panels arrive in synchronous build passes; this long after the last
    // mutation, a pass is over.
    var SETTLE_MS = 120;

    /**
     * Call `cb` whenever the block's DOM has settled after a change, for as
     * long as the page lives — and once now, if it already has panels or
     * server-rendered content.
     *
     * This used to fire ONCE, 120 ms after the first panel appeared, and
     * every panel that arrived later never got an embed button. Most panels
     * arrive later: Albani Zaria builds eleven of its twenty as their
     * sections scroll into view, and every view of Laïcité, Scary Terms or
     * the Sentiment Atlas past the first is built when the reader switches
     * to it. `cb` must be idempotent.
     */
    function watchBlock(blockEl, cb) {
        var timer = null;
        function run() { timer = null; cb(); }
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(function () {
                if (timer) clearTimeout(timer);
                timer = setTimeout(run, SETTLE_MS);
            }).observe(blockEl, { childList: true, subtree: true });
        }
        if (blockEl.querySelector('.iwac-vis-panel') || blockEl.hasAttribute('data-embed-whole')) {
            requestAnimationFrame(run);
        }
    }

    /**
     * Show a single-panel frame: the pinned panel, or the whole block when
     * the panel is not to be found.
     *
     * Until then iwac-embed.css keeps the block invisible (laid out, so its
     * charts measure, but not painted) and iwac-embed-height.js holds its
     * height messages. A frame used to paint the whole block first and hide
     * the rest afterwards: `/iwac-embed/albani-sermons/albani-overlap-pairs`
     * showed the exhibition's masthead and every section, and told its host
     * to grow to 26 833, then 31 169, then 34 458 px before settling on 605.
     */
    function reveal() {
        var body = document.body;
        if (body && !body.classList.contains('iwac-embed-ready')) body.classList.add('iwac-embed-ready');
    }
    E.reveal = reveal;

    var LOADING = '.iwac-vis-loading';

    /**
     * Whether something in the block is still on its way: a loading state
     * that is not a placeholder in a section waiting to be seen (Albani's
     * sections show theirs from the start, and those never resolve in a
     * frame unless something renders them).
     */
    function busy(blockEl) {
        var P = ns.panels;
        var parked = P && P.lazyTargets ? P.lazyTargets(blockEl) : [];
        var states = blockEl.querySelectorAll(LOADING);
        for (var i = 0; i < states.length; i++) {
            var inParked = false;
            for (var k = 0; k < parked.length; k++) {
                if (parked[k].contains(states[i])) { inParked = true; break; }
            }
            if (!inParked) return true;
        }
        return false;
    }

    /**
     * Single-panel embed: pin the requested panel as soon as it exists.
     *
     * It may not exist when the first panels do. It may sit in a section
     * that renders on view (`P.lazyInit`), and nothing in a frame scrolls
     * there; or a fetch may still be building it. So each time the block
     * settles without it, the sections still waiting to be seen that could
     * hold it are rendered now (`P.flushLazy(block, slug)` — a section that
     * names its panels and not this one keeps its fetch), and the next
     * settle looks again. Once pinned, the same pass keeps the panel alone
     * as late content lands beside it.
     *
     * The frame is revealed when the panel is pinned, or when it cannot be:
     * a block with no panels to pin (`data-embed-whole`), or a settle with
     * nothing left to render and nothing loading — a block that failed to
     * load, or an unknown slug, which leaves the whole block as it always
     * has. The watch goes on, so a panel that lands even later is still
     * pinned.
     */
    function pinWhenReady(blockEl, slug) {
        var pinned = null;
        watchBlock(blockEl, function () {
            if (pinned) { isolate(blockEl, pinned); return; }
            if (blockEl.hasAttribute('data-embed-whole')) { reveal(); return; }
            if (blockEl.querySelector('.iwac-vis-panel') && E.selectPanel(blockEl, slug)) {
                pinned = blockEl.querySelector('[data-iwac-panel-active]');
                reveal();
                return;
            }
            var P = ns.panels;
            var fired = P && P.flushLazy ? P.flushLazy(blockEl, slug) : 0;
            if (!fired && !busy(blockEl)) reveal();
        });
    }

    function init() {
        var body = document.body;
        var inEmbed = body && body.classList.contains('iwac-embed-body');
        if (inEmbed) {
            // Single-panel embed: select the requested panel once it renders.
            if (body.classList.contains('iwac-embed-single')) {
                var pslug = body.getAttribute('data-embed-panel') || '';
                var block = document.querySelector('.iwac-vis-block');
                if (pslug && block) pinWhenReady(block, pslug);
                else reveal(); // nothing to pin: show what there is
            }
            return; // never add on-page copy buttons inside an embed
        }
        // Live site: add copy-embed buttons to every embeddable block, and
        // to every panel it builds later.
        var blocks = document.querySelectorAll('.iwac-vis-block[data-embed-slug]');
        for (var i = 0; i < blocks.length; i++) {
            (function (b) { watchBlock(b, function () { E.addEmbedButtons(b); }); })(blocks[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
