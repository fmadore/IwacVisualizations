/**
 * IWAC Visualizations — Press Reprints page block (orchestrator)
 *
 * Near-duplicate article pairs across different newspapers (ROADMAP
 * 9.9): syndicated wire copy, shared communiqués, straight reprints.
 * Loads `press-reprints.json` (built by `scripts/generate_reprints.py`
 * via embedding cosine similarity — see the AI-provenance note in the
 * block description) and renders:
 *
 *   - summary cards — published pairs, newspapers involved, median
 *     day gap, articles scanned
 *   - circulation network — newspapers as nodes (country-colored),
 *     edge width = number of shared texts
 *   - the pair table — similarity, day gap, both articles linked to
 *     their IWAC items
 *
 * Load order: after shared/panels.js + chart-options*.js + table.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis press reprints: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Loading press reprints':  'Loading press reprints',
            'reprints.title':          'Possible press reprints and shared copy',
            'reprints.description':    'Pairs of articles from different newspapers with highly similar AI representations of their full texts. These matches may identify agency dispatches, shared communiqués or reprints, but can also reflect similar subject matter. The software compares text representations, not identical wording. Read both articles before concluding that a text was copied or identifying a source.',
            'reprints.card_pairs':     'Candidate article pairs',
            'reprints.card_papers':    'Newspapers involved',
            'reprints.card_gap':       'Median gap (days)',
            'reprints.card_scanned':   'Articles compared',
            'reprints.network_title':  'Circulation network',
            'reprints.network_desc':   'Each point is a newspaper. Thicker lines indicate more candidate article pairs shared by two newspapers; larger points indicate involvement in more pairs. Colours show the newspaper’s country. The same article can occur in several pairs, and links do not show a direction of copying.',
            'reprints.network_tip':    '{a} ↔ {b}: {n} candidate pairs',
            'reprints.node_tip':       '{name}: {n} candidate pairs',
            'reprints.table_title':    'Candidate article pairs',
            'reprints.table_desc':     'Candidate pairs ranked by similarity score. The score is expressed as a percentage, not a probability of copying. Publication-date gaps can help investigate circulation, but do not distinguish agency dispatches from reprints on their own.',
            'reprints.col_sim':        'Similarity',
            'reprints.col_gap':        'Gap (days)',
            'reprints.col_article_a':  'Article A',
            'reprints.col_paper_a':    'Newspaper A',
            'reprints.col_article_b':  'Article B',
            'reprints.col_paper_b':    'Newspaper B',
            'reprints.truncated':      'Showing the {n} highest-scoring pairs. Additional pairs above the matching threshold are omitted from this view.'
        });
        ns.addTranslations('fr', {
            'Loading press reprints':  'Chargement des reprises de presse',
            'reprints.title':          'Reprises de presse et textes communs possibles',
            'reprints.description':    'Paires d’articles de journaux différents dont les représentations des textes intégraux produites par IA sont très similaires. Ces rapprochements peuvent signaler des dépêches d’agence, des communiqués communs ou des reprises, mais aussi des sujets proches. Le logiciel compare des représentations textuelles, sans vérifier que les formulations sont identiques. Lisez les deux articles avant de conclure à une reprise ou d’en identifier la source.',
            'reprints.card_pairs':     'Paires d’articles candidates',
            'reprints.card_papers':    'Journaux concernés',
            'reprints.card_gap':       'Écart médian (jours)',
            'reprints.card_scanned':   'Articles comparés',
            'reprints.network_title':  'Réseau de circulation',
            'reprints.network_desc':   'Chaque point correspond à un journal. Les lignes épaisses indiquent davantage de paires d’articles candidates entre deux journaux ; les grands points indiquent une participation à davantage de paires. Les couleurs indiquent le pays du journal. Un article peut figurer dans plusieurs paires et les liens n’indiquent pas le sens d’une reprise.',
            'reprints.network_tip':    '{a} ↔ {b} : {n} paires candidates',
            'reprints.node_tip':       '{name} : {n} paires candidates',
            'reprints.table_title':    'Paires d’articles candidates',
            'reprints.table_desc':     'Paires candidates classées par score de similarité. Le score est exprimé en pourcentage et ne donne pas une probabilité de reprise. L’écart entre les dates de publication aide à étudier la circulation, mais ne suffit pas à distinguer une dépêche d’agence d’une reprise.',
            'reprints.col_sim':        'Similarité',
            'reprints.col_gap':        'Écart (jours)',
            'reprints.col_article_a':  'Article A',
            'reprints.col_paper_a':    'Journal A',
            'reprints.col_article_b':  'Article B',
            'reprints.col_paper_b':    'Journal B',
            'reprints.truncated':      'Affichage des {n} paires aux scores les plus élevés. D’autres paires dépassant le seuil de similarité sont omises de cette vue.'
        });
    }

    function buildLayout(container, data, ctx) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root iwac-vis-reprints-root');
        container.appendChild(root);

        var header = P.el('div', 'iwac-vis-block-header iwac-vis-reprints-header');
        header.appendChild(P.el('h3', 'iwac-vis-block-header__title', P.t('reprints.title')));
        header.appendChild(P.el('p', 'iwac-vis-block-header__desc',
            P.t('reprints.description')));
        root.appendChild(header);

        var s = data.stats || {};
        root.appendChild(P.buildSummaryCards([
            { value: s.published_pairs,           labelKey: 'reprints.card_pairs' },
            { value: s.newspapers_involved,       labelKey: 'reprints.card_papers' },
            { value: s.median_day_gap,            labelKey: 'reprints.card_gap' },
            { value: s.articles_with_embeddings,  labelKey: 'reprints.card_scanned' }
        ]));

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var networkPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-reprints-network',
            P.t('reprints.network_title'), P.t('reprints.network_desc'));
        grid.appendChild(networkPanel.panel);

        var tablePanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('reprints.table_title'), P.t('reprints.table_desc'));
        grid.appendChild(tablePanel.panel);

        renderNetwork(networkPanel, data);
        renderTable(tablePanel, data, ctx);
    }

    /* --------------------------------------------------------------- */
    /*  Circulation network — newspapers as nodes, shared-text edges     */
    /* --------------------------------------------------------------- */

    function renderNetwork(panel, data) {
        var papers = data.newspapers || [];
        var links = data.links || [];
        if (!papers.length || !links.length) {
            panel.chart.appendChild(P.buildEmptyState());
            return;
        }
        var maxPairs = Math.max.apply(null, papers.map(function (p) { return p.pairs || 1; }));
        var maxLink = Math.max.apply(null, links.map(function (l) { return l[2] || 1; }));

        // The shared graph toolbar replaces the generic panel toolbar.
        if (panel.panel && panel.panel.setAttribute) {
            panel.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        }

        var chart = ns.registerChart(panel.chart, function (el, chart) {
            var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
            var nodes = papers.map(function (p) {
                return {
                    id: p.name,
                    name: p.name,
                    value: p.pairs,
                    symbolSize: 12 + Math.sqrt((p.pairs || 1) / maxPairs) * 30,
                    itemStyle: { color: C._countryColor(p.country || '') },
                    label: { show: true, position: 'right', fontSize: 11 }
                };
            });
            var edges = links.map(function (l) {
                return {
                    source: l[0],
                    target: l[1],
                    value: l[2],
                    lineStyle: {
                        width: 1 + (l[2] / maxLink) * 6,
                        color: tokens.border || '#d4d6da',
                        curveness: 0.15
                    }
                };
            });
            chart.setOption({
                tooltip: {
                    confine: true,
                    formatter: function (p) {
                        if (p.dataType === 'edge') {
                            return P.t('reprints.network_tip', {
                                a: P.escapeHtml(p.data.source),
                                b: P.escapeHtml(p.data.target),
                                n: P.formatNumber(p.data.value || 0)
                            });
                        }
                        return P.t('reprints.node_tip', {
                            name: P.escapeHtml(p.data.name || ''),
                            n: P.formatNumber(p.data.value || 0)
                        });
                    }
                },
                series: [Object.assign(
                    // The shared frozen-force skeleton owns the circular
                    // seed + layoutAnimation:false pairing (load-bearing —
                    // see C._forceGraphBase).
                    C._forceGraphBase({ gravity: 0.1 }),
                    {
                        data: nodes,
                        links: edges,
                        emphasis: {
                            focus: 'adjacency',
                            lineStyle: { width: 8 }
                        }
                    }
                )]
            }, true);
        });

        // Shared graph chrome (zoom / reset / PNG download / fullscreen);
        // no legend toggle — this graph has no legend — and no
        // click-through: nodes are newspapers, not linkable items.
        if (chart) {
            P.buildGraphPanelToolbar(panel, chart, {
                downloadName: 'iwac-press-reprints-network.png',
                legendToggle: false
            });
        }
    }

    /* --------------------------------------------------------------- */
    /*  Pair table                                                       */
    /* --------------------------------------------------------------- */

    function renderTable(panel, data, ctx) {
        var pairs = data.pairs || [];
        if (!pairs.length) {
            panel.chart.appendChild(P.buildEmptyState());
            return;
        }
        var rows = pairs.map(function (p) {
            return {
                // Pre-formatted: the shared number renderer would show a
                // missing day gap as "0", which reads as same-day.
                sim: (p.similarity != null) ? p.similarity.toFixed(3) : '',
                gap: (p.day_gap != null) ? String(p.day_gap) : '—',
                titleA: p.a.title || ('#' + p.a.o_id),
                hrefA: ctx.siteBase ? ctx.siteBase + '/item/' + p.a.o_id : null,
                paperA: p.a.newspaper,
                titleB: p.b.title || ('#' + p.b.o_id),
                hrefB: ctx.siteBase ? ctx.siteBase + '/item/' + p.b.o_id : null,
                paperB: p.b.newspaper
            };
        });
        var table = P.buildTable({
            columns: [
                { key: 'sim',    label: P.t('reprints.col_sim'),       width: '6rem' },
                { key: 'gap',    label: P.t('reprints.col_gap'),       width: '6rem' },
                // Both articles are labelled lines of their own: the pair is
                // the finding, so promoting one of them to the record's
                // headline would state a precedence the data does not have.
                { key: 'titleA', label: P.t('reprints.col_article_a'), render: 'link', linkKey: 'hrefA', card: 'row' },
                { key: 'paperA', label: P.t('reprints.col_paper_a') },
                { key: 'titleB', label: P.t('reprints.col_article_b'), render: 'link', linkKey: 'hrefB', card: 'row' },
                { key: 'paperB', label: P.t('reprints.col_paper_b') }
            ],
            rows: rows,
            pageSize: 10
        });
        panel.chart.classList.add('iwac-vis-reprints-tablehost');
        panel.chart.appendChild(table.root);
        if (data.truncated) {
            panel.panel.appendChild(P.el('p', 'iwac-vis-reprints-note',
                P.t('reprints.truncated', { n: P.formatNumber(pairs.length) })));
        }
    }

    P.bootBlock({
        selector:       '.iwac-vis-reprints',
        warnLabel:      'IWACVis press reprints',
        requireECharts: true,
        dataFile:       'press-reprints.json',
        render:         buildLayout
    });
})();
