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

// libintl binary-searches the original-string table when a .mo carries no
// hash table, as this one does; an unsorted table quietly fails lookups.
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

if (missing.length || stale.length || different.length || problems.length) {
    console.error('\n✗ mo guard: language/fr.mo does not match language/fr.po\n');

    for (const problem of problems) console.error(`  ${problem}`);
    if (problems.length && (missing.length || stale.length || different.length)) console.error('');

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
