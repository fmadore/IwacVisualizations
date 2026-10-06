#!/usr/bin/env node
/**
 * Subresource Integrity for the pinned CDN libraries.
 *
 * ECharts, echarts-wordcloud, MapLibre GL and the four d3 modules are the only
 * code this module does not serve itself, and every visitor's browser runs
 * them. The pins in view/common/iwac-assets.phtml are exact, which makes the
 * bytes behind each URL fixed — so the browser can be told what they are, and
 * refuse to execute anything else a compromised or misbehaving CDN hands it.
 *
 * The hashes live in a GENERATED block of that partial, keyed by URL:
 *
 *     // BEGIN GENERATED INTEGRITY (npm run update:sri) ...
 *     $cdnIntegrity = [ '<url>' => 'sha384-…', … ];
 *     // END GENERATED INTEGRITY
 *
 * Three modes:
 *
 *   --check   (offline; part of `npm run lint`) — the block exists, names
 *             exactly the jsDelivr URLs the partial uses, and every value is
 *             a well-formed sha384. Bumping a pin and forgetting this block
 *             also trips check-cdn-versions.js's "two versions" guard.
 *
 *   --update  (network: the npm registry) — rewrite the block. Each file is
 *             taken from its package tarball, and the tarball is checked
 *             against the registry's own `dist.integrity` (sha512) first, so
 *             the hash pins what the package author PUBLISHED. jsDelivr
 *             serves `/npm/<pkg>@<exact>/<file>` byte-for-byte from that
 *             tarball; `--verify` is how that assumption is tested.
 *
 *   --verify  (network: jsDelivr) — fetch every URL from the CDN itself and
 *             compare. A mismatch is fatal: it is a library the browser will
 *             refuse to run. An unreachable CDN is reported and skipped, like
 *             the version check next door.
 *
 * Usage: node scripts/cdn-integrity.js --check | --update | --verify
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const PARTIAL = path.join(ROOT, 'view', 'common', 'iwac-assets.phtml');
const PARTIAL_REL = 'view/common/iwac-assets.phtml';
const REGISTRY = 'https://registry.npmjs.org';
const TIMEOUT_MS = 30000;

const BEGIN = '// BEGIN GENERATED INTEGRITY';
const END = '// END GENERATED INTEGRITY';
const URL_RE = /'(https:\/\/cdn\.jsdelivr\.net\/npm\/(@?[^@/\s']+(?:\/[^@/\s']+)?)@(\d[^/\s']*)\/([^'\s]+))'/g;
const HASH_RE = /^sha384-[A-Za-z0-9+/]{64}$/;

/** Split the partial into the generated block and everything else. */
function readPartial() {
    const source = fs.readFileSync(PARTIAL, 'utf8');
    const begin = source.indexOf(BEGIN);
    const end = source.indexOf(END);
    if (begin < 0 || end < begin) {
        return { source, block: null, outside: source };
    }
    const lineStart = source.lastIndexOf('\n', begin) + 1;
    const lineEnd = source.indexOf('\n', end);
    const blockEnd = lineEnd < 0 ? source.length : lineEnd + 1;
    return {
        source,
        blockStart: lineStart,
        blockEnd,
        block: source.slice(lineStart, blockEnd),
        outside: source.slice(0, lineStart) + source.slice(blockEnd),
    };
}

/** Every jsDelivr URL in `text`, once each, in order of appearance. */
function urlsIn(text) {
    const seen = new Map();
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
        if (!seen.has(m[1])) {
            seen.set(m[1], { url: m[1], pkg: m[2], version: m[3], file: m[4] });
        }
    }
    return [...seen.values()];
}

/** The `url => hash` pairs recorded in the generated block. */
function recordedHashes(block) {
    const out = new Map();
    const re = /'(https:\/\/cdn\.jsdelivr\.net\/[^']+)'\s*=>\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(block || '')) !== null) out.set(m[1], m[2]);
    return out;
}

function sri(buffer) {
    return 'sha384-' + crypto.createHash('sha384').update(buffer).digest('base64');
}

async function fetchBuffer(url, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: headers || {} });
        if (!res.ok) throw new Error(`${url} responded ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    } catch (err) {
        if (err && err.name === 'AbortError') throw new Error(`${url} timed out after ${TIMEOUT_MS} ms`, { cause: err });
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The files of an npm tarball, by path inside the package. A ustar reader in
 * twenty lines rather than a dependency: npm packs plain files, the `prefix`
 * field carries long paths, and a pax `x` record may override the name.
 */
function untar(gzipped) {
    const tar = zlib.gunzipSync(gzipped);
    const files = new Map();
    let offset = 0;
    let paxPath = null;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((b) => b === 0)) break;
        const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
        const size = parseInt(field(124, 12).trim() || '0', 8);
        const type = field(156, 1) || '0';
        const prefix = field(345, 155);
        const name = (prefix ? prefix + '/' : '') + field(0, 100);
        const body = tar.subarray(offset + 512, offset + 512 + size);
        if (type === 'x') {
            const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
            paxPath = m ? m[1] : null;
        } else if (type === '0') {
            files.set((paxPath || name).replace(/^[^/]+\//, ''), Buffer.from(body));
            paxPath = null;
        } else {
            paxPath = null;
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return files;
}

/** A package tarball, verified against the registry's own integrity. */
const tarballs = new Map();
async function packageFiles(pkg, version) {
    const key = `${pkg}@${version}`;
    if (tarballs.has(key)) return tarballs.get(key);
    const promise = (async () => {
        const meta = JSON.parse((await fetchBuffer(
            `${REGISTRY}/${pkg.replace('/', '%2f')}/${version}`,
            { accept: 'application/json' }
        )).toString('utf8'));
        const dist = meta && meta.dist;
        if (!dist || !dist.tarball || !dist.integrity) throw new Error(`${key}: registry has no dist.integrity`);
        const tgz = await fetchBuffer(dist.tarball);
        const [algo, expected] = dist.integrity.split('-');
        const actual = crypto.createHash(algo).update(tgz).digest('base64');
        if (actual !== expected) throw new Error(`${key}: tarball does not match the registry's ${algo}`);
        return untar(tgz);
    })();
    tarballs.set(key, promise);
    return promise;
}

function renderBlock(entries) {
    const width = Math.max(...entries.map((e) => e.url.length)) + 2;
    const lines = entries.map((e) => `    ${("'" + e.url + "'").padEnd(width)} => '${e.hash}',`);
    return [
        `${BEGIN} (npm run update:sri) — do not edit by hand.`,
        '$cdnIntegrity = [',
        ...lines,
        '];',
        `${END}`,
        '',
    ].join('\n');
}

function check() {
    const partial = readPartial();
    const problems = [];
    if (!partial.block) {
        problems.push(`${PARTIAL_REL} has no "${BEGIN}" … "${END}" block`);
    } else {
        const used = urlsIn(partial.outside).map((u) => u.url);
        const recorded = recordedHashes(partial.block);
        for (const url of used) {
            if (!recorded.has(url)) problems.push(`no integrity recorded for ${url}`);
            else if (!HASH_RE.test(recorded.get(url))) problems.push(`malformed hash for ${url}: ${recorded.get(url)}`);
        }
        for (const url of recorded.keys()) {
            if (!used.includes(url)) problems.push(`stale integrity entry for ${url}, which the partial no longer loads`);
        }
    }
    if (problems.length) {
        console.error(`✗ integrity guard: ${problems.length} problem(s) in ${PARTIAL_REL}`);
        for (const p of problems) console.error(`  ${p}`);
        console.error('\n  Run `npm run update:sri` after changing a CDN pin, and commit the result.');
        return 1;
    }
    console.log(`✓ integrity guard: all ${recordedHashes(partial.block).size} CDN files carry a sha384`);
    return 0;
}

async function update() {
    const partial = readPartial();
    const used = urlsIn(partial.outside);
    if (!used.length) {
        console.error(`✗ update:sri: no jsDelivr URLs found in ${PARTIAL_REL}`);
        return 1;
    }
    const entries = [];
    for (const u of used) {
        const files = await packageFiles(u.pkg, u.version);
        const body = files.get(u.file);
        if (!body) throw new Error(`${u.pkg}@${u.version} has no file ${u.file}`);
        entries.push({ url: u.url, hash: sri(body) });
        console.log(`  ${sri(body)}  ${u.pkg}@${u.version}/${u.file}`);
    }
    const block = renderBlock(entries);
    let next;
    if (partial.block) {
        next = partial.source.slice(0, partial.blockStart) + block + partial.source.slice(partial.blockEnd);
    } else {
        console.error(`✗ update:sri: add the "${BEGIN}" … "${END}" markers to ${PARTIAL_REL} first`);
        return 1;
    }
    if (next === partial.source) {
        console.log('\n✓ update:sri: already current');
    } else {
        fs.writeFileSync(PARTIAL, next);
        console.log(`\n✓ update:sri: wrote ${entries.length} hashes to ${PARTIAL_REL}`);
    }
    return 0;
}

async function verify() {
    if (check() !== 0) return 1;
    const recorded = recordedHashes(readPartial().block);
    let failed = 0;
    let skipped = 0;
    await Promise.all([...recorded.entries()].map(async ([url, hash]) => {
        let body;
        try {
            body = await fetchBuffer(url);
        } catch (err) {
            skipped++;
            console.log(`  ⚠ ${url}  (not checked: ${err.message})`);
            return;
        }
        const actual = sri(body);
        if (actual === hash) {
            console.log(`  ✓ ${url}`);
        } else {
            failed++;
            console.error(`  ✗ ${url}\n      recorded ${hash}\n      served   ${actual}`);
        }
    }));
    if (failed) {
        console.error(`\n✗ verify:sri: ${failed} CDN file(s) do not match their recorded hash — browsers will refuse them.`);
        return 1;
    }
    if (skipped === recorded.size) {
        console.log('\n• verify:sri SKIPPED: the CDN was unreachable for every file.');
        return 0;
    }
    console.log(`\n✓ verify:sri: ${recorded.size - skipped} CDN file(s) match their recorded hash`);
    return 0;
}

module.exports = { urlsIn, recordedHashes, untar, renderBlock, readPartial };

if (require.main === module) {
    const mode = process.argv[2];
    const run = mode === '--update' ? update
        : mode === '--verify' ? verify
            : mode === '--check' ? async () => check()
                : null;
    if (!run) {
        console.error('usage: node scripts/cdn-integrity.js --check | --update | --verify');
        process.exitCode = 2;
    } else {
        // `process.exitCode` + natural exit, as in check-cdn-versions.js.
        run().then(
            (code) => { process.exitCode = code; },
            (err) => {
                console.error(`✗ cdn integrity: ${err && err.stack ? err.stack : err}`);
                process.exitCode = 1;
            }
        );
    }
}
