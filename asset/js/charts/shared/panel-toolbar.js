/**
 * IWAC Visualizations — Shared panel toolbar
 *
 * Adds a small floating toolbar to any `.iwac-vis-panel` with:
 *   - a Download button that exports a PNG composited with the panel's
 *     title, description and a footer (ISO date + IWAC attribution)
 *     so screenshots are self-describing instead of headless chart
 *     rectangles. Falls back to the raw `chart.getDataURL()` if
 *     compositing fails (e.g. tainted canvas, missing fonts).
 *   - an optional Fullscreen toggle that uses the Fullscreen API on
 *     the panel element itself.
 *
 * The toolbar is auto-attached from both `dashboard-core.registerChart`
 * (ECharts) and `dashboard-core.registerMap` (MapLibre) the first time
 * a chart or map registers under a panel; subsequent registrations
 * (e.g. sentiment's three segmented bars) re-use the same toolbar and
 * silently skip. Panels that ship their own toolbar (the network panel
 * has a graph-toolbar with zoom/legend/fullscreen) mark the chart host
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
    var BTN_CLASS = 'iwac-vis-btn iwac-vis-panel-toolbar__btn';

    /* ----------------------------------------------------------------- */
    /*  Raw image data URLs (no composite)                                */
    /* ----------------------------------------------------------------- */

    /**
     * Return the PNG data URL for an ECharts instance, resolved through
     * the live entry in `ns._charts` so we never read from a disposed
     * instance after a theme swap. Returns null if the chart cannot be
     * located.
     */
    function echartsDataUrl(el) {
        var live = ns.getLiveChart ? ns.getLiveChart(el) : null;
        if (!live || !live.getDataURL) return null;
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        try {
            return live.getDataURL({
                type: 'png',
                pixelRatio: 2,
                backgroundColor: tokens.surface || '#ffffff',
                excludeComponents: ['toolbox']
            });
        } catch (e) {
            console.error('IWACVis.panel-toolbar: getDataURL failed', e);
            return null;
        }
    }

    /**
     * Return the PNG data URL for a MapLibre GL instance. Relies on
     * `preserveDrawingBuffer: true` being set in `createIwacMap` — the
     * WebGL canvas is otherwise cleared after compositing and toDataURL
     * returns a blank image. We trigger a synchronous repaint before
     * reading the canvas so any in-flight tile fetch or pending render
     * is flushed into the drawing buffer first.
     */
    function maplibreDataUrl(el) {
        var live = ns.getLiveMap ? ns.getLiveMap(el) : null;
        if (!live || !live.getCanvas) return null;
        try {
            if (typeof live.redraw === 'function') {
                live.redraw();
            } else if (typeof live.triggerRepaint === 'function') {
                live.triggerRepaint();
            }
            var canvas = live.getCanvas();
            if (!canvas || !canvas.toDataURL) return null;
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.error('IWACVis.panel-toolbar: map toDataURL failed', e);
            return null;
        }
    }

    function resolveDataUrl(el) {
        return echartsDataUrl(el) || maplibreDataUrl(el);
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

    /** Read the panel's `<h4>` title, trimmed. Empty string if absent. */
    function readPanelTitle(panelEl) {
        if (!panelEl) return '';
        var h4 = panelEl.querySelector(':scope > h4') || panelEl.querySelector('h4');
        return h4 ? (h4.textContent || '').trim() : '';
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
     * panel title, optional description, the chart raster, and a footer
     * showing the export date and IWAC attribution. Resolves to null
     * when the inner image can't be obtained, in which case the caller
     * falls back to `resolveDataUrl()`.
     *
     * Why we wait on `document.fonts.load` first: canvas2d's `font`
     * property accepts any string but silently uses a fallback if the
     * named family hasn't been loaded yet. Without this, exports drawn
     * during the first interaction with a fresh page would render in
     * Times New Roman instead of Public Sans.
     */
    function buildCompositeUrl(panelEl, chartEl) {
        return new Promise(function (resolve) {
            var inner = resolveDataUrl(chartEl);
            if (!inner) { resolve(null); return; }

            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            var fontStack = tokens.fontFamily ||
                '"Public Sans", system-ui, -apple-system, sans-serif';

            // Match the chart's pixelRatio: 2 export so text and chrome
            // render at the same DPI as the chart raster.
            var SCALE = 2;
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
                    c.fillStyle = tokens.surface || '#ffffff';
                    c.fillRect(0, 0, W, H);

                    // Header
                    if (title) {
                        c.textBaseline = 'top';
                        c.textAlign = 'left';
                        c.fillStyle = tokens.ink || '#1a1a1a';
                        c.font = '600 ' + titlePx + 'px ' + fontStack;
                        c.fillText(
                            truncateForCanvas(c, title, W - 2 * pad),
                            pad, pad
                        );

                        if (subLines.length) {
                            c.fillStyle = tokens.inkLight || '#535862';
                            c.font = '400 ' + subPx + 'px ' + fontStack;
                            for (var i = 0; i < subLines.length; i++) {
                                c.fillText(
                                    subLines[i],
                                    pad,
                                    pad + titlePx + Math.round(8 * SCALE) + i * subLineH
                                );
                            }
                        }

                        c.strokeStyle = tokens.border || '#d4d6da';
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
                    c.fillStyle = tokens.muted || '#767880';
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

    /** Filesystem-safe filename stem from the panel's h4 title. */
    function filenameFromPanel(panelEl) {
        var title = readPanelTitle(panelEl);
        if (!title) title = 'iwac-chart';
        return title
            .toLowerCase()
            .replace(/[^a-z0-9À-ſ]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 80) || 'iwac-chart';
    }

    /* ----------------------------------------------------------------- */
    /*  Toolbar plumbing                                                  */
    /* ----------------------------------------------------------------- */

    /** Build a standard icon button that inherits `.iwac-vis-btn` styling. */
    function buildBtn(glyph, titleText, onClick) {
        var b = P.el('button', BTN_CLASS, glyph);
        b.type = 'button';
        b.setAttribute('aria-label', titleText);
        b.title = titleText;
        b.addEventListener('click', onClick);
        return b;
    }

    /** Find or lazily create the toolbar container inside a panel. */
    function ensureToolbar(panelEl) {
        if (!panelEl) return null;
        var bar = panelEl.querySelector(':scope > .' + TOOLBAR_CLASS);
        if (bar) return bar;
        bar = P.el('div', TOOLBAR_CLASS);
        panelEl.appendChild(bar);
        return bar;
    }

    /**
     * Public helper: add a Download button to the toolbar for the given
     * chart container. Idempotent — calling it a second time on the
     * same panel is a no-op (the toolbar already has a download button).
     */
    P.addDownloadButton = function (panelEl, chartEl) {
        if (!panelEl || !chartEl) return null;
        var bar = ensureToolbar(panelEl);
        if (bar.querySelector('.iwac-vis-panel-toolbar__btn--download')) return bar;
        var btn = buildBtn('⭳', P.t('Download chart'), function () {
            if (btn.disabled) return;
            btn.disabled = true;
            btn.classList.add('iwac-vis-panel-toolbar__btn--busy');
            buildCompositeUrl(panelEl, chartEl)
                .then(function (composite) {
                    var dataUrl = composite || resolveDataUrl(chartEl);
                    if (dataUrl) triggerDownload(dataUrl, filenameFromPanel(panelEl) + '.png');
                })
                .catch(function (err) {
                    console.error('IWACVis.panel-toolbar: download failed', err);
                    var dataUrl = resolveDataUrl(chartEl);
                    if (dataUrl) triggerDownload(dataUrl, filenameFromPanel(panelEl) + '.png');
                })
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
     * Public helper: add a Fullscreen toggle to the toolbar. The panel
     * element itself enters native fullscreen via the Fullscreen API;
     * the `.iwac-vis-panel--fullscreen` class is toggled for the layout
     * adjustments already defined in iwac-core.css.
     *
     * @param {HTMLElement} panelEl
     * @param {{ onResize?: function(boolean): void }} [opts]
     */
    P.addFullscreenButton = function (panelEl, opts) {
        if (!panelEl) return null;
        opts = opts || {};
        var bar = ensureToolbar(panelEl);
        if (bar.querySelector('.iwac-vis-panel-toolbar__btn--fullscreen')) return bar;

        var btn = buildBtn('⛶', P.t('Toggle fullscreen'), function () {
            if (!document.fullscreenElement) {
                if (panelEl.requestFullscreen) panelEl.requestFullscreen();
            } else if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        });
        btn.classList.add('iwac-vis-panel-toolbar__btn--fullscreen');
        bar.appendChild(btn);

        var onChange = function () {
            var isFull = (document.fullscreenElement === panelEl);
            panelEl.classList.toggle('iwac-vis-panel--fullscreen', isFull);
            btn.classList.toggle('iwac-vis-panel-toolbar__btn--pressed', isFull);
            if (typeof opts.onResize === 'function') {
                setTimeout(function () { opts.onResize(isFull); }, 50);
            }
        };
        document.addEventListener('fullscreenchange', onChange);
        return bar;
    };

    /**
     * Auto-wire hook called from `ns.registerChart`. Walks up from the
     * chart element to the first `.iwac-vis-panel` ancestor and adds a
     * Download button unless the panel opts out.
     */
    P.autoAttachPanelToolbar = function (chartEl) {
        if (!chartEl || !chartEl.closest) return;
        if (chartEl.classList && chartEl.classList.contains('iwac-vis-graph-host')) return;
        var panel = chartEl.closest('.iwac-vis-panel');
        if (!panel) return;
        if (panel.getAttribute && panel.getAttribute('data-iwac-no-panel-toolbar') === '1') return;
        P.addDownloadButton(panel, chartEl);
    };
})();
