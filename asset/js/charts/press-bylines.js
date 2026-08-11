/**
 * IWAC Visualizations — Press Bylines page block (orchestrator)
 *
 * Who signed the West African press. Loads a single precomputed bundle
 * from `asset/data/press-bylines.json` (built by
 * `scripts/generate_press_bylines.py` — byline coverage verified at
 * ~79 % of the articles subset) and renders:
 *
 *   - summary cards — signed articles, share signed, distinct bylines,
 *     prolific bylines
 *   - "Signed articles over time" — the share of each year's articles
 *     carrying a byline (the remainder ran unsigned)
 *   - "Most prolific bylines" — top-N bar; journalists AND press
 *     agencies. Bars click through to the byline's Personnes authority
 *     record where the generator resolved one (24 of the top 25 do);
 *     the tooltip carries active span, newspapers and frequent subjects.
 *
 * Load order: after shared/panels.js + shared/chart-options*.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis press bylines: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Loading press bylines':  'Loading press bylines',
            'bylines.card_signed':    'Signed articles',
            'bylines.card_pct':       'Share of all articles (%)',
            'bylines.card_unique':    'Distinct bylines',
            'bylines.card_prolific':  'Bylines with 10+ articles',
            'bylines.trend_title':    'Signed articles over time',
            'bylines.trend_desc':     'The share of each year’s articles carrying a byline, counting journalists and press agencies alike. The rest ran unsigned.',
            'bylines.trend_axis':     'Signed share (%)',
            'bylines.trend_tip':      '{signed} of {total} articles signed',
            'bylines.top_title':      'Most prolific bylines',
            'bylines.top_desc':       'The {n} most frequent bylines across the corpus, journalists and press agencies alike. Click a bar to open the byline’s authority record where one exists.',
            'bylines.active':         'Active {first}–{last}',
            'bylines.papers':         'Newspapers',
            'bylines.topics':         'Frequent subjects'
        });
        ns.addTranslations('fr', {
            'Loading press bylines':  'Chargement des signatures de presse',
            'bylines.card_signed':    'Articles signés',
            'bylines.card_pct':       'Part de tous les articles (%)',
            'bylines.card_unique':    'Signatures distinctes',
            'bylines.card_prolific':  'Signatures avec 10 articles ou plus',
            'bylines.trend_title':    'Articles signés au fil du temps',
            'bylines.trend_desc':     'Part des articles de chaque année portant une signature — journalistes comme agences de presse. Le reste a paru non signé.',
            'bylines.trend_axis':     'Part signée (%)',
            'bylines.trend_tip':      '{signed} articles signés sur {total}',
            'bylines.top_title':      'Signatures les plus prolifiques',
            'bylines.top_desc':       'Les {n} signatures les plus fréquentes du corpus — journalistes et agences de presse. Cliquez sur une barre pour ouvrir la notice d’autorité quand elle existe.',
            'bylines.active':         'En activité {first}–{last}',
            'bylines.papers':         'Journaux',
            'bylines.topics':         'Sujets fréquents'
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Signed-share trend                                                */
    /* ----------------------------------------------------------------- */

    function renderTrend(panel, byYear) {
        var years = byYear.years || [];
        var total = byYear.total || [];
        var signed = byYear.signed || [];
        var pct = years.map(function (_, i) {
            return total[i] ? Math.round(1000 * (signed[i] || 0) / total[i]) / 10 : null;
        });
        var dataZoom = C._dataZoom(years.length);
        var useZoom = dataZoom.length > 0;

        ns.registerChart(panel.chart, function (el, chart) {
            chart.setOption({
                grid: C._grid({ left: 56, bottom: useZoom ? 64 : 40 }),
                tooltip: {
                    trigger: 'axis',
                    formatter: function (params) {
                        var p = params && params[0];
                        if (!p) return '';
                        var i = p.dataIndex;
                        return '<strong>' + P.escapeHtml(p.axisValue) + '</strong><br>'
                            + (p.value == null ? '—' : p.value + ' %') + '<br>'
                            + P.t('bylines.trend_tip', {
                                signed: P.formatNumber(signed[i] || 0),
                                total: P.formatNumber(total[i] || 0)
                            });
                    }
                },
                xAxis: { type: 'category', data: years, name: P.t('Year') },
                yAxis: {
                    type: 'value',
                    min: 0,
                    max: 100,
                    name: P.t('bylines.trend_axis'),
                    axisLabel: { formatter: function (v) { return v + ' %'; } }
                },
                dataZoom: dataZoom,
                series: [{
                    type: 'line',
                    data: pct,
                    symbolSize: 5,
                    connectNulls: false
                }]
            }, true);
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Most prolific bylines                                             */
    /* ----------------------------------------------------------------- */

    function renderTop(panel, rows, ctx) {
        var instance = ns.registerChart(panel.chart, function (el, chart) {
            var option = C.horizontalBar(rows, {});
            option.tooltip = {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    var p = params && params[0];
                    var row = p && rows[p.dataIndex];
                    if (!row) return '';
                    var lines = ['<strong>' + P.escapeHtml(row.name) + '</strong>'];
                    lines.push(P.t('Articles') + ': ' + P.formatNumber(row.count));
                    if (row.first && row.last) {
                        lines.push(P.t('bylines.active', { first: row.first, last: row.last }));
                    }
                    if (row.newspapers && row.newspapers.length) {
                        lines.push(P.t('bylines.papers') + ': '
                            + P.escapeHtml(row.newspapers.join(', ')));
                    }
                    if (row.subjects && row.subjects.length) {
                        lines.push(P.t('bylines.topics') + ': '
                            + P.escapeHtml(row.subjects.join(', ')));
                    }
                    return lines.join('<br>');
                }
            };
            chart.setOption(option, true);
        });
        if (instance) {
            instance.on('click', function (p) {
                var row = rows[p.dataIndex];
                if (row && row.o_id) {
                    window.location.href = (ctx.siteBase || '') + '/item/' + row.o_id;
                }
            });
        }
    }

    /* ----------------------------------------------------------------- */
    /*  Layout + bootstrap                                                */
    /* ----------------------------------------------------------------- */

    function buildLayout(container, data, ctx) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        var s = data.summary || {};
        root.appendChild(P.buildSummaryCards([
            { value: s.signed,     labelKey: 'bylines.card_signed' },
            { value: s.pct_signed, labelKey: 'bylines.card_pct' },
            { value: s.unique,     labelKey: 'bylines.card_unique' },
            { value: s.prolific,   labelKey: 'bylines.card_prolific' }
        ]));

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var trendPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('bylines.trend_title'), P.t('bylines.trend_desc'));
        grid.appendChild(trendPanel.panel);

        var top = data.top || [];
        var topPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide iwac-vis-bylines-top',
            P.t('bylines.top_title'), P.t('bylines.top_desc', { n: top.length }));
        grid.appendChild(topPanel.panel);

        renderTrend(trendPanel, data.by_year || {});
        renderTop(topPanel, top, ctx);
    }

    P.bootBlock({
        selector:       '.iwac-vis-press-bylines',
        warnLabel:      'IWACVis press bylines',
        requireECharts: false,
        dataFile:       'press-bylines.json',
        render:         buildLayout
    });
})();
