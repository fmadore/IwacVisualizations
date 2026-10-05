/**
 * IWAC Visualizations — Laïcité block: Timeline view (issue #14, view 2).
 *
 * One series across the year axis — the share of available texts
 * matching the core vocabulary, or the matching documents, or the raw
 * occurrences — for one corpus, country, outlet, searched field and
 * matching rule at a time, built from `trends.research` (the per corpus ×
 * country × outlet × year cells). The curated event annotations from
 * laicite-events.json ride on top. The chart itself is
 * `shared/annotated-timeline.js`, shared with the Scary Terms block; this
 * file supplies the series, the title and the labels.
 *
 * It used to draw one line per argumentative frame from the bundle's
 * `global` / `by_country` / `by_subset` frame series, scoped by EITHER a
 * country OR a corpus. The research series replaced that, and the corpus
 * always has a value now, so the frame-series path could no longer be
 * reached — a bundle without `research` gets the block's empty state.
 *
 * The axis opens on `focus_range` rather than the full span: a handful of
 * `references` predate the press corpus by decades (earliest 1922), so the
 * raw range would leave four fifths of the axis empty. The reader can zoom
 * back out — the data is all there.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels) {
        console.warn('IWACVis.laicite trends: missing panels — check load order');
        return;
    }
    var P = ns.panels;
    var L = ns.laicite = ns.laicite || {};

    /**
     * Build the timeline option.
     *
     * @param {Object} cfg {trends, metadata, events, state, frameColors, compact}
     */
    L.buildTrendsOption = function (cfg) {
        var research = cfg.trends && cfg.trends.research;
        if (!research) return P.emptyChartOption();
        var resolved = L.researchSeries(research, cfg.state);
        if (!resolved.years.length) return P.emptyChartOption();
        var metadata = cfg.metadata || {};
        return P.buildAnnotatedTimeline({
            years: resolved.years,
            seriesNames: resolved.frames,
            series: resolved.series,
            colors: cfg.frameColors,
            labelFor: function () { return resolved.label; },
            events: cfg.state.trendsSubset === 'references' ? null : cfg.events,
            showEvents: cfg.state.showEvents,
            country: cfg.state.trendsCountry,
            // Every curated marker here is national — national conferences,
            // constitutional moments, the Ouagadougou forum — so the
            // unfiltered view shows all of them rather than none. Filtering
            // to one country then narrows to that country's markers.
            includeAllCountries: true,
            // Numbered badges rather than in-plot names. These markers are
            // national conferences, constitutional revisions and colloquia,
            // so their curated names are full institutional titles — there is
            // no font size at which a dozen of those are legible inside the
            // plot. The badges key into the list below, where the names are
            // read in full and carry their links.
            numberedEvents: true,
            compact: cfg.compact,
            valueAxisLabel: resolved.label,
            focusRange: metadata.focus_range
        });
    };

    /** The chart title names every facet the series is cut by. */
    L.trendsTitle = function (state) {
        return P.t('laicite.trends_chart_title') + ' — '
            + [L.subsetLabel(state.trendsSubset || 'articles'), state.trendsCountry, state.trendsOutlet,
                P.t('laicite.research_' + (state.trendsField || 'fulltext')),
                P.t('laicite.research_' + (state.trendsPrecision || 'strict'))].filter(Boolean).join(' · ');
    };

    /**
     * The numbered event key under the chart — where the marker names are
     * actually read. Events carrying an IWAC o_id link to their authority
     * record; those carrying document_o_id link to the primary source that
     * generated the coverage — the move this block exists to make.
     */
    L.buildEventsDetails = function (events, state, siteBase) {
        return P.buildTimelineEventsDetails(
            events,
            state.trendsCountry,
            {
                summaryKey: 'Historical events',
                className: 'iwac-vis-laicite-details',
                siteBase: siteBase,
                includeAllCountries: true,
                numbered: true
            }
        );
    };
})();
