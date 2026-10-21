/**
 * IWAC Visualizations — Sentiment Atlas block: newspaper ranking panel
 *
 * Each newspaper with enough rated articles as one dot — its mean rating on
 * the selected measure under the selected model — with a 95% interval
 * whisker, ranked, against a reference line at the scale's midpoint.
 * Polarity is the net index −2..+2 ("Non applicable" excluded: a refusal to
 * grade is not a neutral grade); centralité and subjectivité run 1..5.
 *
 * The polarity Likert bars above show each title's composition; this shows
 * whether two titles' difference survives their sample sizes, which is what
 * the extreme means of small titles otherwise hide. The interval describes
 * variation among one model's ratings of one title's collected articles —
 * not what the archive did not collect, and not annotation error.
 *
 * Data: the generator's `ranking` section. Load order: after scales.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    var S = ns && ns.sentimentAtlas;
    if (!S || !S.categories) {
        console.warn('IWACVis sentiment atlas ranking: scales.js must load first');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    /** Rows for one model and measure, lowest mean first (the dot plot's
     *  bottom row; a category axis draws its first entry at the bottom). */
    S.rankingRows = function (data, model, measure) {
        var r = data.ranking || {};
        var names = r.newspapers || [];
        return ((((r.models || {})[model]) || {})[measure] || []).map(function (row) {
            return { name: names[row[0]] || '', n: row[1], mean: row[2], half: row[3] };
        }).sort(function (a, b) { return a.mean - b.mean || b.n - a.n; });
    };

    /** Pixel height the ranking needs for `rows` titles. */
    S.rankingHeight = function (rows) {
        return Math.max(320, 22 * rows + 90);
    };

    S.rankingOption = function (data, model, measure) {
        var rows = S.rankingRows(data, model, measure);
        var scale = S.meanScale(measure);
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var dot = (ns.resolveCssVar && ns.resolveCssVar('--primary')) || tokens.primary;
        var whisker = tokens.inkLight || tokens.muted || dot;

        // The axis spans the intervals and the reference line, not the
        // whole scale: means cluster, and a −2..+2 axis would draw every
        // title on the same pixel.
        var lo = scale.neutral;
        var hi = scale.neutral;
        rows.forEach(function (r) {
            lo = Math.min(lo, r.mean - r.half);
            hi = Math.max(hi, r.mean + r.half);
        });
        var pad = Math.max(0.05, (hi - lo) * 0.08);
        lo = Math.max(scale.min, Math.floor((lo - pad) * 10) / 10);
        hi = Math.min(scale.max, Math.ceil((hi + pad) * 10) / 10);

        function renderWhisker(params, api) {
            var y = api.value(0);
            var left = api.coord([api.value(1), y]);
            var right = api.coord([api.value(2), y]);
            var cap = Math.max(3, api.size([0, 1])[1] * 0.18);
            var style = { stroke: whisker, lineWidth: 1.5 };
            return {
                type: 'group',
                children: [
                    { type: 'line', shape: { x1: left[0], y1: left[1], x2: right[0], y2: right[1] }, style: style },
                    { type: 'line', shape: { x1: left[0], y1: left[1] - cap, x2: left[0], y2: left[1] + cap }, style: style },
                    { type: 'line', shape: { x1: right[0], y1: right[1] - cap, x2: right[0], y2: right[1] + cap }, style: style }
                ]
            };
        }

        function tip(r) {
            return '<strong>' + P.escapeHtml(r.name) + '</strong><br>'
                + P.t('sentiment.rank_tip', {
                    mean: S.formatMean(measure, r.mean),
                    lo: S.formatMean(measure, r.mean - r.half),
                    hi: S.formatMean(measure, r.mean + r.half),
                    count: r.n
                });
        }

        return {
            grid: C._grid({ left: 180, right: 32, top: 16, bottom: 48, containLabel: false }),
            tooltip: {
                trigger: 'item',
                formatter: function (p) { return tip(rows[p.dataIndex] || {}); }
            },
            xAxis: {
                type: 'value', min: lo, max: hi,
                name: P.t('sentiment.rank_axis_' + measure),
                nameLocation: 'middle', nameGap: 28,
                axisLabel: { formatter: function (v) { return S.formatMean(measure, v); } }
            },
            yAxis: {
                type: 'category',
                data: rows.map(function (r) { return r.name; }),
                axisTick: { show: false },
                axisLabel: { interval: 0, width: 168, overflow: 'truncate', fontSize: P.AXIS_FONT_SM }
            },
            series: [
                {
                    name: P.t('sentiment.rank_interval'),
                    type: 'custom',
                    renderItem: renderWhisker,
                    encode: { x: [1, 2], y: 0 },
                    data: rows.map(function (r, i) { return [i, r.mean - r.half, r.mean + r.half]; }),
                    silent: true,
                    z: 1
                },
                {
                    name: P.t('sentiment.rank_mean'),
                    type: 'scatter',
                    symbolSize: 9,
                    itemStyle: { color: dot },
                    data: rows.map(function (r, i) { return [r.mean, i]; }),
                    z: 2,
                    markLine: {
                        silent: true,
                        symbol: 'none',
                        label: { show: false },
                        lineStyle: { type: 'dashed', color: whisker, width: 1 },
                        data: [{ xAxis: scale.neutral }]
                    }
                }
            ],
            iwacRows: function () {
                return rows.length ? {
                    columns: [
                        { label: P.t('sentiment.col_newspaper'), numeric: false },
                        { label: P.t('sentiment.rank_mean'), numeric: true },
                        { label: P.t('sentiment.rank_lo'), numeric: true },
                        { label: P.t('sentiment.rank_hi'), numeric: true },
                        { label: P.t('sentiment.rated_articles'), numeric: true }
                    ],
                    rows: rows.slice().reverse().map(function (r) {
                        return [
                            r.name,
                            Math.round(r.mean * 1000) / 1000,
                            Math.round((r.mean - r.half) * 1000) / 1000,
                            Math.round((r.mean + r.half) * 1000) / 1000,
                            r.n
                        ];
                    })
                } : null;
            }
        };
    };

    /** The threshold and what it left out, under the chart. */
    S.rankingCaption = function (data, model, measure) {
        var r = data.ranking || {};
        var omitted = (((r.omitted || {})[model]) || {})[measure] || 0;
        return P.t('sentiment.rank_caption', { min: P.formatNumber(r.min || 30), count: omitted });
    };
})();
