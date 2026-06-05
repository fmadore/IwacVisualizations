/**
 * IWAC Visualizations — Article Dashboard: sentiment radar
 *
 * Renders an ECharts radar comparing the three AI models across
 * polarity / centrality / subjectivity dimensions. Unlike every other
 * article-dashboard panel, the data source isn't the precomputed JSON
 * — it comes from an inline `<script type="application/json">` block
 * emitted server-side by `article.phtml`, so the chart stays in sync
 * with editorial changes on islam.zmo.de without a precompute pass.
 *
 * The panel is auto-discovered by scanning for
 * `.iwac-vis-sent-radar__chart` instead of being invoked from the
 * orchestrator (which only knows about precompute-driven panels).
 *
 * Colours come from the three model tokens we add to iwac-core.css
 * (`--iwac-vis-model-gemini`, `--iwac-vis-model-chatgpt`,
 * `--iwac-vis-model-mistral`). Falls back to IWAC palette entries if
 * the tokens aren't loaded.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.article-dashboard/radar: missing panels');
        return;
    }

    /** Read a CSS custom property from the document root. */
    function cssVar(name) {
        if (typeof getComputedStyle === 'undefined' || !document.documentElement) return '';
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    /** Per-model line + fill colours, theme-aware. */
    function paletteFor(modelKey) {
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var fallbacks = {
            gemini:  palette[1] || '#3b82f6',
            chatgpt: palette[2] || '#10a37f',
            mistral: palette[0] || '#f97316'
        };
        var color = cssVar('--iwac-vis-model-' + modelKey) || fallbacks[modelKey] || palette[0] || '#888';
        return {
            line: color,
            fill: color // we'll apply alpha at ECharts level via areaStyle
        };
    }

    function initOne(canvasEl) {
        var jsonScript = canvasEl.parentNode
            && canvasEl.parentNode.querySelector('.iwac-vis-sent-radar__data');
        if (!jsonScript) return;
        var data;
        try { data = JSON.parse(jsonScript.textContent); }
        catch (e) {
            console.error('IWACVis radar: bad JSON', e);
            return;
        }
        if (!data || !data.models || !data.models.length) return;

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var labels = data.labels || ['Polarity', 'Centrality', 'Subjectivity'];

        // Radar axis definitions — 0..5 scale matches the canonical
        // IWAC sentiment scoring. Max is 5; min is implicit at 0.
        var indicators = labels.map(function (name) {
            return { name: name, max: 5 };
        });

        // Translate the model labels (already done server-side) and
        // stash their per-dimension word labels so the tooltip can
        // say "Gemini: Positif" instead of "Gemini: 4".
        var seriesData = data.models.map(function (m) {
            var p = paletteFor(m.key);
            return {
                name:       m.label,
                modelKey:   m.key,
                value:      [m.polarite, m.centralite, m.subjectivite],
                textLabels: [m.polariteLabel, m.centraliteLabel, m.subjectiviteLabel],
                itemStyle:  { color: p.line },
                lineStyle:  { color: p.line, width: 2.5 },
                areaStyle:  { color: p.line, opacity: 0.18 },
                symbol:     'circle',
                symbolSize: 6
            };
        });

        // Theme-aware fallbacks: a hard-coded dark hex for `tokens.ink`
        // (e.g. "#222") is invisible on a dark surface, which is exactly
        // how the polarity / centrality / subjectivity labels became
        // unreadable in dark mode. Pick light defaults for dark theme.
        var isDark = ns.getCurrentTheme && ns.getCurrentTheme() === 'dark';
        var fallbackInk      = isDark ? '#e6e7eb' : '#2c2f37';
        var fallbackInkLight = isDark ? '#b1b3ba' : '#535862';
        var fallbackBorder   = isDark ? '#3d4148' : '#d4d6da';
        var inkColor      = tokens.ink      || fallbackInk;
        var inkLightColor = tokens.inkLight || fallbackInkLight;
        var borderColor   = tokens.borderLight || tokens.border || fallbackBorder;

        ns.registerChart(canvasEl, function (el, instance) {
            instance.setOption({
                tooltip: {
                    trigger: 'item',
                    confine: true,
                    appendTo: function (hostEl) { return hostEl; },
                    // For radar charts ECharts exposes each dataset as
                    // one item; `p.name` is the dataset label (= model
                    // name, e.g. "Gemini 3 Flash"). We deliberately do
                    // NOT use `p.seriesName` because the series itself
                    // is unnamed and would fall back to "series0".
                    formatter: function (p) {
                        var d = p.data || {};
                        var modelName = p.name || (d && d.name) || '';
                        var lines = ['<strong>' + modelName + '</strong>'];
                        for (var i = 0; i < labels.length; i++) {
                            var v = (p.value || [])[i];
                            var wordLabel = d.textLabels && d.textLabels[i];
                            lines.push(
                                labels[i] + ': ' +
                                (wordLabel ? wordLabel : (v || '\u2014'))
                            );
                        }
                        return lines.join('<br>');
                    }
                },
                legend: {
                    bottom: 0,
                    textStyle: { color: inkLightColor }
                },
                radar: {
                    indicator: indicators,
                    center: ['50%', '50%'],
                    radius: '65%',
                    splitNumber: 5,
                    axisName: {
                        color: inkColor,
                        fontWeight: 600,
                        fontSize: 12
                    },
                    splitLine: {
                        lineStyle: { color: borderColor }
                    },
                    splitArea: { show: false },
                    axisLine: {
                        lineStyle: { color: borderColor }
                    }
                },
                series: [{
                    type: 'radar',
                    emphasis: { focus: 'series', areaStyle: { opacity: 0.3 } },
                    data: seriesData
                }]
            }, true);
        });
    }

    function init() {
        if (typeof echarts === 'undefined') return;
        var hosts = document.querySelectorAll('.iwac-vis-sent-radar__chart');
        for (var i = 0; i < hosts.length; i++) initOne(hosts[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Still register under articleDashboard namespace for consistency
    // with the other panels — though the orchestrator does NOT call
    // `render` on the radar (we self-init on DOMContentLoaded instead)
    // because the radar lives outside the precompute-driven grid.
    ns.articleDashboard = ns.articleDashboard || {};
    ns.articleDashboard.radar = { render: function () {} };
})();
