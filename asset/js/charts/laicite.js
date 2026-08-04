/**
 * IWAC Visualizations — Laïcité block (orchestrator, issue #14)
 *
 * A dossier on secularism across the whole IWAC corpus, in four views:
 *
 *   - overview     KPIs, the tag-vs-text Venn, the per-corpus table,
 *                  the rights note and the frame legend
 *   - trends       annotated timeline, scoped globally / by country / by corpus
 *   - documents    the primary-source dossier
 *   - concordance  KWIC lines, lazy-loaded per corpus
 *
 * Data strategy: the four small bundles (metadata, trends, documents,
 * countries) plus the committed events sidecar load up front — about 60 KB
 * together. The concordance index is small too; the per-corpus KWIC bundles
 * are fetched only when that view first activates, and only for the corpus
 * being browsed.
 *
 * Missing files resolve to null so the block degrades gracefully on deploys
 * whose data predates them.
 *
 * Dependencies (in load order before this file):
 *   echarts → iwac-i18n.js → iwac-theme.js → dashboard-core.js → panels.js →
 *   pagination.js → facet-buttons.js → annotated-timeline.js →
 *   concordance.js → laicite/{i18n,helpers,overview,trends,documents,
 *   concordance,controls}.js
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis.laicite: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite || {};

    var DATA_FILES = {
        metadata:    'laicite-metadata.json',
        trends:      'laicite-trends.json',
        documents:   'laicite-documents.json',
        countries:   'laicite-countries.json',
        events:      'laicite-events.json',
        concordance: 'laicite-concordance.json'
    };

    P.bootBlock({
        selector:       '.iwac-vis-laicite',
        warnLabel:      'IWACVis.laicite',
        requireECharts: true,
        load: function (ctx) {
            function optional(name) {
                return P.fetchJSON(ctx.dataBase + DATA_FILES[name])
                    .catch(function () { return null; });
            }
            return Promise.all([
                P.fetchJSON(ctx.dataBase + DATA_FILES.metadata),
                optional('trends'),
                optional('documents'),
                optional('countries'),
                optional('events'),
                optional('concordance')
            ]);
        },
        render: function (container, results, ctx) {
            render(container, {
                metadata:    results[0],
                trends:      results[1],
                documents:   results[2],
                countries:   results[3],
                events:      results[4],
                concordance: results[5]
            }, ctx);
        }
    });

    // ---------------------------------------------------------------------
    //  Layout
    // ---------------------------------------------------------------------

    function render(container, bundle, ctx) {
        var metadata = bundle.metadata || {};
        var trends = bundle.trends;
        var events = bundle.events;
        var siteBase = container.dataset.siteBase
            || container.dataset.embedBase || '';

        var frames = metadata.frame_order || [];
        var frameColors = L.buildFrameColorMap(frames);

        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-laicite-root');
        container.appendChild(root);

        // 1. Header
        var header = P.el('div', 'iwac-vis-block-header iwac-vis-laicite-header');
        header.appendChild(P.el('h3', 'iwac-vis-block-header__title',
            P.t('laicite.title')));
        header.appendChild(P.el('p', 'iwac-vis-block-header__desc',
            P.t('laicite.description')));
        root.appendChild(header);

        // 2. KPI row + authority link
        root.appendChild(L.buildMetricCards(metadata));
        var authority = L.buildAuthorityLink(metadata, siteBase);
        if (authority) root.appendChild(authority);

        // 3. Controls
        var controlsEl = P.el('div', 'iwac-vis-laicite-controls');
        root.appendChild(controlsEl);

        // 4. View host — one container per view, shown one at a time.
        var viewHost = P.el('div', 'iwac-vis-laicite-viewhost');
        root.appendChild(viewHost);

        var chartPanel = P.el('div', 'iwac-vis-panel iwac-vis-laicite-chart-panel');
        var chartTitle = P.el('h4', 'iwac-vis-laicite-chart-title');
        chartPanel.appendChild(chartTitle);
        var chartEl = P.el('div', 'iwac-vis-chart iwac-vis-laicite-chart');
        chartPanel.appendChild(chartEl);
        var detailsHost = P.el('div', 'iwac-vis-laicite-details-host');
        chartPanel.appendChild(detailsHost);

        var state = {
            view: 'overview',
            trendsCountry: null,
            trendsSubset: null,
            showEvents: true,
            kwicSubset: 'articles',
            kwicFrame: '',
            kwicCountry: '',
            kwicQuery: ''
        };

        var concordance = L.createConcordance({
            index: bundle.concordance,
            metadata: metadata,
            dataBase: ctx.dataBase,
            siteBase: siteBase,
            state: state
        });

        // Default the concordance to the first corpus that actually has rows,
        // so the view never opens on an empty list.
        var available = concordance.availableSubsets();
        if (available.length && available.indexOf(state.kwicSubset) === -1) {
            state.kwicSubset = available[0];
        }

        // The timeline chart is the only ECharts instance in this block.
        // dashboard-core disposes and re-inits it on every theme swap, so we
        // capture the new instance here rather than closing over the first —
        // otherwise draw() would setOption on a disposed chart after the
        // first light/dark toggle and the chart would go blank.
        var currentInstance = null;
        ns.registerChart(chartEl, function (el, instance) {
            currentInstance = instance;
            if (state.view === 'trends') drawTrends();
        });

        var controls = L.createControls({
            controlsEl: controlsEl,
            state: state,
            metadata: metadata,
            countries: metadata.countries || [],
            trendsCountries: trends && trends.by_country
                ? Object.keys(trends.by_country).sort() : [],
            draw: draw,
            getConcordanceSubsets: function () {
                return concordance.availableSubsets();
            },
            getConcordanceCountries: function (subset) {
                return concordance.countriesFor(subset);
            }
        });

        function drawTrends() {
            if (!currentInstance || currentInstance.isDisposed()) return;
            detailsHost.innerHTML = '';
            chartTitle.textContent = L.trendsTitle(state);
            if (!trends) {
                currentInstance.setOption(
                    P.emptyChartOption('Visualization data is not available yet.'),
                    { notMerge: true });
                return;
            }
            var option = L.buildTrendsOption({
                trends: trends,
                metadata: metadata,
                events: events,
                state: state,
                frameColors: frameColors,
                compact: chartEl.clientWidth > 0 && chartEl.clientWidth < 600
            });
            currentInstance.setOption(option, { notMerge: true, lazyUpdate: true });
            if (events) {
                var details = L.buildEventsDetails(events, state, siteBase);
                if (details) detailsHost.appendChild(details);
            }
        }

        function draw() {
            viewHost.innerHTML = '';
            if (state.view === 'overview') {
                viewHost.appendChild(L.buildVenn(metadata, function (cell) {
                    // "Tagged, never says it" has no concordance lines by
                    // definition — those items carry no text match — so the
                    // Venn only routes the two cells that do.
                    if (cell === 'tagged_only') return;
                    state.view = 'concordance';
                    controls.render();
                    draw();
                }));
                viewHost.appendChild(L.buildSubsetTable(metadata));
                viewHost.appendChild(L.buildRightsNote(metadata));
                viewHost.appendChild(L.buildFrameLegend(metadata, frameColors));
            } else if (state.view === 'trends') {
                viewHost.appendChild(chartPanel);
                drawTrends();
                if (currentInstance && !currentInstance.isDisposed()) {
                    // The host was display:none until this view activated.
                    window.setTimeout(function () {
                        if (currentInstance && !currentInstance.isDisposed()) {
                            currentInstance.resize();
                        }
                    }, 0);
                }
            } else if (state.view === 'documents') {
                viewHost.appendChild(L.buildDocumentDossier(
                    bundle.documents, metadata, {
                        siteBase: siteBase,
                        frameColors: frameColors,
                        onFocusYear: function (year, country) {
                            state.view = 'trends';
                            if (country) {
                                state.trendsCountry = country;
                                state.trendsSubset = null;
                            }
                            controls.render();
                            draw();
                            void year;
                        }
                    }));
            } else if (state.view === 'concordance') {
                viewHost.appendChild(concordance.host);
                concordance.render();
            }
        }

        controls.render();
        draw();
    }
})();
