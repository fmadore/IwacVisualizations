/**
 * IWAC Visualizations — Laïcité block: Framing (issue #14, view 9).
 *
 * How the press frames laïcité, through the multi-model AI sentiment
 * annotation already in the dataset. `articles` only — no other subset
 * carries it. The rater roster comes from the bundle's own `models`
 * array, so a model added upstream appears here without a code change.
 *
 * Three decisions the panel is built around:
 *
 *   1. **Everything is compared against the whole press corpus.** A polarity
 *      breakdown on its own is unreadable as evidence: "37% positive" means
 *      nothing until you know what the other 12,000 articles look like. The
 *      generator ships that baseline, so every distribution here is a pair.
 *   2. **Subjectivity is a distribution, never a mean.** The corpus mean sits
 *      near 3, and almost nothing does — the ratings pile at 2 and at 4. The
 *      mean lands in the trough between a factual register and a polemical
 *      one and describes neither.
 *   3. **The models are shown one at a time, never averaged.** They
 *      disagree; averaging would hide both the disagreement and the fact
 *      that these are model outputs rather than catalogued metadata.
 *
 * Per the repo's CLAUDE.md, model output carries explicit visual marking so
 * a reader can tell a computational artefact from archival description.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite sentiment: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    /** Canonical scale order, most positive first — matches sentiment-atlas. */
    var POLARITY_ORDER = [
        'Très positif', 'Positif', 'Neutre', 'Négatif', 'Très négatif',
        'Non applicable'
    ];

    L.sentimentModels = function (bundle) {
        return ((bundle || {}).models || []).slice();
    };

    function readVar(name, fallback) {
        var value = ns.resolveCssVar ? ns.resolveCssVar(name) : '';
        return value || fallback;
    }

    /** Polarity label → colour, from the shared divergent tokens. */
    function polarityColors() {
        return {
            'Très positif':   readVar('--iwac-vis-sent-pos-strong', '#23703f'),
            'Positif':        readVar('--iwac-vis-sent-pos', '#2e9052'),
            'Neutre':         readVar('--iwac-vis-sent-neutral', '#66696e'),
            'Négatif':        readVar('--iwac-vis-sent-neg', '#de7000'),
            'Très négatif':   readVar('--iwac-vis-sent-neg-strong', '#c9222b'),
            'Non applicable': readVar('--iwac-vis-sent-na', '#ced1d6')
        };
    }

    function pct(n, d) { return d ? (n / d) * 100 : 0; }

    function totalOf(dist) {
        return Object.keys(dist || {}).reduce(function (s, k) {
            return s + (dist[k] || 0);
        }, 0);
    }

    /**
     * @param {Object} cfg {bundle, state}
     * @returns {{root: HTMLElement, mount: function():void}}
     */
    L.buildSentiment = function (cfg) {
        var bundle = cfg.bundle;
        var root = P.el('div', 'iwac-vis-laicite-sentiment');
        var mounts = [];

        var panel = P.el('div', 'iwac-vis-panel');
        panel.appendChild(P.el('h4', null, P.t('laicite.sentiment_title')));
        panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.sentiment_desc')));

        if (!bundle || !(bundle.models || []).length) {
            panel.appendChild(P.buildNoDataState());
            root.appendChild(panel);
            return { root: root, mount: function () {} };
        }

        var model = cfg.state.sentModel;
        if ((bundle.models || []).indexOf(model) === -1) model = bundle.models[0];
        var data = (bundle.by_model || {})[model] || {};

        // The AI marker, first thing in the panel. Everything below it is
        // model output; the reader is told once, prominently, rather than
        // through a footnote they may never reach.
        panel.appendChild(buildAiNotice(bundle, data, model));

        panel.appendChild(buildPolarityComparison(data));
        // The chart panels are SIBLINGS of the intro panel, never children:
        // `.iwac-vis-panel` carries its own border and padding, so nesting
        // would draw a box inside a box for every chart.
        root.appendChild(panel);

        // `iwac-vis-panel` first — iwac-core.css hangs the chart host's
        // height floor off `.iwac-vis-panel > .iwac-vis-chart`.
        var subj = P.buildPanel('iwac-vis-panel iwac-vis-laicite-subj',
            P.t('laicite.subjectivity_title'), P.t('laicite.subjectivity_desc'));
        root.appendChild(subj.panel);
        mounts.push(function () {
            ns.registerChart(subj.chart, function (el, instance) {
                instance.setOption(subjectivityOption(data), { notMerge: true });
            });
        });

        // Register — the follow-up the subjectivity panel above provokes
        // and cannot answer. Sits directly after it because it is only
        // legible as a continuation of that finding.
        if (hasRegister(data)) {
            var register = P.buildPanel('iwac-vis-panel iwac-vis-laicite-register',
                P.t('laicite.register_title'), P.t('laicite.register_desc'));
            register.panel.appendChild(P.el('p', 'iwac-vis-panel-desc',
                P.t('laicite.register_note')));
            root.appendChild(register.panel);
            mounts.push(function () {
                ns.registerChart(register.chart, function (el, instance) {
                    instance.setOption(registerOption(data), { notMerge: true });
                });
            });
        }

        var decades = P.buildPanel('iwac-vis-panel iwac-vis-laicite-pol-decade',
            P.t('laicite.polarity_decade_title'),
            P.t('laicite.polarity_decade_desc'));
        root.appendChild(decades.panel);
        mounts.push(function () {
            ns.registerChart(decades.chart, function (el, instance) {
                instance.setOption(stackedOption(
                    (function () {
                        var byDecade = data.polarity_by_decade || {};
                        var keys = Object.keys(byDecade).sort();
                        return {
                            categories: keys,
                            rows: keys.map(function (k) { return byDecade[k]; })
                        };
                    })(),
                    { horizontal: false }
                ), { notMerge: true });
            });
        });

        var papers = (data.by_newspaper || []);
        if (papers.length) {
            var byPaper = P.buildPanel('iwac-vis-panel iwac-vis-laicite-pol-paper',
                P.t('laicite.polarity_paper_title'),
                P.t('laicite.polarity_paper_desc', {
                    min: bundle.min_newspaper_items
                }));
            root.appendChild(byPaper.panel);
            mounts.push(function () {
                ns.registerChart(byPaper.chart, function (el, instance) {
                    var top = papers.slice(0, 20).slice().reverse();
                    instance.setOption(stackedOption({
                        categories: top.map(function (p) { return p.newspaper; }),
                        rows: top.map(function (p) { return p.polarity; })
                    }, { horizontal: true }), { notMerge: true });
                });
            });
        }

        return {
            root: root,
            mount: function () { mounts.forEach(function (fn) { fn(); }); }
        };
    };

    /** The explicit "this is model output" block. */
    function buildAiNotice(bundle, data, model) {
        var box = P.el('div', 'iwac-vis-laicite-ai');
        var head = P.el('div', 'iwac-vis-laicite-ai-head');
        head.appendChild(P.el('span', 'iwac-vis-laicite-ai-badge', '✦'));
        head.appendChild(P.el('span', 'iwac-vis-laicite-ai-title',
            P.t('laicite.ai_title')));
        box.appendChild(head);
        box.appendChild(P.el('p', 'iwac-vis-laicite-ai-body',
            P.t('laicite.ai_note')));
        box.appendChild(P.el('p', 'iwac-vis-laicite-ai-stats',
            P.t('laicite.sentiment_coverage', {
                model: P.sentimentModelLabel(model),
                rated: P.formatNumber(data.rated || 0),
                items: P.formatNumber(bundle.items || 0),
                corpus: P.formatNumber((data.corpus || {}).rated || 0)
            })));
        return box;
    }

    /**
     * Polarity as two proportional bands: the dossier over the whole press
     * corpus. Built in DOM rather than as a fourth chart — it is two rows of
     * six segments, it needs to be readable to a screen reader, and the Venn
     * at the top of the block already established the idiom.
     */
    function buildPolarityComparison(data) {
        var colors = polarityColors();
        var wrap = P.el('div', 'iwac-vis-laicite-polarity');
        wrap.appendChild(P.el('h5', 'iwac-vis-laicite-polarity-title',
            P.t('laicite.polarity_title')));
        wrap.appendChild(P.el('p', 'iwac-vis-panel-desc',
            P.t('laicite.polarity_desc')));

        [
            { key: 'laicite.polarity_row_dossier', dist: data.polarity || {} },
            { key: 'laicite.polarity_row_corpus',
              dist: (data.corpus || {}).polarity || {} }
        ].forEach(function (row) {
            var total = totalOf(row.dist);
            var line = P.el('div', 'iwac-vis-laicite-polarity-row');
            line.appendChild(P.el('span', 'iwac-vis-laicite-polarity-label',
                P.t(row.key)));
            var bar = P.el('div', 'iwac-vis-laicite-polarity-bar');
            bar.setAttribute('role', 'img');
            var readout = [];
            POLARITY_ORDER.forEach(function (label) {
                var n = row.dist[label] || 0;
                if (!n) return;
                var share = pct(n, total);
                var seg = P.el('span', 'iwac-vis-laicite-polarity-seg');
                seg.style.width = share + '%';
                seg.style.backgroundColor = colors[label];
                seg.title = P.t(label) + ': ' + P.formatNumber(n)
                    + ' (' + share.toFixed(1) + '%)';
                bar.appendChild(seg);
                readout.push(P.t(label) + ' ' + share.toFixed(0) + '%');
            });
            bar.setAttribute('aria-label', P.t(row.key) + ' — ' + readout.join(', '));
            line.appendChild(bar);
            wrap.appendChild(line);
        });

        var legend = P.el('p', 'iwac-vis-laicite-polarity-legend');
        POLARITY_ORDER.forEach(function (label) {
            var chip = P.el('span', 'iwac-vis-laicite-polarity-key');
            var dot = P.el('span', 'iwac-vis-laicite-polarity-dot');
            dot.style.backgroundColor = colors[label];
            chip.appendChild(dot);
            chip.appendChild(document.createTextNode(P.t(label)));
            legend.appendChild(chip);
        });
        wrap.appendChild(legend);
        return wrap;
    }

    /**
     * Subjectivity 1–5, dossier against corpus, as SHARES so the two
     * populations (a few hundred vs twelve thousand) sit on one axis.
     */
    function subjectivityOption(data) {
        var mine = data.subjectivity || [];
        var base = (data.corpus || {}).subjectivity || [];
        var mineTotal = mine.reduce(function (s, n) { return s + n; }, 0);
        var baseTotal = base.reduce(function (s, n) { return s + n; }, 0);
        if (!mineTotal && !baseTotal) return P.emptyChartOption();

        var palette = (ns.getPalette && ns.getPalette()) || [];
        var levels = ['1', '2', '3', '4', '5'];
        var R = ns.responsive;
        var base_ = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({ left: 56, top: 44, bottom: 52 })
                : { left: 56, right: 24, top: 44, bottom: 52, containLabel: true },
            legend: { top: 4 },
            tooltip: {
                trigger: 'axis',
                confine: true,
                valueFormatter: function (v) {
                    return (v == null ? '—' : v.toFixed(1) + '%');
                }
            },
            xAxis: {
                type: 'category',
                data: levels,
                name: P.t('laicite.subjectivity_axis'),
                nameLocation: 'middle',
                nameGap: 30
            },
            yAxis: Object.assign({ type: 'value' },
                (ns.chartOptions && ns.chartOptions._valueAxisName)
                    ? ns.chartOptions._valueAxisName(P.t('laicite.share_percent'))
                    : { name: P.t('laicite.share_percent') }),
            series: [
                {
                    name: P.t('laicite.polarity_row_dossier'),
                    type: 'bar',
                    itemStyle: { color: palette[0] },
                    data: levels.map(function (_, i) {
                        return Math.round(pct(mine[i] || 0, mineTotal) * 10) / 10;
                    })
                },
                {
                    name: P.t('laicite.polarity_row_corpus'),
                    type: 'bar',
                    itemStyle: { color: readVar('--iwac-vis-sent-neutral', '#66696e') },
                    data: levels.map(function (_, i) {
                        return Math.round(pct(base[i] || 0, baseTotal) * 10) / 10;
                    })
                }
            ]
        };
        return R && R.withMedia ? R.withMedia(base_, {}) : base_;
    }

    /* ----------------------------------------------------------------- */
    /*  Register                                                          */
    /* ----------------------------------------------------------------- */

    /** Any level with at least one scored article on either metric. */
    function hasRegister(data) {
        return (data.register || []).some(function (row) {
            var d = row.dossier || {};
            return (d.readability_n || 0) > 0 || (d.richness_n || 0) > 0;
        });
    }

    /**
     * Readability and lexical richness across the five subjectivity
     * levels, dossier against the whole press corpus.
     *
     * The subjectivity panel above establishes that the dossier is
     * bimodal — a factual register and a polemical one. It cannot say
     * whether those two registers differ in anything except the rating
     * that defined them. These are the two columns that can: Flesch
     * reading-ease and MATTR lexical richness, both precomputed upstream.
     *
     * Two y-axes because the scales are unrelated (Flesch runs roughly
     * 0–100, MATTR 0–1) — sharing one would flatten richness into a line
     * along the floor. Encoding is metric = colour, source = dash, so the
     * four series read as two pairs rather than four unrelated lines.
     *
     * The corpus reference is what makes it a finding rather than a
     * number: if readability falls with subjectivity in the press at
     * large too, then the dossier's polemical register is just what
     * polemic looks like, and only a divergence between the two lines
     * says anything about laïcité coverage specifically.
     */
    function registerOption(data) {
        var rows = data.register || [];
        if (!rows.length) return P.emptyChartOption();

        var palette = (ns.getPalette && ns.getPalette()) || [];
        var muted = readVar('--iwac-vis-sent-neutral', '#66696e');
        var levels = rows.map(function (r) { return String(r.level); });

        function pick(source, metric) {
            return rows.map(function (r) {
                var slice = r[source] || {};
                // null, never 0: a level nobody wrote in is a gap in the
                // line, and 0 on a Flesch axis is a legible reading score.
                var value = slice[metric];
                return (value == null) ? null : value;
            });
        }
        function counts(source, metric) {
            return rows.map(function (r) {
                return ((r[source] || {})[metric + '_n']) || 0;
            });
        }

        var series = [
            { key: 'readability', source: 'dossier', axis: 0, color: palette[0],
              nameKey: 'laicite.register_read_dossier', dashed: false },
            { key: 'readability', source: 'corpus',  axis: 0, color: muted,
              nameKey: 'laicite.register_read_corpus',  dashed: true },
            { key: 'richness',    source: 'dossier', axis: 1, color: palette[1],
              nameKey: 'laicite.register_rich_dossier', dashed: false },
            { key: 'richness',    source: 'corpus',  axis: 1, color: muted,
              nameKey: 'laicite.register_rich_corpus',  dashed: true }
        ].map(function (s) {
            return {
                name: P.t(s.nameKey),
                type: 'line',
                yAxisIndex: s.axis,
                connectNulls: false,
                symbol: 'circle',
                symbolSize: 6,
                itemStyle: { color: s.color },
                lineStyle: {
                    color: s.color,
                    width: 2,
                    type: s.dashed ? 'dashed' : 'solid'
                },
                data: pick(s.source, s.key),
                // Carried through so the tooltip can put n beside every
                // mean. The end levels thin out fast — a mean over thirty
                // articles drawn like a mean over four hundred invites a
                // reading the data will not carry.
                _n: counts(s.source, s.key)
            };
        });

        var R = ns.responsive;
        var option = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({ left: 56, right: 64, top: 56, bottom: 52 })
                : { left: 56, right: 64, top: 56, bottom: 52, containLabel: true },
            legend: { type: 'scroll', top: 4 },
            tooltip: {
                trigger: 'axis',
                confine: true,
                formatter: function (params) {
                    if (!params || !params.length) return '';
                    var lines = ['<strong>' +
                        P.escapeHtml(P.t('laicite.register_level',
                            { level: params[0].axisValue })) + '</strong>'];
                    params.forEach(function (p) {
                        var s = series[p.seriesIndex] || {};
                        var n = (s._n || [])[p.dataIndex] || 0;
                        var value = (p.value == null)
                            ? '—'
                            : P.t('laicite.register_value', {
                                value: P.formatNumber(p.value),
                                count: P.formatNumber(n)
                            });
                        lines.push(p.marker + ' ' +
                            P.escapeHtml(p.seriesName) + ': ' + value);
                    });
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'category',
                data: levels,
                name: P.t('laicite.subjectivity_axis'),
                nameLocation: 'middle',
                nameGap: 30
            },
            yAxis: [
                { type: 'value', name: P.t('laicite.register_readability'),
                  nameLocation: 'end', nameGap: 12, scale: true },
                { type: 'value', name: P.t('laicite.register_richness'),
                  nameLocation: 'end', nameGap: 12, scale: true,
                  splitLine: { show: false } }
            ],
            series: series
        };
        return R && R.withMedia ? R.withMedia(option, {}) : option;
    }

    /**
     * 100%-stacked polarity for a set of categories (decades or outlets).
     * Always normalised: the categories differ in size by an order of
     * magnitude and raw stacks would rank them by volume, which is the one
     * thing this chart is not about.
     */
    function stackedOption(input, opts) {
        var categories = input.categories || [];
        var rows = input.rows || [];
        if (!categories.length) return P.emptyChartOption();
        var colors = polarityColors();
        var horizontal = !!opts.horizontal;

        var totals = rows.map(totalOf);
        var series = POLARITY_ORDER.map(function (label) {
            return {
                name: P.t(label),
                type: 'bar',
                stack: 'polarity',
                itemStyle: { color: colors[label] },
                emphasis: { focus: 'series' },
                data: rows.map(function (dist, i) {
                    return Math.round(pct((dist || {})[label] || 0, totals[i]) * 10) / 10;
                })
            };
        });

        var valueAxis = {
            type: 'value',
            max: 100,
            axisLabel: { formatter: '{value}%' }
        };
        var catAxis = { type: 'category', data: categories };
        var R = ns.responsive;
        var base = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({
                    left: horizontal ? 140 : 56, top: 44, bottom: 44
                })
                : { left: horizontal ? 140 : 56, right: 24, top: 44,
                    bottom: 44, containLabel: true },
            legend: { type: 'scroll', top: 4 },
            tooltip: {
                trigger: 'axis',
                confine: true,
                axisPointer: { type: 'shadow' },
                valueFormatter: function (v) {
                    return (v == null ? '—' : v.toFixed(1) + '%');
                }
            },
            xAxis: horizontal ? valueAxis : catAxis,
            yAxis: horizontal ? catAxis : valueAxis,
            series: series
        };
        return R && R.withMedia ? R.withMedia(base, {}) : base;
    }
})();
