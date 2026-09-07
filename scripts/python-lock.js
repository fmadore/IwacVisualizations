#!/usr/bin/env node
/**
 * Check or regenerate the hashed Linux/Python 3.12 generator lock, and
 * assert the TEST dependencies agree with it.
 *
 * That second check exists because they drifted: `tests/python/
 * requirements.txt` pinned numpy 2.5.1 while the generators are held below
 * 2.5 by numba and the lock resolves 2.4.6 — so the unit tests ran on a numpy
 * the generators cannot use, which is the one configuration a test suite must
 * never be in. Nothing said so until Tier 8 / P11 read all three files.
 */
'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(__dirname, 'requirements.txt');
const LOCK = path.join(__dirname, 'requirements.lock');
const UV_VERSION = '0.12.1';
const HASH_PREFIX = '# requirements-input-sha256: ';

function inputHash() {
    return crypto.createHash('sha256').update(fs.readFileSync(INPUT)).digest('hex');
}

function check() {
    if (!fs.existsSync(LOCK)) {
        throw new Error('scripts/requirements.lock is missing; run `npm run lock:python`.');
    }
    const marker = fs.readFileSync(LOCK, 'utf8')
        .split(/\r?\n/)
        .find((line) => line.startsWith(HASH_PREFIX));
    if (!marker || marker.slice(HASH_PREFIX.length).trim() !== inputHash()) {
        throw new Error(
            'scripts/requirements.lock is stale for scripts/requirements.txt; ' +
            'run `npm run lock:python`.'
        );
    }
    checkTestDeps();
    console.log('✓ Python generator lock matches requirements.txt, tests agree');
}

/**
 * Every pin in `tests/python/requirements.txt` that the lock also names must
 * match it exactly. A test-only tool (pyflakes) is not in the lock and is
 * skipped rather than reported.
 */
function checkTestDeps() {
    const testFile = path.join(ROOT, 'tests', 'python', 'requirements.txt');
    if (!fs.existsSync(testFile)) return;
    const NEWLINE = /\r?\n/;
    const PIN = /^([A-Za-z0-9._-]+)==([^\s\\#]+)/;
    const norm = (name) => name.toLowerCase().replace(/[_.]+/g, '-');

    const locked = new Map();
    for (const line of fs.readFileSync(LOCK, 'utf8').split(NEWLINE)) {
        const m = PIN.exec(line);
        if (m) locked.set(norm(m[1]), m[2]);
    }
    const problems = [];
    for (const line of fs.readFileSync(testFile, 'utf8').split(NEWLINE)) {
        const m = PIN.exec(line.trim());
        if (!m) continue;
        // A test-only tool (pyflakes) is not in the generator lock.
        if (!locked.has(norm(m[1]))) continue;
        if (locked.get(norm(m[1])) !== m[2]) {
            problems.push(
                `${m[1]}: tests pin ${m[2]}, the generators resolve ${locked.get(norm(m[1]))}`
            );
        }
    }
    if (problems.length) {
        throw new Error(
            'tests/python/requirements.txt disagrees with scripts/requirements.lock:\n  '
            + problems.join('\n  ')
            + '\nThe unit tests must run on the versions the generators actually use.'
        );
    }
}


function update() {
    const executable = process.platform === 'win32' ? 'uvx.exe' : 'uvx';
    const result = spawnSync(executable, [
        '--from', `uv==${UV_VERSION}`,
        'uv', 'pip', 'compile',
        'scripts/requirements.txt',
        '--python-version', '3.12',
        '--python-platform', 'x86_64-unknown-linux-gnu',
        // uv reuses pins from an existing output file unless explicitly told
        // to upgrade. Resolve the newest compatible graph on every deliberate
        // lock refresh instead of carrying an obsolete transitive pin forward.
        '--upgrade',
        '--generate-hashes',
        '--output-file', 'scripts/requirements.lock',
    ], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
    if (result.error) {
        throw new Error(`Could not run ${executable}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }

    const generated = fs.readFileSync(LOCK, 'utf8');
    const lines = generated.split(/\r?\n/)
        .filter((line) => !line.startsWith(HASH_PREFIX));
    const insertAt = Math.min(2, lines.length);
    lines.splice(insertAt, 0, `${HASH_PREFIX}${inputHash()}`);
    fs.writeFileSync(LOCK, lines.join('\n'));
    check();
}

try {
    if (process.argv[2] === '--update') {
        update();
    } else if (!process.argv[2] || process.argv[2] === '--check') {
        check();
    } else {
        throw new Error('Usage: node scripts/python-lock.js [--check|--update]');
    }
} catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
}
