/**
 * IWAC Visualizations — Albani Zaria sermons, section 5: where youth meets
 * politics.
 *
 * A "meeting" is a youth term and a political term within a few words of
 * each other in one speaker turn. The section locates those passages:
 *
 *   the score     every recording as a row of 20-minute segments, in
 *                 listening order, shaded by youth terms, political terms
 *                 or meetings — click a segment to hear it
 *   the matrix    which youth term meets which political term
 *   the words     what surrounds the meetings, by frequency × distinctiveness
 *   the list      the segments with the most meetings
 *
 * and leaves the reading to the reader, which is the point of linking every
 * segment to its recording.
 *
 * Bundle: overlap.json, fetched when the section nears the viewport.
 *
 * Depends on: albani-sermons/helpers.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.albaniSermons) return;
    var P = ns.panels;
    var C = ns.chartOptions;
    var A = ns.albaniSermons;

    /** This section's panels (A.claimPanels). */
    var KEY = A.claimPanels('overlap', {
        score: 'albani-score',
        pairs: 'albani-overlap-pairs',
        words: 'albani-overlap-words',
        segments: 'albani-overlap-segments'
    });

    var TOP_TERMS = 15;

    /**
     * The score's three readings, the grid field each one shades by, and
     * its count bins, lowest first. Raw counts, not rates: segments are all
     * 20 minutes long but the last of a part, and a rate on a two-minute
     * tail would paint it the darkest cell of the recording. The bins sit
     * near the quintiles of the November 2026 data — meetings are rare (64
     * of 330 segments, eight at most), political terms dense — so each
     * reading spreads over the whole ramp.
     */
    var MEASURES = [
        { key: 'youth', field: 'y', label: 'albani_overlap_youth',
          bins: [{ min: 1, max: 2 }, { min: 3, max: 5 }, { min: 6, max: 10 }, { min: 11, max: 20 }, { min: 21 }] },
        { key: 'politics', field: 'pl', label: 'albani_overlap_politics',
          bins: [{ min: 1, max: 3 }, { min: 4, max: 10 }, { min: 11, max: 20 }, { min: 21, max: 40 }, { min: 41 }] },
        { key: 'meetings', field: 'm', label: 'albani_overlap_meetings',
          bins: [{ min: 1, max: 1 }, { min: 2, max: 2 }, { min: 3, max: 3 }, { min: 4, max: 5 }, { min: 6 }] }
    ];

    function binLabel(bin) {
        return bin.max == null ? P.formatNumber(bin.min) + '+'
            : bin.min === bin.max ? P.formatNumber(bin.min)
                : P.formatNumber(bin.min) + '–' + P.formatNumber(bin.max);
    }

    /* ----------------------------------------------------------------- */
    /*  The score                                                         */
    /* ----------------------------------------------------------------- */

    function scoreOption(rows, grid, measure, scope, chartEl) {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var byKey = {};
        grid.forEach(function (c) { byKey[c.o + ':' + c.k] = c; });
        var width = 0;
        rows.forEach(function (r) { if ((r.segs || 0) > width) width = r.segs; });

        var hits = [];
        var zeros = [];
        var outside = [];
        var dialogue = [];
        rows.forEach(function (r, yi) {
            for (var k = 0; k < (r.segs || 0); k++) {
                var cell = byKey[r.o + ':' + k];
                if (!cell) {
                    outside.push({ value: [k, yi], rec: r });
                    continue;
                }
                var v = cell[measure.field] || 0;
                var item = { value: [k, yi, v], rec: r, cell: cell };
                (v > 0 ? hits : zeros).push(item);
                if (cell.md === 'exchange') dialogue.push({ value: [k, yi], rec: r, cell: cell });
            }
        });

        var xLabels = [];
        for (var i = 0; i < width; i++) xLabels.push(String(i + 1));
        var labelWidth = A.labelWidth(chartEl);
        // The dialogue ring fits inside its cell, however narrow the chart.
        var cellWidth = (((chartEl && chartEl.clientWidth) || 800) - labelWidth - 40) / Math.max(1, width);

        var option = C.heatmapMatrix({
            xLabels: xLabels,
            yLabels: rows.map(A.recordingLabel),
            cells: hits
        }, {
            cellBorder: true,
            static: true,
            yLabelWidth: labelWidth,
            grid: { top: 36, bottom: 76 },
            // From the ramp's second stop: its first is the empty-cell tint,
            // which the zero cells below use, and a one-count cell must not
            // read as empty.
            ramp: ns.heatmapRamp().slice(1),
            pieces: measure.bins.map(function (b) {
                var out = { min: b.min, label: binLabel(b) };
                if (b.max != null) out.max = b.max;
                return out;
            }),
            tooltipFormatter: function (p) {
                var d = p.data || {};
                var rec = d.rec || {};
                var lines = ['<strong>' + P.escapeHtml(A.recordingLabel(rec)) + '</strong>'];
                if (!d.cell) {
                    lines.push(P.escapeHtml(P.t(scope === 'monologue'
                        ? 'albani_score_outside_monologue' : 'albani_score_outside')));
                    return lines.join('<br>');
                }
                var c = d.cell;
                lines.push(P.escapeHtml(P.t('albani_kwic_window', { part: c.p, window: A.windowLabel(c.s, c.e) })));
                lines.push(P.escapeHtml(P.t('albani_overlap_segment_line', {
                    meetings: P.formatNumber(c.m), youth: P.formatNumber(c.y), politics: P.formatNumber(c.pl) })));
                lines.push(P.escapeHtml(P.t('albani_score_words', { words: P.formatNumber(c.w) })));
                if (c.md === 'exchange') lines.push(P.escapeHtml(P.t('albani_mode_exchange')));
                lines.push('<em>' + P.escapeHtml(P.t('albani_score_listen')) + '</em>');
                return lines.join('<br>');
            }
        });
        option.xAxis.name = P.t('albani_score_axis');
        option.xAxis.nameLocation = 'middle';
        option.xAxis.nameGap = 24;
        // Every number where there is room; every other on a phone.
        option.xAxis.axisLabel = { interval: cellWidth < 14 ? 1 : 0, fontSize: P.AXIS_FONT_SM };
        option.visualMap.seriesIndex = 0;
        option.legend = C._legend({
            top: 0,
            data: [P.t('albani_score_none'), P.t('albani_score_not_counted'), P.t('albani_mode_exchange')]
        });
        option.series.push(A.emptyCellSeries(P.t('albani_score_none'), zeros), {
            type: 'heatmap',
            name: P.t('albani_score_not_counted'),
            data: outside,
            progressive: 0,
            animation: false,
            itemStyle: { color: tokens.border || tokens.borderLight, borderColor: tokens.surface, borderWidth: 1 }
        }, {
            // Dialogue segments carry a ring, not a colour: the colour is the
            // count, and the ring says another voice shares the segment.
            type: 'scatter',
            name: P.t('albani_mode_exchange'),
            data: dialogue,
            symbol: 'circle',
            symbolSize: Math.max(3, Math.min(6, Math.floor(cellWidth * 0.6))),
            silent: true,
            animation: false,
            z: 3,
            itemStyle: { color: 'transparent', borderColor: tokens.ink, borderWidth: 1.25 }
        });
        return option;
    }

    function scorePanel(host, metadata, overlap, store, ctx) {
        var rows = A.recordingOrder(metadata);
        var state = { measure: 'meetings' };
        var control = P.buildSegmented({
            name: 'albani-score-measure',
            label: P.t('albani_score_shade'),
            active: state.measure,
            options: MEASURES.map(function (m) { return { key: m.key, label: P.t(m.label) }; }),
            onChange: function (key) {
                state.measure = key;
                panel.redraw();
            }
        });
        var controls = P.el('div', 'iwac-vis-albani__controls');
        controls.appendChild(control.root);

        var panel = A.chartPanel(host, P.t('albani_score'), P.t('albani_score_desc'), function (built) {
            var scope = store.get('scope');
            var payload = (overlap.scopes || {})[scope] || {};
            var measure = MEASURES.filter(function (m) { return m.key === state.measure; })[0] || MEASURES[2];
            // Data built before the score existed has no grid: the panel
            // stays out of sight rather than show every segment uncounted.
            built.panel.hidden = !payload.grid;
            if (!payload.grid) return null;
            A.matrixHeight(built.chart, rows.length, 22, 130);
            return scoreOption(rows, payload.grid || [], measure, scope, built.chart);
        }, {
            wide: true,
            key: KEY.score,
            before: [controls],
            chartClass: 'iwac-vis-albani__score',
            onClick: function (p) {
                var d = p.data || {};
                if (!d.cell || !d.rec) return;
                var href = A.windowHref(ctx, d.rec, d.cell.p, d.cell.s);
                if (href) window.open(href, '_blank', 'noopener');
            }
        });
        return panel;
    }

    /* ----------------------------------------------------------------- */
    /*  The matrix: which terms meet                                      */
    /* ----------------------------------------------------------------- */

    function pairsOption(pairs, byId) {
        var youthTotal = {};
        var politicsTotal = {};
        pairs.forEach(function (p) {
            youthTotal[p.youth] = (youthTotal[p.youth] || 0) + p.n;
            politicsTotal[p.politics] = (politicsTotal[p.politics] || 0) + p.n;
        });
        function top(totals) {
            return Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; }).slice(0, TOP_TERMS);
        }
        var youth = top(youthTotal);
        var politics = top(politicsTotal);
        var display = function (id) { return (byId[id] || {}).display || id; };
        // Axis labels carry the lexicon's gloss in the page's language.
        var labelOf = function (id) {
            return A.labelGlosses ? A.withGloss(display(id), A.shortGloss(A.entryGloss(byId[id]))) : display(id);
        };
        var cells = [];
        pairs.forEach(function (p) {
            var yi = youth.indexOf(p.youth);
            var xi = politics.indexOf(p.politics);
            if (yi >= 0 && xi >= 0) cells.push([xi, yi, p.n]);
        });
        return {
            rows: youth.length,
            option: C.heatmapMatrix({
                xLabels: politics.map(labelOf),
                yLabels: youth.map(labelOf),
                cells: cells
            }, {
                cellLabels: true,
                cellBorder: true,
                static: true,
                xLabelRotate: 40,
                yLabelWidth: A.labelGlosses ? 160 : 100,
                grid: { bottom: 64 },
                tooltipFormatter: function (p) {
                    var v = p.value || [];
                    var y = youth[v[1]], x = politics[v[0]];
                    return '<strong>' + P.escapeHtml(display(y)) + ' × '
                        + P.escapeHtml(display(x)) + '</strong><br>'
                        + '<em>' + P.escapeHtml(A.entryGloss(byId[y]) + ' × ' + A.entryGloss(byId[x])) + '</em><br>'
                        + P.escapeHtml(P.t('albani_pairs_tooltip', { count: v[2] }));
                }
            })
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Where to listen                                                   */
    /* ----------------------------------------------------------------- */

    function segmentList(host, payload, titles, ctx) {
        var list = P.el('ol', 'iwac-vis-albani__segments');
        (payload.segments || []).forEach(function (s) {
            var rec = titles[s.o] || {};
            var li = P.el('li', 'iwac-vis-albani__segment');
            var title = P.el('a', 'iwac-vis-albani__segment-title', rec.t || s.o);
            title.href = A.itemHref(ctx, s.o, rec.u);
            li.appendChild(title);
            var win = P.el('a', 'iwac-vis-albani__window',
                P.t('albani_kwic_window', { part: s.p, window: A.windowLabel(s.s, s.e) }));
            win.href = A.windowHref(ctx, rec, s.p, s.s);
            win.title = P.t('albani_kwic_window_hint');
            li.appendChild(P.el('span', 'iwac-vis-kwic-sep', ' · '));
            li.appendChild(win);
            if (s.md === 'exchange') {
                li.appendChild(A.badge(P.t('albani_kwic_exchange'), P.t('albani_kwic_exchange_hint')));
            }
            li.appendChild(P.el('p', 'iwac-vis-albani__segment-meta', P.t('albani_overlap_segment_line', {
                meetings: P.formatNumber(s.meetings),
                youth: P.formatNumber(s.youth),
                politics: P.formatNumber(s.politics)
            })));
            list.appendChild(li);
        });
        host.appendChild(list);
    }

    A.renderOverlap = function (section, bundle, store, fetch, ctx) {
        var titles = A.recordingsById(bundle.metadata);
        var byId = A.entriesById(bundle.lexicon);
        var host = P.el('div', 'iwac-vis-albani__deferred');
        section.appendChild(host);

        A.lazy(host, function () { return fetch('overlap.json'); }, function (overlap) {
            overlap = overlap || {};
            function payload() { return (overlap.scopes || {})[store.get('scope')] || {}; }

            var score = scorePanel(host, bundle.metadata, overlap, store, ctx);

            var pairs = A.chartPanel(host, P.t('albani_overlap_pairs'), P.t('albani_overlap_pairs_desc'),
                function (built) {
                    var list = payload().pairs || [];
                    if (!list.length) return null;
                    var built2 = pairsOption(list, byId);
                    A.matrixHeight(built.chart, built2.rows, 30, 150);
                    return built2.option;
                }, { wide: true, key: KEY.pairs, chartClass: 'iwac-vis-albani__matrix' });

            var words = A.chartPanel(host, P.t('albani_overlap_words'), P.t('albani_overlap_words_desc'),
                function () {
                    var terms = (payload().collocates || []).slice(0, 25);
                    if (!terms.length) return null;
                    return A.wordScatterOption(terms, {
                        xName: P.t('albani_scatter_x'),
                        yName: P.t('albani_scatter_y'),
                        tooltip: function (term) {
                            return P.t('albani_collocates_tooltip', {
                                count: term.n, segments: P.formatNumber(term.s), recordings: P.formatNumber(term.r) });
                        }
                    });
                }, { wide: true, key: KEY.words, chartClass: 'iwac-vis-albani__scatter' });

            var listPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('albani_overlap_segments'), '', { key: KEY.segments });
            var listDesc = listPanel.panel.querySelector('.iwac-vis-panel-desc')
                || P.el('p', 'iwac-vis-panel-desc');
            listPanel.panel.insertBefore(listDesc, listPanel.chart);
            listPanel.chart.classList.add('iwac-vis-albani__list-host');
            host.appendChild(listPanel.panel);

            function refreshList() {
                listPanel.chart.innerHTML = '';
                listDesc.textContent = P.t('albani_overlap_segments_desc',
                    { count: payload().segments_with_meetings || 0 });
                segmentList(listPanel.chart, payload(), titles, ctx);
            }
            refreshList();
            store.subscribe(function () {
                score.redraw();
                pairs.redraw();
                words.redraw();
                refreshList();
            }, { keys: ['scope'] });
            store.subscribe(function () {
                pairs.redraw();
                words.redraw();
            }, { keys: ['glosses'] });
        });
    };
})();
