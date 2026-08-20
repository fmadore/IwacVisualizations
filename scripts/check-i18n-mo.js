#!/usr/bin/env node
/**
 * Prove language/fr.mo still says what language/fr.po says.
 *
 * Omeka loads the compiled .mo and never looks at the .po, and both files are
 * committed, so the pair can drift with nothing to notice. In v1.48.1 it had:
 * three msgids were reworded in fr.po and the .mo was never recompiled, so the
 * admin UI held French translations keyed to msgids the English source no
 * longer contained. Every one of them fell through to English — no warning, no
 * error, just untranslated block descriptions.
 *
 * Same spirit as check-theme-tokens.js and check-blocks.js: the source of
 * truth is the human-editable file, and the generated companion has to agree
 * with it or the build stops.
 *
 * The comparison is over parsed catalogues, not bytes, so a .mo compiled by
 * GNU msgfmt on another machine passes just as well as one from
 * `npm run build:mo`.
 */
'use strict';

const { readFileSync } = require('fs');
const { join } = require('path');

const { catalogueFromPo, charsetOf, describeKey, parseMo, parsePo } = require('./gettext');

const LANGUAGE = join(__dirname, '..', 'language');
const problems = [];

function die(message) {
    console.error(`\n✗ mo guard: ${message}\n`);
    process.exit(1);
}

let source;
let compiled;
try {
    source = catalogueFromPo(
        parsePo(readFileSync(join(LANGUAGE, 'fr.po'), 'utf8'), 'language/fr.po'),
        'language/fr.po'
    );
} catch (error) {
    die(error.message);
}
try {
    compiled = parseMo(readFileSync(join(LANGUAGE, 'fr.mo')), 'language/fr.mo');
} catch (error) {
    die(`${error.message}\n\n  Rebuild it with: npm run build:mo`);
}

const catalogue = new Map();
for (const { key, value } of compiled.entries) {
    if (catalogue.has(key)) problems.push(`duplicate key in fr.mo: ${describeKey(key)}`);
    catalogue.set(key, value);
}

// The format requires the original-string table to be sorted, and with no
// hash table — which is what this repo's .mo carries — a lookup is a binary
// search over it. An unsorted table returns misses, not errors.
for (let i = 1; i < compiled.entries.length; i++) {
    const previous = Buffer.from(compiled.entries[i - 1].key, 'utf8');
    const current = Buffer.from(compiled.entries[i].key, 'utf8');
    if (Buffer.compare(previous, current) >= 0) {
        problems.push(
            `fr.mo keys are not sorted at index ${i} (${describeKey(compiled.entries[i].key)}) — ` +
            'lookups binary-search this table'
        );
        break;
    }
}

for (const [label, header] of [['fr.po', source.get('')], ['fr.mo', catalogue.get('')]]) {
    if (header === undefined) {
        problems.push(`${label} has no catalogue header (the entry with an empty msgid)`);
        continue;
    }
    const charset = charsetOf(header);
    if (charset !== 'UTF-8') {
        problems.push(`${label} declares charset ${charset || '(none)'} — this codec assumes UTF-8`);
    }
}

const missing = [];
const stale = [];
const different = [];

for (const [key, value] of source) {
    if (!catalogue.has(key)) missing.push(key);
    else if (catalogue.get(key) !== value) different.push(key);
}
for (const key of catalogue.keys()) {
    if (!source.has(key)) stale.push(key);
}

/**
 * How much of two msgids is common head and common tail.
 *
 * An edit sits in the middle of an otherwise identical string, so prefix plus
 * suffix covers nearly all of a reworded pair and very little of an unrelated
 * one. `prefix` doubles as the offset of the edit.
 */
function similarity(a, b) {
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;

    let suffix = 0;
    const room = Math.min(a.length, b.length) - prefix;
    while (suffix < room && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;

    return { prefix, shared: prefix + suffix };
}

// A reworded msgid arrives as one missing key plus one dead one, and in this
// catalogue those are block descriptions that agree for their first three
// hundred characters — reported separately they are two indistinguishable
// walls of text. Pair them so the report shows the edit itself.
const reworded = [];
for (const key of [...missing]) {
    let best = null;
    for (const candidate of stale) {
        const { prefix, shared } = similarity(key, candidate);
        if (prefix < 24 || shared < Math.min(key.length, candidate.length) * 0.6) continue;
        if (!best || shared > best.shared) best = { candidate, prefix, shared };
    }
    if (!best) continue;
    reworded.push({ po: key, mo: best.candidate, at: best.prefix });
    missing.splice(missing.indexOf(key), 1);
    stale.splice(stale.indexOf(best.candidate), 1);
}

if (missing.length || stale.length || different.length || reworded.length || problems.length) {
    console.error('\n✗ mo guard: language/fr.mo does not match language/fr.po\n');

    const rest = missing.length || stale.length || different.length || reworded.length;
    for (const problem of problems) console.error(`  ${problem}`);
    if (problems.length && rest) console.error('');

    if (reworded.length) {
        console.error(`  reworded in fr.po, still the old wording in fr.mo (${reworded.length}):`);
        for (const { po, mo, at } of reworded) {
            const window = (text) => {
                const start = Math.max(0, at - 30);
                const end = at + 70;
                return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
            };
            console.error(`    fr.po: ${JSON.stringify(window(po))}`);
            console.error(`    fr.mo: ${JSON.stringify(window(mo))}`);
        }
        console.error('');
    }

    const report = (heading, keys, detail) => {
        if (!keys.length) return;
        console.error(`  ${heading} (${keys.length}):`);
        for (const key of keys.slice(0, 20)) {
            console.error(`    ${describeKey(key)}`);
            if (detail) console.error(detail(key));
        }
        if (keys.length > 20) console.error(`    … and ${keys.length - 20} more`);
        console.error('');
    };

    report('in fr.po but missing from fr.mo', missing);
    report(
        'in fr.mo but no longer in fr.po — these translations are dead',
        stale
    );
    const clip = (text) => JSON.stringify(text.length > 110 ? `${text.slice(0, 110)}…` : text);
    report('translated differently in the two files', different, (key) => (
        `      fr.po: ${clip(source.get(key))}\n` +
        `      fr.mo: ${clip(catalogue.get(key))}`
    ));

    console.error('  Omeka reads the .mo, so fr.po edits are invisible until it is recompiled.');
    console.error('  Fix: npm run build:mo\n');
    process.exit(1);
}

console.log(`✓ mo guard: ${source.size} entries, fr.mo matches fr.po`);
