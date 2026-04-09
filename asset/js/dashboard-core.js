/**
 * Dashboard core: shared design tokens, helpers, and utilities.
 *
 * Initialises the window.RV namespace and exposes THEME, COLORS,
 * and helper functions used by all chart modules.
 */
(function () {
    'use strict';

    var ns = window.RV = window.RV || {};

    ns.COLORS = [
        '#22817b', '#e07c3e', '#6b5b95', '#d4a574', '#2c5f7c',
        '#c5504d', '#4a8c6f', '#8b6f47', '#7c5295', '#cc8963',
        '#5ba3a0', '#d49b6a', '#8e7cb8', '#e6c9a8', '#4a8aab',
        '#d87e7a', '#6fb08e', '#a68e6d', '#9e7bb8', '#e0a88a'
    ];

    ns.THEME = {
        darkModeEnabled: false,
        accent: '#22817b',
        accentDark: '#4db6ac',
        accentLight: '#b2dfdb',
        gradientEnd: '#b2dfdb',
        text: '#333',
        textMuted: '#666',
        border: '#fff',
        fontSize: 11,
        fontSizeTitle: 14,
        fontSizeEmphasis: 13,
        labelMaxLen: 30,
        barMaxWidth: 24,
        barMaxWidthWide: 40
    };

    /* -- Dark mode detection (gated by THEME.darkModeEnabled) -- */

    var _darkQuery = ns.THEME.darkModeEnabled && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    ns._darkMode = _darkQuery ? _darkQuery.matches : false;
    ns._allCharts = [];

    /** Init an ECharts instance with the correct theme, tracking for dark mode. */
    ns.initChart = function (el) {
        var chart = echarts.init(el, ns._darkMode ? 'dark' : null);
        ns._allCharts.push(chart);
        return chart;
    };

    /** Get the appropriate basemap style URL for the current color scheme. */
    ns.getBasemapStyle = function () {
        return ns._darkMode
            ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
            : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
    };

    /** Build a dataZoom config (slider + scroll) for timeline-type charts. */
    ns.buildDataZoom = function (count) {
        if (count <= 15) return [];
        return [
            { type: 'slider', start: 0, end: 100, bottom: 8, height: 22 },
            { type: 'inside' }
        ];
    };

    /** Truncate a string with ellipsis if it exceeds maxLen. */
    ns.truncateLabel = function (str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.substring(0, maxLen) + '\u2026' : str;
    };

    /** Convert either format to array of { name, value, itemId? }. */
    ns.toEntries = function (data) {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        return Object.keys(data).map(function (k) { return { name: k, value: data[k] }; });
    };

    /** Add click-to-navigate and pointer cursor on chart elements. */
    ns.addClickHandler = function (chart, entries, siteBase) {
        if (!siteBase) return;
        chart.on('click', function (params) {
            var entry = entries.find(function (e) { return e.name === params.name; });
            if (entry && entry.itemId) {
                window.location.href = siteBase + '/item/' + entry.itemId;
            }
        });
        chart.getZr().on('mousemove', function (e) {
            chart.getZr().setCursorStyle(e.target ? 'pointer' : 'default');
        });
    };

    /* -- Global decal toggle state -- */

    ns._decalEnabled = false;

    /** Remove disposed charts from the tracking array. */
    ns.pruneCharts = function () {
        ns._allCharts = ns._allCharts.filter(function (c) { return !c.isDisposed(); });
    };

    /** Toggle decal patterns on all tracked ECharts instances (skips charts flagged _noDecal). */
    ns.toggleDecals = function () {
        ns._decalEnabled = !ns._decalEnabled;
        ns.pruneCharts();
        ns._allCharts.forEach(function (c) {
            if (c._noDecal) return;
            c.setOption({ aria: { enabled: true, decal: { show: ns._decalEnabled } } });
        });
        // Update all toggle button states.
        document.querySelectorAll('[data-action="decal"]').forEach(function (btn) {
            btn.classList.toggle('rv-toolbar-btn-active', ns._decalEnabled);
            btn.title = ns._decalEnabled ? 'Hide patterns' : 'Show patterns';
        });
    };

    /** Attach HTML-level toolbar (save + decal toggle) to a chart panel header. */
    ns.attachToolbar = function (panel, chart) {
        if (!chart || !chart.getDataURL) return;
        var showDecal = !chart._noDecal;
        var bar = document.createElement('span');
        bar.className = 'rv-chart-toolbar';
        bar.innerHTML = (showDecal
            ? '<button type="button" class="rv-toolbar-btn' + (ns._decalEnabled ? ' rv-toolbar-btn-active' : '') + '" data-action="decal" title="' + (ns._decalEnabled ? 'Hide patterns' : 'Show patterns') + '">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="20" y2="4"/><line x1="4" y1="14" x2="14" y2="4"/><line x1="4" y1="8" x2="8" y2="4"/><line x1="10" y1="20" x2="20" y2="10"/><line x1="16" y1="20" x2="20" y2="16"/></svg>'
            + '</button>'
            : '')
            + '<button type="button" class="rv-toolbar-btn" data-action="save" title="Save as image">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
            + '</button>';
        var h4 = panel.querySelector('h4');
        if (h4) h4.appendChild(bar);
        bar.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'save') {
                var url = chart.getDataURL({ pixelRatio: 2, backgroundColor: '#fff' });
                var a = document.createElement('a');
                a.href = url;
                a.download = (panel.querySelector('h4').textContent || 'chart').trim() + '.png';
                a.click();
            } else if (btn.dataset.action === 'decal') {
                ns.toggleDecals();
            }
        });
    };

    /** Backward-compatible helpers bundle for external chart modules. */
    ns.helpers = {
        THEME: ns.THEME, COLORS: ns.COLORS,
        initChart: ns.initChart, truncateLabel: ns.truncateLabel
    };

    /* -- Dark mode listener -- */

    if (_darkQuery) {
        if (ns._darkMode) document.documentElement.classList.add('rv-dark-mode');
        _darkQuery.addEventListener('change', function () {
            ns._darkMode = _darkQuery.matches;
            document.documentElement.classList.toggle('rv-dark-mode', ns._darkMode);
            ns.pruneCharts();
            var theme = ns._darkMode ? 'dark' : 'default';
            ns._allCharts.forEach(function (c) {
                c.setTheme(theme);
            });
        });
    }
})();
