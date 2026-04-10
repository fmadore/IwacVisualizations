/**
 * IWAC Visualizations — Collection Overview: Newspaper Gantt panel
 *
 * Horizontal period bars (year_min → year_max) per newspaper, faceted by
 * country and by item type. Both facets are independent; their states
 * merge into a single filter pass before calling C.gantt.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/gantt: missing dependencies');
        return;
    }

    var ALL_KEY = '__all__';

    function render(panelEl, data) {
        var coverage = (data && data.newspapers && data.newspapers.coverage) || [];
        if (coverage.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var state = { country: ALL_KEY, type: ALL_KEY };

        var countries = {};
        countries[ALL_KEY] = P.t('All countries');
        coverage.forEach(function (e) {
            if (e.country) countries[e.country] = e.country;
        });

        var types = {};
        types[ALL_KEY] = P.t('All types');
        coverage.forEach(function (e) {
            if (e.type) types[e.type] = P.t('item_type_' + e.type);
        });

        // Two facet bars, one per dimension — rendered side-by-side
        var facetsWrap = P.el('div', 'iwac-vis-facets-pair');
        facetsWrap.style.display = 'flex';
        facetsWrap.style.flexWrap = 'wrap';
        facetsWrap.style.gap = '1rem';

        var countryBar = P.buildFacetButtons({
            facets: [{
                key: 'country',
                label: P.t('Country'),
                subFacets: countries,
                renderAs: 'select'
            }],
            activeKey: 'country',
            onChange: function (evt) {
                state.country = evt.subFacet || ALL_KEY;
                rerender();
            }
        });

        var typeBar = P.buildFacetButtons({
            facets: [{
                key: 'type',
                label: P.t('Type'),
                subFacets: types,
                renderAs: 'buttons'
            }],
            activeKey: 'type',
            onChange: function (evt) {
                state.type = evt.subFacet || ALL_KEY;
                rerender();
            }
        });

        facetsWrap.appendChild(countryBar.root);
        facetsWrap.appendChild(typeBar.root);
        panelEl.panel.insertBefore(facetsWrap, panelEl.chart);

        function filtered() {
            return coverage.filter(function (e) {
                if (state.country !== ALL_KEY && e.country !== state.country) return false;
                if (state.type !== ALL_KEY && e.type !== state.type) return false;
                return true;
            });
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var rows = filtered();
            if (rows.length === 0) {
                instance.clear();
            } else {
                instance.setOption(C.gantt(rows), true);
            }
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                var rows = filtered();
                if (rows.length === 0) {
                    chart.clear();
                } else {
                    chart.setOption(C.gantt(rows), true);
                }
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.gantt = { render: render };
})();
