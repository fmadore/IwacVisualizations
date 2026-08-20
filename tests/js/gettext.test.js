'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const {
    catalogueFromPo,
    compileMo,
    describeKey,
    parseMo,
    parsePo,
} = require('../../scripts/gettext');

const LANGUAGE = join(__dirname, '..', '..', 'language');
const EOT = '\u0004';
const NUL = '\u0000';

const HEADER = [
    'msgid ""',
    'msgstr ""',
    '"MIME-Version: 1.0\\n"',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '',
].join('\n');

function catalogueOf(body) {
    return catalogueFromPo(parsePo(`${HEADER}${body}`, 'test.po'), 'test.po');
}

test('po entries survive a compile/parse round trip', () => {
    const source = catalogueOf([
        'msgid "Browse the collection"',
        'msgstr "Parcourir la collection"',
        '',
        '# a comment, and an id needing escapes',
        'msgid "Loading\\t\\"dossier\\"\\nnow"',
        'msgstr "Chargement\\t\\"du dossier\\"\\nmaintenant"',
        '',
    ].join('\n'));

    const { entries } = parseMo(compileMo(source), 'round-trip.mo');
    assert.deepEqual(new Map(entries.map((e) => [e.key, e.value])), source);
    assert.equal(source.get('Loading\t"dossier"\nnow'), 'Chargement\t"du dossier"\nmaintenant');
});

test('multi-line strings concatenate without a separator', () => {
    const source = catalogueOf([
        'msgid ""',
        '"Polarity, centrality to Islam and Muslim communities, and subjectivity "',
        '"ratings for this article."',
        'msgstr ""',
        '"Notes de polarité, de centralité et de subjectivité "',
        '"pour cet article."',
        '',
    ].join('\n'));

    assert.ok(source.has(
        'Polarity, centrality to Islam and Muslim communities, and subjectivity ratings for this article.'
    ));
});

test('msgfmt exclusions are honoured: fuzzy, untranslated and obsolete entries', () => {
    const source = catalogueOf([
        '#, fuzzy',
        'msgid "Half-translated"',
        'msgstr "À moitié traduit"',
        '',
        'msgid "Never translated"',
        'msgstr ""',
        '',
        '#~ msgid "Model comparison"',
        '#~ msgstr "Comparaison des modèles"',
        '',
        'msgid "Kept"',
        'msgstr "Conservé"',
        '',
    ].join('\n'));

    assert.deepEqual([...source.keys()].filter((key) => key !== ''), ['Kept']);
});

test('contexts and plurals are glued the way the format stores them', () => {
    const source = catalogueOf([
        'msgctxt "chart axis"',
        'msgid "Sources"',
        'msgstr "Sources"',
        '',
        'msgid "%d article"',
        'msgid_plural "%d articles"',
        'msgstr[0] "%d article"',
        'msgstr[1] "%d articles"',
        '',
    ].join('\n'));

    assert.equal(source.get(`chart axis${EOT}Sources`), 'Sources');
    assert.equal(source.get(`%d article${NUL}%d articles`), `%d article${NUL}%d articles`);
    assert.equal(describeKey(`chart axis${EOT}Sources`), '"chart axis"|"Sources"');
});

test('compiled keys are sorted by their utf-8 bytes, which lookups binary-search', () => {
    const source = catalogueOf([
        'msgid "zebra"',
        'msgstr "zèbre"',
        '',
        'msgid "Élan"',
        'msgstr "Élan"',
        '',
        'msgid "apple"',
        'msgstr "pomme"',
        '',
    ].join('\n'));

    const keys = parseMo(compileMo(source), 'sorted.mo').entries.map((entry) => entry.key);
    const sorted = [...keys].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
    assert.deepEqual(keys, sorted);
    assert.equal(keys[0], '', 'the catalogue header sorts first');
});

test('a malformed po fails loudly with a line number', () => {
    assert.throws(
        () => parsePo(`${HEADER}msgid "orphan"\n`, 'test.po'),
        /test\.po:\d+: entry opened at line \d+ has no msgstr/
    );
    assert.throws(
        () => parsePo(`${HEADER}msgid "bad escape \\q"\nmsgstr "x"\n`, 'test.po'),
        /unsupported escape/
    );
    assert.throws(
        () => catalogueOf('msgid "Twice"\nmsgstr "Deux fois"\n\nmsgid "Twice"\nmsgstr "Encore"\n'),
        /duplicate msgid/
    );
});

test('a truncated or mis-magicked mo is rejected rather than half-read', () => {
    const good = compileMo(catalogueOf('msgid "Kept"\nmsgstr "Conservé"\n'));

    assert.throws(() => parseMo(good.subarray(0, 12), 'short.mo'), /too short/);

    const wrongMagic = Buffer.from(good);
    wrongMagic.writeUInt32LE(0x12345678, 0);
    assert.throws(() => parseMo(wrongMagic, 'alien.mo'), /bad magic/);

    const truncated = good.subarray(0, good.length - 4);
    assert.throws(() => parseMo(truncated, 'cut.mo'), /past the end of the file|not NUL-terminated/);
});

test('the committed fr.mo is exactly what fr.po compiles to', () => {
    const source = catalogueFromPo(
        parsePo(readFileSync(join(LANGUAGE, 'fr.po'), 'utf8'), 'language/fr.po'),
        'language/fr.po'
    );
    const onDisk = parseMo(readFileSync(join(LANGUAGE, 'fr.mo')), 'language/fr.mo');

    assert.deepEqual(new Map(onDisk.entries.map((e) => [e.key, e.value])), source);
});
