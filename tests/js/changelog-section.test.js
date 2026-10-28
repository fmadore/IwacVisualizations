'use strict';

// The release title and notes release.yml publishes (scripts/changelog-section.js).
//
// A release pushed as a bare tag used to get auto-generated notes and the tag
// as its only title; the entry written for it in CHANGELOG.md went unused.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const { changelogSection } = require('../../scripts/changelog-section.js');

const CHANGELOG = [
    '# Changelog',
    '',
    '### v1.10.0 — ten (2026-10-28)',
    '',
    '**Lead.** Body.',
    '',
    '- a point',
    '',
    '### v1.1.0 — one (2026-01-01)',
    '',
    'Older.',
    '',
    '## Before the changelog moved',
    '',
    'Archive.',
    '',
].join('\r\n');

test('an entry is its heading without the date, and the body up to the next entry', () => {
    assert.deepEqual(changelogSection(CHANGELOG, '1.10.0'), {
        title: 'v1.10.0 — ten',
        notes: '**Lead.** Body.\n\n- a point',
    });
});

test('a version does not match a longer one that starts with it', () => {
    assert.equal(changelogSection(CHANGELOG, '1.1.0').notes, 'Older.');
    assert.equal(changelogSection(CHANGELOG, '1.1'), null);
});

test('the last entry stops at a level-two heading', () => {
    assert.doesNotMatch(changelogSection(CHANGELOG, '1.1.0').notes, /Archive/);
});

test('the version in package.json has an entry with notes', () => {
    const root = join(__dirname, '..', '..');
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const entry = changelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
    assert.ok(entry && entry.notes, `CHANGELOG.md has no notes for v${version}`);
    assert.match(entry.title, new RegExp('^v' + version.replace(/\./g, '\\.') + ' — '));
});
