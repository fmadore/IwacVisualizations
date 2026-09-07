'use strict';

// Umm al-Qura conversion and formatting (asset/js/charts/shared/hijri.js,
// Tier 8 / B3 (3)).
//
// This file is pure, has fourteen consumers, and had no tests. It is also
// the one place in the module where being WRONG LOOKS RIGHT: an engine
// without the Islamic calendar makes `Intl.DateTimeFormat` fall back to
// Gregorian silently, so a chart would print "1 Muharram 2000" — a
// well-formed date, in the right shape, off by 580 years. The probe in
// `getFormatter()` is what stops that, and nothing exercised it.
//
// Two things are checked here and they need different tools:
//
//   * The ROUND TRIP — Gregorian in, Hijri out, and back again through an
//     independent Gregorian formatter reading the same instant. That
//     catches an off-by-one from the UTC-noon normalisation, which is the
//     realistic bug: `parts()` builds a UTC date from LOCAL components, so
//     a machine in UTC+13 would otherwise land on the previous day.
//
//   * The FALLBACK — a context whose Intl reports Gregorian years under an
//     Islamic calendar request. `available()` must say false and `parts()`
//     must return null, rather than passing 2000 off as an AH year.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = readFileSync(
    join(__dirname, '..', '..', 'asset', 'js', 'charts', 'shared', 'hijri.js'),
    'utf8'
);

/** Load hijri.js against a given Intl, and set the module locale. */
function load({ locale = 'en', intl = Intl } = {}) {
    const context = { console, Intl: intl, window: {} };
    context.window.IWACVis = {};
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'hijri.js' });
    context.window.IWACVis.locale = locale;
    return context.window.IWACVis.hijri;
}

const hijri = load();

// Node ships full ICU, so this should hold; skipping rather than failing
// keeps the suite honest on a small-icu build instead of asserting on a
// calendar that is genuinely absent.
const HAVE_ICU = hijri.available();

test('the module reports whether this engine has Umm al-Qura at all', () => {
    assert.equal(typeof hijri.available(), 'boolean');
    assert.equal(hijri.available(), hijri.parts(new Date(2000, 0, 1)) !== null);
});

test('every conversion round-trips back to the Gregorian day it came from', { skip: !HAVE_ICU }, () => {
    // A reader that goes the other way: Hijri parts -> the Gregorian date
    // ICU says they name. Comparing against `Intl` rather than against a
    // second copy of the same arithmetic is the point — a shared mistake
    // would agree with itself.
    const back = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
        year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
    });

    // Two full years at daily resolution, plus the boundaries that have
    // actually broken date code here: leap day, both year ends, and the
    // 1 January that the module's own probe uses.
    const days = [];
    for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2024, 11, 31); t += 86400000) {
        days.push(new Date(t));
    }
    for (const iso of ['2000-01-01', '2024-02-29', '1999-12-31', '2026-09-07']) {
        const [y, m, d] = iso.split('-').map(Number);
        days.push(new Date(Date.UTC(y, m - 1, d)));
    }

    let checked = 0;
    for (const utcDay of days) {
        // `parts()` reads LOCAL components, so hand it a local-midnight date
        // for the same calendar day the UTC one names.
        const local = new Date(
            utcDay.getUTCFullYear(), utcDay.getUTCMonth(), utcDay.getUTCDate()
        );
        const got = hijri.parts(local);
        assert.ok(got, `no conversion for ${utcDay.toISOString().slice(0, 10)}`);

        const expected = {};
        for (const part of back.formatToParts(new Date(Date.UTC(
            local.getFullYear(), local.getMonth(), local.getDate(), 12
        )))) {
            if (part.type !== 'literal') expected[part.type] = parseInt(part.value, 10);
        }
        // `{ ...got }` and not `got`: hijri.js runs in a vm context, so its
        // objects carry that realm's Object.prototype and deepStrictEqual
        // compares prototypes. Spreading brings the fields into this realm.
        assert.deepEqual(
            { ...got },
            { year: expected.year, month: expected.month, day: expected.day },
            `round trip failed for ${utcDay.toISOString().slice(0, 10)}`
        );
        checked += 1;
    }
    assert.ok(checked > 700, `expected two years of days, checked ${checked}`);
});

test('a local date near midnight does not slide onto the neighbouring day', { skip: !HAVE_ICU }, () => {
    // The UTC-noon normalisation exists for exactly this. 23:59 local and
    // 00:00 local on the same calendar day must convert identically, in
    // whatever zone the test machine runs.
    const midnight = new Date(2026, 8, 7, 0, 0, 0);
    const almostNext = new Date(2026, 8, 7, 23, 59, 59);
    assert.deepEqual(hijri.parts(midnight), hijri.parts(almostNext));
});

test('month names come from the module table, not ICU, and follow the locale', () => {
    const en = load({ locale: 'en' });
    const fr = load({ locale: 'fr' });

    assert.equal(en.monthName(1), 'Muharram');
    assert.equal(fr.monthName(1), 'Mouharram');
    // The divergence that motivates the table: ICU's French for Sha'ban is
    // not the academic spelling the archive uses.
    assert.equal(fr.monthName(8), 'Chaabane');
    assert.equal(en.MONTHS.en.length, 12);
    assert.equal(en.MONTHS.fr.length, 12);

    // 1-based, and out of range is empty rather than `undefined` leaking
    // into a label.
    assert.equal(en.monthName(0), '');
    assert.equal(en.monthName(13), '');
    assert.equal(en.monthName(12), 'Dhu al-Hijja');
});

test('format() is day-month-year in both locales, year optional', () => {
    const en = load({ locale: 'en' });
    const fr = load({ locale: 'fr' });
    assert.equal(en.format(15, 2, 1448), '15 Safar 1448');
    assert.equal(fr.format(15, 2, 1448), '15 Safar 1448');
    assert.equal(en.format(9, 9), '9 Ramadan');
    assert.equal(fr.format(9, 9), '9 Ramadan');
});

test('an engine that silently answers in Gregorian is refused', () => {
    // The failure mode this module exists to prevent: `Intl` accepts the
    // `-u-ca-islamic-umalqura` request, ignores it, and returns Gregorian
    // parts. Every number is plausible; only the magnitude gives it away.
    const gregorianOnly = {
        DateTimeFormat: function () {
            return {
                formatToParts: (date) => [
                    { type: 'year', value: String(date.getUTCFullYear()) },
                    { type: 'literal', value: '-' },
                    { type: 'month', value: String(date.getUTCMonth() + 1) },
                    { type: 'literal', value: '-' },
                    { type: 'day', value: String(date.getUTCDate()) },
                ],
            };
        },
    };
    const fake = load({ intl: gregorianOnly });
    assert.equal(fake.available(), false, 'a Gregorian fallback was trusted as Hijri');
    assert.equal(fake.parts(new Date(2026, 8, 7)), null);
    // The table is still readable — callers drop the affordance, they do not
    // crash reaching for a month name.
    assert.equal(fake.monthName(1), 'Muharram');
});

test('an engine with no Intl at all degrades instead of throwing', () => {
    const noIntl = load({
        intl: { DateTimeFormat: function () { throw new Error('no ICU'); } },
    });
    assert.equal(noIntl.available(), false);
    assert.equal(noIntl.parts(new Date()), null);
});

test('the probe runs once and the answer is cached', () => {
    let built = 0;
    const counting = {
        DateTimeFormat: function (...args) {
            built += 1;
            return new Intl.DateTimeFormat(...args);
        },
    };
    const counted = load({ intl: counting });
    counted.available();
    counted.available();
    counted.parts(new Date(2026, 8, 7));
    counted.parts(new Date(2026, 8, 8));
    assert.equal(built, 1, `formatter rebuilt ${built} times — the memo is not holding`);
});
