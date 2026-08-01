#!/usr/bin/env node
/** Check or regenerate the hashed Linux/Python 3.12 generator lock. */
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
    console.log('✓ Python generator lock matches requirements.txt');
}

function update() {
    const executable = process.platform === 'win32' ? 'uvx.exe' : 'uvx';
    const result = spawnSync(executable, [
        '--from', `uv==${UV_VERSION}`,
        'uv', 'pip', 'compile',
        'scripts/requirements.txt',
        '--python-version', '3.12',
        '--python-platform', 'x86_64-unknown-linux-gnu',
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
