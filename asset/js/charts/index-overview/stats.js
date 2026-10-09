/**
 * IWAC Visualizations — Index Overview: Summary stats panel
 *
 * Eight summary cards: total entities, per-type counts, total mentions,
 * time span. Cards with a zero count are skipped automatically by
 * P.buildSummaryCards.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.index-overview/stats: panels.js must load first');
        return;
    }

    function render(host, data) {
        var s = (data && data.summary) || {};
        var byType = s.by_type || {};

        var cards = [
            { value: s.total_entities,              labelKey: 'Total entities' },
            { value: byType['Personnes'],           labelKey: 'entity_type_Personnes' },
            { value: byType['Lieux'],               labelKey: 'entity_type_Lieux' },
            { value: byType['Organisations'],       labelKey: 'entity_type_Organisations' },
            { value: byType['Sujets'],              labelKey: 'entity_type_Sujets' },
            { value: byType['\u00c9v\u00e9nements'], labelKey: 'entity_type_\u00c9v\u00e9nements' },
            { value: s.total_mentions,              labelKey: 'Total mentions' },
            { value: s.with_coordinates,            labelKey: 'With coordinates' }
        ];
        host.appendChild(P.buildSummaryCards(cards));

        var subtitle = P.buildPeriodSubtitle(s.year_min, s.year_max);
        if (subtitle) host.appendChild(subtitle);
    }

    ns.indexOverview = ns.indexOverview || {};
    ns.indexOverview.stats = { render: render };
})();
