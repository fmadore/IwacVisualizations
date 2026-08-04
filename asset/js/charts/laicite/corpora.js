/**
 * IWAC Visualizations — Laïcité block: Two corpora compared (issue #14, view 6).
 *
 * Mainstream press against Islamic periodicals, plus the primary sources and
 * the scholarship, on rates normalised per 10,000 words rather than per item
 * — a 100-page periodical issue and a 400-word news brief are not
 * commensurable units, and an item count silently treats them as if they
 * were.
 *
 * Also carries the per-outlet frame fingerprints (review idea E): the same
 * contrast one level down, where it turns out to be sharpest.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite corpora: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    /**
     * @param {Object} cfg {bundle, metadata, state, frameColors}
     * @returns {{root: HTMLElement, mount: function():void}} `mount` paints
     *          the ECharts panels once they are in the document.
     */
    L.buildCorpora = function (cfg) {
        var bundle = cfg.bundle;
        var root = P.el('div', 'iwac-vis-laicite-corpora');
        var mounts = [];

        if (!bundle) {
            root.appendChild(P.buildNoDataState());
            return { root: root, mount: function () {} };
        }

        root.appendChild(buildRateTable(bundle));

        var trend = P.buildPanel('iwac-vis-laicite-corpora-trend',
            P.t('laicite.corpora_trend_title'), P.t('laicite.corpora_trend_desc'));
        root.appendChild(trend.panel);
        mounts.push(function () {
            ns.registerChart(trend.chart, function (el, instance) {
                instance.setOption(rateSeriesOption(bundle, cfg),
                    { notMerge: true });
            });
        });

        var fingerprints = buildFingerprints(bundle, cfg);
        if (fingerprints) {
            root.appendChild(fingerprints.panel);
            mounts.push(fingerprints.mount);
        }

        return {
            root: root,
            mount: function () { mounts.forEach(function (fn) { fn(); }); }
        };
    };

    /** Per-corpus rates. One row per corpus, no total row — see the module
     *  docblock; the whole point is that these are not addable. */
    function buildRateTable(bundle) {
        var panel = P.el('div', 'iwac-vis-panel');
        panel.appendChild(P.el('h4', null, P.t('laicite.corpora_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc', bundle.note || ''));

        var subsets = bundle.by_subset || {};
        var max = Object.keys(subsets).reduce(function (m, k) {
            return Math.max(m, subsets[k].per_10k || 0);
        }, 0) || 1;

        var list = P.el('ul', 'iwac-vis-laicite-rate-list');
        L.SUBSETS.forEach(function (subset) {
            var v = subsets[subset];
            if (!v) return;
            var li = P.el('li', 'iwac-vis-laicite-rate');
            var head = P.el('div', 'iwac-vis-laicite-rate-head');
            head.appendChild(P.el('span', 'iwac-vis-laicite-rate-name',
                L.subsetLabel(subset)));
            head.appendChild(P.el('span', 'iwac-vis-laicite-rate-value',
                (v.per_10k == null ? '—' : v.per_10k.toFixed(1))));
            li.appendChild(head);

            var bar = P.el('div', 'iwac-vis-laicite-rate-bar');
            var fill = P.el('span', 'iwac-vis-laicite-rate-fill');
            fill.style.width = Math.max(2, ((v.per_10k || 0) / max) * 100) + '%';
            bar.appendChild(fill);
            li.appendChild(bar);

            li.appendChild(P.el('p', 'iwac-vis-laicite-rate-meta',
                P.t('laicite.corpora_rate_meta', {
                    items: P.formatNumber(v.items || 0),
                    words: P.formatNumber(v.words || 0),
                    occ: P.formatNumber(v.occurrences || 0)
                })));
            list.appendChild(li);
        });
        panel.appendChild(list);

        // The density figure is easy to over-read, so the caveat sits with
        // it: a press article is dense because it is about laïcité and
        // nothing else, while a periodical issue is a whole magazine in
        // which laïcité is one item. Density measures how much of a document
        // is about the subject; it is not a measure of attention.
        panel.appendChild(P.el('p', 'iwac-vis-laicite-caveat',
            P.t('laicite.corpora_density_caveat')));
        return panel;
    }

    /** Rate per 10k words per year, one line per corpus — the view that
     *  actually tests "continuous vs crisis-driven". */
    function rateSeriesOption(bundle, cfg) {
        var subsets = bundle.by_subset || {};
        var years = {};
        Object.keys(subsets).forEach(function (k) {
            Object.keys(subsets[k].by_year || {}).forEach(function (y) {
                years[y] = true;
            });
        });
        var axis = Object.keys(years).map(Number).sort(function (a, b) {
            return a - b;
        });
        if (!axis.length) return P.emptyChartOption();

        var palette = (ns.getPalette && ns.getPalette()) || [];
        var series = L.SUBSETS.filter(function (k) { return subsets[k]; })
            .map(function (k, i) {
                var byYear = subsets[k].by_year || {};
                return {
                    name: L.subsetLabel(k),
                    type: 'line',
                    smooth: false,
                    showSymbol: false,
                    connectNulls: false,
                    lineStyle: { width: 2 },
                    itemStyle: {
                        color: palette.length ? palette[i % palette.length] : undefined
                    },
                    emphasis: { focus: 'series' },
                    data: axis.map(function (y) {
                        var row = byYear[String(y)];
                        return row && row.per_10k != null ? row.per_10k : null;
                    })
                };
            });

        var R = ns.responsive;
        var base = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({ left: 64, top: 48, bottom: 56 })
                : { left: 64, right: 24, top: 48, bottom: 56, containLabel: true },
            legend: { type: 'scroll', top: 4, itemWidth: 14, itemHeight: 3 },
            tooltip: { trigger: 'axis', confine: true },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: axis.map(String),
                name: P.t('Year'),
                nameLocation: 'middle',
                nameGap: 28
            },
            yAxis: Object.assign({ type: 'value' },
                (ns.chartOptions && ns.chartOptions._valueAxisName)
                    ? ns.chartOptions._valueAxisName(P.t('laicite.per_10k'))
                    : { name: P.t('laicite.per_10k') }),
            dataZoom: (ns.chartOptions && ns.chartOptions._dataZoom)
                ? ns.chartOptions._dataZoom(axis.length, { threshold: 30 })
                : [],
            series: series
        };
        void cfg;
        return R && R.withMedia
            ? R.withMedia(base, R.valueChartMedia({ hasZoom: axis.length > 30 }))
            : base;
    }

    /** Newspaper × frame heatmap, row-normalised so outlets of very
     *  different sizes read on one scale. */
    function buildFingerprints(bundle, cfg) {
        var papers = (bundle.newspapers || []).slice(0, 24);
        if (!papers.length) return null;
        var frames = bundle.frames || [];
        var metadata = cfg.metadata || {};

        var built = P.buildPanel('iwac-vis-laicite-fingerprints',
            P.t('laicite.fingerprints_title'), P.t('laicite.fingerprints_desc'));

        var xLabels = frames.map(function (f) {
            return L.frameLabel(metadata, f);
        });
        var yLabels = papers.map(function (p) { return p.name; });
        var cells = [];
        papers.forEach(function (paper, y) {
            frames.forEach(function (frame, x) {
                cells.push([x, y, Math.round((paper.frame_share[frame] || 0) * 100)]);
            });
        });

        return {
            panel: built.panel,
            mount: function () {
                ns.registerChart(built.chart, function (el, instance) {
                    var C = ns.chartOptions;
                    if (!C || !C.heatmapMatrix) {
                        instance.setOption(P.emptyChartOption(), { notMerge: true });
                        return;
                    }
                    instance.setOption(C.heatmapMatrix(
                        { xLabels: xLabels, yLabels: yLabels, cells: cells },
                        {
                            visualMax: 100,
                            cellLabels: false,
                            cellBorder: true,
                            xLabelRotate: 40,
                            tooltipFormatter: function (p) {
                                return P.escapeHtml(yLabels[p.value[1]]) + '<br>'
                                    + P.escapeHtml(xLabels[p.value[0]]) + ': <strong>'
                                    + p.value[2] + '%</strong>';
                            }
                        }
                    ), { notMerge: true });
                });
            }
        };
    }

    /**
     * Seasonality: Gregorian against lunar months (review idea B).
     *
     * A lunar observance drifts ~11 days a year, so over sixty years it
     * smears across all twelve Gregorian months — a Gregorian axis
     * structurally cannot see Ramadan or the hajj. Showing both profiles
     * side by side is the only way to tell a calendar-bound rhythm from a
     * civil-calendar one.
     */
    L.seasonalityOption = function (bundle, subset, metadata) {
        var data = ((bundle || {}).by_subset || {})[subset];
        if (!data) return P.emptyChartOption();
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var months = P.t('laicite.months').split(',');
        var hijri = P.t('laicite.hijri_months').split(',');
        void metadata;

        var R = ns.responsive;
        var base = {
            grid: [
                { left: 56, right: 24, top: 56, height: '32%', containLabel: true },
                { left: 56, right: 24, bottom: 48, height: '32%', containLabel: true }
            ],
            tooltip: { trigger: 'axis', confine: true },
            legend: { top: 4 },
            xAxis: [
                { type: 'category', data: months, gridIndex: 0,
                  axisLabel: { interval: 0, rotate: 40 } },
                { type: 'category', data: hijri, gridIndex: 1,
                  axisLabel: { interval: 0, rotate: 40 } }
            ],
            yAxis: [
                { type: 'value', gridIndex: 0, name: P.t('laicite.items') },
                { type: 'value', gridIndex: 1, name: P.t('laicite.items') }
            ],
            series: [
                {
                    name: P.t('laicite.gregorian'),
                    type: 'bar',
                    data: data.gregorian || [],
                    xAxisIndex: 0, yAxisIndex: 0,
                    itemStyle: { color: palette[0] }
                },
                {
                    name: P.t('laicite.hijri'),
                    type: 'bar',
                    data: data.hijri || [],
                    xAxisIndex: 1, yAxisIndex: 1,
                    itemStyle: { color: palette[1] }
                }
            ]
        };
        return R && R.withMedia ? R.withMedia(base, {}) : base;
    };
})();
