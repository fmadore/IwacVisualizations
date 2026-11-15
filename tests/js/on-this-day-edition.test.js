'use strict';

// On This Day — the Edition layout's pure parts (asset/js/charts/on-this-day/
// edition.js) and the day helpers it added to shared.js.
//
//   * layoutTicks: the year controls must stay >= gap apart (24 px targets)
//     while sitting as close to their true place as they can, and inside the
//     track; an isolated year must not move at all.
//   * rankLead: the documented order — round anniversary with something to
//     show, then scan + excerpt, then the oldest.
//   * shiftDay / validDayKey: the walk covers all 366 day files, 29 February
//     included, and wraps the year.

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
    context.window.IWACVis.panels = { t: (k) => k, el: () => ({}) };
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

test('rankLead: round anniversary with content, then scan + excerpt, then oldest', () => {
    const it = (year, thumb, excerpt) => ({ year, thumb: thumb ? 'x' : '', excerpt: excerpt ? 'y' : '', hYear: null });
    const mode = { calendar: 'g' };
    // 1986 is 40 years before the fixed now; 1996 is 30.
    assert.equal(E.rankLead([it(1970, 1, 1), it(1996, 0, 1), it(1986, 0, 1)], mode), 2);
    // A bare-title anniversary does not lead.
    assert.equal(E.rankLead([it(1986, 0, 0), it(1990, 1, 1)], mode), 1);
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
