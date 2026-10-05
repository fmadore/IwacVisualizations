'use strict';
/**
 * Reading `asset/js/bundles.json` — the one place the load order lives.
 *
 * Three scripts parsed it three ways: the bundler read a block entry's own
 * `files`, the i18n guard expanded its `uses` panel sets as well, and the
 * registry guard only looked at the `blocks` keys. The entry has two shapes —
 * a plain list, or `{ uses: [panel sets], files: [...] }` — and every reader
 * had to remember both. These helpers are that memory.
 */

const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const MANIFEST_PATH = join(__dirname, '..', '..', 'asset', 'js', 'bundles.json');

/**
 * The parsed manifest. With `optional`, a missing file is `null` instead of
 * a throw (the registry guard reports that as a problem of its own).
 */
function loadManifest(path = MANIFEST_PATH, { optional = false } = {}) {
    if (optional && !existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
}

/** A bundle entry's OWN source list — what its dist file is built from. */
function ownFiles(entry) {
    if (Array.isArray(entry)) return entry.slice();
    return ((entry && entry.files) || []).slice();
}

/** The panel sets a block entry `uses` (always [] for a plain list). */
function usedPanelSets(entry) {
    if (Array.isArray(entry)) return [];
    return ((entry && entry.uses) || []).slice();
}

/**
 * Every source a page that loads `entry` executes for it: its own files,
 * then the files of each panel set it uses. (The shared bundles are not
 * included — they are loaded by `$needs`, not by the entry.)
 */
function bundleSources(manifest, entry) {
    const out = ownFiles(entry);
    for (const set of usedPanelSets(entry)) out.push(...((manifest.panels || {})[set] || []));
    return out;
}

module.exports = { MANIFEST_PATH, loadManifest, ownFiles, usedPanelSets, bundleSources };
