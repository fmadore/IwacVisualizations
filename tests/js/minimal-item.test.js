'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const SOURCE = readFileSync(
    join(ROOT, 'asset', 'js', 'charts', 'minimal-item-dashboard.js'),
    'utf8'
);
const PANELS_SOURCE = readFileSync(
    join(ROOT, 'asset', 'js', 'charts', 'shared', 'panels.js'),
    'utf8'
);

/**
 * The orchestrator only needs `panels` + `dashboardLayout` to exist before
 * it will register itself; neither is exercised by the scoping helpers.
 */
function loadModule() {
    const context = {
        console,
        document: { readyState: 'complete', querySelectorAll: () => [] },
        window: {
            IWACVis: {
                panels: {},
                dashboardLayout: { register() {} },
            },
        },
    };
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'minimal-item-dashboard.js' });
    return context.window.IWACVis.minimalItem;
}

function loadPanels() {
    const context = {
        console,
        document: { createElement: () => ({ appendChild() {}, setAttribute() {} }) },
        fetch: () => Promise.reject(new Error('unexpected fetch')),
        setTimeout,
        clearTimeout,
        window: { IWACVis: { locale: 'en', t: (key) => key } },
    };
    vm.createContext(context);
    vm.runInContext(PANELS_SOURCE, context, { filename: 'panels.js' });
    return context.window.IWACVis.panels;
}

const BUNDLE = {
    total: 1146,
    years: [{ year: 2025, count: 400 }],
    top_items: [],
    by_publisher: {
        "rtb - radiodiffusion télévision du burkina": {
            label: 'RTB - Radiodiffusion Télévision du Burkina',
            source_type: 'youtube',
            total: 639,
        },
        'daarul hadeethis salafiyyah': {
            label: 'Daarul Hadeethis Salafiyyah',
            source_type: 'deposited',
            total: 44,
        },
    },
};

test('minimal-item scopes an audiovisual page to its own channel', () => {
    const mod = loadModule();
    const scoped = mod.scopeToPublisher(BUNDLE, 'RTB - Radiodiffusion Télévision du Burkina');
    assert.equal(scoped.total, 639);
    assert.equal(scoped.source_type, 'youtube');
});

test('minimal-item folds case the same way the generator keys its slices', () => {
    const mod = loadModule();
    assert.equal(mod.sliceKey('  RTB - Radiodiffusion Télévision Du Burkina '),
        'rtb - radiodiffusion télévision du burkina');
    assert.equal(
        mod.scopeToPublisher(BUNDLE, 'daarul HADEETHIS salafiyyah').total,
        44
    );
});

test('minimal-item matches a channel through its display label', () => {
    // A slice whose key does not fold to the publisher string still
    // matches on the raw label it carries.
    const mod = loadModule();
    const bundle = { by_publisher: { 'legacy-key': { label: "L'Autregard", total: 46 } } };
    assert.equal(mod.scopeToPublisher(bundle, "L'Autregard").total, 46);
});

test('minimal-item falls back to the whole subset rather than emptying', () => {
    const mod = loadModule();
    // An unknown channel, an item with no publisher, and a bundle
    // generated before the source-aware split all take the fallback.
    assert.equal(mod.scopeToPublisher(BUNDLE, 'Radio Nowhere'), null);
    assert.equal(mod.scopeToPublisher(BUNDLE, ''), null);
    assert.equal(mod.scopeToPublisher({ total: 47, years: [] }, 'Any channel'), null);
    assert.equal(mod.scopeToPublisher(null, 'Any channel'), null);
});

test('runtime formatting follows the player convention', () => {
    const P = loadPanels();
    assert.equal(P.formatDuration(154), '2:34');
    assert.equal(P.formatDuration(60), '1:00');
    assert.equal(P.formatDuration(5415), '1:30:15');
    assert.equal(P.formatDuration(34260), '9:31:00');
    // No runtime recorded renders nothing rather than "0:00".
    for (const empty of [0, -5, null, undefined, NaN, 'nope']) {
        assert.equal(P.formatDuration(empty), '');
    }
});
