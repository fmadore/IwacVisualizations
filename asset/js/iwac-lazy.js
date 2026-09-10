/** Per-block dependency loading with shared promises and recoverable failures. */
(function () {
    'use strict';
    var S = window.IWACVisLazy = window.IWACVisLazy || {};
    var scripts = {}, styles = {}, blocks = [];
    S.mjsP = null;
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
            node.src = src;
            node.async = false;
            node.onload = function () { finish(); };
            node.onerror = function () { finish(new Error('Script failed: ' + src)); };
            document.head.appendChild(node);
        });
        return scripts[src];
    }

    function mapModule(url) {
        if (S.mjsP) return;
        S.mjs = url;
        S.mjsP = import(S.mjs).then(function (m) {
            window.maplibregl = m;
            return m;
        });
        S.mjsP.catch(function () { /* Map panels display their own error. */ });
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
        (payload.css || []).forEach(function (href) {
            if (styles[href]) return;
            styles[href] = true;
            var link = document.createElement('link');
            link.rel = 'stylesheet'; link.href = href;
            link.onerror = function () { delete styles[href]; link.remove(); };
            document.head.appendChild(link);
        });
        if (payload.mjs) mapModule(payload.mjs);
        // Preload concurrently, execute in dependency order. A failed dependency
        // prevents dependent code from executing and poisoning its retry.
        (payload.scripts || []).forEach(function (src) {
            if (scripts[src]) return;
            var link = document.createElement('link');
            link.rel = 'preload'; link.as = 'script'; link.href = src;
            document.head.appendChild(link);
        });
        var chain = Promise.resolve();
        (payload.scripts || []).forEach(function (src) {
            chain = chain.then(function () { return script(src); });
        });
        block.pending = chain.then(function () {
            if (window.IWACVis && window.IWACVis.registerEChartsThemes) {
                window.IWACVis.registerEChartsThemes();
            }
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
