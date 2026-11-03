/**
 * IWAC Visualizations — the /iwac-embed snippet gallery.
 *
 * Fills each `.iwac-embed-card` the gallery view renders with its copy-paste
 * snippet, wires the Copy buttons, and — once a card's same-origin preview
 * has rendered — lists a per-panel snippet for every panel of a multi-panel
 * block. Every snippet is built by `IWACVis.embed` (charts/shared/embed.js,
 * inside the shared-core bundle the gallery loads first), the one home of
 * the embed format, so nothing about it is restated here.
 *
 * A file rather than the inline `<script>` it used to be, for the reason the
 * on-view loader and the iframe height reporter are (H6): a host with
 * `script-src 'self'` refuses inline script, and Omeka's headScript has no
 * nonce plumbing. The two translated button labels arrive as data attributes
 * on `.iwac-embed-wrap`.
 *
 * Until this file existed the gallery loaded `js/charts/shared/embed.min.js`,
 * a per-file build the bundling commit deleted: the request 404'd,
 * `IWACVis.embed` was never defined, and the inline script returned before
 * rendering a single snippet.
 */
(function () {
    'use strict';

    function init() {
        var E = (window.IWACVis && window.IWACVis.embed) || null;
        if (!E) return; // shared-core missing — leave the live previews as-is
        var wrap = document.querySelector('.iwac-embed-wrap');
        if (!wrap) return;
        var copyLabel = wrap.getAttribute('data-label-copy') || 'Copy';
        var doneLabel = wrap.getAttribute('data-label-copied') || 'Copied!';

        function wireCopy(btn, getText) {
            btn.addEventListener('click', function () {
                E.copyToClipboard(getText()).then(function () {
                    btn.textContent = doneLabel;
                    btn.classList.add('copied');
                    setTimeout(function () { btn.textContent = copyLabel; btn.classList.remove('copied'); }, 1600);
                });
            });
        }

        Array.prototype.forEach.call(wrap.querySelectorAll('.iwac-embed-card'), function (card) {
            var slug = card.getAttribute('data-slug');
            var siteBase = card.getAttribute('data-site-base') || '';
            // A configured block's choice (`preset=ocr`), carried by every
            // snippet of its card.
            var query = card.getAttribute('data-query') || '';
            var label = card.getAttribute('data-label') || slug;
            var blockSnippet = E.snippet(E.url(siteBase, slug, '', query), label, 600);

            // Whole-block snippet → the <pre> + its Copy button.
            var code = card.querySelector('.iwac-embed-snippet');
            if (code) code.textContent = blockSnippet;
            var blockBtn = card.querySelector('[data-embed-block]');
            if (blockBtn) wireCopy(blockBtn, function () { return blockSnippet; });

            // Per-panel snippets: read the live preview (same origin) once it
            // has rendered, then enumerate its panels exactly as the embed
            // route will, so the panel slugs line up. Only shown for
            // multi-panel blocks.
            var iframe = card.querySelector('.iwac-embed-preview');
            var panelsBox = card.querySelector('.iwac-embed-panels');
            var list = card.querySelector('.iwac-embed-panel-list');
            if (!iframe || !panelsBox || !list) return;

            function renderPanels(panels) {
                list.textContent = '';
                panels.forEach(function (info) {
                    var title = info.title || info.slug;
                    var snippet = E.snippet(E.url(siteBase, slug, info.slug, query), label + ' — ' + title, 520);
                    var li = document.createElement('li');
                    var name = document.createElement('span');
                    name.className = 'iwac-embed-panel-name';
                    name.textContent = title;
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'iwac-embed-copy iwac-embed-copy--sm';
                    btn.textContent = copyLabel;
                    wireCopy(btn, function () { return snippet; });
                    li.appendChild(name);
                    li.appendChild(btn);
                    list.appendChild(li);
                });
                panelsBox.hidden = false;
            }

            /**
             * Keep the list in step with the preview. A block's first panels
             * are not all of them: Albani Zaria renders most of its sections
             * only as they scroll into view, which nothing does inside a
             * preview, so those are rendered now (`flushLazy`, in the
             * preview's own window) and the list follows as they land.
             */
            var followed = false;
            function follow(block, win) {
                if (followed) return; // `load` and the cached-load check can both get here
                followed = true;
                var timer = null;
                var MO = win.MutationObserver || window.MutationObserver;
                new MO(function () {
                    clearTimeout(timer);
                    timer = setTimeout(function () {
                        var panels = E.enumeratePanels(block);
                        if (panels.length > 1) renderPanels(panels);
                    }, 300);
                }).observe(block, { childList: true, subtree: true });
                var P = win.IWACVis && win.IWACVis.panels;
                if (P && P.flushLazy) P.flushLazy(block);
            }

            function tryEnumerate(attemptsLeft) {
                var doc;
                try { doc = iframe.contentDocument; } catch (e) { return; } // cross-origin guard
                var block = doc && doc.querySelector('.iwac-vis-block');
                var panels = block ? E.enumeratePanels(block) : [];
                if (panels.length > 1) {
                    renderPanels(panels);
                    follow(block, iframe.contentWindow);
                } else if (attemptsLeft > 0) {
                    setTimeout(function () { tryEnumerate(attemptsLeft - 1); }, 400);
                }
            }

            iframe.addEventListener('load', function () { tryEnumerate(12); });
            // Already loaded (cache) before the listener attached.
            try {
                if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                    tryEnumerate(12);
                }
            } catch (e) { /* cross-origin — ignore */ }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
