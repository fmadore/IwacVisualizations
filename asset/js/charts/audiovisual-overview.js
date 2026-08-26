/**
 * IWAC Visualizations — Audiovisual Overview block orchestrator
 *
 * Corpus-level view of the IWAC `audiovisual` subset, built entirely from
 * the precomputed `audiovisual-overview.json`
 * (`scripts/generate_audiovisual_overview.py`).
 *
 * Panels, in reading order:
 *
 *   summary        recordings / runtime / sources / countries, then the
 *                  standfirst naming the two populations
 *   1. sources     dual-measure ranking — the block's headline (see
 *                  audiovisual-overview/dual-measure.js for why both
 *                  measures ship and why items is the default)
 *   2. durations   runtime histogram × population; the two barely overlap
 *   3. countries   the same dual-measure control, country-coloured
 *   4. timeline    publication year × source, with the partial-year note
 *   5. coverage    field completeness — the honest home for the thin
 *                  metadata surfaces
 *   6. recent      newest recordings, through the shared table
 *
 * This block draws no map: `country` is a four-value facet and `spatial`
 * carries seven values, ~99% of them repeating the country. So it declares
 * no MapLibre need and passes through no `P.withMaplibre` gate — there is
 * nothing here a basemap would add.
 *
 * Load order: after shared/panels.js, chart-options, facet-buttons,
 * faceted-chart, pagination, table, and the block's own panel modules.
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis audiovisual overview: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    /** Translate a `source_type` key, falling back to the raw value. */
    function sourceLabel(key) {
        return P.translateKeyed('av.source_', key);
    }

    /* ----------------------------------------------------------------- */
    /*  Scaffold                                                          */
    /* ----------------------------------------------------------------- */

    function buildScaffold(container, data) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-audiovisual-root');
        container.appendChild(root);

        var summary = data.summary || {};

        root.appendChild(P.buildSummaryCards([
            { labelKey: 'av.items',    value: summary.items },
            {
                labelKey: 'av.runtime',
                value: P.formatTotalDuration(summary.seconds),
                text: true
            },
            { labelKey: 'av.channels',  value: summary.channels },
            { labelKey: 'av.countries', value: summary.countries }
        ]));

        var period = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (period) root.appendChild(period);

        // Standfirst. The two-population split governs every panel below,
        // so it is stated once, up front, rather than repeated per panel.
        var standfirst = P.el('p', 'iwac-vis-overview-subtitle',
            P.t('av.populations_desc'));
        root.appendChild(standfirst);

        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var panels = {
            channels:  P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                                    P.t('av.channels_title'), P.t('av.channels_desc')),
            durations: P.buildPanel('iwac-vis-panel',
                                    P.t('av.durations_title'), P.t('av.durations_desc')),
            countries: P.buildPanel('iwac-vis-panel',
                                    P.t('av.countries_title'), P.t('av.countries_desc')),
            timeline:  P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                                    P.t('av.timeline_title'), P.t('av.timeline_desc')),
            coverage:  P.buildPanel('iwac-vis-panel',
                                    P.t('av.coverage_title'), P.t('av.coverage_desc')),
            recent:    P.buildPanel('iwac-vis-panel iwac-vis-panel--wide',
                                    P.t('av.recent_title'), P.t('av.recent_desc'))
        };

        [
            panels.channels, panels.durations, panels.countries,
            panels.timeline, panels.coverage, panels.recent
        ].forEach(function (p) { grid.appendChild(p.panel); });

        return panels;
    }

    /* ----------------------------------------------------------------- */
    /*  Panels                                                            */
    /* ----------------------------------------------------------------- */

    /** Runtime histogram, stacked by population. */
    function renderDurations(panelEl, data) {
        var d = (data && data.durations) || {};
        var buckets = d.buckets || [];
        var sources = d.sources || [];
        if (!buckets.length || !sources.length) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        ns.registerChart(panelEl.chart, function (el, chart) {
            chart.setOption(C.stackedBar({
                categories: buckets.map(function (k) { return P.t('av.bucket_' + k); }),
                stackKeys:  sources,
                series:     d.series || {}
            }, {
                labelFor: sourceLabel
            }), true);
        });
    }

    /** Publication year × source. */
    function renderTimeline(panelEl, data) {
        var t = (data && data.timeline) || {};
        var years = t.years || [];
        if (!years.length) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        ns.registerChart(panelEl.chart, function (el, chart) {
            chart.setOption(C.stackedBar({
                categories: years,
                stackKeys:  t.channels || [],
                series:     t.series || {}
            }, {
                labelFor: function (key) {
                    return key === '__other__' ? P.t('av.timeline_other') : key;
                }
            }), true);
        });

        // Two standing caveats, printed rather than left for the reader to
        // infer from a shape: the newest year is a partial year (ingestion
        // is continuous), and undated rows are absent rather than zero.
        var notes = [];
        if (t.partial_year && t.latest_date) {
            notes.push(P.t('av.timeline_partial', {
                year: t.partial_year,
                date: P.formatDate(t.latest_date)
            }));
        }
        if (t.undated > 0) {
            notes.push(P.t('av.timeline_undated', { count: P.formatNumber(t.undated) }));
        }
        if (notes.length) {
            panelEl.panel.appendChild(
                P.el('p', 'iwac-vis-panel-desc iwac-vis-panel-desc--footnote',
                     notes.join(' '))
            );
        }
    }

    /** Field completeness. */
    function renderCoverage(panelEl, data) {
        var rows = (data && data.coverage) || [];
        if (!rows.length) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return;
        }

        var entries = rows.map(function (r) {
            return {
                name:    P.t('av.coverage_' + r.key),
                present: r.present,
                total:   r.total,
                percent: r.total > 0 ? Math.round((r.present / r.total) * 100) : 0
            };
        }).sort(function (a, b) { return b.present - a.present; });

        var byName = {};
        entries.forEach(function (e) { byName[e.name] = e; });

        ns.registerChart(panelEl.chart, function (el, chart) {
            chart.setOption(C.horizontalBar(entries, {
                nameKey: 'name',
                valueKey: 'present',
                tooltipFormatter: function (p) {
                    var e = byName[p.name];
                    if (!e) return '';
                    return '<strong>' + P.escapeHtml(e.name) + '</strong><br/>' +
                        P.escapeHtml(P.t('av.coverage_tip', {
                            present: P.formatNumber(e.present),
                            total:   P.formatNumber(e.total),
                            percent: e.percent
                        }));
                }
            }), true);
        });
    }

    /* ----------------------------------------------------------------- */
    /*  Render                                                            */
    /* ----------------------------------------------------------------- */

    function render(container, data) {
        var panels = buildScaffold(container, data);
        var block = ns.audiovisualOverview || {};

        if (block.dualMeasure) {
            block.dualMeasure.render(panels.channels, data.channels, {
                initial: 'items'
            });
            block.dualMeasure.render(panels.countries, data.countries, {
                initial: 'items',
                useCountryColors: true
            });
        }

        renderDurations(panels.durations, data);
        renderTimeline(panels.timeline, data);
        renderCoverage(panels.coverage, data);

        if (block.recent) block.recent.render(panels.recent.chart, data);
    }

    P.bootBlock({
        selector:       '.iwac-vis-audiovisual-overview',
        warnLabel:      'IWACVis audiovisual overview',
        requireECharts: true,
        dataFile:       'audiovisual-overview.json',
        beforeLoad:     function (container) {
            var loadingLabel = container.querySelector('.iwac-vis-loading span');
            if (loadingLabel) {
                loadingLabel.textContent = P.t('Loading audiovisual overview') + '…';
            }
        },
        render:         render
    });
})();
