/**
 * Strip every locale but one from a source file's translation dictionaries.
 *
 * A page is read in one language, but every block used to ship both: the
 * shared dictionary in `iwac-i18n.js` alone is the largest file in
 * `shared-core`, the bundle every block loads, and the French half of it is
 * dead weight on an English page and vice versa. `scripts/build-js.js` builds
 * a bundle that carries dictionaries once per locale, each with the other
 * locale's tables emptied by this module, and the loader requests the one
 * matching the page.
 *
 * Emptying them changes nothing `t()` can observe, and that is checked rather
 * than assumed: `t()` reads the active locale's table and then `en`, and
 * `npm run lint:i18n` fails unless every `en` key also exists in `fr`. So an
 * English page never reads `fr`, and a French page never reaches `en`.
 *
 * Two shapes are recognised, found by parsing (acorn) rather than by pattern,
 * because the values carry braces of their own (`'{count} articles'`):
 *
 *   var DICTIONARY = { en: { … }, fr: { … } };      (iwac-i18n.js)
 *   ns.addTranslations('fr', { … });                  (every block dictionary)
 *
 * A file that CALLS `addTranslations` in any other shape — a variable instead
 * of an object literal, a computed locale — is an error, not a pass-through:
 * a dictionary this module cannot see would ship to every locale unnoticed.
 */
'use strict';

const acorn = require('acorn');

const LOCALES = ['en', 'fr'];
const CALL_TEXT = /\baddTranslations\s*\(\s*(['"])(\w+)\1/g;

function keyName(property) {
    if (!property || property.type !== 'Property' || property.computed) return null;
    if (property.key.type === 'Identifier') return property.key.name;
    if (property.key.type === 'Literal') return String(property.key.value);
    return null;
}

/** Depth-first over every AST node. */
function walk(node, visit) {
    if (!node || typeof node.type !== 'string') return;
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
        const value = node[key];
        if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
        else if (value && typeof value.type === 'string') walk(value, visit);
    }
}

/**
 * The dictionaries in `source`: `[{ locale, start, end }]`, where
 * `start`/`end` bound the object literal holding that locale's entries.
 */
function findDictionaries(source, filename) {
    let ast;
    try {
        ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch (err) {
        throw new Error(`${filename}: cannot parse for locale stripping — ${err.message}`, { cause: err });
    }
    const found = [];
    let calls = 0;
    walk(ast, (node) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
            && node.id.name === 'DICTIONARY' && node.init && node.init.type === 'ObjectExpression') {
            for (const property of node.init.properties) {
                const locale = keyName(property);
                if (LOCALES.includes(locale) && property.value.type === 'ObjectExpression') {
                    found.push({ locale, start: property.value.start, end: property.value.end });
                }
            }
        }
        if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
            && !node.callee.computed && node.callee.property.name === 'addTranslations') {
            const [locale, entries] = node.arguments;
            if (locale && locale.type === 'Literal' && LOCALES.includes(locale.value)
                && entries && entries.type === 'ObjectExpression') {
                calls++;
                found.push({ locale: locale.value, start: entries.start, end: entries.end });
            }
        }
    });

    const textual = (source.match(CALL_TEXT) || []).length;
    if (textual !== calls) {
        throw new Error(
            `${filename}: ${textual} addTranslations() call(s) in the text but ${calls} with a literal `
            + `locale and an object literal — the locale stripper cannot see the others, so they `
            + `would ship to every locale. Pass the entries inline: addTranslations('fr', { … }).`
        );
    }
    return found;
}

/** True when `source` carries at least one dictionary this module strips. */
function hasDictionaries(source, filename) {
    return findDictionaries(source, filename).length > 0;
}

/**
 * `source` with every dictionary for a locale other than `keep` replaced by
 * `{}`. The rest of the file is untouched, byte for byte.
 */
function keepLocale(source, keep, filename) {
    if (!LOCALES.includes(keep)) throw new Error(`unknown locale ${keep}`);
    const dropped = findDictionaries(source, filename)
        .filter((d) => d.locale !== keep)
        .sort((a, b) => b.start - a.start);
    let out = source;
    for (const d of dropped) out = out.slice(0, d.start) + '{}' + out.slice(d.end);
    return out;
}

module.exports = { LOCALES, findDictionaries, hasDictionaries, keepLocale };
