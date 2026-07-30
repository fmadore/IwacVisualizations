#!/usr/bin/env node
/**
 * Upgrade signal for the pinned CDN libraries in `view/common/iwac-assets.phtml`.
 *
 * Why this exists: the libraries that actually reach visitors' browsers —
 * ECharts, echarts-wordcloud, MapLibre GL, the four d3 modules — are not npm
 * dependencies. They are jsDelivr URLs written as PHP string constants, so
 * Dependabot cannot see them at all (`.github/dependabot.yml` covers only the
 * workflow actions). Before v1.22 those URLs carried floating major tags and
 * upgraded themselves: ECharts 6.1.0 landed on the live site on 2026-05-19
 * with no test pass. Pinning exact versions fixed the silent upgrade and
 * traded it for the opposite problem — zero signal that anything moved.
 *
 * This closes that loop: parse the pins out of the partial, ask the npm
 * registry what `latest` is, and report the drift.
 *
 * NON-FATAL when the registry is unreachable — an offline machine or a
 * registry hiccup must not turn the build red over an advisory check (same
 * principle as check-python.js). Two things ARE fatal, because both are
 * repo bugs rather than drift:
 *
 *   - the same package pinned at two different versions (maplibre-gl appears
 *     twice, once for the JS and once for the CSS — bumping one and forgetting
 *     the other ships a mismatched pair)
 *   - no pins found at all, which means the partial was restructured and this
 *     check has silently stopped checking anything
 *
 * Usage:
 *   node scripts/check-cdn-versions.js              # exit 1 if anything is behind
 *   node scripts/check-cdn-versions.js --warn-only  # report only, always exit 0
 *
 * Deliberately NOT part of `npm run lint` / `npm run build`: those must stay
 * offline-capable and instant. It runs from the `CDN versions` workflow —
 * monthly on a schedule, and on pull requests that touch the partial.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PARTIAL = path.join(__dirname, '..', 'view', 'common', 'iwac-assets.phtml');
const PARTIAL_REL = 'view/common/iwac-assets.phtml';
const REGISTRY = 'https://registry.npmjs.org';
const TIMEOUT_MS = 10000;

const warnOnly = process.argv.includes('--warn-only');
const inActions = process.env.GITHUB_ACTIONS === 'true';

/**
 * Every `cdn.jsdelivr.net/npm/<pkg>@<version>/…` pin in the partial, keyed by
 * package. Handles scoped names (`@scope/pkg@1.2.3`) even though none are in
 * use today. Records every line a package appears on so a mismatch can point
 * at both.
 */
function readPins(source) {
    const re = /cdn\.jsdelivr\.net\/npm\/(@?[^@/\s]+(?:\/[^@/\s]+)?)@(\d[^/\s'"]*)\//g;
    const lines = source.split('\n');
    const pins = new Map();

    lines.forEach((text, i) => {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) {
            const [, pkg, version] = m;
            if (!pins.has(pkg)) pins.set(pkg, { pkg, versions: new Map() });
            const entry = pins.get(pkg).versions;
            if (!entry.has(version)) entry.set(version, []);
            entry.get(version).push(i + 1);
        }
    });

    return [...pins.values()];
}

function splitVersion(v) {
    const dash = v.indexOf('-');
    const core = dash === -1 ? v : v.slice(0, dash);
    const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return { parts, prerelease: dash === -1 ? '' : v.slice(dash + 1) };
}

/** -1 / 0 / 1 on the numeric core only; prerelease tags are reported, not ranked. */
function compareVersions(a, b) {
    const av = splitVersion(a).parts;
    const bv = splitVersion(b).parts;
    for (let i = 0; i < 3; i++) {
        if (av[i] !== bv[i]) return av[i] < bv[i] ? -1 : 1;
    }
    return 0;
}

function driftLevel(pinned, latest) {
    const a = splitVersion(pinned).parts;
    const b = splitVersion(latest).parts;
    if (a[0] !== b[0]) return 'major';
    if (a[1] !== b[1]) return 'minor';
    return 'patch';
}

async function fetchLatest(pkg) {
    const url = `${REGISTRY}/${pkg.replace('/', '%2f')}/latest`;
    // Explicit controller + cleared timer rather than AbortSignal.timeout():
    // that helper leaves its timer live for the full TIMEOUT_MS after the fetch
    // resolves, and tearing it down under process.exit() trips a libuv
    // assertion on Windows (`UV_HANDLE_CLOSING`, async.c:94) — the script
    // returned 127 instead of its real exit code.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`registry responded ${res.status}`);
        const body = await res.json();
        if (!body || typeof body.version !== 'string') {
            throw new Error('registry response had no version');
        }
        return body.version;
    } catch (err) {
        if (err && err.name === 'AbortError') {
            throw new Error(`registry timed out after ${TIMEOUT_MS} ms`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function annotate(level, message, line) {
    if (!inActions) return;
    const where = line ? ` file=${PARTIAL_REL},line=${line}` : '';
    console.log(`::${level}${where}::${message}`);
}

function writeSummary(rows, skipped) {
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (!file) return;
    const lines = [
        '## Pinned CDN libraries',
        '',
        '| Package | Pinned | Latest | Status |',
        '| --- | --- | --- | --- |',
    ];
    for (const r of rows) {
        const status = r.behind ? `⬆ ${r.level} available` : '✓ current';
        lines.push(`| \`${r.pkg}\` | ${r.pinned} | ${r.latest} | ${status} |`);
    }
    for (const s of skipped) {
        lines.push(`| \`${s.pkg}\` | ${s.pinned} | — | ⚠ ${s.reason} |`);
    }
    lines.push('', `Pins live in \`${PARTIAL_REL}\`.`, '');
    try {
        fs.appendFileSync(file, lines.join('\n'), 'utf8');
    } catch {
        /* summary is a nicety; never fail the check over it */
    }
}

async function run() {
    if (!fs.existsSync(PARTIAL)) {
        console.error(`✗ cdn versions: ${PARTIAL_REL} not found`);
        return 1;
    }

    const pins = readPins(fs.readFileSync(PARTIAL, 'utf8'));

    if (pins.length === 0) {
        console.error(
            `✗ cdn versions: no jsDelivr pins found in ${PARTIAL_REL}. ` +
            'The partial was restructured and this check is no longer checking ' +
            'anything — update the parser in scripts/check-cdn-versions.js.'
        );
        return 1;
    }

    // Fatal, and fatal even under --warn-only: this is a shipped bug, not drift.
    let mismatched = false;
    for (const { pkg, versions } of pins) {
        if (versions.size < 2) continue;
        mismatched = true;
        const detail = [...versions.entries()]
            .map(([v, lines]) => `${v} (line${lines.length > 1 ? 's' : ''} ${lines.join(', ')})`)
            .join(' vs ');
        const message =
            `${pkg} is pinned at two different versions: ${detail}. ` +
            'Every URL for one package must carry the same version.';
        console.error(`✗ ${message}`);
        annotate('error', message, [...versions.values()][0][0]);
    }
    if (mismatched) return 1;

    const results = await Promise.all(pins.map(async ({ pkg, versions }) => {
        const [pinned, lines] = [...versions.entries()][0];
        try {
            const latest = await fetchLatest(pkg);
            return { pkg, pinned, latest, line: lines[0] };
        } catch (err) {
            return { pkg, pinned, line: lines[0], error: err.message };
        }
    }));

    const skipped = results
        .filter((r) => r.error)
        .map((r) => ({ pkg: r.pkg, pinned: r.pinned, reason: r.error }));

    const checked = results
        .filter((r) => !r.error)
        .map((r) => {
            const behind = compareVersions(r.pinned, r.latest) < 0;
            return { ...r, behind, level: behind ? driftLevel(r.pinned, r.latest) : null };
        })
        .sort((a, b) => a.pkg.localeCompare(b.pkg));

    const width = Math.max(...results.map((r) => r.pkg.length));
    for (const r of checked) {
        const label = r.pkg.padEnd(width);
        if (r.behind) {
            console.log(`  ⬆ ${label}  ${r.pinned} → ${r.latest}  (${r.level})`);
        } else {
            console.log(`  ✓ ${label}  ${r.pinned}`);
        }
    }
    for (const s of skipped) {
        console.log(`  ⚠ ${s.pkg.padEnd(width)}  ${s.pinned}  (not checked: ${s.reason})`);
    }

    writeSummary(checked, skipped);

    const behind = checked.filter((r) => r.behind);

    if (skipped.length === results.length) {
        console.log(
            '\n• cdn versions SKIPPED: the npm registry was unreachable for every ' +
            'package. Advisory check — not failing the build.'
        );
        return 0;
    }

    if (behind.length === 0) {
        console.log(`\n✓ cdn versions: all ${checked.length} pinned libraries are current`);
        return 0;
    }

    for (const r of behind) {
        annotate(
            'warning',
            `${r.pkg} ${r.pinned} → ${r.latest} (${r.level}) is available.`,
            r.line
        );
    }

    const summary =
        `${behind.length} of ${checked.length} pinned CDN libraries are behind: ` +
        behind.map((r) => `${r.pkg} ${r.pinned} → ${r.latest}`).join(', ');

    if (warnOnly) {
        console.log(`\n• ${summary}`);
        return 0;
    }

    console.error(
        `\n✗ ${summary}.\n` +
        `  Bump the constants at the top of ${PARTIAL_REL}, then verify the blocks ` +
        'render in both themes before committing — these pins are exact precisely ' +
        'so the upgrade is deliberate.'
    );
    return 1;
}

// `process.exitCode` + natural exit, never `process.exit()`: this script holds
// open sockets and timers, and force-exiting out from under them is what
// produced the libuv assertion described in fetchLatest().
run().then(
    (code) => { process.exitCode = code; },
    (err) => {
        console.error(`✗ cdn versions: ${err && err.stack ? err.stack : err}`);
        process.exitCode = 1;
    }
);
