/** Per-block dependency loading with shared promises and recoverable failures. */
(function () {
    'use strict';
    var S = window.IWACVisLazy = window.IWACVisLazy || {};
    var scripts = {}, styles = {}, blocks = [];
    // Subresource Integrity, by URL, merged from every block's manifest: a
    // pinned CDN file hashes the same wherever it is requested from.
    var integrity = {};
    S.mjsP = null;

    /**
     * The page's language, by the same rule as iwac-i18n.js's detectLocale —
     * and published, because iwac-i18n.js adopts it: a bundle built per
     * locale carries only that locale's strings, so the language `t()` uses
     * has to be the one the loader fetched, not a second opinion.
     */
    S.locale = (function () {
        var root = document.documentElement;
        var raw = ((root && root.getAttribute('lang')) || 'en').toLowerCase();
        return raw.split(/[-_]/)[0] === 'fr' ? 'fr' : 'en';
    })();

    /** A manifest entry's URL: itself, or its `{locale: url}` variant for this page. */
    function pick(entry) {
        if (!entry || typeof entry === 'string') return entry;
        return entry[S.locale] || entry.en || entry[Object.keys(entry)[0]];
    }

    /**
     * Stamp a node with its file's recorded hash. SRI on a cross-origin
     * file also needs CORS, so `crossorigin` comes with it — and must come
     * on the matching `preload` too, or the browser cannot reuse the
     * preloaded response and fetches the file a second time.
     */
    function withIntegrity(node, url) {
        var hash = integrity[url];
        if (hash) {
            node.integrity = hash;
            node.crossOrigin = 'anonymous';
        }
        return node;
    }
    S.whenVisible = function (host, start) {
        var block = blocks.filter(function (b) { return b.host === host; })[0];
        if (!block) { start(); return; } // Standalone fixtures / legacy themes.
        if (block.ready) start();
        else block.callbacks.push(start);
    };

    function script(src) {
        if (scripts[src]) return scripts[src];
        scripts[src] = new Promise(function (resolve, reject) {
            var node = document.createElement('script');
            var timer = setTimeout(function () { finish(new Error('Script timed out: ' + src)); }, 30000);
            var settled = false;
            function finish(err) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                node.onload = node.onerror = null;
                if (err) {
                    node.remove();
                    delete scripts[src];
                    reject(err);
                } else resolve();
            }
            withIntegrity(node, src);
            node.src = src;
            node.async = false;
            node.onload = function () { finish(); };
            node.onerror = function () { finish(new Error('Script failed: ' + src)); };
            document.head.appendChild(node);
        });
        return scripts[src];
    }

    function supportsModulePreload() {
        var link = document.createElement('link');
        return !!(link.relList && link.relList.supports && link.relList.supports('modulepreload'));
    }

    /** Settles when a `modulepreload` of `href` has fetched (and verified) it. */
    function modulePreload(href) {
        return new Promise(function (resolve, reject) {
            var link = withIntegrity(document.createElement('link'), href);
            link.rel = 'modulepreload';
            link.onload = function () { resolve(); };
            link.onerror = function () { reject(new Error('Module failed: ' + href)); };
            link.href = href;
            document.head.appendChild(link);
        });
    }

    /**
     * Import MapLibre, in parallel with the classic chain.
     *
     * The entry and its chunk are `modulepreload`ed together: the entry's
     * static import of the chunk is otherwise discovered only once the entry
     * has downloaded, a second round trip in series. The preloads are also
     * how the modules get their integrity check — `import()` takes no
     * `integrity` — so the import waits for the entry's preload to settle and
     * then resolves against the module map entry it made, verified. Where
     * `modulepreload` is unsupported the import simply runs unhinted.
     */
    function mapModule(url, preload) {
        if (S.mjsP) return;
        var ready = Promise.resolve();
        if (supportsModulePreload()) {
            var hinted = [url].concat(preload || []).map(modulePreload);
            // The chunk's own failure surfaces through the import that needs it.
            hinted.slice(1).forEach(function (p) { p.catch(function () {}); });
            ready = hinted[0];
        }
        var pending = ready.then(function () { return import(url); }).then(function (m) {
            window.maplibregl = m;
            return m;
        });
        S.mjsP = pending;
        // Map panels already chained on `pending` display their own error.
        // Forget a failed import rather than keeping it: a transient CDN
        // failure would otherwise be final for the page, and neither Retry
        // nor a second map block nearing the viewport could import again.
        pending.catch(function () {
            if (S.mjsP === pending) S.mjsP = null;
        });
    }

    function showError(block) {
        var host = block.host;
        if (!host) return;
        var region = host.querySelector('.iwac-vis-loading');
        if (!region) {
            region = document.createElement('div');
            host.appendChild(region);
        }
        region.textContent = '';
        region.setAttribute('role', 'alert');
        var message = document.createElement('p');
        message.textContent = block.payload.error || 'The visualization could not load.';
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = block.payload.retry || 'Retry';
        button.addEventListener('click', function () {
            button.disabled = true;
            load(block).catch(function () {});
        });
        region.appendChild(message);
        region.appendChild(button);
    }

    function load(block) {
        if (block.pending) return block.pending;
        var payload = block.payload;
        var hashes = payload.integrity || {};
        Object.keys(hashes).forEach(function (url) { integrity[url] = hashes[url]; });
        (payload.css || []).forEach(function (href) {
            if (styles[href]) return;
            styles[href] = true;
            var link = withIntegrity(document.createElement('link'), href);
            link.rel = 'stylesheet'; link.href = href;
            link.onerror = function () { delete styles[href]; link.remove(); };
            document.head.appendChild(link);
        });
        if (payload.mjs) mapModule(payload.mjs, payload.mjsPreload);
        // Preload concurrently, execute in dependency order. A failed dependency
        // prevents dependent code from executing and poisoning its retry.
        var list = (payload.scripts || []).map(pick);
        list.forEach(function (src) {
            if (scripts[src]) return;
            var link = withIntegrity(document.createElement('link'), src);
            link.rel = 'preload'; link.as = 'script'; link.href = src;
            document.head.appendChild(link);
        });
        var chain = Promise.resolve();
        list.forEach(function (src) {
            chain = chain.then(function () { return script(src); });
        });
        block.pending = chain.then(function () {
            block.ready = true;
            var callbacks = block.callbacks.splice(0);
            callbacks.forEach(function (start) { start(); });
        }).catch(function (err) {
            block.pending = null;
            console.error('IWAC visualization dependencies:', err);
            showError(block);
            throw err;
        });
        return block.pending;
    }

    function arm() {
        var manifests = document.querySelectorAll('.iwac-vis-lazy-manifest');
        var observer = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                observer.unobserve(entry.target);
                blocks.forEach(function (block) {
                    if (block.host === entry.target) load(block).catch(function () {});
                });
            });
        }, { rootMargin: '400px 0px' }) : null;
        for (var i = 0; i < manifests.length; i++) {
            var node = manifests[i];
            var host = node.nextElementSibling;
            var payload;
            try { payload = JSON.parse(node.textContent); }
            catch (err) { console.error('IWAC: unreadable lazy manifest', err); continue; }
            var block = { host: host, payload: payload, callbacks: [], ready: false, pending: null };
            blocks.push(block);
        }
        blocks.forEach(function (block) {
            if (observer && block.host) observer.observe(block.host);
            else load(block).catch(function () {});
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm);
    else arm();
})();
