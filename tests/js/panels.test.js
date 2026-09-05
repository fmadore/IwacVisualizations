'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const PANELS_SOURCE = readFileSync(
    join(ROOT, 'asset', 'js', 'charts', 'shared', 'panels.js'),
    'utf8'
);

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.attributes = {};
        this.children = [];
        this.className = '';
        this.textContent = '';
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }
}

function loadPanels(options = {}) {
    const document = {
        createElement(tag) {
            return new FakeElement(tag);
        },
    };
    const context = {
        console,
        document,
        fetch: options.fetch || (() => Promise.reject(new Error('unexpected fetch'))),
        setTimeout,
        clearTimeout,
        window: {
            IWACVis: {
                assetVersion: options.assetVersion || '',
                locale: options.locale || 'en',
                // Default echoes the key, as most tests want. Pass
                // `options.t` to exercise a helper whose OUTPUT is a
                // translated, interpolated string rather than a key.
                t: options.t || ((key) => key),
                formatNumber: (value) => String(value),
            },
        },
    };
    vm.createContext(context);
    vm.runInContext(PANELS_SOURCE, context, { filename: 'panels.js' });
    return { context, P: context.window.IWACVis.panels };
}

test('escapeHtml protects all interpolation-significant characters', () => {
    const { P } = loadPanels();
    assert.equal(
        P.escapeHtml(`<a title="x">Tom & 'Ada'</a>`),
        '&lt;a title=&quot;x&quot;&gt;Tom &amp; &#39;Ada&#39;&lt;/a&gt;'
    );
});

test('unknown-value handling matches the Python generator contract', () => {
    const { P } = loadPanels();
    for (const value of [null, undefined, '', ' Unknown ', 'inconnu', 'N/A', 'na', 'none', 'null', '—']) {
        assert.equal(P.isUnknown(value), true, `expected ${String(value)} to be unknown`);
    }
    for (const value of [0, false, 'Bénin']) {
        assert.equal(P.isUnknown(value), false, `expected ${String(value)} to be preserved`);
    }
});

test('lazyInit is one-shot when IntersectionObserver is unavailable', () => {
    const { P } = loadPanels();
    let calls = 0;
    const trigger = P.lazyInit({}, () => { calls += 1; });
    trigger();
    trigger();
    assert.equal(calls, 1);
});

test('fetchJSON appends the combined asset version and preserves defaults', async () => {
    let request;
    const { P } = loadPanels({
        assetVersion: '1.31.0-2026-07-31T10:00:00Z',
        fetch: async (url, init) => {
            request = { url, init };
            return { ok: true, json: async () => ({ ok: true }) };
        },
    });

    const body = await P.fetchJSON('/files/data.json?part=1');
    assert.deepEqual(JSON.parse(JSON.stringify(body)), { ok: true });
    assert.equal(
        request.url,
        '/files/data.json?part=1&v=1.31.0-2026-07-31T10%3A00%3A00Z'
    );
    assert.equal(request.init.credentials, 'same-origin');
    assert.equal(request.init.headers.Accept, 'application/json');
});

test('fetchJSON does not duplicate an existing version and rejects HTTP failures', async () => {
    let requestedUrl;
    const { P } = loadPanels({
        assetVersion: 'new',
        fetch: async (url) => {
            requestedUrl = url;
            return { ok: false, status: 503 };
        },
    });

    await assert.rejects(
        P.fetchJSON('/files/data.json?v=fixed'),
        /HTTP 503 for \/files\/data\.json\?v=fixed/
    );
    assert.equal(requestedUrl, '/files/data.json?v=fixed');
});

// Interpolating stand-in for the real dictionary, so the assertions below
// read as the strings a visitor actually sees.
const INTERPOLATING_T = (key, params) => {
    const table = { duration_hours: '{count} h', duration_minutes: '{count} min' };
    const template = table[key] || key;
    return params
        ? template.replace(/\{(\w+)\}/g, (_, name) => (params[name] != null ? params[name] : `{${name}}`))
        : template;
};

test('an aggregate runtime is a size, not a timestamp', () => {
    const { P } = loadPanels({ t: INTERPOLATING_T });

    // Whole hours once the integer part alone separates two bars…
    assert.equal(P.formatTotalDuration(1012955), '281 h');   // 281.4 h
    assert.equal(P.formatTotalDuration(536220), '149 h');    // 149.0 h
    assert.equal(P.formatTotalDuration(157889), '44 h');     //  43.9 h

    // …and one decimal below 10 h, where rounding to the integer would
    // collapse two genuinely different channels onto the same label.
    assert.equal(P.formatTotalDuration(33352), '9.3 h');
    assert.equal(P.formatTotalDuration(32400), '9 h');       // exactly 9.0
    assert.equal(P.formatTotalDuration(35999), '10 h');      // 9.9997 → 10

    // Under the hour the unit changes rather than printing "0.1 h".
    assert.equal(P.formatTotalDuration(1800), '30 min');
    assert.equal(P.formatTotalDuration(3599), '60 min');
    // A sub-minute total still reports a minute: "0 min" reads as none.
    assert.equal(P.formatTotalDuration(20), '1 min');

    // Same empty contract as formatDuration — no runtime renders nothing.
    for (const empty of [0, -5, null, undefined, NaN, 'nope']) {
        assert.equal(P.formatTotalDuration(empty), '');
    }
});

test('a total and a single runtime format differently on purpose', () => {
    const { P } = loadPanels({ t: INTERPOLATING_T });
    // The same 281.4 hours: a player timestamp for one recording, a size
    // for a sum. Reading a sum in h:mm:ss is what this pair prevents.
    assert.equal(P.formatDuration(1012955), '281:22:35');
    assert.equal(P.formatTotalDuration(1012955), '281 h');
});

test('fetchJSON is bounded by default and rejects a request that never answers', async () => {
    const { P } = loadPanels({
        fetch: () => new Promise(() => {}),   // a captive portal, a swallowed connection
    });
    P.FETCH_TIMEOUT_MS = 20;
    await assert.rejects(P.fetchJSON('/files/never.json'), /timed out after 20 ms/);
});

test('fetchJSON timeoutMs: 0 opts out of the bound', async () => {
    let init;
    const { P } = loadPanels({
        fetch: async (url, options) => {
            init = options;
            return { ok: true, json: async () => ({ ok: true }) };
        },
    });
    P.FETCH_TIMEOUT_MS = 20;
    const body = await P.fetchJSON('/files/data.json', { timeoutMs: 0 });
    assert.deepEqual(JSON.parse(JSON.stringify(body)), { ok: true });
    assert.equal(init.signal, undefined, 'no abort controller is armed when the bound is off');
});
