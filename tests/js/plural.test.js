'use strict';

// t() plural selection (asset/js/iwac-i18n.js, Tier 8 / S14).
//
// The bug this closes is "1 articles" on a dashboard reporting one article,
// and French "0 article", which the old interpolate-only t() could not
// express at all. English and French disagree about zero — "0 articles" but
// "0 article" — so it cannot be one `n === 1` test shared by both sites.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = readFileSync(join(__dirname, '..', '..', 'asset', 'js', 'iwac-i18n.js'), 'utf8');

function load(locale) {
    const context = {
        console,
        Intl,
        navigator: { language: locale },
        document: {
            documentElement: { lang: locale, getAttribute: (n) => (n === 'lang' ? locale : null) },
            querySelector: () => null,
        },
        window: {},
    };
    context.window.IWACVis = {};
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'iwac-i18n.js' });
    const ns = context.window.IWACVis;
    ns.locale = locale;
    return ns;
}

test('English picks the singular for one and the plural for zero', () => {
    const ns = load('en');
    assert.equal(ns.t('articles_count', { count: 1 }), '1 article');
    assert.equal(ns.t('articles_count', { count: 2 }), '2 articles');
    assert.equal(ns.t('articles_count', { count: 0 }), '0 articles');
});

test('French puts zero with the singular, which is why this is a lookup', () => {
    const ns = load('fr');
    assert.equal(ns.t('articles_count', { count: 1 }), '1 article');
    assert.equal(ns.t('articles_count', { count: 2 }), '2 articles');
    assert.equal(ns.t('articles_count', { count: 0 }), '0 article');
});

test('a key with no variants still resolves, so nothing had to be migrated', () => {
    const ns = load('en');
    // `admin_units_count` has no _one/_other siblings.
    assert.equal(ns.t('admin_units_count', { count: 1 }), '1 units');
    assert.equal(ns.t('Year'), 'Year');
});

test('a non-numeric count selects nothing and interpolates as before', () => {
    const ns = load('en');
    assert.equal(ns.t('articles_count', { count: '1 200' }), '1 200 articles');
});

test('the label colon follows French typography', () => {
    // French puts a non-breaking space before a two-part punctuation mark.
    // Two call sites concatenated `label + ':'` and got the English form on
    // both sites.
    for (const [locale, expected] of [['en', 'Country:'], ['fr', 'Pays :']]) {
        const context = {
            console,
            Intl,
            document: {
                documentElement: { lang: locale, getAttribute: () => locale },
                querySelector: () => null,
                createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { add() {} }, style: {} }),
            },
            window: { IWACVis: {} },
        };
        vm.createContext(context);
        vm.runInContext(SOURCE, context, { filename: 'iwac-i18n.js' });
        vm.runInContext(
            readFileSync(join(__dirname, '..', '..', 'asset', 'js', 'charts', 'shared', 'panels.js'), 'utf8'),
            context, { filename: 'panels.js' }
        );
        const ns = context.window.IWACVis;
        ns.locale = locale;
        assert.equal(ns.panels.labelColon(locale === 'fr' ? 'Pays' : 'Country'), expected);
    }
});
