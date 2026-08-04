/**
 * IWAC Visualizations — Scary Terms block: Trends view builders (issue #2).
 *
 * Stateless option/DOM builders for the time-series view: one line per
 * term family across the collection's year range, with hand-curated
 * historical-event annotations (markLine verticals + markArea bands)
 * from asset/data/scary-terms-events.json.
 *
 * The chart itself now lives in `shared/annotated-timeline.js`, extracted
 * when the Laïcité block (issue #14) needed the same annotated time series
 * with a different value-axis label and i18n namespace. This file keeps its
 * public API — the orchestrator is unchanged — and supplies the
 * scary-terms-specific labels and class names.
 *
 * Loaded after scary-terms/helpers.js, before the orchestrator, which
 * aliases these via IWACVis.scaryTerms.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.scaryTerms trends: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var S = ns.scaryTerms = ns.scaryTerms || {};

    /**
     * Derive the aligned `{family: [count/year]}` series the trends view
     * needs from the temporal bundle (`{year: {data: [[family, count]]}}`)
     * — the fallback path when a deploy predates scary-terms-trends.json.
     */
    S.buildTrendsSeriesFromTemporal = function (temporal, years, families) {
        var series = {};
        families.forEach(function (f) {
            series[f] = years.map(function () { return 0; });
        });
        years.forEach(function (year, yi) {
            var pairs = (temporal[String(year)] || {}).data || [];
            pairs.forEach(function (pair) {
                if (series[pair[0]]) series[pair[0]][yi] = pair[1];
            });
        });
        return series;
    };

    /** Filter the curated events to those visible for the active country
     *  scope. Delegates to the shared implementation. */
    S.visibleEvents = function (events, country) {
        return P.visibleTimelineEvents(events, country);
    };

    S.eventLabel = function (e) {
        return P.timelineEventLabel(e);
    };

    /**
     * Build the ECharts option for the trends view — the shared annotated
     * timeline, with this block's family colors and value-axis label.
     *
     * @param {Object} cfg  {years, families, series, termColors, events,
     *                       showEvents, country, compact}
     */
    S.buildTrendsOption = function (cfg) {
        return P.buildAnnotatedTimeline({
            years: cfg.years,
            seriesNames: cfg.families || [],
            series: cfg.series,
            colors: cfg.termColors,
            events: cfg.events,
            showEvents: cfg.showEvents,
            country: cfg.country,
            compact: cfg.compact,
            valueAxisLabel: P.t('scary.occurrences')
        });
    };

    /**
     * `<details>` fallback listing every visible event as plain text.
     * Delegates to the shared implementation, keeping this block's
     * summary label and class name.
     */
    S.buildEventsDetails = function (events, country) {
        return P.buildTimelineEventsDetails(events, country, {
            summaryKey: 'scary.events_list',
            className: 'iwac-vis-scary-details'
        });
    };
})();
