/**
 * IWAC Visualizations — Sentiment Atlas block: model comparison panels
 *
 * The section the atlas's model-comparison facets drive, on any of the three
 * dimensions:
 *   - every pair at once — a model × model matrix of one agreement measure,
 *     with the whole panel's Fleiss' kappa in its caption
 *   - one pair — exact and within-one-step agreement, Cohen's and weighted
 *     kappa, and the label-by-label cross-tab
 *   - calibration — each model's own label shares, which is where a model
 *     that reads the scale differently shows before any pair does
 *   - consensus — how often the panel is unanimous, how often one model
 *     alone breaks ranks and in which direction
 *
 * The statistics are the generator's (generate_sentiment_atlas.py, the
 * `reliability` and `consensus` sections). A bundle older than v0.4.0
 * carries only `agreement` — polarity, exact matches, the cross-tab — and
 * `S.reliabilityFor` adapts it, so the code can ship ahead of the data.
 *
 * Load order: after sentiment-atlas/scales.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    var S = ns && ns.sentimentAtlas;
    if (!S || !S.categories) {
        console.warn('IWACVis sentiment atlas compare: scales.js must load first');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    /**
     * One dimension's agreement block, or null. For a pre-v0.4.0 bundle the
     * polarity block is rebuilt from `agreement`, with every statistic it
     * never carried left null (printed "n/a", never 0).
     */
    S.reliabilityFor = function (data, dim) {
        var rel = (data.reliability || {})[dim];
        if (rel) return rel;
        if (dim !== 'polarity' || !(data.agreement || []).length) return null;
        return {
            labels: (data.polarity_order || []).slice(),
            pairs: data.agreement.map(function (e) {
                return {
                    models: e.models, n: e.co_rated, exact: e.agreement_pct,
                    kappa: null, n_ordinal: null, within_one: null, weighted_kappa: null,
                    matrix: e.matrix
                };
            }),
            panel: null
        };
    };

    /** The dimensions this bundle can compare models on. */
    S.compareDimensions = function (data) {
        return S.DIMENSIONS.filter(function (dim) { return !!S.reliabilityFor(data, dim); });
    };

    function ramp() {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var primary = (ns.resolveCssVar && ns.resolveCssVar('--primary')) || tokens.primary;
        var surface = (ns.resolveCssVar && ns.resolveCssVar('--surface-raised'))
            || tokens.surfaceRaised || tokens.surface;
        return [surface, primary];
    }

    function kappaText(kappa) {
        if (kappa == null || !isFinite(kappa)) return P.t('sentiment.na_value');
        return P.formatNumber(Math.round(kappa * 100) / 100);
    }

    function pctText(pct) {
        return pct == null ? P.t('sentiment.na_value')
            : P.t('sentiment.pct_value', { pct: P.formatNumber(pct) });
    }

    /* ----------------------------------------------------------------- */
    /*  Every pair: model × model matrix                                  */
    /* ----------------------------------------------------------------- */

    /** The measures the pair matrix can show; weighted kappa needs a scale. */
    S.PAIR_METRICS = ['weighted_kappa', 'kappa', 'exact'];

    /**
     * Model × model matrix of one measure, both triangles filled so a row
     * reads as "this model against each of the others"; the diagonal is
     * left empty rather than painted a perfect 1. Clicking a cell selects
     * that pair (wired by the controller through `pairIndex`).
     */
    S.pairMatrixOption = function (data, dim, metric, models) {
        var rel = S.reliabilityFor(data, dim) || { pairs: [] };
        var keys = models.map(function (m) { return m.key; });
        var labels = models.map(function (m) { return m.label; });
        var isPct = metric === 'exact';
        var cells = [];
        rel.pairs.forEach(function (entry, idx) {
            var a = keys.indexOf(entry.models[0]);
            var b = keys.indexOf(entry.models[1]);
            var v = entry[metric];
            if (a < 0 || b < 0 || v == null) return;
            var shown = isPct ? v : Math.round(v * 100) / 100;
            cells.push({ value: [b, a, shown], pairIndex: idx, entry: entry });
            cells.push({ value: [a, b, shown], pairIndex: idx, entry: entry });
        });
        var option = C.heatmapMatrix({ xLabels: labels, yLabels: labels, cells: cells }, {
            visualMin: 0,
            visualMax: isPct ? 100 : 1,
            ramp: ramp(),
            grid: { left: 130, top: 16, bottom: 90 },
            xLabelRotate: 30,
            cellLabels: true,
            cellBorder: true,
            static: true,
            tooltipFormatter: function (p) {
                var entry = (p.data && p.data.entry) || {};
                var lines = [
                    '<strong>' + P.escapeHtml(labels[p.value[1]] || '') + ' × '
                        + P.escapeHtml(labels[p.value[0]] || '') + '</strong>',
                    P.t('sentiment.metric_exact') + ': ' + pctText(entry.exact)
                ];
                if (entry.kappa != null) lines.push(P.t('sentiment.metric_kappa') + ': ' + kappaText(entry.kappa));
                if (entry.weighted_kappa != null) {
                    lines.push(P.t('sentiment.metric_weighted_kappa') + ': ' + kappaText(entry.weighted_kappa));
                }
                lines.push(P.t('sentiment.co_rated', { count: entry.n || 0 }));
                return lines.join('<br>');
            }
        });
        option.series[0].cursor = 'pointer';
        return option;
    };

    /** One sentence on the whole panel: Fleiss' kappa, unanimity, its n. */
    S.panelCaption = function (data, dim) {
        var rel = S.reliabilityFor(data, dim);
        var panel = rel && rel.panel;
        if (!panel || !panel.n) return '';
        var band = S.kappaBand(panel.fleiss_kappa);
        return P.t('sentiment.panel_caption', {
            kappa: kappaText(panel.fleiss_kappa),
            band: band ? P.t('sentiment.band_' + band) : P.t('sentiment.na_value'),
            pct: P.formatNumber(panel.unanimous),
            count: panel.n
        });
    };

    /* ----------------------------------------------------------------- */
    /*  One pair: cards + cross-tab                                       */
    /* ----------------------------------------------------------------- */

    function card(label, value, note) {
        var el = P.el('div', 'iwac-vis-summary-card');
        el.appendChild(P.el('div', 'iwac-vis-summary-card__label', label));
        el.appendChild(P.el('div', 'iwac-vis-summary-card__value', value));
        if (note) el.appendChild(P.el('div', 'iwac-vis-summary-card__label', note));
        return el;
    }

    /**
     * The selected pair's four measures. Polarity's within-one and weighted
     * kappa leave "Non applicable" out and say on how many articles.
     */
    S.pairCards = function (entry, dim) {
        var row = P.el('div', 'iwac-vis-overview-summary');
        if (!entry) return row;
        row.appendChild(card(P.t('sentiment.metric_exact'), pctText(entry.exact),
            P.t('sentiment.co_rated', { count: entry.n || 0 })));
        if (entry.within_one != null) {
            row.appendChild(card(P.t('sentiment.metric_within_one'), pctText(entry.within_one),
                dim === 'polarity'
                    ? P.t('sentiment.graded_n', { count: entry.n_ordinal || 0 })
                    : null));
        }
        if (entry.kappa != null) {
            var kb = S.kappaBand(entry.kappa);
            row.appendChild(card(P.t('sentiment.metric_kappa'), kappaText(entry.kappa),
                kb ? P.t('sentiment.band_' + kb) : null));
        }
        if (entry.weighted_kappa != null) {
            var wb = S.kappaBand(entry.weighted_kappa);
            row.appendChild(card(P.t('sentiment.metric_weighted_kappa'), kappaText(entry.weighted_kappa),
                wb ? P.t('sentiment.band_' + wb) : null));
        }
        return row;
    };

    /**
     * Label × label cross-tab for one pair on one dimension: counts in the
     * cells, on the surface → primary ramp (agreement, not intensity).
     */
    S.crossTabOption = function (data, dim, entry, modelLabel) {
        var cats = S.categories(data, dim);
        var labels = cats.map(S.label);
        var matrix = (entry && entry.matrix) || [];
        var labelA = modelLabel(entry.models[0]);
        var labelB = modelLabel(entry.models[1]);
        var cells = [];
        for (var i = 0; i < cats.length; i++) {
            for (var j = 0; j < cats.length; j++) {
                // x = model B's label, y = model A's.
                cells.push([j, i, (matrix[i] && matrix[i][j]) || 0]);
            }
        }
        return C.heatmapMatrix({ xLabels: labels, yLabels: labels, cells: cells }, {
            visualMin: 0,
            ramp: ramp(),
            grid: { left: 110, top: 16, bottom: 84 },
            xLabelRotate: 35,
            cellLabels: true,
            cellBorder: true,
            static: true,
            tooltipFormatter: function (p) {
                return P.t('sentiment.pair_cell', {
                    a: P.escapeHtml(labelA),
                    la: P.escapeHtml(labels[p.value[1]] || ''),
                    b: P.escapeHtml(labelB),
                    lb: P.escapeHtml(labels[p.value[0]] || ''),
                    count: p.value[2] || 0
                });
            }
        });
    };

    /* ----------------------------------------------------------------- */
    /*  Calibration: each model's own label shares                        */
    /* ----------------------------------------------------------------- */

    /**
     * One 100% bar per model, the grades in reading order on the
     * dimension's ramp. Each model's denominator is its own: Qwen3.8 rated
     * fewer articles, and a raw count would read as a different stance.
     * Null when the bundle predates `distribution`.
     */
    S.calibrationOption = function (data, dim, models) {
        var cats = S.categories(data, dim);
        var order = S.readingOrder(data, dim);
        var palette = S.palette(dim);
        var rows = models.map(function (m) {
            var counts = (((data.models[m.key] || {}).distribution) || {})[dim];
            if (!counts) return null;
            var total = counts.reduce(function (a, b) { return a + b; }, 0);
            var byKey = {};
            cats.forEach(function (c, i) { byKey[c] = counts[i] || 0; });
            return { label: m.label, total: total, counts: byKey };
        });
        if (rows.some(function (r) { return !r; })) return null;

        var series = order.map(function (key) {
            var s = {
                name: S.label(key),
                type: 'bar',
                stack: 'share',
                barMaxWidth: 28,
                emphasis: { focus: 'series' },
                data: rows.map(function (r) {
                    return r.total ? Math.round(1000 * r.counts[key] / r.total) / 10 : 0;
                })
            };
            if (palette[key]) s.itemStyle = { color: palette[key] };
            return s;
        });
        return {
            grid: C._grid({ left: 130, right: 24, top: 40, bottom: 36 }),
            legend: C._legend({ top: 0 }),
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    var row = rows[params[0].dataIndex] || {};
                    var lines = ['<strong>' + P.escapeHtml(row.label || '') + '</strong>'];
                    params.forEach(function (p) {
                        var key = order[p.seriesIndex];
                        lines.push(p.marker + ' ' + P.escapeHtml(p.seriesName) + ': '
                            + P.t('sentiment.share_of', {
                                pct: P.formatNumber(p.value),
                                count: (row.counts || {})[key] || 0
                            }));
                    });
                    lines.push(P.t('sentiment.rated_n', { count: row.total || 0 }));
                    return lines.join('<br>');
                }
            },
            xAxis: { type: 'value', min: 0, max: 100, axisLabel: C._percentAxisLabel() },
            yAxis: {
                type: 'category',
                inverse: true,
                data: rows.map(function (r) { return r.label; }),
                axisTick: { show: false }
            },
            series: series
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Consensus: unanimity and lone dissent                             */
    /* ----------------------------------------------------------------- */

    /** The panel's split on one dimension, as four cards. */
    S.consensusCards = function (data, dim) {
        var row = P.el('div', 'iwac-vis-overview-summary');
        var c = (data.consensus || {})[dim];
        if (!c || !c.n) return row;
        var lone = 0;
        Object.keys(c.dissent || {}).forEach(function (m) {
            lone += (c.dissent[m].up || 0) + (c.dissent[m].down || 0);
        });
        function share(k) { return Math.round(1000 * k / c.n) / 10; }
        row.appendChild(card(P.t('sentiment.cons_unanimous'), pctText(share(c.unanimous)),
            P.t('sentiment.of_articles', { count: c.n })));
        row.appendChild(card(P.t('sentiment.cons_lone'), pctText(share(lone))));
        row.appendChild(card(P.t('sentiment.cons_split'), pctText(share(c.split))));
        row.appendChild(card(P.t('sentiment.cons_spread'),
            c.spread_mean == null ? P.t('sentiment.na_value') : P.formatNumber(c.spread_mean),
            P.t('sentiment.cons_spread_note')));
        return row;
    };

    /**
     * How often each model ALONE rated an article above or below all the
     * others, as a share of the articles every model rated: below runs left
     * of the axis, above right, each in the colour of its end of the scale.
     */
    S.dissentOption = function (data, dim, models) {
        var c = (data.consensus || {})[dim];
        if (!c || !c.n) return null;
        // One grade in from each end, so the two directions are drawn at
        // the same distance from the middle of the ramp.
        var scale = S.meanScale(dim).steps;
        var palette = S.palette(dim);
        var lowColor = palette[scale[1][1]];
        var highColor = palette[scale[3][1]];
        function pct(k) { return Math.round(1000 * k / c.n) / 10; }
        var down = models.map(function (m) { return -pct(((c.dissent || {})[m.key] || {}).down || 0); });
        var up = models.map(function (m) { return pct(((c.dissent || {})[m.key] || {}).up || 0); });
        var reach = 1;
        down.concat(up).forEach(function (v) { reach = Math.max(reach, Math.abs(v)); });
        reach = Math.ceil(reach * 1.1);
        function bar(name, values, color) {
            var s = {
                name: name, type: 'bar', stack: 'dissent', barMaxWidth: 26,
                emphasis: { focus: 'series' }, data: values
            };
            if (color) s.itemStyle = { color: color };
            return s;
        }
        return {
            grid: C._grid({ left: 130, right: 24, top: 40, bottom: 36 }),
            legend: C._legend({ top: 0 }),
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    var m = models[params[0].dataIndex] || {};
                    var d = (c.dissent || {})[m.key] || {};
                    return '<strong>' + P.escapeHtml(m.label || '') + '</strong><br>'
                        + P.t('sentiment.dissent_tip', {
                            down: P.formatNumber(d.down || 0),
                            up: P.formatNumber(d.up || 0),
                            count: c.n
                        });
                }
            },
            xAxis: {
                type: 'value', min: -reach, max: reach,
                axisLabel: { formatter: function (v) { return C._percentTick(Math.abs(v)); } }
            },
            yAxis: {
                type: 'category', inverse: true,
                data: models.map(function (m) { return m.label; }),
                axisTick: { show: false }
            },
            series: [
                bar(P.t('sentiment.dissent_down_' + dim), down, lowColor),
                bar(P.t('sentiment.dissent_up_' + dim), up, highColor)
            ],
            iwacRows: function () {
                return {
                    columns: [
                        { label: P.t('Model'), numeric: false },
                        { label: P.t('sentiment.dissent_down_' + dim), numeric: true },
                        { label: P.t('sentiment.dissent_up_' + dim), numeric: true }
                    ],
                    rows: models.map(function (m) {
                        var d = (c.dissent || {})[m.key] || {};
                        return [m.label, d.down || 0, d.up || 0];
                    })
                };
            }
        };
    };
})();
