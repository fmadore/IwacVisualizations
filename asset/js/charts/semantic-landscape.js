/**
 * IWAC Visualizations — Semantic Landscape page block (orchestrator)
 *
 * The "map of everything": a 2-D UMAP projection of every article's
 * 768-dim Gemini `embedding_OCR`, precomputed by
 * `scripts/generate_semantic_landscape.py` into one columnar bundle
 * (`asset/data/semantic-landscape.json`). Nearby points are articles
 * whose full text is semantically similar; clusters are themes.
 *
 * UI:
 *   - "Color by" facet — Country / Decade / Topic (top-N LDA topics,
 *     long tail folded into "Other"). Each category renders as its own
 *     scatter series so the theme palette + legend toggling come free.
 *   - Pan/zoom via inside dataZoom on both axes; axes themselves are
 *     hidden (UMAP coordinates are meaningless — only proximity
 *     matters, which the description says plainly).
 *   - Tooltip: title · country · year · topic. Click → article page.
 *
 * Perf: one scatter point per article (~12k). Series use progressive
 * rendering; opacity blending keeps dense clusters readable. The
 * bundle is the heaviest single JSON in the module (titles dominate),
 * but the block lazy-loads on-view like everything else.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis semantic landscape: missing panels — check script load order');
        return;
    }
    var P = ns.panels;

    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Loading semantic landscape': 'Loading semantic landscape',
            'Semantic landscape': 'Semantic landscape',
            'desc_semantic_landscape': 'Every article in the collection, placed by the semantic similarity of its full text (UMAP projection of AI text embeddings — axes have no meaning, only proximity does). Drag to pan, scroll to zoom, click a point to open the article.',
            'Color by': 'Color by',
            'Decade': 'Decade',
            'Topic': 'Topic',
            'Other': 'Other',
            'Unknown year': 'Unknown year',
            'landscape_points': '{count} articles placed'
        });
        ns.addTranslations('fr', {
            'Loading semantic landscape': 'Chargement du paysage sémantique',
            'Semantic landscape': 'Paysage sémantique',
            'desc_semantic_landscape': 'Chaque article de la collection, positionné selon la similarité sémantique de son texte intégral (projection UMAP des plongements de texte IA — les axes n’ont pas de sens, seule la proximité compte). Glissez pour déplacer, molette pour zoomer, cliquez sur un point pour ouvrir l’article.',
            'Color by': 'Colorer par',
            'Decade': 'Décennie',
            'Topic': 'Thème',
            'Other': 'Autre',
            'Unknown year': 'Année inconnue',
            'landscape_points': '{count} articles positionnés'
        });
    }

    var ALL_FACETS = ['country', 'decade', 'topic'];

    /** Group point indices into named buckets for the active facet. */
    function buildGroups(data, facet) {
        var pts = data.points || {};
        var n = (pts.o_id || []).length;
        var groups = {};   // name -> [indices]
        var order = [];    // bucket display order

        function push(name, i) {
            if (!groups[name]) {
                groups[name] = [];
                order.push(name);
            }
            groups[name].push(i);
        }

        var i;
        if (facet === 'country') {
            var countries = data.countries || [];
            for (i = 0; i < n; i++) {
                var c = pts.country[i];
                push(c >= 0 ? countries[c] : P.t('Other'), i);
            }
            order.sort();
        } else if (facet === 'decade') {
            for (i = 0; i < n; i++) {
                var y = pts.year[i];
                push(y ? (Math.floor(y / 10) * 10) + 's' : P.t('Unknown year'), i);
            }
            order.sort();
        } else { // topic
            var topics = data.topics || [];
            for (i = 0; i < n; i++) {
                var t = pts.topic[i];
                push(t >= 0 ? topics[t].label : P.t('Other'), i);
            }
            // Keep generator order (by topic size), "Other" last.
            order.sort(function (a, b) {
                var oa = a === P.t('Other') ? 1 : 0;
                var ob = b === P.t('Other') ? 1 : 0;
                return oa - ob;
            });
        }
        return { groups: groups, order: order };
    }

    function buildOption(data, facet) {
        var pts = data.points;
        var grouped = buildGroups(data, facet);
        var topics = data.topics || [];
        var countries = data.countries || [];

        var series = grouped.order.map(function (name) {
            return {
                name: name,
                type: 'scatter',
                symbolSize: 4,
                progressive: 2500,
                progressiveThreshold: 3000,
                itemStyle: { opacity: 0.6 },
                emphasis: { itemStyle: { opacity: 1 } },
                // [x, y, point-index] — the index feeds tooltip + click.
                data: grouped.groups[name].map(function (i) {
                    return [pts.x[i], pts.y[i], i];
                })
            };
        });

        return {
            legend: {
                type: 'scroll',
                bottom: 0,
                itemWidth: 12,
                itemHeight: 10
            },
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    var i = p.data[2];
                    var bits = [];
                    var c = pts.country[i];
                    if (c >= 0) bits.push(countries[c]);
                    if (pts.year[i]) bits.push(String(pts.year[i]));
                    var t = pts.topic[i];
                    if (t >= 0) bits.push(topics[t].label);
                    return '<strong>' + P.escapeHtml(pts.title[i] || '') + '</strong>'
                        + (bits.length ? '<br>' + P.escapeHtml(bits.join(' · ')) : '');
                }
            },
            grid: { left: 8, right: 8, top: 8, bottom: 36 },
            xAxis: {
                type: 'value', scale: true,
                show: false
            },
            yAxis: {
                type: 'value', scale: true,
                show: false
            },
            dataZoom: [
                { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
                { type: 'inside', yAxisIndex: 0, filterMode: 'none' }
            ],
            series: series,
            animation: false
        };
    }

    function initBlock(container) {
        var basePath = container.dataset.basePath || '';
        var siteBase = container.dataset.siteBase || '';
        var url = basePath + '/modules/IwacVisualizations/asset/data/semantic-landscape.json';

        P.fetchJSON(url)
            .then(function (data) {
                container.innerHTML = '';

                var root = P.el('div', 'iwac-vis-overview-root iwac-vis-landscape-root');
                container.appendChild(root);

                var panel = P.buildPanel(
                    'iwac-vis-panel iwac-vis-panel--wide',
                    P.t('Semantic landscape'),
                    P.t('desc_semantic_landscape')
                );
                // The landscape needs height — reuse the graph-host
                // reservation (640px) instead of the default 320px.
                panel.chart.classList.add('iwac-vis-graph-host');
                root.appendChild(panel.panel);

                var count = ((data.points || {}).o_id || []).length;
                var caption = P.el('p', 'iwac-vis-overview-subtitle',
                    P.t('landscape_points', { count: P.formatNumber(count) }));
                panel.panel.insertBefore(caption, panel.chart);

                var state = { facet: 'country' };
                var facetBar = P.buildFacetButtons({
                    facets: [{
                        key: 'facet',
                        label: P.t('Color by'),
                        subFacets: {
                            country: P.t('Country'),
                            decade:  P.t('Decade'),
                            topic:   P.t('Topic')
                        },
                        renderAs: 'buttons'
                    }],
                    activeKey: 'facet',
                    onChange: function (evt) {
                        var f = evt.subFacet || 'country';
                        if (ALL_FACETS.indexOf(f) === -1) f = 'country';
                        state.facet = f;
                        if (chart && !chart.isDisposed()) {
                            chart.setOption(buildOption(data, state.facet), true);
                        }
                    }
                });
                panel.panel.insertBefore(facetBar.root, panel.chart);

                var chart = ns.registerChart(panel.chart, function (el, instance) {
                    instance.setOption(buildOption(data, state.facet), true);
                });

                if (chart && siteBase) {
                    chart.on('click', function (params) {
                        var i = params.data && params.data[2];
                        if (i == null) return;
                        var oId = data.points.o_id[i];
                        if (oId != null) {
                            window.location.href = siteBase + '/item/' + oId;
                        }
                    });
                }
            })
            .catch(function (err) {
                console.error('IWACVis semantic landscape:', err);
                container.innerHTML = '';
                container.appendChild(P.buildErrorState());
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis semantic landscape: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-semantic-landscape');
        for (var i = 0; i < containers.length; i++) {
            initBlock(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
