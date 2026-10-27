#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '../..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4187);
const MIME = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    // The model logos and card thumbnails. A browser renders a PNG served as
    // octet-stream by sniffing it, but never an SVG: without this every
    // sentiment-lane logo was a broken image in the fixtures.
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

// Text goes out gzipped, as it does live: the module's assets come gzipped
// from Apache and ECharts brotli'd from jsDelivr. Uncompressed, the
// Lighthouse budgets (scripts/check-lighthouse.js) measured a page three
// times heavier than the one readers download. Compressed whole, at a fixed
// level, so the same file is the same byte count on every run and platform.
const COMPRESSIBLE = new Set(['.css', '.html', '.js', '.json', '.svg']);
const gzipped = new Map();

function gzipOf(target, stat) {
    const key = `${target}:${stat.size}:${stat.mtimeMs}`;
    if (!gzipped.has(key)) gzipped.set(key, zlib.gzipSync(fs.readFileSync(target), { level: 6 }));
    return gzipped.get(key);
}

const server = http.createServer((request, response) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
    } catch (error) {
        response.writeHead(400).end('Bad request');
        return;
    }
    if (pathname === '/') pathname = '/tests/browser/fixtures/dashboard.html';
    // Every browser asks for one; a 404 is a console error on every fixture,
    // which Lighthouse's best-practices score would count against the module.
    if (pathname === '/favicon.ico') {
        response.writeHead(204).end();
        return;
    }
    const target = path.resolve(ROOT, `.${pathname}`);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
    }
    fs.stat(target, (statError, stat) => {
        if (statError || !stat.isFile()) {
            response.writeHead(404).end('Not found');
            return;
        }
        const ext = path.extname(target);
        const headers = {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        };
        if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
            const body = gzipOf(target, stat);
            response.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length, Vary: 'Accept-Encoding' });
            response.end(body);
            return;
        }
        response.writeHead(200, headers);
        fs.createReadStream(target).pipe(response);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`IWAC browser fixture: http://${HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
