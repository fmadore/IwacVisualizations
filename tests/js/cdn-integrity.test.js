'use strict';

// The integrity block in view/common/iwac-assets.phtml is generated, and it is
// only worth having if it names exactly the files the partial loads: a pin
// bumped without re-running `npm run update:sri` is a hash for a file no page
// requests and no hash for the one it does, which a browser would run
// unverified — or, for a file whose URL kept its old hash, refuse outright.

const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');
const { urlsIn, recordedHashes, untar, renderBlock, readPartial } = require('../../scripts/cdn-integrity.js');

test('the partial records a well-formed sha384 for every CDN file it loads, and nothing else', () => {
    const partial = readPartial();
    assert.ok(partial.block, 'the generated integrity block is present');
    const used = urlsIn(partial.outside).map((u) => u.url).sort();
    const recorded = recordedHashes(partial.block);
    assert.deepEqual([...recorded.keys()].sort(), used);
    for (const [url, hash] of recorded) {
        assert.match(hash, /^sha384-[A-Za-z0-9+/]{64}$/, url);
    }
    // Every library the loader can request: ECharts, the word-cloud plugin,
    // MapLibre's two main-thread modules and its sheet, and the four d3 builds.
    assert.equal(used.length, 9);
});

test('a rendered block reads back as the same URL → hash pairs', () => {
    const entries = [
        { url: 'https://cdn.jsdelivr.net/npm/a@1.0.0/dist/a.js', hash: 'sha384-' + 'A'.repeat(64) },
        { url: 'https://cdn.jsdelivr.net/npm/@s/b@2.0.0/b.mjs', hash: 'sha384-' + 'B'.repeat(64) },
    ];
    const back = recordedHashes(renderBlock(entries));
    assert.deepEqual([...back.entries()], entries.map((e) => [e.url, e.hash]));
});

test('the tarball reader finds a file by its path inside the package', () => {
    // One ustar entry, `package/dist/x.js`, then the two zero blocks.
    const body = Buffer.from('export default 1;\n');
    const header = Buffer.alloc(512);
    header.write('package/dist/x.js', 0);
    header.write('0000644\0', 100);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('0', 156);
    header.write('ustar\0', 257);
    const padded = Buffer.concat([body, Buffer.alloc(512 - body.length)]);
    const tar = Buffer.concat([header, padded, Buffer.alloc(1024)]);
    const files = untar(zlib.gzipSync(tar));
    assert.deepEqual([...files.keys()], ['dist/x.js']);
    assert.equal(files.get('dist/x.js').toString(), body.toString());
});
