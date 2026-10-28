#!/usr/bin/env node
'use strict';

/**
 * One version's entry in CHANGELOG.md, for the GitHub release.
 *
 *   node scripts/changelog-section.js <version>           print its notes
 *   node scripts/changelog-section.js <version> --title   print its title
 *
 * An entry is `### vX.Y.Z — title (YYYY-MM-DD)` and everything up to the next
 * `### v` or `## ` heading. The title is the heading without its date
 * ("v1.89.0 — one CDN library fewer"), the descriptive release title this
 * repository has always given its releases by hand; release.yml now takes it,
 * and the notes, from here when the tag is pushed with no release in place.
 * Exit code 1 when the version has no entry, or an empty one.
 *
 * Same job as DRE Visualizations' scripts/changelog-section.mjs, for this
 * repository's heading format.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `{ title, notes }` for `### v<version> …`, or null when there is none. */
function changelogSection(text, version) {
    const source = text.replace(/\r\n/g, '\n');
    const heading = new RegExp('^### (v' + escape(version) + '(?= |$)[^\\n]*)\\n', 'm').exec(source);
    if (!heading) return null;
    const rest = source.slice(heading.index + heading[0].length);
    const end = rest.search(/^### v|^## /m);
    return {
        title: heading[1].replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '').trim(),
        notes: (end === -1 ? rest : rest.slice(0, end)).replace(/<!--[\s\S]*?-->/g, '').trim(),
    };
}

module.exports = { changelogSection };

if (require.main === module) {
    const version = (process.argv[2] || '').replace(/^v/, '');
    if (!version) {
        console.error('Usage: node scripts/changelog-section.js <version> [--title]');
        process.exit(2);
    }
    const entry = changelogSection(readFileSync(join(__dirname, '..', 'CHANGELOG.md'), 'utf8'), version);
    if (!entry || !entry.notes) {
        console.error(`CHANGELOG.md has no notes for v${version}.`);
        process.exit(1);
    }
    process.stdout.write((process.argv.includes('--title') ? entry.title : entry.notes) + '\n');
}
