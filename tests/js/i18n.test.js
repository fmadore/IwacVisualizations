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

function loadI18n(lang) {
    const context = {
        Intl,
        document: {
            documentElement: {
                getAttribute(name) {
                    return name === 'lang' ? lang : null;
                },
            },
        },
        window: { IWACVis: {} },
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

test('translations interpolate parameters and fall back to the source key', () => {
    const ns = loadI18n('fr-FR');
    assert.equal(ns.t('Loading dashboard'), 'Chargement du tableau de bord');
    assert.equal(
        ns.t('period_covered', { min: 1950, max: 2024 }),
        'Période couverte : 1950 – 2024'
    );
    assert.equal(ns.t('not_in_the_dictionary'), 'not_in_the_dictionary');
});

test('block-specific catalogs can extend the active locale safely', () => {
    const ns = loadI18n('fr');
    ns.addTranslations('fr', { custom_key: 'Valeur {count}' });
    assert.equal(ns.t('custom_key', { count: 3 }), 'Valeur 3');
});
