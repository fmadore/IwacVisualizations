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
 *   - Colors come from the IWAC palette (built from CSS tokens by
 *     iwac-theme.js) — no hex literals here. Empty selection renders
 *     a gentle "select keywords" empty state instead of a broken chart.
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
                data: years,
                name: P.t('Year'),
                nameLocation: 'middle',
                nameGap: rotate ? 44 : 28,
                axisLabel: {
                    interval: interval,
                    rotate: rotate
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

    function render(host, state) {
        host.innerHTML = '';

        var subtitle = P.el('div', 'iwac-vis-keywords-chart__subtitle');
        host.appendChild(subtitle);

        var chartEl = P.el('div', 'iwac-vis-chart');
        host.appendChild(chartEl);

        var emptyEl = P.el('div', 'iwac-vis-empty');
        emptyEl.style.display = 'none';
        host.appendChild(emptyEl);

        var chart = ns.registerChart(chartEl, function (el, instance) {
            instance.setOption({ series: [] });
        });

        function update() {
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
                chartEl.style.display = 'none';
                emptyEl.style.display = '';
                emptyEl.textContent = snap.view === 'compare'
                    ? P.t('Select keywords to compare')
                    : P.t('No data available');
                return;
            }

            chartEl.style.display = '';
            emptyEl.style.display = 'none';

            if (chart && !chart.isDisposed()) {
                chart.setOption(buildOption(derived.years, keywords, derived.series), true);
            }
        }

        state.subscribe(update);
        update();
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.keywordsChart = { render: render };
})();
