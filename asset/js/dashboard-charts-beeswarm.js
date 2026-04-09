/**
 * Beeswarm chart builder: scatter with jitter for categorical × value data.
 *
 * Registers into window.RV.charts for the dashboard orchestrator.
 *
 * Data format (array of points):
 *   [{ category: string, value: number, label: string, size: number, itemId: number }]
 */
(function () {
    'use strict';

    var ns = window.RV;
    var THEME = ns.THEME, COLORS = ns.COLORS;
    var initChart = ns.initChart, truncateLabel = ns.truncateLabel;

    ns.charts = ns.charts || {};

    /**
     * Deterministic pseudo-random jitter from a string seed.
     * Returns a value in [-amplitude, +amplitude].
     */
    function jitter(seed, amplitude) {
        var h = 0;
        for (var i = 0; i < seed.length; i++) {
            h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
        }
        // Map hash to [-1, 1] range, then scale
        return (((h & 0x7fffffff) % 1000) / 500 - 1) * amplitude;
    }

    ns.charts.buildBeeswarm = function (el, data, siteBase) {
        if (!data || !data.length) return;
        var chart = initChart(el);

        // Extract unique categories (preserve order from data)
        var catOrder = [];
        var catSet = {};
        data.forEach(function (d) {
            if (!catSet[d.category]) {
                catSet[d.category] = true;
                catOrder.push(d.category);
            }
        });

        // Category index map
        var catIdx = {};
        catOrder.forEach(function (c, i) { catIdx[c] = i; });

        // Compute size range for bubble scaling
        var minSize = Infinity, maxSize = 0;
        data.forEach(function (d) {
            if (d.size < minSize) minSize = d.size;
            if (d.size > maxSize) maxSize = d.size;
        });
        var sizeRange = maxSize - minSize || 1;
        var minSymbol = 10, maxSymbol = 36;

        // Build scatter data: [x, y + jitter, size, label, itemId, category]
        var seriesData = data.map(function (d) {
            var y = catIdx[d.category] + jitter(d.label + d.value, 0.3);
            var normSize = (d.size - minSize) / sizeRange;
            var symbolSize = minSymbol + normSize * (maxSymbol - minSymbol);
            return {
                value: [d.value, y],
                symbolSize: symbolSize,
                itemStyle: {
                    color: COLORS[catIdx[d.category] % COLORS.length],
                    opacity: 0.85,
                    borderColor: '#fff',
                    borderWidth: 1
                },
                _label: d.label,
                _size: d.size,
                _category: d.category,
                _itemId: d.itemId
            };
        });

        // Compute value range for axis
        var values = data.map(function (d) { return d.value; });
        var minVal = Math.min.apply(null, values);
        var maxVal = Math.max.apply(null, values);

        chart.setOption({
            tooltip: {
                confine: true,
                formatter: function (params) {
                    var d = params.data;
                    return '<strong>' + echarts.format.encodeHTML(d._label) + '</strong>'
                        + '<br/>Section: ' + echarts.format.encodeHTML(d._category)
                        + '<br/>Start: ' + d.value[0]
                        + '<br/>Items: ' + d._size;
                }
            },
            aria: { enabled: true },
            grid: { left: 160, right: 30, top: 20, bottom: 40 },
            xAxis: {
                type: 'value',
                name: 'Start Year',
                nameLocation: 'center',
                nameGap: 25,
                min: minVal - 1,
                max: maxVal + 1,
                axisLabel: {
                    fontSize: THEME.fontSize,
                    formatter: function (v) { return String(Math.round(v)); }
                }
            },
            yAxis: {
                type: 'category',
                data: catOrder,
                axisLabel: {
                    fontSize: THEME.fontSize,
                    width: 140,
                    overflow: 'truncate',
                    formatter: function (v) { return truncateLabel(v, 22); }
                },
                axisTick: { show: false },
                splitLine: { show: true, lineStyle: { type: 'dashed', opacity: 0.3 } }
            },
            series: [{
                type: 'scatter',
                data: seriesData,
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowColor: 'rgba(0,0,0,0.3)'
                    }
                }
            }]
        });

        // Click to navigate to project page
        chart.on('click', function (params) {
            if (params.data && params.data._itemId && siteBase) {
                window.location.href = siteBase + '/item/' + params.data._itemId;
            }
        });
        chart.getZr().on('mousemove', function (e) {
            chart.getZr().setCursorStyle(e.target ? 'pointer' : 'default');
        });

        return chart;
    };
})();
