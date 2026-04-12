/**
 * IWAC Visualizations — Person Dashboard: summary stats row
 *
 * 5 cards: total mentions, year range, newspapers, countries, neighbors.
 * Subscribes to the role facet and rebuilds when the role changes.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.person-dashboard/stats: missing panels');
        return;
    }

    function buildCards(slice) {
        var range = (slice.year_min && slice.year_max)
            ? slice.year_min + '\u2013' + slice.year_max
            : '\u2014';
        var cards = P.el('div', 'iwac-vis-overview-summary');

        function card(value, labelKey) {
            var c = P.el('div', 'iwac-vis-summary-card');
            c.appendChild(P.el('div', 'iwac-vis-summary-card__value',
                typeof value === 'number' ? P.formatNumber(value) : String(value || '\u2014')));
            c.appendChild(P.el('div', 'iwac-vis-summary-card__label', P.t(labelKey)));
            cards.appendChild(c);
        }

        card(slice.total_mentions, 'Total mentions');
        card(range, 'Period covered_short');
        card(slice.newspapers_count, 'Newspapers');
        card(slice.countries_count, 'Countries');
        card(slice.neighbors_count, 'Neighbors');
        return cards;
    }

    function render(host, data, facet) {
        var summary = (data && data.summary && data.summary.by_role) || {};
        host.innerHTML = '';
        host.appendChild(buildCards(summary[facet.role] || {}));

        facet.subscribe(function (role) {
            host.innerHTML = '';
            host.appendChild(buildCards(summary[role] || {}));
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.stats = { render: render };
})();
