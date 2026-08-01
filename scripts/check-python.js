#!/usr/bin/env node
/**
 * pyflakes over scripts/*.py — the local half of the `Lint (PHP/Python)`
 * workflow's `python` job.
 *
 * Why this exists: `npm run lint` covered the JS/CSS side only, so a commit
 * touching a generator could pass everything runnable locally and still turn
 * CI red. That happened in v1.24.0 and again in v1.24.1 — two unused imports
 * in generate_keyness.py, exactly the class of thing pyflakes catches in a
 * second, found only after the push.
 *
 * Deliberately NON-FATAL when pyflakes is missing. Wiring a hard Python
 * dependency into `npm run build` would break the JS-only workflow for anyone
 * without it, and a check nobody can run is worse than one that skips loudly.
 * CI installs pyflakes explicitly and enforces there, so a skip locally costs
 * a round trip at worst; a hard failure would cost every asset build.
 *
 * Mirrors the CI invocation exactly (`pyflakes scripts/*.py`) so a local pass
 * means a CI pass.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname);

/** Candidate interpreters, most-specific first. */
function candidates() {
    const list = [];
    if (process.env.PYTHON) list.push(process.env.PYTHON);
    // The x64 install is the one carrying the data stack on the maintainer's
    // machine; a bare `python` on Windows can be the Store shim, which exits
    // 9009 rather than running anything.
    list.push('C:/Users/frede/AppData/Local/Programs/Python/Python312/python.exe');
    list.push('python3', 'python', 'py');
    return list;
}

function pythonFiles() {
    return fs.readdirSync(SCRIPTS_DIR)
        .filter((f) => f.endsWith('.py'))
        .map((f) => path.join(SCRIPTS_DIR, f))
        .sort();
}

function run() {
    const files = pythonFiles();
    if (files.length === 0) {
        console.log('✓ python lint: no generators to check');
        return 0;
    }

    for (const exe of candidates()) {
        const probe = spawnSync(exe, ['-m', 'pyflakes', '--version'], {
            encoding: 'utf8',
        });
        if (probe.error || probe.status !== 0) continue;

        const result = spawnSync(exe, ['-m', 'pyflakes', ...files], {
            encoding: 'utf8',
        });
        const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
        if (result.status === 0) {
            console.log(`✓ pyflakes: ${files.length} generators clean`);
            return 0;
        }
        console.error(out || 'pyflakes failed with no output');
        console.error(
            `\n✗ pyflakes: ${files.length} generators checked, see above. ` +
            'Same check runs in the Lint (PHP/Python) workflow.'
        );
        return 1;
    }

    console.log(
        '• python lint SKIPPED: no interpreter with pyflakes found. ' +
        'Install it with `pip install pyflakes==3.4.0` to catch unused imports ' +
        'and undefined names before CI does.'
    );
    return 0;
}

process.exit(run());
