/**
 * IWAC Visualizations — Person Dashboard block (orchestrator)
 *
 * Thin controller: fetches asset/data/person-dashboards/{o_id}.json,
 * builds the layout skeleton, wires up the global role facet, and
 * delegates each panel's render to its dedicated module under
 * asset/js/charts/person-dashboard/.
 *
 * Panel render order:
 *   1. (Header card is rendered server-side in the PHTML — skipped here)
 *   2. Summary stats row        → stats.js
 *   3. Global role facet bar    → facet.js
 *   4. Mentions timeline        (reuses C.timeline via timeline.js)
 *   5. Top newspapers           (C.newspaper via newspapers.js)
 *   6. Countries breakdown      (C.horizontalBar via countries.js)
 *   7. Neighbors network        (C.network via network.js)
 *   8. Locations map            (createIwacMap via map.js)
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis person dashboard: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;

    function buildLayout(container, data, facet) {
        container.querySelector('.iwac-vis-person__loading') &&
            container.querySelector('.iwac-vis-person__loading').remove();

        var body = P.el('div', 'iwac-vis-person__body');
        container.appendChild(body);

        // 2. Summary stats row
        var statsHost = P.el('div', 'iwac-vis-person__stats');
        body.appendChild(statsHost);

        // 3. Facet bar
        var facetHost = P.el('div', 'iwac-vis-person__facet');
        body.appendChild(facetHost);

        // 4–8. Charts grid
        var grid = P.buildChartsGrid();
        grid.classList.add('iwac-vis-person__grid');
        body.appendChild(grid);

        var timelinePanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Mentions'));
        var newspapersPanel = P.buildPanel('iwac-vis-panel',                      P.t('Top newspapers'));
        var countriesPanel  = P.buildPanel('iwac-vis-panel',                      P.t('Countries covered'));
        var networkPanel    = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Associated entities'));
        var mapPanel        = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Locations mentioned'));

        [timelinePanel, newspapersPanel, countriesPanel, networkPanel, mapPanel]
            .forEach(function (p) { grid.appendChild(p.panel); });

        return {
            stats: statsHost,
            facetHost: facetHost,
            timeline: timelinePanel,
            newspapers: newspapersPanel,
            countries: countriesPanel,
            network: networkPanel,
            map: mapPanel
        };
    }

    function initDashboard(container) {
        var itemId = container.dataset.itemId;
        if (!itemId) return;

        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || '',
            itemId: itemId
        };
        var url = ctx.basePath + '/modules/IwacVisualizations/asset/data/person-dashboards/' + itemId + '.json';

        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var pd = ns.personDashboard || {};
                var facet = pd.facet ? pd.facet.create('all') : { role: 'all', subscribe: function () {}, set: function () {} };

                var h = buildLayout(container, data, facet);

                if (pd.stats)      pd.stats.render(h.stats, data, facet);
                if (pd.facet)      pd.facet.render(h.facetHost, data, facet);
                if (pd.timeline)   pd.timeline.render(h.timeline, data, facet);
                if (pd.newspapers) pd.newspapers.render(h.newspapers, data, facet, ctx);
                if (pd.countries)  pd.countries.render(h.countries, data, facet);
                if (pd.network)    pd.network.render(h.network, data, facet, ctx);
                if (pd.map)        pd.map.render(h.map, data, facet, ctx);
            })
            .catch(function (err) {
                console.error('IWACVis person dashboard:', err);
                var loading = container.querySelector('.iwac-vis-person__loading');
                if (loading) loading.remove();
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis person dashboard: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-person');
        for (var i = 0; i < containers.length; i++) {
            initDashboard(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
