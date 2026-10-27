/**
 * IWAC Visualizations — Albani Zaria sermons, section 5: where youth meets
 * politics.
 *
 * A "meeting" is a youth term and a political term within a few words of
 * each other in one speaker turn. The section locates those passages —
 * which recordings carry them, which terms pair up, which 20-minute
 * windows to listen to, what words surround them — and leaves the reading
 * to the reader, which is the point of linking every window.
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

    var TOP_RECORDINGS = 15;
    var TOP_PAIRS = 15;

    function byRecordingOption(rows, built) {
        A.sizeFor(built.chart, rows.length, 34, 260);
        var keys = [
            { key: 'youth', label: P.t('albani_overlap_youth'), color: ns.getSeriesColor(0) },
            { key: 'politics', label: P.t('albani_overlap_politics'), color: ns.getSeriesColor(1) },
            { key: 'meetings', label: P.t('albani_overlap_meetings'), color: ns.getSeriesColor(2) }
        ];
        return {
            grid: C._grid({ left: 8, right: 24, top: 36, bottom: 24 }),
            legend: C._legend({ top: 0 }),
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                confine: true,
                formatter: function (params) {
                    var list = Array.isArray(params) ? params : [params];
                    var row = rows[list[0] && list[0].dataIndex] || {};
                    var lines = ['<strong>' + P.escapeHtml(row.name || '') + '</strong>'];
                    list.forEach(function (p) {
                        var key = keys[p.seriesIndex].key;
                        lines.push(C.tooltipDot(p.color) + P.escapeHtml(p.seriesName) + ': '
                            + P.formatDecimal(p.value, 1) + ' (' + P.formatNumber(row[key]) + ')');
                    });
                    return lines.join('<br>');
                }
            },
            xAxis: { type: 'value', name: P.t('albani_per_10k'), nameLocation: 'middle', nameGap: 26 },
            yAxis: {
                type: 'category',
                inverse: true,
                axisTick: { show: false },
                axisLabel: { width: 180, overflow: 'truncate' },
                data: rows.map(function (r) { return r.name; })
            },
            series: keys.map(function (k) {
                return {
                    type: 'bar',
                    name: k.label,
                    barMaxWidth: 10,
                    itemStyle: { color: k.color, borderRadius: [0, 3, 3, 0] },
                    data: rows.map(function (r) { return A.per10k(r[k.key], r.w); })
                };
            })
        };
    }

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

            var recordings = A.chartPanel(host, P.t('albani_overlap_by_recording'),
                P.t('albani_overlap_by_recording_desc'), function (built) {
                    var rows = (payload().by_recording || [])
                        .filter(function (r) { return r.w > 0 && (r.youth || r.politics); })
                        .map(function (r) {
                            return { name: (titles[r.o] || {}).t || r.o, w: r.w, youth: r.youth,
                                     politics: r.politics, meetings: r.meetings };
                        })
                        .sort(function (a, b) {
                            return A.per10k(b.meetings, b.w) - A.per10k(a.meetings, a.w)
                                || A.per10k(b.youth + b.politics, b.w) - A.per10k(a.youth + a.politics, a.w);
                        })
                        .slice(0, TOP_RECORDINGS);
                    return byRecordingOption(rows, built);
                }, { wide: true, key: 'albani-overlap-recordings' });

            var grid = P.el('div', 'iwac-vis-albani__grid');
            host.appendChild(grid);
            var pairs = A.chartPanel(grid, P.t('albani_overlap_pairs'), P.t('albani_overlap_pairs_desc'),
                function (built) {
                    var rows = (payload().pairs || []).slice(0, TOP_PAIRS).map(function (p) {
                        return {
                            name: ((byId[p.youth] || {}).display || p.youth) + ' × '
                                + ((byId[p.politics] || {}).display || p.politics),
                            count: p.n
                        };
                    });
                    A.sizeFor(built.chart, rows.length);
                    return C.horizontalBar(rows, { nameKey: 'name', valueKey: 'count' });
                }, { key: 'albani-overlap-pairs' });

            var words = A.chartPanel(grid, P.t('albani_overlap_words'), P.t('albani_overlap_words_desc'),
                function (built) {
                    var terms = (payload().collocates || []).slice(0, 20);
                    if (!terms.length) return null;
                    A.sizeFor(built.chart, terms.length);
                    return A.logRatioOption(terms, {
                        axis: P.t('albani_collocates_axis'),
                        tooltip: function (term) {
                            return P.t('albani_collocates_tooltip', {
                                count: term.n, segments: P.formatNumber(term.s), recordings: P.formatNumber(term.r) });
                        }
                    });
                }, { key: 'albani-overlap-words' });

            var listPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                P.t('albani_overlap_segments'), '', { key: 'albani-overlap-segments' });
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
                recordings.redraw();
                pairs.redraw();
                words.redraw();
                refreshList();
            }, { keys: ['scope'] });
        });
    };
})();
