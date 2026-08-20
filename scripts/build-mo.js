#!/usr/bin/env node
/**
 * Compile language/fr.po into the language/fr.mo that Omeka loads.
 *
 * This exists because there is no gettext toolchain on the maintainer's
 * machine, and `language/fr.mo` is committed — the release zip is built with
 * `git archive`, so a file generated at package time would never reach the
 * archive at all. Run this after every fr.po edit; `npm run lint:i18n-mo`
 * fails the build if you forget.
 *
 * Deliberately not part of `npm run build`. Regenerating on every build would
 * make the .mo a build artifact whose bytes must match this compiler's
 * layout, and a catalogue recompiled elsewhere with real `msgfmt` would then
 * show up as a permanent diff. The guard compares catalogues rather than
 * bytes precisely so both compilers are acceptable.
 */
'use strict';

const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const { catalogueFromPo, compileMo, parseMo, parsePo } = require('./gettext');

const LANGUAGE = join(__dirname, '..', 'language');
const PO = join(LANGUAGE, 'fr.po');
const MO = join(LANGUAGE, 'fr.mo');

let catalogue;
try {
    catalogue = catalogueFromPo(parsePo(readFileSync(PO, 'utf8'), 'language/fr.po'), 'language/fr.po');
} catch (error) {
    console.error(`\n✗ mo build: ${error.message}\n`);
    process.exit(1);
}

if (!catalogue.has('')) {
    console.error('\n✗ mo build: language/fr.po has no catalogue header (an entry with an empty msgid)\n');
    process.exit(1);
}

const compiled = compileMo(catalogue);

// Prove the bytes read back as what went in before overwriting a file the
// runtime depends on — a subtly malformed .mo loses every translation
// silently, which is the exact failure this script is here to prevent.
const { entries } = parseMo(compiled, '(compiled)');
if (entries.length !== catalogue.size) {
    console.error('\n✗ mo build: compiled catalogue does not read back — aborting without writing\n');
    process.exit(1);
}
for (const { key, value } of entries) {
    if (catalogue.get(key) !== value) {
        console.error(`\n✗ mo build: entry ${JSON.stringify(key)} does not read back — aborting without writing\n`);
        process.exit(1);
    }
}

const unchanged = (() => {
    try {
        return readFileSync(MO).equals(compiled);
    } catch {
        return false;
    }
})();

writeFileSync(MO, compiled);
console.log(
    `✓ mo build: ${catalogue.size} entries → language/fr.mo ` +
    `(${compiled.length} bytes${unchanged ? ', unchanged' : ''})`
);
