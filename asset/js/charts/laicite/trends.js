/**
 * IWAC Visualizations — Laïcité block: Timeline view (issue #14, view 2).
 *
 * One line per argumentative frame across the year axis, with the curated
 * event annotations from laicite-events.json. The chart itself is
 * `shared/annotated-timeline.js`, shared with the Scary Terms block; this
 * file supplies the scope resolution (global / country / corpus) and the
 * labels.
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
     * Resolve the active series for the current scope.
     *
     * @param {Object} trends   the trends bundle
     * @param {Object} state    {trendsCountry, trendsSubset}
     */
    L.resolveTrendsSeries = function (trends, state) {
        if (!trends || !trends.years || !trends.years.length) return null;
        var series = trends.global;
        if (state.trendsSubset) {
            series = (trends.by_subset || {})[state.trendsSubset] || {};
        } else if (state.trendsCountry) {
            series = (trends.by_country || {})[state.trendsCountry] || {};
        }
        return {
            years: trends.years,
            frames: trends.families || [],
            series: series || {}
        };
    };

    /**
     * Build the timeline option.
     *
     * @param {Object} cfg {trends, metadata, events, state, frameColors, compact}
     */
    L.buildTrendsOption = function (cfg) {
        var resolved = L.resolveTrendsSeries(cfg.trends, cfg.state);
        if (!resolved) return P.emptyChartOption();
        var metadata = cfg.metadata || {};
        return P.buildAnnotatedTimeline({
            years: resolved.years,
            seriesNames: resolved.frames,
            series: resolved.series,
            colors: cfg.frameColors,
            labelFor: function (frame) { return L.frameLabel(metadata, frame); },
            events: cfg.events,
            showEvents: cfg.state.showEvents,
            country: cfg.state.trendsSubset ? null : cfg.state.trendsCountry,
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
            valueAxisLabel: P.t('laicite.occurrences'),
            focusRange: metadata.focus_range
        });
    };

    L.trendsTitle = function (state) {
        if (state.trendsSubset) {
            return P.t('laicite.trends_chart_title') + ' — '
                + L.subsetLabel(state.trendsSubset);
        }
        if (state.trendsCountry) {
            return P.t('laicite.trends_country_chart_title',
                { country: state.trendsCountry });
        }
        return P.t('laicite.trends_chart_title');
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
            state.trendsSubset ? null : state.trendsCountry,
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
