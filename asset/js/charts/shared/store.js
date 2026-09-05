/**
 * IWAC Visualizations — Block state store + URL binding
 *
 * Part of the `IWACVis.panels` namespace (loads after panels-controls.js,
 * before any block controller). Three things every interactive block used
 * to do by hand, each a little differently:
 *
 *   1. `P.createStore(state, { reduce })` — ONE state object per block,
 *      mutated in place through `patch()`, with keyed subscriptions and a
 *      microtask-batched notify. Keyed subscriptions are what make the
 *      controls focus-safe (S1 in REFACTORING.md Tier 8): a change of
 *      `view` remounts the controls row, every other change only syncs
 *      values into the widgets that already exist, so a `<select>` the
 *      reader is stepping through with the arrow keys is never destroyed
 *      under their focus. The object handed in IS the store's state — the
 *      blocks keep reading `state.view` exactly as before.
 *
 *   2. `P.bindUrlState(store, { prefix, keys })` — the citable views become
 *      addressable. Params are block-prefixed (`laicite.view=trends`), so
 *      two blocks on one page cannot collide and an Omeka page ignores
 *      them; the URL is rewritten with `replaceState` (no history entry
 *      per click), defaults are omitted, and every browser-side failure —
 *      a sandboxed embed iframe throwing on `replaceState`, a missing
 *      `URL` — degrades to "the address bar stays as it is". The same code
 *      runs inside the embed frame against its own same-origin location.
 *
 *   3. `P.buildCopyLinkButton({ href })` — "Copy link to this view", the
 *      button that turns 2 into something a reader can act on.
 *
 * Deliberately not a framework: no derived-state graph, no immutability
 * (the blocks were written against a mutable object and gain nothing from
 * copies), no time travel. ~200 lines, all of it tested in
 * tests/js/store.test.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels = ns.panels || {};

    /* ----------------------------------------------------------------- */
    /*  Store                                                             */
    /* ----------------------------------------------------------------- */

    /**
     * @param {Object} state   the block's state object — kept, not copied
     * @param {Object} [opts]
     * @param {function(Object, Array<string>): (Object|void)} [opts.reduce]
     *   Cross-field rules. Called after every patch with the state (already
     *   mutated) and the keys that changed; may return further changes,
     *   which are applied once without re-running the reducer. This is where
     *   "picking a corpus clears the country" lives — in one place, instead
     *   of inside each control's change handler.
     * @returns {{state: Object, get: Function, patch: Function, set: Function,
     *            subscribe: Function, flush: Function}}
     */
    P.createStore = function (state, opts) {
        opts = opts || {};
        state = state || {};
        var reduce = typeof opts.reduce === 'function' ? opts.reduce : null;
        var subs = [];
        var pending = {};
        var hasPending = false;
        var scheduled = false;

        function schedule() {
            if (scheduled) return;
            scheduled = true;
            var run = function () {
                scheduled = false;
                flush();
            };
            if (typeof Promise !== 'undefined' && Promise.resolve) {
                Promise.resolve().then(run);
            } else {
                setTimeout(run, 0);
            }
        }

        function apply(changes, touched) {
            Object.keys(changes || {}).forEach(function (k) {
                var next = changes[k];
                if (next === undefined) return;
                if (state[k] === next) return;
                state[k] = next;
                if (touched.indexOf(k) === -1) touched.push(k);
            });
        }

        /**
         * Apply changes; notify on the next microtask. Returns the keys
         * that actually changed (a patch to the current value is a no-op,
         * so a control echoing its own value back never triggers a redraw).
         *
         * `{ silent: true }` applies without notifying — for hydrating from
         * the URL before any subscriber exists, when the block is about to
         * build its controls from the state anyway.
         */
        function patch(changes, options) {
            var touched = [];
            apply(changes, touched);
            if (touched.length && reduce) {
                var extra = reduce(state, touched.slice());
                if (extra && typeof extra === 'object') apply(extra, touched);
            }
            if (!touched.length) return touched;
            if (options && options.silent) return touched;
            touched.forEach(function (k) { pending[k] = true; });
            hasPending = true;
            schedule();
            return touched;
        }

        /**
         * Notify now. Subscribers may patch again (a draw that corrects an
         * out-of-range value); those changes are delivered in the same
         * flush, bounded so two subscribers correcting each other cannot
         * spin forever.
         */
        function flush() {
            var rounds = 0;
            while (hasPending) {
                if (++rounds > 10) {
                    console.warn('IWACVis store: subscribers kept patching — stopping after 10 rounds');
                    pending = {};
                    hasPending = false;
                    break;
                }
                var keys = Object.keys(pending);
                pending = {};
                hasPending = false;
                subs.slice().forEach(function (sub) {
                    if (sub.keys) {
                        var hit = false;
                        for (var i = 0; i < keys.length; i++) {
                            if (sub.keys[keys[i]]) { hit = true; break; }
                        }
                        if (!hit) return;
                    }
                    try { sub.fn(keys, state); }
                    catch (e) { console.error('IWACVis store: subscriber failed', e); }
                });
            }
        }

        return {
            state: state,
            get: function (key) { return state[key]; },
            patch: patch,
            set: function (key, value, options) {
                var changes = {};
                changes[key] = value;
                return patch(changes, options);
            },
            /**
             * @param {function(Array<string>, Object): void} fn  (changedKeys, state)
             * @param {{keys?: Array<string>}} [options]  only these keys wake fn
             * @returns {function(): void} unsubscribe
             */
            subscribe: function (fn, options) {
                var keys = null;
                if (options && options.keys && options.keys.length) {
                    keys = {};
                    options.keys.forEach(function (k) { keys[k] = true; });
                }
                var sub = { fn: fn, keys: keys };
                subs.push(sub);
                return function () {
                    var i = subs.indexOf(sub);
                    if (i !== -1) subs.splice(i, 1);
                };
            },
            flush: flush
        };
    };

    /* ----------------------------------------------------------------- */
    /*  URL binding                                                       */
    /* ----------------------------------------------------------------- */

    /**
     * Query-string encoding that leaves `,` `:` `/` readable. Both forms
     * parse back identically through URLSearchParams; this one just keeps
     * `ngram.terms=islam,musulman` from becoming `islam%2Cmusulman` in a
     * URL a reader is meant to paste into a footnote.
     */
    function encode(value) {
        return encodeURIComponent(String(value))
            .replace(/%2C/gi, ',')
            .replace(/%3A/gi, ':')
            .replace(/%2F/gi, '/');
    }

    function defaultSerialize(value) {
        if (value == null || value === '') return null;
        if (Array.isArray(value)) return value.length ? value.join(',') : null;
        if (typeof value === 'boolean') return value ? '1' : '0';
        return String(value);
    }

    /** Parse by the TYPE of the current value, so a numeric key stays numeric. */
    function defaultParse(raw, current) {
        if (Array.isArray(current)) {
            return String(raw).split(',').filter(function (s) { return s !== ''; });
        }
        if (typeof current === 'boolean') return raw === '1' || raw === 'true';
        if (typeof current === 'number') {
            var n = Number(raw);
            return isNaN(n) ? undefined : n;
        }
        return String(raw);
    }

    function normaliseKey(entry) {
        var spec = typeof entry === 'string' ? { key: entry } : (entry || {});
        return {
            key: spec.key,
            param: spec.param || spec.key,
            parse: spec.parse || null,
            serialize: spec.serialize || null,
            values: Array.isArray(spec.values) ? spec.values : null,
            validate: typeof spec.validate === 'function' ? spec.validate : null,
            hasDefault: Object.prototype.hasOwnProperty.call(spec, 'default'),
            defaultValue: spec['default']
        };
    }

    /**
     * @param {Object} store  from P.createStore
     * @param {Object} cfg
     * @param {string} cfg.prefix  block prefix — params read `<prefix>.<param>`
     * @param {Array<string|Object>} cfg.keys  state keys to bind; an object
     *   form carries { key, param, parse(raw, current), serialize(value),
     *   values: [...allowed], validate(value), default }
     * @param {function(Array<string>): boolean} [cfg.push]  return true for a
     *   change that should get its own history entry (navigation-like: a
     *   topic detail). Off by default — a facet click is not a page.
     * @param {boolean} [cfg.hydrate=true]  read the URL now, silently
     * @param {Window} [cfg.window]  for tests
     * @returns {{hydrate: Function, sync: Function, href: Function, stop: Function}}
     */
    P.bindUrlState = function (store, cfg) {
        cfg = cfg || {};
        var win = cfg.window || window;
        var prefix = cfg.prefix ? cfg.prefix + '.' : '';
        var specs = (cfg.keys || []).map(normaliseKey);
        var defaults = {};
        specs.forEach(function (s) {
            defaults[s.key] = s.hasDefault ? s.defaultValue : store.state[s.key];
        });

        function serialized(spec) {
            var value = store.state[spec.key];
            var out = spec.serialize ? spec.serialize(value, store.state) : defaultSerialize(value);
            if (out == null || out === '') return null;
            var base = spec.serialize
                ? spec.serialize(defaults[spec.key], store.state)
                : defaultSerialize(defaults[spec.key]);
            return String(out) === String(base == null ? '' : base) ? null : String(out);
        }

        function accepts(spec, value) {
            if (value === undefined) return false;
            if (spec.values && spec.values.indexOf(value) === -1) return false;
            if (spec.validate && !spec.validate(value, store.state)) return false;
            return true;
        }

        function currentUrl() {
            try { return new URL(win.location.href); }
            catch (e) { return null; }
        }

        /** The address with this block's state written in. */
        function href() {
            var url = currentUrl();
            if (!url) return null;
            var params;
            try { params = new URLSearchParams(url.search); }
            catch (e) { return null; }
            specs.forEach(function (s) { params['delete'](prefix + s.param); });
            var parts = [];
            var rest = params.toString();
            if (rest) parts.push(rest);
            specs.forEach(function (s) {
                var v = serialized(s);
                if (v != null) parts.push(encode(prefix + s.param) + '=' + encode(v));
            });
            url.search = parts.length ? '?' + parts.join('&') : '';
            return url.toString();
        }

        /**
         * The state the address describes. A param that is absent means
         * "leave it" on the first read (the block's own default stands) and
         * "back to the default" on Back / Forward — the entry the reader
         * returns to may have had no param precisely because it was the
         * default.
         */
        function changesFromUrl(fillDefaults) {
            var url = currentUrl();
            if (!url) return {};
            var params;
            try { params = new URLSearchParams(url.search); }
            catch (e) { return {}; }
            var changes = {};
            specs.forEach(function (s) {
                var raw = params.get(prefix + s.param);
                if (raw == null) {
                    if (fillDefaults) changes[s.key] = defaults[s.key];
                    return;
                }
                var value;
                try {
                    value = s.parse
                        ? s.parse(raw, store.state[s.key], store.state)
                        : defaultParse(raw, store.state[s.key]);
                } catch (e) { value = undefined; }
                if (accepts(s, value)) changes[s.key] = value;
            });
            return changes;
        }

        function hydrate(options) {
            return store.patch(changesFromUrl(), options || { silent: true });
        }

        var lastWritten = null;
        function sync(changedKeys) {
            var next = href();
            if (!next || next === win.location.href) return;
            var history = win.history;
            if (!history || typeof history.replaceState !== 'function') return;
            var push = !!(cfg.push && cfg.push(changedKeys || [], store.state));
            try {
                history[push ? 'pushState' : 'replaceState'](history.state, '', next);
                lastWritten = next;
            } catch (e) { /* sandboxed or cross-origin frame: leave the bar alone */ }
        }

        var keyNames = specs.map(function (s) { return s.key; });
        var unsubscribe = store.subscribe(function (keys) { sync(keys); }, { keys: keyNames });

        // Back / Forward only matter once a change has been PUSHED; a block
        // that only replaces never creates entries to move between.
        var onPop = null;
        if (cfg.push && win.addEventListener) {
            onPop = function () {
                if (win.location.href === lastWritten) return;
                store.patch(changesFromUrl(true));
            };
            win.addEventListener('popstate', onPop);
        }

        if (cfg.hydrate !== false) hydrate();

        return {
            hydrate: hydrate,
            sync: sync,
            href: href,
            stop: function () {
                unsubscribe();
                if (onPop && win.removeEventListener) win.removeEventListener('popstate', onPop);
            }
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Copy link                                                         */
    /* ----------------------------------------------------------------- */

    /**
     * "Copy link to this view". Sits at the end of a block's controls row
     * (`.iwac-vis-copy-link` pushes it to the far edge) beside the per-panel
     * embed buttons, and copies whatever `href` returns at click time — the
     * URL with the current facets written in, from `bindUrlState().href`.
     *
     * @param {Object} cfg
     * @param {function(): (string|null)|string} cfg.href
     * @param {string} [cfg.label]        default t('Copy link to this view')
     * @param {string} [cfg.copiedLabel]  default t('Link copied')
     * @returns {HTMLButtonElement}
     */
    P.buildCopyLinkButton = function (cfg) {
        cfg = cfg || {};
        var label = cfg.label || P.t('Copy link to this view');
        var copied = cfg.copiedLabel || P.t('Link copied');
        var btn = P.el('button', 'iwac-vis-btn iwac-vis-btn--sm iwac-vis-btn--ghost iwac-vis-copy-link', label);
        btn.type = 'button';
        btn.setAttribute('data-iwac-control', 'copy-link');
        var timer = null;
        btn.addEventListener('click', function () {
            var text = typeof cfg.href === 'function' ? cfg.href() : cfg.href;
            if (!text) return;
            var done = function () {
                btn.textContent = copied;
                btn.classList.add('iwac-vis-copy-link--copied');
                if (timer) clearTimeout(timer);
                timer = setTimeout(function () {
                    btn.textContent = label;
                    btn.classList.remove('iwac-vis-copy-link--copied');
                }, 1800);
            };
            var copy = ns.embed && ns.embed.copyToClipboard;
            if (copy) {
                copy(text).then(done, done);
            } else if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, done);
            }
        });
        return btn;
    };
})();
