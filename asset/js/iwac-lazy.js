/**
 * IWAC Visualizations — the on-view asset loader.
 *
 * **Why this is a file and not an inline script.** It was ~50 lines of
 * string-concatenated JavaScript built in `view/common/iwac-assets.phtml`,
 * which made it the only inline script on a block page — so a host with a
 * `script-src 'self'` Content-Security-Policy broke every block on the site,
 * with no way to fix it: Omeka's `headScript` has no nonce plumbing. It also
 * meant the one piece of JavaScript that decides when everything else loads
 * was the only piece with no linting and no tests, and `assets.test.js` had
 * to regex it back out of rendered PHP to check anything about it (H6).
 *
 * The per-block payload travels as
 * `<script type="application/json" class="iwac-vis-lazy-manifest">` — inert
 * under any CSP, because it is data. This file reads every one of them.
 *
 * **What it does.** A page block declares the scripts, stylesheets and ESM
 * import it needs. Nothing is fetched until a block nears the viewport
 * (`IntersectionObserver`, 400 px margin), because ECharts and MapLibre
 * together are about a megabyte and most visitors to a page never scroll to
 * the chart. Several blocks on one page merge into a single queue and the
 * first one to arm wins.
 *
 * **The ordering rule.** Classic scripts are injected with `async = false`,
 * which keeps them one in-order list — that is what lets `shared/graph-force.js`
 * read the `d3` global synchronously. MapLibre 6 is ESM-only and cannot ride
 * that chain, so it is `import()`ed IN PARALLEL and the promise is published
 * as `IWACVisLazy.mjsP`: only a panel that draws a map waits for it, through
 * `P.whenMaplibre()`. `npm run lint:maplibre` fails the build on a consumer
 * that reads the global without awaiting.
 */
(function () {
    'use strict';

    var S = window.IWACVisLazy = (window.IWACVisLazy || {
        q: [], css: [], mjs: null, mjsP: null, armed: false, done: false
    });

    function readManifests() {
        var nodes = document.querySelectorAll('.iwac-vis-lazy-manifest');
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node.dataset.iwacRead) continue;
            node.dataset.iwacRead = '1';
            var payload;
            try {
                payload = JSON.parse(node.textContent || '{}');
            } catch (e) {
                if (window.console && console.error) {
                    console.error('IWAC: unreadable lazy manifest', e);
                }
                continue;
            }
            (payload.scripts || []).forEach(function (u) {
                if (S.q.indexOf(u) < 0) S.q.push(u);
            });
            (payload.css || []).forEach(function (u) {
                if (S.css.indexOf(u) < 0) S.css.push(u);
            });
            // One map-capable block on the page is enough to arm the import;
            // blocks that merge in later share the single resolved namespace.
            if (payload.mjs && !S.mjs) S.mjs = payload.mjs;
        }
    }

    function inject(list) {
        list.forEach(function (src) {
            var s = document.createElement('script');
            s.src = src;
            // NOT async: this is what keeps the whole list in order.
            s.async = false;
            document.head.appendChild(s);
        });
    }

    function load() {
        if (S.done) return;
        S.done = true;

        S.css.forEach(function (href) {
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = href;
            document.head.appendChild(l);
        });

        // The whole chain starts NOW — nothing is held back.
        inject(S.q);
        if (!S.mjs) return;

        // The MapLibre module graph resolves alongside the chain, and the
        // promise is PUBLISHED. A rejection is re-thrown so a map panel can
        // show a real error state, and absorbed once here so a CDN outage on
        // a page whose map is never scrolled into view does not log an
        // unhandled rejection.
        S.mjsP = import(S.mjs).then(function (m) {
            window.maplibregl = m;
            return m;
        }, function (e) {
            if (window.console && console.error) {
                console.error('IWAC: MapLibre failed to load', e);
            }
            throw e;
        });
        S.mjsP.catch(function () { /* handled by the awaiting panel */ });
    }

    function arm() {
        readManifests();
        if (S.armed) return;
        S.armed = true;
        var blocks = document.querySelectorAll('.iwac-vis-block');
        if (!blocks.length || !('IntersectionObserver' in window)) {
            load();
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) {
                    io.disconnect();
                    load();
                    return;
                }
            }
        }, { rootMargin: '400px 0px' });
        for (var i = 0; i < blocks.length; i++) io.observe(blocks[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arm);
    } else {
        arm();
    }
})();
