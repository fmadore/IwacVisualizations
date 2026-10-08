#!/usr/bin/env node
/**
 * Guard EVERY JavaScript translation dictionary: no duplicate keys, no
 * locale short of the other where the fallback cannot cover it, and no
 * per-block key that shadows a shared one.
 *
 * Duplicates: object-literal duplicates are legal JavaScript, and the later
 * value silently shadows the earlier one. Three divergent translations
 * shipped that way before the v1.23 audit found them. Parse the source
 * declarations (including \u escapes) so equivalent spellings such as a
 * literal character and its escape form are compared as the same runtime key.
 *
 * Parity: t() resolves `DICTIONARY[locale][key]`, then `DICTIONARY.en[key]`,
 * then the key itself. Two gaps in that chain are silent bugs:
 *
 *   - A French key with no English entry renders as the key. That is the
 *     design when the key IS the English source string ('Dashboard',
 *     'Loading dashboard') — but a snake_case key has no English in it, so
 *     English visitors would read `desc_publication_run` off the page.
 *   - An English key with no French entry falls through to the English value
 *     on the French site. No error, no missing text — just the wrong
 *     language, which is the hardest kind of gap to notice.
 *
 * WHAT IS CHECKED, AND WHY IT GREW (Tier 8 / S10)
 * -----------------------------------------------
 * This used to read `asset/js/iwac-i18n.js` and nothing else — about 55 % of
 * the module's strings. The other 45 % live in thirteen files that call
 * `ns.addTranslations('en'|'fr', {…})`: seven per-block `i18n.js` modules and
 * six inline blocks. Those could regrow exactly the failure this script was
 * written for, in the newest code, unwatched. Every dictionary is parsed the
 * same way now, paired per file, and a per-block key that shadows a shared
 * one is reported: `addTranslations` merges into the same object, so the
 * later loader wins and which one that is depends on bundle order.
 *
 * Neither parity gap is a live defect today; both are one careless edit away,
 * and the .po/.mo drift this repo actually had (see check-i18n-mo.js) is the
 * same shape — paired catalogues with nothing asserting they stay paired.
 *
 * THREE MORE RULES (2026-10)
 * --------------------------
 *   - No pre-formatted count: `t(key, { count: P.formatNumber(n) })` hands
 *     t() a STRING, so its plural selection (`one` / `other`) never sees the
 *     number and "1 articles" ships. Pass the number; t() formats it.
 *   - No identity `en` entry (`'Count': 'Count'`): a key that is already
 *     its English text needs no `en` entry — the fallback is the
 *     translation — and the copy is a second place to edit when the wording
 *     changes.
 *   - A shared key used by exactly one block belongs in that block's
 *     dictionary. iwac-i18n.js ships on every page; a string only one block
 *     reads is weight on all the others. "Used" is any string literal equal
 *     to the key in the bundle's sources (not only `t('…')` — a local map
 *     handed to t() counts too), so the rule under-reports rather than
 *     moving a key a shared file still reads.
 */
'use strict';

const { readFileSync } = require('fs');
const { join, relative } = require('path');
const vm = require('vm');
const { sourceFiles, walkFiles, posixRelative } = require('./lib/fs');
const { loadManifest, bundleSources } = require('./lib/manifest');
const { printFailure } = require('./lib/report');

const ROOT = join(__dirname, '..');
const JS_ROOT = join(ROOT, 'asset', 'js');
const SHARED = join(JS_ROOT, 'iwac-i18n.js');

/** Only a snake_case (or dotted) key is unreadable when it falls through to
 *  itself; a key that is already an English string ('Count', 'Loading
 *  dashboard') is exactly what an English visitor should see. */
const IDENTIFIER = /^[a-z0-9]+(?:[._][a-z0-9]+)+$/;

/** Every browser source under `dir` (the built `.min.js` files excluded). */
function walk(dir) {
    return sourceFiles(dir, '.js');
}

/** A quoted key literal, evaluated so '\u00e9' and 'é' compare equal. */
function parseKey(literal, where) {
    try {
        return vm.runInNewContext(literal, Object.create(null));
    } catch (err) {
        console.error(`✗ i18n guard: could not parse key at ${where}: ${err.message}`);
        process.exit(1);
    }
}

const KEY_LINE = /^\s*((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*"))\s*:/;

/** A whole one-line `'key': 'value',` declaration — value literal in group 2. */
const KEY_VALUE_LINE = /^\s*((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*"))\s*:\s*((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*"))\s*,?\s*(?:\/\/.*)?$/;

/**
 * `en` entries whose value is the key itself, found while a dictionary is
 * read: { file, key, line }.
 */
const identities = [];
function noteIdentity(file, locale, line, lineNo, where) {
    if (locale !== 'en') return;
    const m = KEY_VALUE_LINE.exec(line);
    if (!m) return;
    if (parseKey(m[1], where) === parseKey(m[2], where)) {
        identities.push({ file, key: parseKey(m[1], where), line: lineNo });
    }
}

/**
 * Read the shared dictionary's `en:` / `fr:` sections.
 * Returns { en: Map(key → line), fr: Map, duplicates: [] }.
 */
function readSharedDictionary() {
    const lines = readFileSync(SHARED, 'utf8').split(/\r?\n/);
    const seen = { en: new Map(), fr: new Map() };
    const duplicates = [];
    let locale = null;

    for (let i = 0; i < lines.length; i++) {
        const section = /^\s{8}(en|fr):\s*\{\s*$/.exec(lines[i]);
        if (section) { locale = section[1]; continue; }
        if (locale && /^\s{8}\},?\s*$/.test(lines[i])) { locale = null; continue; }
        if (!locale) continue;

        const declaration = /^\s{12}((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*"))\s*:/.exec(lines[i]);
        if (!declaration) continue;
        const key = parseKey(declaration[1], `${SHARED}:${i + 1}`);
        noteIdentity('asset/js/iwac-i18n.js', locale, lines[i], i + 1, `${SHARED}:${i + 1}`);
        if (seen[locale].has(key)) {
            duplicates.push({ file: 'asset/js/iwac-i18n.js', locale, key, first: seen[locale].get(key), again: i + 1 });
        } else {
            seen[locale].set(key, i + 1);
        }
    }
    return { seen, duplicates };
}

/**
 * Read every `ns.addTranslations('en'|'fr', { … })` block in a file.
 *
 * Brace-counted rather than regex-matched across the whole literal: the
 * values contain braces of their own ('{count} articles'), so only the
 * structure can be trusted, and only key lines are read out of it.
 */
function readAddTranslations(path) {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    const seen = { en: new Map(), fr: new Map() };
    const duplicates = [];
    const label = relative(ROOT, path).replace(/\\/g, '/');
    let locale = null;
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
        if (!locale) {
            const open = /addTranslations\(\s*'(en|fr)'\s*,\s*\{/.exec(lines[i]);
            if (open) { locale = open[1]; depth = 1; }
            continue;
        }
        // Track nesting on the raw line: a value may itself be an object.
        const opens = (lines[i].match(/\{/g) || []).length;
        const closes = (lines[i].match(/\}/g) || []).length;

        const declaration = KEY_LINE.exec(lines[i]);
        if (declaration && depth === 1) {
            const key = parseKey(declaration[1], `${label}:${i + 1}`);
            noteIdentity(label, locale, lines[i], i + 1, `${label}:${i + 1}`);
            if (seen[locale].has(key)) {
                duplicates.push({ file: label, locale, key, first: seen[locale].get(key), again: i + 1 });
            } else {
                seen[locale].set(key, i + 1);
            }
        }
        depth += opens - closes;
        if (depth <= 0) locale = null;
    }
    return { label, seen, duplicates };
}

const shared = readSharedDictionary();
if (!shared.seen.en.size || !shared.seen.fr.size) {
    console.error('✗ i18n guard: the en/fr dictionary sections parsed as empty');
    process.exit(1);
}

const blocks = walk(JS_ROOT)
    .filter((p) => p !== SHARED)
    .filter((p) => /addTranslations\s*\(/.test(readFileSync(p, 'utf8')))
    .map(readAddTranslations)
    .filter((d) => d.seen.en.size || d.seen.fr.size);

const duplicates = [...shared.duplicates, ...blocks.flatMap((b) => b.duplicates)];
if (duplicates.length) {
    printFailure(
        `i18n guard: ${duplicates.length} duplicate runtime key(s)`,
        duplicates.map((d) => `${d.file} ${d.locale}.${JSON.stringify(d.key)}: lines ${d.first} and ${d.again}`),
        '\nDelete one declaration; JavaScript otherwise keeps the later value silently.\n'
    );
    process.exit(1);
}

/**
 * Parity is checked on the MERGED dictionary, because that is what t()
 * resolves against: `addTranslations` merges into the same two objects, so a
 * block may legitimately declare an `en` entry and inherit its `fr` from the
 * shared file. Duplicates and shadowing, below, are structural and stay
 * per-file.
 */
const problems = [];
const merged = { en: new Map(shared.seen.en), fr: new Map(shared.seen.fr) };
const origin = { en: new Map(), fr: new Map() };
for (const block of blocks) {
    for (const locale of ['en', 'fr']) {
        for (const [key, line] of block.seen[locale]) {
            merged[locale].set(key, line);
            origin[locale].set(key, block.label);
        }
    }
}
const where = (locale, key) => origin[locale].get(key) || 'asset/js/iwac-i18n.js';

for (const [key, line] of merged.fr) {
    if (IDENTIFIER.test(key) && !merged.en.has(key)) {
        problems.push({
            kind: 'snake_case keys in fr with no en entry',
            label: where('fr', key), key, line,
            why: 'English visitors would see the raw key, because t() falls back to it.',
        });
    }
}
for (const [key, line] of merged.en) {
    if (!merged.fr.has(key)) {
        problems.push({
            kind: 'keys in en with no fr entry',
            label: where('en', key), key, line,
            why: 'French visitors get the English value — t() tries en before the key.',
        });
    }
}

/** Shadowing: addTranslations merges, so the later loader silently wins. */
for (const block of blocks) {
    for (const locale of ['en', 'fr']) {
        for (const [key, line] of block.seen[locale]) {
            if (shared.seen[locale].has(key)) {
                problems.push({
                    kind: 'per-block keys that shadow the shared dictionary',
                    label: block.label, key, line,
                    why: `also ${locale} in iwac-i18n.js line ${shared.seen[locale].get(key)} — `
                        + 'addTranslations merges, so which value wins depends on bundle order.',
                });
            }
        }
    }
}

/**
 * Reachability, per bundle.
 *
 * `addTranslations` merges at RUNTIME, so a per-block dictionary is only in
 * memory on a page that loaded that block's bundle. A key that moved out of
 * the shared file into the wrong block therefore renders as itself — silently,
 * and only on the pages that do not load the block it landed in. This walks
 * every `t('literal')` in every bundled source and asserts the key resolves
 * from the shared dictionary plus the dictionaries that bundle actually
 * carries. It is what makes moving a key out of the shared file a checkable
 * operation rather than a hopeful one (S24).
 *
 * Only STRING LITERALS are checked. Dozens of call sites pass a variable — a
 * local `TYPE_I18N[…]` map, a label off the data — and no static pass can
 * follow those; a key already reachable is not made unreachable by this rule.
 */
const bundles = loadManifest(join(JS_ROOT, 'bundles.json'));

/** A bundle entry's sources: its own files, then its panel sets'. */
function filesOf(spec) {
    return bundleSources(bundles, spec);
}

/** shared + every dictionary the given files declare. */
function reachableIn(files) {
    const keys = new Set(shared.seen.en.keys());
    for (const key of shared.seen.fr.keys()) keys.add(key);
    for (const block of blocks) {
        const rel = block.label.replace(/^asset\/js\//, '');
        if (!files.includes(rel)) continue;
        for (const key of block.seen.en.keys()) keys.add(key);
        for (const key of block.seen.fr.keys()) keys.add(key);
    }
    return keys;
}

const T_LITERAL = /\bt\(\s*'((?:\\.|[^'\\])*)'/g;
const unreachable = [];
for (const [group, entries] of Object.entries(bundles)) {
    if (group.startsWith('$') || group === 'panels') continue;
    for (const [name, spec] of Object.entries(entries)) {
        const files = filesOf(spec);
        // Every shared bundle is on every block page; a block bundle is not,
        // which is the whole point of the rule. `shared.core` is assumed
        // present because the partial always emits it.
        const all = group === 'shared'
            ? [...filesOf(bundles.shared.core), ...files]
            : [...filesOf(bundles.shared.core), ...files];
        const keys = reachableIn(all);
        for (const rel of files) {
            let source;
            try { source = readFileSync(join(JS_ROOT, rel), 'utf8'); } catch (e) { continue; }
            for (const m of source.matchAll(T_LITERAL)) {
                const key = m[1];
                // A key that IS its English source string resolves to itself,
                // which is exactly what an English reader should see.
                if (!IDENTIFIER.test(key)) continue;
                if (keys.has(key)) continue;
                unreachable.push({ bundle: `${group}.${name}`, file: rel, key });
            }
        }
    }
}

if (unreachable.length) {
    console.error('\n\u2717 i18n guard: key(s) a bundle uses but cannot reach\n');
    const seenPair = new Set();
    for (const row of unreachable) {
        const id = row.bundle + ' ' + row.key;
        if (seenPair.has(id)) continue;
        seenPair.add(id);
        console.error(`  ${row.bundle}: ${JSON.stringify(row.key)} (${row.file})`);
    }
    console.error(
        '\n  addTranslations merges at runtime, so a per-block dictionary only'
        + '\n  exists on a page that loaded that block. Move the key into a'
        + '\n  dictionary this bundle carries, or back into iwac-i18n.js.\n'
    );
    process.exit(1);
}

/* ---------------------------------------------------------------------- */
/*  Rule: no pre-formatted count                                          */
/* ---------------------------------------------------------------------- */

const PREFORMATTED_COUNT = /\bcount\s*:\s*(?:P\.|ns\.)?(?:formatNumber|fmt)\s*\(/;
for (const path of walk(JS_ROOT)) {
    const label = posixRelative(ROOT, path);
    readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        const m = PREFORMATTED_COUNT.exec(line);
        if (!m) return;
        problems.push({
            kind: 'counts formatted before t() sees them',
            label, line: i + 1, key: trimmed,
            why: 'a formatted string disables plural selection ("1 articles"); pass the '
                + 'number as `count` — t() formats it.',
        });
    });
}

/* ---------------------------------------------------------------------- */
/*  Rule: numbers go through the module's one formatter                   */
/* ---------------------------------------------------------------------- */

// `toFixed()` writes the English decimal point and `+ '%'` the English
// percent on the French site, and neither applies the U+202F grouping rule
// the theme, IwacSearch and this module share (iwac-i18n.js). Display code
// calls P.formatNumber / formatDecimal / formatPercent / formatCompact.
// A '%' glued to a CSS length (`style.width = x + '%'`, an ECharts `left`
// or `radius`, a gradient stop) is layout, not text, and is let through by
// what the line assigns to. A line that must keep either form says why with
// `// allow-number-format: <reason>`.
const NUMBER_FORMAT_EXEMPT = new Set([posixRelative(ROOT, SHARED)]);
const TO_FIXED = /\.toFixed\s*\(/;
const PERCENT_GLUE = /\+\s*['"]\s?%/;
const CSS_CONTEXT = /\b(?:style\.|setProperty|width|height|left|right|top|bottom|radius|center|offset|stop\.color|position|margin|padding|flex|basis)\b/;
for (const path of walk(JS_ROOT)) {
    const label = posixRelative(ROOT, path);
    if (NUMBER_FORMAT_EXEMPT.has(label)) continue;
    readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (/allow-number-format:/.test(line)) return;
        const code = line.replace(/\/\/.*$/, '');
        let why = null;
        if (TO_FIXED.test(code)) {
            why = 'toFixed() prints the English decimal point on the French site — use '
                + 'P.formatDecimal / P.formatNumber (iwac-i18n.js).';
        } else if (PERCENT_GLUE.test(code) && !CSS_CONTEXT.test(code)) {
            why = "a bare '%' is the English percent on the French site — use P.formatPercent "
                + '(or C._percentTick for an axis).';
        }
        if (!why) return;
        problems.push({ kind: 'numbers formatted by hand', label, line: i + 1, key: trimmed, why });
    });
}

/* ---------------------------------------------------------------------- */
/*  Rule: no identity en entry                                            */
/* ---------------------------------------------------------------------- */

for (const { file, key, line } of identities) {
    problems.push({
        kind: 'en entries identical to their key',
        label: file, key, line,
        why: 'the key IS the English text, so t() already falls back to it — delete the en entry.',
    });
}

/* ---------------------------------------------------------------------- */
/*  Rule: a shared key one block uses belongs in that block                */
/* ---------------------------------------------------------------------- */

/** The decoded value of a JS string literal body (no vm: thousands of them). */
function unescapeLiteral(body) {
    return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, esc) => {
        if (esc[0] === 'u' && esc[1] === '{') return String.fromCodePoint(parseInt(esc.slice(2, -1), 16));
        if (esc[0] === 'u' && esc.length === 5) return String.fromCharCode(parseInt(esc.slice(1), 16));
        if (esc[0] === 'x' && esc.length === 3) return String.fromCharCode(parseInt(esc.slice(1), 16));
        return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[esc] ?? esc;
    });
}

const STRING_LITERAL = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"/g;
const literalCache = new Map();
/** Every string literal value in one file, as a Set. */
function literalsOf(absPath) {
    if (!literalCache.has(absPath)) {
        const found = new Set();
        let source = '';
        try { source = readFileSync(absPath, 'utf8'); } catch (e) { /* missing: no uses */ }
        for (const m of source.matchAll(STRING_LITERAL)) {
            found.add(unescapeLiteral(m[1] !== undefined ? m[1] : m[2]));
        }
        literalCache.set(absPath, found);
    }
    return literalCache.get(absPath);
}

const sharedKeys = new Set([...shared.seen.en.keys(), ...shared.seen.fr.keys()]);
const usedByShared = new Set();
const usedByBlock = new Map(); // key -> Set of block bundle names
for (const [group, entries] of Object.entries(bundles)) {
    if (group.startsWith('$') || group === 'panels') continue;
    for (const [name, spec] of Object.entries(entries)) {
        for (const rel of filesOf(spec)) {
            const abs = join(JS_ROOT, rel);
            if (abs === SHARED) continue; // the dictionary declares, it does not use
            for (const value of literalsOf(abs)) {
                if (!sharedKeys.has(value)) continue;
                if (group === 'shared') usedByShared.add(value);
                else {
                    if (!usedByBlock.has(value)) usedByBlock.set(value, new Set());
                    usedByBlock.get(value).add(name);
                }
            }
        }
    }
}
// Templates and PHP may hand a key to the client (a data attribute, an inline
// script): a literal there keeps the key shared.
const usedByPhp = new Set();
for (const dir of [join(ROOT, 'view'), join(ROOT, 'src')]) {
    for (const path of walkFiles(dir, { tolerant: true, include: (p) => /\.(php|phtml)$/.test(p) })) {
        for (const value of literalsOf(path)) if (sharedKeys.has(value)) usedByPhp.add(value);
    }
}
for (const key of sharedKeys) {
    const users = usedByBlock.get(key);
    if (!users || users.size !== 1 || usedByShared.has(key) || usedByPhp.has(key)) continue;
    const block = [...users][0];
    problems.push({
        kind: 'shared keys only one block uses',
        label: 'asset/js/iwac-i18n.js',
        key,
        line: shared.seen.en.get(key) || shared.seen.fr.get(key),
        why: `only blocks.${block} reads it — move it into that block's dictionary `
            + '(the shared file ships on every page).',
    });
}

if (problems.length) {
    console.error('\n✗ i18n guard: the dictionaries have drifted apart\n');
    const kinds = [...new Set(problems.map((p) => p.kind))];
    for (const kind of kinds) {
        const rows = problems.filter((p) => p.kind === kind);
        console.error(`  ${kind} (${rows.length}):`);
        for (const row of rows.slice(0, 20)) {
            console.error(`    ${row.label}:${row.line}  ${JSON.stringify(row.key)}`);
            console.error(`      → ${row.why}`);
        }
        if (rows.length > 20) console.error(`    … and ${rows.length - 20} more`);
        console.error('');
    }
    process.exit(1);
}

console.log(
    `✓ i18n guard: ${merged.en.size} English + ${merged.fr.size} French keys across `
    + `${blocks.length + 1} dictionaries, no duplicates, no unreachable fallbacks, `
    + 'no shadowing, no identity en entries, no pre-formatted counts, no hand-formatted numbers, '
    + 'no single-block keys in the shared file'
);
