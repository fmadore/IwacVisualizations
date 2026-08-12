/**
 * IWAC Visualizations — Periodicals Overview: LDA topics panels
 *
 * Three panels over the `topics` section of `periodicals-overview.json`
 * (built by `generate_periodicals_overview.py::compute_topics`):
 *
 *   1. Topics over time    stacked area of each topic's mean probability
 *                          mass per year — NOT normalised to 100%.
 *   2. Topics in the       horizontal bar of mean mass across the corpus,
 *      collection          with the mixture-vs-dominant gap in the tooltip.
 *                          Clicking a bar drives panel 3.
 *   3. Representative      card strip for the selected topic, ranked by
 *      issues              that topic's share of each issue.
 *
 * **Why there is no dominant-topic view here, unlike the articles Topic
 * Explorer.** That block offers both weightings because both are
 * defensible on whole-document LDA over single news stories. On
 * `publications` the mean dominant-topic probability is 0.345: a typical
 * issue reads `14:0.2749|16:0.1160|11:0.0890`, so "this issue is about
 * topic 14" is false about two thirds of the time. A periodical issue is
 * a miscellany. Offering a dominant-label view would be offering a wrong
 * answer with a toggle next to it, so the mixture is the only view — and
 * the panels state the number that makes it necessary.
 *
 * The stack is deliberately NOT rescaled to fill the axis. Only each
 * issue's top k=3 topics are on the Hub, so the stack tops out at the
 * captured mass and the headroom to 100% *is* the tail the data does not
 * carry. See `iwac_utils.aggregate_prevalence`.
 *
 * Load order: after shared/panels.js + shared/chart-options.js, before
 * the periodicals-overview orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.periodicals-overview/topics: missing dependencies');
        return;
    }

    // Past a dozen bands the stack stops being readable and the legend
    // wraps over the plot; the remainder folds into one "Other topics"
    // band rather than being dropped. Matches the Topic Explorer's river.
    var RIVER_TOP = 12;
    var MAX_BARS = 20;
    var MAX_CARDS = 10;

    /* ----------------------------------------------------------------- */
    /*  Shared helpers                                                    */
    /* ----------------------------------------------------------------- */

    function topicName(topic) {
        return P.topicShortLabel(topic.label, topic.id) || (P.t('Topic') + ' ' + topic.id);
    }

    function pct(value) {
        return Math.round(1000 * (value || 0)) / 10;
    }

    /** Fold the long tail into a single "Other topics" band. */
    function foldTail(defs, yearCount) {
        if (defs.length <= RIVER_TOP) return defs;
        var kept = defs.slice(0, RIVER_TOP);
        var other = new Array(yearCount);
        for (var i = 0; i < yearCount; i++) other[i] = 0;
        defs.slice(RIVER_TOP).forEach(function (d) {
            d.values.forEach(function (v, i) { other[i] += v; });
        });
        kept.push({ id: null, name: P.t('topic_other'), values: other });
        return kept;
    }

    /* ----------------------------------------------------------------- */
    /*  1. Topics over time                                               */
    /* ----------------------------------------------------------------- */

    function prevalenceOption(prevalence, byId) {
        var years = (prevalence.years || []).map(String);
        var defs = (prevalence.series || []).map(function (s) {
            var topic = byId[s.id] || { id: s.id, label: s.label };
            return { id: s.id, name: topicName(topic), values: (s.values || []).slice() };
        });
        defs = foldTail(defs, years.length);

        return {
            grid: C._grid({ left: 48, top: 40, bottom: 56 }),
            legend: { type: 'scroll', top: 0 },
            tooltip: {
                trigger: 'axis',
                formatter: C.sortedAxisTooltip({
                    skip: function (p, i) {
                        var def = defs[p.seriesIndex];
                        return !def || !def.values[i];
                    },
                    row: function (p) {
                        return p.marker + ' ' + P.escapeHtml(p.seriesName) + ' — ' + p.value + ' %';
                    },
                    // The per-year issue count is what makes a thin early
                    // year readable as thin rather than as a real signal.
                    footer: function (i) {
                        return P.t('periodicals.topics_year_issues', {
                            count: P.formatNumber((prevalence.n_docs || [])[i] || 0)
                        });
                    }
                })
            },
            xAxis: {
                type: 'category',
                data: years,
                boundaryGap: false,
                name: P.t('Year')
            },
            yAxis: {
                type: 'value',
                min: 0,
                // Left at 100 on purpose: the gap between the top of the
                // stack and the axis is the truncated tail, and rescaling
                // would hide a known partial measurement.
                max: 100,
                axisLabel: { formatter: function (v) { return v + ' %'; } }
            },
            dataZoom: C._dataZoom(years.length),
            series: defs.map(function (d) {
                return {
                    name: d.name,
                    type: 'line',
                    stack: 'mass',
                    areaStyle: { opacity: 0.85 },
                    lineStyle: { width: 0.5 },
                    symbol: 'none',
                    emphasis: { focus: 'series' },
                    data: d.values.map(pct)
                };
            })
        };
    }

    /* ----------------------------------------------------------------- */
    /*  2. Topics in the collection                                       */
    /* ----------------------------------------------------------------- */

    function rankingOption(topics) {
        var list = topics.slice(0, MAX_BARS);
        return {
            grid: C._grid({ left: 8, top: 8, bottom: 8, right: 48 }),
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    var topic = list[p.dataIndex] || {};
                    var lines = ['<strong>' + P.escapeHtml(topic.label || topicName(topic)) + '</strong>'];
                    lines.push(P.t('periodicals.topics_bar_tip', {
                        mass: pct(topic.mean_mass),
                        issues: P.formatNumber(topic.issues || 0)
                    }));
                    // The gap between "appears in" and "is the best label
                    // for" is the evidence for reading mixtures at all, so
                    // it goes in the tooltip rather than being implied.
                    lines.push(P.t('periodicals.topics_bar_dominant', {
                        dominant: P.formatNumber(topic.dominant_count || 0)
                    }));
                    // A theme in 588 issues of one magazine and a theme in
                    // 588 issues of twelve are different findings.
                    if (topic.periodicals) {
                        lines.push(P.t('periodicals.topics_bar_periodicals', {
                            periodicals: P.formatNumber(topic.periodicals)
                        }));
                    }
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'value',
                axisLabel: { formatter: function (v) { return v + ' %'; } }
            },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLabel: { width: 200, overflow: 'truncate' },
                data: list.map(topicName)
            },
            series: [{
                type: 'bar',
                data: list.map(function (t) { return pct(t.mean_mass); }),
                barMaxWidth: 22,
                itemStyle: { borderRadius: [0, 4, 4, 0] },
                label: {
                    show: true,
                    position: 'right',
                    formatter: function (p) { return p.value + ' %'; }
                }
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };
    }

    /* ----------------------------------------------------------------- */
    /*  3. Representative issues                                          */
    /* ----------------------------------------------------------------- */

    /**
     * Cards for one topic's most representative issues.
     *
     * Reuses the shared similar-card look, but the score is a topic
     * *share*, not a similarity — an issue can be 27% this topic and
     * still be the best example of it. Issues where the topic merely runs
     * a strong second are the interesting ones here, so cards that are
     * not the issue's dominant topic are labelled rather than filtered.
     */
    function buildIssueCards(topic, siteBase) {
        var strip = P.el('div', 'iwac-vis-similar-strip');
        var items = (topic.items || []).slice(0, MAX_CARDS);

        items.forEach(function (item) {
            var card = P.el('a', 'iwac-vis-similar-card');
            if (item.o_id && siteBase) {
                card.href = siteBase + '/item/' + encodeURIComponent(item.o_id);
            } else {
                card.href = '#';
                card.setAttribute('aria-disabled', 'true');
            }
            card.rel = 'noopener';

            if (item.thumbnail) {
                var thumb = P.el('span', 'iwac-vis-similar-card__thumb');
                thumb.style.backgroundImage =
                    'url(' + JSON.stringify(item.thumbnail).slice(1, -1) + ')';
                card.appendChild(thumb);
            }

            var body = P.el('span', 'iwac-vis-similar-card__body');
            body.appendChild(P.el(
                'span',
                'iwac-vis-similar-card__score',
                P.t('periodicals.topics_card_share', { share: pct(item.share) })
            ));
            if (!item.is_dominant) {
                body.appendChild(P.el(
                    'span',
                    'iwac-vis-topic-card-secondary',
                    P.t('periodicals.topics_card_secondary')
                ));
            }
            body.appendChild(P.el(
                'span',
                'iwac-vis-similar-card__title',
                item.title || P.t('Untitled')
            ));

            var bits = [];
            if (item.newspaper) bits.push(item.newspaper);
            if (item.issue) bits.push(P.t('periodicals.topics_card_issue', { issue: item.issue }));
            if (item.date) bits.push(P.formatDate(item.date));
            if (bits.length) {
                body.appendChild(P.el('span', 'iwac-vis-similar-card__meta', bits.join(' · ')));
            }

            card.appendChild(body);
            strip.appendChild(card);
        });

        return strip;
    }

    /* ----------------------------------------------------------------- */
    /*  Section assembly                                                  */
    /* ----------------------------------------------------------------- */

    /**
     * Coverage + provenance, stated on the section rather than left for a
     * reader to infer. Three facts belong here and nowhere else: how many
     * issues the model actually covers, that the topics come from the OCR
     * text (the subset's embedding is built from the table of contents —
     * a different object), and the dominant-probability measurement that
     * makes the mixture treatment necessary.
     */
    function buildMethodNote(topics) {
        var note = P.el('div', 'iwac-vis-topic-method');
        var coverage = topics.coverage || {};

        note.appendChild(P.el('p', null, P.t('periodicals.topics_coverage', {
            topics:   P.formatNumber(topics.n_topics || 0),
            modelled: P.formatNumber(coverage.modelled || 0),
            total:    P.formatNumber(coverage.total || 0),
            percent:  Math.round(100 * (coverage.share || 0))
        })));

        if (topics.mean_dominant_prob != null) {
            note.appendChild(P.el('p', null, P.t('periodicals.topics_mixture_note', {
                prob: Math.round(100 * topics.mean_dominant_prob)
            })));
        }

        note.appendChild(P.el('p', 'iwac-vis-muted', P.t('periodicals.topics_source_note', {
            mass: Math.round(100 * (topics.captured_mass || 0))
        })));

        return note;
    }

    function render(grid, data, ctx) {
        var topics = (data && data.topics) || null;
        if (!topics) return;

        var list = topics.topics || [];
        if (!list.length) {
            // A snapshot predating the 2026-08-11 LDA fit: say so in one
            // panel rather than shipping three empty ones.
            var empty = P.buildPanel(
                'iwac-vis-panel iwac-vis-panel--wide',
                P.t('periodicals.topics_ranking_title')
            );
            empty.chart.appendChild(P.buildEmptyState('periodicals.topics_absent'));
            grid.appendChild(empty.panel);
            return;
        }

        var byId = {};
        list.forEach(function (t) { byId[t.id] = t; });

        /* --- 1. Topics over time --------------------------------------- */
        var prevalence = topics.prevalence;
        if (prevalence && (prevalence.series || []).length && (prevalence.years || []).length > 1) {
            var timePanel = P.buildPanel(
                'iwac-vis-panel iwac-vis-panel--wide',
                P.t('periodicals.topics_time_title'),
                P.t('periodicals.topics_time_desc')
            );
            grid.appendChild(timePanel.panel);
            ns.registerChart(timePanel.chart, function (el, chart) {
                chart.setOption(prevalenceOption(prevalence, byId), true);
            });
        }

        /* --- 2. Ranking ------------------------------------------------ */
        var rankPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('periodicals.topics_ranking_title'),
            P.t('periodicals.topics_ranking_desc')
        );
        rankPanel.chart.classList.add('iwac-vis-chart--tall');
        grid.appendChild(rankPanel.panel);

        /* --- 3. Representative issues ---------------------------------- */
        var selected = list[0];
        var issuesPanel = P.buildPanel(
            'iwac-vis-panel iwac-vis-panel--wide',
            P.t('periodicals.topics_issues_title'),
            P.t('periodicals.topics_issues_desc')
        );
        // A card strip sizes to its content — drop the ECharts height floor.
        issuesPanel.chart.classList.add('iwac-vis-chart--auto');
        // Nothing here is a chart, so the panel toolbar's PNG export would
        // capture a grid of links.
        issuesPanel.panel.setAttribute('data-iwac-no-panel-toolbar', '1');
        grid.appendChild(issuesPanel.panel);

        var heading = P.el('p', 'iwac-vis-topic-selected');
        issuesPanel.panel.insertBefore(heading, issuesPanel.chart);

        function showIssues(topic) {
            selected = topic;
            heading.textContent = topic.periodicals
                ? P.t('periodicals.topics_issues_selected_spread', {
                    topic: topic.label || topicName(topic),
                    issues: P.formatNumber(topic.issues || 0),
                    periodicals: P.formatNumber(topic.periodicals)
                })
                : P.t('periodicals.topics_issues_selected', {
                    topic: topic.label || topicName(topic)
                });
            issuesPanel.chart.innerHTML = '';
            issuesPanel.chart.appendChild(buildIssueCards(topic, (ctx && ctx.siteBase) || ''));
        }

        var instance = ns.registerChart(rankPanel.chart, function (el, chart) {
            chart.setOption(rankingOption(list), true);
        });
        if (instance) {
            instance.on('click', function (params) {
                var topic = list[params.dataIndex];
                if (topic) showIssues(topic);
            });
        }

        showIssues(selected);
        issuesPanel.panel.appendChild(buildMethodNote(topics));
    }

    ns.periodicalsOverview = ns.periodicalsOverview || {};
    ns.periodicalsOverview.topics = { render: render };
})();
