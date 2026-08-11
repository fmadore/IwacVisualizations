/**
 * IWAC Visualizations — Person + Entity Dashboards: year × month heatmap
 *
 * Discrete grid of mention counts. Reuses C.heatmap. Renders nothing
 * when the dataset has no items with parseable YYYY-MM dates (every
 * non-articles subset is silently dropped at the precompute level).
 *
 * Two calendars, when the bundle carries both. The Gregorian grid sits
 * at the top level of each role slice; the lunar one arrives as a
 * nested `hijri` key holding the same {years, months, cells} shape,
 * bucketed by the generator from the dataset's stored `hijri_*`
 * columns. Nothing is converted here — see `shared/hijri.js` for why
 * only *today* may be converted in the browser.
 *
 * The switcher appears on data, not on module version: a bundle
 * generated before the Hijri matrix existed simply has no `hijri` key
 * and the panel stays single-view.
 *
 * **The two grids count different corpora, and the note says so.** A
 * lunar month straddles two Gregorian ones, so upstream converts only
 * complete YYYY-MM-DD dates, and `references` are excluded from the
 * conversion entirely — while the Gregorian grid counts anything with a
 * resolvable YYYY-MM. Each grid carries its own `items` total so the
 * gap is stated rather than left for a reader to trip over.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.heatmap) {
        console.warn('IWACVis.person-dashboard/heatmap: missing deps (need C.heatmap)');
        return;
    }

    var EMPTY = { years: [], months: [], cells: [] };

    function hijriOf(slice) {
        var h = slice && slice.hijri;
        return (h && h.cells && h.cells.length) ? h : null;
    }

    function hijriLabelled() {
        var table = ns.hijri && ns.hijri.MONTHS;
        if (!table) return false;
        return (table[ns.locale === 'fr' ? 'fr' : 'en'] || table.en || []).length === 12;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.heatmap && data.heatmap.by_role) || {};
        var state = { calendar: 'gregorian' };

        function slice() {
            return byRole[facet.role] || EMPTY;
        }

        // Any role slice offering a lunar grid is enough to show the
        // switcher: hiding it on a role change would make the control
        // flicker in and out as the reader moves between facets.
        var anyHijri = Object.keys(byRole).some(function (r) { return hijriOf(byRole[r]); });
        var offerHijri = anyHijri && hijriLabelled();

        var note = P.el('p', 'iwac-vis-panel-desc iwac-vis-calendar__note');
        var ctrl = null;

        if (offerHijri) {
            var facetBar = P.buildFacetButtons({
                facets: [
                    { key: 'gregorian', label: P.t('cal_view_month') },
                    { key: 'hijri',     label: P.t('cal_view_hijri') }
                ],
                activeKey: 'gregorian',
                onChange: function (evt) {
                    state.calendar = evt.facet;
                    if (ctrl) ctrl.rerender();
                    updateNote();
                }
            });
            panelEl.panel.insertBefore(facetBar.root, panelEl.chart);
        }

        function current() {
            if (state.calendar !== 'hijri') return slice();
            return hijriOf(slice()) || EMPTY;
        }

        // Only ever called while the switcher is on screen — without it
        // there is nothing to disambiguate and the panel description
        // above already says what the grid is.
        function updateNote() {
            if (state.calendar !== 'hijri') {
                note.textContent = P.t('cal_month_note');
                return;
            }
            var text = P.t('cal_hijri_note');
            var greg = slice();
            var lunar = hijriOf(greg);
            var shown = (lunar && lunar.items) || 0;
            var total = greg.items || 0;
            // Only worth stating when the two actually differ — on a
            // target whose every item is day-dated they don't, and a
            // "30 of 30" line is noise.
            if (total && shown < total) {
                text += ' ' + P.t('cal_hijri_coverage', {
                    shown: P.formatNumber(shown),
                    total: P.formatNumber(total)
                });
            }
            note.textContent = text;
        }

        ctrl = P.buildFacetedChart(panelEl, {
            facet: facet,
            getData: current,
            hasData: function (d) { return d && d.cells && d.cells.length > 0; },
            buildOption: function (d) {
                return C.heatmap(d, {
                    calendar: state.calendar === 'hijri' ? 'hijri' : 'gregorian'
                });
            }
        });

        if (offerHijri) {
            // Above the grid, not below it: `.iwac-vis-panel-desc` carries
            // a bottom margin only, and the caveat is something to read
            // before the cells rather than after them.
            panelEl.panel.insertBefore(note, panelEl.chart);
            updateNote();
            // The role facet changes the denominators too, so the note
            // has to follow it as well as the calendar switch.
            if (facet && typeof facet.subscribe === 'function') {
                facet.subscribe(updateNote);
            }
        }
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.heatmap = { render: render };
})();
