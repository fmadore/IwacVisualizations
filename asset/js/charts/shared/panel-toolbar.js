/**
 * IWAC Visualizations — Shared panel toolbar
 *
 * Adds a small floating toolbar to any `.iwac-vis-panel` with:
 *   - a Download button that exports a PNG composited with the panel's
 *     title, description and a footer (ISO date + IWAC attribution)
 *     so screenshots are self-describing instead of headless chart
 *     rectangles. Falls back to the raw `chart.getDataURL()` if
 *     compositing fails (e.g. tainted canvas, missing fonts).
 *   - "View as table" and "Download CSV" (v1.61.0) — the chart's own
 *     numbers, read back from the option it was painted with
 *     (`P.optionToRows`), or from the rows a map panel registers with
 *     `P.setPanelRows`. The table is the first route to a chart's data
 *     that is neither the pixels nor a one-sentence description; on a
 *     map it is the first route to the places that needs no pointer.
 *   - an optional Fullscreen toggle that uses the Fullscreen API on
 *     the panel element itself (`P.bindFullscreen`, which every
 *     fullscreen toggle in the module goes through, falls back to a
 *     class-only overlay where the API is missing — an iPhone).
 *
 * The icon-button builder, the download trigger, the composited PNG
 * export and the fullscreen binding are public (`P.iconButton`,
 * `P.triggerDownload`, `P.downloadPanelImage`, `P.bindFullscreen`) so the
 * graph toolbars, which carry their own button column, export and expand
 * exactly the way every other panel does instead of keeping a copy each.
 *
 * The toolbar is auto-attached from both `dashboard-core.registerChart`
 * (ECharts) and `dashboard-core.registerMap` (MapLibre) the first time
 * a chart or map registers under a panel; subsequent registrations
 * (e.g. sentiment's three segmented bars) re-use the same toolbar and
 * silently skip. Panels that ship their own toolbar (the network panel
 * has a graph-toolbar with zoom/download/fullscreen) mark the chart host
 * with `.iwac-vis-graph-host` and set `data-iwac-no-panel-toolbar="1"`
 * on the panel to opt out of auto-wiring.
 *
 * All colors + spacing come from IWAC theme tokens via the shared
 * `.iwac-vis-btn` class — NEVER hex literals (see
 * feedback_use_iwac_css_variables). Load order: after panels.js +
 * dashboard-core.js, before any block controller.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.panel-toolbar: panels.js must load first');
        return;
    }

    var TOOLBAR_CLASS = 'iwac-vis-panel-toolbar';
    var BTN_CLASS = 'iwac-vis-panel-toolbar__btn';
    // Device-pixel ratio of the PNG export and of the chrome composited
    // around it — the two must agree or the title renders at a different
    // DPI than the chart.
    var EXPORT_SCALE = 3;
    // Public so a renderer that rasterises itself (the canvas force graph)
    // can hand `downloadPanelImage` a raster at the DPI the chrome expects.
    P.EXPORT_SCALE = EXPORT_SCALE;

    // How long to wait for MapLibre's next `render` before forcing one.
    // Only reached when no frame arrives at all — a hidden tab, where
    // requestAnimationFrame is throttled to nothing.
    var EXPORT_FRAME_TIMEOUT = 250;
    // Rows shown in the in-page table before the reader is pointed at the
    // CSV. A 3,000-point scatter is a download, not a page.
    var TABLE_ROW_CAP = 500;
    var _tableUid = 0;

    /* ----------------------------------------------------------------- */
    /*  Raw image data URLs (no composite)                                */
    /* ----------------------------------------------------------------- */

    /**
     * Return the PNG data URL for an ECharts instance, resolved through
     * the live entry in `ns._charts` so we never read from an instance
     * disposed by a panel teardown. Returns null if the chart cannot be
     * located.
     */
    function echartsDataUrl(el) {
        var live = ns.getLiveChart ? ns.getLiveChart(el) : null;
        if (!live || !live.getDataURL) return null;
        try {
            // 3× is the cheapest print-quality win available to a canvas
            // renderer: a 900px panel comes out at 2700px, enough for a
            // half-page figure at 300 dpi. (A vector export would need the
            // SVG renderer, which the site does not load.)
            return live.getDataURL({
                type: 'png',
                pixelRatio: EXPORT_SCALE,
                backgroundColor: ns.getChartTokens().surface
            });
        } catch (e) {
            console.error('IWACVis.panel-toolbar: getDataURL failed', e);
            return null;
        }
    }

    /**
     * Promise<string|null> — the PNG data URL for a MapLibre GL instance.
     *
     * **Read inside the `render` event.** A WebGL canvas is cleared after
     * the browser composites it, so `toDataURL` on an idle map returns a
     * blank image. Until now every map on every page carried
     * `preserveDrawingBuffer: true` to keep those pixels around — the whole
     * site paying, on every frame, for an export almost nobody runs. The
     * `render` handler fires synchronously at the end of MapLibre's own
     * draw, before compositing, which is exactly the moment the buffer is
     * both filled and still readable.
     *
     * The timeout is for the case where no frame ever comes (a hidden tab,
     * where `requestAnimationFrame` does not run): force one draw and read
     * straight after it, which is what this used to do unconditionally.
     */
    function maplibreDataUrl(el) {
        var live = ns.getLiveMap ? ns.getLiveMap(el) : null;
        if (!live || !live.getCanvas) return Promise.resolve(null);

        return new Promise(function (resolve) {
            var settled = false;
            function read() {
                if (settled) return;
                settled = true;
                try {
                    var canvas = live.getCanvas();
                    resolve(canvas && canvas.toDataURL ? canvas.toDataURL('image/png') : null);
                } catch (e) {
                    console.error('IWACVis.panel-toolbar: map toDataURL failed', e);
                    resolve(null);
                }
            }
            try {
                live.once('render', read);
                live.triggerRepaint();
            } catch (e) {
                read();
                return;
            }
            setTimeout(function () {
                if (settled) return;
                try { if (typeof live.redraw === 'function') live.redraw(); }
                catch (e) { /* best effort */ }
                read();
            }, EXPORT_FRAME_TIMEOUT);
        });
    }

    /** Promise<string|null> — whichever renderer owns this element. */
    function resolveDataUrl(el) {
        var fromChart = echartsDataUrl(el);
        if (fromChart) return Promise.resolve(fromChart);
        return maplibreDataUrl(el);
    }

    /* ----------------------------------------------------------------- */
    /*  Composite (header + chart + footer)                               */
    /* ----------------------------------------------------------------- */

    /** Promise wrapper around <img>.onload so we can read pixel dims. */
    function loadImage(src) {
        return new Promise(function (resolve) {
            if (!src) { resolve(null); return; }
            var img = new Image();
            img.onload  = function () { resolve(img); };
            img.onerror = function () { resolve(null); };
            img.src = src;
        });
    }

    /** Read the panel's title, at any heading level, trimmed. Empty string if absent. */
    function readPanelTitle(panelEl) {
        var heading = P.panelTitle(panelEl);
        return heading ? (heading.textContent || '').trim() : '';
    }

    /** Read the panel's `.iwac-vis-panel-desc` paragraph, trimmed. */
    function readPanelSubtitle(panelEl) {
        if (!panelEl) return '';
        var p = panelEl.querySelector(':scope > .iwac-vis-panel-desc')
            || panelEl.querySelector('.iwac-vis-panel-desc');
        return p ? (p.textContent || '').trim() : '';
    }

    /**
     * Word-wrap `text` to fit `maxWidth` at the canvas's current font,
     * truncating with `…` if it would otherwise exceed `maxLines`.
     */
    function wrapText(ctx, text, maxWidth, maxLines) {
        if (!text) return [];
        var words = String(text).split(/\s+/);
        var lines = [];
        var current = '';
        for (var i = 0; i < words.length && lines.length < maxLines; i++) {
            var trial = current ? current + ' ' + words[i] : words[i];
            if (ctx.measureText(trial).width <= maxWidth) {
                current = trial;
            } else {
                if (current) {
                    lines.push(current);
                    current = words[i];
                } else {
                    // single word longer than the line — push truncated
                    var t = words[i];
                    while (t && ctx.measureText(t + '…').width > maxWidth) {
                        t = t.slice(0, -1);
                    }
                    lines.push(t + '…');
                    current = '';
                }
            }
        }
        if (current && lines.length < maxLines) lines.push(current);
        // If we ran out of lines but still had words, ellipsize the last.
        if (lines.length === maxLines && i < words.length) {
            var last = lines[maxLines - 1];
            while (last && ctx.measureText(last + '…').width > maxWidth) {
                last = last.slice(0, -1);
            }
            lines[maxLines - 1] = last + '…';
        }
        return lines;
    }

    /** Truncate `text` to fit `maxWidth` at the canvas's current font. */
    function truncateForCanvas(ctx, text, maxWidth) {
        if (!text) return '';
        if (ctx.measureText(text).width <= maxWidth) return text;
        var t = text;
        while (t && ctx.measureText(t + '…').width > maxWidth) {
            t = t.slice(0, -1);
        }
        return t ? t + '…' : '';
    }

    /**
     * Promise<string|null> — composite a self-describing PNG with the
     * panel title, optional description, the chart raster `inner`, and a
     * footer showing the export date and IWAC attribution. Resolves to
     * null when it cannot, in which case the caller keeps the bare raster
     * (`P.downloadPanelImage`).
     *
     * Why we wait on `document.fonts.load` first: canvas2d's `font`
     * property accepts any string but silently uses a fallback if the
     * named family hasn't been loaded yet. Without this, exports drawn
     * during the first interaction with a fresh page would render in
     * Times New Roman instead of Public Sans.
     */
    function compositeFrom(panelEl, inner) {
        return new Promise(function (resolve) {
            if (!inner) { resolve(null); return; }

            // `getChartTokens()` fills every key from the theme's own
            // fallback palette, so no colour below needs a literal of its own.
            var tokens = ns.getChartTokens();
            var fontStack = tokens.fontFamily;

            // Match the chart's pixelRatio export so text and chrome
            // render at the same DPI as the chart raster.
            var SCALE = EXPORT_SCALE;
            var pad = 24 * SCALE;
            var titlePx = 16 * SCALE;
            var subPx = 11 * SCALE;
            var subLineH = Math.round(15 * SCALE);
            var footerPx = 10 * SCALE;
            var sepGap = 12 * SCALE;

            var fontsReady;
            if (document.fonts && document.fonts.load) {
                fontsReady = Promise.all([
                    document.fonts.load('600 ' + titlePx + 'px ' + fontStack),
                    document.fonts.load('400 ' + subPx   + 'px ' + fontStack),
                    document.fonts.load('400 ' + footerPx + 'px ' + fontStack)
                ]).catch(function () { /* best-effort */ });
            } else {
                fontsReady = Promise.resolve();
            }

            Promise.all([loadImage(inner), fontsReady])
                .then(function (results) {
                    var img = results[0];
                    if (!img) { resolve(null); return; }

                    var imgW = img.naturalWidth || img.width;
                    var imgH = img.naturalHeight || img.height;
                    var W = Math.max(imgW, 720 * SCALE / 2);

                    var title = readPanelTitle(panelEl);
                    var subtitle = readPanelSubtitle(panelEl);

                    // Use a throwaway canvas to measure subtitle wrapping.
                    var measure = document.createElement('canvas').getContext('2d');
                    measure.font = '400 ' + subPx + 'px ' + fontStack;
                    var subLines = subtitle
                        ? wrapText(measure, subtitle, W - 2 * pad, 2)
                        : [];

                    var headerH = 0;
                    if (title) {
                        headerH = pad + titlePx;
                        if (subLines.length) {
                            headerH += Math.round(8 * SCALE) + subLines.length * subLineH;
                        }
                        headerH += sepGap;
                    }
                    var footerH = Math.round(10 * SCALE) + footerPx + Math.round(8 * SCALE);
                    var H = headerH + imgH + footerH;

                    var canvas = document.createElement('canvas');
                    canvas.width = W;
                    canvas.height = H;
                    var c = canvas.getContext('2d');
                    if (!c) { resolve(null); return; }

                    // Background — surface token so the export blends
                    // with the surrounding theme rather than the page bg.
                    c.fillStyle = tokens.surface;
                    c.fillRect(0, 0, W, H);

                    // Header
                    if (title) {
                        c.textBaseline = 'top';
                        c.textAlign = 'left';
                        c.fillStyle = tokens.ink;
                        c.font = '600 ' + titlePx + 'px ' + fontStack;
                        c.fillText(
                            truncateForCanvas(c, title, W - 2 * pad),
                            pad, pad
                        );

                        if (subLines.length) {
                            c.fillStyle = tokens.inkLight;
                            c.font = '400 ' + subPx + 'px ' + fontStack;
                            for (var i = 0; i < subLines.length; i++) {
                                c.fillText(
                                    subLines[i],
                                    pad,
                                    pad + titlePx + Math.round(8 * SCALE) + i * subLineH
                                );
                            }
                        }

                        c.strokeStyle = tokens.border;
                        c.lineWidth = 1;
                        c.beginPath();
                        c.moveTo(pad, headerH - sepGap / 2);
                        c.lineTo(W - pad, headerH - sepGap / 2);
                        c.stroke();
                    }

                    // Chart raster — centred horizontally
                    var chartX = Math.round((W - imgW) / 2);
                    c.drawImage(img, chartX, headerH);

                    // Footer — date left, attribution right
                    c.textBaseline = 'top';
                    c.fillStyle = tokens.muted;
                    c.font = '400 ' + footerPx + 'px ' + fontStack;
                    var footerY = headerH + imgH + Math.round(10 * SCALE);
                    var date = new Date().toISOString().slice(0, 10);
                    c.textAlign = 'left';
                    c.fillText(date, pad, footerY);
                    c.textAlign = 'right';
                    c.fillText('Islam West Africa Collection', W - pad, footerY);

                    try {
                        resolve(canvas.toDataURL('image/png'));
                    } catch (e) {
                        // Tainted canvas (cross-origin tile in maplibre image, etc.)
                        console.warn('IWACVis.panel-toolbar: composite tainted, falling back', e);
                        resolve(null);
                    }
                })
                .catch(function (err) {
                    console.error('IWACVis.panel-toolbar: composite failed', err);
                    resolve(null);
                });
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Download trigger                                                  */
    /* ----------------------------------------------------------------- */

    /**
     * Hand the browser a URL to save under `filename`. Public: the graph
     * toolbars used to build their own throwaway anchor, twice.
     */
    function triggerDownload(dataUrl, filename) {
        if (!dataUrl) return;
        var link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    P.triggerDownload = triggerDownload;

    /** Filesystem-safe filename stem from the panel's title. */
    function filenameFromPanel(panelEl) {
        var title = readPanelTitle(panelEl);
        if (!title) title = 'iwac-chart';
        return title
            .toLowerCase()
            .replace(/[^a-z0-9À-ſ]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 80) || 'iwac-chart';
    }

    /**
     * Composite `raster` with its panel's title, description, export date
     * and attribution, and download it — the bare raster when compositing
     * fails (a tainted canvas, a font that will not load).
     *
     * The one export path: the panel toolbar's Download button and both
     * graph toolbars go through it, so a saved network is as self-describing
     * as a saved bar chart: the graphs used to save a headless 2× canvas
     * while every other panel saved a captioned 3× figure.
     *
     * @param {HTMLElement} panelEl  the `.iwac-vis-panel` whose text frames it
     * @param {string|Promise<(string|null)>|null} raster  PNG data URL,
     *   ideally rendered at `P.EXPORT_SCALE` so it matches the chrome's DPI
     * @param {string} [filename]  default: a stem of the panel title + `.png`
     * @returns {Promise<void>}
     */
    P.downloadPanelImage = function (panelEl, raster, filename) {
        var name = filename || (filenameFromPanel(panelEl) + '.png');
        return Promise.resolve(raster)
            .then(function (inner) {
                if (!inner) return null;
                return compositeFrom(panelEl, inner).then(
                    function (composite) { return composite || inner; },
                    function (err) {
                        console.error('IWACVis.panel-toolbar: composite failed', err);
                        return inner;
                    }
                );
            })
            .then(function (dataUrl) {
                if (dataUrl) triggerDownload(dataUrl, name);
            });
    };

    /* ----------------------------------------------------------------- */
    /*  Toolbar plumbing                                                  */
    /* ----------------------------------------------------------------- */

    /**
     * A toolbar icon button: the shared `.iwac-vis-btn` skin, the glyph as
     * its face, the label as both its accessible name and its tooltip.
     *
     * One builder for the three toolbars that each wrote this function —
     * the panel toolbar, the canvas force graph's column and the ECharts
     * graphs' column differ only in the geometry class.
     *
     * @param {string} glyph
     * @param {string} label
     * @param {function(Event):void} [onClick]
     * @param {string} [className='iwac-vis-panel-toolbar__btn']
     * @returns {HTMLButtonElement}
     */
    P.iconButton = function (glyph, label, onClick, className) {
        var b = P.el('button', 'iwac-vis-btn ' + (className || BTN_CLASS), glyph);
        b.type = 'button';
        b.setAttribute('aria-label', label);
        b.title = label;
        if (typeof onClick === 'function') b.addEventListener('click', onClick);
        return b;
    };

    /* ----------------------------------------------------------------- */
    /*  Fullscreen                                                        */
    /* ----------------------------------------------------------------- */

    /**
     * Make `button` toggle `target` in and out of fullscreen.
     *
     * Every fullscreen control in the module binds through here: the panel
     * toolbar's, both graph toolbars' and the Entity Networks layout's.
     * There were three hand-written copies of the toggle and of its
     * self-cleaning `fullscreenchange` listener, and none of them had an
     * answer for an iPhone, where Safari offers no element fullscreen at
     * all: the button did nothing.
     *
     *   - `aria-pressed` on the button mirrors the state, and the pressed
     *     style keys on it, so the visual and the announced state cannot
     *     disagree.
     *   - `stateClass` on the target mirrors it too — one CSS hook for
     *     native fullscreen and the fallback alike.
     *   - Without the Fullscreen API (or when the request is refused) the
     *     state class alone is the overlay: `.iwac-vis-panel--fullscreen`
     *     is already styled exactly like `:fullscreen`. Escape leaves it and
     *     focus comes back to the toggle, as it would from a dialog.
     *   - The `fullscreenchange` listener removes itself once the target has
     *     left the document, instead of one detached closure per panel ever
     *     built on the page.
     *
     * @param {HTMLButtonElement} button
     * @param {HTMLElement} target   what expands — a panel, or a whole layout
     * @param {Object} [opts]
     * @param {function(boolean):void} [opts.onChange]  called a beat after
     *   every change, once the browser has applied the new size — resize
     *   the chart or map here
     * @param {string} [opts.stateClass='iwac-vis-panel--fullscreen']
     * @returns {{isFullscreen: function():boolean}}
     */
    P.bindFullscreen = function (button, target, opts) {
        opts = opts || {};
        var stateClass = opts.stateClass || 'iwac-vis-panel--fullscreen';
        var overlay = false;

        function isFull() {
            return overlay || document.fullscreenElement === target;
        }

        function sync() {
            var full = isFull();
            target.classList.toggle(stateClass, full);
            button.setAttribute('aria-pressed', full ? 'true' : 'false');
            if (typeof opts.onChange === 'function') {
                setTimeout(function () { opts.onChange(full); }, 50);
            }
        }

        // Only the overlay needs this: in native fullscreen the browser owns
        // Escape. A control inside the target that has something of its own
        // to dismiss first (a graph selection, an open dropdown) stops the
        // event before it gets here.
        function onKey(e) {
            if (!document.body.contains(target)) { setOverlay(false); return; }
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            setOverlay(false);
            try { button.focus({ preventScroll: true }); } catch (err) { /* gone */ }
        }

        function setOverlay(on) {
            if (overlay === on) return;
            overlay = on;
            if (on) document.addEventListener('keydown', onKey);
            else document.removeEventListener('keydown', onKey);
            sync();
        }

        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', function () {
            if (overlay) { setOverlay(false); return; }
            if (document.fullscreenElement) {
                if (document.exitFullscreen) document.exitFullscreen();
                return;
            }
            if (document.fullscreenEnabled && typeof target.requestFullscreen === 'function') {
                var request = target.requestFullscreen();
                if (request && typeof request.catch === 'function') {
                    request.catch(function () { setOverlay(true); });
                }
                return;
            }
            setOverlay(true);
        });

        var onChange = function () {
            if (!document.body.contains(target)) {
                document.removeEventListener('fullscreenchange', onChange);
                return;
            }
            sync();
        };
        document.addEventListener('fullscreenchange', onChange);

        return { isFullscreen: isFull };
    };

    /** Find or lazily create the toolbar container inside a panel. */
    function ensureToolbar(panelEl) {
        if (!panelEl) return null;
        var bar = panelEl.querySelector(':scope > .' + TOOLBAR_CLASS);
        if (bar) return bar;
        bar = P.el('div', TOOLBAR_CLASS);
        panelEl.appendChild(bar);
        return bar;
    }

    // Exposed so the shared embed helpers (embed.js) can drop their
    // "copy embed code" button into the same floating toolbar as the
    // Download / Fullscreen buttons, instead of re-implementing it.
    P.ensureToolbar = ensureToolbar;

    /**
     * Public helper: add a Download button to the toolbar for the given
     * chart container. Idempotent — calling it a second time on the
     * same panel is a no-op (the toolbar already has a download button),
     * which is what lets a panel holding several charts (sentiment's three
     * bars) register each of them without moving the export target.
     */
    P.addDownloadButton = function (panelEl, chartEl) {
        if (!panelEl || !chartEl) return null;
        var bar = ensureToolbar(panelEl);
        if (bar.querySelector('.iwac-vis-panel-toolbar__btn--download')) return bar;
        bar._iwacDownloadTarget = chartEl;
        var btn = P.iconButton('⭳', P.t('Download chart'), function () {
            if (btn.disabled) return;
            btn.disabled = true;
            btn.classList.add('iwac-vis-panel-toolbar__btn--busy');
            // Read at click time: `P.setDownloadTarget` may have moved it.
            P.downloadPanelImage(panelEl, resolveDataUrl(bar._iwacDownloadTarget))
                .then(function () {
                    btn.disabled = false;
                    btn.classList.remove('iwac-vis-panel-toolbar__btn--busy');
                });
        });
        btn.classList.add('iwac-vis-panel-toolbar__btn--download');
        bar.appendChild(btn);
        return bar;
    };

    /**
     * Point a panel's Download button at another chart or map container —
     * for a panel that swaps which of its renderers is visible (Entity
     * Networks' Entities / Places graphs). Updates the button in place, so
     * the toolbar keeps its order; adds the button if there is none yet.
     *
     * @param {HTMLElement} panelEl
     * @param {HTMLElement} chartEl
     */
    P.setDownloadTarget = function (panelEl, chartEl) {
        if (!panelEl || !chartEl) return;
        var bar = panelEl.querySelector(':scope > .' + TOOLBAR_CLASS);
        if (bar && bar.querySelector('.iwac-vis-panel-toolbar__btn--download')) {
            bar._iwacDownloadTarget = chartEl;
            return;
        }
        P.addDownloadButton(panelEl, chartEl);
    };

    /**
     * Public helper: add a Fullscreen toggle to the toolbar, bound through
     * `P.bindFullscreen`. By default the panel itself expands and takes the
     * `.iwac-vis-panel--fullscreen` class iwac-core.css lays out.
     *
     * @param {HTMLElement} panelEl
     * @param {Object} [opts]
     * @param {function(boolean):void} [opts.onResize]  after every change
     * @param {HTMLElement} [opts.target=panelEl]  expand this instead — a
     *   layout that holds the panel and the controls that read it
     * @param {string} [opts.stateClass]  see `P.bindFullscreen`
     */
    P.addFullscreenButton = function (panelEl, opts) {
        if (!panelEl) return null;
        opts = opts || {};
        var bar = ensureToolbar(panelEl);
        if (bar.querySelector('.iwac-vis-panel-toolbar__btn--fullscreen')) return bar;

        var btn = P.iconButton('⛶', P.t('Toggle fullscreen'));
        btn.classList.add('iwac-vis-panel-toolbar__btn--fullscreen');
        bar.appendChild(btn);
        P.bindFullscreen(btn, opts.target || panelEl, {
            stateClass: opts.stateClass,
            onChange: opts.onResize
        });
        return bar;
    };

    /* ----------------------------------------------------------------- */
    /*  Table + CSV                                                       */
    /* ----------------------------------------------------------------- */

    /**
     * Register the rows a panel's table and CSV are built from, for a
     * panel whose data is not an ECharts option — the map panels. The
     * provider is called at open time and after every `P.panelRowsChanged`,
     * and returns `{ columns: [{label, numeric}], rows: [[cell…]] }` or null.
     * A cell may be `{ text, href }` for a link, which is how a place row
     * reaches the place's item page without a pointer.
     *
     * @param {HTMLElement} panelEl
     * @param {function(): (Object|null)} provider
     */
    P.setPanelRows = function (panelEl, provider) {
        if (!panelEl) return;
        panelEl._iwacRows = typeof provider === 'function' ? provider : null;
        refreshTableButtons(panelEl);
    };

    /** The rows behind a panel changed (a facet, a year): refresh the table. */
    P.panelRowsChanged = function (panelEl) {
        if (!panelEl || typeof panelEl.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
        try { panelEl.dispatchEvent(new CustomEvent('iwac:repaint', { bubbles: false })); }
        catch (e) { /* enhancement only */ }
    };

    /** The rows for a panel: its own provider first, else its chart's option. */
    function rowsFor(panelEl, chartEl) {
        if (typeof panelEl._iwacRows === 'function') {
            try { return panelEl._iwacRows() || null; }
            catch (e) { console.error('IWACVis.panel-toolbar: rows provider failed', e); return null; }
        }
        if (!P.optionToRows || !ns.lastOption) return null;
        var option = ns.lastOption(chartEl);
        return option ? P.optionToRows(option) : null;
    }

    /** Cheap: does the panel have anything a table could show right now? */
    function hasRows(panelEl, chartEl) {
        if (typeof panelEl._iwacRows === 'function') {
            var table = rowsFor(panelEl, chartEl);
            return !!(table && table.rows && table.rows.length);
        }
        if (!P.hasTabularOption || !ns.lastOption) return false;
        return P.hasTabularOption(ns.lastOption(chartEl));
    }

    function refreshTableButtons(panelEl) {
        var bar = panelEl.querySelector(':scope > .' + TOOLBAR_CLASS);
        if (!bar || !bar._iwacRefreshTable) return;
        bar._iwacRefreshTable();
    }

    /**
     * The in-page table. Plain markup rather than `P.buildTable` — that
     * builder is opt-in per block (pagination + card layout) and this has
     * to work on every panel of every block; a capped table with a note
     * pointing at the CSV is the right size for a chart's own numbers.
     */
    function renderTable(host, table) {
        host.innerHTML = '';
        if (!table || !table.rows || !table.rows.length) {
            host.appendChild(P.el('p', 'iwac-vis-muted', P.t('No data available')));
            return;
        }
        var wrap = P.el('div', 'iwac-vis-table-wrapper');
        var tableEl = P.el('table', 'iwac-vis-table iwac-vis-panel-table__table');
        var thead = P.el('thead');
        var head = P.el('tr');
        table.columns.forEach(function (col) {
            var th = P.el('th', 'iwac-vis-table__header' + (col.numeric ? ' iwac-vis-panel-table__num' : ''),
                col.label);
            th.setAttribute('scope', 'col');
            head.appendChild(th);
        });
        thead.appendChild(head);
        tableEl.appendChild(thead);
        var tbody = P.el('tbody');
        var shown = table.rows.slice(0, TABLE_ROW_CAP);
        shown.forEach(function (row) {
            var tr = P.el('tr', 'iwac-vis-table__row');
            row.forEach(function (cell, i) {
                var numeric = table.columns[i] && table.columns[i].numeric;
                var td = P.el('td', numeric ? 'iwac-vis-panel-table__num' : null);
                if (cell != null && typeof cell === 'object' && !Array.isArray(cell)) {
                    if (cell.href) {
                        var a = P.el('a', null, cell.text != null ? String(cell.text) : '');
                        a.href = cell.href;
                        td.appendChild(a);
                    } else {
                        td.textContent = cell.text != null ? String(cell.text) : '';
                    }
                } else if (typeof cell === 'number') {
                    td.textContent = P.formatNumber(cell);
                } else {
                    td.textContent = cell == null ? '' : String(cell);
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tableEl.appendChild(tbody);
        wrap.appendChild(tableEl);
        host.appendChild(wrap);
        if (table.rows.length > shown.length) {
            host.appendChild(P.el('p', 'iwac-vis-muted iwac-vis-panel-table__note',
                P.t('table_rows_capped', {
                    shown: P.formatNumber(shown.length),
                    total: P.formatNumber(table.rows.length)
                })));
        }
    }

    function downloadCsv(panelEl, chartEl) {
        var table = rowsFor(panelEl, chartEl);
        if (!table || !P.rowsToCsv) return;
        var csv = P.rowsToCsv(table);
        var name = filenameFromPanel(panelEl) + '.csv';
        if (typeof Blob !== 'undefined' && window.URL && URL.createObjectURL) {
            var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            var href = URL.createObjectURL(blob);
            triggerDownload(href, name);
            setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
        } else {
            triggerDownload('data:text/csv;charset=utf-8,' + encodeURIComponent(csv), name);
        }
    }

    /**
     * Public helper: add "View as table" (a disclosure: `aria-expanded` +
     * `aria-controls` on the button, the table under the chart) and
     * "Download CSV" to the toolbar. Idempotent per panel. The buttons are
     * disabled, not hidden, while the panel has no rows — a chart that is
     * still loading gets them the moment it paints.
     */
    P.addTableButtons = function (panelEl, chartEl) {
        if (!panelEl || !chartEl) return null;
        var bar = ensureToolbar(panelEl);
        if (bar.querySelector('.iwac-vis-panel-toolbar__btn--table')) return bar;

        var tableHost = P.el('div', 'iwac-vis-panel-table');
        tableHost.id = 'iwac-vis-panel-table-' + (++_tableUid);
        tableHost.hidden = true;
        panelEl.appendChild(tableHost);

        var open = false;
        var tableBtn = P.iconButton('▤', P.t('View as table'), function () {
            open = !open;
            tableHost.hidden = !open;
            // The pressed look keys on aria-expanded (iwac-core.css), so it
            // cannot drift from what a screen reader is told.
            tableBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            var label = open ? P.t('Hide table') : P.t('View as table');
            tableBtn.setAttribute('aria-label', label);
            tableBtn.title = label;
            if (open) renderTable(tableHost, rowsFor(panelEl, chartEl));
            else refresh();
        });
        tableBtn.classList.add('iwac-vis-panel-toolbar__btn--table');
        tableBtn.setAttribute('aria-expanded', 'false');
        tableBtn.setAttribute('aria-controls', tableHost.id);
        bar.appendChild(tableBtn);

        var csvBtn = P.iconButton('CSV', P.t('Download CSV'), function () {
            downloadCsv(panelEl, chartEl);
        });
        csvBtn.classList.add('iwac-vis-panel-toolbar__btn--csv');
        bar.appendChild(csvBtn);

        function refresh() {
            var available = hasRows(panelEl, chartEl);
            // An open table stays closable when the chart empties under it
            // (a facet with no rows): the disclosure shows the empty note
            // and its button keeps working; only a CLOSED one is disabled.
            tableBtn.disabled = !available && !open;
            csvBtn.disabled = !available;
            if (open) renderTable(tableHost, available ? rowsFor(panelEl, chartEl) : null);
        }
        bar._iwacRefreshTable = refresh;
        // The chart's own repaints bubble up from its host; a map panel's
        // provider announces its changes on the panel itself.
        panelEl.addEventListener('iwac:repaint', refresh);
        refresh();
        return bar;
    };

    /**
     * Auto-wire hook called from `ns.registerChart` and `ns.registerMap`.
     * Walks up from the chart element to the first `.iwac-vis-panel`
     * ancestor and adds the Download, table and CSV buttons unless the
     * panel opts out (`data-iwac-no-panel-toolbar` for all of them,
     * `data-iwac-no-table` for the table pair).
     */
    P.autoAttachPanelToolbar = function (chartEl) {
        if (!chartEl || !chartEl.closest) return;
        if (chartEl.classList && chartEl.classList.contains('iwac-vis-graph-host')) return;
        var panel = chartEl.closest('.iwac-vis-panel');
        if (!panel) return;
        if (panel.getAttribute && panel.getAttribute('data-iwac-no-panel-toolbar') === '1') return;
        P.addDownloadButton(panel, chartEl);
        if (panel.getAttribute && panel.getAttribute('data-iwac-no-table') === '1') return;
        P.addTableButtons(panel, chartEl);
    };
})();
