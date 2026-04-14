/**
 * IWAC Visualizations — Shared panel toolbar
 *
 * Adds a small floating toolbar to any `.iwac-vis-panel` with:
 *   - a Download button that saves the visualization as a PNG via
 *     `chart.getDataURL()` (ECharts) or `map.getCanvas().toDataURL()`
 *     (MapLibre — requires `preserveDrawingBuffer: true` in the map
 *     options, which `createIwacMap` sets by default)
 *   - an optional Fullscreen toggle that uses the Fullscreen API on
 *     the panel element itself
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

    /**
     * Resolve the download data URL for a chart element, trying the
     * ECharts path first and falling back to MapLibre. Returns null if
     * neither is registered for the element.
     */
    function resolveDataUrl(el) {
        return echartsDataUrl(el) || maplibreDataUrl(el);
    }

    /**
     * Trigger a browser download for a data URL with the given filename.
     * Falls back to opening the image in a new tab if the download
     * attribute is not honoured (rare, legacy Safari).
     */
    function triggerDownload(dataUrl, filename) {
        if (!dataUrl) return;
        var link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.rel = 'noopener';
        // Safari ignores .download unless the element is in the DOM.
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Derive a filesystem-safe filename stem from the panel's h4 title.
     * Non-alphanumerics collapse to hyphens; runs of hyphens are trimmed.
     */
    function filenameFromPanel(panelEl) {
        var title = '';
        var h4 = panelEl && panelEl.querySelector && panelEl.querySelector('h4');
        if (h4) title = h4.textContent || '';
        if (!title) title = 'iwac-chart';
        return title
            .toLowerCase()
            .replace(/[^a-z0-9\u00c0-\u017f]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 80) || 'iwac-chart';
    }

    /**
     * Build a standard icon button that inherits `.iwac-vis-btn` styling.
     * The label is a short unicode glyph; the title/aria-label is the
     * translated tooltip text.
     */
    function buildBtn(glyph, titleText, onClick) {
        var b = P.el('button', BTN_CLASS, glyph);
        b.type = 'button';
        b.setAttribute('aria-label', titleText);
        b.title = titleText;
        b.addEventListener('click', onClick);
        return b;
    }

    /**
     * Find (or lazily create) the toolbar container inside a panel. The
     * toolbar is an absolutely-positioned flex box in the panel's top-
     * right corner; CSS in iwac-visualizations.css handles the layout.
     */
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
     *
     * @param {HTMLElement} panelEl   The `.iwac-vis-panel` wrapper
     * @param {HTMLElement} chartEl   The `.iwac-vis-chart` that registerChart was called with
     */
    P.addDownloadButton = function (panelEl, chartEl) {
        if (!panelEl || !chartEl) return null;
        var bar = ensureToolbar(panelEl);
        if (bar.querySelector('.iwac-vis-panel-toolbar__btn--download')) return bar;
        var btn = buildBtn('\u2B73', P.t('Download chart'), function () {
            var dataUrl = resolveDataUrl(chartEl);
            if (dataUrl) triggerDownload(dataUrl, filenameFromPanel(panelEl) + '.png');
        });
        btn.classList.add('iwac-vis-panel-toolbar__btn--download');
        bar.appendChild(btn);
        return bar;
    };

    /**
     * Public helper: add a Fullscreen toggle to the toolbar. The panel
     * element itself enters native fullscreen via the Fullscreen API;
     * the `.iwac-vis-panel--fullscreen` class is toggled for the layout
     * adjustments already defined in iwac-visualizations.css.
     *
     * Optional `onResize` fires after the browser has applied the new
     * viewport so callers (ECharts / MapLibre panels) can rescale.
     *
     * @param {HTMLElement} panelEl
     * @param {{ onResize?: function(boolean): void }} [opts]
     */
    P.addFullscreenButton = function (panelEl, opts) {
        if (!panelEl) return null;
        opts = opts || {};
        var bar = ensureToolbar(panelEl);
        if (bar.querySelector('.iwac-vis-panel-toolbar__btn--fullscreen')) return bar;

        var btn = buildBtn('\u26F6', P.t('Toggle fullscreen'), function () {
            if (!document.fullscreenElement) {
                if (panelEl.requestFullscreen) panelEl.requestFullscreen();
            } else if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        });
        btn.classList.add('iwac-vis-panel-toolbar__btn--fullscreen');
        bar.appendChild(btn);

        // React to native fullscreen changes (Esc key, F11, etc.).
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
     * Download button unless:
     *   - the ancestor panel sets `data-iwac-no-panel-toolbar="1"`
     *   - the chart host itself carries the `.iwac-vis-graph-host`
     *     class (the network panel ships its own toolbar)
     *
     * Exposed on the `IWACVis.panels` namespace so dashboard-core can
     * call it without taking a hard dependency on this file — if this
     * module didn't load, registerChart simply skips the toolbar step.
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
