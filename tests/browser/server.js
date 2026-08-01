#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4187);
const MIME = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((request, response) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
    } catch (error) {
        response.writeHead(400).end('Bad request');
        return;
    }
    if (pathname === '/') pathname = '/tests/browser/fixtures/dashboard.html';
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
        response.writeHead(200, {
            'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        fs.createReadStream(target).pipe(response);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`IWAC browser fixture: http://${HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
