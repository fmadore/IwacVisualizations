'use strict';
/**
 * The module's version declarations, in one place.
 *
 * Six sites carry the version: Omeka reads config/module.ini (and appends it
 * to every asset URL as the cache-buster), npm the manifest and both copies in
 * the lockfile, and two quote it to humans — CITATION.cff and the README's
 * citation line. Each has drifted while nobody was looking: the lock file sat
 * on 1.28.0 at 1.30.0, CITATION.cff on 1.54.0 and the README on 1.37.0 at
 * 1.58.0. Until 2.3.x they were also written by hand at every release.
 *
 * So the list is data, read by both sides: the writer (bump-version.js) and
 * the guard (check-versions.js). A seventh site is one entry here.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

/**
 * Replace exactly one match's first capture group, failing loudly when the
 * pattern no longer matches: a silent no-op is the failure this exists for.
 */
function substitute(file, pattern, value) {
    const before = read(file);
    let hits = 0;
    const after = before.replace(pattern, (match, captured) => {
        hits += 1;
        return match.replace(captured, value);
    });
    if (hits !== 1) throw new Error(`${file}: expected 1 match for ${pattern}, found ${hits}`);
    fs.writeFileSync(path.join(ROOT, file), after);
}

function readJsonPath(file, keys) {
    let node = JSON.parse(read(file));
    for (const key of keys) node = node?.[key];
    return typeof node === 'string' ? node : null;
}

const INI = /^version\s*=\s*"([^"]+)"\s*$/m;
const CFF = /^version:\s*"?([^"\s]+)"?\s*$/m;
// The citation paragraph under "## Citation": `*IWAC Visualizations* (version X.Y.Z)`.
const README = /\*IWAC Visualizations\*\s*\(version\s+([^)\s]+)\)/;
const CFF_DATE = /^date-released:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m;

// `write: null` marks a declaration npm owns: `npm version` keeps the
// lockfile's two copies in step with the manifest, without this script
// reformatting the lockfile to move two strings.
const DECLARATIONS = [
    { label: 'package.json', get: () => readJsonPath('package.json', ['version']), write: null },
    { label: 'package-lock.json', get: () => readJsonPath('package-lock.json', ['version']), write: null },
    { label: 'package-lock.json packages[""]', get: () => readJsonPath('package-lock.json', ['packages', '', 'version']), write: null },
    {
        label: 'config/module.ini',
        get: () => read('config/module.ini').match(INI)?.[1] ?? null,
        write: (version) => substitute('config/module.ini', INI, version),
    },
    {
        label: 'CITATION.cff',
        get: () => read('CITATION.cff').match(CFF)?.[1] ?? null,
        write: (version) => substitute('CITATION.cff', CFF, version),
    },
    {
        label: 'README.md citation',
        get: () => read('README.md').match(README)?.[1] ?? null,
        write: (version) => substitute('README.md', README, version),
    },
];

/** Every declaration's current value, in declaration order. */
function readAll() {
    return DECLARATIONS.map((d) => ({ label: d.label, version: d.get() }));
}

/** Write the declarations this module owns; npm writes the other three. */
function writeOwned(version) {
    return DECLARATIONS.filter((d) => d.write).map((d) => {
        d.write(version);
        return d.label;
    });
}

function readReleaseDate() {
    return read('CITATION.cff').match(CFF_DATE)?.[1] ?? null;
}

function writeReleaseDate(date) {
    substitute('CITATION.cff', CFF_DATE, date);
}

/** CHANGELOG.md's heading for a version: `### vX.Y.Z — title (YYYY-MM-DD)`. */
function versionHeading(text, version) {
    const escaped = version.replace(/\./g, '\\.');
    return new RegExp('^### v' + escaped + '(?: .*)?\\((\\d{4}-\\d{2}-\\d{2})\\)[ \\t]*\\r?$', 'm').exec(text);
}

/**
 * Turn CHANGELOG.md's `### Unreleased` (optionally `### Unreleased — title`)
 * into `### vX.Y.Z — title (date)`, the heading release.yml publishes from
 * (scripts/changelog-section.js) and check-versions.js dates the release by.
 *
 * Returns { text, status }: 'promoted'; 'present' when the version already
 * has a heading (a re-run, left alone); 'empty' when there is no Unreleased
 * heading or nothing under it (left alone: the notes have to be written).
 * Keeps the file's own line endings.
 */
function promoteUnreleased(text, version, date, title) {
    if (versionHeading(text, version)) return { text, status: 'present' };
    const heading = /^### Unreleased(?:[ \t]+—[ \t]+(.+?))?[ \t]*(\r?)$/m.exec(text);
    if (!heading) return { text, status: 'empty' };
    const rest = text.slice(heading.index + heading[0].length);
    const next = rest.search(/^#{2,3} /m);
    const body = next === -1 ? rest : rest.slice(0, next);
    if (!body.trim()) return { text, status: 'empty' };
    const name = (title || heading[1] || '').trim();
    const promoted = `### v${version}${name ? ` — ${name}` : ''} (${date})${heading[2]}`;
    return {
        text: text.slice(0, heading.index) + promoted + text.slice(heading.index + heading[0].length),
        status: 'promoted',
    };
}

module.exports = {
    ROOT,
    DECLARATIONS,
    readAll,
    writeOwned,
    readReleaseDate,
    writeReleaseDate,
    versionHeading,
    promoteUnreleased,
};
