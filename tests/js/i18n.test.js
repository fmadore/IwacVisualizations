'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = readFileSync(
    join(__dirname, '..', '..', 'asset', 'js', 'iwac-i18n.js'),
    'utf8'
);

function loadI18n(lang, lazy) {
    const context = {
        Intl,
        document: {
            documentElement: {
                getAttribute(name) {
                    return name === 'lang' ? lang : null;
                },
            },
        },
        window: { IWACVis: {}, IWACVisLazy: lazy },
    };
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'iwac-i18n.js' });
    return context.window.IWACVis;
}

test('locale detection normalizes Omeka locale variants', () => {
    assert.equal(loadI18n('fr-FR').locale, 'fr');
    assert.equal(loadI18n('en_US').locale, 'en');
    assert.equal(loadI18n('de-DE').locale, 'en');
});

test('the locale the loader fetched bundles for is the one t() uses', () => {
    // A per-locale bundle carries only its own language's strings, so the
    // loader's choice has to win over a second reading of <html lang>.
    assert.equal(loadI18n('en', { locale: 'fr' }).locale, 'fr');
    assert.equal(loadI18n('fr-FR', { locale: 'en' }).locale, 'en');
    // Anything else the loader might publish is ignored, not trusted.
    assert.equal(loadI18n('fr-FR', { locale: 'de' }).locale, 'fr');
    assert.equal(loadI18n('fr-FR', {}).locale, 'fr');
});

test('translations interpolate parameters and fall back to the source key', () => {
    const ns = loadI18n('fr-FR');
    assert.equal(ns.t('Download chart'), 'Télécharger le graphique');
    assert.equal(
        ns.t('period_covered', { min: 1950, max: 2024 }),
        'Période couverte\u00A0: 1950 – 2024'
    );
    assert.equal(ns.t('not_in_the_dictionary'), 'not_in_the_dictionary');
});

test('block-specific catalogs can extend the active locale safely', () => {
    const ns = loadI18n('fr');
    ns.addTranslations('fr', { custom_key: 'Valeur {count}' });
    assert.equal(ns.t('custom_key', { count: 3 }), 'Valeur 3');
});

/*
 * Numbers follow one rule across the theme, IwacSearch and this module:
 * thousands grouped with U+202F in every locale, the decimal mark and the
 * percent spacing of the PAGE locale. These spell the separators out as
 * escapes so a lookalike space cannot pass.
 */
const NNBSP = '\u202F';

test('counts group with a narrow no-break space in both locales', () => {
    const fr = loadI18n('fr-FR');
    const en = loadI18n('en');
    assert.equal(fr.formatNumber(6000), `6${NNBSP}000`);
    assert.equal(en.formatNumber(6000), `6${NNBSP}000`);
    assert.equal(en.formatNumber(1234567), `1${NNBSP}234${NNBSP}567`);
    // The English site no longer prints a comma a French reader takes for a decimal.
    assert.ok(!en.formatNumber(7649).includes(','));
    assert.equal(fr.formatNumber(0.25), '0,25');
    assert.equal(en.formatNumber(0.25), '0.25');
    assert.equal(fr.formatNumber(null), '');
    assert.equal(fr.formatNumber('n/a'), 'n/a');
});

test('decimals and percents take the page locale, never the browser default', () => {
    const fr = loadI18n('fr-FR');
    const en = loadI18n('en');
    assert.equal(fr.formatDecimal(12.345), '12,3');
    assert.equal(en.formatDecimal(12.345), '12.3');
    assert.equal(fr.formatDecimal(40, 2), '40');
    assert.equal(fr.formatPercent(12.5), `12,5${NNBSP}%`);
    assert.equal(en.formatPercent(12.5), '12.5%');
    assert.equal(fr.formatPercent(7, 0), `7${NNBSP}%`);
    assert.equal(en.formatPercent(null), '—');
    assert.equal(fr.formatPercent(12345, 0), `12${NNBSP}345${NNBSP}%`);
});

test('compact labels abbreviate in the page locale', () => {
    const fr = loadI18n('fr-FR');
    const en = loadI18n('en');
    assert.equal(en.formatCompact(4804), '4.8K');
    assert.match(fr.formatCompact(4804), /^4,8\s?k$/u);
    assert.equal(fr.formatCompact(999), '999');
});

test('a numeric count in t() follows the same grouping rule', () => {
    const fr = loadI18n('fr-FR');
    fr.addTranslations('fr', { n_items: '{count} documents' });
    assert.equal(fr.t('n_items', { count: 12345 }), `12${NNBSP}345 documents`);
});

test('month names come from one Intl-derived table, January first', () => {
    const fr = loadI18n('fr-FR');
    const en = loadI18n('en');
    assert.deepEqual(Array.from(en.monthNames('short').slice(0, 3)), ['Jan', 'Feb', 'Mar']);
    assert.equal(fr.monthNames('short')[1], 'févr.');
    assert.equal(fr.monthNames('long')[7], 'août');
    assert.equal(en.weekdayNames('short')[0], 'Sun');
    assert.equal(fr.formatYearMonth('2024-05'), 'mai 2024');
    assert.equal(en.formatYearMonth('2024-05'), 'May 2024');
    assert.equal(en.formatYearMonth('2024'), '2024');
});
