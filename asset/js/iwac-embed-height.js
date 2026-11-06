/**
 * IWAC Visualizations — the embed page's iframe height reporter.
 *
 * Posts the document height to the parent on load, on resize and on DOM
 * mutations, because charts populate asynchronously. The host page pairs this
 * with the listener emitted in the embed snippet.
 *
 * A single-panel frame (`body.iwac-embed-single`) says nothing until embed.js
 * has pinned its panel, or fallen back to the whole block, and marked the
 * body `iwac-embed-ready`. Until then the block is laid out but invisible
 * (iwac-embed.css), and its height is the whole block's: a host listening
 * from the first message grew an Albani Zaria frame to 34 458 px before it
 * settled on 605. A host that shows a placeholder until the first message
 * now gets one message, with the panel's height.
 *
 * A file rather than an inline `<script>` in the embed layout, for the reason
 * the on-view loader is (H6): a host with `script-src 'self'` refuses inline
 * script, and Omeka's headScript has no nonce plumbing.
 */
(function () {
    if (window.parent === window) return;
    var body = document.body;
    var last = 0;

    /**
     * Past this, a frame whose panel never resolved — a script that failed
     * to load, a block that never settles — is shown as it is rather than
     * left blank. Matches the data fetch timeout (P.FETCH_TIMEOUT_MS), after
     * which a slow bundle has turned into an error state anyway.
     */
    var HOLD_LIMIT_MS = 30000;

    function held() {
        return body.classList.contains('iwac-embed-single')
            && !body.classList.contains('iwac-embed-ready');
    }

    function post() {
        if (held()) return;
        var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        if (h && h !== last) {
            last = h;
            window.parent.postMessage({ type: 'iwac-embed-height', height: h }, '*');
        }
    }

    if (held()) {
        // The moment the frame is revealed, its first and right height.
        if ('MutationObserver' in window) {
            var mo = new MutationObserver(function () {
                if (held()) return;
                mo.disconnect();
                post();
            });
            mo.observe(body, { attributes: true, attributeFilter: ['class'] });
        }
        setTimeout(function () {
            if (held()) body.classList.add('iwac-embed-ready');
            post();
        }, HOLD_LIMIT_MS);
    }

    window.addEventListener('load', post);
    window.addEventListener('resize', post);
    if ('ResizeObserver' in window) {
        new ResizeObserver(post).observe(body);
    } else {
        setInterval(post, 1000);
    }
    // Nudge a few times early, before charts finish their first paint.
    var t = 0, iv = setInterval(function () { post(); if (++t > 20) clearInterval(iv); }, 300);
})();
