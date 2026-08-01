#!/usr/bin/env node
/**
 * Keep the three release-version declarations in sync.
 *
 * Omeka uses config/module.ini for asset cache busting, npm exposes the
 * package.json version to maintainers, and npm ci reads package-lock.json.
 * The lock file had silently remained on 1.28.0 while the module reached
 * 1.30.0, so this guard makes that drift a build failure.
 */
'use strict';

const { readFileSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const ini = readFileSync(join(ROOT, 'config', 'module.ini'), 'utf8');
const iniMatch = /^version\s*=\s*"([^"]+)"\s*$/m.exec(ini);

const versions = {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages && lock.packages['']
        ? lock.packages[''].version
        : undefined,
    'config/module.ini': iniMatch ? iniMatch[1] : undefined,
};

const missing = Object.entries(versions).filter(([, value]) => !value);
const unique = new Set(Object.values(versions).filter(Boolean));

if (missing.length || unique.size !== 1) {
    console.error('\n✗ version guard: release versions disagree\n');
    for (const [file, version] of Object.entries(versions)) {
        console.error(`  ${file}: ${version || '(missing)'}`);
    }
    console.error('\nBump all four declarations together.\n');
    process.exit(1);
}

console.log(`✓ version guard: ${pkg.version} in package, lock file, and module.ini`);
