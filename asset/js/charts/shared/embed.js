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

    /** Absolute embed URL for a block (and optional panel slug). */
    E.url = function (siteBase, slug, panelSlug) {
        var origin = (window.location && window.location.origin) || '';
        return origin + (siteBase || '') + '/iwac-embed/' + slug + (panelSlug ? '/' + panelSlug : '');
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
            var h4 = p.querySelector(':scope > h4') || p.querySelector('h4');
            out.push({ el: p, slug: slug, title: h4 ? (h4.textContent || '').trim() : '' });
        }
        return out;
    };

    /* ----------------------------------------------------------------- */
    /*  Copy-embed button                                                 */
    /* ----------------------------------------------------------------- */

    function renderBtn(btn, glyph, labelTxt) {
        btn.textContent = '';
        var g = document.createElement('span');
        g.className = 'iwac-vis-embed-btn__glyph';
        g.setAttribute('aria-hidden', 'true');
        g.textContent = glyph;
        btn.appendChild(g);
        if (labelTxt) {
            var l = document.createElement('span');
            l.textContent = labelTxt;
            btn.appendChild(l);
        }
    }

    /**
     * A copy-embed-code button. opts: { src, snippetTitle, height, label }.
     * With `label` it renders a glyph + text (whole-block button); otherwise
     * glyph-only (the dense panel toolbar). Reuses the shared `.iwac-vis-btn`
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
        renderBtn(btn, '</>', labelTxt);
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            E.copyToClipboard(E.snippet(opts.src, opts.snippetTitle || opts.title, opts.height))
                .then(function () {
                    btn.classList.add('iwac-vis-embed-btn--copied');
                    renderBtn(btn, '✓', labelTxt ? t('Copied!') : '');
                    clearTimeout(btn._iwacT);
                    btn._iwacT = setTimeout(function () {
                        btn.classList.remove('iwac-vis-embed-btn--copied');
                        renderBtn(btn, '</>', labelTxt);
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

    function addPanelButton(panelEl, src, title) {
        var bar = ensureToolbar(panelEl);
        if (!bar || bar.querySelector('.iwac-vis-embed-btn')) return; // idempotent
        bar.appendChild(E.makeButton({ src: src, snippetTitle: title, height: 520 }));
    }

    /**
     * Add a per-panel copy-embed button to every panel of an embeddable block.
     * The block opts in by carrying `data-embed-slug` (+ `data-site-base`).
     * No-op inside an embed (we never offer copy buttons within a frame) or
     * for a block with no embed slug.
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
        E.enumeratePanels(blockEl).forEach(function (info) {
            addPanelButton(info.el, E.url(siteBase, slug, info.slug), info.title);
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

    /**
     * Single-panel embed: keep only the requested panel, full-bleed. The
     * orchestrator builds the whole block (we have no per-orchestrator hook to
     * build one panel), so we prune the rest here. Non-target panels are
     * hidden (not removed) so their ECharts/MapLibre instances are never
     * disposed mid-flight. Unknown slug → leave the whole block intact.
     */
    E.selectPanel = function (blockEl, slug) {
        var panels = E.enumeratePanels(blockEl);
        var target = null;
        panels.forEach(function (info) { if (info.slug === slug) target = info.el; });
        if (!target) return;
        blockEl.classList.add('iwac-vis-block--single-panel');
        panels.forEach(function (info) {
            if (info.el === target) {
                info.el.setAttribute('data-iwac-panel-active', '1');
            } else {
                info.el.style.display = 'none';
            }
        });
        nudgeResize(blockEl);
    };

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

    /**
     * Run `cb` once the block has rendered its panels. Panels appear
     * asynchronously (after the orchestrator's data fetch) and in one
     * synchronous build pass, so we debounce briefly after the first panel
     * shows up to be sure the whole set is present.
     */
    function whenPanelsReady(blockEl, cb) {
        var fired = false, timer = null, obs = null;
        function go() {
            if (fired) return;
            fired = true;
            if (obs) obs.disconnect();
            clearTimeout(timer);
            cb();
        }
        if (blockEl.querySelector('.iwac-vis-panel')) {
            requestAnimationFrame(go);
            return;
        }
        obs = new MutationObserver(function () {
            if (blockEl.querySelector('.iwac-vis-panel')) {
                clearTimeout(timer);
                timer = setTimeout(go, 120);
            }
        });
        obs.observe(blockEl, { childList: true, subtree: true });
        // Safety valve: if the block errors out and never renders panels, stop
        // observing after 15s (cb then enumerates nothing — harmless).
        setTimeout(go, 15000);
    }

    function init() {
        var body = document.body;
        var inEmbed = body && body.classList.contains('iwac-embed-body');
        if (inEmbed) {
            // Single-panel embed: select the requested panel once it renders.
            if (body.classList.contains('iwac-embed-single')) {
                var pslug = body.getAttribute('data-embed-panel') || '';
                var block = document.querySelector('.iwac-vis-block');
                if (pslug && block) {
                    whenPanelsReady(block, function () { E.selectPanel(block, pslug); });
                }
            }
            return; // never add on-page copy buttons inside an embed
        }
        // Live site: add copy-embed buttons to every embeddable block.
        var blocks = document.querySelectorAll('.iwac-vis-block[data-embed-slug]');
        for (var i = 0; i < blocks.length; i++) {
            (function (b) { whenPanelsReady(b, function () { E.addEmbedButtons(b); }); })(blocks[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
