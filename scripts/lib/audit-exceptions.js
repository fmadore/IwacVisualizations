'use strict';

// Advisories `npm run check:audit` lets through at high or critical severity.
//
// An entry is an admission, not a fix: it has to say why no upgrade clears the
// advisory and why the vulnerable code cannot be reached. The check retires
// entries on its own — it fails as soon as npm can fix an excepted advisory
// in range, and as soon as one stops appearing — so this list cannot outlive
// its reason the way a hand-kept ignore list would.
//
// Keyed by the GitHub advisory id, the last segment of the advisory's URL.
// The check and this file's shape are IWAC-theme's (scripts/check-audit.js,
// scripts/lib/audit-exceptions.js), ported unchanged but for the entries.

module.exports = {
    'GHSA-vfj7-8cjw-p6xm': {
        package: 'braces',
        since: '2026-10-09',
        reason:
            'Stack exhaustion on deeply nested brace patterns. No braces release fixes it — 3.0.3 is the latest and ' +
            'is in range — and the one path to it is build tooling: micromatch under stylelint (17.16.0, the latest, ' +
            'still depends on it), and npm offers only a move to stylelint 7.7.0, ten majors back. The only patterns ' +
            'it expands are the globs `npm run lint:css` passes, written in package.json; nothing reaches it from a ' +
            'request, and none of it ships in the release archive (package.json and node_modules are not in it).',
    },
};
