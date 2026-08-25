/**
 * IWAC Visualizations — Sentiment Atlas block (controller)
 *
 * Corpus-level view of the AI sentiment ratings on the IWAC `articles`
 * subset. Loads a single precomputed JSON bundle from
 * `asset/data/sentiment-atlas.json` (built by
 * `scripts/generate_sentiment_atlas.py`) and renders all panels from
 * it.
 *
 * Every figure on this page is an AI-generated assessment (three rating
 * models: GPT-5.6 Luna, Mistral Small 4, DeepSeek V4 Flash), not
 * human-curated archival metadata — each panel description repeats that
 * caveat.
 *
 * Sections / panels (render order):
 *   Intro      — summary cards + "period covered" subtitle
 *   [Model]    — a single facet bar; the model lens for the panels below
 *   Over time  — polarity over time, centrality over time (both faceted),
 *                subjectivity trend (every model at once — the only panel
 *                here that does, hence the per-model colour tokens)
 *   Breakdown  — polarity by country, polarity × subjectivity, the
 *                centrality-by-country-and-year heatmap, and polarity by
 *                topic / by newspaper (all faceted). The last two are
 *                diverging bars — thirty-odd rows sharing a baseline at
 *                the neutral midpoint, each with its own order control
 *   Extremes   — top subject / place keywords in the most extreme-rated
 *                articles, with a sentiment-bucket + keyword-type facet
 *   Comparison — a model-pair facet driving cross-model agreement (cards +
 *                cross-tab heatmap)
 *
 * Polarité and centralité are both ORDINAL, so every panel that stacks
 * either one paints from a semantic ramp and never from the categorical
 * series palette ECharts assigns by default: `C.polarityPalette()` for the
 * `--iwac-vis-sent-*` diverging scale the person, entity and laïcité
 * dashboards already read, and `C.centralityPalette()` for the sequential
 * `--iwac-vis-cent-*` one.
 *
 * Load order: after shared/panels.js + shared/chart-options*.js +
 * shared/facet-buttons.js + sentiment-atlas/i18n.js (the block's en/fr
 * strings, split out so this file carries logic, not a translation table).
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
    function descWithAiNote(key) {
        return P.t(key) + ' ' + P.t('sentiment.ai_note');
    }

    /* ----------------------------------------------------------------- */
    /*  Theme-token colors                                                */
    /* ----------------------------------------------------------------- */

    /**
     * Model id → accent SLOT. The single place a model id meets a colour.
     *
     * The CSS tokens are `--iwac-vis-model-1..4`, named by position rather
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
                return P.t('sentiment.rated_n', { count: P.formatNumber(n) });
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
            topicPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('sentiment.polarity_topic_title'), descWithAiNote('sentiment.polarity_topic_desc'));
            topicPanel.chart.classList.add('iwac-vis-chart--likert');
            topicSortHost = P.el('div', 'iwac-vis-facet-host');
            topicPanel.panel.insertBefore(topicSortHost, topicPanel.chart);
            breakdownGrid.appendChild(topicPanel.panel);
        }
        var newspaperPanel = null;
        var newspaperSortHost = null;
        if ((data.newspapers || []).length) {
            newspaperPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('sentiment.polarity_newspaper_title'),
                P.t('sentiment.polarity_newspaper_desc', { min: data.newspaper_min || 50 })
                    + ' ' + P.t('sentiment.ai_note'));
            newspaperPanel.chart.classList.add('iwac-vis-chart--likert');
            newspaperSortHost = P.el('div', 'iwac-vis-facet-host');
            newspaperPanel.panel.insertBefore(newspaperSortHost, newspaperPanel.chart);
            breakdownGrid.appendChild(newspaperPanel.panel);
        }

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

        // -- Section: model comparison ---------------------------------
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
            topicPanel:        topicPanel,
            topicSortHost:     topicSortHost,
            newspaperPanel:    newspaperPanel,
            newspaperSortHost: newspaperSortHost,
            extremesPanel:     extremesPanel,
            extremesControls:  extremesControls,
            extremesNote:      extremesNote,
            pairFacetHost:     pairFacetHost,
            agreementPanel:    agreementPanel,
            matrixCaption:     matrixCaption,
            naNote:            naNote
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function render(container, data) {
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
        var state = {
            model: MODELS[0].key,
            pair: 0,
            exCategory: firstCat,
            exType: 'subject',
            // Most positive → most negative by default: the order that makes
            // the diverging bars readable as a gradient rather than a comb.
            topicSort: 'polarity',
            newspaperSort: 'polarity'
        };
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
        function repaint(host, option) {
            var live = host && ns.getLiveChart ? ns.getLiveChart(host) : null;
            // `true` — a diverging repaint reorders the category axis, and a
            // merged setOption would leave the previous row labels in place.
            if (live) live.setOption(option, true);
        }
        var h = buildLayout(container, data);

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
                    var faceted = [
                        [h.polarityPanel.chart,    buildPolarityByYear],
                        [h.centralityPanel.chart,  buildCentralityByYear],
                        [h.countryPanel.chart,     buildPolarityByCountry],
                        [h.correlationPanel.chart, buildCorrelation],
                        [h.cenHeatPanel.chart,     buildCentralityHeatmap]
                    ];
                    faceted.forEach(function (pair) {
                        var live = ns.getLiveChart ? ns.getLiveChart(pair[0]) : null;
                        if (live) live.setOption(pair[1](data, state.model), true);
                    });
                    if (h.topicPanel) repaint(h.topicPanel.chart, topicOption());
                    if (h.newspaperPanel) repaint(h.newspaperPanel.chart, newspaperOption());
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
        // -- Diverging polarity panels + their sort controls -------
        function mountSortControl(host, current, apply) {
            if (!host || !P.buildFacetButtons) return;
            var bar = P.buildFacetButtons({
                facets: [{
                    key: 'sort',
                    label: P.t('sentiment.sort_by'),
                    subFacets: {
                        polarity: P.t('sentiment.sort_polarity'),
                        volume: P.t('sentiment.sort_volume')
                    },
                    renderAs: 'buttons'
                }],
                activeKey: 'sort',
                onChange: function (evt) { apply(evt.subFacet || current); }
            });
            host.appendChild(bar.root);
        }

        if (h.topicPanel) {
            ns.registerChart(h.topicPanel.chart, function (el, chart) {
                chart.setOption(topicOption(), true);
            });
            mountSortControl(h.topicSortHost, state.topicSort, function (mode) {
                state.topicSort = mode;
                repaint(h.topicPanel.chart, topicOption());
            });
        }
        if (h.newspaperPanel) {
            ns.registerChart(h.newspaperPanel.chart, function (el, chart) {
                chart.setOption(newspaperOption(), true);
            });
            mountSortControl(h.newspaperSortHost, state.newspaperSort, function (mode) {
                state.newspaperSort = mode;
                repaint(h.newspaperPanel.chart, newspaperOption());
            });
        }

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

        // -- Comparison section ------------------------------------
        var agreement = data.agreement || [];
        if (agreement.length === 0) {
            h.agreementPanel.chart.appendChild(
                P.buildEmptyState());
            return;
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
        }

        // Pairwise % cards (all pairs) + caption above the matrix.
        h.agreementPanel.panel.insertBefore(
            buildAgreementCards(agreement), h.agreementPanel.chart);
        h.agreementPanel.panel.insertBefore(h.matrixCaption, h.agreementPanel.chart);

        // One pair facet drives the cross-tab matrix.
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

        // Seed the comparison caption (charts self-render on register).
        renderComparison();
    }

    P.bootBlock({
        selector:       '.iwac-vis-sentiment-atlas',
        warnLabel:      'IWACVis sentiment atlas',
        requireECharts: true,
        beforeLoad:     function (container) {
            var loadingLabel = container.querySelector('.iwac-vis-loading span');
            if (loadingLabel) loadingLabel.textContent = P.t('Loading sentiment atlas') + '…';
        },
        load:           function (ctx) {
            return P.fetchJSON(ctx.dataBase + 'sentiment-atlas.json');
        },
        render:         render
    });
})();
