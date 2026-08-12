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
            'reprints.title':          'Press reprints and wire copy',
            'reprints.description':    'Pairs of articles from different newspapers whose text is almost the same: the traces of press-agency dispatches (PANA, AFP), shared communiqués, and outright reprints passing between titles. The pairing is done by software that measures how closely two articles are worded, and a very close match usually means one was copied from the other, or that both ran the same agency dispatch. Because a computer proposes these matches rather than a person confirming them, treat each pair as a lead to check rather than a settled fact.',
            'reprints.card_pairs':     'Reprint pairs',
            'reprints.card_papers':    'Newspapers involved',
            'reprints.card_gap':       'Median gap (days)',
            'reprints.card_scanned':   'Articles compared',
            'reprints.network_title':  'Circulation network',
            'reprints.network_desc':   'The thicker the line, the more near-identical texts the two outlets share. Node size is the outlet’s total, and the colours follow the outlet’s country.',
            'reprints.network_tip':    '{a} ↔ {b}: {n} shared texts',
            'reprints.node_tip':       '{name}: {n} shared texts',
            'reprints.table_title':    'Reprint pairs',
            'reprints.table_desc':     'Sorted by similarity. A gap of 0–2 days is the signature of wire copy, while longer gaps suggest a deliberate reprint.',
            'reprints.col_sim':        'Similarity',
            'reprints.col_gap':        'Gap (days)',
            'reprints.col_article_a':  'Article A',
            'reprints.col_paper_a':    'Newspaper A',
            'reprints.col_article_b':  'Article B',
            'reprints.col_paper_b':    'Newspaper B',
            'reprints.truncated':      'Showing the {n} strongest pairs; the full set continues below the threshold.'
        });
        ns.addTranslations('fr', {
            'Loading press reprints':  'Chargement des reprises de presse',
            'reprints.title':          'Reprises de presse et dépêches',
            'reprints.description':    'Des paires d\u2019articles de journaux diff\u00e9rents dont le texte est presque identique : les traces de d\u00e9p\u00eaches d\u2019agence (PANA, AFP), de communiqu\u00e9s partag\u00e9s et de reprises passant d\u2019un titre \u00e0 l\u2019autre. L\u2019appariement est r\u00e9alis\u00e9 par un logiciel qui mesure \u00e0 quel point deux articles sont r\u00e9dig\u00e9s de la m\u00eame fa\u00e7on, et une correspondance tr\u00e8s proche signifie g\u00e9n\u00e9ralement que l\u2019un a \u00e9t\u00e9 copi\u00e9 sur l\u2019autre, ou que les deux reprennent la m\u00eame d\u00e9p\u00eache d\u2019agence. Comme ces rapprochements sont propos\u00e9s par un ordinateur plut\u00f4t que confirm\u00e9s par une personne, consid\u00e9rez chaque paire comme une piste \u00e0 v\u00e9rifier plut\u00f4t que comme un fait \u00e9tabli.',
            'reprints.card_pairs':     'Paires de reprises',
            'reprints.card_papers':    'Journaux concernés',
            'reprints.card_gap':       'Écart médian (jours)',
            'reprints.card_scanned':   'Articles comparés',
            'reprints.network_title':  'Réseau de circulation',
            'reprints.network_desc':   'Plus le lien est \u00e9pais, plus les deux journaux partagent de textes quasi identiques. La taille du n\u0153ud correspond au total du journal et les couleurs suivent son pays.',
            'reprints.network_tip':    '{a} ↔ {b} : {n} textes partagés',
            'reprints.node_tip':       '{name} : {n} textes partagés',
            'reprints.table_title':    'Paires de reprises',
            'reprints.table_desc':     'Tri\u00e9es par similarit\u00e9. Un \u00e9cart de 0 \u00e0 2 jours est la signature des d\u00e9p\u00eaches d\u2019agence, tandis qu\u2019un \u00e9cart plus long sugg\u00e8re une reprise d\u00e9lib\u00e9r\u00e9e.',
            'reprints.col_sim':        'Similarité',
            'reprints.col_gap':        'Écart (jours)',
            'reprints.col_article_a':  'Article A',
            'reprints.col_paper_a':    'Journal A',
            'reprints.col_article_b':  'Article B',
            'reprints.col_paper_b':    'Journal B',
            'reprints.truncated':      'Affichage des {n} paires les plus fortes ; l\u2019ensemble continue sous le seuil.'
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
                { key: 'titleA', label: P.t('reprints.col_article_a'), render: 'link', linkKey: 'hrefA' },
                { key: 'paperA', label: P.t('reprints.col_paper_a') },
                { key: 'titleB', label: P.t('reprints.col_article_b'), render: 'link', linkKey: 'hrefB' },
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
