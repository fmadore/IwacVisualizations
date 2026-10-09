#!/usr/bin/env node
/**
 * Keep the release-version declarations in sync.
 *
 * Omeka uses config/module.ini for asset cache busting, npm exposes the
 * package.json version to maintainers, npm ci reads package-lock.json, and
 * two more places quote the version to humans: CITATION.cff (what the
 * "Cite this repository" button emits) and the README's citation line. The
 * lock file had silently remained on 1.28.0 while the module reached 1.30.0;
 * CITATION.cff sat on 1.54.0 and the README citation on 1.37.0 at 1.58.0.
 * This guard makes every one of those drifts a build failure.
 */
'use strict';

const { readFileSync } = require('fs');
const { join } = require('path');
const { fail } = require('./lib/report');

const ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const ini = readFileSync(join(ROOT, 'config', 'module.ini'), 'utf8');
const iniMatch = /^version\s*=\s*"([^"]+)"\s*$/m.exec(ini);
const cff = readFileSync(join(ROOT, 'CITATION.cff'), 'utf8');
const cffMatch = /^version:\s*"?([^"\s]+)"?\s*$/m.exec(cff);
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
// The citation paragraph under "## Citation": `*IWAC Visualizations* (version X.Y.Z)`.
const readmeMatch = /\*IWAC Visualizations\*\s*\(version\s+([^)\s]+)\)/.exec(readme);

const versions = {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages && lock.packages['']
        ? lock.packages[''].version
        : undefined,
    'config/module.ini': iniMatch ? iniMatch[1] : undefined,
    'CITATION.cff': cffMatch ? cffMatch[1] : undefined,
    'README.md citation': readmeMatch ? readmeMatch[1] : undefined,
};

const missing = Object.entries(versions).filter(([, value]) => !value);
const unique = new Set(Object.values(versions).filter(Boolean));

if (missing.length || unique.size !== 1) {
    fail(
        'version guard: release versions disagree',
        Object.entries(versions).map(([file, version]) => `${file}: ${version || '(missing)'}`),
        '\nBump all six declarations together.\n'
    );
}

// CITATION.cff's `date-released` is the date the cited version shipped, and
// nothing checked it: a release that bumped `version` and forgot the date
// told every citation the wrong day. The CHANGELOG heading of that version
// carries the date the release was written down with — `### vX.Y.Z — … (YYYY-MM-DD)`.
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const escaped = pkg.version.replace(/[.]/g, '\\.');
const heading = new RegExp('^### v' + escaped + ' .*\\((\\d{4}-\\d{2}-\\d{2})\\)\\s*$', 'm').exec(changelog);
const dateMatch = /^date-released:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m.exec(cff);
if (!heading || !dateMatch || heading[1] !== dateMatch[1]) {
    fail(
        'version guard: CITATION.cff date-released disagrees with the CHANGELOG',
        [
            `CITATION.cff date-released: ${dateMatch ? dateMatch[1] : '(missing)'}`,
            `CHANGELOG.md v${pkg.version}: ${heading ? heading[1] : '(no dated heading)'}`,
        ],
        '\nSet date-released to the day the release is cut.\n'
    );
}

console.log(`✓ version guard: ${pkg.version} in package, lock file, module.ini, CITATION.cff and the README citation; released ${dateMatch[1]}`);
