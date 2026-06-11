/**
 * IWAC Visualizations — Sentiment Atlas block (controller)
 *
 * Corpus-level view of the AI sentiment ratings on the IWAC `articles`
 * subset. Loads a single precomputed JSON bundle from
 * `asset/data/sentiment-atlas.json` (built by
 * `scripts/generate_sentiment_atlas.py`) and renders all panels from
 * it — no runtime calls to the Hugging Face datasets-server.
 *
 * Every figure on this page is an AI-generated assessment (three
 * language models: Gemini 3 Flash, GPT-5 mini, Ministral 14B), not
 * human-curated archival metadata — each panel description repeats
 * that caveat.
 *
 * Panels (in render order):
 *   1. Summary cards — articles rated per model
 *   2. "Period covered" subtitle
 *   3. Model facet bar driving panels 4–6
 *   4. Polarity over time — stacked bar (wide)
 *   5. Centrality of Islam over time — stacked bar (wide)
 *   6. Polarity by country — stacked bar
 *   7. Subjectivity trend — one line per model (model colors from
 *      theme tokens; all three models at once, no facet)
 *   8. Cross-model agreement — pairwise % cards + 6×6 polarity
 *      cross-tab heatmap with a pair selector (wide)
 *
 * Load order: after shared/panels.js + shared/chart-options*.js +
 * shared/facet-buttons.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis sentiment atlas: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    var NOT_APPLICABLE = 'Non applicable';

    // Model display names follow the article resource page
    // (view/common/resource-page-block-layout/visualizations/article.phtml).
    var MODELS = [
        { key: 'gemini',  label: 'Gemini 3 Flash' },
        { key: 'chatgpt', label: 'GPT-5 mini' },
        { key: 'mistral', label: 'Ministral 14B' }
    ];

    function modelLabel(key) {
        for (var i = 0; i < MODELS.length; i++) {
            if (MODELS[i].key === key) return MODELS[i].label;
        }
        return key;
    }

    /* ----------------------------------------------------------------- */
    /*  Block-local i18n strings                                          */
    /* ----------------------------------------------------------------- */

    // The raw rating labels ('Très positif', 'Non abordé', …) already
    // live in the shared dictionary — P.t(label) translates them on the
    // English site and passes them through on the French one.
    if (ns.addTranslations) {
        ns.addTranslations('en', {
            'Loading sentiment atlas':          'Loading sentiment atlas',
            'sentiment.rated_gemini':           'Rated by Gemini 3 Flash',
            'sentiment.rated_chatgpt':          'Rated by GPT-5 mini',
            'sentiment.rated_mistral':          'Rated by Ministral 14B',
            'sentiment.ai_note':                'AI-generated assessments by three language models; not human-curated archival metadata.',
            'sentiment.polarity_year_title':    'Polarity over time',
            'sentiment.polarity_year_desc':     'Articles published each year, stacked by the polarity the selected model assigned, from very positive to very negative. Articles rated “Not applicable” are excluded from the stacks.',
            'sentiment.centrality_year_title':  'Centrality of Islam over time',
            'sentiment.centrality_year_desc':   'Articles published each year, stacked by how central Islam and Muslims are to the article according to the selected model, from very central to not addressed.',
            'sentiment.polarity_country_title': 'Polarity by country',
            'sentiment.polarity_country_desc':  'Total polarity ratings by country of publication for the selected model. Articles rated “Not applicable” are excluded from the stacks.',
            'sentiment.subjectivity_title':     'Subjectivity trend',
            'sentiment.subjectivity_desc':      'Mean subjectivity score of the articles published each year, per model, on a 1 (very objective) to 5 (very subjective) scale.',
            'sentiment.agreement_title':        'Cross-model agreement',
            'sentiment.agreement_desc':         'Share of co-rated articles where two models assign the identical polarity label, with the full label-by-label cross-tabulation for the selected pair.',
            'sentiment.na_note':                '{count} articles rated “Not applicable” by this model are excluded from the polarity stacks.',
            'sentiment.co_rated':               '{count} co-rated articles',
            'sentiment.pct_value':              '{pct}%',
            'sentiment.subj_tooltip':           '{value} (n = {count})',
            'sentiment.matrix_caption':         'Rows: {a} · Columns: {b}',
            'sentiment.pair_cell':              '{a}: {la} · {b}: {lb} — {count} articles'
        });
        ns.addTranslations('fr', {
            'Loading sentiment atlas':          'Chargement de l’atlas des sentiments',
            'sentiment.rated_gemini':           'Évalués par Gemini 3 Flash',
            'sentiment.rated_chatgpt':          'Évalués par GPT-5 mini',
            'sentiment.rated_mistral':          'Évalués par Ministral 14B',
            'sentiment.ai_note':                'Évaluations générées par trois modèles de langage ; il ne s’agit pas de métadonnées éditoriales.',
            'sentiment.polarity_year_title':    'Polarité au fil du temps',
            'sentiment.polarity_year_desc':     'Articles publiés chaque année, empilés selon la polarité attribuée par le modèle sélectionné, de très positif à très négatif. Les articles évalués « Non applicable » sont exclus des barres.',
            'sentiment.centrality_year_title':  'Centralité de l’islam au fil du temps',
            'sentiment.centrality_year_desc':   'Articles publiés chaque année, empilés selon la centralité de l’islam et des musulmans dans l’article d’après le modèle sélectionné, de très central à non abordé.',
            'sentiment.polarity_country_title': 'Polarité par pays',
            'sentiment.polarity_country_desc':  'Totaux des polarités par pays de publication pour le modèle sélectionné. Les articles évalués « Non applicable » sont exclus des barres.',
            'sentiment.subjectivity_title':     'Tendance de la subjectivité',
            'sentiment.subjectivity_desc':      'Score moyen de subjectivité des articles publiés chaque année, par modèle, sur une échelle de 1 (très objectif) à 5 (très subjectif).',
            'sentiment.agreement_title':        'Accord entre modèles',
            'sentiment.agreement_desc':         'Part des articles co-évalués où deux modèles attribuent exactement la même polarité, avec le tableau croisé complet des étiquettes pour la paire sélectionnée.',
            'sentiment.na_note':                '{count} articles évalués « Non applicable » par ce modèle sont exclus des barres de polarité.',
            'sentiment.co_rated':               '{count} articles co-évalués',
            'sentiment.pct_value':              '{pct} %',
            'sentiment.subj_tooltip':           '{value} (n = {count})',
            'sentiment.matrix_caption':         'Lignes : {a} · Colonnes : {b}',
            'sentiment.pair_cell':              '{a} : {la} · {b} : {lb} — {count} articles'
        });
    }

    /** Panel description + the mandatory AI-provenance caveat. */
    function descWithAiNote(key) {
        return P.t(key) + ' ' + P.t('sentiment.ai_note');
    }

    /* ----------------------------------------------------------------- */
    /*  Theme-token colors                                                */
    /* ----------------------------------------------------------------- */

    /**
     * Per-model line color from the iwac-core.css tokens
     * (`--iwac-vis-model-*`), resolved through dashboard-core so
     * color-mix()/oklch values come back ECharts-parseable. Falls back
     * to stable IWAC palette slots (same mapping as the article
     * dashboard radar). No hex literals — if the palette is empty the
     * ECharts theme assigns its own series color.
     */
    function modelColor(key) {
        var resolved = (ns.resolveCssVar && ns.resolveCssVar('--iwac-vis-model-' + key)) || '';
        if (resolved) return resolved;
        var palette = (ns.getPalette && ns.getPalette()) || [];
        var fallbackIdx = { gemini: 1, chatgpt: 2, mistral: 0 };
        return palette[fallbackIdx[key]] || palette[0];
    }

    /* ----------------------------------------------------------------- */
    /*  Option builders                                                   */
    /* ----------------------------------------------------------------- */

    function stackOrderWithoutNA(order) {
        return (order || []).filter(function (label) {
            return label !== NOT_APPLICABLE;
        });
    }

    function buildPolarityByYear(data, modelKey) {
        var model = data.models[modelKey] || {};
        return C.stackedBar({
            categories: data.years || [],
            stackKeys: stackOrderWithoutNA(data.polarity_order),
            series: model.polarity_by_year || {}
        }, {
            labelFor: function (k) { return P.t(k); },
            categoryName: P.t('Year'),
            valueName: P.t('Articles')
        });
    }

    function buildCentralityByYear(data, modelKey) {
        var model = data.models[modelKey] || {};
        return C.stackedBar({
            categories: data.years || [],
            stackKeys: data.centrality_order || [],
            series: model.centrality_by_year || {}
        }, {
            labelFor: function (k) { return P.t(k); },
            categoryName: P.t('Year'),
            valueName: P.t('Articles')
        });
    }

    function buildPolarityByCountry(data, modelKey) {
        var model = data.models[modelKey] || {};
        return C.stackedBar({
            categories: data.countries || [],
            stackKeys: stackOrderWithoutNA(data.polarity_order),
            series: model.polarity_by_country || {}
        }, {
            labelFor: function (k) { return P.t(k); },
            valueName: P.t('Articles')
        });
    }

    function buildSubjectivityOption(data) {
        var years = data.years || [];
        var series = MODELS.map(function (m) {
            var model = data.models[m.key] || {};
            var subj = model.subjectivity_by_year || {};
            var color = modelColor(m.key);
            var s = {
                name: m.label,
                type: 'line',
                smooth: true,
                symbol: 'circle',
                symbolSize: 4,
                lineStyle: { width: 2 },
                emphasis: { focus: 'series' },
                data: subj.mean || []
            };
            if (color) {
                s.lineStyle.color = color;
                s.itemStyle = { color: color };
            }
            return s;
        });

        var dataZoom = C._dataZoom(years.length);
        var useZoom = dataZoom.length > 0;
        return {
            grid: C._grid({ left: 56, bottom: useZoom ? 64 : 40 }),
            legend: { type: 'scroll', top: 4, itemWidth: 12, itemHeight: 10 },
            tooltip: {
                trigger: 'axis',
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    var lines = ['<strong>' + P.escapeHtml(params[0].axisValue) + '</strong>'];
                    params.forEach(function (p) {
                        var m = MODELS[p.seriesIndex] || {};
                        var subj = ((data.models[m.key] || {}).subjectivity_by_year) || {};
                        var n = (subj.n || [])[p.dataIndex] || 0;
                        var value = (p.value == null)
                            ? '—'
                            : P.t('sentiment.subj_tooltip', {
                                value: P.formatNumber(p.value),
                                count: P.formatNumber(n)
                            });
                        lines.push(p.marker + ' ' + P.escapeHtml(p.seriesName) + ': ' + value);
                    });
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'category',
                data: years,
                name: P.t('Year'),
                nameLocation: 'middle',
                nameGap: useZoom ? 34 : 26
            },
            yAxis: Object.assign(
                { type: 'value', min: 1, max: 5 },
                C._valueAxisName(P.t('Subjectivity'))
            ),
            dataZoom: dataZoom,
            series: series,
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
    }

    /**
     * 6×6 polarity cross-tab heatmap for one model pair, scary-terms
     * matrix style: every color resolved from theme tokens, value
     * labels on non-zero cells, surface→primary visualMap ramp.
     */
    function buildAgreementMatrix(data, pairEntry) {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var primary = (ns.resolveCssVar && ns.resolveCssVar('--primary')) || tokens.primary;
        var surface = (ns.resolveCssVar && ns.resolveCssVar('--surface-raised'))
            || tokens.surfaceRaised || tokens.surface;
        var ink = (ns.resolveCssVar && ns.resolveCssVar('--ink')) || tokens.ink;
        var muted = (ns.resolveCssVar && ns.resolveCssVar('--muted')) || tokens.muted;
        var border = (ns.resolveCssVar && ns.resolveCssVar('--border')) || tokens.border;

        var order = data.polarity_order || [];
        var labels = order.map(function (l) { return P.t(l); });
        var matrix = pairEntry.matrix || [];
        var labelA = modelLabel(pairEntry.models[0]);
        var labelB = modelLabel(pairEntry.models[1]);

        var cells = [];
        var maxVal = 1;
        for (var i = 0; i < order.length; i++) {
            for (var j = 0; j < order.length; j++) {
                var v = (matrix[i] && matrix[i][j]) || 0;
                if (v > maxVal) maxVal = v;
                // x = model B label index, y = model A label index.
                cells.push([j, i, v]);
            }
        }

        return {
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    return P.t('sentiment.pair_cell', {
                        a: P.escapeHtml(labelA),
                        la: P.escapeHtml(labels[p.value[1]] || ''),
                        b: P.escapeHtml(labelB),
                        lb: P.escapeHtml(labels[p.value[0]] || ''),
                        count: P.formatNumber(p.value[2] || 0)
                    });
                }
            },
            grid: { left: 110, right: 24, top: 16, bottom: 84, containLabel: true },
            xAxis: {
                type: 'category',
                data: labels,
                axisLabel: { rotate: 35, interval: 0, color: muted },
                axisLine: { lineStyle: { color: border } },
                splitArea: { show: false },
                axisTick: { show: false }
            },
            yAxis: {
                type: 'category',
                data: labels.slice(),
                inverse: true,
                axisLabel: { interval: 0, color: muted },
                axisLine: { lineStyle: { color: border } },
                splitArea: { show: false },
                axisTick: { show: false }
            },
            visualMap: {
                min: 0,
                max: maxVal,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: 4,
                itemWidth: 14,
                itemHeight: 140,
                textStyle: { color: muted },
                inRange: { color: [surface, primary] }
            },
            series: [{
                type: 'heatmap',
                data: cells,
                label: {
                    show: true,
                    formatter: function (p) {
                        var v = p.value[2];
                        return v > 0 ? P.formatNumber(v) : '';
                    },
                    color: ink,
                    fontSize: 10
                },
                itemStyle: { borderColor: surface, borderWidth: 1 },
                emphasis: {
                    itemStyle: { borderColor: primary, borderWidth: 2 }
                },
                progressive: 0,
                animation: false
            }]
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Agreement cards (pairwise % summary)                              */
    /* ----------------------------------------------------------------- */

    function buildAgreementCards(agreement) {
        var cardsEl = P.el('div', 'iwac-vis-overview-summary');
        (agreement || []).forEach(function (entry) {
            var card = P.el('div', 'iwac-vis-summary-card');
            card.appendChild(P.el('div', 'iwac-vis-summary-card__label',
                modelLabel(entry.models[0]) + ' × ' + modelLabel(entry.models[1])));
            card.appendChild(P.el('div', 'iwac-vis-summary-card__value',
                entry.agreement_pct == null
                    ? '—'
                    : P.t('sentiment.pct_value', { pct: P.formatNumber(entry.agreement_pct) })));
            card.appendChild(P.el('div', 'iwac-vis-summary-card__label',
                P.t('sentiment.co_rated', { count: P.formatNumber(entry.co_rated || 0) })));
            cardsEl.appendChild(card);
        });
        return cardsEl;
    }

    /* ----------------------------------------------------------------- */
    /*  Layout composition                                                 */
    /* ----------------------------------------------------------------- */

    function buildLayout(container, data) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        var summary = data.summary || {};
        var modelSummaries = summary.models || {};
        root.appendChild(P.buildSummaryCards([
            { value: summary.total, labelKey: 'Articles' },
            { value: (modelSummaries.gemini || {}).rated,  labelKey: 'sentiment.rated_gemini' },
            { value: (modelSummaries.chatgpt || {}).rated, labelKey: 'sentiment.rated_chatgpt' },
            { value: (modelSummaries.mistral || {}).rated, labelKey: 'sentiment.rated_mistral' }
        ]));

        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var polarityPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('sentiment.polarity_year_title'), descWithAiNote('sentiment.polarity_year_desc'));
        var centralityPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('sentiment.centrality_year_title'), descWithAiNote('sentiment.centrality_year_desc'));
        var countryPanel = P.buildPanel('iwac-vis-panel',
            P.t('sentiment.polarity_country_title'), descWithAiNote('sentiment.polarity_country_desc'));
        var subjectivityPanel = P.buildPanel('iwac-vis-panel',
            P.t('sentiment.subjectivity_title'), descWithAiNote('sentiment.subjectivity_desc'));
        var agreementPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('sentiment.agreement_title'), descWithAiNote('sentiment.agreement_desc'));

        // Dynamic "Non applicable" caption under the polarity timeline.
        var naNote = P.el('p', 'iwac-vis-muted');
        polarityPanel.panel.appendChild(naNote);

        grid.appendChild(polarityPanel.panel);
        grid.appendChild(centralityPanel.panel);
        grid.appendChild(countryPanel.panel);
        grid.appendChild(subjectivityPanel.panel);
        grid.appendChild(agreementPanel.panel);

        return {
            grid:              grid,
            polarityPanel:     polarityPanel,
            centralityPanel:   centralityPanel,
            countryPanel:      countryPanel,
            subjectivityPanel: subjectivityPanel,
            agreementPanel:    agreementPanel,
            naNote:            naNote
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function initSentimentAtlas(container) {
        var loadingLabel = container.querySelector('.iwac-vis-loading span');
        if (loadingLabel) loadingLabel.textContent = P.t('Loading sentiment atlas') + '…';

        var basePath = container.getAttribute('data-base-path') || '';
        var url = basePath + '/modules/IwacVisualizations/asset/data/sentiment-atlas.json';

        P.fetchJSON(url)
            .then(function (data) {
                if (!data || !data.models || !data.summary || !data.summary.total) {
                    container.innerHTML = '';
                    container.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
                    return;
                }

                var state = { model: MODELS[0].key, pair: 0 };
                var h = buildLayout(container, data);

                function updateNaNote() {
                    var model = data.models[state.model] || {};
                    h.naNote.textContent = P.t('sentiment.na_note', {
                        count: P.formatNumber(model.not_applicable || 0)
                    });
                }
                updateNaNote();

                // -- Model facet bar driving the three stacked panels ----
                if (P.buildFacetButtons) {
                    var subFacets = {};
                    MODELS.forEach(function (m) { subFacets[m.key] = m.label; });
                    var facetBar = P.buildFacetButtons({
                        facets: [{
                            key: 'model',
                            label: P.t('Model'),
                            subFacets: subFacets,
                            renderAs: 'buttons'
                        }],
                        activeKey: 'model',
                        onChange: function (evt) {
                            state.model = evt.subFacet || MODELS[0].key;
                            updateNaNote();
                            [
                                [h.polarityPanel.chart,   buildPolarityByYear],
                                [h.centralityPanel.chart, buildCentralityByYear],
                                [h.countryPanel.chart,    buildPolarityByCountry]
                            ].forEach(function (pair) {
                                var live = ns.getLiveChart ? ns.getLiveChart(pair[0]) : null;
                                if (live) live.setOption(pair[1](data, state.model), true);
                            });
                        }
                    });
                    h.grid.parentNode.insertBefore(facetBar.root, h.grid);
                }

                // -- Faceted stacked bars (read state.model so theme
                //    rebuilds re-render the current selection) ----------
                ns.registerChart(h.polarityPanel.chart, function (el, chart) {
                    chart.setOption(buildPolarityByYear(data, state.model), true);
                });
                ns.registerChart(h.centralityPanel.chart, function (el, chart) {
                    chart.setOption(buildCentralityByYear(data, state.model), true);
                });
                ns.registerChart(h.countryPanel.chart, function (el, chart) {
                    chart.setOption(buildPolarityByCountry(data, state.model), true);
                });

                // -- Subjectivity trend (all models at once) -------------
                ns.registerChart(h.subjectivityPanel.chart, function (el, chart) {
                    chart.setOption(buildSubjectivityOption(data), true);
                });

                // -- Cross-model agreement -------------------------------
                var agreement = data.agreement || [];
                if (agreement.length > 0) {
                    var agreementChartEl = h.agreementPanel.chart;
                    h.agreementPanel.panel.insertBefore(
                        buildAgreementCards(agreement), agreementChartEl);

                    var caption = P.el('p', 'iwac-vis-muted');
                    var updateCaption = function () {
                        var entry = agreement[state.pair];
                        caption.textContent = P.t('sentiment.matrix_caption', {
                            a: modelLabel(entry.models[0]),
                            b: modelLabel(entry.models[1])
                        });
                    };
                    updateCaption();

                    if (P.buildFacetButtons && agreement.length > 1) {
                        var pairFacets = {};
                        agreement.forEach(function (entry, idx) {
                            pairFacets[String(idx)] = modelLabel(entry.models[0])
                                + ' × ' + modelLabel(entry.models[1]);
                        });
                        var pairBar = P.buildFacetButtons({
                            facets: [{
                                key: 'pair',
                                label: P.t('Model comparison'),
                                subFacets: pairFacets,
                                renderAs: 'buttons'
                            }],
                            activeKey: 'pair',
                            onChange: function (evt) {
                                state.pair = parseInt(evt.subFacet, 10) || 0;
                                updateCaption();
                                var live = ns.getLiveChart
                                    ? ns.getLiveChart(agreementChartEl) : null;
                                if (live) {
                                    live.setOption(
                                        buildAgreementMatrix(data, agreement[state.pair]), true);
                                }
                            }
                        });
                        h.agreementPanel.panel.insertBefore(pairBar.root, agreementChartEl);
                    }
                    h.agreementPanel.panel.insertBefore(caption, agreementChartEl);

                    ns.registerChart(agreementChartEl, function (el, chart) {
                        chart.setOption(buildAgreementMatrix(data, agreement[state.pair]), true);
                    });
                } else {
                    h.agreementPanel.chart.appendChild(
                        P.el('div', 'iwac-vis-empty', P.t('No data available')));
                }
            })
            .catch(function (err) {
                console.error('IWACVis sentiment atlas:', err);
                container.innerHTML = '';
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    /* ----------------------------------------------------------------- */
    /*  Auto-init                                                         */
    /* ----------------------------------------------------------------- */

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis sentiment atlas: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-sentiment-atlas');
        for (var i = 0; i < containers.length; i++) {
            initSentimentAtlas(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
