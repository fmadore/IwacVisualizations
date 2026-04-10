/**
 * IWAC Visualizations — Collection Overview: Languages panel
 *
 * Faceted language distribution pie. Facets:
 *   - Global
 *   - By type (sub-buttons: article, publication, document, audiovisual, reference)
 *   - By country (sub-select: 6 countries)
 *
 * Reads the new `data.languages` structure: { global, by_type, by_country }.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/languages: missing dependencies');
        return;
    }

    function render(panelEl, data) {
        var langs = (data && data.languages) || {};
        var hasAnyData =
            (langs.global && langs.global.length) ||
            (langs.by_type && Object.keys(langs.by_type).length) ||
            (langs.by_country && Object.keys(langs.by_country).length);

        if (!hasAnyData) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var state = { facet: 'global', subFacet: null };

        var typeKeys = Object.keys(langs.by_type || {});
        var typeSubFacets = typeKeys.reduce(function (acc, k) {
            acc[k] = P.t('item_type_' + k);
            return acc;
        }, {});

        var countryKeys = Object.keys(langs.by_country || {}).sort();
        var countrySubFacets = countryKeys.reduce(function (acc, c) {
            acc[c] = c;
            return acc;
        }, {});

        var facetBar = P.buildFacetButtons({
            facets: [
                { key: 'global',     label: P.t('Global') },
                {
                    key: 'by_type',
                    label: P.t('By type'),
                    subFacets: typeSubFacets,
                    renderAs: 'buttons'
                },
                {
                    key: 'by_country',
                    label: P.t('By country'),
                    subFacets: countrySubFacets,
                    renderAs: 'select'
                }
            ],
            activeKey: 'global',
            onChange: function (evt) {
                state.facet = evt.facet;
                state.subFacet = evt.subFacet || null;
                rerender();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        function currentEntries() {
            if (state.facet === 'global')     return (langs.global || []).slice(0, 10);
            if (state.facet === 'by_type')    return ((langs.by_type || {})[state.subFacet] || []).slice(0, 10);
            if (state.facet === 'by_country') return ((langs.by_country || {})[state.subFacet] || []).slice(0, 10);
            return [];
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var entries = currentEntries();
            if (entries.length === 0) {
                instance.clear();
                return;
            }
            instance.setOption(C.pie(entries, { nameKey: 'name', valueKey: 'count' }), true);
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                var entries = currentEntries();
                if (entries.length === 0) {
                    chart.clear();
                } else {
                    chart.setOption(C.pie(entries, { nameKey: 'name', valueKey: 'count' }), true);
                }
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.languages = { render: render };
})();
