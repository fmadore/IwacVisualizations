#!/usr/bin/env node
/**
 * ruff over the Python — the local half of the `Lint (PHP/Python)` workflow.
 *
 * Why this exists: `npm run lint` covered the JS/CSS side only, so a commit
 * touching a generator could pass everything runnable locally and still turn
 * CI red. That happened in v1.24.0 and again in v1.24.1 - two unused imports
 * in generate_keyness.py, exactly the class of thing this catches in a
 * second, found only after the push.
 *
 * WAS PYFLAKES, IS RUFF (Tier 8 / B2 (3)). Same standard: ruff.toml selects
 * `F` (ruff's pyflakes port) and `E9`, which is the previous gate rule for
 * rule - no file had to change to pass. What the swap buys is that ruff owns
 * its own file discovery, so the rule set, the exclusions and the
 * per-file-ignores live in a checked-in config both this script and CI read,
 * rather than in an argument list that has to be kept identical in two
 * places. The old invocation passed `scripts/` explicitly and had already
 * drifted once: it linted the generators and never `tests/python/`.
 *
 * pyflakes stays as a FALLBACK, not a second standard - a contributor whose
 * venv predates this change still gets the `F` rules rather than a skip. It
 * checks `scripts/` only, which is what it always did.
 *
 * Deliberately NON-FATAL when neither is installed. Wiring a hard Python
 * dependency into `npm run build` would break the JS-only workflow for anyone
 * without it, and a check nobody can run is worse than one that skips loudly.
 * CI installs ruff explicitly and enforces there, so a skip locally costs a
 * round trip at worst; a hard failure would cost every asset build.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname);
const ROOT = path.join(__dirname, '..');

/** Candidate interpreters, most-specific first. */
function candidates() {
    const list = [];
    // `$PYTHON` first: on Windows a bare `python` can be the Store shim,
    // which exits 9009 rather than running anything, and a machine with
    // several interpreters may have the data stack in only one of them. This
    // used to hard-code one contributor's absolute install path — harmless
    // for them, meaningless for anyone else, and silently skipped rather
    // than reported.
    if (process.env.PYTHON) list.push(process.env.PYTHON);
    // A project virtualenv, if there is one — `scripts/README.md` tells
    // contributors to create exactly this.
    list.push(
        path.join(ROOT, '.venv', 'Scripts', 'python.exe'),   // Windows
        path.join(ROOT, '.venv', 'bin', 'python')            // POSIX
    );
    list.push('python3', 'python', 'py');
    return list;
}

/**
 * Every .py under scripts/, RECURSIVELY — for the pyflakes fallback only.
 *
 * ruff finds its own files from ruff.toml. This list exists because pyflakes
 * does not: a flat readdir was correct only while every generator was one
 * top-level file, and since the laicite generator became a package (Tier 8 /
 * P4) it would check the 30-line CLI shim and skip the 2,400 lines behind it.
 * __pycache__ is skipped because .pyc is not .py.
 */
function pythonFiles(dir = SCRIPTS_DIR) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__pycache__' || entry.name.startsWith('.')) continue;
            out.push(...pythonFiles(full));
        } else if (entry.name.endsWith('.py')) {
            out.push(full);
        }
    }
    return out.sort();
}

/** Does `<exe> -m <mod> --version` work? */
function has(exe, mod) {
    const probe = spawnSync(exe, ['-m', mod, '--version'], { encoding: 'utf8' });
    return !probe.error && probe.status === 0;
}

function report(result, label, scope) {
    const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (result.status === 0) {
        console.log(`✓ ${label}: ${scope} clean`);
        return 0;
    }
    console.error(out || `${label} failed with no output`);
    console.error(
        `
✗ ${label}: see above. `
        + 'The same check runs in the Lint (PHP/Python) workflow.'
    );
    return 1;
}

function run() {
    const files = pythonFiles();
    if (files.length === 0) {
        console.log('✓ python lint: no Python files to check');
        return 0;
    }

    // ruff first, from the repo root so it reads ruff.toml and covers
    // tests/python/ as well as the generators.
    for (const exe of candidates()) {
        if (!has(exe, 'ruff')) continue;
        return report(
            spawnSync(exe, ['-m', 'ruff', 'check', '.'], { encoding: 'utf8', cwd: ROOT }),
            'ruff', 'every Python file under ruff.toml'
        );
    }

    // Fallback: an older venv. Same rules, narrower scope.
    for (const exe of candidates()) {
        if (!has(exe, 'pyflakes')) continue;
        console.log('• ruff not installed - falling back to pyflakes (same `F` rules).');
        return report(
            spawnSync(exe, ['-m', 'pyflakes', ...files], { encoding: 'utf8' }),
            'pyflakes', `${files.length} generator files`
        );
    }

    console.log(
        '• python lint SKIPPED: no interpreter with ruff or pyflakes found. '
        + 'Install it with `pip install ruff==0.16.6` to catch unused imports '
        + 'and undefined names before CI does.'
    );
    return 0;
}

process.exit(run());
