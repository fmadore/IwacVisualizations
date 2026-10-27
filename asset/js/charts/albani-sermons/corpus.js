/**
 * IWAC Visualizations — Albani Zaria sermons, section 1: the corpus.
 *
 * What the archive holds before anything is counted: every recording on a
 * date × running-time axis (status by colour, the undated ones counted
 * beside it), then the full listing. This is where the block says plainly
 * that it is one preacher's corpus, and how much of it is readable today.
 *
 * Depends on: albani-sermons/helpers.js, shared/table.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.albaniSermons) return;
    var P = ns.panels;
    var C = ns.chartOptions;
    var A = ns.albaniSermons;

    var STATUS_KEY = {
        analysed: 'albani_status_analysed',
        legacy: 'albani_status_legacy_short',
        untranscribed: 'albani_status_none'
    };
    var STATUS_ORDER = ['analysed', 'legacy', 'untranscribed'];

    function dateValue(d) {
        if (!d) return null;
        var parts = String(d).split('-');
        var y = Number(parts[0]);
        if (!y) return null;
        // A year-only date sits mid-year, a month-only one mid-month: the
        // point marks the span the catalogue can vouch for, not its first day.
        var m = parts[1] ? Number(parts[1]) - 1 : 6;
        var day = parts[2] ? Number(parts[2]) : (parts[1] ? 15 : 1);
        return Date.UTC(y, m, day);
    }

    function statusColor(status, tokens) {
        if (status === 'analysed') return tokens.primary;
        if (status === 'legacy') return tokens.ink;
        return tokens.muted;
    }

    function timelineOption(recordings) {
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var series = STATUS_ORDER.map(function (status) {
            var points = recordings.filter(function (r) {
                return r.st === status && dateValue(r.d) != null && r.dur;
            }).map(function (r) {
                return { value: [dateValue(r.d), r.dur / 3600], rec: r };
            });
            return {
                type: 'scatter',
                name: P.t(STATUS_KEY[status]),
                data: points,
                symbolSize: 12,
                itemStyle: {
                    color: statusColor(status, tokens),
                    borderColor: tokens.panelBg || tokens.surface,
                    borderWidth: 1
                }
            };
        });
        return {
            grid: C._grid({ left: 8, right: 16, top: 56, bottom: 32 }),
            legend: C._legend({ top: 0 }),
            tooltip: {
                trigger: 'item',
                confine: true,
                formatter: function (p) {
                    var r = (p.data && p.data.rec) || {};
                    return '<strong>' + P.escapeHtml(r.t || '') + '</strong><br>'
                        + P.escapeHtml(P.formatDate ? P.formatDate(r.d) : r.d) + '<br>'
                        + P.escapeHtml(P.formatDuration(r.dur)) + '<br>'
                        + P.escapeHtml(p.seriesName);
                }
            },
            xAxis: { type: 'time', minInterval: 365 * 24 * 3600 * 1000 },
            yAxis: {
                type: 'value',
                name: P.t('albani_axis_hours'),
                nameLocation: 'end',
                nameGap: 14,
                nameTextStyle: { align: 'left' },
                min: 0
            },
            series: series
        };
    }

    function languages(r) {
        return (r.lang || []).map(function (l) { return P.translateKeyed('lang_', l); }).join(', ');
    }

    A.renderCorpus = function (section, metadata, ctx) {
        var recordings = (metadata && metadata.recordings) || [];
        var undated = recordings.filter(function (r) { return dateValue(r.d) == null; }).length;

        A.chartPanel(section, P.t('albani_corpus_timeline'),
            P.t('albani_corpus_timeline_desc', { count: undated }),
            function () { return timelineOption(recordings); },
            { wide: true, key: 'albani-corpus-timeline', chartClass: 'iwac-vis-albani__timeline' });

        var panel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
            P.t('albani_corpus_table'), P.t('albani_corpus_table_desc'),
            { key: 'albani-corpus-table' });
        panel.chart.classList.add('iwac-vis-albani__table-host');
        section.appendChild(panel.panel);

        var rows = recordings.slice().sort(function (a, b) {
            return (STATUS_ORDER.indexOf(a.st) - STATUS_ORDER.indexOf(b.st))
                || String(a.d || '9999').localeCompare(String(b.d || '9999'))
                || Number(a.o) - Number(b.o);
        }).map(function (r) {
            return {
                title: r.t,
                url: A.itemHref(ctx, r.o, r.u),
                date: r.d ? (P.formatDate ? P.formatDate(r.d) : r.d) : P.t('albani_undated'),
                runtime: P.formatDuration(r.dur),
                languages: languages(r),
                status: P.t(STATUS_KEY[r.st] || r.st),
                segments: r.segs != null ? P.formatNumber(r.segs) : '—',
                exchange: r.x != null ? P.formatNumber(r.x) : '—',
                words: r.w != null ? P.formatNumber(r.w) : '—'
            };
        });
        var table = P.buildTable({
            columns: [
                { key: 'title', label: P.t('albani_col_title'), render: 'link', linkKey: 'url', card: 'title' },
                { key: 'date', label: P.t('albani_col_date'), card: 'meta' },
                { key: 'runtime', label: P.t('albani_col_runtime'), card: 'meta' },
                { key: 'languages', label: P.t('albani_col_languages'), card: 'meta' },
                { key: 'status', label: P.t('albani_col_status'), card: 'badge' },
                { key: 'segments', label: P.t('albani_col_segments'), card: 'row' },
                { key: 'exchange', label: P.t('albani_col_exchange'), card: 'row' },
                { key: 'words', label: P.t('albani_col_words'), card: 'row' }
            ],
            rows: rows,
            pageSize: 15
        });
        panel.chart.appendChild(table.root);
    };
})();
