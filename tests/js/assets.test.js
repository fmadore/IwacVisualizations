'use strict';

// Guards for the on-view asset loader in `view/common/iwac-assets.phtml`,
// specifically the MapLibre 6 ESM path added in 1.37.0.
//
// Why this file exists: MapLibre 6 removed the UMD build entirely. There is no
// `dist/maplibre-gl.js` any more, so the old classic-<script> pin would 404 and
// every map on the site would silently degrade to "map unavailable". The
// replacement — import the `.mjs`, republish the namespace as
// `window.maplibregl`, and run the classic chain alongside it — has four
// properties that are easy to regress and invisible until a map block renders:
//
//   1. NOTHING in the chain waits for the import, orchestrator included. This
//      took three goes: awaiting it in front of everything (~1 MB of MapLibre
//      ahead of echarts and ~30 module files), then gating just the
//      orchestrator in 1.51.0 — which is still the script that paints all
//      twelve panels — and finally, in 1.52.0, moving the wait into the map
//      panels themselves via `P.whenMaplibre()`
//   2. the import promise must be PUBLISHED (`IWACVisLazy.mjsP`), because that
//      is what those panels await
//   3. a failed import must reject that promise and leave the chain alone
//      (ECharts panels must survive a MapLibre CDN outage)
//   4. blocks with no map must not pay for an import at all
//
// Rather than restate the loader here (a copy would drift), these tests parse
// the real PHP partial, rebuild the emitted JS, and execute it.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const PARTIAL = readFileSync(
    join(ROOT, 'view', 'common', 'iwac-assets.phtml'),
    'utf8'
);

/** The raw argument to `$headScript->appendScript(...)`, comments stripped. */
function loaderTemplate() {
    const call = '$headScript->appendScript(';
    const start = PARTIAL.indexOf(call);
    assert.notEqual(start, -1, 'the on-view loader call moved or was renamed');
    const rest = PARTIAL.slice(start + call.length);
    const end = rest.indexOf('\n);');
    assert.notEqual(end, -1, 'could not find the end of appendScript(...)');
    return rest
        .slice(0, end)
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
}

/**
 * Reassemble the PHP string concatenation into the JS the browser receives,
 * substituting a caller-supplied payload for `$payload`.
 */
function buildLoader(payload) {
    const source = loaderTemplate();
    const token = /'((?:[^'\\]|\\.)*)'|\$payload/g;
    let out = '';
    let sawPayload = false;
    let match;
    while ((match = token.exec(source)) !== null) {
        if (match[0] === '$payload') {
            out += JSON.stringify(payload);
            sawPayload = true;
            continue;
        }
        out += match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }
    assert.ok(sawPayload, 'loader no longer interpolates $payload');
    return out;
}

/**
 * Execute the loader against fake DOM globals and report what it injected.
 *
 * `import()` cannot run inside a plain vm context without an ESM loader, so the
 * single dynamic-import call is rewritten to a stub. The assertion above the
 * rewrite pins the real source to `import(S.mjs)`, so swapping the mechanism
 * for something else fails here rather than passing against a stale stub.
 */
function runLoader(payload, options = {}) {
    const source = buildLoader(payload);
    assert.match(
        source,
        /\bimport\(S\.mjs\)/,
        'loader no longer uses dynamic import() for the MapLibre ESM chunk'
    );

    const injected = [];
    const readyListeners = [];
    let importCalls = 0;

    const sandbox = {
        console: { error() {} },
        IntersectionObserver: function () {},
        __dynamicImport(url) {
            importCalls += 1;
            return (options.importMjs || (() => Promise.resolve({})))(url);
        },
    };
    sandbox.document = {
        // 'loading' holds load() back until fireReady(), which is the only way
        // to merge a second block's payload the way a real page does: every
        // block's inline script runs while the head is still parsing.
        readyState: options.pending ? 'loading' : 'complete',
        head: {
            appendChild(node) {
                // Snapshot the global at injection time: asserting only on the
                // final state would pass even if the chain ran first.
                injected.push({ ...node, maplibreAtInject: sandbox.maplibregl });
                return node;
            },
        },
        createElement(tag) {
            return { tag, src: '', href: '', rel: '', async: true };
        },
        // Empty -> the loader takes its documented "no block marker" fallback
        // and calls load() immediately, which is what these tests exercise.
        querySelectorAll() {
            return [];
        },
        addEventListener(name, fn) {
            if (name === 'DOMContentLoaded') readyListeners.push(fn);
        },
    };

    vm.createContext(sandbox);
    sandbox.window = sandbox;
    const exec = (src) =>
        vm.runInContext(src.replace('import(S.mjs)', '__dynamicImport(S.mjs)'), sandbox);
    exec(source);
    // Additional blocks on the same page merge into the same window.IWACVisLazy.
    for (const extra of options.alsoBlocks || []) exec(buildLoader(extra));

    return {
        sandbox,
        scripts: () => injected.filter((n) => n.tag === 'script'),
        links: () => injected.filter((n) => n.tag === 'link'),
        importCalls: () => importCalls,
        fireReady: () => readyListeners.forEach((fn) => fn()),
    };
}

/** Resolve after the microtask queue has drained. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const ORCHESTRATOR = '/js/charts/collection-overview.min.js';
const MAP_PAYLOAD = {
    scripts: [
        '/js/iwac-theme.min.js',
        '/js/charts/shared/maplibre.min.js',
        ORCHESTRATOR,
    ],
    css: ['/css/iwac-maplibre.min.css'],
    mjs: 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.3.0/dist/maplibre-gl.mjs',
};

test('MapLibre pin is a v6 ES module, and JS and CSS agree on the version', () => {
    const js = /\$cdnMaplibreJs\s*=\s*'([^']+)'/.exec(PARTIAL);
    const css = /\$cdnMaplibreCss\s*=\s*'([^']+)'/.exec(PARTIAL);
    assert.ok(js && css, 'MapLibre CDN constants are missing');

    assert.match(
        js[1],
        /\/maplibre-gl@(\d+)[^/]*\/dist\/maplibre-gl\.mjs$/,
        'MapLibre 6 ships no UMD build — the JS pin must end in .mjs, not .js'
    );
    const version = (url) => /maplibre-gl@(\d+)\.(\d+)\.(\d+)/.exec(url);
    const jsVersion = version(js[1]);
    const cssVersion = version(css[1]);
    assert.ok(jsVersion && cssVersion, 'MapLibre pins are not exact versions');
    assert.ok(Number(jsVersion[1]) >= 6, 'expected MapLibre 6 or newer');
    assert.equal(jsVersion[0], cssVersion[0], 'MapLibre JS and CSS pins disagree');
});

test('MapLibre never enters the classic $scripts chain', () => {
    assert.doesNotMatch(
        PARTIAL,
        /\$scripts\[\]\s*=\s*\$cdnMaplibreJs/,
        'an ES module cannot execute as a classic <script>: keep it on $lazyMjs'
    );
    assert.match(
        PARTIAL,
        /\$lazyMjs\s*=\s*\$cdnMaplibreJs/,
        'the MapLibre ESM URL is no longer handed to the loader'
    );
});

test('the whole chain, orchestrator included, starts before the import settles', async () => {
    const namespace = { Map() {}, Popup() {} };
    const run = runLoader(MAP_PAYLOAD, { importMjs: () => Promise.resolve(namespace) });

    // Synchronously: stylesheets AND every script are already in, with the
    // import still pending. This is the regression the 1.52.0 split fixed —
    // the orchestrator paints all twelve panels, so gating it meant first
    // paint still waited on a library two of them use.
    assert.equal(run.links().length, 1);
    assert.deepEqual(
        run.scripts().map((s) => s.src),
        MAP_PAYLOAD.scripts,
        'the chain must be injected before the import settles'
    );
    for (const script of run.scripts()) {
        assert.equal(
            script.maplibreAtInject,
            undefined,
            'nothing in the chain may wait for the global — map panels await P.whenMaplibre()'
        );
        assert.equal(script.async, false, 'async=false is what keeps the chain in order');
    }

    await flush();

    assert.equal(run.importCalls(), 1);
    assert.equal(run.sandbox.maplibregl, namespace);
    assert.deepEqual(
        run.scripts().map((s) => s.src),
        MAP_PAYLOAD.scripts,
        'the import settling must not inject anything further'
    );
});

test('publishes the import promise so map panels can await it', async () => {
    const namespace = { Map() {}, Popup() {} };
    const run = runLoader(MAP_PAYLOAD, { importMjs: () => Promise.resolve(namespace) });

    const promise = run.sandbox.IWACVisLazy.mjsP;
    assert.ok(promise && typeof promise.then === 'function',
        'IWACVisLazy.mjsP is what P.whenMaplibre() resolves off — without it, no map ever draws');

    assert.equal(await promise, namespace, 'the promise resolves with the namespace');
    assert.equal(run.sandbox.maplibregl, namespace);
});

test('a failed MapLibre import rejects the promise and leaves the chain alone', async () => {
    const run = runLoader(MAP_PAYLOAD, {
        importMjs: () => Promise.reject(new Error('CDN unreachable')),
    });

    await flush();

    assert.equal(run.sandbox.maplibregl, undefined);
    assert.deepEqual(
        run.scripts().map((s) => s.src),
        MAP_PAYLOAD.scripts,
        'a MapLibre outage must cost the page its map, not its ECharts panels'
    );
    // Rejected, so the panel can show a real error state rather than spin —
    // and pre-handled by the loader, so a page whose map is never scrolled
    // into view does not log an unhandled rejection.
    await assert.rejects(() => run.sandbox.IWACVisLazy.mjsP, /CDN unreachable/);
});

test('blocks without a map import nothing and expose no promise', () => {
    const run = runLoader({
        scripts: ['/js/iwac-theme.min.js', '/js/charts/term-trends.min.js'],
        css: [],
        mjs: null,
    });

    assert.equal(run.importCalls(), 0, 'map-less blocks must not pay for MapLibre');
    assert.equal(run.sandbox.IWACVisLazy.mjsP, null,
        'no import was armed, so P.whenMaplibre() must reject rather than hang');
    assert.deepEqual(run.scripts().map((s) => s.src), [
        '/js/iwac-theme.min.js',
        '/js/charts/term-trends.min.js',
    ]);
});

test('two blocks on one page merge into one queue and one import', async () => {
    const namespace = { Map() {}, Popup() {} };
    const run = runLoader(MAP_PAYLOAD, {
        pending: true,
        importMjs: () => Promise.resolve(namespace),
        alsoBlocks: [
            { scripts: ['/js/iwac-theme.min.js', '/js/charts/term-trends.min.js'], css: [], mjs: null },
        ],
    });

    assert.equal(run.scripts().length, 0, 'nothing loads until the block nears the viewport');
    run.fireReady();
    await flush();

    assert.equal(run.importCalls(), 1, 'one import serves every block on the page');
    assert.deepEqual(
        run.scripts().map((s) => s.src),
        [...MAP_PAYLOAD.scripts, '/js/charts/term-trends.min.js'],
        'shared URLs are de-duped and later blocks join the end of the queue'
    );
});

test('the orchestrator always rides the ordinary chain', () => {
    assert.doesNotMatch(
        PARTIAL,
        /\$deferred/,
        'gating a script behind the MapLibre import is the pattern P.whenMaplibre() replaced'
    );
    assert.match(
        PARTIAL,
        /if \(\$orchestrator\) \{\s*\$scripts\[\] = \$this->assetUrl\('js\/charts\/' \. \$orchestrator/,
        'the orchestrator must be appended to the ungated chain'
    );
});
