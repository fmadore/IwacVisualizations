'use strict';

// Every bundle that carries dictionaries ships once per locale, with the
// other locale's tables emptied (scripts/i18n-strip.js). That is only safe if
// `t()` cannot tell the difference, so this proves it for every key: the
// shared dictionary and all block dictionaries are registered as the runtime
// registers them — once from the full sources and once from the stripped
// ones — and every key, with and without a plural count, must translate to
// the same string in both languages.

const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const { join, relative } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { findDictionaries, keepLocale, LOCALES } = require('../../scripts/i18n-strip.js');

const ROOT = join(__dirname, '..', '..');
const JS = join(ROOT, 'asset', 'js');
const CORE = join(JS, 'iwac-i18n.js');

function sources(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== 'dist') sources(path, out); }
        else if (name.endsWith('.js')) out.push(path);
    }
    return out;
}

const BLOCKS = sources(JS)
    .filter((p) => p !== CORE)
    .map((p) => ({ label: relative(ROOT, p), source: readFileSync(p, 'utf8') }))
    .filter((f) => findDictionaries(f.source, f.label).length);

/** The dictionaries a block file registers: [locale, entries] in source order. */
function registrations(source, label) {
    return findDictionaries(source, label)
        .sort((a, b) => a.start - b.start)
        .map((d) => [d.locale, vm.runInNewContext('(' + source.slice(d.start, d.end) + ')')]);
}

function load(lang, transform) {
    const context = {
        Intl,
        document: { documentElement: { getAttribute: (name) => (name === 'lang' ? lang : null) } },
        window: { IWACVis: {} },
    };
    vm.createContext(context);
    vm.runInContext(transform(readFileSync(CORE, 'utf8'), 'iwac-i18n.js'), context);
    const ns = context.window.IWACVis;
    for (const block of BLOCKS) {
        for (const [locale, entries] of registrations(transform(block.source, block.label), block.label)) {
            ns.addTranslations(locale, entries);
        }
    }
    return ns;
}

function everyKey() {
    const keys = new Set();
    const collect = (source, label) => {
        for (const [, entries] of registrations(source, label)) Object.keys(entries).forEach((k) => keys.add(k));
    };
    const core = readFileSync(CORE, 'utf8');
    for (const d of findDictionaries(core, 'iwac-i18n.js')) {
        Object.keys(vm.runInNewContext('(' + core.slice(d.start, d.end) + ')')).forEach((k) => keys.add(k));
    }
    BLOCKS.forEach((b) => collect(b.source, b.label));
    return [...keys];
}

test('the dictionaries the stripper finds are the twenty-seven the i18n guard counts', () => {
    // 19 until v1.73.0, which gave seven blocks their own dictionary.
    assert.equal(BLOCKS.length + 1, 27);
});

for (const locale of LOCALES) {
    test(`stripping the other locale changes no translation on a ${locale} page`, () => {
        const lang = locale === 'fr' ? 'fr-FR' : 'en';
        const full = load(lang, (source) => source);
        const stripped = load(lang, (source, label) => keepLocale(source, locale, label));
        assert.equal(full.locale, locale);
        const keys = everyKey();
        assert.ok(keys.length > 1000, `expected the full key set, got ${keys.length}`);
        let compared = 0;
        for (const key of keys) {
            const base = key.replace(/_(zero|one|two|few|many|other)$/, '');
            for (const params of [undefined, { count: 0 }, { count: 1 }, { count: 7 }]) {
                assert.equal(stripped.t(base, params), full.t(base, params), `${locale}: t(${JSON.stringify(base)}, ${JSON.stringify(params)})`);
                compared++;
            }
        }
        assert.ok(compared > 4000);
    });
}

test('a stripped source keeps only its own locale\'s entries, and all of them', () => {
    const core = readFileSync(CORE, 'utf8');
    const sizesOf = (source) => Object.fromEntries(findDictionaries(source, 'iwac-i18n.js')
        .map((d) => [d.locale, Object.keys(vm.runInNewContext('(' + source.slice(d.start, d.end) + ')')).length]));
    const original = sizesOf(core);
    for (const locale of LOCALES) {
        const sizes = sizesOf(keepLocale(core, locale, 'iwac-i18n.js'));
        const other = LOCALES.find((l) => l !== locale);
        assert.equal(sizes[other], 0, `${other} is emptied in the ${locale} build`);
        assert.ok(original[locale] > 0);
        assert.equal(sizes[locale], original[locale], `${locale} keeps every one of its entries`);
    }
});

test('the stripper refuses a dictionary it cannot see', () => {
    assert.throws(() => findDictionaries("var fr = {}; ns.addTranslations('fr', fr);", 'x.js'), /cannot see/);
    assert.deepEqual(findDictionaries("ns.addTranslations('fr', { a: 'b' });", 'x.js').map((d) => d.locale), ['fr']);
});

test('every bundle is on disk under the name the partial will ask for', () => {
    const manifest = JSON.parse(readFileSync(join(JS, 'bundles.json'), 'utf8'));
    const localized = JSON.parse(readFileSync(join(JS, 'dist', 'locales.json'), 'utf8'));
    const names = [
        ...Object.keys(manifest.shared).map((n) => `shared-${n}`),
        ...Object.keys(manifest.panels || {}).map((n) => `panels/${n}`),
        ...Object.keys(manifest.blocks).map((n) => `blocks/${n}`),
    ];
    assert.deepEqual(localized.locales, LOCALES);
    assert.ok(localized.bundles.includes('shared-core'), 'the shared dictionary rides in shared-core');
    for (const name of names) {
        const perLocale = localized.bundles.includes(name);
        for (const locale of LOCALES) {
            assert.equal(existsSync(join(JS, 'dist', `${name}.${locale}.min.js`)), perLocale, `${name}.${locale}.min.js`);
        }
        assert.equal(existsSync(join(JS, 'dist', `${name}.min.js`)), !perLocale, `${name}.min.js`);
    }
});
