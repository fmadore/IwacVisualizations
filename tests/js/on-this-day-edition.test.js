'use strict';

// On This Day — the Edition layout's pure parts (asset/js/charts/on-this-day/
// edition.js) and the day helpers it added to shared.js.
//
//   * layoutTicks: the year controls must stay >= gap apart (24 px targets)
//     while sitting as close to their true place as they can, and inside the
//     track; an isolated year must not move at all.
//   * rankLead: the documented order — the item with the most to show (a
//     scan always leads), a round anniversary among equals, then the oldest.
//   * shiftDay / validDayKey: the walk covers all 366 day files, 29 February
//     included, and wraps the year.
//   * gregKeyForHijri: a Hijri MM-DD lands on the Gregorian day file it
//     falls on this cycle — the upcoming occurrence of a date that falls
//     twice, a missing 30th clamped to the 29th.
//   * pickRandomDay, readRow (old 5- and 8-field rows, the v2 12-field
//     row) and the folio's scale sentence with and without geography.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..', 'asset', 'js', 'charts');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function load(now) {
    const RealDate = Date;
    // A fixed "now" without touching the global Date.
    class FixedDate extends RealDate {
        constructor(...args) { if (args.length) super(...args); else super(now); }
        static now() { return new RealDate(now).getTime(); }
    }
    const context = { console, Intl, Date: now ? FixedDate : Date, Math, String, Number, Infinity, window: {} };
    context.window.IWACVis = { locale: 'en' };
    // t() echoes its key and parameters, so a test can read which sentence
    // was chosen and with what counts without the dictionaries.
    context.window.IWACVis.panels = {
        t: (k, p) => (p ? k + ' ' + JSON.stringify(p) : k),
        el: () => ({})
    };
    vm.createContext(context);
    vm.runInContext(read('shared/hijri.js'), context, { filename: 'hijri.js' });
    vm.runInContext(read('on-this-day/shared.js'), context, { filename: 'shared.js' });
    vm.runInContext(read('on-this-day/edition.js'), context, { filename: 'edition.js' });
    return context.window.IWACVis.onThisDay;
}

const otd = load(new Date('2026-11-15T10:00:00'));
const E = otd.edition;
const S = otd.shared;

test('layoutTicks keeps neighbours a gap apart, in order and inside the track', () => {
    const years = [1975, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020];
    const laid = E.layoutTicks(years, 1960, 2026, 600, 28, 20);
    assert.equal(laid.width, 600);
    for (let i = 1; i < laid.x.length; i++) assert.ok(laid.x[i] - laid.x[i - 1] >= 28 - 1e-9);
    assert.ok(laid.x[0] >= 20 && laid.x[laid.x.length - 1] <= 580 + 1e-9);
    // The isolated 1975 stays at its true place.
    assert.ok(Math.abs(laid.x[0] - (20 + (15 / 66) * 560)) < 1e-9);
});

test('layoutTicks grows the track (and scrolls) when the years cannot fit', () => {
    const years = Array.from({ length: 30 }, (_, i) => 1990 + i);
    const laid = E.layoutTicks(years, 1960, 2026, 358, 28, 20);
    assert.ok(laid.width > 358);
    for (let i = 1; i < laid.x.length; i++) assert.ok(laid.x[i] - laid.x[i - 1] >= 28 - 1e-9);
});

test('rankLead: a scan always leads; an anniversary only breaks a tie; then oldest', () => {
    const it = (year, thumb, excerpt) => ({ year, thumb: thumb ? 'x' : '', excerpt: excerpt ? 'y' : '', hYear: null });
    const mode = { calendar: 'g' };
    // 1986 is 40 years before the fixed now; 1996 is 30. Neither has a scan,
    // so the scanned 1970 item leads over both anniversaries.
    assert.equal(E.rankLead([it(1970, 1, 1), it(1996, 0, 1), it(1986, 0, 1)], mode), 0);
    // Among equally furnished items the rarer anniversary wins, not the oldest.
    assert.equal(E.rankLead([it(1970, 1, 1), it(1996, 1, 1), it(1986, 1, 1)], mode), 2);
    // A scan without an excerpt still beats an anniversary with only an excerpt.
    assert.equal(E.rankLead([it(1986, 0, 1), it(1990, 1, 0)], mode), 1);
    // No anniversary: scan + excerpt beats scan alone beats excerpt alone.
    assert.equal(E.rankLead([it(1971, 0, 1), it(1990, 1, 0), it(2001, 1, 1)], mode), 2);
    // Ties go to the oldest.
    assert.equal(E.rankLead([it(1999, 1, 1), it(1972, 1, 1)], mode), 1);
});

test('shiftDay walks all 366 days and wraps the year', () => {
    assert.equal(S.shiftDay('02-28', 1), '02-29');
    assert.equal(S.shiftDay('02-29', 1), '03-01');
    assert.equal(S.shiftDay('03-01', -1), '02-29');
    assert.equal(S.shiftDay('12-31', 1), '01-01');
    assert.equal(S.shiftDay('01-01', -1), '12-31');
    let key = '01-01', n = 0;
    do { key = S.shiftDay(key, 1); n++; } while (key !== '01-01');
    assert.equal(n, 366);
});

test('validDayKey accepts the 366 day files and nothing else', () => {
    for (const ok of ['01-01', '02-29', '12-31', '04-30']) assert.equal(S.validDayKey(ok), true, ok);
    for (const bad of ['02-30', '04-31', '13-01', '00-10', '1-1', '', null, '../x']) {
        assert.equal(S.validDayKey(bad), false, String(bad));
    }
});

test('the axis opens on the decade of the day’s first year', () => {
    assert.equal(E.axisFrom(1994), 1990);
    assert.equal(E.axisFrom(1990), 1990);
    assert.equal(E.axisFrom(1961), 1960);
    assert.equal(E.axisFrom(2009), 2000);
});

test('gregKeyForHijri lands every Hijri date on a day that converts back to it', () => {
    // The fixed now is 15 November 2026: 1 January 2026 is 12 Rajab 1447,
    // 31 December 22 Rajab 1448, so the year holds every Hijri date.
    for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 29; d++) {
            const h = S.pad2(m) + '-' + S.pad2(d);
            const g = S.gregKeyForHijri(h);
            assert.ok(S.validDayKey(g), h + ' -> ' + g);
            assert.equal(S.hijriKey(g), h, h + ' -> ' + g);
        }
    }
    // The shortcuts the Edition offers, in 2026.
    assert.equal(S.gregKeyForHijri('09-01', '01-01'), '02-18'); // 1 Ramadan 1447
    assert.equal(S.gregKeyForHijri('10-01', '01-01'), '03-20'); // Korité
    assert.equal(S.gregKeyForHijri('12-10', '01-01'), '05-27'); // Tabaski
});

test('gregKeyForHijri picks the upcoming occurrence of a date that falls twice, else the most recent', () => {
    // 15 Rajab falls in early January and again in late December 2026.
    const early = S.gregKeyForHijri('07-15', '01-01');
    const late = S.gregKeyForHijri('07-15', '06-01');
    assert.ok(early < '01-10', early);
    assert.ok(late > '12-15', late);
    assert.equal(S.hijriKey(early), '07-15');
    assert.equal(S.hijriKey(late), '07-15');
    // From the fixed today (15 November) the December one is upcoming.
    assert.equal(S.gregKeyForHijri('07-15'), late);
    // 1 Muharram has passed by the anchor and does not recur this year:
    // the most recent occurrence.
    const muharram = S.gregKeyForHijri('01-01', '12-30');
    assert.equal(S.hijriKey(muharram), '01-01');
    assert.ok(muharram < '12-30');
});

test('gregKeyForHijri clamps a 30th the month lacks this cycle to the 29th', () => {
    let clamped = 0;
    for (let m = 1; m <= 12; m++) {
        const h = S.pad2(m) + '-30';
        const g = S.gregKeyForHijri(h);
        assert.ok(S.validDayKey(g), h);
        const back = S.hijriKey(g);
        assert.ok(back === h || back === S.pad2(m) + '-29', h + ' -> ' + back);
        if (back !== h) clamped++;
    }
    // Umm al-Qura alternates 29- and 30-day months: some must clamp.
    assert.ok(clamped > 0);
    assert.equal(S.gregKeyForHijri('13-01'), null);
    assert.equal(S.gregKeyForHijri('nonsense'), null);
});

test('pickRandomDay draws from the rich days, never today, and falls back to any day', () => {
    assert.equal(S.pickRandomDay(['03-01', '11-15'], '11-15', () => 0.99), '03-01');
    assert.equal(S.pickRandomDay(['03-01', '07-04'], '11-15', () => 0), '03-01');
    assert.equal(S.pickRandomDay(['03-01', '07-04'], '11-15', () => 0.999), '07-04');
    // An old metadata.json (no `rich`), a missing one, or junk: any valid day but this one.
    for (const rich of [undefined, [], ['11-15'], ['bad', '02-30']]) {
        for (const r of [0, 0.5, 0.999]) {
            const k = S.pickRandomDay(rich, '11-15', () => r);
            assert.ok(S.validDayKey(k) && k !== '11-15', String(k));
        }
    }
});

test('readRow reads old 5- and 8-field rows and the v2 12-field row', () => {
    const old5 = S.readRow([1990, 7, 'T', 'Src', 'p']);
    assert.equal(old5.type, 'p');
    assert.equal(old5.country, '');
    assert.equal(old5.summaryEn, '');
    assert.equal(old5.subjects.length, 0);
    const old8 = S.readRow([1990, 7, 'T', 'Src', 'x', 'thumb', 'ex', 1410]);
    assert.equal(old8.type, 'a');
    assert.equal(old8.hYear, 1410);
    const v2 = S.readRow([2011, 9, 'T', 'Src', 'v', '', 'ex', 0, 'Bénin', 'fr', 'en',
        [['Tabaski', 123], ['Laïcité', 456], ['bad'], 'junk', ['', 1]]]);
    assert.equal(v2.type, 'v');
    assert.equal(v2.hYear, null);
    assert.equal(v2.country, 'Bénin');
    assert.equal(v2.summaryFr, 'fr');
    assert.equal(v2.summaryEn, 'en');
    assert.deepEqual(JSON.parse(JSON.stringify(v2.subjects)),
        [{ label: 'Tabaski', oId: 123 }, { label: 'Laïcité', oId: 456 }, { label: 'bad', oId: null }]);
    for (const t of ['a', 'p', 'v', 'd', 'i']) assert.equal(S.readRow([2000, 1, '', '', t]).type, t);
    assert.equal(S.countryLabel('Bénin'), 'Benin');
    assert.equal(S.countryLabel('Côte d’Ivoire'), 'Côte d’Ivoire');
});

test('scaleSentence: geography when the rows carry it, the old sentence when they do not', () => {
    const it = (year, source, country) => ({ year, source, country });
    const geo = E.scaleSentence([it(1994, 'A', 'Bénin'), it(2016, 'B', 'Togo'), it(2001, 'A', 'Togo'), it(2003, 'C', '')]);
    assert.ok(geo.startsWith('otd.ed_scale_geo {'), geo);
    const params = JSON.parse(geo.slice(geo.indexOf('{')));
    assert.equal(params.countries, 'otd.n_countries {"count":2}');
    assert.equal(params.titles, 'otd.n_titles {"count":3}');
    assert.equal(params.items, 'items_count {"count":4}');
    assert.equal(params.from, '1994');
    assert.equal(params.to, '2016');
    assert.ok(E.scaleSentence([it(2011, 'A', 'Niger'), it(2011, 'B', 'Niger')]).startsWith('otd.ed_scale_geo_same '));
    assert.ok(E.scaleSentence([it(2011, '', 'Niger'), it(2012, '', 'Niger')]).startsWith('otd.ed_scale_geo_nt '));
    // Old rows: no country anywhere.
    assert.ok(E.scaleSentence([it(1994, 'A', ''), it(2016, 'B', '')]).startsWith('otd.ed_scale '));
    assert.ok(E.scaleSentence([it(1994, 'A', 'Togo')]).startsWith('otd.ed_scale_single '));
});

/* ------------------------------------------------------------------- */
/*  On This Day v2, phase 2                                             */
/* ------------------------------------------------------------------- */

test('ledeText: French prefers the excerpt; English the English summary, then the excerpt, then the French summary', () => {
    const full = { excerpt: 'ex', summaryFr: 'fr', summaryEn: 'en' };
    assert.deepEqual({ ...E.ledeText(full, 'fr') }, { text: 'ex', ai: false, lang: '' });
    assert.deepEqual({ ...E.ledeText(full, 'en') }, { text: 'en', ai: true, lang: 'en' });
    assert.deepEqual({ ...E.ledeText({ excerpt: 'ex', summaryFr: 'fr' }, 'en') }, { text: 'ex', ai: false, lang: '' });
    assert.deepEqual({ ...E.ledeText({ summaryFr: 'fr' }, 'en') }, { text: 'fr', ai: true, lang: 'fr' });
    assert.deepEqual({ ...E.ledeText({ summaryFr: 'fr', summaryEn: 'en' }, 'fr') }, { text: 'fr', ai: true, lang: 'fr' });
    assert.equal(E.ledeText({}, 'en').text, '');
    assert.equal(E.ledeText({}, 'fr').ai, false);
    // Briefs keep the excerpt first in both languages.
    assert.equal(E.briefText(full, 'en').text, 'ex');
    assert.deepEqual({ ...E.briefText({ summaryFr: 'fr', summaryEn: 'en' }, 'en') }, { text: 'en', ai: true, lang: 'en' });
    assert.deepEqual({ ...E.briefText({ summaryFr: 'fr', summaryEn: 'en' }, 'fr') }, { text: 'fr', ai: true, lang: 'fr' });
    assert.deepEqual({ ...E.briefText({ summaryFr: 'fr' }, 'en') }, { text: 'fr', ai: true, lang: 'fr' });
});

test('rankYear orders one year’s items as the pager walks them: furnished first, then file order', () => {
    const it = (year, oId, thumb, excerpt) => ({ year, oId, thumb: thumb ? 'x' : '', excerpt: excerpt ? 'y' : '', hYear: null });
    const items = [it(2011, 1, 0, 0), it(2010, 2, 1, 1), it(2011, 3, 1, 0), it(2011, 4, 1, 1), it(2011, 5, 0, 1)];
    const mode = { calendar: 'g' };
    assert.deepEqual([...E.rankYear(items, 2011, mode)], [3, 2, 4, 0]);
    assert.equal(E.bestOf(items, 2011, mode), 3);
    assert.equal(E.bestOf(items, 1999, mode), -1);
});

test('resolveLead: otd.item wins, otd.year resolves to its best item, anything else is the default', () => {
    const it = (year, oId, thumb) => ({ year, oId, thumb: thumb ? 'x' : '', excerpt: 'y', hYear: null });
    const items = [it(1990, 10, 0), it(2011, 11, 0), it(2011, 12, 1), it(2015, 13, 1)];
    const mode = { calendar: 'g' };
    const def = E.rankLead(items, mode);
    const r = (extra) => JSON.parse(JSON.stringify(E.resolveLead(items, { ...mode, ...extra })));
    assert.deepEqual(r({}), { index: def, stale: false });
    assert.deepEqual(r({ leadItem: 11 }), { index: 1, stale: false });
    assert.deepEqual(r({ leadYear: 2011 }), { index: 2, stale: false });
    // An item the (filtered) set does not hold: the default, flagged stale.
    assert.deepEqual(r({ leadItem: 99 }), { index: def, stale: true });
    assert.deepEqual(r({ leadYear: 1970 }), { index: def, stale: true });
    // The item wins over a year.
    assert.deepEqual(r({ leadItem: 13, leadYear: 2011 }), { index: 3, stale: false });
});

test('countriesOf counts the day’s countries; a filter keeps only one; old rows have none', () => {
    const rows = [
        [2000, 1, 'T', 'S', 'a', '', '', 0, 'Togo'],
        [2001, 2, 'T', 'S', 'a', '', '', 0, 'Bénin'],
        [2002, 3, 'T', 'S', 'a', '', '', 0, 'Togo'],
        [2003, 4, 'T', 'S', 'a', '', '', 0, 'Côte d\'Ivoire'],
        [2004, 5, 'T', 'S', 'a', '', '', 0, ''],
    ];
    assert.deepEqual(JSON.parse(JSON.stringify(S.countriesOf(rows))), [
        { name: 'Bénin', count: 1 }, { name: 'Côte d\'Ivoire', count: 1 }, { name: 'Togo', count: 2 }]);
    const togo = rows.filter((r) => S.readRow(r).country === 'Togo');
    assert.equal(togo.length, 2);
    assert.ok(E.scaleSentence(togo.map(S.readRow), 'Togo').startsWith('otd.ed_scale_c '));
    assert.deepEqual(S.countriesOf([[1990, 7, 'T', 'Src', 'a', '', '', 0]]).length, 0);
    assert.equal(S.countryFrom('Togo'), 'Togo');
});

test('countryFrom puts the French preposition in front of the country', () => {
    // A second context, French.
    const RealDate = Date;
    const context = { console, Intl, Date: RealDate, Math, String, Number, Infinity, window: { IWACVis: { locale: 'fr', panels: { t: (k) => k, el: () => ({}) } } } };
    vm.createContext(context);
    vm.runInContext(read('shared/hijri.js'), context);
    vm.runInContext(read('on-this-day/shared.js'), context);
    const SF = context.window.IWACVis.onThisDay.shared;
    assert.equal(SF.countryFrom('Togo'), 'du Togo');
    assert.equal(SF.countryFrom('Bénin'), 'du Bénin');
    assert.equal(SF.countryFrom('Côte d\'Ivoire'), 'de Côte d’Ivoire');
    assert.equal(SF.countryFrom('Guinée'), 'de Guinée');
});
