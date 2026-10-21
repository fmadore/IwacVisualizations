/**
 * IWAC Visualizations — Sentiment Atlas block (controller)
 *
 * Corpus-level view of the AI sentiment ratings on the IWAC `articles`
 * subset. Loads a single precomputed JSON bundle from
 * `asset/data/sentiment-atlas.json` (built by
 * `scripts/generate_sentiment_atlas.py`) and renders all panels from
 * it.
 *
 * Every figure on this page is an AI-generated assessment (the rating
 * panel the bundle carries — the generator's present models), not
 * human-curated archival metadata — each panel description repeats that
 * caveat.
 *
 * Sections / panels (render order):
 *   Intro      — summary cards + "period covered" subtitle
 *   [Model]    — a single facet bar; the model lens for the panels below
 *   Over time  — polarity over time, centrality over time (both faceted),
 *                then the two panels that draw every model at once, hence
 *                the per-model colour tokens: the subjectivity trend and
 *                the cross-model trend (share negative / central /
 *                subjective, with the lowest-to-highest model band)
 *   Breakdown  — polarity by country, polarity × subjectivity (with
 *                Spearman's rho), the centrality-by-country-and-year
 *                heatmap (with a minimum per cell), polarity by topic / by
 *                newspaper — diverging bars, thirty-odd rows sharing a
 *                baseline at the neutral midpoint — the newspaper ranking
 *                with 95% intervals, and the places map (all faceted)
 *   Extremes   — top subject / place keywords in the most extreme-rated
 *                articles, with a sentiment-bucket + keyword-type facet
 *   Comparison — a dimension facet driving every pair's agreement (model ×
 *                model matrix + the panel's Fleiss' kappa), one pair's
 *                measures and cross-tab (its own pair facet), each model's
 *                label shares, and the panel's unanimity and lone dissent
 *
 * The comparison, trend, ranking and map builders live in
 * sentiment-atlas/{scales,compare,trends,ranking,map}.js; this file keeps
 * the single-model panels, the layout and the state.
 *
 * Polarité and centralité are both ORDINAL, so every panel that stacks
 * either one paints from a semantic ramp and never from the categorical
 * series palette ECharts assigns by default: `C.polarityPalette()` for the
 * `--iwac-vis-sent-*` diverging scale the person, entity and laïcité
 * dashboards already read, and `C.centralityPalette()` for the sequential
 * `--iwac-vis-cent-*` one.
 *
 * Load order: after shared/panels.js + shared/chart-options*.js +
 * shared/facet-buttons.js + shared/places-map.js + sentiment-atlas/i18n.js
 * (the block's en/fr strings, split out so this file carries logic, not a
 * translation table) and the sentiment-atlas/ panel files.
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
    // The comparison, trend, ranking and map panels (sentiment-atlas/*.js).
    var S = ns.sentimentAtlas;
    if (!S || !S.reliabilityFor || !S.trendOption || !S.rankingOption) {
        console.warn('IWACVis sentiment atlas: missing its panel files — check the bundle');
        return;
    }

    var NOT_APPLICABLE = 'Non applicable';
    // Midpoint of the polarité scale — the grade that straddles zero on
    // the diverging panels. Raw French key, as it arrives in the bundle.
    var NEUTRAL = 'Neutre';

    // Filled from the payload's own `data.models` map by syncModels()
    // before anything reads it, NOT hardcoded.
    //
    // A fixed list here stops matching the moment the rater panel changes
    // upstream, and because this module ships as a release while its data
    // arrives via a separate CI archive the admin pulls, there is always a
    // window where the two disagree. When that happened the panels looked
    // up three keys the deployed bundle did not carry and reported no
    // data over a fully populated payload.
    //
    // Order is the payload's, which is the generator's SENTIMENT_MODELS
    // order — the order the corpus was actually rated in.
    var MODELS = [];

    function syncModels(data) {
        var models = (data && data.models) || {};
        MODELS = Object.keys(models).map(function (key) {
            return { key: key, label: P.sentimentModelLabel(key) };
        });
        return MODELS;
    }

    function modelLabel(key) {
        return P.sentimentModelLabel(key);
    }

    /** Panel description + the mandatory AI-provenance caveat. */
    function descWithAiNote(key, params) {
        return P.t(key, params) + ' ' + P.t('sentiment.ai_note');
    }

    /* ----------------------------------------------------------------- */
    /*  Theme-token colors                                                */
    /* ----------------------------------------------------------------- */

    /**
     * Model id → accent SLOT. The single place a model id meets a colour.
     *
     * The CSS tokens are `--iwac-vis-model-1..5`, named by position rather
     * than by release: the token name used to be derived from the model id
     * itself (`'--iwac-vis-model-' + key.replace(/_/g, '-')`), so every
     * model upgrade renamed a design token and orphaned the rule that
     * referenced it. Swapping a model is now one line here — and because
     * the slot is explicit, the remaining models keep their colours instead
     * of shuffling up.
     *
     * Ids carry underscores because they mirror the Hugging Face column
     * prefixes (see SentimentExtractor.php).
     */
    var MODEL_SLOT = {
        gpt_5_6_luna: 1,
        deepseek_v4_flash_0731: 2,
        mistral_small_2603: 3,
        gemma_4_31b_it: 4,
        qwen3_8_27b: 5
    };

    /**
     * Per-model line color from the iwac-core.css tokens
     * (`--iwac-vis-model-N`), resolved through dashboard-core so
     * color-mix()/oklch values come back ECharts-parseable. Falls back
     * to the matching IWAC palette slot. No hex literals — if the palette
     * is empty the ECharts theme assigns its own series color.
     */
    function modelColor(key) {
        var slot = MODEL_SLOT[key];
        if (slot) {
            var resolved = (ns.resolveCssVar && ns.resolveCssVar('--iwac-vis-model-' + slot)) || '';
            if (resolved) return resolved;
        }
        var palette = (ns.getPalette && ns.getPalette()) || [];
        return palette[(slot || 1) - 1] || palette[0];
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
            colors: C.polarityPalette(),
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
            colors: C.centralityPalette(),
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
            colors: C.polarityPalette(),
            valueName: P.t('Articles')
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Polarity by topic / by newspaper — the diverging panels           */
    /*                                                                    */
    /*  These two breakdowns are long (30 topics, 31 newspapers) and very */
    /*  unevenly sized: the largest topic carries 1,317 rated articles,   */
    /*  the smallest 17. As vertical stacked bars they answered the wrong */
    /*  question — length read as volume, so composition was legible for  */
    /*  the top two rows only — and 40°-rotated LDA term pairs ate so     */
    /*  much of the 320px panel that the plot collapsed to a ~50px strip  */
    /*  underneath its own legend. C.divergingBar carries the reasoning.  */
    /* ----------------------------------------------------------------- */

    /**
     * Topic display name: the shared derivation plus one local step. LDA
     * terms arrive as underscore-joined n-grams
     * (`conseil_supérieur_imam_cosim`), which is how they are keyed
     * upstream and not how anyone reads them. The spaces are restored
     * here, on the axis, rather than in `P.topicShortLabel` — its other
     * consumers (semantic landscape, references overview, periodicals)
     * draw the same strings into graph node labels and legends, where the
     * unbreakable underscore form is doing real layout work.
     */
    function topicShortLabel(label, id) {
        return unscore(P.topicShortLabel(label, id));
    }

    function unscore(str) {
        return String(str || '').replace(/_/g, ' ');
    }

    /** The topic's full term list, for the tooltip header. */
    function topicFullLabel(label, id) {
        var full = unscore(String(label || '').split(' - ').join(' · ')).trim();
        return full || (P.t('Topic') + ' ' + id);
    }

    /**
     * Polarité in SCALE order, most negative first — the left-to-right
     * order the diverging bars and their legend are both drawn in.
     * `polarity_order` runs the other way (it is the stacking order the
     * vertical panels want), so the two are not interchangeable.
     */
    function polarityScale(data) {
        return stackOrderWithoutNA(data.polarity_order).slice().reverse();
    }

    /**
     * One row per category: display name, untruncated name, and the raw
     * per-grade counts. `divergingBar` derives shares and totals itself,
     * so rows stay comparable however they are later sorted.
     */
    function polarityRows(data, modelKey, kind) {
        var model = data.models[modelKey] || {};
        var keys = polarityScale(data);
        var series = (kind === 'topic' ? model.polarity_by_topic : model.polarity_by_newspaper) || {};
        var names = kind === 'topic'
            ? (data.topics || []).map(function (topic) {
                return {
                    name: topicShortLabel(topic.label, topic.id),
                    full: topicFullLabel(topic.label, topic.id)
                };
            })
            : (data.newspapers || []).map(function (paper) {
                return { name: paper, full: paper };
            });
        return names.map(function (entry, i) {
            var counts = {};
            keys.forEach(function (k) { counts[k] = (series[k] || [])[i] || 0; });
            return { name: entry.name, full: entry.full, counts: counts };
        });
    }

    /** Sum a row's counts over a subset of the scale. */
    function sumGrades(counts, keys) {
        var n = 0;
        keys.forEach(function (k) { n += counts[k] || 0; });
        return n;
    }

    /**
     * Rows ordered either by net polarity or by volume.
     *
     * 'polarity' sorts on (positive share − negative share). Because a
     * diverging bar's two extents always sum to 100, that single key makes
     * BOTH outer edges monotonic: the chart resolves into two clean curves
     * and the leaning-negative themes separate out at the bottom instead
     * of hiding in the middle of a volume ranking. Ties fall back to
     * volume, so the head of an equal-share cluster is its biggest member
     * rather than an arbitrary one.
     *
     * @param {Array<string>} scale  Grades, most negative first.
     */
    function sortRows(rows, mode, scale) {
        var neutralIdx = scale.indexOf(NEUTRAL);
        var negKeys = scale.slice(0, neutralIdx);
        var posKeys = scale.slice(neutralIdx + 1);
        return rows.slice().map(function (r) {
            var total = sumGrades(r.counts, scale);
            return {
                row: r,
                total: total,
                net: total ? (sumGrades(r.counts, posKeys) - sumGrades(r.counts, negKeys)) / total : 0
            };
        }).sort(function (a, b) {
            if (mode === 'volume') return b.total - a.total || b.net - a.net;
            return b.net - a.net || b.total - a.total;
        }).map(function (entry) { return entry.row; });
    }

    /**
     * ONE value-axis extent for both diverging panels, pooled over every
     * model and both breakdowns.
     *
     * Two things depend on it. Across models: the ruler must not move when
     * the model facet does, or the rater that judges sharply and the rater
     * that judges mildly draw bars of the same width and the difference —
     * the thing a three-rater corpus exists to show — reads as nothing.
     * Across panels: "by topic" and "by newspaper" sit next to each other
     * in the same grid, so sharing a ruler is what lets a reader carry a
     * width from one to the other instead of re-reading the axis.
     */
    function polarityExtent(data) {
        var scale = polarityScale(data);
        var pooled = [];
        Object.keys(data.models || {}).forEach(function (key) {
            pooled = pooled
                .concat(polarityRows(data, key, 'topic'))
                .concat(polarityRows(data, key, 'newspaper'));
        });
        return C.divergingExtent(pooled, scale, NEUTRAL, 20);
    }

    function buildDivergingPolarity(data, modelKey, kind, sortMode, extent) {
        var scale = polarityScale(data);
        return C.divergingBar({
            rows: sortRows(polarityRows(data, modelKey, kind), sortMode, scale),
            order: scale,
            neutralKey: NEUTRAL,
            colors: C.polarityPalette(),
            labelFor: function (k) { return P.t(k); },
            extent: extent,
            countName: P.t('Articles'),
            countNote: function (n) {
                return P.t('sentiment.rated_n', { count: n });
            },
            // LDA term pairs run long; newspaper mastheads do not.
            labelWidth: kind === 'topic' ? 264 : 170
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
            colors: C.polarityPalette(),
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
            legend: C._legend(),
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
                                count: n
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
            series: series
        };
    }

    /**
     * Centrality intensity by country (rows) × year (columns). Mean
     * centralité on a 1–5 scale on the shared heat ramp, static (the
     * matrix is repainted on every model change and must not flash
     * through progressive rendering).
     */
    function buildCentralityHeatmap(data, modelKey, minCount) {
        var model = data.models[modelKey] || {};
        var cellsIn = model.centrality_heatmap || [];
        var years = data.years || [];
        var countries = data.countries || [];
        var min = minCount || 1;

        // c = [countryIdx, yearIdx, mean, n]; ECharts heatmap wants
        // [xIdx, yIdx, value] with x = year, y = country. A cell under the
        // reader's minimum is left out, not painted: a mean of two
        // articles is as dark as a mean of two hundred.
        var cells = cellsIn.filter(function (c) {
            return c[3] >= min;
        }).map(function (c) {
            return { value: [c[1], c[0], c[2]], n: c[3] };
        });

        return C.heatmapMatrix({ xLabels: years, yLabels: countries, cells: cells }, {
            visualMin: 1,
            visualMax: 5,
            cellBorder: true,
            static: true,
            tooltipFormatter: function (p) {
                var v = p.value || [];
                return P.t('sentiment.cenheat_tip', {
                    country: P.escapeHtml(countries[v[1]] || ''),
                    year: years[v[0]],
                    value: P.formatNumber(v[2]),
                    count: (p.data && p.data.n) || 0
                });
            }
        });
    }

    /** How many of the model's heatmap cells the minimum leaves out. */
    function heatmapHidden(data, modelKey, minCount) {
        var cells = (data.models[modelKey] || {}).centrality_heatmap || [];
        return cells.filter(function (c) { return c[3] < (minCount || 1); }).length;
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
     * Spearman's rho between the selected model's polarity and
     * subjectivity, from the correlation cross-tab the panel already draws
     * (polarity rows most negative first, subjectivité 1..5 across), so it
     * needs nothing a v0.3.0 bundle lacks. A sentence, not a chart: the
     * stacks show the shape, this says how monotone it is.
     */
    function spearmanCaption(data, modelKey) {
        var corr = (data.models[modelKey] || {}).correlation || {};
        var rows = S.readingOrder(data, 'polarity')
            .filter(function (label) { return label !== NOT_APPLICABLE; })
            .map(function (label) { return corr[label] || []; });
        var r = S.spearmanFromTable(rows);
        if (r.rho == null) return '';
        var p = r.p == null ? P.t('sentiment.na_value')
            : r.p < 0.001 ? P.t('sentiment.p_below', { p: P.formatNumber(0.001) })
                : P.t('sentiment.p_equals', { p: P.formatNumber(Math.round(r.p * 1000) / 1000) });
        return P.t('sentiment.spearman', {
            rho: (r.rho > 0 ? '+' : '') + P.formatNumber(Math.round(r.rho * 100) / 100),
            band: P.t('sentiment.rho_' + S.rhoBand(r.rho)),
            count: r.n,
            p: p
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Layout composition                                                 */
    /* ----------------------------------------------------------------- */

    /**
     * A full-width section divider/heading between panel groups.
     *
     * The block sits straight under the page's <h1> with no heading of its
     * own, so its sections are the page's sections: <h2>, with the panels
     * under them at <h3> (PANEL_HEADING). At <h3> / <h4> the outline skipped
     * a level (axe: heading-order) — the Collection Overview fix (V-20),
     * applied to a block that has sections. The look does not follow the
     * level (iwac-core.css).
     */
    var PANEL_HEADING = 'h3';
    function sectionHeading(text) {
        return P.el('h2', 'iwac-vis-section-heading', text);
    }

    /**
     * A host for a panel's own controls, between its description and chart;
     * `row` lays several bars side by side rather than stacked.
     */
    function controlsHost(panel, row) {
        var host = P.el('div', 'iwac-vis-facet-host' + (row ? ' iwac-vis-facet-host--row' : ''));
        panel.panel.insertBefore(host, panel.chart);
        return host;
    }

    /** A muted line, under the chart (`after`) or just above it. */
    function captionLine(panel, after) {
        var line = P.el('p', 'iwac-vis-muted');
        if (after) panel.panel.appendChild(line);
        else panel.panel.insertBefore(line, panel.chart);
        return line;
    }

    function widePanel(titleKey, desc, key) {
        return P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t(titleKey), desc,
            { key: key, heading: PANEL_HEADING });
    }

    function buildLayout(container, data) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        var summary = data.summary || {};
        var modelSummaries = summary.models || {};
        // One parameterised msgid rather than `sentiment.rated_<key>` per
        // model: a msgid per model needs a translation added in lockstep
        // with every rater-panel change, and renders the raw key when
        // that is missed. The model name is a proper noun and is not
        // translated anyway.
        root.appendChild(P.buildSummaryCards(
            [{ value: summary.total, labelKey: 'Articles' }].concat(
                MODELS.map(function (m) {
                    return {
                        value: (modelSummaries[m.key] || {}).rated,
                        labelKey: 'sentiment.rated_by',
                        labelParams: { model: m.label }
                    };
                })
            )
        ));

        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        // Global model lens for every single-model panel below.
        var modelFacetHost = P.el('div', 'iwac-vis-facet-host');
        root.appendChild(modelFacetHost);

        // -- Section: ratings over time --------------------------------
        root.appendChild(sectionHeading(P.t('sentiment.sec_time')));
        var timeGrid = P.buildChartsGrid();
        root.appendChild(timeGrid);

        // Named panels (S13): several panels below are conditional, and a
        // positional slug would renumber every embed permalink after them
        // the first time a bundle arrives without one of their sections.
        var polarityPanel = widePanel('sentiment.polarity_year_title',
            descWithAiNote('sentiment.polarity_year_desc'), 'polarity-by-year');
        var centralityPanel = widePanel('sentiment.centrality_year_title',
            descWithAiNote('sentiment.centrality_year_desc'), 'centrality-by-year');
        var subjectivityPanel = widePanel('sentiment.subjectivity_title',
            descWithAiNote('sentiment.subjectivity_desc'), 'subjectivity');

        // Dynamic "Non applicable" caption under the polarity timeline.
        var naNote = captionLine(polarityPanel, true);

        timeGrid.appendChild(polarityPanel.panel);
        timeGrid.appendChild(centralityPanel.panel);
        timeGrid.appendChild(subjectivityPanel.panel);

        // Cross-model trend (v0.4.0 bundles): every model at once, so it
        // carries its own target / period / cohort facets.
        var trendsPanel = null;
        if (S.trendTargets(data).length) {
            trendsPanel = widePanel('sentiment.trends_title',
                descWithAiNote('sentiment.trends_desc'), 'model-trends');
            trendsPanel.controls = controlsHost(trendsPanel, true);
            trendsPanel.caption = captionLine(trendsPanel, true);
            timeGrid.appendChild(trendsPanel.panel);
        }

        // -- Section: how the ratings break down -----------------------
        root.appendChild(sectionHeading(P.t('sentiment.sec_breakdown')));
        var breakdownGrid = P.buildChartsGrid();
        root.appendChild(breakdownGrid);

        var countryPanel = P.buildPanel('iwac-vis-panel',
            P.t('sentiment.polarity_country_title'), descWithAiNote('sentiment.polarity_country_desc'),
            { key: 'polarity-by-country', heading: PANEL_HEADING });
        var correlationPanel = P.buildPanel('iwac-vis-panel',
            P.t('sentiment.correlation_title'), descWithAiNote('sentiment.correlation_desc'),
            { key: 'correlation', heading: PANEL_HEADING });
        correlationPanel.caption = captionLine(correlationPanel, true);
        var cenHeatPanel = widePanel('sentiment.cenheat_title',
            descWithAiNote('sentiment.cenheat_desc'), 'centrality-heatmap');
        cenHeatPanel.controls = controlsHost(cenHeatPanel);
        cenHeatPanel.caption = captionLine(cenHeatPanel, true);

        breakdownGrid.appendChild(countryPanel.panel);
        breakdownGrid.appendChild(correlationPanel.panel);
        breakdownGrid.appendChild(cenHeatPanel.panel);

        // Polarity by topic / by newspaper (ROADMAP 9.2 / 9.3). Both elide
        // when the deployed bundle predates their generator sections, so
        // code can ship ahead of the next data pull.
        //
        // Both are diverging bars over thirty-odd rows, so they need the
        // room a row-per-category costs (--likert) and their own sort
        // control between the description and the chart.
        var topicPanel = null;
        var topicSortHost = null;
        if ((data.topics || []).length) {
            topicPanel = widePanel('sentiment.polarity_topic_title',
                // The bundle's own topic count, not a number in the copy: the
                // description said "30" whatever the model was refit with.
                descWithAiNote('sentiment.polarity_topic_desc', { count: data.topics.length }),
                'polarity-by-topic');
            topicPanel.chart.classList.add('iwac-vis-chart--likert');
            topicSortHost = controlsHost(topicPanel);
            breakdownGrid.appendChild(topicPanel.panel);
        }
        var newspaperPanel = null;
        var newspaperSortHost = null;
        if ((data.newspapers || []).length) {
            newspaperPanel = widePanel('sentiment.polarity_newspaper_title',
                P.t('sentiment.polarity_newspaper_desc', { min: data.newspaper_min || 50 })
                    + ' ' + P.t('sentiment.ai_note'),
                'polarity-by-newspaper');
            newspaperPanel.chart.classList.add('iwac-vis-chart--likert');
            newspaperSortHost = controlsHost(newspaperPanel);
            breakdownGrid.appendChild(newspaperPanel.panel);
        }

        // Newspaper ranking with intervals and the places map (v0.4.0).
        var rankingPanel = null;
        if (data.ranking && (data.ranking.newspapers || []).length) {
            rankingPanel = widePanel('sentiment.rank_title',
                descWithAiNote('sentiment.rank_desc'), 'newspaper-ranking');
            rankingPanel.controls = controlsHost(rankingPanel);
            rankingPanel.caption = captionLine(rankingPanel, true);
            breakdownGrid.appendChild(rankingPanel.panel);
        }
        var mapPanel = null;
        if (data.places_file && S.mountPlacesMap && P.createFilteredPlacesMap) {
            mapPanel = widePanel('sentiment.map_title',
                descWithAiNote('sentiment.map_desc'), 'places-map');
            mapPanel.controls = controlsHost(mapPanel);
            breakdownGrid.appendChild(mapPanel.panel);
        }

        // -- Section: extreme-article keywords -------------------------
        root.appendChild(sectionHeading(P.t('sentiment.sec_extremes')));
        var extremesGrid = P.buildChartsGrid();
        root.appendChild(extremesGrid);

        var extremesPanel = widePanel('sentiment.extremes_title',
            descWithAiNote('sentiment.extremes_desc'), 'extremes');
        // Controls sit between the description and the chart.
        var extremesControls = controlsHost(extremesPanel);
        var extremesNote = captionLine(extremesPanel, true);
        extremesGrid.appendChild(extremesPanel.panel);

        // -- Section: model comparison ---------------------------------
        // One dimension lens for the whole section; the pair lens lives in
        // the one panel it drives.
        root.appendChild(sectionHeading(P.t('sentiment.sec_compare')));
        var dimensionFacetHost = P.el('div', 'iwac-vis-facet-host');
        root.appendChild(dimensionFacetHost);
        var compareGrid = P.buildChartsGrid();
        root.appendChild(compareGrid);

        var pairsPanel = widePanel('sentiment.pairs_title',
            descWithAiNote('sentiment.pairs_desc'), 'model-pairs');
        pairsPanel.controls = controlsHost(pairsPanel);
        pairsPanel.caption = captionLine(pairsPanel, false);
        compareGrid.appendChild(pairsPanel.panel);

        var agreementPanel = widePanel('sentiment.agreement_title',
            descWithAiNote('sentiment.agreement_desc'), 'model-agreement');
        agreementPanel.controls = controlsHost(agreementPanel);
        agreementPanel.cards = P.el('div', 'iwac-vis-pair-cards');
        agreementPanel.panel.insertBefore(agreementPanel.cards, agreementPanel.chart);
        agreementPanel.caption = captionLine(agreementPanel, false);
        compareGrid.appendChild(agreementPanel.panel);

        var calibrationPanel = null;
        if (MODELS.every(function (m) { return (data.models[m.key] || {}).distribution; })) {
            calibrationPanel = widePanel('sentiment.calibration_title',
                descWithAiNote('sentiment.calibration_desc'), 'model-calibration');
            compareGrid.appendChild(calibrationPanel.panel);
        }
        var dissentPanel = null;
        if (data.consensus) {
            dissentPanel = widePanel('sentiment.dissent_title',
                descWithAiNote('sentiment.dissent_desc'), 'model-dissent');
            dissentPanel.cards = P.el('div', 'iwac-vis-pair-cards');
            dissentPanel.panel.insertBefore(dissentPanel.cards, dissentPanel.chart);
            compareGrid.appendChild(dissentPanel.panel);
        }

        return {
            root:               root,
            modelFacetHost:     modelFacetHost,
            polarityPanel:      polarityPanel,
            centralityPanel:    centralityPanel,
            subjectivityPanel:  subjectivityPanel,
            trendsPanel:        trendsPanel,
            countryPanel:       countryPanel,
            correlationPanel:   correlationPanel,
            cenHeatPanel:       cenHeatPanel,
            topicPanel:         topicPanel,
            topicSortHost:      topicSortHost,
            newspaperPanel:     newspaperPanel,
            newspaperSortHost:  newspaperSortHost,
            rankingPanel:       rankingPanel,
            mapPanel:           mapPanel,
            extremesPanel:      extremesPanel,
            extremesControls:   extremesControls,
            extremesNote:       extremesNote,
            dimensionFacetHost: dimensionFacetHost,
            pairsPanel:         pairsPanel,
            agreementPanel:     agreementPanel,
            calibrationPanel:   calibrationPanel,
            dissentPanel:       dissentPanel,
            naNote:             naNote
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    // The heatmap's minimum-articles-per-cell choices (1 = every cell).
    var MIN_CELLS = ['1', '5', '10', '25'];

    function render(container, data, ctx) {
        if (!data || !data.models || !data.summary || !data.summary.total) {
            container.innerHTML = '';
            container.appendChild(P.buildEmptyState());
            return;
        }

        // Must run before buildLayout and every option builder below —
        // they all read the module-level MODELS.
        if (!syncModels(data).length) {
            container.innerHTML = '';
            container.appendChild(P.buildEmptyState());
            return;
        }

        var firstCat = (data.extreme_categories || ['subjectivity_high'])[0];
        var dims = S.compareDimensions(data);
        function pairsOf(dim) {
            return (S.reliabilityFor(data, dim) || { pairs: [] }).pairs;
        }
        // A measure joins the pair matrix's facet only when the bundle has
        // it: a v0.3.0 bundle carries exact agreement alone.
        var firstPair = pairsOf(dims[0] || 'polarity')[0] || {};
        var metrics = S.PAIR_METRICS.filter(function (k) { return firstPair[k] != null; });
        var targets = S.trendTargets(data);
        var trendDefault = String((data.trends || {}).min_count || 5);
        var trendMins = S.TREND_MINIMUMS.indexOf(trendDefault) >= 0
            ? S.TREND_MINIMUMS : [trendDefault].concat(S.TREND_MINIMUMS);
        var state = {
            model: MODELS[0].key,
            pair: 0,
            exCategory: firstCat,
            exType: 'subject',
            // Most positive → most negative by default: the order that makes
            // the diverging bars readable as a gradient rather than a comb.
            topicSort: 'polarity',
            newspaperSort: 'polarity',
            minCell: MIN_CELLS[0],
            dimension: dims[0] || 'polarity',
            pairMetric: metrics[0] || 'exact',
            trendTarget: targets[0] || 'negative',
            trendPeriod: S.TREND_PERIODS[0],
            trendCohort: S.TREND_COHORTS[0],
            trendMin: trendDefault,
            rankMeasure: 'polarity',
            mapDim: 'polarity'
        };
        // The facets patch this store; the subscriptions below repaint what
        // each key drives. All of it is URL-addressable:
        // `?sentiment.model=gpt_5_6_luna&sentiment.dimension=centrality`.
        var store = P.createStore(state);
        var pairCount = pairsOf(state.dimension).length;
        var url = P.bindUrlState ? P.bindUrlState(store, {
            prefix: 'sentiment',
            keys: [
                { key: 'model', values: MODELS.map(function (m) { return m.key; }) },
                { key: 'pair', validate: function (v) {
                    return v >= 0 && v < pairCount && v === Math.floor(v);
                } },
                { key: 'exCategory', param: 'category',
                  values: data.extreme_categories || [firstCat] },
                { key: 'exType', param: 'type', values: ['subject', 'spatial'] },
                { key: 'topicSort', param: 'sort_topic', values: ['polarity', 'volume'] },
                { key: 'newspaperSort', param: 'sort_newspaper', values: ['polarity', 'volume'] },
                { key: 'minCell', param: 'min_cell', values: MIN_CELLS },
                { key: 'dimension', values: dims.length ? dims : ['polarity'] },
                { key: 'pairMetric', param: 'metric', values: metrics.length ? metrics : ['exact'] },
                { key: 'trendTarget', param: 'trend', values: targets.length ? targets : ['negative'] },
                { key: 'trendPeriod', param: 'period', values: S.TREND_PERIODS },
                { key: 'trendCohort', param: 'cohort', values: S.TREND_COHORTS },
                { key: 'trendMin', param: 'trend_min', values: trendMins },
                { key: 'rankMeasure', param: 'rank', values: S.DIMENSIONS },
                { key: 'mapDim', param: 'map', values: S.DIMENSIONS }
            ]
        }) : null;
        // Pinned once, over every model AND both breakdowns, so neither the
        // model facet nor the move between the two panels rescales the
        // ruler (see polarityExtent).
        var sharedExtent = polarityExtent(data);

        function topicOption() {
            return buildDivergingPolarity(data, state.model, 'topic', state.topicSort, sharedExtent);
        }
        function newspaperOption() {
            return buildDivergingPolarity(data, state.model, 'newspaper', state.newspaperSort, sharedExtent);
        }
        function heatmapOption() {
            return buildCentralityHeatmap(data, state.model, Number(state.minCell));
        }
        function repaint(host, option) {
            var live = host && ns.getLiveChart ? ns.getLiveChart(host) : null;
            if (!live) return;
            // A shape-aware merge: the series are replaced (so a re-sort
            // moves every row, by name, to its new slot) while the legend
            // toggles the reader set survive the model switch.
            if (ns.repaint) ns.repaint(live, option);
            else live.setOption(option, true);
        }
        // A full replace, for the panels whose axes change with a facet (a
        // dimension's five or six labels, a model's ranked titles): a merge
        // would keep the old categories' leftovers.
        function replace(host, option) {
            var live = host && ns.getLiveChart ? ns.getLiveChart(host) : null;
            if (live && option) live.setOption(option, true);
        }
        /** One facet bar into `host`; `apply(subKey)` on change. */
        function mountFacet(host, key, label, subFacets, current, apply, renderAs) {
            if (!host || !P.buildFacetButtons) return null;
            var bar = P.buildFacetButtons({
                facets: [{ key: key, label: label, subFacets: subFacets, renderAs: renderAs }],
                activeKey: key,
                activeSubKey: current,
                onChange: function (evt) { apply(evt.subFacet || current); }
            });
            host.appendChild(bar.root);
            return bar;
        }
        function dimensionFacets() {
            var out = {};
            S.DIMENSIONS.forEach(function (dim) { out[dim] = S.dimensionLabel(dim); });
            return out;
        }
        var h = buildLayout(container, data);

        function updateNaNote() {
            var model = data.models[state.model] || {};
            h.naNote.textContent = P.t('sentiment.na_note', {
                count: model.not_applicable || 0
            });
        }
        updateNaNote();

        function updateHeatmapCaption() {
            var hidden = heatmapHidden(data, state.model, Number(state.minCell));
            h.cenHeatPanel.caption.textContent = hidden
                ? P.t('sentiment.cenheat_hidden', { count: hidden, min: state.minCell })
                : '';
        }
        updateHeatmapCaption();

        function updateSpearman() {
            h.correlationPanel.caption.textContent = spearmanCaption(data, state.model);
        }
        updateSpearman();

        function renderExtremes() {
            repaint(h.extremesPanel.chart,
                buildExtremes(data, state.model, state.exCategory, state.exType));
            var bucket = ((data.models[state.model] || {}).extremes || {})[state.exCategory] || {};
            h.extremesNote.textContent = P.t('sentiment.extremes_n', {
                count: bucket.n || 0
            });
        }

        // -- Global model facet (drives every single-model panel) --
        if (P.buildFacetButtons) {
            var subFacets = {};
            MODELS.forEach(function (m) { subFacets[m.key] = m.label; });
            mountFacet(h.modelFacetHost, 'model', P.t('Model'), subFacets, state.model, function (key) {
                store.patch({ model: key || MODELS[0].key });
            }, 'buttons');
            if (url && P.buildCopyLinkButton) {
                h.modelFacetHost.appendChild(P.buildCopyLinkButton({ href: url.href }));
            }
        }

        // -- Ranking + map: the model lens and their own measure ---
        function rankingOption() {
            return S.rankingOption(data, state.model, state.rankMeasure);
        }
        function sizeRanking() {
            var rows = S.rankingRows(data, state.model, state.rankMeasure).length;
            h.rankingPanel.chart.style.height = S.rankingHeight(rows) + 'px';
            h.rankingPanel.caption.textContent = S.rankingCaption(data, state.model, state.rankMeasure);
        }
        function repaintRanking() {
            if (!h.rankingPanel) return;
            sizeRanking();
            var live = ns.getLiveChart ? ns.getLiveChart(h.rankingPanel.chart) : null;
            if (live) {
                live.resize();
                live.setOption(rankingOption(), true);
            }
        }
        var mapController = null;
        if (h.mapPanel) {
            mapController = S.mountPlacesMap(h.mapPanel, {
                url: ((ctx && ctx.dataBase) || P.DATA_BASE) + data.places_file,
                siteBase: (ctx && ctx.siteBase) || '',
                getState: function () { return { model: state.model, dim: state.mapDim }; }
            });
            mountFacet(h.mapPanel.controls, 'map', P.t('sentiment.measure'), dimensionFacets(),
                state.mapDim, function (dim) { store.patch({ mapDim: dim }); }, 'buttons');
            store.subscribe(function () { mapController.update(); }, { keys: ['mapDim'] });
        }

        store.subscribe(function () {
            updateNaNote();
            updateHeatmapCaption();
            updateSpearman();
            var faceted = [
                [h.polarityPanel.chart,    buildPolarityByYear],
                [h.centralityPanel.chart,  buildCentralityByYear],
                [h.countryPanel.chart,     buildPolarityByCountry],
                [h.correlationPanel.chart, buildCorrelation]
            ];
            faceted.forEach(function (pair) {
                repaint(pair[0], pair[1](data, state.model));
            });
            replace(h.cenHeatPanel.chart, heatmapOption());
            if (h.topicPanel) repaint(h.topicPanel.chart, topicOption());
            if (h.newspaperPanel) repaint(h.newspaperPanel.chart, newspaperOption());
            repaintRanking();
            if (mapController) mapController.update();
            renderExtremes();
        }, { keys: ['model'] });

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
            chart.setOption(heatmapOption(), true);
        });
        var minCellFacets = {};
        MIN_CELLS.forEach(function (v) {
            minCellFacets[v] = v === '1' ? P.t('sentiment.min_cell_all') : P.formatNumber(Number(v));
        });
        mountFacet(h.cenHeatPanel.controls, 'min_cell', P.t('sentiment.min_cell'), minCellFacets,
            state.minCell, function (v) { store.patch({ minCell: v }); }, 'buttons');
        store.subscribe(function () {
            replace(h.cenHeatPanel.chart, heatmapOption());
            updateHeatmapCaption();
        }, { keys: ['minCell'] });

        // -- Diverging polarity panels + their sort controls -------
        var sortFacets = {
            polarity: P.t('sentiment.sort_polarity'),
            volume: P.t('sentiment.sort_volume')
        };
        if (h.topicPanel) {
            ns.registerChart(h.topicPanel.chart, function (el, chart) {
                chart.setOption(topicOption(), true);
            });
            mountFacet(h.topicSortHost, 'sort', P.t('sentiment.sort_by'), sortFacets, state.topicSort,
                function (mode) { store.patch({ topicSort: mode }); }, 'buttons');
            store.subscribe(function () {
                repaint(h.topicPanel.chart, topicOption());
            }, { keys: ['topicSort'] });
        }
        if (h.newspaperPanel) {
            ns.registerChart(h.newspaperPanel.chart, function (el, chart) {
                chart.setOption(newspaperOption(), true);
            });
            mountFacet(h.newspaperSortHost, 'sort', P.t('sentiment.sort_by'), sortFacets, state.newspaperSort,
                function (mode) { store.patch({ newspaperSort: mode }); }, 'buttons');
            store.subscribe(function () {
                repaint(h.newspaperPanel.chart, newspaperOption());
            }, { keys: ['newspaperSort'] });
        }
        if (h.rankingPanel) {
            sizeRanking();
            ns.registerChart(h.rankingPanel.chart, function (el, chart) {
                chart.setOption(rankingOption(), true);
            });
            mountFacet(h.rankingPanel.controls, 'rank', P.t('sentiment.measure'), dimensionFacets(),
                state.rankMeasure, function (dim) { store.patch({ rankMeasure: dim }); }, 'buttons');
            store.subscribe(repaintRanking, { keys: ['rankMeasure'] });
        }

        // -- Subjectivity trend (all models at once) ---------------
        ns.registerChart(h.subjectivityPanel.chart, function (el, chart) {
            chart.setOption(buildSubjectivityOption(data), true);
        });

        // -- Cross-model trend (all models at once) ----------------
        if (h.trendsPanel) {
            var trendState = function () {
                return {
                    target: state.trendTarget, period: state.trendPeriod,
                    cohort: state.trendCohort, min: Number(state.trendMin)
                };
            };
            var trendOption = function () {
                return S.trendOption(data, trendState(), MODELS, modelColor);
            };
            var updateTrendCaption = function () {
                h.trendsPanel.caption.textContent = S.trendCaption(data, trendState());
            };
            ns.registerChart(h.trendsPanel.chart, function (el, chart) {
                chart.setOption(trendOption(), true);
            });
            updateTrendCaption();
            var targetFacets = {};
            targets.forEach(function (t) { targetFacets[t] = P.t('sentiment.trend_' + t); });
            mountFacet(h.trendsPanel.controls, 'trend', P.t('sentiment.trend_measure'), targetFacets,
                state.trendTarget, function (t) { store.patch({ trendTarget: t }); }, 'buttons');
            mountFacet(h.trendsPanel.controls, 'period', P.t('sentiment.trend_period'), {
                year: P.t('Year'), decade: P.t('Decade')
            }, state.trendPeriod, function (v) { store.patch({ trendPeriod: v }); }, 'buttons');
            mountFacet(h.trendsPanel.controls, 'cohort', P.t('sentiment.trend_cohort'), {
                common: P.t('sentiment.cohort_common'), available: P.t('sentiment.cohort_available')
            }, state.trendCohort, function (v) { store.patch({ trendCohort: v }); }, 'buttons');
            var minFacets = {};
            trendMins.forEach(function (v) { minFacets[v] = P.formatNumber(Number(v)); });
            mountFacet(h.trendsPanel.controls, 'trend_min', P.t('sentiment.trend_min'), minFacets,
                state.trendMin, function (v) { store.patch({ trendMin: v }); }, 'buttons');
            store.subscribe(function () {
                replace(h.trendsPanel.chart, trendOption());
                updateTrendCaption();
            }, { keys: ['trendTarget', 'trendPeriod', 'trendCohort', 'trendMin'] });
        }

        // -- Extreme-article keyword facets ------------------------
        if (P.buildFacetButtons) {
            var catFacets = {};
            (data.extreme_categories || []).forEach(function (cat) {
                catFacets[cat] = P.t('sentiment.cat_' + cat);
            });
            mountFacet(h.extremesControls, 'category', P.t('sentiment.extremes_category'), catFacets,
                state.exCategory, function (cat) { store.patch({ exCategory: cat || firstCat }); });
            mountFacet(h.extremesControls, 'type', P.t('sentiment.extremes_type'), {
                subject: P.t('sentiment.kw_subject'), spatial: P.t('sentiment.kw_spatial')
            }, state.exType, function (type) { store.patch({ exType: type || 'subject' }); }, 'buttons');
        }
        ns.registerChart(h.extremesPanel.chart, function (el, chart) {
            chart.setOption(buildExtremes(data, state.model, state.exCategory, state.exType), true);
        });
        store.subscribe(renderExtremes, { keys: ['exCategory', 'exType'] });
        renderExtremes();

        // -- Comparison section ------------------------------------
        if (!dims.length || !pairsOf(state.dimension).length) {
            [h.pairsPanel, h.agreementPanel].forEach(function (panel) {
                panel.chart.appendChild(P.buildEmptyState());
            });
            return;
        }

        function currentPair() {
            var pairs = pairsOf(state.dimension);
            return pairs[state.pair] || pairs[0];
        }

        if (dims.length > 1) {
            var dimFacets = {};
            dims.forEach(function (dim) { dimFacets[dim] = S.dimensionLabel(dim); });
            mountFacet(h.dimensionFacetHost, 'dimension', P.t('sentiment.measure'), dimFacets,
                state.dimension, function (dim) { store.patch({ dimension: dim }); }, 'buttons');
        }

        // Every pair: model × model matrix of one measure. A click on a
        // cell selects that pair for the panel below.
        var pairBar = null;
        if (metrics.length > 1) {
            var metricFacets = {};
            metrics.forEach(function (k) { metricFacets[k] = P.t('sentiment.metric_' + k); });
            mountFacet(h.pairsPanel.controls, 'metric', P.t('sentiment.metric'), metricFacets,
                state.pairMetric, function (k) { store.patch({ pairMetric: k }); }, 'buttons');
        }
        function pairsOption() {
            return S.pairMatrixOption(data, state.dimension, state.pairMetric, MODELS);
        }
        function updatePairsCaption() {
            h.pairsPanel.caption.textContent = S.panelCaption(data, state.dimension);
        }
        updatePairsCaption();
        ns.registerChart(h.pairsPanel.chart, function (el, chart) {
            chart.setOption(pairsOption(), true);
            chart.off('click');
            chart.on('click', function (p) {
                if (!p.data || p.data.pairIndex == null) return;
                store.patch({ pair: p.data.pairIndex });
                if (pairBar) pairBar.setActive('pair', String(p.data.pairIndex));
            });
        });

        // One pair: its measures + the label-by-label cross-tab.
        var pairs = pairsOf(state.dimension);
        if (P.buildFacetButtons && pairs.length > 1) {
            var pairFacets = {};
            pairs.forEach(function (entry, idx) {
                pairFacets[String(idx)] = modelLabel(entry.models[0])
                    + ' × ' + modelLabel(entry.models[1]);
            });
            pairBar = mountFacet(h.agreementPanel.controls, 'pair', P.t('Model comparison'), pairFacets,
                String(state.pair), function (v) { store.patch({ pair: parseInt(v, 10) || 0 }); }, 'buttons');
        }
        function renderPair() {
            var entry = currentPair();
            if (!entry) return;
            h.agreementPanel.cards.innerHTML = '';
            h.agreementPanel.cards.appendChild(S.pairCards(entry, state.dimension));
            h.agreementPanel.caption.textContent = P.t('sentiment.matrix_caption', {
                a: modelLabel(entry.models[0]),
                b: modelLabel(entry.models[1])
            });
        }
        function crossTabOption() {
            return S.crossTabOption(data, state.dimension, currentPair(), modelLabel);
        }
        renderPair();
        ns.registerChart(h.agreementPanel.chart, function (el, chart) {
            chart.setOption(crossTabOption(), true);
        });

        // Calibration and consensus, on the same dimension lens.
        if (h.calibrationPanel) {
            ns.registerChart(h.calibrationPanel.chart, function (el, chart) {
                chart.setOption(S.calibrationOption(data, state.dimension, MODELS), true);
            });
        }
        function renderConsensusCards() {
            if (!h.dissentPanel) return;
            h.dissentPanel.cards.innerHTML = '';
            h.dissentPanel.cards.appendChild(S.consensusCards(data, state.dimension));
        }
        if (h.dissentPanel) {
            renderConsensusCards();
            ns.registerChart(h.dissentPanel.chart, function (el, chart) {
                var option = S.dissentOption(data, state.dimension, MODELS);
                if (option) chart.setOption(option, true);
            });
        }

        store.subscribe(function () {
            renderPair();
            replace(h.agreementPanel.chart, crossTabOption());
        }, { keys: ['pair'] });
        store.subscribe(function () {
            replace(h.pairsPanel.chart, pairsOption());
        }, { keys: ['pairMetric'] });
        store.subscribe(function () {
            updatePairsCaption();
            replace(h.pairsPanel.chart, pairsOption());
            renderPair();
            replace(h.agreementPanel.chart, crossTabOption());
            if (h.calibrationPanel) {
                replace(h.calibrationPanel.chart, S.calibrationOption(data, state.dimension, MODELS));
            }
            if (h.dissentPanel) {
                renderConsensusCards();
                replace(h.dissentPanel.chart, S.dissentOption(data, state.dimension, MODELS));
            }
        }, { keys: ['dimension'] });
    }

    P.bootBlock({
        selector:       '.iwac-vis-sentiment-atlas',
        warnLabel:      'IWACVis sentiment atlas',
        requireECharts: true,
        load:           function (ctx) {
            return P.fetchJSON(ctx.dataBase + 'sentiment-atlas.json');
        },
        render:         render
    });
})();
