/**
 * IWAC Visualizations — Albani Zaria sermons: style and rhetoric (prototype).
 *
 * Word counts, collocates and topic lexicons measure what Albani talks about,
 * not how he persuades: they flatten irony, humour, proverbs (karin magana),
 * voice-switching and oral cadence. This prototype section separates what is
 * directly measurable in the transcripts (Tier 1 schemes and register cues)
 * from candidate tropes flagged for specialist review (Tier 2).
 *
 * Three panels, all reading rhetoric.json lazily:
 *   albani-rhetoric-score      recording × 20-minute segment heatmap, shaded
 *                              by measurable rhetorical device; click opens
 *                              the audio at that window
 *   albani-rhetoric-profile    rates per 10,000 words across recordings or
 *                              preaching genres (khutba, lessons, lectures,
 *                              interviews)
 *   albani-rhetoric-passages   rights-gated concordance of detected schemes
 *                              and candidate tropes for close reading & review
 *
 * Depends on: albani-sermons/helpers.js, shared/concordance.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions || !ns.albaniSermons) return;
    var P = ns.panels;
    var C = ns.chartOptions;
    var A = ns.albaniSermons;

    /** This section's panels (A.claimPanels). */
    var KEY = A.claimPanels('rhetoric', {
        score: 'albani-rhetoric-score',
        profile: 'albani-rhetoric-profile',
        passages: 'albani-rhetoric-passages'
    });

    var SCORE_MEASURES = [
        { key: 'all', label: 'albani_rhetoric_measure_all' },
        { key: 'anaphora', label: 'albani_rhetoric_short_anaphora' },
        { key: 'vocative', label: 'albani_rhetoric_short_vocative' },
        { key: 'rhetorical_question', label: 'albani_rhetoric_short_question' },
        { key: 'oath_emphasis', label: 'albani_rhetoric_short_oath' },
        { key: 'dialogue', label: 'albani_rhetoric_short_dialogue' },
        { key: 'code_switch', label: 'albani_rhetoric_short_switch' }
    ];

    function deviceLabel(dev) {
        return A.label(dev, 'label') || dev.id;
    }

    function genreLabel(genresById, id) {
        var g = genresById[id];
        return g ? A.label(g, 'label') : id;
    }

    function cellCount(cell, measure) {
        var d = cell.d || {};
        if (measure === 'all') {
            var total = 0;
            Object.keys(d).forEach(function (k) { total += d[k] || 0; });
            return total;
        }
        return d[measure] || 0;
    }

    /* ----------------------------------------------------------------- */
    /*  Panel 1: rhetorical score (recording × 20-minute segment)         */
    /* ----------------------------------------------------------------- */

    function scoreOption(rows, grid, measureKey, devicesById, scope, chartEl) {
        var rowIndex = {};
        var byKey = {};
        var maxCol = 0;
        rows.forEach(function (r, i) { rowIndex[r.o] = i; });
        grid.forEach(function (cell) {
            if (rowIndex[cell.o] == null) return;
            byKey[cell.o + ':' + cell.k] = cell;
            if (cell.k + 1 > maxCol) maxCol = cell.k + 1;
        });
        rows.forEach(function (r) {
            if ((r.segs || 0) > maxCol) maxCol = r.segs;
        });

        var shaded = [];
        var empty = [];
        var outside = [];
        rows.forEach(function (r, yi) {
            var total = r.segs || 0;
            for (var xi = 0; xi < total; xi++) {
                var cell = byKey[r.o + ':' + xi];
                if (!cell) {
                    outside.push({ value: [xi, yi, 0], rec: r, k: xi });
                } else {
                    var n = cellCount(cell, measureKey);
                    var pt = { value: [xi, yi, n], cell: cell, rec: r };
                    (n > 0 ? shaded : empty).push(pt);
                }
            }
        });

        var xLabels = [];
        for (var i = 0; i < maxCol; i++) xLabels.push(String(i + 1));

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var measureTitle = measureKey === 'all'
            ? P.t('albani_rhetoric_measure_all')
            : (devicesById[measureKey] ? deviceLabel(devicesById[measureKey]) : measureKey);

        var option = C.heatmapMatrix({
            xLabels: xLabels,
            yLabels: rows.map(A.recordingLabel),
            cells: shaded
        }, {
            cellBorder: true,
            static: true,
            yLabelWidth: A.labelWidth(chartEl),
            grid: { bottom: 64 },
            ramp: ns.heatmapRamp().slice(1),
            pieces: A.quantileBins(shaded.map(function (c) { return c.value[2]; })),
            tooltipFormatter: function (p) {
                var d = p.data || {};
                var rec = d.rec || rows[(p.value || [])[1]];
                if (!d.cell) {
                    return '<strong>' + P.escapeHtml(A.recordingLabel(rec)) + '</strong><br>'
                        + P.escapeHtml(scope === 'monologue'
                            ? P.t('albani_score_outside_monologue')
                            : P.t('albani_score_outside'));
                }
                var cell = d.cell;
                var n = cellCount(cell, measureKey);
                var lines = [
                    '<strong>' + P.escapeHtml(A.recordingLabel(rec)) + '</strong>',
                    P.escapeHtml(P.t('albani_kwic_window', {
                        part: cell.p, window: A.windowLabel(cell.s, cell.e)
                    })),
                    P.escapeHtml(measureTitle + ': ' + P.formatNumber(n)),
                    P.escapeHtml(P.t('albani_score_words', { words: P.formatNumber(cell.w || 0) }))
                ];
                if (measureKey === 'code_switch' && (cell.ar || cell.en)) {
                    lines.push(P.escapeHtml(P.t('albani_rhetoric_switch_detail', {
                        ar: P.formatNumber(cell.ar || 0), en: P.formatNumber(cell.en || 0)
                    })));
                }
                lines.push('<em>' + P.escapeHtml(P.t('albani_score_listen')) + '</em>');
                return lines.join('<br>');
            }
        });
        option.visualMap.seriesIndex = 0;
        option.xAxis.name = P.t('albani_score_axis');
        option.xAxis.nameLocation = 'middle';
        option.xAxis.nameGap = 28;
        option.series.push(A.emptyCellSeries(P.t('albani_score_none'), empty));
        if (outside.length) {
            option.series.push({
                name: P.t('albani_score_not_counted'),
                type: 'heatmap',
                data: outside,
                itemStyle: {
                    color: tokens.surfaceMuted || tokens.borderLight,
                    borderColor: tokens.panelBg || tokens.surface,
                    borderWidth: 1
                },
                emphasis: { disabled: true }
            });
        }
        return option;
    }

    function scorePanel(host, metadata, rhetoric, devicesById, store, ctx) {
        var state = { measure: 'all' };
        var control = P.buildSegmented({
            name: 'albani-rhetoric-measure',
            label: P.t('albani_rhetoric_shade'),
            active: state.measure,
            options: SCORE_MEASURES.map(function (m) {
                return { key: m.key, label: P.t(m.label) };
            }),
            onChange: function (key) {
                state.measure = key;
                panel.redraw();
            }
        });
        var controls = P.el('div', 'iwac-vis-albani__controls');
        controls.appendChild(control.root);

        var panel = A.chartPanel(host, P.t('albani_rhetoric_score'), P.t('albani_rhetoric_score_desc'),
            function (built) {
                var scope = store.get('scope');
                var rows = A.recordingOrder(metadata, scope);
                var payload = (rhetoric.scopes || {})[scope] || {};
                if (!payload.grid || !rows.length) return null;
                A.matrixHeight(built.chart, rows.length, 22, 130);
                return scoreOption(rows, payload.grid, state.measure, devicesById, scope, built.chart);
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
    /*  Panel 2: profile by genre or by recording                         */
    /* ----------------------------------------------------------------- */

    function recordingProfileOption(rows, byRec, tier1Devices, chartEl) {
        var cells = [];
        var empty = [];
        var labels = tier1Devices.map(deviceLabel);
        rows.forEach(function (r, yi) {
            var row = byRec[r.o] || {};
            var counts = row.counts || {};
            var rates = row.rates || {};
            tier1Devices.forEach(function (dev, xi) {
                var n = counts[dev.id] || 0;
                var rate = Math.round((rates[dev.id] || 0) * 10) / 10;
                if (n > 0 && rate < 0.1) rate = 0.1;
                (n > 0 ? cells : empty).push({ value: [xi, yi, rate], n: n, w: row.w || 0 });
            });
        });
        A.matrixHeight(chartEl, rows.length, 22, 140);
        var option = C.heatmapMatrix({
            xLabels: labels,
            yLabels: rows.map(A.recordingLabel),
            cells: cells
        }, {
            cellBorder: true,
            static: true,
            xLabelRotate: 28,
            yLabelWidth: A.labelWidth(chartEl),
            grid: { bottom: 92 },
            ramp: ns.heatmapRamp().slice(1),
            pieces: A.quantileBins(cells.map(function (c) { return c.value[2]; })),
            tooltipFormatter: function (p) {
                var v = p.value || [];
                var d = p.data || {};
                return '<strong>' + P.escapeHtml(A.recordingLabel(rows[v[1]])) + '</strong><br>'
                    + P.escapeHtml(labels[v[0]] || '') + ': '
                    + P.escapeHtml(P.formatDecimal(v[2], 1) + ' ' + P.t('albani_per_10k')) + '<br>'
                    + P.escapeHtml(P.t('albani_intensity_tooltip', {
                        count: d.n || 0, words: P.formatNumber(d.w || 0)
                    }));
            }
        });
        option.visualMap.seriesIndex = 0;
        option.series.push(A.emptyCellSeries(P.t('albani_score_none'), empty));
        return option;
    }

    function genreProfileOption(byGenre, genresById, tier1Devices) {
        var categories = tier1Devices.map(deviceLabel);
        var series = byGenre.map(function (g, i) {
            var gName = genreLabel(genresById, g.genre);
            return {
                name: gName + ' (' + P.formatNumber(g.recordings) + ')',
                type: 'bar',
                barMaxWidth: 26,
                itemStyle: { color: ns.getSeriesColor(i) },
                data: tier1Devices.map(function (dev) {
                    return {
                        value: Math.round(((g.rates || {})[dev.id] || 0) * 10) / 10,
                        n: (g.counts || {})[dev.id] || 0,
                        words: g.words || 0,
                        genreName: gName
                    };
                })
            };
        });
        return {
            grid: C._grid({ left: 12, right: 16, top: 56, bottom: 72 }),
            legend: C._legend({ top: 0 }),
            tooltip: C._inPanelTooltip({
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    var d = p.data || {};
                    return '<strong>' + P.escapeHtml(d.genreName || p.seriesName) + '</strong><br>'
                        + P.escapeHtml(p.name) + ': '
                        + P.escapeHtml(P.formatDecimal(d.value || 0, 1) + ' ' + P.t('albani_per_10k')) + '<br>'
                        + P.escapeHtml(P.t('albani_intensity_tooltip', {
                            count: d.n || 0, words: P.formatNumber(d.words || 0)
                        }));
                }
            }),
            xAxis: {
                type: 'category',
                data: categories,
                axisLabel: { rotate: 24, interval: 0 }
            },
            yAxis: {
                type: 'value',
                name: P.t('albani_per_10k'),
                nameLocation: 'end',
                nameGap: 14,
                nameTextStyle: { align: 'left' }
            },
            series: series
        };
    }

    function profilePanel(host, metadata, rhetoric, tier1Devices, genresById, store) {
        var byGenreAll = ((rhetoric.scopes || {}).all || {}).by_genre || [];
        var hasMultiGenres = byGenreAll.length > 1;
        var state = { view: hasMultiGenres ? 'genre' : 'recording' };
        var before = [];
        if (hasMultiGenres) {
            var viewControl = P.buildSegmented({
                name: 'albani-rhetoric-view',
                label: P.t('albani_rhetoric_view_label'),
                active: state.view,
                options: [
                    { key: 'genre', label: P.t('albani_rhetoric_view_genre') },
                    { key: 'recording', label: P.t('albani_rhetoric_view_recording') }
                ],
                onChange: function (key) {
                    state.view = key;
                    panel.redraw();
                }
            });
            var controls = P.el('div', 'iwac-vis-albani__controls');
            controls.appendChild(viewControl.root);
            before.push(controls);
        }

        var panel = A.chartPanel(host, P.t('albani_rhetoric_profile'), P.t('albani_rhetoric_profile_desc'),
            function (built) {
                var scope = store.get('scope');
                var payload = (rhetoric.scopes || {})[scope] || {};
                if (state.view === 'genre' && (payload.by_genre || []).length > 1) {
                    built.chart.style.height = '';
                    built.chart.style.minHeight = '';
                    return genreProfileOption(payload.by_genre, genresById, tier1Devices);
                }
                var byRec = {};
                (payload.by_recording || []).forEach(function (r) { byRec[r.o] = r; });
                var rows = A.recordingOrder(metadata, scope).filter(function (r) { return byRec[r.o]; });
                if (!rows.length) return null;
                return recordingProfileOption(rows, byRec, tier1Devices, built.chart);
            }, {
                wide: true,
                key: KEY.profile,
                before: before,
                chartClass: 'iwac-vis-albani__matrix'
            });
        return panel;
    }

    /* ----------------------------------------------------------------- */
    /*  Panel 3: rights-gated passages for close reading & review         */
    /* ----------------------------------------------------------------- */

    function passagesPanel(host, rhetoric, devicesById, store, ctx) {
        var passages = rhetoric.passages || {};
        var allRows = passages.rows || [];
        var items = passages.items || [];
        var counts = passages.counts || {};
        var withheld = Object.keys(counts).reduce(function (n, k) {
            return n + ((counts[k] && counts[k].withheld) || 0);
        }, 0);

        var panel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('albani_rhetoric_passages'), P.t('albani_rhetoric_passages_desc'),
            { key: KEY.passages });
        host.appendChild(panel.panel);

        if (withheld) {
            panel.panel.insertBefore(
                A.note(P.t('albani_kwic_withheld', { count: withheld })),
                panel.chart);
        }

        var state = { tier: 'all', device: '', rec: '', query: '' };
        var controls = P.el('div', 'iwac-vis-albani__controls');

        var tierControl = P.buildSegmented({
            name: 'albani-rhetoric-tier',
            label: P.t('albani_rhetoric_tier_label'),
            active: state.tier,
            options: [
                { key: 'all', label: P.t('albani_rhetoric_tier_all') },
                { key: '1', label: P.t('albani_rhetoric_tier_1') },
                { key: '2', label: P.t('albani_rhetoric_tier_2') }
            ],
            onChange: function (key) {
                state.tier = key;
                refresh();
            }
        });
        controls.appendChild(tierControl.root);

        var presentDevices = {};
        allRows.forEach(function (r) { presentDevices[r.d] = true; });
        var devOptions = [{ value: '', label: P.t('albani_rhetoric_all_devices') }].concat(
            (rhetoric.devices || []).filter(function (dev) { return presentDevices[dev.id]; })
                .map(function (dev) { return { value: dev.id, label: deviceLabel(dev) }; })
        );
        controls.appendChild(A.select(P.t('albani_rhetoric_device'), devOptions, '', function (v) {
            state.device = v;
            refresh();
        }, 'albani-rhetoric-device'));

        if (items.length > 1) {
            var recOptions = [{ value: '', label: P.t('albani_kwic_all_recordings') }].concat(
                items.map(function (it, idx) {
                    return { value: String(idx), label: it.y ? it.t + ' (' + it.y + ')' : (it.t || it.o) };
                }).sort(function (a, b) { return a.label.localeCompare(b.label); })
            );
            controls.appendChild(A.select(P.t('albani_kwic_recording'), recOptions, '', function (v) {
                state.rec = v;
                refresh();
            }, 'albani-rhetoric-rec'));
        }

        var search = P.el('input', 'iwac-vis-control iwac-vis-albani__search');
        search.type = 'search';
        search.setAttribute('aria-label', P.t('albani_kwic_filter'));
        search.placeholder = P.t('albani_kwic_filter');
        search.addEventListener('input', function () {
            state.query = search.value.trim();
            refresh();
        });
        controls.appendChild(search);

        var counter = P.el('p', 'iwac-vis-albani__count');
        controls.appendChild(counter);
        panel.panel.insertBefore(controls, panel.chart);

        var kwic = P.buildConcordance({
            rows: [],
            items: items,
            pageSize: 15,
            emptyKey: 'albani_kwic_empty',
            className: 'iwac-vis-albani__kwic',
            renderMeta: function (row, item) {
                var meta = P.el('p', 'iwac-vis-kwic-meta');
                var title = P.el('a', 'iwac-vis-kwic-title', item.t || item.o);
                title.href = A.itemHref(ctx, item.o, item.u);
                meta.appendChild(title);
                if (item.y) meta.appendChild(P.el('span', 'iwac-vis-kwic-source', ' · ' + item.y));
                var win = P.el('a', 'iwac-vis-albani__window',
                    P.t('albani_kwic_window', { part: row.p, window: A.windowLabel(row.s, row.x) }));
                win.href = A.windowHref(ctx, item, row.p, row.s);
                win.title = P.t('albani_kwic_window_hint');
                meta.appendChild(P.el('span', 'iwac-vis-kwic-sep', ' · '));
                meta.appendChild(win);
                var dev = devicesById[row.d];
                meta.appendChild(P.el('span', 'iwac-vis-kwic-frame', dev ? deviceLabel(dev) : row.d));
                if (row.tier === 2) {
                    meta.appendChild(A.badge(P.t('albani_rhetoric_candidate_badge'),
                        P.t('albani_rhetoric_candidate_hint')));
                }
                if (row.md === 'exchange') {
                    meta.appendChild(A.badge(P.t('albani_kwic_exchange'), P.t('albani_kwic_exchange_hint')));
                }
                return meta;
            }
        });
        panel.chart.classList.add('iwac-vis-albani__kwic-host');
        panel.chart.appendChild(kwic.root);

        function refresh() {
            var monologue = store.get('scope') === 'monologue';
            var rows = allRows.filter(function (r) {
                if (monologue && r.md === 'exchange') return false;
                if (state.tier !== 'all' && String(r.tier) !== state.tier) return false;
                if (state.device && r.d !== state.device) return false;
                if (state.rec !== '' && String(r.i) !== state.rec) return false;
                return A.kwicMatches(r, state.query);
            });
            counter.textContent = P.t('albani_kwic_count', {
                shown: P.formatNumber(rows.length), total: P.formatNumber(allRows.length)
            });
            kwic.update(rows);
        }
        refresh();
        return { refresh: refresh };
    }

    /* ----------------------------------------------------------------- */
    /*  The section                                                       */
    /* ----------------------------------------------------------------- */

    A.renderRhetoric = function (section, bundle, store, fetch, ctx) {
        var note = P.el('div', 'iwac-vis-albani__rhetoric-limit');
        note.appendChild(P.el('p', null, P.t('albani_rhetoric_limit')));
        note.appendChild(A.badge(P.t('albani_badge_rhetoric'), P.t('albani_badge_rhetoric_hint')));
        section.appendChild(note);

        var host = P.el('div', 'iwac-vis-albani__deferred');
        section.appendChild(host);

        A.lazy(host, function () { return fetch('rhetoric.json'); }, function (rhetoric) {
            rhetoric = rhetoric || {};
            var devices = rhetoric.devices || [];
            var devicesById = {};
            devices.forEach(function (d) { devicesById[d.id] = d; });
            var tier1Devices = devices.filter(function (d) { return d.tier === 1; });
            var genresById = {};
            (rhetoric.genres || []).forEach(function (g) { genresById[g.id] = g; });

            var score = scorePanel(host, bundle.metadata, rhetoric, devicesById, store, ctx);
            var profile = profilePanel(host, bundle.metadata, rhetoric, tier1Devices, genresById, store);
            var passages = passagesPanel(host, rhetoric, devicesById, store, ctx);

            store.subscribe(function () {
                score.redraw();
                profile.redraw();
                passages.refresh();
            }, { keys: ['scope'] });
        });
    };
})();
