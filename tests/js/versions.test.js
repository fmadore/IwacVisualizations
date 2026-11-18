'use strict';

// The version list the writer (npm run bump) and the guard (check-versions)
// share, and the CHANGELOG promotion the bump performs.

const assert = require('node:assert/strict');
const test = require('node:test');

const { DECLARATIONS, readAll, readReleaseDate, versionHeading, promoteUnreleased } =
    require('../../scripts/lib/versions.js');

test('every version site is readable and agrees', () => {
    const all = readAll();
    assert.equal(all.length, 6);
    for (const { label, version } of all) assert.match(version || '', /^\d+\.\d+\.\d+$/, `${label} unreadable`);
    assert.equal(new Set(all.map((d) => d.version)).size, 1);
    assert.match(readReleaseDate() || '', /^\d{4}-\d{2}-\d{2}$/);
});

test('the bump writes every site npm does not', () => {
    const owned = DECLARATIONS.filter((d) => d.write).map((d) => d.label);
    assert.deepEqual(owned, ['config/module.ini', 'CITATION.cff', 'README.md citation']);
});

const LOG = [
    '# Changelog',
    '',
    '### Unreleased — maps in ink',
    '',
    '- **A change.** Body.',
    '',
    '### v2.3.1 — older (2026-11-18)',
    '',
    '- old',
    '',
].join('\n');

test('Unreleased becomes the dated version heading, title kept', () => {
    const { text, status } = promoteUnreleased(LOG, '2.4.0', '2026-12-01');
    assert.equal(status, 'promoted');
    assert.match(text, /^### v2\.4\.0 — maps in ink \(2026-12-01\)$/m);
    assert.doesNotMatch(text, /Unreleased/);
    assert.equal(versionHeading(text, '2.4.0')[1], '2026-12-01');
    assert.equal(versionHeading(text, '2.3.1')[1], '2026-11-18');
});

test('--title wins over the heading; a bare Unreleased gets no title', () => {
    assert.match(promoteUnreleased(LOG, '2.4.0', '2026-12-01', 'other').text, /^### v2\.4\.0 — other \(2026-12-01\)$/m);
    const bare = LOG.replace('### Unreleased — maps in ink', '### Unreleased');
    const { text } = promoteUnreleased(bare, '2.4.0', '2026-12-01');
    assert.match(text, /^### v2\.4\.0 \(2026-12-01\)$/m);
    assert.equal(versionHeading(text, '2.4.0')[1], '2026-12-01');
});

test('a re-run, an empty section and CRLF files are handled', () => {
    const once = promoteUnreleased(LOG, '2.4.0', '2026-12-01').text;
    assert.equal(promoteUnreleased(once, '2.4.0', '2026-12-02').status, 'present');
    const empty = '### Unreleased\n\n### v2.3.1 — older (2026-11-18)\n';
    assert.equal(promoteUnreleased(empty, '2.4.0', '2026-12-01').status, 'empty');
    assert.equal(promoteUnreleased('# Changelog\n', '2.4.0', '2026-12-01').status, 'empty');
    const crlf = promoteUnreleased(LOG.replace(/\n/g, '\r\n'), '2.4.0', '2026-12-01').text;
    assert.match(crlf, /### v2\.4\.0 — maps in ink \(2026-12-01\)\r\n/);
    assert.doesNotMatch(crlf.replace(/\r\n/g, ''), /\n/);
});
