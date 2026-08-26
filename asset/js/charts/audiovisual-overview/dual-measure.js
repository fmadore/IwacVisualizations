/**
 * IWAC Visualizations — Audiovisual Overview: dual-measure ranking panel
 *
 * One panel module, two panels: the source ranking and the country ranking
 * are the *same* control — rank a set of entries by either of two measures
 * the entries both carry — so they are one implementation with a config,
 * not two near-copies that drift.
 *
 * **Why both measures ship.** On this subset the ranking inverts. Counting
 * recordings puts the national broadcaster first and the deposited archive
 * sixth; counting runtime reverses them, because one publishes short news
 * reports and the other hours-long lectures. Same for the countries: Burkina
 * Faso carries twenty times Nigeria's recordings and less of its runtime.
 * A panel that offered only one measure would not be a simpler version of
 * this one — it would be a wrong one, and silently.
 *
 * Items is the default because it is the measure every other block in the
 * module counts in, so the reader arrives on familiar ground and finds the
 * inversion by switching. The toggle is the finding.
 *
 * Load order: after shared/panels.js, shared/chart-options.js,
 * shared/facet-buttons.js and shared/faceted-chart.js; before the
 * audiovisual-overview orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons || !P.buildFacetedChart) {
        console.warn('IWACVis.audiovisual-overview/dual-measure: missing dependencies');
        return;
    }

    var MEASURES = {
        items:   { valueKey: 'items',   labelKey: 'av.measure_items' },
        runtime: { valueKey: 'seconds', labelKey: 'av.measure_runtime' }
    };

    /**
     * Tooltip carrying BOTH measures whichever is on the axis, plus the
     * typical length that explains the gap between them. A reader who has
     * just switched measures and found the order changed needs the reason
     * in the same place as the surprise.
     */
    function tooltipFor(entry, measure) {
        if (!entry) return '';
        var lines = [
            '<strong>' + P.escapeHtml(entry.name) + '</strong>',
            P.t(measure === 'runtime' ? 'av.tip_runtime' : 'av.tip_items', {
                count:    P.formatNumber(entry.items),
                duration: P.formatTotalDuration(entry.seconds)
            })
        ];
        if (entry.median_seconds > 0) {
            lines.push(P.t('av.tip_median', {
                duration: P.formatDuration(entry.median_seconds)
            }));
        }
        return lines.join('<br/>');
    }

    /**
     * @param {{panel: HTMLElement, chart: HTMLElement}} panelEl
     * @param {Array<Object>} entries  Each: { name, items, seconds, median_seconds? }
     * @param {Object} [opts]
     * @param {boolean} [opts.useCountryColors=false]
     * @param {string}  [opts.initial='items']  Which measure the panel opens on.
     */
    function render(panelEl, entries, opts) {
        opts = opts || {};
        var list = (entries || []).filter(function (e) {
            return e && e.name && (e.items > 0 || e.seconds > 0);
        });

        if (!list.length) {
            panelEl.chart.appendChild(P.buildEmptyState());
            return null;
        }

        var state = { measure: opts.initial || 'items' };

        function sorted() {
            var key = MEASURES[state.measure].valueKey;
            // Sort a copy: the payload order is the generator's (items desc)
            // and other panels read the same array.
            return list.slice().sort(function (a, b) {
                return (b[key] || 0) - (a[key] || 0);
            });
        }

        var ctrl = P.buildFacetedChart(panelEl, {
            getData: sorted,
            buildOption: function (rows) {
                var measure = state.measure;
                var byName = {};
                rows.forEach(function (r) { byName[r.name] = r; });

                return C.horizontalBar(rows, {
                    nameKey: 'name',
                    valueKey: MEASURES[measure].valueKey,
                    useCountryColors: Boolean(opts.useCountryColors),
                    valueFormatter: measure === 'runtime'
                        ? P.formatTotalDuration
                        : P.formatNumber,
                    // Through the option, never by assigning to the returned
                    // `option.tooltip`: with responsive rules the return is
                    // `{baseOption, media}` and that assignment is silently
                    // dropped.
                    tooltipFormatter: function (p) {
                        return tooltipFor(byName[p.name], measure);
                    }
                });
            }
        });

        if (!ctrl) return null;

        var facetBar = P.buildFacetButtons({
            facets: Object.keys(MEASURES).map(function (key) {
                return { key: key, label: P.t(MEASURES[key].labelKey) };
            }),
            activeKey: state.measure,
            onChange: function (evt) {
                state.measure = evt.facet;
                ctrl.rerender();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        return ctrl;
    }

    ns.audiovisualOverview = ns.audiovisualOverview || {};
    ns.audiovisualOverview.dualMeasure = { render: render };
})();
