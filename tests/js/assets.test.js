'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ROOT = join(__dirname, '../..');
const source = readFileSync(join(ROOT, 'asset/js/iwac-lazy.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(payloads, fail = new Set()) {
    const injected = [], hosts = [], nodes = [], calls = [];
    function element(tag) {
        return { tag, children: [], textContent: '', dataset: {},
            appendChild(node) { this.children.push(node); },
            setAttribute(k, v) { this[k] = v; },
            addEventListener(k, fn) { this[k] = fn; }, remove() { this.removed = true; } };
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
        querySelectorAll: () => nodes,
        head: { appendChild(node) {
            injected.push(node);
            if (node.tag === 'script') queueMicrotask(() => {
                if (fail.has(node.src)) node.onerror(); else node.onload();
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
