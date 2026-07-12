/**
 * IWAC Visualizations — Scary Terms block: Trends view builders (issue #2).
 *
 * Stateless option/DOM builders for the time-series view: one line per
 * term family across the collection's year range, with hand-curated
 * historical-event annotations (markLine verticals + markArea bands)
 * from asset/data/scary-terms-events.json.
 *
 * Loaded after scary-terms/helpers.js, before the orchestrator, which
 * aliases these via IWACVis.scaryTerms.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.scaryTerms trends: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var S = ns.scaryTerms = ns.scaryTerms || {};

    /**
     * Derive the aligned `{family: [count/year]}` series the trends view
     * needs from the temporal bundle (`{year: {data: [[family, count]]}}`)
     * — the fallback path when a deploy predates scary-terms-trends.json.
     */
    S.buildTrendsSeriesFromTemporal = function (temporal, years, families) {
        var series = {};
        families.forEach(function (f) {
            series[f] = years.map(function () { return 0; });
        });
        years.forEach(function (year, yi) {
            var pairs = (temporal[String(year)] || {}).data || [];
            pairs.forEach(function (pair) {
                if (series[pair[0]]) series[pair[0]][yi] = pair[1];
            });
        });
        return series;
    };

    /** Filter the curated events to those visible for the active country
     *  scope (global events always pass; country events only when the
     *  trends view is filtered to that country). */
    S.visibleEvents = function (events, country) {
        if (!events) return { points: [], periods: [] };
        function pass(e) {
            if (!e || e.scope !== 'country') return !!e;
            return !!country && e.country === country;
        }
        return {
            points: (events.point_events || []).filter(pass),
            periods: (events.period_events || []).filter(pass)
        };
    };

    function eventLabel(e) {
        return (ns.locale === 'fr' ? e.label_fr : e.label_en) || e.label_en || '';
    }
    S.eventLabel = eventLabel;

    /**
     * Build the ECharts option for the trends view.
     *
     * @param {Object} cfg
     * @param {Array<number>} cfg.years         aligned year axis
     * @param {Array<string>} cfg.families      canonical family order
     * @param {Object<string,Array<number>>} cfg.series  per-family counts
     * @param {Object<string,string>} cfg.termColors
     * @param {Object|null} cfg.events          parsed events bundle
     * @param {boolean} cfg.showEvents
     * @param {string|null} cfg.country         active country scope
     * @param {boolean} cfg.compact             true ≤ 640px: markers keep
     *                                          their lines, labels move to
     *                                          the tooltip only
     */
    S.buildTrendsOption = function (cfg) {
        var years = cfg.years || [];
        var families = cfg.families || [];
        var series = cfg.series || {};
        var termColors = cfg.termColors || {};

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var resolve = ns.resolveCssVar || function () { return ''; };
        var mutedResolved   = resolve('--muted') || tokens.muted || '#767880';
        var borderResolved  = resolve('--border') || tokens.border || '#d4d6da';
        var surfaceResolved = resolve('--surface-raised') || tokens.surfaceRaised
            || tokens.surface || '#fafaf9';
        var primaryResolved = resolve('--primary') || tokens.primary || '#e64a19';

        var chartSeries = families.map(function (family) {
            return {
                name: family,
                type: 'line',
                showSymbol: false,
                symbol: 'circle',
                symbolSize: 4,
                lineStyle: { width: 2 },
                emphasis: { focus: 'series' },
                itemStyle: { color: termColors[family] },
                data: series[family] || []
            };
        });

        if (cfg.events && cfg.showEvents) {
            var visible = S.visibleEvents(cfg.events, cfg.country);
            if (visible.points.length || visible.periods.length) {
                chartSeries.push(buildAnnotationSeries(visible, {
                    years: years,
                    compact: cfg.compact,
                    muted: mutedResolved,
                    border: borderResolved,
                    surface: surfaceResolved,
                    primary: primaryResolved
                }));
            }
        }

        var R = ns.responsive;
        var base = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({ left: 64, top: 56, bottom: 56 })
                : { left: 64, right: 24, top: 56, bottom: 56, containLabel: true },
            legend: { type: 'scroll', top: 4, itemWidth: 14, itemHeight: 3 },
            tooltip: {
                trigger: 'axis',
                confine: true,
                axisPointer: { type: 'line' },
                // Drop zero rows so the 12-family tooltip stays scannable
                // (default ECharts tooltip if chart-options is absent, in
                // line with this file's other guarded fallbacks).
                formatter: (ns.chartOptions && ns.chartOptions.sortedAxisTooltip)
                    ? ns.chartOptions.sortedAxisTooltip({
                        skip: function (p) { return !p.value; },
                        row: function (p) {
                            return p.marker + ' ' + P.escapeHtml(p.seriesName)
                                + ': <strong>' + P.formatNumber(p.value) + '</strong>';
                        }
                    })
                    : undefined
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: years.map(String),
                name: P.t('Year'),
                nameLocation: 'middle',
                nameGap: 28
            },
            yAxis: Object.assign(
                { type: 'value' },
                (ns.chartOptions && ns.chartOptions._valueAxisName)
                    ? ns.chartOptions._valueAxisName(P.t('scary.occurrences'))
                    : { name: P.t('scary.occurrences') }
            ),
            dataZoom: (ns.chartOptions && ns.chartOptions._dataZoom)
                ? ns.chartOptions._dataZoom(years.length, { threshold: 30 })
                : [],
            series: chartSeries,
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
        return R && R.withMedia
            ? R.withMedia(base, R.valueChartMedia({ hasZoom: years.length > 30 }))
            : base;
    };

    /**
     * The annotation series carries no data — it exists purely for its
     * markLine (point events) and markArea (period events). Periods render
     * UNDER the data lines (z: 0), point markers above (markLine z: 10).
     * Label positions alternate top/bottom across adjacent events so
     * closely-spaced years (2015/2016/2017) don't stack labels.
     */
    function buildAnnotationSeries(visible, style) {
        var sorted = visible.points.slice().sort(function (a, b) {
            return (a.year || 0) - (b.year || 0);
        });
        return {
            name: '__events__',
            type: 'line',
            data: [],
            silent: true,
            showSymbol: false,
            // Keep this pseudo-series out of the legend + tooltip.
            legendHoverLink: false,
            tooltip: { show: false },
            markLine: {
                symbol: ['none', 'none'],
                silent: false,
                z: 10,
                label: {
                    show: !style.compact,
                    formatter: function (p) {
                        return (p.data && p.data.iwacLabel) || '';
                    },
                    color: style.muted,
                    fontSize: 11,
                    backgroundColor: style.surface,
                    padding: [2, 6],
                    borderRadius: 3
                },
                lineStyle: {
                    color: style.border,
                    type: 'dashed',
                    width: 1
                },
                emphasis: {
                    label: { show: true },
                    lineStyle: { color: style.muted }
                },
                data: sorted.map(function (e, i) {
                    return {
                        xAxis: String(e.year),
                        iwacLabel: S.eventLabel(e),
                        label: {
                            position: i % 2 === 0 ? 'insideEndTop' : 'insideEndBottom'
                        }
                    };
                })
            },
            markArea: {
                silent: true,
                z: 0,
                itemStyle: {
                    color: style.primary,
                    opacity: 0.06
                },
                label: { show: false },
                data: visible.periods.map(function (e) {
                    return [{ xAxis: String(e.start) }, { xAxis: String(e.end) }];
                })
            }
        };
    }

    /**
     * `<details>` fallback listing every visible event as plain text —
     * screen readers and no-hover readers get the full list without
     * depending on chart interactivity.
     */
    S.buildEventsDetails = function (events, country) {
        var visible = S.visibleEvents(events, country);
        var all = visible.periods.map(function (e) {
            return { sort: e.start, text: e.start + '–' + e.end + ' — ' + eventLabel(e) };
        }).concat(visible.points.map(function (e) {
            return { sort: e.year, text: e.year + ' — ' + eventLabel(e) };
        }));
        if (!all.length) return null;
        all.sort(function (a, b) { return a.sort - b.sort; });

        var details = P.el('details', 'iwac-vis-scary-details');
        details.appendChild(P.el('summary', null, P.t('scary.events_list')));
        var list = P.el('ul', 'iwac-vis-scary-details-list');
        all.forEach(function (e) {
            list.appendChild(P.el('li', null, e.text));
        });
        details.appendChild(list);
        return details;
    };
})();
