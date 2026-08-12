'use strict';

// Guards for the on-view asset loader in `view/common/iwac-assets.phtml`,
// specifically the MapLibre 6 ESM path added in 1.37.0.
//
// Why this file exists: MapLibre 6 removed the UMD build entirely. There is no
// `dist/maplibre-gl.js` any more, so the old classic-<script> pin would 404 and
// every map on the site would silently degrade to "map unavailable". The
// replacement — import the `.mjs`, republish the namespace as
// `window.maplibregl`, then run the classic chain — has three properties that
// are easy to regress and invisible until a map block is rendered:
//
//   1. the global must exist BEFORE the first classic script executes
//   2. a failed import must still run the chain (ECharts panels must survive a
//      MapLibre CDN outage)
//   3. blocks with no map must not pay for an import at all
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
        readyState: 'complete',
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
        addEventListener() {},
    };

    vm.createContext(sandbox);
    sandbox.window = sandbox;
    vm.runInContext(source.replace('import(S.mjs)', '__dynamicImport(S.mjs)'), sandbox);

    return {
        sandbox,
        scripts: () => injected.filter((n) => n.tag === 'script'),
        links: () => injected.filter((n) => n.tag === 'link'),
        importCalls: () => importCalls,
    };
}

/** Resolve after the microtask queue has drained. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const MAP_PAYLOAD = {
    scripts: ['/js/iwac-theme.min.js', '/js/charts/shared/maplibre.min.js'],
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

test('publishes window.maplibregl before running the classic chain', async () => {
    const namespace = { Map() {}, Popup() {} };
    const run = runLoader(MAP_PAYLOAD, { importMjs: () => Promise.resolve(namespace) });

    // Synchronously the stylesheets are in, but nothing has executed yet.
    assert.equal(run.links().length, 1);
    assert.equal(run.scripts().length, 0, 'classic chain must wait for the import');

    await flush();

    const scripts = run.scripts();
    assert.equal(run.importCalls(), 1);
    assert.equal(run.sandbox.maplibregl, namespace);
    assert.deepEqual(scripts.map((s) => s.src), MAP_PAYLOAD.scripts, 'order changed');
    for (const script of scripts) {
        assert.equal(script.maplibreAtInject, namespace, 'a script ran before maplibregl existed');
        assert.equal(script.async, false, 'async=false is what keeps the chain in order');
    }
});

test('a failed MapLibre import still runs the rest of the chain', async () => {
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
});

test('blocks without a map import nothing and inject synchronously', () => {
    const run = runLoader({
        scripts: ['/js/iwac-theme.min.js'],
        css: [],
        mjs: null,
    });

    assert.equal(run.importCalls(), 0, 'map-less blocks must not pay for MapLibre');
    assert.deepEqual(run.scripts().map((s) => s.src), ['/js/iwac-theme.min.js']);
});
