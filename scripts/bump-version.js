#!/usr/bin/env node
'use strict';
/**
 * Write every version declaration at once, stamp CITATION.cff's release date,
 * and turn CHANGELOG.md's `### Unreleased` into the dated heading for the new
 * version. The only supported way to bump the module.
 *
 *     npm run bump -- patch                       # 2.3.1 -> 2.3.2
 *     npm run bump -- minor --title "maps in ink" # 2.3.1 -> 2.4.0
 *     npm run bump -- 2.4.0 --date 2026-12-01
 *
 * The title comes from --title, else from `### Unreleased — title`, else the
 * heading has none. package.json and package-lock.json are handed to
 * `npm version`, which does the semver arithmetic and keeps the lockfile's two
 * copies in step; what it resolves is propagated to the other three sites.
 * The list of sites is scripts/lib/versions.js, shared with check-versions.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { ROOT, readAll, writeOwned, writeReleaseDate, promoteUnreleased } = require('./lib/versions');

/** Today, local time, as YYYY-MM-DD (not via the host's locale data). */
function today() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function option(args, name) {
    const at = args.indexOf(name);
    if (at === -1) return { value: undefined, rest: args };
    return { value: args[at + 1], rest: args.filter((_, i) => i !== at && i !== at + 1) };
}

let args = process.argv.slice(2);
const dateOpt = option(args, '--date');
args = dateOpt.rest;
const titleOpt = option(args, '--title');
args = titleOpt.rest;
const date = dateOpt.value || today();
const spec = args[0];

if (!spec) {
    console.error('usage: npm run bump -- <version|patch|minor|major> [--title "…"] [--date YYYY-MM-DD]');
    process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`--date must be an ISO date, got "${date}"`);
    process.exit(1);
}

/** Run the npm this process came from (npm_execpath), so the lockfile is written by the same npm. */
function npm(argv) {
    const execpath = process.env.npm_execpath;
    const result = execpath && execpath.endsWith('.js')
        ? spawnSync(process.execPath, [execpath, ...argv], { cwd: ROOT, stdio: 'inherit' })
        : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', argv,
            { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) process.exit(result.status || 1);
}

npm(['version', spec, '--no-git-tag-version', '--allow-same-version']);

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const written = writeOwned(version);
writeReleaseDate(date);

const changelogPath = path.join(ROOT, 'CHANGELOG.md');
const { text, status } = promoteUnreleased(fs.readFileSync(changelogPath, 'utf8'), version, date, titleOpt.value);
if (status === 'promoted') {
    fs.writeFileSync(changelogPath, text);
    written.push('CHANGELOG.md');
} else if (status === 'empty') {
    console.warn(`\n! CHANGELOG.md has no notes under "### Unreleased" and no heading for v${version}: `
        + 'check-versions and the release need one. Write the notes, then run the bump again.');
}

console.log(`\n✓ bumped to ${version}, released ${date}`);
for (const { label, version: value } of readAll()) {
    console.log(`  ${value === version ? '✓' : '✗'} ${label.padEnd(32)} ${value}`);
}
console.log(`\n  written here: ${written.join(', ')}; package.json and package-lock.json by npm version.`);
console.log(`  Next: npm run build && npm run lint && npm test && npx playwright test, then commit and git tag v${version}`);
