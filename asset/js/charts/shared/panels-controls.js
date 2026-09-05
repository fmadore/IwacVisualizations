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
 * The reusable control widgets: a labelled `<select>` (with in-place option
 * updates), a search box with a suggestion dropdown, the interval state
 * machine behind the animated year scrubbers, and — since v1.60.0 — the
 * segmented "pick one of N" group, the year slider that announces the year,
 * and the focus-restoring remount helper the blocks' controls rows use.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels = ns.panels || {};

    /* ----------------------------------------------------------------- */
    /*  AI sentiment model labels                                         */
    /* ----------------------------------------------------------------- */
    //
    // Display names for the sentiment model ids, which are the Hugging
    // Face column prefixes (scripts/iwac_utils.py SENTIMENT_MODELS) and
    // the keys every precomputed sentiment payload is keyed on.
    //
    // BOTH generations are listed, and that is the point. The module
    // ships independently of its data (issue #7: code goes out as a
    // release, data as a CI-built archive the admin pulls separately), so
    // there is always a window in which a freshly-updated module is
    // reading a bundle generated before the change. When the rater panel
    // moved from the generation-1 vendor slots to the generation-2 model
    // ids, three panels held a hardcoded list of the new ids, matched
    // nothing in the deployed bundle, and rendered "no data available"
    // over payloads that were full of perfectly good numbers.
    //
    // So: panels take their model list from the payload's own `models`
    // array and come here only for a label. An id with no entry gets a
    // readable fallback rather than being dropped — an unknown model is
    // still a model, and hiding it would repeat the same failure.
    var SENTIMENT_MODEL_LABELS = {
        // Generation 2 — live (July–August 2026)
        'gpt_5_6_luna':           'GPT-5.6 Luna',
        'mistral_small_2603':     'Mistral Small 4',
        'deepseek_v4_flash_0731': 'DeepSeek V4 Flash',
        // The Google slot since 2026-08-14. Its label is here well before
        // any bundle carries the id: the annotations land on Omeka first
        // and reach a precomputed payload only once the Hugging Face
        // uploader has been taught the model, so this entry sits unused
        // for a while and then starts resolving on its own.
        'gemma_4_31b_it':         'Gemma 4 31B',
        // Self-hosted on the project's own cluster since 2026-08-25 —
        // the only rater whose annotations were produced on hardware the
        // project controls. Its columns landed on the Hub the same day,
        // so unlike Gemma this entry started resolving immediately.
        'qwen3_8_27b':            'Qwen3.8 27B',
        // Generation 1 — frozen (January–February 2026). Kept so an
        // older bundle still renders with the right names on screen.
        'gemini_3_flash_preview': 'Gemini 3 Flash',
        'gpt_5_mini':             'GPT-5 mini',
        'ministral_14b_2512':     'Ministral 14B',
        // Generation 1, vendor-slot ids. These named a *company* rather
        // than a model — nothing recorded which model actually ran — so
        // the label says only that much.
        'gemini':                 'Gemini (2026-01)',
        'chatgpt':                'ChatGPT (2026-01)',
        'mistral':                'Mistral (2026-01)'
    };

    /**
     * Display name for a sentiment model id. Falls back to the id with
     * separators normalised, so an id added upstream before this table
     * knows about it still reads as a name.
     *
     * @param {string} key  model id / HF column prefix
     * @returns {string}
     */
    P.sentimentModelLabel = function (key) {
        if (!key) return '';
        return SENTIMENT_MODEL_LABELS[key] || String(key).replace(/_/g, ' ');
    };

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
        // A stable handle, for `P.withFocusRestored` to find the same control
        // again after a remount — the random id above is new every time.
        var name = cfg.name || cfg.idPrefix;
        if (name) select.setAttribute('data-iwac-control', name);
        P.setSelectOptions(select, cfg.options, cfg.current);
        select.addEventListener('change', function () {
            cfg.onChange(select.value);
        });
        group.appendChild(label);
        group.appendChild(select);
        // The select itself, for in-place updates: a block's `sync()` writes
        // `group.control.value` or repopulates through `group.setOptions`
        // instead of rebuilding the row — which is what keeps a focused
        // select focused (the arrow keys fire `change` on every step).
        group.control = select;
        group.setOptions = function (options, current) {
            return P.setSelectOptions(select, options, current);
        };
        return group;
    };

    /**
     * Replace a `<select>`'s options in place, keeping the current value
     * where it survives and falling back to the first option otherwise.
     * Returns the value that ended up selected.
     *
     * @param {HTMLSelectElement} select
     * @param {Array<{value:string, label:string}>} options
     * @param {string} [current]  value to select (default: keep)
     * @returns {string}
     */
    P.setSelectOptions = function (select, options, current) {
        var want = current != null ? String(current) : String(select.value || '');
        select.innerHTML = '';
        var values = [];
        (options || []).forEach(function (o) {
            var opt = P.el('option', null, o.label);
            opt.value = o.value;
            values.push(String(o.value));
            select.appendChild(opt);
        });
        if (values.indexOf(want) === -1) want = values.length ? values[0] : '';
        select.value = want;
        return want;
    };

    /* ----------------------------------------------------------------- */
    /*  Focus-safe remounts                                               */
    /* ----------------------------------------------------------------- */

    /**
     * Run a DOM rebuild and put keyboard focus back where it was.
     *
     * A controls row that rebuilds itself from inside its own change handler
     * destroys the element the reader is interacting with — and for a
     * `<select>`, whose `change` fires on the first arrow key in Chrome and
     * Firefox, that meant the list could not be traversed by keyboard at all.
     * Blocks now remount only on a change of view, through this: the focused
     * control is remembered by its `data-iwac-control` handle (every shared
     * control writes one), the rebuild runs, and the control carrying the
     * same handle in the new tree takes focus — with the caret where it was,
     * for a text input.
     *
     * @param {HTMLElement} container  the subtree being rebuilt
     * @param {function(): void} rebuild
     */
    P.withFocusRestored = function (container, rebuild) {
        var doc = container && container.ownerDocument || document;
        var active = doc.activeElement;
        var handle = null;
        var selection = null;
        if (active && container && container.contains(active)) {
            handle = active.getAttribute ? active.getAttribute('data-iwac-control') : null;
            if (handle && typeof active.selectionStart === 'number') {
                try { selection = [active.selectionStart, active.selectionEnd]; }
                catch (e) { selection = null; }
            }
        }
        rebuild();
        if (!handle || !/^[\w.:-]+$/.test(handle)) return;
        var next = container.querySelector('[data-iwac-control="' + handle + '"]');
        if (!next || next === active || !doc.contains(next)) return;
        try {
            next.focus({ preventScroll: true });
            if (selection && typeof next.setSelectionRange === 'function') {
                next.setSelectionRange(selection[0], selection[1]);
            }
        } catch (e) { /* not focusable after all */ }
    };

    /* ----------------------------------------------------------------- */
    /*  Segmented control — "pick one of N"                               */
    /* ----------------------------------------------------------------- */

    /**
     * One accessible vocabulary for a group of exclusive toggle buttons:
     * `role="group"` with a name, one button per option carrying
     * `aria-pressed`, all of them in the tab order, arrow keys moving focus
     * within the group. This is the module's established pattern for chart
     * switchers (the rationale is at collection-overview/entities.js — a
     * chart facet is not a tab: nothing it controls is a tabpanel), and it
     * replaces the three vocabularies that had grown beside it: a tablist
     * with no tabpanels, a radiogroup whose buttons carried aria-checked AND
     * aria-pressed, and a bare `--active` class announcing nothing.
     *
     * Class names default to the shared `.iwac-vis-tabs` family and may be
     * overridden per block so existing stylesheets keep matching.
     *
     * @param {Object} cfg
     * @param {Array<{key:string, label:string}>} cfg.options
     * @param {string} [cfg.active]      initially pressed key
     * @param {function(string):void} cfg.onChange  fires with the new key
     *   (not on `set()`, and not when the pressed button is pressed again)
     * @param {string} [cfg.label]       visible label rendered before the buttons
     * @param {string} [cfg.ariaLabel]   accessible name when there is no visible label
     * @param {string} [cfg.labelledBy]  id of an existing label element
     * @param {boolean} [cfg.arrowKeys=true]
     * @param {string} [cfg.name]        `data-iwac-control` handle prefix
     * @param {{root?:string, btn?:string, active?:string, label?:string}} [cfg.classes]
     * @returns {{root: HTMLElement, set: function(string):void,
     *            get: function():string, buttons: Object<string, HTMLButtonElement>}}
     */
    P.buildSegmented = function (cfg) {
        cfg = cfg || {};
        var classes = cfg.classes || {};
        // `null` for btn / active means "no class at all" — a stylesheet
        // that targets `button[aria-pressed="true"]` needs neither.
        var activeClass = classes.active === undefined ? 'iwac-vis-tab--active' : classes.active;
        var root = P.el('div', classes.root || 'iwac-vis-tabs');
        root.setAttribute('role', 'group');
        var name = cfg.name || 'segmented';
        if (cfg.label) {
            var labelEl = P.el('span', classes.label || 'iwac-vis-tabs__label', cfg.label);
            labelEl.id = 'iwac-vis-seg-' + name.replace(/[^\w-]/g, '-') + '-'
                + Math.random().toString(36).slice(2, 7);
            root.appendChild(labelEl);
            root.setAttribute('aria-labelledby', labelEl.id);
        } else if (cfg.labelledBy) {
            root.setAttribute('aria-labelledby', cfg.labelledBy);
        } else if (cfg.ariaLabel) {
            root.setAttribute('aria-label', cfg.ariaLabel);
        }

        var active = cfg.active;
        var buttons = {};
        var order = [];

        function paint() {
            order.forEach(function (key) {
                var on = key === active;
                buttons[key].setAttribute('aria-pressed', on ? 'true' : 'false');
                if (activeClass) buttons[key].classList.toggle(activeClass, on);
            });
        }

        (cfg.options || []).forEach(function (o) {
            var btn = P.el('button', classes.btn === undefined ? 'iwac-vis-tab' : classes.btn, o.label);
            btn.type = 'button';
            btn.setAttribute('data-iwac-control', name + ':' + o.key);
            btn.addEventListener('click', function () {
                if (o.key === active) return;
                active = o.key;
                paint();
                if (typeof cfg.onChange === 'function') cfg.onChange(o.key);
            });
            buttons[o.key] = btn;
            order.push(o.key);
            root.appendChild(btn);
        });

        if (cfg.arrowKeys !== false) {
            root.addEventListener('keydown', function (e) {
                var idx = -1;
                for (var i = 0; i < order.length; i++) {
                    if (buttons[order[i]] === e.target) { idx = i; break; }
                }
                if (idx === -1 || !order.length) return;
                var next;
                switch (e.key) {
                    case 'ArrowRight': case 'ArrowDown': next = (idx + 1) % order.length; break;
                    case 'ArrowLeft':  case 'ArrowUp':   next = (idx - 1 + order.length) % order.length; break;
                    case 'Home': next = 0; break;
                    case 'End':  next = order.length - 1; break;
                    default: return;
                }
                e.preventDefault();
                buttons[order[next]].focus();
            });
        }

        paint();
        return {
            root: root,
            buttons: buttons,
            /** Reflect a key set elsewhere (URL, another control); silent. */
            set: function (key) {
                if (key === active) return;
                active = key;
                paint();
            },
            get: function () { return active; }
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Year slider                                                       */
    /* ----------------------------------------------------------------- */

    /**
     * A range input over an array of years that ANNOUNCES the year.
     *
     * Both year scrubbers (scary-terms race, keywords attention map) were
     * `min=0 max=years.length-1` inputs labelled "Year": the visible label
     * beside them said 1973 while a screen reader said "Year, 12 of 64",
     * because a range input announces its numeric value and nothing told it
     * otherwise. `aria-valuetext` is exactly the attribute for this, and it
     * is rewritten on every move — the reader's own, and the playback tick
     * through `set()`.
     *
     * @param {Object} cfg
     * @param {Array<number>} cfg.years
     * @param {number} [cfg.index=0]
     * @param {function(number):void} cfg.onInput  new index, on the reader's
     *   own moves only (never from `set()`)
     * @param {string} [cfg.label]   accessible name (default t('Year'))
     * @param {string} [cfg.name]    `data-iwac-control` handle
     * @param {HTMLElement} [cfg.into]  append the edges + input into this
     *   element instead of a new row (for a row that also holds a play
     *   button and a label)
     * @param {string} [cfg.fillVar]  CSS custom property to write the
     *   0–100% progress into, for a filled-track style
     * @param {{row?:string, edge?:string, input?:string}} [cfg.classes]
     * @returns {{root: HTMLElement, input: HTMLInputElement,
     *            set: function(number):void, get: function():number}}
     */
    P.buildYearSlider = function (cfg) {
        cfg = cfg || {};
        var classes = cfg.classes || {};
        var years = cfg.years || [];
        var last = Math.max(0, years.length - 1);
        var root = cfg.into || P.el('div', classes.row || 'iwac-vis-year-slider');
        var input = P.el('input', classes.input || 'iwac-vis-year-slider__input');
        input.type = 'range';
        input.min = '0';
        input.max = String(last);
        input.step = '1';
        input.setAttribute('aria-label', cfg.label || P.t('Year'));
        input.setAttribute('data-iwac-control', cfg.name || 'year-slider');

        function clamp(idx) {
            idx = parseInt(idx, 10);
            if (isNaN(idx)) idx = 0;
            return Math.max(0, Math.min(last, idx));
        }

        function paint(idx) {
            input.value = String(idx);
            input.setAttribute('aria-valuetext', String(years[idx] != null ? years[idx] : ''));
            if (cfg.fillVar) {
                var pct = last > 0 ? (idx / last) * 100 : 0;
                input.style.setProperty(cfg.fillVar, pct + '%');
            }
        }

        var current = clamp(cfg.index || 0);
        paint(current);
        input.addEventListener('input', function () {
            current = clamp(input.value);
            paint(current);
            if (typeof cfg.onInput === 'function') cfg.onInput(current);
        });

        root.appendChild(P.el('span', classes.edge || 'iwac-vis-year-slider__edge',
            String(years[0] != null ? years[0] : '')));
        root.appendChild(input);
        root.appendChild(P.el('span', classes.edge || 'iwac-vis-year-slider__edge',
            String(years[last] != null ? years[last] : '')));

        return {
            root: root,
            input: input,
            set: function (idx) {
                current = clamp(idx);
                paint(current);
            },
            get: function () { return current; }
        };
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

    /* ----------------------------------------------------------------- */
    /*  Window disclosure — "showing N of M", with a way out              */
    /* ----------------------------------------------------------------- */

    /**
     * A stated row window plus the control that escapes it.
     *
     * Charts that hold more rows than a panel can show have to window them,
     * and ECharts' `dataZoom` does that silently: the newspaper Gantt drew 20
     * of 82 press runs behind a thin slider with no count anywhere, so the
     * honest reading of its default state was "IWAC holds about a dozen
     * newspapers". A window is fine. An UNSTATED window is a false claim about
     * the size of the collection, which on an archive's own overview page is
     * the one thing the page must not get wrong.
     *
     * So: say how many of how many, and offer the rest. The note is a
     * `role="status"` live region because the count changes when a facet
     * narrows the data, and the button carries `aria-expanded` because that is
     * exactly what it does.
     *
     * @param {Object} cfg
     * @param {number} cfg.windowSize      rows visible while collapsed
     * @param {number} cfg.total           rows available
     * @param {function(boolean):void} cfg.onToggle  receives the new expanded state
     * @param {string} [cfg.noteKey]       collapsed note, gets {shown} + {total}
     * @param {string} [cfg.allKey]        expanded note, gets {total}
     * @param {string} [cfg.showAllKey]    expand button, gets {total}
     * @param {string} [cfg.showTopKey]    collapse button, gets {shown}
     * @returns {{root: HTMLElement, update: function(number): void,
     *            isExpanded: function(): boolean}}
     */
    P.buildWindowDisclosure = function (cfg) {
        var windowSize = cfg.windowSize || 20;
        var total = cfg.total || 0;
        var expanded = false;

        var root = P.el('div', 'iwac-vis-window-note');
        var text = P.el('p', 'iwac-vis-window-note__text');
        text.setAttribute('role', 'status');
        text.setAttribute('aria-live', 'polite');
        var btn = P.el('button', 'iwac-vis-window-note__toggle');
        btn.type = 'button';
        root.appendChild(text);
        root.appendChild(btn);

        function shown() {
            return Math.min(windowSize, total);
        }

        function paint() {
            // Nothing is being hidden — say nothing. A disclosure that fires
            // on a 6-row chart trains the reader to ignore it on an 82-row one.
            var windowed = total > windowSize;
            root.hidden = !windowed;
            btn.hidden = !windowed;
            if (!windowed) {
                expanded = false;
                text.textContent = '';
                return;
            }
            text.textContent = expanded
                ? P.t(cfg.allKey || 'window_all', { total: P.formatNumber(total) })
                : P.t(cfg.noteKey || 'window_note', {
                    shown: P.formatNumber(shown()),
                    total: P.formatNumber(total)
                });
            btn.textContent = expanded
                ? P.t(cfg.showTopKey || 'window_show_top', { shown: P.formatNumber(windowSize) })
                : P.t(cfg.showAllKey || 'window_show_all', { total: P.formatNumber(total) });
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }

        btn.addEventListener('click', function () {
            expanded = !expanded;
            paint();
            if (typeof cfg.onToggle === 'function') cfg.onToggle(expanded);
        });

        paint();

        return {
            root: root,
            /**
             * New row count (a facet narrowed or widened the data). Collapses
             * back when the remaining rows all fit — leaving the chart
             * "expanded" over 4 rows would strand a tall empty panel.
             */
            update: function (newTotal) {
                total = newTotal || 0;
                if (total <= windowSize) expanded = false;
                paint();
                return expanded;
            },
            isExpanded: function () { return expanded; }
        };
    };
})();
