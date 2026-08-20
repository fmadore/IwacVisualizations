'use strict';
/**
 * A po/mo codec, because this machine has no gettext toolchain.
 *
 * Omeka loads `language/fr.mo`, never `fr.po`, and the compiled catalogue is
 * committed (the release zip is a `git archive`, so an untracked .mo would
 * simply not ship). That makes the two files a pair that can silently
 * disagree, and in v1.48.1 they did: three msgids were reworded in fr.po and
 * the .mo was never recompiled, so the admin UI kept serving French for
 * msgids the English source no longer contained — every one of them fell
 * through to English with no error anywhere.
 *
 * `build-mo.js` writes the .mo from the .po; `check-i18n-mo.js` proves they
 * still agree. The comparison is over the parsed catalogues, not the bytes,
 * so a .mo produced by real `msgfmt` on some other machine still passes.
 *
 * Format reference: GNU gettext manual, "The Format of GNU MO Files".
 * The hash table is optional — libintl falls back to a binary search over the
 * sorted original-string table when its size is 0, which is what msgfmt.py in
 * CPython's Tools/i18n has always emitted and what this repo's .mo already is.
 */

const MAGIC = 0x950412de;
const HEADER_BYTES = 28;
const NUL = Buffer.from([0]);

// Separators the format stores inside a key or value: EOT joins msgctxt to
// msgid, NUL joins msgid to msgid_plural and separates the plural forms of a
// translation.
const CONTEXT_GLUE = '\u0004';
const PLURAL_GLUE = '\u0000';

const ESCAPES = {
    n: '\n',
    t: '\t',
    r: '\r',
    a: '\x07',
    b: '\b',
    f: '\f',
    v: '\v',
    '"': '"',
    '\\': '\\',
};

/**
 * Decode one double-quoted po string literal.
 *
 * Octal (\123) and hex (\xNN) escapes are deliberately rejected rather than
 * guessed at: they denote bytes, this catalogue is UTF-8, and a wrong decode
 * would be invisible. Nothing in fr.po uses them.
 */
function unquote(literal, fail) {
    const text = literal.trim();
    if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) {
        fail(`expected a double-quoted string, got: ${literal.trim()}`);
    }

    const body = text.slice(1, -1);
    let out = '';
    for (let i = 0; i < body.length; i++) {
        if (body[i] !== '\\') {
            if (body[i] === '"') fail('unescaped double quote inside a string');
            out += body[i];
            continue;
        }
        const escape = body[++i];
        if (escape === undefined) fail('string ends on a lone backslash');
        if (!Object.prototype.hasOwnProperty.call(ESCAPES, escape)) {
            fail(`unsupported escape \\${escape} — extend ESCAPES in scripts/gettext.js`);
        }
        out += ESCAPES[escape];
    }
    return out;
}

/**
 * Parse a .po source into entries, in file order.
 *
 * Comment lines are skipped, which disposes of obsolete `#~` entries for
 * free — their continuation lines are comments too. Flags are collected so
 * fuzzy entries can be dropped the way msgfmt drops them.
 */
function parsePo(source, filename = 'fr.po') {
    const lines = source.split(/\r?\n/);
    const entries = [];
    let entry = null;
    let field = null;
    let flags = new Set();

    let lineNumber = 0;
    const fail = (message) => {
        throw new Error(`${filename}:${lineNumber}: ${message}`);
    };

    const open = () => {
        if (!entry) {
            entry = { ctxt: null, id: null, plural: null, strs: [], flags, line: lineNumber };
            flags = new Set();
        }
        return entry;
    };

    const flush = () => {
        if (entry) {
            if (entry.id === null) fail(`entry opened at line ${entry.line} has no msgid`);
            if (!entry.strs.length) fail(`entry opened at line ${entry.line} has no msgstr`);
            entries.push(entry);
        }
        entry = null;
        field = null;
    };

    for (let i = 0; i < lines.length; i++) {
        lineNumber = i + 1;
        const line = lines[i].trim();

        if (line === '') {
            flush();
            continue;
        }

        if (line.startsWith('#')) {
            field = null;
            if (line.startsWith('#,')) {
                for (const flag of line.slice(2).split(',')) {
                    if (flag.trim()) flags.add(flag.trim());
                }
            }
            continue;
        }

        let match;

        if ((match = /^msgctxt\s+(.*)$/.exec(line))) {
            if (entry && entry.id !== null) flush();
            open();
            if (entry.ctxt !== null) fail('a second msgctxt in one entry');
            entry.ctxt = unquote(match[1], fail);
            field = 'ctxt';
            continue;
        }

        if ((match = /^msgid\s+(.*)$/.exec(line))) {
            if (entry && entry.id !== null) flush();
            open();
            entry.id = unquote(match[1], fail);
            field = 'id';
            continue;
        }

        if ((match = /^msgid_plural\s+(.*)$/.exec(line))) {
            if (!entry || entry.id === null) fail('msgid_plural before any msgid');
            if (entry.plural !== null) fail('a second msgid_plural in one entry');
            entry.plural = unquote(match[1], fail);
            field = 'plural';
            continue;
        }

        if ((match = /^msgstr\s*\[\s*(\d+)\s*\]\s+(.*)$/.exec(line))) {
            if (!entry || entry.id === null) fail('msgstr before any msgid');
            if (entry.plural === null) fail('indexed msgstr on an entry with no msgid_plural');
            const index = Number(match[1]);
            if (index !== entry.strs.length) {
                fail(`msgstr[${index}] is out of order — expected msgstr[${entry.strs.length}]`);
            }
            entry.strs.push(unquote(match[2], fail));
            field = index;
            continue;
        }

        if ((match = /^msgstr\s+(.*)$/.exec(line))) {
            if (!entry || entry.id === null) fail('msgstr before any msgid');
            if (entry.strs.length) fail('a second msgstr in one entry');
            entry.strs.push(unquote(match[1], fail));
            field = 0;
            continue;
        }

        if (line.startsWith('"')) {
            if (!entry || field === null) fail('continuation string outside an entry field');
            const chunk = unquote(line, fail);
            if (field === 'ctxt') entry.ctxt += chunk;
            else if (field === 'id') entry.id += chunk;
            else if (field === 'plural') entry.plural += chunk;
            else entry.strs[field] += chunk;
            continue;
        }

        fail(`unrecognised line: ${line}`);
    }

    lineNumber = lines.length;
    flush();
    return entries;
}

/** The .mo key a po entry is stored under: context and plural are glued in. */
function entryKey(entry) {
    const context = entry.ctxt === null ? '' : entry.ctxt + CONTEXT_GLUE;
    const plural = entry.plural === null ? '' : PLURAL_GLUE + entry.plural;
    return context + entry.id + plural;
}

/**
 * Reduce po entries to the catalogue msgfmt would compile.
 *
 * Fuzzy and wholly untranslated entries are dropped — that is msgfmt's
 * behaviour, and a guard that kept them would report drift against every
 * correctly compiled .mo. The header (empty msgid) is always kept.
 */
function catalogueFromPo(entries, filename = 'fr.po') {
    const catalogue = new Map();
    const seen = new Map();

    for (const entry of entries) {
        const key = entryKey(entry);
        const isHeader = key === '';

        if (seen.has(key)) {
            throw new Error(
                `${filename}:${entry.line}: duplicate msgid ${JSON.stringify(entry.id)} ` +
                `(first declared at line ${seen.get(key)})`
            );
        }
        seen.set(key, entry.line);

        if (!isHeader && entry.flags.has('fuzzy')) continue;
        if (!isHeader && !entry.strs.some((str) => str !== '')) continue;

        catalogue.set(key, entry.strs.join(PLURAL_GLUE));
    }

    return catalogue;
}

/**
 * Read a .mo file. Returns entries in stored order so a caller can check that
 * the original-string table is sorted, which libintl's binary search needs.
 */
function parseMo(buffer, filename = 'fr.mo') {
    const fail = (message) => {
        throw new Error(`${filename}: ${message}`);
    };

    if (buffer.length < HEADER_BYTES) fail(`too short to be a .mo file (${buffer.length} bytes)`);

    // The magic byte order declares the whole file's byte order. We only ever
    // write little-endian, but msgfmt on a big-endian host writes the other.
    let read;
    if (buffer.readUInt32LE(0) === MAGIC) {
        read = (offset) => buffer.readUInt32LE(offset);
    } else if (buffer.readUInt32BE(0) === MAGIC) {
        read = (offset) => buffer.readUInt32BE(offset);
    } else {
        fail(`bad magic 0x${buffer.readUInt32BE(0).toString(16)} — expected 0x950412de`);
    }

    const revision = read(4);
    const major = revision >>> 16;
    if (major > 1) fail(`unsupported format revision ${major}`);

    const count = read(8);
    const originals = read(12);
    const translations = read(16);

    for (const [label, offset] of [['original', originals], ['translation', translations]]) {
        if (offset + count * 8 > buffer.length) {
            fail(`${label} string table runs past the end of the file`);
        }
    }

    const readString = (table, index, label) => {
        const length = read(table + index * 8);
        const offset = read(table + index * 8 + 4);
        if (offset + length >= buffer.length) {
            fail(`${label} string ${index} runs past the end of the file`);
        }
        if (buffer[offset + length] !== 0) {
            fail(`${label} string ${index} is not NUL-terminated`);
        }
        return buffer.toString('utf8', offset, offset + length);
    };

    const entries = [];
    for (let i = 0; i < count; i++) {
        entries.push({
            key: readString(originals, i, 'original'),
            value: readString(translations, i, 'translation'),
        });
    }

    return { entries };
}

/**
 * Serialise a catalogue to .mo bytes.
 *
 * Keys are sorted by their UTF-8 bytes, which is what the format requires —
 * lookups binary-search this table. Written little-endian with no hash table,
 * matching what already ships.
 */
function compileMo(catalogue) {
    const items = [...catalogue.entries()]
        .map(([key, value]) => ({ key: Buffer.from(key, 'utf8'), value: Buffer.from(value, 'utf8') }))
        .sort((a, b) => Buffer.compare(a.key, b.key));

    const count = items.length;
    const originals = HEADER_BYTES;
    const translations = originals + count * 8;

    const header = Buffer.alloc(HEADER_BYTES);
    header.writeUInt32LE(MAGIC, 0);
    header.writeUInt32LE(0, 4); // format revision
    header.writeUInt32LE(count, 8);
    header.writeUInt32LE(originals, 12);
    header.writeUInt32LE(translations, 16);
    header.writeUInt32LE(0, 20); // hash table size — omitted, see the file docblock
    header.writeUInt32LE(0, 24); // hash table offset

    const originalTable = Buffer.alloc(count * 8);
    const translationTable = Buffer.alloc(count * 8);
    const blobs = [];
    let offset = translations + count * 8;

    const append = (table, index, bytes) => {
        table.writeUInt32LE(bytes.length, index * 8);
        table.writeUInt32LE(offset, index * 8 + 4);
        blobs.push(bytes, NUL);
        offset += bytes.length + 1;
    };

    items.forEach((item, index) => append(originalTable, index, item.key));
    items.forEach((item, index) => append(translationTable, index, item.value));

    return Buffer.concat([header, originalTable, translationTable, ...blobs]);
}

/** Pull the charset out of a catalogue header, or null if it declares none. */
function charsetOf(header) {
    const match = /charset=([\w-]+)/i.exec(header || '');
    return match ? match[1].toUpperCase() : null;
}

/**
 * Render a .mo key back into something readable in an error message.
 *
 * Block descriptions in this catalogue run to several hundred characters, and
 * a drift report that prints them whole is unreadable — the reworded tail of
 * one is what you actually need to see, so keep the head short enough that
 * several fit on screen together.
 */
function describeKey(key, limit = 110) {
    const [context, rest] = key.includes(CONTEXT_GLUE) ? key.split(CONTEXT_GLUE) : [null, key];
    const id = rest.split(PLURAL_GLUE)[0];
    const clipped = id.length > limit ? `${id.slice(0, limit)}…` : id;
    const label = id === '' ? '(catalogue header)' : JSON.stringify(clipped);
    return context === null ? label : `${JSON.stringify(context)}|${label}`;
}

module.exports = {
    CONTEXT_GLUE,
    PLURAL_GLUE,
    catalogueFromPo,
    charsetOf,
    compileMo,
    describeKey,
    entryKey,
    parseMo,
    parsePo,
};
