#!/usr/bin/env node
/**
 * Reject duplicate runtime keys in the JavaScript translation dictionaries.
 *
 * Object-literal duplicates are legal JavaScript: the later value silently
 * shadows the earlier one. Three divergent translations shipped that way
 * before the v1.23 audit found them. Parse the source declarations (including
 * \u escapes) so equivalent spellings such as a literal character and its
 * escape form are compared as the same runtime key.
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

console.log(
    `✓ i18n guard: ${seen.en.size} English + ${seen.fr.size} French keys, no duplicates`
);
