/**
 * IWAC Visualizations — Index Overview: Keywords line chart
 *
 * Multi-series line chart showing keyword prevalence over time for
 * whatever selection the state manager is currently exposing.
 *
 * Design choices (matching the iwac-dashboard Svelte version):
 *   - Smooth splines, one per keyword
 *   - Bisect-x tooltip (axis trigger): hovering a year shows every
 *     series' count at that year
 *   - Adaptive x-axis tick density based on the number of years
 *     (≤10 show every year, ≤20 every 2nd, ≤40 every 5th, else every 10th)
 *   - Label rotation kicks in at >30 years of data
 *   - Years passed as strings to suppress ECharts' thousand-separator
 *     formatting ("1,970" instead of "1970")
 *   - Colors come from the IWAC palette (built from CSS tokens by
 *     iwac-theme.js) — no hex literals here. Empty selection renders
 *     a gentle "select keywords" empty state instead of a broken chart.
 *
 * Takes the full panel object (panel + chart) so the subtitle can be
 * injected as a sibling above the chart div — inserting the subtitle
 * INSIDE the chart div collapses the ECharts canvas to 0px height
 * because the nested `.iwac-vis-chart` wouldn't match the
 * `.iwac-vis-panel > .iwac-vis-chart` CSS height selector.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.index-overview/keywords-chart: missing dependencies');
        return;
    }

    function tickIntervalFor(years) {
        var n = years.length;
        if (n <= 10) return 0;      // every year
        if (n <= 20) return 1;      // every other
        if (n <= 40) return 4;      // every 5th
        return 9;                   // every 10th
    }

    function buildOption(years, keywords, series) {
        var palette = (ns.getPalette && ns.getPalette()) || [];

        var ecSeries = keywords.map(function (kw, idx) {
            var s = series[kw] || { counts: [] };
            var color = palette[idx % Math.max(1, palette.length)];
            return {
                name: kw,
                type: 'line',
                smooth: true,
                symbol: 'circle',
                symbolSize: 6,
                showSymbol: false,
                emphasis: { focus: 'series' },
                lineStyle: { width: 2, color: color },
                itemStyle: { color: color },
                data: s.counts || []
            };
        });

        var rotate = years.length > 30 ? 45 : 0;
        var interval = tickIntervalFor(years);
        var yearsStr = years.map(String);

        return {
            grid: C._grid({ left: 48, right: 24, top: 40, bottom: rotate ? 64 : 48 }),
            legend: {
                type: 'scroll',
                bottom: 4,
                itemWidth: 14,
                itemHeight: 8
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line' }
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: yearsStr,
                name: P.t('Year'),
                nameLocation: 'middle',
                nameGap: rotate ? 44 : 28,
                axisLabel: {
                    interval: interval,
                    rotate: rotate,
                    formatter: function (v) { return String(v); }
                }
            },
            yAxis: {
                type: 'value',
                name: P.t('Count'),
                min: 0
            },
            series: ecSeries,
            animationDuration: 400,
            animationEasing: 'cubicOut'
        };
    }

    function render(panelEl, state) {
        // Subtitle + empty-state notice sit ABOVE the chart as siblings
        // of panelEl.chart — never wrapped inside it. Wrapping collapses
        // the chart to 0px because the inner div no longer matches the
        // `.iwac-vis-panel > .iwac-vis-chart` height rule.
        var subtitle = P.el('div', 'iwac-vis-keywords-chart__subtitle');
        panelEl.panel.insertBefore(subtitle, panelEl.chart);

        var emptyEl = P.el('div', 'iwac-vis-empty iwac-vis-keywords-chart__empty');
        emptyEl.style.display = 'none';
        panelEl.panel.insertBefore(emptyEl, panelEl.chart);

        function applyFromState(instance) {
            var snap = state.get();
            var derived = state.derivedSeries();
            var keywords = derived.keywords;

            // Subtitle reflects the current facet — matches iwac-dashboard wording
            var parts = [];
            if (snap.facet === 'country' && snap.country) {
                parts.push(P.t('Filtered by country: {country}', { country: snap.country }));
            } else if (snap.facet === 'newspaper' && snap.newspaper) {
                parts.push(P.t('Filtered by newspaper: {newspaper}', { newspaper: snap.newspaper }));
            } else {
                parts.push(P.t('All data (global)'));
            }
            if (snap.view === 'compare') {
                parts.unshift(P.t('Keyword comparison'));
            } else {
                parts.unshift(P.t('top_n_over_time', { count: snap.topN }));
            }
            subtitle.textContent = parts.join(' \u2014 ');

            if (keywords.length === 0) {
                panelEl.chart.style.display = 'none';
                emptyEl.style.display = '';
                emptyEl.textContent = snap.view === 'compare'
                    ? P.t('Select keywords to compare')
                    : P.t('No data available');
                return;
            }

            panelEl.chart.style.display = '';
            emptyEl.style.display = 'none';

            if (instance && !instance.isDisposed()) {
                instance.setOption(buildOption(derived.years, keywords, derived.series), true);
            }
        }

        // The registerChart render callback doubles as the
        // post-theme-swap re-render path: dashboard-core disposes the
        // ECharts instance on theme change, re-inits it with the new
        // theme, then calls this callback with the fresh instance.
        // Applying from current state (instead of setting empty
        // series) keeps the chart visible across theme toggles.
        ns.registerChart(panelEl.chart, function (el, instance) {
            applyFromState(instance);
        });

        state.subscribe(function () {
            var liveChart = ns.getLiveChart && ns.getLiveChart(panelEl.chart);
            applyFromState(liveChart);
        });
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.keywordsChart = { render: render };
})();
