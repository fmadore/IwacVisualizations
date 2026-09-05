/**
 * IWAC Visualizations — Laïcité block: bylines (issue #19 F).
 *
 * Who writes the laïcité beat, as against the actors view's who the
 * coverage names. The two together are the actor picture the dossier
 * needs: one is the subject of the writing, this is its source.
 *
 * THE DENOMINATOR LEADS. Byline coverage in this corpus is uneven — it
 * varies by outlet and, sharply, by decade, because older material is
 * more often unsigned and a signature line survives OCR less reliably
 * than body text does. A ranked list of names on its own would read as
 * "these journalists owned the beat" when a large part of the honest
 * answer is "we do not know who wrote the rest". So the signed share
 * comes first, per decade, and the ranking sits below it — never the
 * other way round.
 *
 * Bylines are not people. Press agencies sign alongside journalists and
 * are deliberately left in: an agency signature is the same circulation
 * signal the neighbouring view measures another way. The panel says
 * "bylines", never "authors" or "journalists".
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite bylines: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;
    var L = ns.laicite = ns.laicite || {};

    function pct(n, d) { return d ? (n / d) * 100 : 0; }

    /**
     * Signed share per decade — the coverage curve the ranking below has
     * to be read through.
     *
     * Two series rather than one percentage line: the share alone would
     * hide that a 100%-signed decade of nine articles is not the same
     * evidence as a 60%-signed decade of four hundred. The bars carry
     * the volume, the line carries the share.
     */
    function coverageOption(bundle) {
        var rows = bundle.by_decade || [];
        if (!rows.length) return P.emptyChartOption();

        var palette = (ns.getPalette && ns.getPalette()) || [];
        var R = ns.responsive;
        var decades = rows.map(function (r) { return r.decade; });

        var option = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({ left: 56, right: 56, top: 44, bottom: 44 })
                : { left: 56, right: 56, top: 44, bottom: 44, containLabel: true },
            legend: { top: 4 },
            tooltip: {
                trigger: 'axis',
                confine: true,
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    var row = rows[params[0].dataIndex] || {};
                    return '<strong>' + P.escapeHtml(params[0].axisValue) + '</strong><br>'
                        + P.t('laicite.bylines_decade_tooltip', {
                            signed: P.formatNumber(row.signed || 0),
                            articles: P.formatNumber(row.articles || 0),
                            percent: pct(row.signed, row.articles).toFixed(0)
                        });
                }
            },
            xAxis: { type: 'category', data: decades },
            yAxis: [
                { type: 'value', name: P.t('laicite.bylines_axis_articles'),
                  nameLocation: 'end', nameGap: 12 },
                { type: 'value', name: P.t('laicite.bylines_axis_share'),
                  nameLocation: 'end', nameGap: 12, max: 100,
                  axisLabel: C._percentAxisLabel(),
                  splitLine: { show: false } }
            ],
            series: [
                {
                    name: P.t('laicite.bylines_series_articles'),
                    type: 'bar',
                    itemStyle: { color: palette[0] },
                    data: rows.map(function (r) { return r.articles || 0; })
                },
                {
                    name: P.t('laicite.bylines_series_share'),
                    type: 'line',
                    yAxisIndex: 1,
                    symbol: 'circle',
                    symbolSize: 6,
                    lineStyle: { width: 2 },
                    itemStyle: { color: palette[1] },
                    data: rows.map(function (r) {
                        return Math.round(pct(r.signed, r.articles) * 10) / 10;
                    })
                }
            ]
        };
        return R && R.withMedia ? R.withMedia(option, {}) : option;
    }

    /** The ranking itself — bylines by dossier articles signed. */
    function topOption(bundle) {
        var top = (bundle.top || []).slice(0, 20).slice().reverse();
        if (!top.length) return P.emptyChartOption();

        var palette = (ns.getPalette && ns.getPalette()) || [];
        var R = ns.responsive;
        var option = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({ left: 180, top: 16, bottom: 40 })
                : { left: 180, right: 24, top: 16, bottom: 40, containLabel: true },
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    var row = top[p.dataIndex] || {};
                    var papers = (row.newspapers || []).map(function (n) {
                        return n.name + ' (' + P.formatNumber(n.count) + ')';
                    }).join(', ');
                    var span = (row.first && row.last)
                        ? row.first + '–' + row.last : '';
                    var bits = [
                        P.t('laicite.bylines_count', {
                            count: P.formatNumber(row.count || 0)
                        })
                    ];
                    if (span) bits.push(span);
                    if (papers) bits.push(papers);
                    // Escape each part, then join with real markup —
                    // escaping the joined string and undoing the <br>
                    // afterwards would also undo a literal "<br>" that
                    // happened to sit inside a byline.
                    return '<strong>' + P.escapeHtml(row.name || '') + '</strong><br>'
                        + bits.map(P.escapeHtml).join('<br>');
                }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: top.map(function (r) { return r.name; }),
                axisLabel: { fontSize: 11 }
            },
            series: [{
                type: 'bar',
                itemStyle: { color: palette[0] },
                data: top.map(function (r) { return r.count || 0; })
            }]
        };
        return R && R.withMedia ? R.withMedia(option, {}) : option;
    }

    /**
     * @param {Object} cfg {bundle}
     * @returns {{root: HTMLElement, mount: function():void}}
     */
    L.buildBylines = function (cfg) {
        var bundle = cfg.bundle || {};
        var root = P.el('div', 'iwac-vis-laicite-bylines');
        var mounts = [];

        var panel = P.el('div', 'iwac-vis-panel');
        panel.appendChild(P.el('h4', null, P.t('laicite.bylines_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.bylines_desc')));

        var articles = bundle.articles || 0;
        var signed = bundle.signed || 0;
        if (!articles) {
            panel.appendChild(P.buildNoDataState());
            root.appendChild(panel);
            return { root: root, mount: function () {} };
        }

        panel.appendChild(P.buildSummaryCards([
            { value: signed, labelKey: 'laicite.bylines_kpi_signed' },
            { value: articles, labelKey: 'laicite.bylines_kpi_articles' },
            { value: pct(signed, articles).toFixed(0) + '%', text: true,
              labelKey: 'laicite.bylines_kpi_share' },
            { value: bundle.unique || 0, labelKey: 'laicite.bylines_kpi_unique' }
        ]));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc iwac-vis-laicite-bylines-note',
            P.t('laicite.bylines_note')));
        root.appendChild(panel);

        // Coverage BEFORE the ranking, deliberately: the ranking is only
        // interpretable through it.
        var coverage = P.buildPanel('iwac-vis-panel iwac-vis-laicite-bylines-coverage',
            P.t('laicite.bylines_coverage_title'),
            P.t('laicite.bylines_coverage_desc'));
        root.appendChild(coverage.panel);
        mounts.push(function () {
            ns.registerChart(coverage.chart, function (el, instance) {
                instance.setOption(coverageOption(bundle), { notMerge: true });
            });
        });

        if ((bundle.top || []).length) {
            var ranking = P.buildPanel('iwac-vis-panel iwac-vis-laicite-bylines-top',
                P.t('laicite.bylines_top_title'),
                P.t('laicite.bylines_top_desc', {
                    min: bundle.min_items || 1
                }));
            root.appendChild(ranking.panel);
            mounts.push(function () {
                ns.registerChart(ranking.chart, function (el, instance) {
                    instance.setOption(topOption(bundle), { notMerge: true });
                });
            });
        }

        return {
            root: root,
            mount: function () { mounts.forEach(function (fn) { fn(); }); }
        };
    };
})();
