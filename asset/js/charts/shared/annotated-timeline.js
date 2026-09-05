/**
 * IWAC Visualizations — shared annotated time-series builder.
 *
 * One line per series across a year axis, with hand-curated historical-event
 * annotations rendered as markLine verticals (point events) and markArea
 * bands (period events), plus a `<details>` text fallback listing them.
 *
 * Extracted from `scary-terms/trends.js` (issue #2) when the Laïcité block
 * (issue #14) needed the same chart with a different value-axis label and a
 * different i18n namespace. `scary-terms/trends.js` now delegates here and
 * keeps its own public API, so both blocks share one implementation rather
 * than forking it — issue #1's guiding principle.
 *
 * Events bundle shape (see asset/data/*-events.json):
 *   { point_events:  [{ year, label_en, label_fr, scope?, country?, o_id? }],
 *     period_events: [{ start, end, label_en, label_fr, scope?, country? }] }
 *
 * Dependencies: panels.js (P), and optionally chart-options.js / responsive.js
 * (every read of those is guarded, so the builder degrades rather than throws).
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.annotated-timeline: panels.js must load first');
        return;
    }
    var P = ns.panels;

    /**
     * Longest curated label drawn inside the plot area, in characters.
     *
     * markLine labels rotate to follow their vertical line, so label length
     * is consumed against the GRID HEIGHT, not its width — a 60-character
     * event name ("Colloque national sur les confessions religieuses et
     * laïcité") runs straight past the x-axis and over the axis title and
     * the zoom slider. 40 characters is about 235 px at 11 px, which clears
     * a standard ~370 px grid even at the alternating bottom anchor.
     *
     * Nothing is lost by truncating: the full label is on hover and in the
     * `<details>` list below the chart, which is also what a screen reader
     * and a no-hover reader get.
     */
    var LABEL_MAX_CHARS = 40;

    /** Truncate at the last word boundary before the cap. */
    function truncateLabel(text, max) {
        if (!text) return '';
        if (text.length <= max) return text;
        var cut = text.slice(0, max);
        var space = cut.lastIndexOf(' ');
        if (space > max * 0.6) cut = cut.slice(0, space);
        return cut.replace(/[\s,;:.—-]+$/, '') + '…';
    }

    /**
     * Filter curated events to those visible for the active country scope:
     * `global` events always pass, `country` events only when the chart is
     * filtered to that country.
     *
     * `opts.includeAllCountries` relaxes that for the unfiltered view: with
     * no country selected, every country event passes rather than none. Use
     * it when the curated set is mostly national — a laïcité timeline whose
     * markers are all national conferences and constitutional moments would
     * otherwise open completely unannotated, hiding the very link the
     * annotations exist to make. Off by default, so a set with genuinely
     * global markers keeps the stricter reading.
     */
    P.visibleTimelineEvents = function (events, country, opts) {
        if (!events) return { points: [], periods: [] };
        var includeAll = !!(opts && opts.includeAllCountries) && !country;
        function pass(e) {
            if (!e || e.scope !== 'country') return !!e;
            if (includeAll) return true;
            return !!country && e.country === country;
        }
        return {
            points: (events.point_events || []).filter(pass),
            periods: (events.period_events || []).filter(pass)
        };
    };

    /** Locale-aware label for one curated event. */
    P.timelineEventLabel = function (e) {
        return (ns.locale === 'fr' ? e.label_fr : e.label_en) || e.label_en || '';
    };

    /**
     * Merge point and period events into one year-sorted sequence and number
     * them 1..N.
     *
     * Both the chart and the list beneath it read their numbering from here,
     * so a marker's badge always matches its entry. That correspondence is
     * the whole point of numbered mode: a curated event name is often a full
     * institutional title ("Colloque national sur les confessions religieuses
     * et laïcité") and there is no font size at which twelve of those are
     * legible inside a plot area. Numbering moves the text to where it can be
     * read in full — and read by a screen reader, and printed — while the
     * chart keeps the one thing it is good at, which is showing *when*.
     */
    P.orderTimelineEvents = function (visible) {
        var rows = (visible.periods || []).map(function (e) {
            return { event: e, kind: 'period', sort: e.start };
        }).concat((visible.points || []).map(function (e) {
            return { event: e, kind: 'point', sort: e.year };
        }));
        rows.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
        rows.forEach(function (row, i) { row.n = i + 1; });
        return rows;
    };

    /**
     * Build the ECharts option for an annotated multi-series timeline.
     *
     * @param {Object} cfg
     * @param {Array<number>} cfg.years            aligned year axis
     * @param {Array<string>} cfg.seriesNames      canonical series order
     * @param {Object<string,Array<number>>} cfg.series  per-name counts
     * @param {Object<string,string>} cfg.colors    name → color
     * @param {Object|null} cfg.events              parsed events bundle
     * @param {boolean} cfg.showEvents
     * @param {string|null} cfg.country             active country scope
     * @param {boolean} cfg.compact                 true ≤ 640px: markers keep
     *                                              their lines, labels move to
     *                                              the tooltip only
     * @param {string} [cfg.valueAxisLabel]         y-axis name
     * @param {function(string):string} [cfg.labelFor]  series name → display label
     * @param {Array<number>} [cfg.focusRange]      [startYear, endYear] the axis
     *                                              opens on; the reader can zoom
     *                                              back out to the full range
     * @param {boolean} [cfg.includeAllCountries]   show country-scoped events on
     *                                              the unfiltered view too
     */
    P.buildAnnotatedTimeline = function (cfg) {
        var years = cfg.years || [];
        var names = cfg.seriesNames || [];
        var series = cfg.series || {};
        var colors = cfg.colors || {};
        var labelFor = cfg.labelFor || function (n) { return n; };

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var resolve = ns.resolveCssVar || function () { return ''; };
        var mutedResolved   = resolve('--muted') || tokens.muted || '#767880';
        var borderResolved  = resolve('--border') || tokens.border || '#d4d6da';
        var surfaceResolved = resolve('--surface-raised') || tokens.surfaceRaised
            || tokens.surface || '#fafaf9';
        var primaryResolved = resolve('--primary') || tokens.primary || '#e64a19';

        var chartSeries = names.map(function (name) {
            return {
                name: labelFor(name),
                type: 'line',
                showSymbol: false,
                symbol: 'circle',
                symbolSize: 4,
                lineStyle: { width: 2 },
                emphasis: { focus: 'series' },
                itemStyle: { color: colors[name] },
                data: series[name] || []
            };
        });

        if (cfg.events && cfg.showEvents) {
            var visible = P.visibleTimelineEvents(cfg.events, cfg.country, {
                includeAllCountries: cfg.includeAllCountries
            });
            if (visible.points.length || visible.periods.length) {
                chartSeries.push(buildAnnotationSeries(
                    P.orderTimelineEvents(visible), {
                        compact: cfg.compact,
                        numbered: !!cfg.numberedEvents,
                        muted: mutedResolved,
                        border: borderResolved,
                        surface: surfaceResolved,
                        primary: primaryResolved
                    }));
            }
        }

        var zoom = (ns.chartOptions && ns.chartOptions._dataZoom)
            ? ns.chartOptions._dataZoom(years.length, { threshold: 30 })
            : [];
        // Open on the window where the evidence actually sits. The full range
        // stays reachable — this only moves the initial zoom handles.
        if (cfg.focusRange && cfg.focusRange.length === 2 && years.length) {
            var lo = years.indexOf(cfg.focusRange[0]);
            var hi = years.indexOf(cfg.focusRange[1]);
            if (lo > 0 && hi >= lo) {
                var startPct = (lo / (years.length - 1)) * 100;
                var endPct = (hi / (years.length - 1)) * 100;
                zoom = (zoom || []).map(function (z) {
                    return Object.assign({}, z, { start: startPct, end: endPct });
                });
                if (!zoom.length) {
                    zoom = [{ type: 'inside', start: startPct, end: endPct }];
                }
            }
        }

        var R = ns.responsive;
        var base = {
            grid: (ns.chartOptions && ns.chartOptions._grid)
                ? ns.chartOptions._grid({ left: 64, top: 56, bottom: 56 })
                : { left: 64, right: 24, top: 56, bottom: 56, containLabel: true },
            legend: { type: 'scroll', top: 4, itemWidth: 14, itemHeight: 3 },
            tooltip: {
                trigger: 'axis',
                confine: true,
                axisPointer: { type: 'line' },
                formatter: (ns.chartOptions && ns.chartOptions.sortedAxisTooltip)
                    ? ns.chartOptions.sortedAxisTooltip({
                        skip: function (p) { return !p.value; },
                        row: function (p) {
                            return p.marker + ' ' + P.escapeHtml(p.seriesName)
                                + ': <strong>' + P.formatNumber(p.value) + '</strong>';
                        }
                    })
                    : undefined
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: years.map(String),
                name: P.t('Year'),
                nameLocation: 'middle',
                nameGap: 28
            },
            yAxis: Object.assign(
                { type: 'value' },
                (ns.chartOptions && ns.chartOptions._valueAxisName)
                    ? ns.chartOptions._valueAxisName(cfg.valueAxisLabel || '')
                    : { name: cfg.valueAxisLabel || '' }
            ),
            dataZoom: zoom,
            series: chartSeries
        };
        return R && R.withMedia
            ? R.withMedia(base, R.valueChartMedia({ hasZoom: years.length > 30 }))
            : base;
    };

    /**
     * The annotation series carries no data — it exists purely for its
     * markLine (point events) and markArea (period events). Periods render
     * UNDER the data lines (z: 0), point markers above (markLine z: 10).
     * Label positions alternate top/bottom across adjacent events so
     * closely-spaced years (2015/2016/2017) don't stack labels.
     *
     * In numbered mode the label is a badge carrying the event's number and
     * the name lives in the list below; otherwise it is the (truncated) name
     * itself. `rotate: 0` is load-bearing for the badge — markLine labels
     * otherwise inherit the rotation of the line they sit on, and a sideways
     * digit is worse than no digit.
     */
    /**
     * One markLine entry per point event — except in numbered mode, where
     * events sharing a year collapse into a single marker whose badge carries
     * both numbers ("3·4").
     *
     * Text labels alternate top and bottom so closely-spaced years don't
     * stack. Badges do not: they sit in one row just inside the top of the
     * grid, because the alternate anchor lands outside it and prints over the
     * legend, and because a badge is small enough that adjacent years clear
     * each other. What a badge cannot survive is two events in the SAME year
     * (1991 has two here) — those would draw exactly on top of one another
     * and silently hide one, so they are merged instead.
     */
    function markLineData(points, style) {
        if (!style.numbered) {
            return points.map(function (row, i) {
                return {
                    xAxis: String(row.event.year),
                    iwacLabel: P.timelineEventLabel(row.event),
                    iwacNumber: row.n,
                    label: {
                        position: i % 2 === 0 ? 'insideEndTop' : 'insideEndBottom'
                    }
                };
            });
        }
        var years = [];
        var byYear = {};
        points.forEach(function (row) {
            var year = String(row.event.year);
            if (!byYear[year]) {
                byYear[year] = [];
                years.push(year);
            }
            byYear[year].push(row);
        });
        return years.map(function (year) {
            var rows = byYear[year];
            return {
                xAxis: year,
                iwacLabel: rows.map(function (row) {
                    return P.timelineEventLabel(row.event);
                }).join(' · '),
                iwacNumber: rows.map(function (row) {
                    return row.n;
                }).join('·'),
                // `insideEndBottom`, counter-intuitively, is the one INSIDE
                // the plot: on a vertical markLine "end" is the top of the
                // line, so "Top" anchors above it — outside the grid, over
                // the legend. Verified in the browser, not inferred.
                label: { position: 'insideEndBottom' }
            };
        });
    }

    function buildAnnotationSeries(ordered, style) {
        var points = ordered.filter(function (row) {
            return row.kind === 'point';
        });
        var periods = ordered.filter(function (row) {
            return row.kind === 'period';
        });
        // No fixed `width`: a merged badge carries two numbers and would be
        // clipped by one. Padding sizes it to its content instead.
        var badge = style.numbered ? {
            rotate: 0,
            fontWeight: 'bold',
            align: 'center',
            padding: [3, 5],
            borderColor: style.border,
            borderWidth: 1,
            borderRadius: 9
        } : {};
        return {
            name: '__events__',
            type: 'line',
            data: [],
            silent: true,
            showSymbol: false,
            legendHoverLink: false,
            tooltip: { show: false },
            markLine: {
                symbol: ['none', 'none'],
                silent: false,
                z: 10,
                label: Object.assign({
                    show: !style.compact,
                    formatter: function (p) {
                        var data = p.data || {};
                        return style.numbered
                            ? String(data.iwacNumber || '')
                            : truncateLabel(data.iwacLabel || '', LABEL_MAX_CHARS);
                    },
                    color: style.muted,
                    fontSize: 11,
                    backgroundColor: style.surface,
                    padding: [2, 6],
                    borderRadius: 3
                }, badge),
                lineStyle: {
                    color: style.border,
                    type: 'dashed',
                    width: 1
                },
                emphasis: {
                    // Hover reads the name out in place. In numbered mode the
                    // badge stays put and the name appears beside it, so
                    // pointing at a marker answers "which one is this" without
                    // a trip to the list.
                    label: Object.assign({
                        show: true,
                        formatter: function (p) {
                            return (p.data && p.data.iwacLabel) || '';
                        }
                    }, style.numbered
                        ? { rotate: 0, borderWidth: 0, padding: [2, 6],
                            color: style.muted }
                        : {}),
                    lineStyle: { color: style.muted }
                },
                data: markLineData(points, style)
            },
            markArea: {
                silent: true,
                z: 0,
                itemStyle: {
                    color: style.primary,
                    opacity: 0.06
                },
                // Shaded bands carry their number at the top-left in numbered
                // mode, so a period is findable in the list the same way a
                // point marker is. Unnumbered they stay unlabelled: a band's
                // name has nowhere to sit without covering the data.
                label: style.numbered
                    ? Object.assign({
                        show: true,
                        // Centred over the band rather than pinned to its
                        // left edge: a period almost always begins in the
                        // same year as a point event (2002 opens both the
                        // Ivorian civil war band and its own marker), and at
                        // the edge the two badges land exactly on top of each
                        // other. The band shows its own extent; the badge
                        // only has to be findable.
                        position: 'insideTop',
                        formatter: function (p) {
                            return String((p.data && p.data.iwacNumber) || '');
                        },
                        color: style.muted,
                        fontSize: 11,
                        backgroundColor: style.surface,
                        padding: [2, 6],
                        borderRadius: 3
                    }, badge)
                    : { show: false },
                data: periods.map(function (row) {
                    return [
                        { xAxis: String(row.event.start), iwacNumber: row.n },
                        { xAxis: String(row.event.end) }
                    ];
                })
            }
        };
    }

    /**
     * The event list under the chart: every visible event as plain text, so
     * screen readers, no-hover readers and printouts get the full names
     * without depending on chart interactivity.
     *
     * With `opts.numbered` this stops being a fallback and becomes the
     * primary place the names are read: each entry carries the badge number
     * its marker shows, and the disclosure opens by default — a numbered
     * marker with its key folded away would be a puzzle rather than a legend.
     *
     * @param {Object} events        parsed events bundle
     * @param {string|null} country  active country scope
     * @param {Object} [opts]
     * @param {string} [opts.summaryKey]  i18n key for the <summary>
     * @param {string} [opts.className]   class on the <details>
     * @param {string} [opts.siteBase]    when set, events carrying `o_id` or
     *                                    `document_o_id` link to their item page
     * @param {boolean} [opts.includeAllCountries]  see visibleTimelineEvents
     * @param {boolean} [opts.numbered]   key each entry to its marker badge
     */
    P.buildTimelineEventsDetails = function (events, country, opts) {
        opts = opts || {};
        var visible = P.visibleTimelineEvents(events, country, {
            includeAllCountries: opts.includeAllCountries
        });
        // Same ordering and numbering the chart uses — one source, so the
        // badges cannot drift out of step with the list.
        var ordered = P.orderTimelineEvents(visible);
        if (!ordered.length) return null;

        var details = P.el('details', opts.className || 'iwac-vis-timeline-details');
        if (opts.numbered) details.open = true;
        details.appendChild(P.el('summary', null,
            P.t(opts.summaryKey || 'Historical events')));
        var list = P.el('ul', 'iwac-vis-timeline-details-list');
        if (opts.numbered) list.classList.add('is-numbered');

        ordered.forEach(function (row) {
            var e = row.event;
            var li = P.el('li');
            if (opts.numbered) {
                li.appendChild(P.el('span', 'iwac-vis-timeline-details-n',
                    String(row.n)));
            }
            var when = row.kind === 'period' ? e.start + '–' + e.end : String(e.year);
            li.appendChild(P.el('span', 'iwac-vis-timeline-details-year', when));
            li.appendChild(document.createTextNode(' ' + P.timelineEventLabel(e)));
            // An event can carry both an authority record and the primary
            // source that generated the coverage; emit a link for each,
            // because collapsing them mislabels whichever one loses.
            [
                { id: e.o_id, key: 'Record' },
                { id: e.document_o_id, key: 'Source document' }
            ].forEach(function (link) {
                if (!opts.siteBase || !link.id) return;
                li.appendChild(document.createTextNode(' · '));
                var a = P.el('a', 'iwac-vis-timeline-details-link', P.t(link.key));
                a.href = opts.siteBase + '/item/' + link.id;
                li.appendChild(a);
            });
            list.appendChild(li);
        });
        details.appendChild(list);
        return details;
    };
})();
