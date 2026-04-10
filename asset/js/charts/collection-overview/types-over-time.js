/**
 * IWAC Visualizations — Collection Overview: Items-by-type-over-time panel
 *
 * Stacked bar of items per year, broken down by item type. Faceted by
 * country via a <select> (7 options: "All countries" + 6).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/types-over-time: missing dependencies');
        return;
    }

    var ALL_KEY = '__all__';

    function render(panelEl, data) {
        var tot = data && data.types_over_time;
        if (!tot || !tot.years || tot.years.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var state = { country: ALL_KEY };

        // Build country sub-facet list with "All countries" first
        var countries = Object.keys(tot.series_by_country || {}).sort();
        var subFacets = {};
        subFacets[ALL_KEY] = P.t('All countries');
        countries.forEach(function (c) { subFacets[c] = c; });

        var facetBar = P.buildFacetButtons({
            facets: [
                {
                    key: 'country',
                    label: P.t('Country'),
                    subFacets: subFacets,
                    renderAs: 'select'
                }
            ],
            activeKey: 'country',
            onChange: function (evt) {
                state.country = evt.subFacet || ALL_KEY;
                rerender();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        function currentSeries() {
            if (state.country === ALL_KEY) return tot.series_global || {};
            return (tot.series_by_country || {})[state.country] || {};
        }

        function buildOption() {
            return C.stackedBar({
                categories: tot.years,
                stackKeys: tot.types || [],
                series: currentSeries()
            }, {
                categoryName: P.t('Year'),
                valueName: P.t('Count'),
                labelFor: function (k) { return P.t('item_type_' + k); }
            });
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            instance.setOption(buildOption(), true);
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                chart.setOption(buildOption(), true);
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.typesOverTime = { render: render };
})();
