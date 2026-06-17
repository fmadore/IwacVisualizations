/**
 * IWAC Visualizations — Index Overview: Lifespan × frequency scatter
 *
 * Scatter plot of every entity that has both `first_occurrence` and
 * `last_occurrence` in the authority index:
 *   - x: span in years (last_year - first_year)
 *   - y: total frequency
 *   - color: by entity type (stable via C._countryColor-style palette)
 *   - tooltip: title + type + years + frequency
 *   - click: navigate to the Omeka item page (per-entity dashboard)
 *
 * Filtering is via a type facet bar above the chart; the "All types"
 * view stacks every available type with distinct colors from the IWAC
 * palette, which is built from CSS tokens by iwac-theme.js. No hex
 * literals anywhere — callers go through `ns.getPalette()`.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.index-overview/lifespan: missing dependencies');
        return;
    }

    var TYPE_ORDER = ['Personnes', 'Lieux', 'Organisations', 'Sujets', '\u00c9v\u00e9nements'];
    var TYPE_I18N = {
        'Personnes':            'Persons',
        'Lieux':                'Places',
        'Organisations':        'Organizations',
        'Sujets':               'Subjects',
        '\u00c9v\u00e9nements': 'Events'
    };
    var ALL_KEY = '__all__';

    function colorFor(type) {
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var idx = TYPE_ORDER.indexOf(type);
        if (idx < 0) idx = 0;
        return palette[idx % Math.max(1, palette.length)];
    }

    function buildOption(lifespan, activeType) {
        var types = activeType === ALL_KEY
            ? TYPE_ORDER.filter(function (t) { return (lifespan[t] || []).length > 0; })
            : [activeType];

        var series = types.map(function (t) {
            var entries = lifespan[t] || [];
            return {
                name: P.t(TYPE_I18N[t] || t),
                type: 'scatter',
                itemStyle: { color: colorFor(t), opacity: 0.75 },
                emphasis: { focus: 'series', itemStyle: { opacity: 1 } },
                data: entries.map(function (e) {
                    return {
                        value: [e.span_years, e.frequency],
                        name: e.title,
                        o_id: e.o_id,
                        title: e.title,
                        type: t,
                        first_year: e.first_year,
                        last_year: e.last_year,
                        frequency: e.frequency
                    };
                }),
                symbolSize: function (val) {
                    // Linear size based on frequency, clamped for readability
                    var f = Math.max(1, val[1]);
                    return Math.max(6, Math.min(28, 4 + Math.sqrt(f) * 0.6));
                }
            };
        });

        return {
            grid: C._grid({ left: 48, right: 24, top: 36, bottom: 48 }),
            legend: {
                type: 'scroll',
                top: 4,
                itemWidth: 12,
                itemHeight: 10
            },
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var d = p.data || {};
                    var lines = [
                        '<strong>' + P.escapeHtml(d.title || '') + '</strong>',
                        P.t(TYPE_I18N[d.type] || d.type || ''),
                        (d.first_year || '?') + ' \u2013 ' + (d.last_year || '?'),
                        P.t('mentions_count', { count: P.formatNumber(d.frequency || 0) })
                    ];
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'value',
                name: P.t('Span (years)'),
                nameLocation: 'middle',
                nameGap: 28,
                min: 0
            },
            yAxis: {
                type: 'value',
                name: P.t('Frequency'),
                min: 0
            },
            series: series,
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
    }

    function render(panelEl, data, ctx) {
        var lifespan = (data && data.lifespan) || {};
        var hasAny = TYPE_ORDER.some(function (t) { return (lifespan[t] || []).length > 0; });
        if (!hasAny) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var state = { activeType: ALL_KEY };

        var types = { __all__: P.t('All types') };
        TYPE_ORDER.forEach(function (t) {
            if ((lifespan[t] || []).length > 0) {
                types[t] = P.t(TYPE_I18N[t] || t);
            }
        });
        var facetBar = P.buildFacetButtons({
            facets: [{
                key: 'type',
                label: P.t('Type'),
                subFacets: types,
                renderAs: 'buttons'
            }],
            activeKey: 'type',
            onChange: function (evt) {
                state.activeType = evt.subFacet || ALL_KEY;
                if (chart && !chart.isDisposed()) {
                    chart.setOption(buildOption(lifespan, state.activeType), true);
                }
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            instance.setOption(buildOption(lifespan, state.activeType), true);
        });

        if (chart) {
            chart.on('click', function (params) {
                var d = params.data;
                var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';
                if (d && d.o_id && siteBase) {
                    window.location.href = siteBase + '/item/' + d.o_id;
                }
            });
        }
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.lifespan = { render: render };
})();
