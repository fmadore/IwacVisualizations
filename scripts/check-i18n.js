#!/usr/bin/env node
/**
 * Guard the JavaScript translation dictionaries: no duplicate keys, and no
 * locale that is short of the other where the fallback cannot cover it.
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
 * Neither is a live defect today; both are one careless edit away, and the
 * .po/.mo drift this repo actually had (see check-i18n-mo.js) is the same
 * shape — paired catalogues with nothing asserting they stay paired.
 */
'use strict';

const { readFileSync } = require('fs');
const { join } = require('path');
const vm = require('vm');

const FILE = join(__dirname, '..', 'asset', 'js', 'iwac-i18n.js');
const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);
const seen = { en: new Map(), fr: new Map() };
const duplicates = [];
let locale = null;

for (let i = 0; i < lines.length; i++) {
    const section = /^\s{8}(en|fr):\s*\{\s*$/.exec(lines[i]);
    if (section) {
        locale = section[1];
        continue;
    }
    if (locale && /^\s{8}\},?\s*$/.test(lines[i])) {
        locale = null;
        continue;
    }
    if (!locale) continue;

    const declaration = /^\s{12}((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*"))\s*:/.exec(lines[i]);
    if (!declaration) continue;

    let key;
    try {
        key = vm.runInNewContext(declaration[1], Object.create(null));
    } catch (err) {
        console.error(`✗ i18n guard: could not parse key at ${FILE}:${i + 1}: ${err.message}`);
        process.exit(1);
    }

    if (seen[locale].has(key)) {
        duplicates.push({ locale, key, first: seen[locale].get(key), again: i + 1 });
    } else {
        seen[locale].set(key, i + 1);
    }
}

if (!seen.en.size || !seen.fr.size) {
    console.error('✗ i18n guard: the en/fr dictionary sections parsed as empty');
    process.exit(1);
}

if (duplicates.length) {
    console.error(`\n✗ i18n guard: ${duplicates.length} duplicate runtime key(s)\n`);
    for (const duplicate of duplicates) {
        console.error(
            `  ${duplicate.locale}.${JSON.stringify(duplicate.key)}: ` +
            `lines ${duplicate.first} and ${duplicate.again}`
        );
    }
    console.error('\nDelete one declaration; JavaScript otherwise keeps the later value silently.\n');
    process.exit(1);
}

// Only a snake_case key is unreadable when it falls through to itself; a key
// that is already an English string ('Count', 'Loading dashboard') is exactly
// what an English visitor should see, so those need no `en` entry.
const IDENTIFIER = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

const untranslatable = [...seen.fr]
    .filter(([key]) => IDENTIFIER.test(key) && !seen.en.has(key))
    .map(([key, line]) => ({ key, line }));

const englishOnly = [...seen.en]
    .filter(([key]) => !seen.fr.has(key))
    .map(([key, line]) => ({ key, line }));

if (untranslatable.length || englishOnly.length) {
    console.error('\n✗ i18n guard: the en/fr dictionaries have drifted apart\n');

    const report = (heading, rows, consequence) => {
        if (!rows.length) return;
        console.error(`  ${heading} (${rows.length}):`);
        for (const { key, line } of rows.slice(0, 20)) {
            console.error(`    ${JSON.stringify(key)}  (line ${line})`);
        }
        if (rows.length > 20) console.error(`    … and ${rows.length - 20} more`);
        console.error(`    → ${consequence}\n`);
    };

    report(
        'snake_case keys in fr with no en entry',
        untranslatable,
        'English visitors would see the raw key, because t() falls back to it.'
    );
    report(
        'keys in en with no fr entry',
        englishOnly,
        'French visitors get the English value — t() tries en before the key.'
    );

    process.exit(1);
}

console.log(
    `✓ i18n guard: ${seen.en.size} English + ${seen.fr.size} French keys, ` +
    'no duplicates, no unreachable fallbacks'
);
