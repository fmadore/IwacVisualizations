/**
 * IWAC Visualizations — Calendar heatmap renderer
 *
 * Multi-year per-day heatmap using ECharts' `calendar` coordinate
 * system, one row per year. Cells are `[YYYY-MM-DD, count]` pairs.
 * Colour ramp tracks the IWAC theme's `--iwac-vis-heatmap-*` tokens via
 * `ns.resolveCssVar` so it follows `--primary` and flips for dark mode.
 *
 * Use case: publication-density visualisation across the corpus or for
 * a single entity (person / index entry). Daily granularity surfaces
 * bursts (e.g. coverage spikes around a single event) that monthly
 * year × month heatmaps obscure.
 *
 * Data shape:
 *
 *     {
 *       cells:    [['2020-01-15', 3], ['2020-01-16', 1], ...],
 *       yearMin:  2018,                   // optional, derived from cells
 *       yearMax:  2024                    // optional, derived from cells
 *     }
 *
 * Slot options (`slot.options`):
 *   - `cellSize` (number)            cell height in px, default 14
 *   - `cellGap`  (number)            extra padding between calendars in px, default 80
 *
 * Registered as `calendarHeatmap`. Predicate: empty when `cells` is missing
 * or empty.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var DL = ns.dashboardLayout;
    if (!P || !DL) {
        console.warn('IWACVis.calendar-heatmap: dashboard-layout.js + panels.js must load first');
        return;
    }

    function deriveYears(cells) {
        var min = Infinity;
        var max = -Infinity;
        for (var i = 0; i < cells.length; i++) {
            var d = String(cells[i][0] || '');
            if (d.length < 4) continue;
            var y = parseInt(d.slice(0, 4), 10);
            if (isNaN(y)) continue;
            if (y < min) min = y;
            if (y > max) max = y;
        }
        if (min === Infinity) return null;
        return { min: min, max: max };
    }

    function buildOption(data, slot) {
        var cells = (data && data.cells) || [];
        var yearMin = data && data.yearMin;
        var yearMax = data && data.yearMax;
        if (yearMin == null || yearMax == null) {
            var derived = deriveYears(cells);
            if (!derived) return null;
            if (yearMin == null) yearMin = derived.min;
            if (yearMax == null) yearMax = derived.max;
        }

        var opts = (slot && slot.options) || {};
        var cellSize = opts.cellSize || 14;
        var cellGap  = opts.cellGap  || 80;

        // One calendar component per year, stacked vertically.
        var years = [];
        for (var y = yearMin; y <= yearMax; y++) years.push(y);

        var max = 1;
        for (var i = 0; i < cells.length; i++) {
            if (cells[i][1] > max) max = cells[i][1];
        }

        // Theme-aware colour ramp — same tokens the year × month
        // heatmap reads (--iwac-vis-heatmap-0..4). resolveCssVar handles
        // the OKLCH → rgb conversion for theme v2.0.0+ tokens.
        var resolve = ns.resolveCssVar || function () { return ''; };
        var tokens  = (ns.getChartTokens && ns.getChartTokens()) || {};
        var stops = [
            resolve('--iwac-vis-heatmap-0'),
            resolve('--iwac-vis-heatmap-1'),
            resolve('--iwac-vis-heatmap-2'),
            resolve('--iwac-vis-heatmap-3'),
            resolve('--iwac-vis-heatmap-4')
        ].filter(Boolean);
        if (stops.length < 2) stops = [tokens.surface, tokens.primary].filter(Boolean);

        var calendars = years.map(function (yr, idx) {
            return {
                top: 40 + idx * (cellSize * 7 + cellGap),
                left: 56,
                right: 24,
                cellSize: ['auto', cellSize],
                range: String(yr),
                itemStyle: {
                    borderColor: tokens.surface || '#fff',
                    borderWidth: 1
                },
                splitLine: { show: false },
                yearLabel: {
                    show: true,
                    margin: 24,
                    color: tokens.inkLight,
                    fontSize: 12,
                    fontWeight: 600
                },
                dayLabel: {
                    nameMap: ns.locale === 'fr' ? 'fr' : 'en',
                    color: tokens.muted,
                    fontSize: 9
                },
                monthLabel: {
                    nameMap: ns.locale === 'fr' ? 'fr' : 'en',
                    color: tokens.inkLight,
                    fontSize: 10
                }
            };
        });

        var series = years.map(function (yr, idx) {
            var prefix = String(yr) + '-';
            var yearCells = cells.filter(function (c) { return String(c[0]).indexOf(prefix) === 0; });
            return {
                type: 'heatmap',
                coordinateSystem: 'calendar',
                calendarIndex: idx,
                data: yearCells
            };
        });

        var totalH = 40 + years.length * (cellSize * 7 + cellGap);

        return {
            _suggestedHeight: totalH,
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    if (!p.data || !p.data[0]) return '';
                    return '<strong>' + P.escapeHtml(String(p.data[0])) + '</strong><br>' +
                        P.t('mentions_count', { count: P.formatNumber(p.data[1] || 0) });
                }
            },
            visualMap: {
                min: 0,
                max: max,
                calculable: true,
                orient: 'horizontal',
                left: 56,
                top: 8,
                itemWidth: 12,
                itemHeight: 80,
                textStyle: { color: tokens.inkLight, fontSize: 10 },
                inRange: { color: stops }
            },
            calendar: calendars,
            series: series
        };
    }

    DL.registerRenderer('calendarHeatmap', function (el, data, slot) {
        var option = buildOption(data, slot);
        if (!option) {
            el.appendChild(P.buildEmptyState());
            return;
        }
        // Stretch the host so all year rows are visible without
        // squashing — caller's panel height grows with content.
        if (option._suggestedHeight) {
            el.style.minHeight = option._suggestedHeight + 'px';
            delete option._suggestedHeight;
        }
        ns.registerChart(el, function (_e, instance) {
            instance.setOption(option, true);
        });
    });

    DL.registerMetadata('calendarHeatmap', {
        labelKey: 'Calendar heatmap',
        descKey:  'desc_calendar_heatmap',
        hasData:  function (v) { return v && Array.isArray(v.cells) && v.cells.length > 0; }
    });
})();
