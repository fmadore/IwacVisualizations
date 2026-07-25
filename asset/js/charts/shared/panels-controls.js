/**
 * IWAC Visualizations — Interactive controls
 *
 * Part of the `IWACVis.panels` namespace, split out of the ~1,000-line
 * panels.js in v1.23.0 along its own section boundaries — the same split the
 * chart-options family already uses. Each part extends the same `P` object,
 * so load order among them does not matter; only that panels.js itself loads
 * first (it creates the namespace) and that all of them load before any block
 * controller.
 *
 * The three reusable control widgets: a labelled `<select>`, a search box with
 * a suggestion dropdown, and the interval state machine behind the animated
 * year scrubbers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels = ns.panels || {};

    /**
     * Labelled `<select>` control: `<div><label>text:</label><select>…</select></div>`
     * with a generated id wiring the label to the select. Replaces the
     * near-identical builders that org-cooccurrence and the three
     * scary-terms selectors each hand-rolled. Class names stay caller-
     * supplied because each block's stylesheet targets its own tokens.
     *
     * @param {Object} cfg
     * @param {string} cfg.label   already-translated label (rendered "label:")
     * @param {Array<{value:string, label:string}>} cfg.options
     * @param {string} [cfg.current]   option value to preselect
     * @param {function(string):void} cfg.onChange  fires with the new value
     * @param {string} [cfg.groupClass='iwac-vis-select-group']
     * @param {string} [cfg.labelClass='iwac-vis-select-label']
     * @param {string} [cfg.selectClass='iwac-vis-select']
     * @param {string} [cfg.idPrefix='iwac-vis-sel-']  select-id prefix
     * @returns {HTMLElement} the group element
     */
    P.buildSelectControl = function (cfg) {
        var group = P.el('div', cfg.groupClass || 'iwac-vis-select-group');
        var label = P.el('label', cfg.labelClass || 'iwac-vis-select-label',
            cfg.label + ':');
        // `.iwac-vis-control` carries the shared control skin (padding, surface,
        // radius, focus ring) from iwac-core.css; the block class that follows
        // is layout only. Core used to enumerate every block's private control
        // class instead, so adding a control meant editing the shared sheet.
        var select = P.el('select', 'iwac-vis-control ' + (cfg.selectClass || 'iwac-vis-select'));
        var selectId = (cfg.idPrefix || 'iwac-vis-sel-')
            + Math.random().toString(36).slice(2, 8);
        select.id = selectId;
        label.htmlFor = selectId;
        (cfg.options || []).forEach(function (o) {
            var opt = P.el('option', null, o.label);
            opt.value = o.value;
            if (o.value === cfg.current) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener('change', function () {
            cfg.onChange(select.value);
        });
        group.appendChild(label);
        group.appendChild(select);
        return group;
    };

    /**
     * Debounced search input + anchored suggestion dropdown — the widget
     * term-trends and the entity-networks toolbar each hand-rolled.
     * Matching/ranking stays at the call site via `getMatches`; the
     * helper owns the shared mechanics: 120 ms debounce, empty state,
     * item buttons (label + optional detail), Enter-picks-first,
     * Escape-closes, and a SELF-CLEANING document-level outside-click
     * close (it removes itself once the widget leaves the DOM, so block
     * re-inits can't stack listeners).
     *
     * NOT for filterable list boxes (spatial-exploration's picker keeps
     * its always-visible role=listbox — different widget).
     *
     * @param {Object} cfg
     * @param {string} cfg.placeholder  translated placeholder + aria-label
     * @param {function(string):Array<{label:string, detail?:string}>} cfg.getMatches
     *   Query (trimmed, non-empty) → ranked matches, already capped.
     *   Extra properties on a match ride through to onPick untouched.
     * @param {function(Object):void} cfg.onPick  chosen match (input is
     *   cleared and the dropdown closed before this fires)
     * @param {string} [cfg.emptyText]  "no matches" row (default t('No matches'))
     * @param {boolean} [cfg.openOnFocus=false]  re-open on input focus
     * @param {Object} cfg.classes  per-block class names so existing CSS
     *   keeps working: { root, input, dropdown, item, name, count, empty }
     * @returns {{root:HTMLElement, input:HTMLInputElement,
     *            close:function():void, clear:function():void}}
     */
    P.buildSearchDropdown = function (cfg) {
        var classes = cfg.classes || {};
        var wrap = P.el('div', classes.root);
        var input = P.el('input', 'iwac-vis-control ' + (classes.input || 'iwac-vis-search-input'));
        input.type = 'search';
        input.placeholder = cfg.placeholder;
        input.setAttribute('aria-label', cfg.placeholder);
        var dropdown = P.el('div', classes.dropdown);
        dropdown.style.display = 'none';
        wrap.appendChild(input);
        wrap.appendChild(dropdown);

        function close() { dropdown.style.display = 'none'; }

        function renderResults() {
            var query = (input.value || '').trim();
            dropdown.innerHTML = '';
            if (!query) {
                close();
                return;
            }
            var matches = cfg.getMatches(query) || [];
            if (!matches.length) {
                dropdown.appendChild(P.el('div', classes.empty || 'iwac-vis-muted',
                    cfg.emptyText || P.t('No matches')));
                dropdown.style.display = '';
                return;
            }
            matches.forEach(function (m) {
                var item = P.el('button', classes.item);
                item.type = 'button';
                item.appendChild(P.el('span', classes.name, m.label));
                if (m.detail != null) {
                    item.appendChild(P.el('span', classes.count, m.detail));
                }
                item.addEventListener('click', function () {
                    input.value = '';
                    close();
                    cfg.onPick(m);
                });
                dropdown.appendChild(item);
            });
            dropdown.style.display = '';
        }

        var timer = null;
        input.addEventListener('input', function () {
            if (timer) clearTimeout(timer);
            timer = setTimeout(renderResults, 120);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var first = dropdown.querySelector('button');
                if (first) first.click();
            } else if (e.key === 'Escape') {
                close();
            }
        });
        if (cfg.openOnFocus) input.addEventListener('focus', renderResults);

        document.addEventListener('click', function onDocClick(e) {
            if (!document.body.contains(wrap)) {
                document.removeEventListener('click', onDocClick);
                return;
            }
            if (!wrap.contains(e.target)) close();
        });

        return {
            root: wrap,
            input: input,
            close: close,
            clear: function () {
                input.value = '';
                close();
            }
        };
    };

    /**
     * Interval state machine for year-scrubbing playback (bar-chart race,
     * animated choropleth). Owns only the timer semantics the panels kept
     * re-implementing — rewind-at-end on play, auto-stop at the last
     * frame, silent vs announced stops. The DOM (buttons, slider, labels)
     * stays per-panel: the two consumers ship deliberately different
     * control shells.
     *
     * @param {Object} cfg
     * @param {number}   cfg.tickMs    interval between frames
     * @param {function():boolean} cfg.isAtEnd   true when on the last frame
     * @param {function():void}    cfg.rewind    jump back to frame 0
     * @param {function():void}    cfg.advance   step one frame (called per tick)
     * @param {function():void}    [cfg.onPlay]  after the interval starts
     * @param {function():void}    [cfg.onStop]  after an ANNOUNCED stop —
     *   skipped by stop(true), which panels use mid-scrub so re-rendering
     *   controls doesn't steal the slider's focus.
     * @returns {{playing():boolean, play():void, stop(silent?:boolean):void,
     *            toggle():void}}
     */
    P.createPlaybackTimer = function (cfg) {
        var timer = null;
        var api = {
            playing: function () { return timer != null; },
            stop: function (silent) {
                if (timer) {
                    window.clearInterval(timer);
                    timer = null;
                }
                if (!silent && cfg.onStop) cfg.onStop();
            },
            play: function () {
                if (cfg.isAtEnd()) cfg.rewind();
                if (timer) window.clearInterval(timer);
                timer = window.setInterval(function () {
                    if (cfg.isAtEnd()) {
                        api.stop();
                        return;
                    }
                    cfg.advance();
                }, cfg.tickMs);
                if (cfg.onPlay) cfg.onPlay();
            },
            toggle: function () {
                if (timer) api.stop(); else api.play();
            }
        };
        return api;
    };
})();
