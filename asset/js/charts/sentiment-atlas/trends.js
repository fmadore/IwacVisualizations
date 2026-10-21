/**
 * IWAC Visualizations — Sentiment Atlas block: cross-model trend panel
 *
 * One line per model for the share of its ratings in a target category —
 * negative polarity, central Islam, subjective language — by year or by
 * decade, over a pale band from the lowest model to the highest. The band
 * is the point: where it is wide, a trend read off any single model is a
 * reading of that model.
 *
 * Two cohorts, from the generator's `trends` section:
 *   common    — only the articles every model rated on that dimension, so
 *               the lines differ by reading alone (the default; it inherits
 *               Qwen3.8's coverage gap, which is not random)
 *   available — each model's own ratings, its own denominator
 * A point under the minimum count is a gap, never a share of a handful.
 *
 * Load order: after sentiment-atlas/scales.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    var S = ns && ns.sentimentAtlas;
    if (!S || !S.categories) {
        console.warn('IWACVis sentiment atlas trends: scales.js must load first');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    S.TREND_PERIODS = ['year', 'decade'];
    S.TREND_COHORTS = ['common', 'available'];
    S.TREND_MINIMUMS = ['5', '20', '50'];

    /** The bundle's targets, or none for a bundle older than v0.4.0. */
    S.trendTargets = function (data) {
        return ((data.trends || {}).targets || []).slice();
    };

    function bucketOf(year, period) {
        return period === 'decade' ? Math.floor(year / 10) * 10 : year;
    }

    /**
     * Sum the per-year counts into periods: {periods, n: {model: [..]},
     * k: {model: [..]}}. The common cohort has one `n` for every model;
     * it is copied per model so both cohorts read alike below.
     */
    S.trendSeries = function (data, target, period, cohort, models) {
        var years = data.years || [];
        var block = (((data.trends || {})[cohort]) || {})[target] || {};
        var periods = [];
        var at = {};
        years.forEach(function (y) {
            var b = bucketOf(y, period);
            if (at[b] == null) {
                at[b] = periods.length;
                periods.push(b);
            }
        });
        var n = {};
        var k = {};
        models.forEach(function (m) {
            var nm = Array.isArray(block.n) ? block.n : ((block.n || {})[m.key] || []);
            var km = (block.k || {})[m.key] || [];
            var nSum = periods.map(function () { return 0; });
            var ks = periods.map(function () { return 0; });
            years.forEach(function (y, i) {
                var idx = at[bucketOf(y, period)];
                nSum[idx] += nm[i] || 0;
                ks[idx] += km[i] || 0;
            });
            n[m.key] = nSum;
            k[m.key] = ks;
        });
        return { periods: periods, n: n, k: k };
    };

    function periodLabel(p, period) {
        return period === 'decade' ? P.t('sentiment.decade_label', { decade: p }) : String(p);
    }

    /**
     * @param {Object} state  {target, period, cohort, min (number)}
     * @param {Array<{key,label}>} models
     * @param {function(string): string} modelColor
     */
    S.trendOption = function (data, state, models, modelColor) {
        var built = S.trendSeries(data, state.target, state.period, state.cohort, models);
        var periods = built.periods;
        var min = Math.max(1, state.min || 1);
        var shares = {};
        models.forEach(function (m) {
            shares[m.key] = periods.map(function (_, i) {
                var n = built.n[m.key][i];
                return n >= min ? Math.round(1000 * built.k[m.key][i] / n) / 10 : null;
            });
        });

        // The band: lowest and highest model at each period, drawn as a
        // transparent base plus a filled difference on one stack. Only where
        // at least two models have a point, or there is no range to show.
        var lower = [];
        var width = [];
        periods.forEach(function (_, i) {
            var vals = models.map(function (m) { return shares[m.key][i]; })
                .filter(function (v) { return v != null; });
            if (vals.length < 2) {
                lower.push('-');
                width.push('-');
                return;
            }
            var lo = Math.min.apply(null, vals);
            var hi = Math.max.apply(null, vals);
            lower.push(lo);
            width.push(Math.round((hi - lo) * 10) / 10);
        });

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var bandColor = tokens.border || tokens.muted;
        var series = [
            {
                name: '__band_base', type: 'line', stack: 'band', data: lower,
                symbol: 'none', lineStyle: { opacity: 0 }, silent: true,
                tooltip: { show: false }, emphasis: { disabled: true }
            },
            {
                name: P.t('sentiment.trend_band'), type: 'line', stack: 'band', data: width,
                symbol: 'none', lineStyle: { opacity: 0 }, silent: true,
                areaStyle: { color: bandColor, opacity: 0.45 },
                itemStyle: { color: bandColor },
                tooltip: { show: false }, emphasis: { disabled: true }
            }
        ];
        models.forEach(function (m) {
            var color = modelColor(m.key);
            var s = {
                name: m.label, type: 'line', data: shares[m.key],
                symbol: 'circle', symbolSize: 4, connectNulls: false,
                lineStyle: { width: 2 }, emphasis: { focus: 'series' }
            };
            if (color) {
                s.lineStyle.color = color;
                s.itemStyle = { color: color };
            }
            series.push(s);
        });

        var dataZoom = C._dataZoom(periods.length);
        var useZoom = dataZoom.length > 0;
        return {
            grid: C._grid({ left: 64, bottom: useZoom ? 64 : 40 }),
            legend: C._legend({
                data: [P.t('sentiment.trend_band')].concat(models.map(function (m) { return m.label; }))
            }),
            tooltip: {
                trigger: 'axis',
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    var i = params[0].dataIndex;
                    var lines = ['<strong>' + P.escapeHtml(periodLabel(periods[i], state.period)) + '</strong>'];
                    params.forEach(function (p) {
                        var m = models[p.seriesIndex - 2];
                        if (!m) return;
                        var n = built.n[m.key][i];
                        var text = p.value == null || p.value === '-'
                            ? P.t('sentiment.trend_too_few', { count: n })
                            : P.t('sentiment.trend_tip', {
                                pct: P.formatNumber(p.value),
                                k: P.formatNumber(built.k[m.key][i]),
                                count: n
                            });
                        lines.push(p.marker + ' ' + P.escapeHtml(m.label) + ': ' + text);
                    });
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'category',
                data: periods.map(function (p) { return periodLabel(p, state.period); }),
                name: P.t(state.period === 'decade' ? 'Decade' : 'Year'),
                nameLocation: 'middle',
                nameGap: useZoom ? 34 : 26
            },
            yAxis: Object.assign(
                { type: 'value', min: 0, axisLabel: C._percentAxisLabel() },
                C._valueAxisName(P.t('sentiment.trend_axis_' + state.target))
            ),
            dataZoom: dataZoom,
            series: series,
            // The table lists the models' points, not the band's two
            // stacked helpers: one row per period, a share and its n per
            // model, so a gap is legible as "too few" rather than a blank.
            iwacRows: function () {
                var columns = [{ label: P.t(state.period === 'decade' ? 'Decade' : 'Year'), numeric: false }];
                models.forEach(function (m) {
                    columns.push({ label: m.label + ' (%)', numeric: true });
                    columns.push({ label: m.label + ' (n)', numeric: true });
                });
                return {
                    columns: columns,
                    rows: periods.map(function (p, i) {
                        var row = [periodLabel(p, state.period)];
                        models.forEach(function (m) {
                            row.push(shares[m.key][i] == null ? '' : shares[m.key][i]);
                            row.push(built.n[m.key][i]);
                        });
                        return row;
                    })
                };
            }
        };
    };

    /** One line on the cohort the lines stand on. */
    S.trendCaption = function (data, state) {
        var block = ((data.trends || {}).common || {})[state.target] || {};
        var total = (block.n || []).reduce(function (a, b) { return a + b; }, 0);
        var min = P.formatNumber(state.min);
        return state.cohort === 'common'
            ? P.t('sentiment.trend_caption_common', { count: total, min: min })
            : P.t('sentiment.trend_caption_available', { min: min });
    };
})();
