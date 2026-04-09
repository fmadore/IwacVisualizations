/**
 * Word cloud chart builder with adjustable word count slider.
 *
 * Falls back to bar chart if echarts-wordcloud extension is unavailable.
 * Registers into window.RV.charts for the dashboard orchestrator.
 */
(function () {
    'use strict';

    var ns = window.RV;
    var COLORS = ns.COLORS;
    var initChart = ns.initChart;
    var toEntries = ns.toEntries, addClickHandler = ns.addClickHandler;

    ns.charts = ns.charts || {};

    var _wordCloudOk = null;
    function isWordCloudAvailable() {
        if (_wordCloudOk !== null) return _wordCloudOk;
        try {
            var d = document.createElement('div');
            d.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px';
            document.body.appendChild(d);
            var c = echarts.init(d);
            c.setOption({ series: [{ type: 'wordCloud', data: [{ name: 'x', value: 1 }] }] });
            c.dispose(); document.body.removeChild(d);
            _wordCloudOk = true;
        } catch (e) { _wordCloudOk = false; }
        return _wordCloudOk;
    }

    ns.charts.buildWordCloud = function (el, data, siteBase) {
        var entries = toEntries(data);
        if (!entries.length) return;
        if (!isWordCloudAvailable()) return ns.charts.buildBarChart(el, data, siteBase);

        var chart = initChart(el);
        chart._noDecal = true;
        var total = entries.length;
        var defaultCount = Math.min(total, total > 100 ? 80 : 30);

        function wordCloudOption(count) {
            var slice = entries.slice(0, count);
            var minFont = count > 100 ? 8 : count > 50 ? 10 : 12;
            var maxFont = count > 100 ? 45 : count > 50 ? 55 : (count > 10 ? 60 : 80);
            var grid = count > 100 ? 4 : count > 50 ? 6 : 8;
            return {
                tooltip: {
                    confine: true,
                    formatter: function (p) { return echarts.format.encodeHTML(p.name) + ': ' + p.value; }
                },
                aria: { enabled: true },
                series: [{
                    type: 'wordCloud',
                    shape: function (theta) {
                        var cos = Math.abs(Math.cos(theta));
                        var sin = Math.abs(Math.sin(theta));
                        return 1 / Math.max(cos, sin);
                    },
                    sizeRange: [minFont, maxFont],
                    rotationRange: [-45, 45], rotationStep: 15, gridSize: grid,
                    drawOutOfBound: false, shrinkToFit: true, layoutAnimation: count <= 100,
                    left: 'center', top: 'center', width: '100%', height: '100%',
                    textStyle: {
                        fontFamily: 'sans-serif',
                        color: function () { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
                    },
                    emphasis: { textStyle: { fontWeight: 'bold', shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } },
                    data: slice.map(function (e) { return { name: e.name, value: e.value }; })
                }]
            };
        }

        chart.setOption(wordCloudOption(defaultCount));
        addClickHandler(chart, entries, siteBase);

        if (total > 5) {
            var panel = el.closest('.chart-panel');
            if (panel) {
                var slider = document.createElement('div');
                slider.className = 'rv-word-slider';
                slider.innerHTML = '<label><input type="range" min="5" max="' + total + '" value="' + defaultCount + '" step="1">'
                    + '<span class="rv-word-slider-value">' + defaultCount + '</span></label>';
                var desc = panel.querySelector('.chart-description');
                var insertRef = desc ? desc.nextSibling : el;
                panel.insertBefore(slider, insertRef);

                var input = slider.querySelector('input');
                input.addEventListener('input', function () {
                    var n = parseInt(this.value, 10);
                    slider.querySelector('.rv-word-slider-value').textContent = n;
                    chart.setOption(wordCloudOption(n), true);
                });
            }
        }

        return chart;
    };
})();
