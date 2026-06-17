/**
 * IWAC Visualizations — Sentiment Atlas block (controller)
 *
 * Corpus-level view of the AI sentiment ratings on the IWAC `articles`
 * subset. Loads a single precomputed JSON bundle from
 * `asset/data/sentiment-atlas.json` (built by
 * `scripts/generate_sentiment_atlas.py`) and renders all panels from
 * it — no runtime calls to the Hugging Face datasets-server. A second,
 * optional fetch of `asset/data/sentiment-arbiter.json` (built by
 * `scripts/generate_sentiment_arbiter.py` from the sibling
 * IWAC-sentiment-analysis study) powers the arbitration panels; if it is
 * absent the block renders everything else and quietly omits them.
 *
 * Every figure on this page is an AI-generated assessment (three rating
 * models: Gemini 3 Flash, GPT-5 mini, Ministral 14B; plus an independent
 * Gemini 3 Pro arbiter), not human-curated archival metadata — each panel
 * description repeats that caveat.
 *
 * Sections / panels (render order):
 *   Intro      — summary cards + "period covered" subtitle
 *   [Model]    — a single facet bar; the model lens for the panels below
 *   Over time  — polarity over time, centrality over time (both faceted),
 *                subjectivity trend (all three models at once)
 *   Breakdown  — polarity by country, polarity × subjectivity, and the
 *                centrality-by-country-and-year heatmap (all faceted)
 *   Extremes   — top subject / place keywords in the most extreme-rated
 *                articles, with a sentiment-bucket + keyword-type facet
 *   Comparison — a model-pair facet driving cross-model agreement (cards +
 *                cross-tab heatmap) and, where the two models diverged
 *                sharply, the Gemini 3 Pro arbiter's verdict (overall +
 *                by dimension)
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
            'Polarity':                         'Polarity',
            'Centrality':                       'Centrality',
            'Subjectivity':                     'Subjectivity',
            'sentiment.rated_gemini':           'Rated by Gemini 3 Flash',
            'sentiment.rated_chatgpt':          'Rated by GPT-5 mini',
            'sentiment.rated_mistral':          'Rated by Ministral 14B',
            'sentiment.ai_note':                'AI-generated assessments by three language models; not human-curated archival metadata.',
            'sentiment.sec_time':               'Ratings over time',
            'sentiment.sec_breakdown':          'How the ratings break down',
            'sentiment.sec_extremes':           'What the most extreme articles are about',
            'sentiment.sec_compare':            'Model comparison & arbitration',
            'sentiment.polarity_year_title':    'Polarity over time',
            'sentiment.polarity_year_desc':     'Articles published each year, stacked by the polarity the selected model assigned, from very positive to very negative. Articles rated “Not applicable” are excluded from the stacks.',
            'sentiment.centrality_year_title':  'Centrality of Islam over time',
            'sentiment.centrality_year_desc':   'Articles published each year, stacked by how central Islam and Muslims are to the article according to the selected model, from very central to not addressed.',
            'sentiment.polarity_country_title': 'Polarity by country',
            'sentiment.polarity_country_desc':  'Total polarity ratings by country of publication for the selected model. Articles rated “Not applicable” are excluded from the stacks.',
            'sentiment.subjectivity_title':     'Subjectivity trend',
            'sentiment.subjectivity_desc':      'Mean subjectivity score of the articles published each year, per model, on a 1 (very objective) to 5 (very subjective) scale.',
            'sentiment.correlation_title':      'Polarity vs. subjectivity',
            'sentiment.correlation_desc':       'How the selected model’s polarity ratings distribute across the 1 (very objective) to 5 (very subjective) scale — do more opinionated articles skew positive or negative? “Not applicable” is excluded.',
            'sentiment.cenheat_title':          'Centrality by country and year',
            'sentiment.cenheat_desc':           'Mean centrality of Islam and Muslims (1 = not addressed … 5 = very central) per country and year for the selected model. Empty cells had no rated articles.',
            'sentiment.cenheat_tip':            '{country} · {year}<br>Mean centrality {value} (n = {count})',
            'sentiment.extremes_title':         'Keywords in the most extreme articles',
            'sentiment.extremes_desc':          'The subject and place keywords most frequent among the articles the selected model rated at the extremes of each scale — a window onto what drives the strongest assessments.',
            'sentiment.extremes_category':      'Extreme',
            'sentiment.extremes_type':          'Keywords',
            'sentiment.extremes_n':             '{count} articles in this bucket for the selected model.',
            'sentiment.kw_subject':             'Subjects',
            'sentiment.kw_spatial':             'Places',
            'sentiment.cat_subjectivity_high':      'Most subjective (4–5)',
            'sentiment.cat_subjectivity_low':       'Most objective (1–2)',
            'sentiment.cat_polarity_very_negative': 'Very negative',
            'sentiment.cat_polarity_very_positive': 'Very positive',
            'sentiment.cat_centrality_very_central':'Most central',
            'sentiment.cat_centrality_marginal':    'Marginal',
            'sentiment.agreement_title':        'Cross-model agreement',
            'sentiment.agreement_desc':         'Share of co-rated articles where two models assign the identical polarity label, with the full label-by-label cross-tabulation for the selected pair.',
            'sentiment.arbiter_title':          'Arbiter verdict',
            'sentiment.arbiter_desc':           'Where the two selected models diverged sharply (≥ 3 points on a dimension), an independent {model} judge — blind to which model was which — decided whose reading was more accurate.',
            'sentiment.arbiter_dim_title':      'Arbiter verdict by dimension',
            'sentiment.arbiter_dim_desc':       'Which model the {model} arbiter preferred on each dimension. “Both adequate” means the two readings were judged equally valid.',
            'sentiment.arbiter_both':           'Both adequate',
            'sentiment.arbiter_neither':        'Neither',
            'sentiment.arbiter_n':              '{count} sharply divergent articles judged by {model}.',
            'sentiment.arbiter_confidence':     'Arbiter confidence: {high} high · {medium} medium · {low} low.',
            'sentiment.na_note':                '{count} articles rated “Not applicable” by this model are excluded from the polarity stacks.',
            'sentiment.co_rated':               '{count} co-rated articles',
            'sentiment.pct_value':              '{pct}%',
            'sentiment.subj_tooltip':           '{value} (n = {count})',
            'sentiment.matrix_caption':         'Rows: {a} · Columns: {b}',
            'sentiment.pair_cell':              '{a}: {la} · {b}: {lb} — {count} articles'
        });
        ns.addTranslations('fr', {
            'Loading sentiment atlas':          'Chargement de l’atlas des sentiments',
            'Polarity':                         'Polarité',
            'Centrality':                       'Centralité',
            'Subjectivity':                     'Subjectivité',
            'sentiment.rated_gemini':           'Évalués par Gemini 3 Flash',
            'sentiment.rated_chatgpt':          'Évalués par GPT-5 mini',
            'sentiment.rated_mistral':          'Évalués par Ministral 14B',
            'sentiment.ai_note':                'Évaluations générées par trois modèles de langage ; il ne s’agit pas de métadonnées éditoriales.',
            'sentiment.sec_time':               'Évaluations au fil du temps',
            'sentiment.sec_breakdown':          'Répartition des évaluations',
            'sentiment.sec_extremes':           'De quoi parlent les articles les plus extrêmes',
            'sentiment.sec_compare':            'Comparaison des modèles et arbitrage',
            'sentiment.polarity_year_title':    'Polarité au fil du temps',
            'sentiment.polarity_year_desc':     'Articles publiés chaque année, empilés selon la polarité attribuée par le modèle sélectionné, de très positif à très négatif. Les articles évalués « Non applicable » sont exclus des barres.',
            'sentiment.centrality_year_title':  'Centralité de l’islam au fil du temps',
            'sentiment.centrality_year_desc':   'Articles publiés chaque année, empilés selon la centralité de l’islam et des musulmans dans l’article d’après le modèle sélectionné, de très central à non abordé.',
            'sentiment.polarity_country_title': 'Polarité par pays',
            'sentiment.polarity_country_desc':  'Totaux des polarités par pays de publication pour le modèle sélectionné. Les articles évalués « Non applicable » sont exclus des barres.',
            'sentiment.subjectivity_title':     'Tendance de la subjectivité',
            'sentiment.subjectivity_desc':      'Score moyen de subjectivité des articles publiés chaque année, par modèle, sur une échelle de 1 (très objectif) à 5 (très subjectif).',
            'sentiment.correlation_title':      'Polarité et subjectivité',
            'sentiment.correlation_desc':       'Répartition des polarités attribuées par le modèle sélectionné selon l’échelle de subjectivité, de 1 (très objectif) à 5 (très subjectif) : les articles les plus engagés penchent-ils vers le positif ou le négatif ? « Non applicable » est exclu.',
            'sentiment.cenheat_title':          'Centralité par pays et par année',
            'sentiment.cenheat_desc':           'Centralité moyenne de l’islam et des musulmans (1 = non abordé … 5 = très central) par pays et par année pour le modèle sélectionné. Les cellules vides n’ont aucun article évalué.',
            'sentiment.cenheat_tip':            '{country} · {year}<br>Centralité moyenne {value} (n = {count})',
            'sentiment.extremes_title':         'Mots-clés des articles les plus extrêmes',
            'sentiment.extremes_desc':          'Les mots-clés de sujet et de lieu les plus fréquents parmi les articles que le modèle sélectionné a notés aux extrêmes de chaque échelle — un aperçu de ce qui motive les évaluations les plus tranchées.',
            'sentiment.extremes_category':      'Extrême',
            'sentiment.extremes_type':          'Mots-clés',
            'sentiment.extremes_n':             '{count} articles dans cette catégorie pour le modèle sélectionné.',
            'sentiment.kw_subject':             'Sujets',
            'sentiment.kw_spatial':             'Lieux',
            'sentiment.cat_subjectivity_high':      'Plus subjectifs (4–5)',
            'sentiment.cat_subjectivity_low':       'Plus objectifs (1–2)',
            'sentiment.cat_polarity_very_negative': 'Très négatifs',
            'sentiment.cat_polarity_very_positive': 'Très positifs',
            'sentiment.cat_centrality_very_central':'Les plus centraux',
            'sentiment.cat_centrality_marginal':    'Marginaux',
            'sentiment.agreement_title':        'Accord entre modèles',
            'sentiment.agreement_desc':         'Part des articles co-évalués où deux modèles attribuent exactement la même polarité, avec le tableau croisé complet des étiquettes pour la paire sélectionnée.',
            'sentiment.arbiter_title':          'Verdict de l’arbitre',
            'sentiment.arbiter_desc':           'Là où les deux modèles sélectionnés divergeaient fortement (≥ 3 points sur une dimension), un arbitre {model} indépendant — à l’aveugle sur l’identité des modèles — a tranché en faveur de l’analyse la plus juste.',
            'sentiment.arbiter_dim_title':      'Verdict de l’arbitre par dimension',
            'sentiment.arbiter_dim_desc':       'Quel modèle l’arbitre {model} a préféré sur chaque dimension. « Les deux » signifie que les deux analyses ont été jugées également valables.',
            'sentiment.arbiter_both':           'Les deux',
            'sentiment.arbiter_neither':        'Aucun',
            'sentiment.arbiter_n':              '{count} articles fortement divergents jugés par {model}.',
            'sentiment.arbiter_confidence':     'Confiance de l’arbitre : {high} élevée · {medium} moyenne · {low} faible.',
            'sentiment.na_note':                '{count} articles évalués « Non applicable » par ce modèle sont exclus des barres de polarité.',
            'sentiment.co_rated':               '{count} articles co-évalués',
            'sentiment.pct_value':              '{pct} %',
            'sentiment.subj_tooltip':           '{value} (n = {count})',
            'sentiment.matrix_caption':         'Lignes : {a} · Colonnes : {b}',
            'sentiment.pair_cell':              '{a} : {la} · {b} : {lb} — {count} articles'
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

    /**
     * Polarity × subjectivity: for the selected model, each subjectivité
     * level (1–5) is a stacked bar of how its polarity ratings split.
     */
    function buildCorrelation(data, modelKey) {
        var model = data.models[modelKey] || {};
        var levels = (data.subjectivity_levels || [1, 2, 3, 4, 5]).map(String);
        return C.stackedBar({
            categories: levels,
            stackKeys: stackOrderWithoutNA(data.polarity_order),
            series: model.correlation || {}
        }, {
            labelFor: function (k) { return P.t(k); },
            categoryName: P.t('Subjectivity'),
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
            grid: C._grid({ left: 64, bottom: useZoom ? 64 : 40 }),
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
     * Centrality intensity by country (rows) × year (columns). Mean
     * centralité on a 1–5 scale; every color resolved from theme tokens
     * (the dedicated `--iwac-vis-heatmap-*` ramp, same as C.heatmap).
     */
    function buildCentralityHeatmap(data, modelKey) {
        var model = data.models[modelKey] || {};
        var cellsIn = model.centrality_heatmap || [];
        var years = data.years || [];
        var countries = data.countries || [];

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var resolve = ns.resolveCssVar || function () { return ''; };
        var muted = resolve('--muted') || tokens.muted;
        var border = resolve('--border') || tokens.border;
        var ink = resolve('--ink') || tokens.ink;
        var heatStops = [
            resolve('--iwac-vis-heatmap-0'),
            resolve('--iwac-vis-heatmap-1'),
            resolve('--iwac-vis-heatmap-2'),
            resolve('--iwac-vis-heatmap-3'),
            resolve('--iwac-vis-heatmap-4')
        ].filter(Boolean);
        if (heatStops.length < 2) {
            heatStops = [resolve('--surface') || tokens.surface, resolve('--primary') || tokens.primary].filter(Boolean);
        }

        // c = [countryIdx, yearIdx, mean, n]; ECharts heatmap wants
        // [xIdx, yIdx, value] with x = year, y = country.
        var cells = cellsIn.map(function (c) {
            return { value: [c[1], c[0], c[2]], n: c[3] };
        });

        return {
            tooltip: {
                position: 'top',
                confine: true,
                formatter: function (p) {
                    var v = p.value || [];
                    return P.t('sentiment.cenheat_tip', {
                        country: P.escapeHtml(countries[v[1]] || ''),
                        year: years[v[0]],
                        value: P.formatNumber(v[2]),
                        count: P.formatNumber((p.data && p.data.n) || 0)
                    });
                }
            },
            grid: { left: 8, right: 24, top: 12, bottom: 64, containLabel: true },
            xAxis: {
                type: 'category',
                data: years.map(String),
                axisLabel: { interval: 'auto', fontSize: 10, color: muted },
                axisLine: { lineStyle: { color: border } },
                axisTick: { show: false },
                splitArea: { show: false }
            },
            yAxis: {
                type: 'category',
                data: countries.slice(),
                inverse: true,
                axisLabel: { interval: 0, color: muted },
                axisLine: { lineStyle: { color: border } },
                axisTick: { show: false },
                splitArea: { show: false }
            },
            visualMap: {
                min: 1,
                max: 5,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: 4,
                itemWidth: 14,
                itemHeight: 120,
                textStyle: { color: muted },
                inRange: { color: heatStops }
            },
            series: [{
                type: 'heatmap',
                data: cells,
                label: { show: false },
                itemStyle: { borderColor: resolve('--surface') || tokens.surface, borderWidth: 1 },
                emphasis: { itemStyle: { borderColor: ink, borderWidth: 2 } },
                progressive: 0,
                animation: false
            }]
        };
    }

    /**
     * Top subject / place keywords in one extreme-sentiment bucket for one
     * model. ``pairs`` come in as [[keyword, count], …] (Counter.most_common
     * output); horizontalBar wants {name, count} objects.
     */
    function buildExtremes(data, modelKey, category, type) {
        var model = data.models[modelKey] || {};
        var bucket = (model.extremes || {})[category] || {};
        var pairs = bucket[type] || [];
        var entries = pairs.map(function (p) { return { name: p[0], count: p[1] }; });
        if (entries.length === 0) {
            return { series: [] };
        }
        return C.horizontalBar(entries, {
            nameKey: 'name',
            valueKey: 'count',
            filterUnknown: false
        });
    }

    /**
     * 6×6 polarity cross-tab heatmap for one model pair: every color
     * resolved from theme tokens, value labels on non-zero cells,
     * surface→primary visualMap ramp.
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

    /**
     * Arbiter overall-verdict donut for one pair. Slices use the pair's
     * own blind model_a / model_b ids (mapped to display labels); zero
     * slices are dropped so a lopsided verdict reads cleanly.
     */
    function buildArbiterVerdict(entry) {
        if (!entry) return { series: [] };
        var o = entry.overall || {};
        var items = [
            { name: modelLabel(entry.model_a), value: o.model_a || 0 },
            { name: modelLabel(entry.model_b), value: o.model_b || 0 },
            { name: P.t('sentiment.arbiter_both'), value: o.both || 0 },
            { name: P.t('sentiment.arbiter_neither'), value: o.neither || 0 }
        ].filter(function (it) { return it.value > 0; });
        return C.pie(items, { nameKey: 'name', valueKey: 'value' });
    }

    /**
     * Arbiter verdict broken down by dimension for one pair: a stacked
     * bar over Polarity / Subjectivity / Centrality.
     */
    function buildArbiterDimensions(entry) {
        if (!entry) return { series: [] };
        var dims = ['polarity', 'subjectivity', 'centrality'];
        var catLabels = [P.t('Polarity'), P.t('Subjectivity'), P.t('Centrality')];
        var bd = entry.by_dimension || {};
        function col(key) {
            return dims.map(function (d) { return (bd[d] || {})[key] || 0; });
        }
        var la = modelLabel(entry.model_a);
        var lb = modelLabel(entry.model_b);
        var both = P.t('sentiment.arbiter_both');
        var neither = P.t('sentiment.arbiter_neither');
        var series = {};
        series[la] = col('model_a');
        series[lb] = col('model_b');
        series[both] = col('both');
        series[neither] = col('neither');
        return C.stackedBar({
            categories: catLabels,
            stackKeys: [la, lb, both, neither],
            series: series
        }, {
            valueName: P.t('Articles')
        });
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

    /** A full-width section divider/heading between panel groups. */
    function sectionHeading(text) {
        return P.el('h3', 'iwac-vis-section-heading', text);
    }

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

        // Global model lens for every single-model panel below.
        var modelFacetHost = P.el('div', 'iwac-vis-facet-host');
        root.appendChild(modelFacetHost);

        // -- Section: ratings over time --------------------------------
        root.appendChild(sectionHeading(P.t('sentiment.sec_time')));
        var timeGrid = P.buildChartsGrid();
        root.appendChild(timeGrid);

        var polarityPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('sentiment.polarity_year_title'), descWithAiNote('sentiment.polarity_year_desc'));
        var centralityPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('sentiment.centrality_year_title'), descWithAiNote('sentiment.centrality_year_desc'));
        var subjectivityPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('sentiment.subjectivity_title'), descWithAiNote('sentiment.subjectivity_desc'));

        // Dynamic "Non applicable" caption under the polarity timeline.
        var naNote = P.el('p', 'iwac-vis-muted');
        polarityPanel.panel.appendChild(naNote);

        timeGrid.appendChild(polarityPanel.panel);
        timeGrid.appendChild(centralityPanel.panel);
        timeGrid.appendChild(subjectivityPanel.panel);

        // -- Section: how the ratings break down -----------------------
        root.appendChild(sectionHeading(P.t('sentiment.sec_breakdown')));
        var breakdownGrid = P.buildChartsGrid();
        root.appendChild(breakdownGrid);

        var countryPanel = P.buildPanel('iwac-vis-panel',
            P.t('sentiment.polarity_country_title'), descWithAiNote('sentiment.polarity_country_desc'));
        var correlationPanel = P.buildPanel('iwac-vis-panel',
            P.t('sentiment.correlation_title'), descWithAiNote('sentiment.correlation_desc'));
        var cenHeatPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('sentiment.cenheat_title'), descWithAiNote('sentiment.cenheat_desc'));

        breakdownGrid.appendChild(countryPanel.panel);
        breakdownGrid.appendChild(correlationPanel.panel);
        breakdownGrid.appendChild(cenHeatPanel.panel);

        // -- Section: extreme-article keywords -------------------------
        root.appendChild(sectionHeading(P.t('sentiment.sec_extremes')));
        var extremesGrid = P.buildChartsGrid();
        root.appendChild(extremesGrid);

        var extremesPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('sentiment.extremes_title'), descWithAiNote('sentiment.extremes_desc'));
        var extremesControls = P.el('div', 'iwac-vis-facet-host');
        // Controls sit between the description and the chart.
        extremesPanel.panel.insertBefore(extremesControls, extremesPanel.chart);
        var extremesNote = P.el('p', 'iwac-vis-muted');
        extremesPanel.panel.appendChild(extremesNote);
        extremesGrid.appendChild(extremesPanel.panel);

        // -- Section: model comparison & arbitration -------------------
        root.appendChild(sectionHeading(P.t('sentiment.sec_compare')));
        var pairFacetHost = P.el('div', 'iwac-vis-facet-host');
        root.appendChild(pairFacetHost);
        var compareGrid = P.buildChartsGrid();
        root.appendChild(compareGrid);

        var agreementPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('sentiment.agreement_title'), descWithAiNote('sentiment.agreement_desc'));
        var matrixCaption = P.el('p', 'iwac-vis-muted');
        compareGrid.appendChild(agreementPanel.panel);

        return {
            root:              root,
            modelFacetHost:    modelFacetHost,
            polarityPanel:     polarityPanel,
            centralityPanel:   centralityPanel,
            subjectivityPanel: subjectivityPanel,
            countryPanel:      countryPanel,
            correlationPanel:  correlationPanel,
            cenHeatPanel:      cenHeatPanel,
            extremesPanel:     extremesPanel,
            extremesControls:  extremesControls,
            extremesNote:      extremesNote,
            pairFacetHost:     pairFacetHost,
            compareGrid:       compareGrid,
            agreementPanel:    agreementPanel,
            matrixCaption:     matrixCaption,
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
        var dataBase = basePath + '/modules/IwacVisualizations/asset/data/';

        // Atlas is required; the arbiter bundle is optional (the sibling
        // study may not be deployed) — swallow its failure to null.
        Promise.all([
            P.fetchJSON(dataBase + 'sentiment-atlas.json'),
            P.fetchJSON(dataBase + 'sentiment-arbiter.json').catch(function () { return null; })
        ])
            .then(function (results) {
                var data = results[0];
                var arbiter = results[1];

                if (!data || !data.models || !data.summary || !data.summary.total) {
                    container.innerHTML = '';
                    container.appendChild(P.buildEmptyState());
                    return;
                }

                var firstCat = (data.extreme_categories || ['subjectivity_high'])[0];
                var state = { model: MODELS[0].key, pair: 0, exCategory: firstCat, exType: 'subject' };
                var h = buildLayout(container, data);

                // Friendly name for the arbiter model id (gemini-3-pro-preview).
                var arbiterModelLabel = (arbiter && /pro/i.test(arbiter.arbiter_model || ''))
                    ? 'Gemini 3 Pro'
                    : (arbiter && arbiter.arbiter_model) || 'Gemini 3 Pro';

                // Index arbiter pairs by their unordered model-id set so we
                // can look one up from an agreement pair's [a, b] order.
                var arbiterIndex = {};
                if (arbiter && arbiter.pairs) {
                    arbiter.pairs.forEach(function (entry) {
                        var k = [entry.model_a, entry.model_b].slice().sort().join('|');
                        arbiterIndex[k] = entry;
                    });
                }
                function arbiterEntryFor(models) {
                    return arbiterIndex[[].concat(models).sort().join('|')] || null;
                }

                function updateNaNote() {
                    var model = data.models[state.model] || {};
                    h.naNote.textContent = P.t('sentiment.na_note', {
                        count: P.formatNumber(model.not_applicable || 0)
                    });
                }
                updateNaNote();

                function renderExtremes() {
                    var live = ns.getLiveChart ? ns.getLiveChart(h.extremesPanel.chart) : null;
                    if (live) live.setOption(buildExtremes(data, state.model, state.exCategory, state.exType), true);
                    var bucket = ((data.models[state.model] || {}).extremes || {})[state.exCategory] || {};
                    h.extremesNote.textContent = P.t('sentiment.extremes_n', {
                        count: P.formatNumber(bucket.n || 0)
                    });
                }

                // -- Global model facet (drives every single-model panel) --
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
                                [h.polarityPanel.chart,    buildPolarityByYear],
                                [h.centralityPanel.chart,  buildCentralityByYear],
                                [h.countryPanel.chart,     buildPolarityByCountry],
                                [h.correlationPanel.chart, buildCorrelation],
                                [h.cenHeatPanel.chart,     buildCentralityHeatmap]
                            ].forEach(function (pair) {
                                var live = ns.getLiveChart ? ns.getLiveChart(pair[0]) : null;
                                if (live) live.setOption(pair[1](data, state.model), true);
                            });
                            renderExtremes();
                        }
                    });
                    h.modelFacetHost.appendChild(facetBar.root);
                }

                // -- Faceted single-model panels ---------------------------
                ns.registerChart(h.polarityPanel.chart, function (el, chart) {
                    chart.setOption(buildPolarityByYear(data, state.model), true);
                });
                ns.registerChart(h.centralityPanel.chart, function (el, chart) {
                    chart.setOption(buildCentralityByYear(data, state.model), true);
                });
                ns.registerChart(h.countryPanel.chart, function (el, chart) {
                    chart.setOption(buildPolarityByCountry(data, state.model), true);
                });
                ns.registerChart(h.correlationPanel.chart, function (el, chart) {
                    chart.setOption(buildCorrelation(data, state.model), true);
                });
                ns.registerChart(h.cenHeatPanel.chart, function (el, chart) {
                    chart.setOption(buildCentralityHeatmap(data, state.model), true);
                });

                // -- Subjectivity trend (all models at once) ---------------
                ns.registerChart(h.subjectivityPanel.chart, function (el, chart) {
                    chart.setOption(buildSubjectivityOption(data), true);
                });

                // -- Extreme-article keyword facets ------------------------
                if (P.buildFacetButtons) {
                    var catFacets = {};
                    (data.extreme_categories || []).forEach(function (cat) {
                        catFacets[cat] = P.t('sentiment.cat_' + cat);
                    });
                    var catBar = P.buildFacetButtons({
                        facets: [{ key: 'category', label: P.t('sentiment.extremes_category'), subFacets: catFacets }],
                        activeKey: 'category',
                        onChange: function (evt) {
                            state.exCategory = evt.subFacet || firstCat;
                            renderExtremes();
                        }
                    });
                    var typeBar = P.buildFacetButtons({
                        facets: [{
                            key: 'type',
                            label: P.t('sentiment.extremes_type'),
                            subFacets: { subject: P.t('sentiment.kw_subject'), spatial: P.t('sentiment.kw_spatial') },
                            renderAs: 'buttons'
                        }],
                        activeKey: 'type',
                        onChange: function (evt) {
                            state.exType = evt.subFacet || 'subject';
                            renderExtremes();
                        }
                    });
                    h.extremesControls.appendChild(catBar.root);
                    h.extremesControls.appendChild(typeBar.root);
                }
                ns.registerChart(h.extremesPanel.chart, function (el, chart) {
                    chart.setOption(buildExtremes(data, state.model, state.exCategory, state.exType), true);
                });
                renderExtremes();

                // -- Comparison & arbitration section ----------------------
                var agreement = data.agreement || [];
                if (agreement.length === 0) {
                    h.agreementPanel.chart.appendChild(
                        P.buildEmptyState());
                    return;
                }

                // Build the arbiter panels only when the bundle loaded.
                var arbiterVerdictPanel = null;
                var arbiterDimPanel = null;
                var arbiterNote = null;
                if (arbiter && arbiter.pairs && arbiter.pairs.length) {
                    arbiterVerdictPanel = P.buildPanel('iwac-vis-panel',
                        P.t('sentiment.arbiter_title'),
                        P.t('sentiment.arbiter_desc', { model: arbiterModelLabel }));
                    arbiterDimPanel = P.buildPanel('iwac-vis-panel',
                        P.t('sentiment.arbiter_dim_title'),
                        P.t('sentiment.arbiter_dim_desc', { model: arbiterModelLabel }));
                    arbiterNote = P.el('p', 'iwac-vis-muted');
                    arbiterVerdictPanel.panel.appendChild(arbiterNote);
                    h.compareGrid.appendChild(arbiterVerdictPanel.panel);
                    h.compareGrid.appendChild(arbiterDimPanel.panel);
                }

                function updateArbiterNote(entry) {
                    if (!arbiterNote) return;
                    var c = (entry && entry.confidence) || {};
                    arbiterNote.textContent = (entry
                        ? P.t('sentiment.arbiter_n', {
                            count: P.formatNumber(entry.n || 0), model: arbiterModelLabel
                        }) + ' '
                        : '') + P.t('sentiment.arbiter_confidence', {
                            high: P.formatNumber(c.high || 0),
                            medium: P.formatNumber(c.medium || 0),
                            low: P.formatNumber(c.low || 0)
                        });
                }

                function renderComparison() {
                    var entry = agreement[state.pair];
                    if (!entry) return;
                    h.matrixCaption.textContent = P.t('sentiment.matrix_caption', {
                        a: modelLabel(entry.models[0]),
                        b: modelLabel(entry.models[1])
                    });
                    var liveM = ns.getLiveChart ? ns.getLiveChart(h.agreementPanel.chart) : null;
                    if (liveM) liveM.setOption(buildAgreementMatrix(data, entry), true);

                    if (arbiterVerdictPanel) {
                        var ae = arbiterEntryFor(entry.models);
                        var liveV = ns.getLiveChart ? ns.getLiveChart(arbiterVerdictPanel.chart) : null;
                        if (liveV) liveV.setOption(buildArbiterVerdict(ae), true);
                        var liveD = ns.getLiveChart ? ns.getLiveChart(arbiterDimPanel.chart) : null;
                        if (liveD) liveD.setOption(buildArbiterDimensions(ae), true);
                        updateArbiterNote(ae);
                    }
                }

                // Pairwise % cards (all pairs) + caption above the matrix.
                h.agreementPanel.panel.insertBefore(
                    buildAgreementCards(agreement), h.agreementPanel.chart);
                h.agreementPanel.panel.insertBefore(h.matrixCaption, h.agreementPanel.chart);

                // One pair facet drives the matrix AND the arbiter panels.
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
                            renderComparison();
                        }
                    });
                    h.pairFacetHost.appendChild(pairBar.root);
                }

                ns.registerChart(h.agreementPanel.chart, function (el, chart) {
                    chart.setOption(buildAgreementMatrix(data, agreement[state.pair]), true);
                });
                if (arbiterVerdictPanel) {
                    ns.registerChart(arbiterVerdictPanel.chart, function (el, chart) {
                        chart.setOption(buildArbiterVerdict(arbiterEntryFor(agreement[state.pair].models)), true);
                    });
                    ns.registerChart(arbiterDimPanel.chart, function (el, chart) {
                        chart.setOption(buildArbiterDimensions(arbiterEntryFor(agreement[state.pair].models)), true);
                    });
                    updateArbiterNote(arbiterEntryFor(agreement[state.pair].models));
                }

                // Seed the comparison caption (charts self-render on register).
                renderComparison();
            })
            .catch(function (err) {
                console.error('IWACVis sentiment atlas:', err);
                container.innerHTML = '';
                container.appendChild(P.buildErrorState());
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
