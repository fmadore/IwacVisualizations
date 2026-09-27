'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ROOT = join(__dirname, '../..');
const source = readFileSync(join(ROOT, 'asset/js/iwac-lazy.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(payloads, fail = new Set(), { modulepreload = true, lang = 'en' } = {}) {
    const injected = [], hosts = [], nodes = [], calls = [];
    function element(tag) {
        const node = { tag, children: [], textContent: '', dataset: {},
            appendChild(node) { this.children.push(node); },
            setAttribute(k, v) { this[k] = v; },
            addEventListener(k, fn) { this[k] = fn; }, remove() { this.removed = true; } };
        if (tag === 'link' && modulepreload) node.relList = { supports: (rel) => rel === 'modulepreload' };
        return node;
    }
    const sandbox = { console: { error() {} }, setTimeout, clearTimeout };
    sandbox.window = sandbox;
    sandbox.IntersectionObserver = function (callback) {
        sandbox.intersect = host => callback([{ target: host, isIntersecting: true }]);
        this.observe = () => {};
        this.unobserve = () => {};
    };
    sandbox.__dynamicImport = url => { calls.push(url); return Promise.resolve({}); };
    payloads.forEach(payload => {
        const host = element('div');
        const loading = element('div');
        host.loading = loading;
        host.querySelector = () => loading;
        hosts.push(host);
        nodes.push({ textContent: JSON.stringify(payload), nextElementSibling: host });
    });
    sandbox.document = { readyState: 'complete', createElement: element,
        documentElement: { getAttribute: (name) => (name === 'lang' ? lang : null) },
        querySelectorAll: () => nodes,
        head: { appendChild(node) {
            injected.push(node);
            if (node.tag === 'script') queueMicrotask(() => {
                if (fail.has(node.src)) node.onerror(); else node.onload();
            });
            if (node.tag === 'link' && node.rel === 'modulepreload') queueMicrotask(() => {
                if (fail.has(node.href)) node.onerror(); else node.onload();
            });
        } }
    };
    vm.runInNewContext(source.replace('import(S.mjs)', '__dynamicImport(S.mjs)'), sandbox);
    return { hosts, injected, calls, sandbox, activate: i => sandbox.intersect(hosts[i]),
        scripts: () => injected.filter(n => n.tag === 'script').map(n => n.src) };
}

test('only the approached block loads its libraries, and shared scripts execute once', async () => {
    const run = harness([
        { scripts: ['/core.js', '/simple.js'] },
        { scripts: ['/core.js', '/map.js'], mjs: '/map.mjs' }
    ]);
    assert.deepEqual(run.scripts(), []);
    run.activate(0); await flush();
    assert.deepEqual(run.scripts(), ['/core.js', '/simple.js']);
    assert.deepEqual(run.calls, []);
    run.activate(1); await flush();
    assert.deepEqual(run.scripts(), ['/core.js', '/simple.js', '/map.js']);
    assert.deepEqual(run.calls, ['/map.mjs']);
});

test('a failed dependency stops dependents, shows a translated retry and then recovers', async () => {
    const fail = new Set(['/library.js']);
    const run = harness([{ scripts: ['/library.js', '/block.js'], error: 'Chargement impossible', retry: 'Réessayer' }], fail);
    run.activate(0); await flush();
    assert.deepEqual(run.scripts(), ['/library.js']);
    const region = run.hosts[0].loading;
    assert.equal(region.children[0].textContent, 'Chargement impossible');
    assert.equal(region.children[1].textContent, 'Réessayer');
    fail.clear(); region.children[1].click(); await flush();
    assert.deepEqual(run.scripts(), ['/library.js', '/library.js', '/block.js']);
});

test('each instance boots only after its own block dependencies are ready', async () => {
    const run = harness([{ scripts: ['/same.js'] }, { scripts: ['/same.js'] }]);
    const started = [];
    run.sandbox.IWACVisLazy.whenVisible(run.hosts[0], () => started.push(0));
    run.sandbox.IWACVisLazy.whenVisible(run.hosts[1], () => started.push(1));
    run.activate(0); await flush();
    assert.deepEqual(started, [0]);
    run.activate(1); await flush();
    assert.deepEqual(started, [0, 1]);
    assert.deepEqual(run.scripts(), ['/same.js']);
});

test('MapLibre stays an ES module and never joins the ordered classic chain', () => {
    const assets = readFileSync(join(ROOT, 'view/common/iwac-assets.phtml'), 'utf8');
    assert.match(source, /import\(S\.mjs\)/);
    assert.doesNotMatch(assets, /\$scripts\[\]\s*=\s*\$cdnMaplibreJs/);
    assert.match(assets, /JSON_HEX_TAG/);
    assert.match(source, /node\.async = false/);
});

const modulepreloads = (run) => run.injected
    .filter(n => n.tag === 'link' && n.rel === 'modulepreload')
    .map(n => n.href);

test('MapLibre\'s entry and shared chunk are modulepreloaded once, then imported', async () => {
    const map = { scripts: ['/core.js'], mjs: '/map.mjs', mjsPreload: ['/map-shared.mjs'] };
    const run = harness([map, { ...map }]);
    assert.deepEqual(modulepreloads(run), []);
    run.activate(0); await flush();
    assert.deepEqual(modulepreloads(run), ['/map.mjs', '/map-shared.mjs']);
    assert.deepEqual(run.calls, ['/map.mjs']);
    run.activate(1); await flush();
    assert.deepEqual(modulepreloads(run), ['/map.mjs', '/map-shared.mjs'],
        'a second map block reuses the first import');
    assert.deepEqual(run.calls, ['/map.mjs']);
});

test('CDN files carry their recorded integrity and CORS mode; module files do not', async () => {
    const cdn = 'https://cdn.example/echarts.min.js';
    const css = 'https://cdn.example/maplibre-gl.css';
    const entry = 'https://cdn.example/maplibre-gl.mjs';
    const chunk = 'https://cdn.example/maplibre-gl-shared.mjs';
    const run = harness([{
        scripts: [cdn, '/modules/core.min.js'], css: [css, '/modules/map.min.css'],
        mjs: entry, mjsPreload: [chunk],
        integrity: { [cdn]: 'sha384-A', [css]: 'sha384-B', [entry]: 'sha384-C', [chunk]: 'sha384-D' },
    }]);
    run.activate(0); await flush();
    const find = (tag, rel, url) => run.injected.find(n => n.tag === tag && (n.rel || null) === rel && (n.src || n.href) === url);
    for (const [node, hash] of [
        [find('script', null, cdn), 'sha384-A'],
        [find('link', 'preload', cdn), 'sha384-A'],
        [find('link', 'stylesheet', css), 'sha384-B'],
        [find('link', 'modulepreload', entry), 'sha384-C'],
        [find('link', 'modulepreload', chunk), 'sha384-D'],
    ]) {
        assert.ok(node, `expected a node for ${hash}`);
        assert.equal(node.integrity, hash);
        assert.equal(node.crossOrigin, 'anonymous', 'SRI on a cross-origin file needs CORS');
    }
    for (const node of [find('script', null, '/modules/core.min.js'), find('link', 'stylesheet', '/modules/map.min.css')]) {
        assert.equal(node.integrity, undefined);
        assert.equal(node.crossOrigin, undefined, 'same-origin module files stay plain requests');
    }
});

test('a MapLibre entry that fails its integrity check is never imported', async () => {
    const run = harness([{ scripts: ['/core.js'], mjs: '/map.mjs', mjsPreload: ['/map-shared.mjs'],
        integrity: { '/map.mjs': 'sha384-X' } }], new Set(['/map.mjs']));
    run.activate(0); await flush();
    assert.deepEqual(run.calls, [], 'import() would otherwise fetch the file again, unverified');
    await assert.rejects(run.sandbox.IWACVisLazy.mjsP, /Module failed/);
    assert.deepEqual(run.scripts(), ['/core.js'], 'the classic chain is unaffected');
});

test('without modulepreload support MapLibre is imported directly', async () => {
    const run = harness([{ scripts: ['/core.js'], mjs: '/map.mjs', mjsPreload: ['/map-shared.mjs'] }],
        new Set(), { modulepreload: false });
    run.activate(0); await flush();
    assert.deepEqual(modulepreloads(run), []);
    assert.deepEqual(run.calls, ['/map.mjs']);
});

test('a bundle built per locale is fetched in the page\'s language, and the choice is published', async () => {
    const payload = { scripts: [{ en: '/core.en.js', fr: '/core.fr.js' }, '/charts.js', { en: '/block.en.js', fr: '/block.fr.js' }] };
    const fr = harness([payload], new Set(), { lang: 'fr-FR' });
    fr.activate(0); await flush();
    assert.deepEqual(fr.scripts(), ['/core.fr.js', '/charts.js', '/block.fr.js']);
    assert.equal(fr.sandbox.IWACVisLazy.locale, 'fr', 'iwac-i18n.js adopts this, so t() reads the strings that were fetched');
    const preloads = fr.injected.filter(n => n.tag === 'link' && n.rel === 'preload').map(n => n.href);
    assert.deepEqual(preloads, ['/core.fr.js', '/charts.js', '/block.fr.js']);

    for (const lang of ['en', 'en-US', 'de', '']) {
        const other = harness([payload], new Set(), { lang });
        other.activate(0); await flush();
        assert.deepEqual(other.scripts(), ['/core.en.js', '/charts.js', '/block.en.js'], `lang="${lang}" reads English`);
        assert.equal(other.sandbox.IWACVisLazy.locale, 'en');
    }
});
