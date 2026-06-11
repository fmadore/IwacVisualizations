/**
 * IWAC Visualizations — Compare Newspapers block: wordclouds panel.
 *
 * Split out of compare-newspapers.js. Builds the side-by-side
 * most-frequent-words columns — wordclouds when the shared wordcloud
 * chart options are loaded, plain horizontal bar charts otherwise.
 * Hangs off IWACVis.compareNewspapers.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis compare-newspapers/wordclouds: missing panels — check script load order');
        return;
    }
    var P = ns.panels;
    var CN = ns.compareNewspapers = ns.compareNewspapers || {};

    function buildWordclouds(dataA, dataB) {
        var panel = P.el('div', 'iwac-vis-panel iwac-vis-panel--wide');
        panel.appendChild(P.el('h4', null, P.t('Most frequent words')));
        var wrap = P.el('div', 'iwac-vis-compare-wordclouds');
        panel.appendChild(wrap);

        [['A', dataA], ['B', dataB]].forEach(function (pair) {
            var side = pair[0];
            var data = pair[1];
            var col = P.el('div', 'iwac-vis-compare-wordcloud');
            col.dataset.side = side;
            col.appendChild(P.el('div', 'iwac-vis-compare-wordcloud__label', data.name));
            var host = P.el('div', 'iwac-vis-compare-wordcloud__chart');
            col.appendChild(host);
            wrap.appendChild(col);

            var pairs = data.wordcloud || [];
            ns.registerChart(host, function (el, instance) {
                if (!pairs.length) {
                    instance.setOption({
                        title: {
                            text: P.t('No data available'),
                            left: 'center', top: 'middle',
                            textStyle: { fontSize: 13, fontWeight: 'normal' }
                        }
                    });
                    return;
                }
                var opts = (ns.chartOptions && ns.chartOptions.wordcloud)
                    ? ns.chartOptions.wordcloud(pairs)
                    : null;
                if (opts) {
                    instance.setOption(opts, true);
                } else {
                    // chart-options wasn't loaded — fall back to a plain
                    // horizontal bar chart so the panel stays useful.
                    var top = pairs.slice(0, 20);
                    instance.setOption({
                        grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
                        xAxis: { type: 'value' },
                        yAxis: {
                            type: 'category',
                            inverse: true,
                            data: top.map(function (p) { return p[0]; }),
                            axisLabel: { width: 120, overflow: 'truncate' }
                        },
                        series: [{
                            type: 'bar',
                            data: top.map(function (p) { return p[1]; })
                        }]
                    }, true);
                }
            });
        });

        return panel;
    }

    CN.buildWordclouds = buildWordclouds;
})();
