/**
 * IWAC Visualizations — Entity Dashboard block (orchestrator)
 *
 * Drives the dashboard for non-person entities (Lieux, Organisations,
 * Sujets, Événements). Fetches asset/data/entity-dashboards/{o_id}.json,
 * builds a layout WITHOUT the role facet bar, and delegates each
 * panel render to the existing IWACVis.personDashboard panel modules.
 *
 * The precompute script (generate_entity_dashboards.py) wraps every
 * section in `by_role.all` precisely so we can pass a no-op facet
 * here and reuse the person panel modules verbatim — no fork, no
 * duplicate JS, just a thin orchestrator that omits the facet UI.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis entity dashboard: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;

    /**
     * No-op facet that always returns 'all'. Matches the interface the
     * person panel modules expect (role / subscribe / set) but never
     * fires updates because non-person dashboards have a single view.
     */
    function createNoopFacet() {
        return {
            role: 'all',
            subscribe: function () {},
            set: function () {}
        };
    }

    // Whether the given precompute slice has any data at all. Empty
    // slices are elided from the layout so entities with zero AI
    // sentiment / LDA / newspaper coverage don't show dead cards.
    function hasNewspapersData(data) {
        var all = data && data.newspapers && data.newspapers.by_role && data.newspapers.by_role.all;
        return !!(all && all.length > 0);
    }
    function hasTopicsData(data) {
        var all = data && data.topics && data.topics.by_role && data.topics.by_role.all;
        return !!(all && all.length > 0);
    }
    function hasSentimentData(data) {
        var all = data && data.sentiment && data.sentiment.by_role && data.sentiment.by_role.all;
        if (!all || !all.by_model) return false;
        var models = all.models || Object.keys(all.by_model);
        for (var i = 0; i < models.length; i++) {
            var m = all.by_model[models[i]];
            if (m && m.polarite && m.polarite.length > 0) return true;
        }
        return false;
    }

    function buildLayout(container, data) {
        var loading = container.querySelector('.iwac-vis-entity__loading');
        if (loading) loading.remove();

        var body = P.el('div', 'iwac-vis-entity__body');
        container.appendChild(body);

        // Summary stats row
        var statsHost = P.el('div', 'iwac-vis-entity__stats');
        body.appendChild(statsHost);

        // Charts grid (no facet bar — non-person entities have a single view)
        var grid = P.buildChartsGrid();
        grid.classList.add('iwac-vis-entity__grid');
        body.appendChild(grid);

        var timelinePanel     = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Mentions'),               P.t('desc_entity_mentions_timeline'));
        var heatmapPanel      = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Year × month heatmap'),   P.t('desc_year_month_heatmap'));
        var newspapersPanel   = hasNewspapersData(data)
            ? P.buildPanel('iwac-vis-panel',                      P.t('Top newspapers'),         P.t('desc_entity_top_newspapers'))
            : null;
        var countriesPanel    = P.buildPanel('iwac-vis-panel',                      P.t('Countries covered'),      P.t('desc_entity_countries_covered'));
        var topicsPanel       = hasTopicsData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Top LDA topics'),         P.t('desc_lda_topics'))
            : null;
        var sentimentPanel    = hasSentimentData(data)
            ? P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('AI sentiment'),           P.t('desc_ai_sentiment'))
            : null;
        var networkPanel      = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Associated entities'),    P.t('desc_entity_associated_entities'));
        var cooccurrencePanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Subject co-occurrence'),  P.t('desc_subject_cooccurrence'));
        var mapPanel          = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Associated locations'),   P.t('desc_entity_associated_locations'));

        [timelinePanel, heatmapPanel, newspapersPanel, countriesPanel,
         topicsPanel, sentimentPanel, networkPanel, cooccurrencePanel, mapPanel]
            .forEach(function (p) { if (p) grid.appendChild(p.panel); });

        return {
            stats: statsHost,
            timeline: timelinePanel,
            heatmap: heatmapPanel,
            newspapers: newspapersPanel,
            countries: countriesPanel,
            topics: topicsPanel,
            sentiment: sentimentPanel,
            network: networkPanel,
            cooccurrence: cooccurrencePanel,
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
        var url = ctx.basePath + '/modules/IwacVisualizations/asset/data/entity-dashboards/' + itemId + '.json';

        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var pd = ns.personDashboard || {};
                var facet = createNoopFacet();
                var h = buildLayout(container, data);

                if (pd.stats)                      pd.stats.render(h.stats, data, facet);
                if (pd.timeline)                   pd.timeline.render(h.timeline, data, facet);
                if (pd.heatmap)                    pd.heatmap.render(h.heatmap, data, facet);
                if (pd.newspapers && h.newspapers) pd.newspapers.render(h.newspapers, data, facet, ctx);
                if (pd.countries)                  pd.countries.render(h.countries, data, facet);
                if (pd.topics && h.topics)         pd.topics.render(h.topics, data, facet);
                if (pd.sentiment && h.sentiment)   pd.sentiment.render(h.sentiment, data, facet);
                if (pd.network)                    pd.network.render(h.network, data, facet, ctx);
                if (pd.cooccurrence)               pd.cooccurrence.render(h.cooccurrence, data, facet);
                if (pd.map)                        pd.map.render(h.map, data, facet, ctx);
            })
            .catch(function (err) {
                console.error('IWACVis entity dashboard:', err);
                var loading = container.querySelector('.iwac-vis-entity__loading');
                if (loading) loading.remove();
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis entity dashboard: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-entity');
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
