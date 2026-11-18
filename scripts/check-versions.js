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
 *
 * The sites are listed once, in scripts/lib/versions.js, which the writer
 * (`npm run bump`, scripts/bump-version.js) reads too.
 */
'use strict';

const { readFileSync } = require('fs');
const { join } = require('path');
const { fail } = require('./lib/report');
const { ROOT, readAll, readReleaseDate, versionHeading } = require('./lib/versions');

const all = readAll();
const missing = all.filter((d) => !d.version);
const unique = new Set(all.map((d) => d.version).filter(Boolean));

if (missing.length || unique.size !== 1) {
    fail(
        'version guard: release versions disagree',
        all.map((d) => `${d.label}: ${d.version || '(missing)'}`),
        `\nWrite all ${all.length} together: npm run bump -- <patch|minor|major|X.Y.Z>\n`
    );
}

// CITATION.cff's `date-released` is the date the cited version shipped, and
// nothing checked it: a release that bumped `version` and forgot the date
// told every citation the wrong day. The CHANGELOG heading of that version
// carries the date the release was written down with — `### vX.Y.Z — … (YYYY-MM-DD)`.
const version = all[0].version;
const heading = versionHeading(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
const released = readReleaseDate();
if (!heading || !released || heading[1] !== released) {
    fail(
        'version guard: CITATION.cff date-released disagrees with the CHANGELOG',
        [
            `CITATION.cff date-released: ${released || '(missing)'}`,
            `CHANGELOG.md v${version}: ${heading ? heading[1] : '(no dated heading)'}`,
        ],
        '\nSet date-released to the day the release is cut (npm run bump stamps it).\n'
    );
}

console.log(`✓ version guard: ${version} in package, lock file, module.ini, CITATION.cff and the README citation; released ${released}`);
