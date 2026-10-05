'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const { join, relative } = require('node:path');
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
    // `import()` is syntax, not a function a sandbox can stub, so the one call
    // is rewritten to a global the test controls.
    vm.runInNewContext(source.replace(/\bimport\(url\)/, '__dynamicImport(url)'), sandbox);
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
    assert.match(source, /\bimport\(url\)/);
    assert.doesNotMatch(assets, /\$scripts\[\]\s*=\s*\$cdnMaplibreJs/);
    assert.match(assets, /JSON_HEX_TAG/);
    assert.match(source, /node\.async = false/);
});

test('a failed MapLibre import is forgotten, so Retry or the next map block imports again', async () => {
    const run = harness([
        { scripts: ['/a.js'], mjs: '/map.mjs' },
        { scripts: ['/b.js'], mjs: '/map.mjs' }
    ]);
    let attempts = 0;
    run.sandbox.__dynamicImport = url => {
        run.calls.push(url);
        return ++attempts === 1 ? Promise.reject(new Error('CDN unreachable')) : Promise.resolve({ ok: true });
    };
    const lazy = run.sandbox.IWACVisLazy;
    run.activate(0);
    const first = lazy.mjsP;
    assert.ok(first, 'the first map block armed the import');
    first.catch(() => {}); // what a map panel's own error path does
    await flush();
    assert.equal(lazy.mjsP, null, 'a rejected import stayed cached, so nothing could ever retry it');
    assert.equal('mjs' in lazy, false, 'S.mjs was written and never read');

    run.activate(1); await flush();
    assert.deepEqual(run.calls, ['/map.mjs', '/map.mjs']);
    assert.equal((await lazy.mjsP).ok, true);
    assert.equal(run.sandbox.maplibregl.ok, true, 'the retried import did not publish the global');
});

test('a resolved MapLibre import is shared, never re-imported', async () => {
    const run = harness([
        { scripts: ['/a.js'], mjs: '/map.mjs' },
        { scripts: ['/b.js'], mjs: '/map.mjs' }
    ]);
    run.activate(0); await flush();
    run.activate(1); await flush();
    assert.deepEqual(run.calls, ['/map.mjs']);
});

/**
 * Every literal `assetUrl('<path>', 'IwacVisualizations')` the PHP side emits
 * must name a file that is on disk.
 *
 * The bundling commit deleted every per-file `.min.js`, and the embed gallery
 * kept requesting `js/charts/shared/embed.min.js` for months: a 404 in
 * production, `IWACVis.embed` never defined, and not one snippet rendered.
 * Nothing failed, because nothing looked. The dist bundles and the `.min.css`
 * files are committed, so a missing target here is a real broken URL.
 * Computed paths (`'css/blocks/' . $sheet`) are not literals and are checked
 * where they are declared — the registry test in tests/php/run.php.
 */
test('every literal module assetUrl() target in view/ and src/ exists on disk', () => {
    const files = [];
    (function walk(dir) {
        for (const entry of readdirSync(dir)) {
            const path = join(dir, entry);
            if (statSync(path).isDirectory()) walk(path);
            else if (/\.(php|phtml)$/.test(entry)) files.push(path);
        }
    })(join(ROOT, 'view'));
    (function walk(dir) {
        for (const entry of readdirSync(dir)) {
            const path = join(dir, entry);
            if (statSync(path).isDirectory()) walk(path);
            else if (entry.endsWith('.php')) files.push(path);
        }
    })(join(ROOT, 'src'));
    files.push(join(ROOT, 'Module.php'));

    // `$module` is how view/common/iwac-assets.phtml spells the module name.
    const call = /assetUrl\(\s*'([^'$]+)'\s*,\s*(?:'IwacVisualizations'|\$module)\s*\)/g;
    const missing = [];
    let found = 0;
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        let m;
        while ((m = call.exec(src)) !== null) {
            found++;
            if (!existsSync(join(ROOT, 'asset', m[1]))) {
                missing.push(`${relative(ROOT, file).split('\\').join('/')}: asset/${m[1]}`);
            }
        }
    }
    assert.ok(found >= 8, `only ${found} literal assetUrl() calls found — has the pattern stopped matching?`);
    assert.deepEqual(missing, [], 'assetUrl() targets missing from asset/ (run `npm run build` if a bundle is new)');
});
