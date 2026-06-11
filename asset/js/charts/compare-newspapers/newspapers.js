/**
 * IWAC Visualizations — Compare Newspapers block: newspapers breakdown.
 *
 * Split out of compare-newspapers.js. Builds the per-corpus newspapers
 * breakdown (country-scope sides only) — a paginated horizontal bar
 * chart per side, with placeholders for single-newspaper corpora.
 * Hangs off IWACVis.compareNewspapers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/newspapers: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    var NEWSPAPERS_PAGE_SIZE = 12;

    function buildNewspapersBreakdown(dataA, dataB) {
        var showA = dataA.scope === 'country' && (dataA.newspapers || []).length;
        var showB = dataB.scope === 'country' && (dataB.newspapers || []).length;
        if (!showA && !showB) return null;

        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Newspapers within each corpus')));
        var wrap = P.el('div', 'iwac-vis-compare-wordclouds');
        panel.appendChild(wrap);

        var _cc = CN.compareColors();
        var colorA = _cc.a;
        var colorB = _cc.b;

        function addSide(side, data, color) {
            var col = P.el('div', 'iwac-vis-compare-wordcloud');
            col.dataset.side = side;

            var header = P.el('div', 'iwac-vis-compare-wordcloud__label',
                data.name + ' \u2014 ' + P.formatNumber((data.newspapers || []).length)
                    + ' ' + P.t('Newspapers'));
            col.appendChild(header);

            var host = P.el('div', 'iwac-vis-compare-wordcloud__chart');
            col.appendChild(host);

            // Pagination footer — hidden automatically when <= 1 page
            var pagerHost = P.el('div', 'iwac-vis-compare-pagination');
            col.appendChild(pagerHost);

            wrap.appendChild(col);

            // All newspapers for this side, sorted count-desc (generator
            // emits them that way). Paginate client-side with 12 rows
            // per page so users can browse the full list rather than
            // just the top 10.
            var entries = (data.newspapers || []).slice();
            if (!entries.length) {
                host.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
                return;
            }
            var totalPages = Math.max(1, Math.ceil(entries.length / NEWSPAPERS_PAGE_SIZE));

            // `registerChart` runs its render callback synchronously
            // *before* returning the instance, which means anything
            // closing over an outer `instance` variable sees `null` on
            // the first pass. Pass the instance through the callback
            // args instead so the first render always has a live chart.
            var currentPage = 0;
            function renderPage(page, chart) {
                var live = chart
                    || (ns.getLiveChart ? ns.getLiveChart(host) : null);
                if (!live || live.isDisposed()) return;
                var slice = entries
                    .slice(page * NEWSPAPERS_PAGE_SIZE, (page + 1) * NEWSPAPERS_PAGE_SIZE)
                    .slice()
                    .reverse();  // largest at the top of the bar chart
                live.setOption({
                    grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
                    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                    xAxis: { type: 'value' },
                    yAxis: {
                        type: 'category',
                        data: slice.map(function (e) { return e.name; }),
                        axisTick: { show: false },
                        axisLabel: { width: 160, overflow: 'truncate' }
                    },
                    series: [{
                        type: 'bar',
                        itemStyle: { color: color, borderRadius: [0, 4, 4, 0] },
                        label: { show: true, position: 'right',
                                 formatter: function (p) { return P.formatNumber(p.value); } },
                        data: slice.map(function (e) { return e.count; })
                    }],
                    animationDuration: 400,
                    animationEasing: 'cubicOut'
                }, true);
            }

            ns.registerChart(host, function (el, chart) {
                renderPage(currentPage, chart);
            });

            if (totalPages > 1 && P.buildPagination) {
                var pager = P.buildPagination({
                    currentPage: 0,
                    totalPages: totalPages,
                    onChange: function (newPage) {
                        currentPage = newPage;
                        renderPage(newPage);
                    }
                });
                pagerHost.appendChild(pager.root);
            }
        }

        function placeholderCol(side, name) {
            var col = P.el('div', 'iwac-vis-compare-wordcloud');
            col.dataset.side = side;
            col.appendChild(P.el('div', 'iwac-vis-compare-wordcloud__label', name));
            col.appendChild(P.el('div', 'iwac-vis-empty',
                P.t('Single-newspaper corpus \u2014 no breakdown')));
            wrap.appendChild(col);
        }

        if (showA) addSide('A', dataA, colorA); else placeholderCol('A', dataA.name);
        if (showB) addSide('B', dataB, colorB); else placeholderCol('B', dataB.name);

        return panel;
    }

    CN.buildNewspapersBreakdown = buildNewspapersBreakdown;
})();
