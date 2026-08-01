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
                t: (key) => key,
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
