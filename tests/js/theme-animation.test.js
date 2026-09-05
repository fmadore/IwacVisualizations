'use strict';

// The entrance animation is a theme decision (asset/js/iwac-theme.js).
//
// Until v1.63.0 twenty-four option builders each wrote
// `animationDuration: 600, animationEasing: 'cubicOut'`; the theme states it
// once and ECharts merges theme values under every option that leaves them
// unset. Two things are pinned: the registered theme carries the pair next
// to the reduced-motion switch, and no builder spells the default out again.

const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const THEME = readFileSync(join(ROOT, 'asset', 'js', 'iwac-theme.js'), 'utf8');

function registerTheme(options = {}) {
    const registered = [];
    const context = {
        console: { warn() {}, error() {} },
        echarts: { registerTheme: (name, theme) => registered.push({ name, theme }) },
        document: { body: null, addEventListener() {}, readyState: 'complete' },
        window: {
            IWACVis: {},
            addEventListener() {},
            matchMedia: (q) => ({ matches: !!options.reducedMotion && /reduced-motion/.test(q), addEventListener() {}, addListener() {} }),
        },
        setTimeout,
    };
    context.window.document = context.document;
    vm.createContext(context);
    vm.runInContext(THEME, context, { filename: 'iwac-theme.js' });
    return registered;
}

test('the registered theme carries the 600 ms ease-out entrance next to the motion switch', () => {
    const [{ name, theme }] = registerTheme();
    assert.equal(name, 'iwac-light');
    assert.equal(theme.animation, true);
    assert.equal(theme.animationDuration, 600);
    assert.equal(theme.animationEasing, 'cubicOut');
});

test('under a reduced-motion preference the switch is off and the tempo is irrelevant', () => {
    const [{ theme }] = registerTheme({ reducedMotion: true });
    assert.equal(theme.animation, false);
});

test('no option builder spells the theme default out again', () => {
    const offenders = [];
    (function walk(dir) {
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) { if (entry !== 'dist') walk(p); continue; }
            if (!p.endsWith('.js') || p.endsWith('.min.js')) continue;
            const src = readFileSync(p, 'utf8');
            if (/animationDuration:\s*600\b/.test(src) || /animationEasing:\s*'cubicOut'/.test(src)) offenders.push(p.slice(ROOT.length + 1));
        }
    })(join(ROOT, 'asset', 'js', 'charts'));
    assert.deepEqual(offenders, [], 'the 600 ms / cubicOut pair lives in iwac-theme.js only');
});
