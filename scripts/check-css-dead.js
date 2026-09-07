#!/usr/bin/env node
/**
 * Guard: a class this module's CSS styles must be a class something builds.
 *
 * WHY THIS EXISTS
 * ---------------
 * A rule for a class nobody writes is invisible: it costs bytes on every page
 * that loads the sheet, it survives every refactor because nothing references
 * it, and it misleads the next reader into thinking a component exists. The
 * 2026-09-05 audit (C4) found four — `.iwac-vis-scary-details-list`,
 * `.iwac-vis-article__body`, `.iwac-vis-entity__body`,
 * `.iwac-vis-sent-axis__verdict--differ` — left behind by three different
 * renames.
 *
 * THE HARD PART, AND HOW IT IS HANDLED
 * ------------------------------------
 * Sixteen other unmatched names are NOT dead: they are composed at runtime,
 * `'iwac-vis-table__cell--' + (col.render || 'text')` and friends, so the
 * full class never appears in any source. A detector that reported those
 * would be noise, and a detector tuned to silence them by lowering its
 * standards would report nothing.
 *
 * So COMPOSED_PREFIXES is an allowlist of the stems a template literal or a
 * concatenation actually builds, each with the file that builds it. A class
 * starting with one of those is assumed live. Adding a prefix is a deliberate
 * act with a reason attached; the alternative — a blanket "ignore anything
 * with a modifier" — would have hidden all four real findings.
 *
 * Usage: node scripts/check-css-dead.js
 */
'use strict';

const { readdirSync, readFileSync, statSync } = require('fs');
const { join, relative } = require('path');

const ROOT = join(__dirname, '..');
const CSS_DIR = join(ROOT, 'asset', 'css');
const SEARCH_DIRS = [
    join(ROOT, 'asset', 'js'),
    join(ROOT, 'view'),
    join(ROOT, 'src'),
    join(ROOT, 'tests'),
];

/**
 * Class stems built by string concatenation or a template literal, so the
 * whole name is never written anywhere. Each entry names where.
 */
const COMPOSED_PREFIXES = [
    ['iwac-vis-table__cell--', 'shared/table.js — `--' + '${render}` and `--card-${role}`'],
    ['iwac-vis-table__row--', 'shared/table.js — row modifiers'],
    ['iwac-vis-clip-', 'shared/clippings.js — per-kind clipping chrome'],
    ['iwac-vis-panel--', 'shared/panels.js — panel size modifiers passed by callers'],
    ['iwac-vis-chart--', 'panel callers add height modifiers after buildPanel'],
    ['iwac-vis-facets__', 'shared/facet-buttons.js — composed button state classes'],
    ['iwac-vis-sent-', 'sentiment panels compose per-model and per-axis names'],
    ['iwac-vis-embed-', 'the embed layout composes body classes in PHP'],
    ['iwac-vis-otd-clippings__plate--r', 'on-this-day/clippings.js:47 — `--r${ratio}`'],
    ['iwac-vis-badge--', 'shared/table.js:227 — `--${value.toLowerCase()}`'],
];

function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch (e) { return out; }
    for (const name of entries) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else out.push(path);
    }
    return out;
}

/** Every `.iwac-vis-…` class a stylesheet declares, with where. */
function declaredClasses() {
    const found = new Map();
    for (const file of walk(CSS_DIR)) {
        if (!file.endsWith('.css') || file.endsWith('.min.css')) continue;
        const src = readFileSync(file, 'utf8');
        const lines = src.split(/\r?\n/);
        lines.forEach((line, i) => {
            // Selector lines only — a class inside a comment or a value is not
            // a declaration.
            if (line.trim().startsWith('*') || line.trim().startsWith('/*')) return;
            for (const m of line.matchAll(/\.(iwac-vis-[A-Za-z0-9_-]+)/g)) {
                if (!found.has(m[1])) {
                    found.set(m[1], `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}`);
                }
            }
        });
    }
    return found;
}

/** Everything the rest of the module says, as one haystack. */
function haystack() {
    let text = '';
    for (const dir of SEARCH_DIRS) {
        for (const file of walk(dir)) {
            if (/\.(js|phtml|php|json|html)$/.test(file) && !file.endsWith('.min.js')) {
                text += readFileSync(file, 'utf8') + '\n';
            }
        }
    }
    // The CSS itself does not count as a use — that is the whole question.
    return text;
}

const declared = declaredClasses();
const uses = haystack();
const dead = [];
for (const [cls, where] of declared) {
    if (uses.includes(cls)) continue;
    if (COMPOSED_PREFIXES.some(([prefix]) => cls.startsWith(prefix))) continue;
    dead.push({ cls, where });
}

if (dead.length) {
    console.error(`\n✗ dead-CSS guard: ${dead.length} class(es) styled but never built\n`);
    for (const { cls, where } of dead) console.error(`  .${cls}  (${where})`);
    console.error(
        '\n  Nothing in asset/js, view/, src/ or tests/ writes these class names.'
        + '\n  Delete the rule, or — if the name is composed at runtime — add its'
        + '\n  stem to COMPOSED_PREFIXES in this file, with the file that builds it.\n'
    );
    process.exit(1);
}

console.log(`✓ dead-CSS guard: ${declared.size} module classes, every one built somewhere`);
