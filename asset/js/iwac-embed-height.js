/**
 * IWAC Visualizations — the embed page's iframe height reporter.
 *
 * Posts the document height to the parent on load, on resize and on DOM
 * mutations, because charts populate asynchronously. The host page pairs this
 * with the listener emitted in the embed snippet.
 *
 * A file rather than an inline `<script>` in the embed layout, for the reason
 * the on-view loader is (H6): a host with `script-src 'self'` refuses inline
 * script, and Omeka's headScript has no nonce plumbing.
 */
/* iframe height reporter — posts the document height to the parent on load,
   resize, and DOM mutations (charts populate asynchronously). The host page
   pairs this with the listener emitted in the embed snippet. */
(function () {
    if (window.parent === window) return;
    var last = 0;
    function post() {
        var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        if (h && h !== last) {
            last = h;
            window.parent.postMessage({ type: 'iwac-embed-height', height: h }, '*');
        }
    }
    window.addEventListener('load', post);
    window.addEventListener('resize', post);
    if ('ResizeObserver' in window) {
        new ResizeObserver(post).observe(document.body);
    } else {
        setInterval(post, 1000);
    }
    // Nudge a few times early, before charts finish their first paint.
    var t = 0, iv = setInterval(function () { post(); if (++t > 20) clearInterval(iv); }, 300);
})();
