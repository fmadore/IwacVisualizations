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
    console.error('\n✗ version guard: release versions disagree\n');
    for (const [file, version] of Object.entries(versions)) {
        console.error(`  ${file}: ${version || '(missing)'}`);
    }
    console.error('\nBump all six declarations together.\n');
    process.exit(1);
}

console.log(`✓ version guard: ${pkg.version} in package, lock file, module.ini, CITATION.cff and the README citation`);
