#!/usr/bin/env node
/**
 * Guard: the design record must describe the CSS that actually ships.
 *
 * WHY THIS EXISTS
 * ---------------
 * `.impeccable/design.json` and `DESIGN.md` carry colour literals — the five
 * `--iwac-vis-model-*` slot accents this module owns, and a mirror of every
 * theme token it consumes. `asset/css/iwac-core.css` carries the same
 * literals for the module-owned ones, `tokens.json` for the theme ones. Three
 * copies of a hex value with nothing tying them together is exactly the shape
 * that went stale before, and did: CLAUDE.md's own token guidance sat a full
 * redesign behind the code it described, telling authors to keep a font
 * family the design system had removed and naming two tokens as "phantom"
 * that were real, published and consumable.
 *
 * A design record that has drifted is worse than none, because it is read as
 * authoritative. So the record is either checked or it is prose (Tier 8 / D2).
 *
 * WHAT IS CHECKED
 * ---------------
 *  1. Module-owned colours — every `--iwac-vis-*` entry in `colorMeta` is
 *     declared in iwac-core.css with exactly its `canonical` value, its
 *     `token` field names that property, and its tonal ramp (when it has one)
 *     carries the canonical at the midpoint, which is the convention every
 *     ramp in the file follows.
 *  2. No orphans in either direction: a `--iwac-vis-model-*` declared in CSS
 *     with no record entry, or an entry naming a property the CSS does not
 *     declare, both fail.
 *  3. Theme mirror — every `theme/*` entry matches `tokens.json`, which is
 *     the synced copy and the machine-readable truth. This is the drift most
 *     likely to happen, because it happens when someone else changes the
 *     theme.
 *  4. DESIGN.md's prose agrees about how many slots there are.
 *
 * WHAT IS DELIBERATELY NOT CHECKED
 * --------------------------------
 * The prose itself — why slot 4 is a darkened cyan-leaning blue rather than
 * the model's own indigo, and the rest of the reasoning in DESIGN.md. That
 * is the part a record is FOR, and no lint can verify it. Tying the numbers
 * down is what buys the prose its credibility.
 *
 * Usage: node scripts/check-design-record.js
 */
'use strict';

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const RECORD = join(ROOT, '.impeccable', 'design.json');
const CORE_CSS = join(ROOT, 'asset', 'css', 'iwac-core.css');
const TOKENS = join(ROOT, 'tokens.json');
const DESIGN_MD = join(ROOT, 'DESIGN.md');

const problems = [];
const fail = (msg) => problems.push(msg);

if (!existsSync(RECORD)) {
    console.log('• design-record guard SKIPPED: .impeccable/design.json is not present');
    process.exit(0);
}

const record = JSON.parse(readFileSync(RECORD, 'utf8'));
const colorMeta = (record.extensions && record.extensions.colorMeta) || {};
if (!Object.keys(colorMeta).length) fail('.impeccable/design.json: extensions.colorMeta is empty');

/** Every custom property declared in iwac-core.css, as `name => value`. */
function declaredCustomProperties() {
    const out = new Map();
    const src = readFileSync(CORE_CSS, 'utf8');
    for (const line of src.split(/\r?\n/)) {
        // A declaration, not a `var()` reference: the property name has to
        // be the first thing on the line.
        const m = /^\s*(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/.exec(line);
        if (!m) continue;
        const value = m[2].replace(/\/\*.*$/, '').trim();
        if (!out.has(m[1])) out.set(m[1], value);
    }
    return out;
}

const css = declaredCustomProperties();
if (css.size === 0) fail('asset/css/iwac-core.css: no custom properties parsed — the reader is broken');

const norm = (hex) => String(hex || '').trim().toLowerCase();

// --- 1 + 2. Module-owned colours -------------------------------------------
const recordedModuleTokens = new Set();
for (const [key, meta] of Object.entries(colorMeta)) {
    const token = String(meta.token || '');
    if (!token.startsWith('--iwac-vis-')) continue;
    recordedModuleTokens.add(token);

    if (!css.has(token)) {
        fail(`design.json colorMeta["${key}"] names ${token}, which iwac-core.css does not declare`);
        continue;
    }
    const declared = norm(css.get(token));
    const canonical = norm(meta.canonical);
    if (declared !== canonical) {
        fail(
            `${token}: iwac-core.css declares ${declared}, `
            + `design.json colorMeta["${key}"].canonical says ${canonical}`
        );
    }
    const ramp = Array.isArray(meta.tonalRamp) ? meta.tonalRamp : [];
    if (ramp.length > 1) {
        const mid = Math.floor(ramp.length / 2);
        if (norm(ramp[mid]) !== canonical) {
            fail(
                `colorMeta["${key}"].tonalRamp[${mid}] is ${norm(ramp[mid])}, `
                + `not the canonical ${canonical} — the ramp no longer runs through its own colour`
            );
        }
    }
}

// The other direction: a slot added to the CSS and not to the record.
for (const name of css.keys()) {
    if (/^--iwac-vis-model-\d+$/.test(name) && !recordedModuleTokens.has(name)) {
        fail(`${name} is declared in iwac-core.css with no entry in design.json colorMeta`);
    }
}

// --- 3. Theme mirror --------------------------------------------------------
if (existsSync(TOKENS)) {
    const tokens = JSON.parse(readFileSync(TOKENS, 'utf8'));
    const light = tokens.light || {};
    let mirrored = 0;
    let unknown = 0;
    for (const [key, meta] of Object.entries(colorMeta)) {
        if (!key.startsWith('theme/')) continue;
        const token = String(meta.token || '');
        if (!(token in light)) {
            // A token the theme no longer publishes. Report it: the record
            // is claiming to mirror something that is gone.
            unknown += 1;
            fail(`design.json colorMeta["${key}"] mirrors ${token}, which tokens.json no longer publishes`);
            continue;
        }
        mirrored += 1;
        if (norm(light[token]) !== norm(meta.canonical)) {
            fail(
                `${token}: tokens.json (light) has ${norm(light[token])}, `
                + `design.json colorMeta["${key}"].canonical says ${norm(meta.canonical)}`
            );
        }
    }
    if (mirrored === 0 && unknown === 0) {
        fail('design.json records no theme tokens — the mirror check verified nothing');
    }
} else {
    fail('tokens.json is missing — the theme half of the record cannot be checked');
}

// --- 4. The prose agrees about the count -----------------------------------
if (existsSync(DESIGN_MD)) {
    const slots = [...css.keys()].filter((n) => /^--iwac-vis-model-\d+$/.test(n)).length;
    const prose = readFileSync(DESIGN_MD, 'utf8');
    const claimed = /--iwac-vis-model-1\.\.(\d+)/.exec(prose);
    if (!claimed) {
        fail('DESIGN.md no longer states the model-slot range as `--iwac-vis-model-1..N`');
    } else if (Number(claimed[1]) !== slots) {
        fail(
            `DESIGN.md says the module owns model slots 1..${claimed[1]}; `
            + `iwac-core.css declares ${slots}`
        );
    }
}

if (problems.length) {
    console.error(`\n✗ design-record guard: ${problems.length} disagreement(s)\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(
        '\n  .impeccable/design.json and DESIGN.md describe the shipped CSS.'
        + '\n  Update the record to match the code, or the code to match the'
        + '\n  record — but not neither.\n'
    );
    process.exit(1);
}

const moduleCount = recordedModuleTokens.size;
const themeCount = Object.keys(colorMeta).filter((k) => k.startsWith('theme/')).length;
console.log(
    `✓ design-record guard: ${moduleCount} module-owned colours match iwac-core.css, `
    + `${themeCount} mirrored theme tokens match tokens.json`
);
