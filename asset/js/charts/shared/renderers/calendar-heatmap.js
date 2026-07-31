/**
 * IWAC Visualizations — Calendar heatmap renderer
 *
 * Publication-density heatmap over a set of dated cells, with three
 * granularities the reader switches between from a facet bar:
 *
 *   `month`  (default)  Gregorian year × month grid — 12 fixed rows,
 *                       one column per year. Compact: a 60-year corpus
 *                       fits one screen.
 *   `day`               Per-day calendar, one ECharts `calendar`
 *                       component per year. Surfaces single-event
 *                       bursts, but costs ~130 px of height per year
 *                       and is mostly whitespace for any entity with
 *                       fewer than a few thousand articles — hence
 *                       opt-in rather than the default.
 *   `hijri`             Hijri year × month grid, same shape as `month`,
 *                       drawn from the Umm al-Qura dates the dataset
 *                       stores. Makes the liturgical rhythm legible —
 *                       Ramadan and Dhu al-Hijja read as rows instead of
 *                       being smeared across two Gregorian months that
 *                       drift ~11 days a year. Omitted when the producer
 *                       ships no `hijriCells`.
 *
 * Colour ramp tracks the IWAC theme's `--iwac-vis-heatmap-*` tokens via
 * `ns.resolveCssVar` so it follows `--primary` and flips for dark mode.
 *
 * Data shape:
 *
 *     {
 *       cells:      [['2020-01-15', 3], ['2020-01-16', 1], ...],
 *       hijriCells: [[1441, 5, 8], [1441, 6, 3], ...],  // optional
 *       yearMin:    2018,                 // optional, derived from cells
 *       yearMax:    2024                  // optional, derived from cells
 *     }
 *
 * Cell dates must be day-precision ISO (`YYYY-MM-DD`); the `day` view
 * places a mark on an exact square. Producers drop year-only / year-month
 * dates rather than fake-positioning them (see `generate_topic_explorer.py`),
 * so callers should say so in the panel description.
 *
 * `hijriCells` is `[hijriYear, hijriMonth, count]`, already folded to the
 * grid the Hijri facet draws. It is a separate series rather than a
 * conversion of `cells` because the lunar dates are read from the
 * dataset, never derived in the browser — see the Hijri cells section
 * below for why that distinction matters. Omit it and the facet is not
 * offered.
 *
 * Slot options (`slot.options`):
 *   - `granularity` (string)         initial view, default 'month'
 *   - `views`       (string[])       which views to offer, default all
 *   - `cellSize`    (number)         day-view cell height in px, default 14
 *   - `cellGap`     (number)         day-view padding between years, default 80
 *   - `unitKey`     (string)         i18n key for the tooltip count,
 *                                    default 'mentions_count'
 *
 * The view switcher needs `facet-buttons.js` (`needs.facetButtons` in the
 * block's asset declaration). Without it the renderer still draws, fixed
 * to whichever view `granularity` names.
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

    /* ----------------------------------------------------------------- */
    /*  Month labels                                                      */
    /* ----------------------------------------------------------------- */
    //
    // Kept local rather than pushed through the i18n dictionary, matching
    // `chartOptions.heatmap`'s existing treatment of Gregorian months:
    // these are axis furniture, always needed as a complete ordered set,
    // and never reused outside a month grid.

    var GREGORIAN_MONTHS = {
        en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        fr: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
             'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']
    };

    // Transliterations follow the forms used in the IWAC corpus's own
    // francophone press (Ramadan, Tabaski season) rather than a strict
    // academic scheme, so a reader moving between the archive and the
    // chart sees the same words.
    var HIJRI_MONTHS = {
        en: ['Muharram', 'Safar', 'Rabiʻ I', 'Rabiʻ II',
             'Jumada I', 'Jumada II', 'Rajab', 'Shaʻban',
             'Ramadan', 'Shawwal', 'Dhu al-Qaʻda', 'Dhu al-Hijja'],
        fr: ['Mouharram', 'Safar', 'Rabia I', 'Rabia II',
             'Joumada I', 'Joumada II', 'Rajab', 'Chaabane',
             'Ramadan', 'Chawwal', 'Dhou al-qiʻda', 'Dhou al-hijja']
    };

    function labelsFor(table) {
        return table[ns.locale === 'fr' ? 'fr' : 'en'] || table.en;
    }

    /* ----------------------------------------------------------------- */
    /*  Hijri cells                                                       */
    /* ----------------------------------------------------------------- */
    //
    // The Hijri grid is not converted here. It arrives already aggregated
    // as `hijriCells` — [[hijriYear, hijriMonth, count], …] — computed by
    // the generator from the dataset's stored `hijri_*` columns, which are
    // written upstream from the Umm al-Qura tables.
    //
    // This renderer used to convert each day cell itself with
    // `Intl.DateTimeFormat('…-ca-islamic-umalqura')`. ICU's tables fall
    // back to a tabular approximation for older dates and disagree with
    // the stored ones on ~75% of this collection's pre-2000 days (and on
    // none from 2000 on), which at this grid's month granularity put 105
    // of 13,464 items (0.78%) in the wrong lunar month. Reading the
    // precomputed cells also means the facet no longer depends on the
    // browser shipping Islamic calendar data at all.
    //
    // `shared/hijri.js` still owns the client-side conversion, correctly:
    // it converts only *today* — post-2000, where ICU and Umm al-Qura
    // agree — to pick a day file for the On This Day block.

    /* ----------------------------------------------------------------- */
    /*  Shared theme plumbing                                             */
    /* ----------------------------------------------------------------- */

    function heatStops(tokens) {
        // resolveCssVar runs an offscreen probe: ECharts' colour parser
        // does not understand color-mix(), which is what the tokens are.
        var resolve = ns.resolveCssVar || function () { return ''; };
        var stops = [
            resolve('--iwac-vis-heatmap-0'),
            resolve('--iwac-vis-heatmap-1'),
            resolve('--iwac-vis-heatmap-2'),
            resolve('--iwac-vis-heatmap-3'),
            resolve('--iwac-vis-heatmap-4')
        ].filter(Boolean);
        if (stops.length < 2) stops = [tokens.surface, tokens.primary].filter(Boolean);
        return stops;
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

    /* ----------------------------------------------------------------- */
    /*  Month grid (Gregorian + Hijri)                                    */
    /* ----------------------------------------------------------------- */

    /**
     * Fold cells into a year × month matrix.
     *
     * Gregorian cells are `[iso, count]` and carry their year and month in
     * the date string; Hijri cells arrive pre-aggregated as
     * `[hijriYear, hijriMonth, count]` (see above — the client does no
     * calendar conversion).
     *
     * The year axis is filled to a contiguous min…max run rather than
     * listing only the years that carry articles: a category axis of
     * [1975, 2011] would render a 36-year silence as one column step
     * and read as continuous coverage.
     *
     * @returns {{years:number[], cells:Array, max:number, skipped:number}|null}
     */
    function aggregateMonths(cells, hijri) {
        var byYear = {};
        var minYear = Infinity;
        var maxYear = -Infinity;
        var skipped = 0;

        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i] || [];
            var year, month, count;

            if (hijri) {
                year = parseInt(cell[0], 10);
                month = parseInt(cell[1], 10);
                count = cell[2] || 0;
            } else {
                var iso = String(cell[0] || '');
                year = parseInt(iso.slice(0, 4), 10);
                month = parseInt(iso.slice(5, 7), 10);
                count = cell[1] || 0;
            }
            if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
                skipped += count;
                continue;
            }

            var row = byYear[year];
            if (!row) {
                row = byYear[year] = [];
                for (var m = 0; m < 12; m++) row[m] = 0;
            }
            row[month - 1] += count;
            if (year < minYear) minYear = year;
            if (year > maxYear) maxYear = year;
        }

        if (minYear === Infinity) return null;

        var years = [];
        for (var y = minYear; y <= maxYear; y++) years.push(y);

        var out = [];
        var max = 1;
        for (var yi = 0; yi < years.length; yi++) {
            var counts = byYear[years[yi]];
            if (!counts) continue;
            for (var mi = 0; mi < 12; mi++) {
                if (!counts[mi]) continue;
                out.push([yi, mi, counts[mi]]);
                if (counts[mi] > max) max = counts[mi];
            }
        }
        return { years: years, cells: out, max: max, skipped: skipped };
    }

    function buildMonthOption(cells, opts, hijri) {
        var agg = aggregateMonths(cells, hijri);
        if (!agg) return null;

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var months = labelsFor(hijri ? HIJRI_MONTHS : GREGORIAN_MONTHS);
        var unitKey = opts.unitKey || 'mentions_count';
        var era = hijri ? ' ' + P.t('cal_hijri_era') : '';

        return {
            _skipped: agg.skipped,
            _height: 360,
            tooltip: {
                position: 'top',
                formatter: function (p) {
                    var year = agg.years[p.data[0]];
                    var month = months[p.data[1]];
                    return '<strong>' + P.escapeHtml(month + ' ' + year + era) + '</strong><br>' +
                        P.t(unitKey, { count: P.formatNumber(p.data[2]) });
                }
            },
            // Hijri month names are two to three times longer than "Jan",
            // so the y-axis gutter widens to match instead of truncating.
            grid: { top: 16, bottom: 40, left: hijri ? 96 : 64, right: 72, containLabel: false },
            xAxis: {
                type: 'category',
                data: agg.years.map(String),
                name: hijri ? P.t('cal_hijri_era') : '',
                nameLocation: 'end',
                nameGap: 8,
                nameTextStyle: { color: tokens.muted, fontSize: 10 },
                axisLabel: { interval: 'auto', fontSize: 10, color: tokens.inkLight },
                splitArea: { show: true },
                axisTick: { show: false }
            },
            yAxis: {
                type: 'category',
                data: months,
                axisLabel: { fontSize: 10, color: tokens.inkLight },
                splitArea: { show: true },
                axisTick: { show: false }
            },
            visualMap: {
                min: 0,
                max: agg.max,
                calculable: true,
                orient: 'vertical',
                right: 4,
                top: 'middle',
                itemHeight: 120,
                itemWidth: 12,
                textStyle: { color: tokens.inkLight, fontSize: 10 },
                inRange: { color: heatStops(tokens) }
            },
            series: [{
                type: 'heatmap',
                data: agg.cells,
                label: { show: false },
                emphasis: {
                    itemStyle: {
                        borderColor: tokens.ink || '#2c2f37',
                        borderWidth: 2
                    }
                }
            }]
        };
    }

    /* ----------------------------------------------------------------- */
    /*  Day grid — one ECharts calendar per year                          */
    /* ----------------------------------------------------------------- */

    function buildDayOption(data, opts) {
        var cells = (data && data.cells) || [];
        var yearMin = data && data.yearMin;
        var yearMax = data && data.yearMax;
        if (yearMin == null || yearMax == null) {
            var derived = deriveYears(cells);
            if (!derived) return null;
            if (yearMin == null) yearMin = derived.min;
            if (yearMax == null) yearMax = derived.max;
        }

        var cellSize = opts.cellSize || 14;
        var cellGap  = opts.cellGap  || 80;
        var unitKey  = opts.unitKey  || 'mentions_count';

        var years = [];
        for (var y = yearMin; y <= yearMax; y++) years.push(y);

        var max = 1;
        for (var i = 0; i < cells.length; i++) {
            if (cells[i][1] > max) max = cells[i][1];
        }

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var stops  = heatStops(tokens);

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

        return {
            _height: 40 + years.length * (cellSize * 7 + cellGap),
            _skipped: 0,
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    if (!p.data || !p.data[0]) return '';
                    return '<strong>' + P.escapeHtml(String(p.data[0])) + '</strong><br>' +
                        P.t(unitKey, { count: P.formatNumber(p.data[1] || 0) });
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

    /* ----------------------------------------------------------------- */
    /*  Renderer                                                          */
    /* ----------------------------------------------------------------- */

    var VIEW_LABEL_KEYS = {
        month: 'cal_view_month',
        day:   'cal_view_day',
        hijri: 'cal_view_hijri'
    };

    function hijriCellsOf(data) {
        return (data && data.hijriCells) || [];
    }

    function buildOption(view, data, opts) {
        if (view === 'day')   return buildDayOption(data, opts);
        if (view === 'hijri') return buildMonthOption(hijriCellsOf(data), opts, true);
        return buildMonthOption((data && data.cells) || [], opts, false);
    }

    DL.registerRenderer('calendarHeatmap', function (el, data, slot) {
        var opts = (slot && slot.options) || {};
        var cells = (data && data.cells) || [];
        if (!cells.length) {
            el.appendChild(P.buildEmptyState());
            return;
        }

        // Offer only what this caller can actually serve. The Hijri facet
        // is now a question about the data, not about the browser: it
        // appears when the producer shipped precomputed Hijri cells.
        var offered = opts.views || ['month', 'day', 'hijri'];
        var views = offered.filter(function (v) {
            if (v === 'hijri') return hijriCellsOf(data).length > 0;
            return v === 'month' || v === 'day';
        });
        if (!views.length) views = ['month'];

        var active = opts.granularity && views.indexOf(opts.granularity) !== -1
            ? opts.granularity
            : views[0];

        var panel = el.parentNode;
        var note = P.el('p', 'iwac-vis-panel-desc iwac-vis-calendar__note');

        function apply(option) {
            if (!option) return;
            // The day view needs ~130 px per year; the month grids are a
            // fixed 12 rows. Drive the host height from the active view
            // so switching back to months actually reclaims the space —
            // the per-chart ResizeObserver picks the change up.
            el.style.minHeight = option._height + 'px';
            note.textContent = noteText(option._skipped);
            delete option._height;
            delete option._skipped;
        }

        function noteText(skipped) {
            var base;
            if (active === 'hijri')    base = P.t('cal_hijri_note');
            else if (active === 'day') base = P.t('cal_day_note');
            else                       base = P.t('cal_month_note');
            // Anything the view could not place is stated rather than
            // quietly missing: a grid that drops cells in silence reads
            // as complete coverage when it isn't.
            if (skipped) {
                base += ' ' + P.t('cal_skipped_note', { count: P.formatNumber(skipped) });
            }
            return base;
        }

        if (views.length > 1 && P.buildFacetButtons && panel) {
            var facets = P.buildFacetButtons({
                facets: views.map(function (v) {
                    return { key: v, label: P.t(VIEW_LABEL_KEYS[v]) };
                }),
                activeKey: active,
                onChange: function (state) {
                    active = state.facet;
                    var live = ns.getLiveChart && ns.getLiveChart(el);
                    if (!live) return;
                    var option = buildOption(active, data, opts);
                    if (!option) return;
                    apply(option);
                    // `true` — the day view's `calendar` components have
                    // no counterpart in the month grids, so a merged
                    // update would leave orphaned axes behind.
                    live.setOption(option, true);
                }
            });
            panel.insertBefore(facets.root, el);
        }
        if (panel) panel.insertBefore(note, el);

        // Registering with a builder keyed off `active` means the theme
        // observer's rebuild redraws whichever view is on screen.
        ns.registerChart(el, function (_e, instance) {
            var option = buildOption(active, data, opts);
            if (!option) return;
            apply(option);
            instance.setOption(option, true);
        });
    });

    DL.registerMetadata('calendarHeatmap', {
        labelKey: 'Calendar heatmap',
        descKey:  'desc_calendar_heatmap',
        hasData:  function (v) { return v && Array.isArray(v.cells) && v.cells.length > 0; }
    });
})();
