/**
 * IWAC Visualizations — Hijri (Umm al-Qura) dates
 *
 * Intl carries the Umm al-Qura tables, so no date library is needed on the
 * client. What Intl does NOT give us safely is either of the two things
 * this module exists for:
 *
 *   1. A guarantee that the calendar is actually there. An engine without
 *      it silently falls back to Gregorian, which would render 2000 where
 *      1420 belongs — a wrong date that looks perfectly plausible. So the
 *      formatter is probed before it is trusted, and callers that get
 *      `null` drop the Hijri affordance rather than serve Gregorian numbers
 *      under Hijri month names.
 *
 *   2. The month names the archive uses. ICU's French names differ from the
 *      academic scheme IWAC follows, so a reader moving between the archive
 *      and a chart would meet two spellings of the same month. The table
 *      below is the module's, and the order is day-month-year in both
 *      locales — the scholarly convention for Hijri dates, and the reason
 *      this formats by hand instead of asking Intl for a long date.
 *
 * Exposed as `IWACVis.hijri`.
 *
 * NOTE: `shared/renderers/calendar-heatmap.js` still carries its own copy of
 * this logic (it predates this module). The two agree today; folding that
 * renderer onto this module would remove the chance of them drifting.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};

    var MONTHS = {
        en: ['Muharram', 'Safar', 'Rabiʻ I', 'Rabiʻ II',
             'Jumada I', 'Jumada II', 'Rajab', 'Shaʻban',
             'Ramadan', 'Shawwal', 'Dhu al-Qaʻda', 'Dhu al-Hijja'],
        fr: ['Mouharram', 'Safar', 'Rabia I', 'Rabia II',
             'Joumada I', 'Joumada II', 'Rajab', 'Chaabane',
             'Ramadan', 'Chawwal', 'Dhou al-qiʻda', 'Dhou al-hijja']
    };

    // `undefined` = not yet probed, `false` = this engine cannot do it.
    var formatter;

    function getFormatter() {
        if (formatter !== undefined) return formatter;
        formatter = false;
        try {
            // -nu-latn: some locales would otherwise return Arabic-Indic
            // digits, which parseInt does not read.
            var fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
                year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC'
            });
            // Probe rather than trust: a real conversion puts every modern
            // date in the 1300–1500 AH band.
            var probe = read(fmt, new Date(Date.UTC(2000, 0, 1)));
            if (probe && probe.year > 1300 && probe.year < 1500) formatter = fmt;
        } catch (e) { /* no Intl, or no Islamic calendar data */ }
        return formatter;
    }

    function read(fmt, date) {
        var parts = fmt.formatToParts(date);
        var got = { year: null, month: null, day: null };
        for (var i = 0; i < parts.length; i++) {
            if (Object.prototype.hasOwnProperty.call(got, parts[i].type)) {
                got[parts[i].type] = parseInt(parts[i].value, 10);
            }
        }
        if (got.year == null || got.month == null || got.day == null
            || isNaN(got.year) || isNaN(got.month) || isNaN(got.day)) {
            return null;
        }
        return got;
    }

    /** True when this engine can be trusted with Umm al-Qura dates. */
    function available() {
        return getFormatter() !== false;
    }

    /**
     * `{year, month, day}` for a Date, or null when unavailable.
     *
     * Note for callers holding archival dates: this is ICU's Umm al-Qura,
     * which matches the `hijridate` tables the generators use from 2000 on
     * but diverges for older dates. Convert *today* with this; take historic
     * Hijri dates from the precomputed data instead of re-deriving them.
     */
    function parts(date) {
        var fmt = getFormatter();
        if (!fmt) return null;
        try {
            // Normalised to UTC noon so the formatter's UTC timeZone cannot
            // shift a local date onto the neighbouring day.
            return read(fmt, new Date(Date.UTC(
                date.getFullYear(), date.getMonth(), date.getDate(), 12
            )));
        } catch (e) {
            return null;
        }
    }

    /** Localized Hijri month name, 1-based. */
    function monthName(month) {
        var table = MONTHS[ns.locale === 'fr' ? 'fr' : 'en'] || MONTHS.en;
        return table[month - 1] || '';
    }

    /** "15 Safar 1448" — day-month-year in both locales; year optional. */
    function format(day, month, year) {
        var out = day + ' ' + monthName(month);
        return year ? out + ' ' + year : out;
    }

    ns.hijri = {
        MONTHS:    MONTHS,
        available: available,
        parts:     parts,
        monthName: monthName,
        format:    format
    };
})();
