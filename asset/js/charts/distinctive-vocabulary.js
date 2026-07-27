/**
 * IWAC Visualizations — Distinctive Vocabulary block (orchestrator)
 *
 * Two corpus-linguistics views from one precomputed bundle
 * (`keyness.json`, built by `scripts/generate_keyness.py`):
 *
 *   Section A — Keyness. The vocabulary a country or a decade uses more
 *     than the rest of the collection does. Bars are the log-ratio effect
 *     size (log2 of the rate ratio), which is also the ranking: the
 *     generator uses Dunning log-likelihood only as the significance test.
 *     Plotting G² instead would just rank the corpus's most frequent words.
 *   Section B — Subject bursts. Intervals where coverage of a subject ran
 *     above its own base rate, from Kleinberg's 2-state automaton, drawn on
 *     the shared gantt so each burst reads as a span on a year axis.
 *
 * Neither view duplicates Term Trends, which answers "how often is this
 * word used". Keyness answers "where does it stand out"; bursts answer
 * "when did it erupt".
 *
 * The keyness section renders one slice at a time through the shared facet
 * bar (Country / Decade as main facets, the individual slices as
 * sub-facets) — thirty stacked bar panels would be unreadable, and the
 * comparison a reader makes is between slices, which a switch supports
 * better than a wall.
 *
 * Load order: after shared/panels.js, chart-options*.js, facet-buttons.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis distinctive vocabulary: missing panels or chartOptions');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    var FACET_LABEL = { country: 'Country', decade: 'Decade' };

    /* ----------------------------------------------------------------- */
    /*  Keyness                                                           */
    /* ----------------------------------------------------------------- */

    /**
     * Horizontal bars of log-ratio per term. The axis is the effect size,
     * not the count: a term can be distinctive on a few dozen occurrences,
     * and a count axis would bury it under the corpus's common words.
     */
    function keynessOption(slice) {
        var terms = (slice && slice.terms) || [];
        return {
            grid: C._grid({ left: 8, top: 8, bottom: 40, right: 56 }),
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var term = terms[p.dataIndex] || {};
                    var lines = ['<strong>' + P.escapeHtml(term.token || '') + '</strong>'];
                    if (term.rate_ratio != null) {
                        lines.push(P.t('keyness_tooltip_ratio', { ratio: term.rate_ratio }));
                    }
                    lines.push(P.t('keyness_tooltip_count', {
                        count: P.formatNumber(term.count || 0),
                        slice: P.escapeHtml(slice.name || '')
                    }));
                    lines.push(P.t('keyness_tooltip_stats', {
                        g2: P.formatNumber(Math.round(term.g2 || 0)),
                        q:  formatQ(term.q)
                    }));
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'value',
                name: P.t('keyness_axis'),
                nameLocation: 'middle',
                nameGap: 26
            },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLabel: { width: 160, overflow: 'truncate' },
                data: terms.map(function (t) { return t.token; })
            },
            series: [{
                type: 'bar',
                data: terms.map(function (t) { return t.log_ratio; }),
                barMaxWidth: 20,
                itemStyle: { borderRadius: [0, 4, 4, 0] },
                label: {
                    show: true,
                    position: 'right',
                    formatter: function (p) {
                        var term = terms[p.dataIndex] || {};
                        return term.rate_ratio != null
                            ? '×' + term.rate_ratio
                            : String(p.value);
                    }
                }
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
    }

    /** q-values run to 1e-40 — show an order of magnitude, not 40 zeros. */
    function formatQ(q) {
        if (typeof q !== 'number' || !isFinite(q)) return '—';
        if (q === 0) return '< 1e-300';
        if (q < 0.001) return '< 0.001';
        return q.toFixed(3);
    }

    function renderKeyness(root, data) {
        var keyness = data.keyness || {};
        var facets = [];
        Object.keys(FACET_LABEL).forEach(function (key) {
            var slices = (keyness[key] || []).filter(function (s) {
                return s && s.terms && s.terms.length > 0;
            });
            if (!slices.length) return;
            var subFacets = {};
            slices.forEach(function (s) { subFacets[s.name] = s.name; });
            facets.push({
                key: key,
                label: P.t(FACET_LABEL[key]),
                subFacets: subFacets,
                slices: slices
            });
        });
        if (!facets.length) return null;

        root.appendChild(P.el('h3', 'iwac-vis-section-heading', P.t('Distinctive vocabulary')));

        var params = data.params || {};
        var panel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('keyness_title'),
            P.t('keyness_desc', {
                ratio: ratioFromLogRatio(params.min_log_ratio),
                alpha: params.alpha != null ? params.alpha : 0.05,
                min:   P.formatNumber(params.min_count || 10)
            })
        );

        var state = { facet: facets[0].key, sub: facets[0].slices[0].name };

        function sliceFor() {
            var facet = facets.filter(function (f) { return f.key === state.facet; })[0];
            if (!facet) return null;
            var match = facet.slices.filter(function (s) { return s.name === state.sub; })[0];
            return match || facet.slices[0];
        }

        var bar = P.buildFacetButtons({
            facets: facets,
            activeKey: state.facet,
            onChange: function (next) {
                state.facet = next.facet;
                state.sub = next.subFacet;
                var live = ns.getLiveChart && ns.getLiveChart(panel.chart);
                var slice = sliceFor();
                if (live && slice) live.setOption(keynessOption(slice), true);
                updateCaption(slice);
            }
        });
        panel.panel.insertBefore(bar.root, panel.chart);

        // Slice size belongs next to the terms: "distinctive of Niger" over
        // 300 articles and over 3,000 are different strengths of claim.
        var caption = P.el('p', 'iwac-vis-panel-desc iwac-vis-keyness__caption');
        panel.panel.insertBefore(caption, panel.chart);

        function updateCaption(slice) {
            if (!slice) { caption.textContent = ''; return; }
            caption.textContent = P.t('keyness_slice_caption', {
                slice:  slice.name,
                docs:   P.formatNumber(slice.docs || 0),
                tokens: P.formatNumber(slice.tokens || 0),
                terms:  P.formatNumber((slice.terms || []).length)
            });
        }

        root.appendChild(panel.panel);
        var initial = sliceFor();
        updateCaption(initial);
        ns.registerChart(panel.chart, function (el, chart) {
            var slice = sliceFor();
            if (slice) chart.setOption(keynessOption(slice), true);
        });
        return panel;
    }

    /** log2 ratio → a plain multiplier for the panel copy ("1.5×"). */
    function ratioFromLogRatio(logRatio) {
        var value = typeof logRatio === 'number' ? logRatio : 0.585;
        return (Math.round(Math.pow(2, value) * 10) / 10).toString();
    }

    /* ----------------------------------------------------------------- */
    /*  Subject bursts                                                    */
    /* ----------------------------------------------------------------- */

    function renderBursts(root, data) {
        var bursts = data.bursts;
        var subjects = (bursts && bursts.subjects) || [];
        if (!subjects.length) return null;

        root.appendChild(P.el('h3', 'iwac-vis-section-heading', P.t('Coverage bursts')));

        var params = data.params || {};
        var panel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('bursts_title'),
            P.t('bursts_desc', {
                min: P.formatNumber(params.min_subject_total || 30),
                s:   params.burst_s != null ? params.burst_s : 2
            })
        );
        panel.chart.classList.add('iwac-vis-keyness__bursts');

        // One row per burst, not per subject: a subject the press returned
        // to twice has two separate episodes, and collapsing them into one
        // span from the first start to the last end would invent years of
        // intense coverage that never happened.
        var rows = [];
        subjects.forEach(function (entry) {
            (entry.bursts || []).forEach(function (burst) {
                rows.push({
                    name:      entry.subject,
                    year_min:  burst.start,
                    year_max:  burst.end,
                    total:     burst.mentions,
                    weight:    burst.weight,
                    subjectTotal: entry.total
                });
            });
        });
        rows.sort(function (a, b) { return b.weight - a.weight; });

        var caption = P.el('p', 'iwac-vis-panel-desc');
        caption.textContent = P.t('bursts_caption', {
            bursts:   P.formatNumber(rows.length),
            subjects: P.formatNumber(subjects.length),
            tested:   P.formatNumber(bursts.tested || 0),
            found:    P.formatNumber(bursts.with_bursts || 0)
        });
        panel.panel.insertBefore(caption, panel.chart);

        root.appendChild(panel.panel);
        ns.registerChart(panel.chart, function (el, chart) {
            var option = C.gantt(rows);
            // The shared gantt's tooltip is written for coverage spans; a
            // burst needs its own numbers (strength, mentions inside the
            // burst vs the subject's whole run).
            option.tooltip = {
                formatter: function (p) {
                    var row = rows[p.dataIndex] || {};
                    return [
                        '<strong>' + P.escapeHtml(row.name || '') + '</strong>',
                        P.t('bursts_tooltip_span', {
                            start: row.year_min, end: row.year_max
                        }),
                        P.t('bursts_tooltip_mentions', {
                            mentions: P.formatNumber(row.total || 0),
                            total:    P.formatNumber(row.subjectTotal || 0)
                        }),
                        P.t('bursts_tooltip_weight', { weight: row.weight })
                    ].join('<br>');
                }
            };
            chart.setOption(option, true);
        });
        if (P.addFullscreenButton) {
            P.addFullscreenButton(panel.panel, {
                onResize: function () {
                    var live = ns.getLiveChart && ns.getLiveChart(panel.chart);
                    if (live) live.resize();
                }
            });
        }
        return panel;
    }

    /* ----------------------------------------------------------------- */
    /*  Main controller                                                   */
    /* ----------------------------------------------------------------- */

    function render(container, data) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        var keynessPanel = renderKeyness(root, data || {});
        var burstsPanel  = renderBursts(root, data || {});

        // Both sections empty means the bundle predates the generator or the
        // corpus produced nothing significant — either way say so once
        // rather than showing two headings over blank panels.
        if (!keynessPanel && !burstsPanel) {
            root.appendChild(P.buildEmptyState());
        }
    }

    P.bootBlock({
        selector:       '.iwac-vis-keyness',
        warnLabel:      'IWACVis distinctive vocabulary',
        requireECharts: true,
        dataFile:       'keyness.json',
        beforeLoad:     function (container) {
            var loadingLabel = container.querySelector('.iwac-vis-loading span');
            if (loadingLabel) {
                loadingLabel.textContent = P.t('Loading distinctive vocabulary') + '…';
            }
        },
        render:         render
    });
})();
