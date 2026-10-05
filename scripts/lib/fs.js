'use strict';
/**
 * File-system helpers the build and guard scripts share.
 *
 * Eight scripts each carried their own recursive directory walk, and they had
 * drifted in four small ways — which extensions count, whether a `.min.*`
 * sibling is skipped, whether an unreadable directory throws, whether the
 * order is sorted — that are now options here rather than copies. Each
 * caller keeps the behaviour it had; only the walk itself is shared.
 *
 * `readText` folds CRLF to LF. This repository has no `.gitattributes`, so a
 * Windows checkout with `core.autocrlf=true` hands the scripts `\r\n`: the
 * registry guard's row pattern (anchored on `\n`) then found zero rows, the
 * Python lock hashed different bytes than CI, and the tree guard compared a
 * CRLF file with the LF block it generates — three ways for a clean tree to
 * fail locally. Read text through here and the line ending stops mattering.
 */

const { readdirSync, readFileSync, statSync } = require('fs');
const { join, relative } = require('path');

/**
 * Every file under `dir`, recursively, as absolute paths in walk order.
 *
 * @param {string} dir
 * @param {object} [opts]
 * @param {(path: string, name: string) => boolean} [opts.include]  keep this file?
 * @param {(path: string, name: string) => boolean} [opts.skipDir]  do not descend?
 * @param {boolean} [opts.sort=false]      sort each directory's entries first
 * @param {boolean} [opts.tolerant=false]  an unreadable directory yields nothing
 *                                         instead of throwing
 * @returns {string[]}
 */
function walkFiles(dir, opts = {}) {
    const include = opts.include || (() => true);
    const skipDir = opts.skipDir || (() => false);
    const out = [];
    (function visit(current) {
        let names;
        try {
            names = readdirSync(current);
        } catch (err) {
            if (opts.tolerant) return;
            throw err;
        }
        if (opts.sort) names = names.slice().sort();
        for (const name of names) {
            const path = join(current, name);
            if (statSync(path).isDirectory()) {
                if (!skipDir(path, name)) visit(path);
            } else if (include(path, name)) {
                out.push(path);
            }
        }
    })(dir);
    return out;
}

const MINIFIED = /\.min\.[a-z]+$/;

/**
 * Source files under `dir` with one of `exts` — never a built `.min.*`
 * sibling, which is generated from the source beside it.
 *
 * @param {string} dir
 * @param {string|string[]} exts   e.g. '.js' or ['.css', '.phtml']
 * @param {object} [opts]          as walkFiles (minus `include`)
 * @returns {string[]}
 */
function sourceFiles(dir, exts, opts = {}) {
    const list = [].concat(exts);
    return walkFiles(dir, {
        ...opts,
        include: (path) => list.some((ext) => path.endsWith(ext)) && !MINIFIED.test(path),
    });
}

/** A text file with every CRLF folded to LF (see the header). */
function readText(path) {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

/** `path` relative to `from`, with forward slashes on every platform. */
function posixRelative(from, path) {
    return relative(from, path).split('\\').join('/');
}

module.exports = { walkFiles, sourceFiles, readText, posixRelative };
