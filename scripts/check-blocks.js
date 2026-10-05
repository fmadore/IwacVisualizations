#!/usr/bin/env node
/**
 * Block-registry consistency guard.
 *
 * `BlockRegistry` made the slug the spine of a page block, but three of the
 * four declaration sites still live outside it: the invokable map in
 * `config/module.config.php` (read while Omeka bootstraps, before the class
 * is reliably autoloadable), the `BlockLayout` subclass, and the template.
 * This script closes that loop at build time.
 *
 * For every slug in `BlockRegistry::BLOCKS` it asserts:
 *   1. the declared class file exists and declares `const SLUG` = that slug;
 *   2. `config/module.config.php` registers the row's invokable → that class;
 *   3. the block has somewhere to render. Since H5 that is one of two
 *      shapes: a row with a `shell` array declares its whole asset
 *      declaration in the registry and renders through `_generic`, and a row
 *      without one keeps `view/common/block-layout/<slug>.phtml` — which the
 *      one block that does more than declare (`on-this-day`) still does; the
 *      other twenty are registry shells. A block with neither,
 *      or with both, is a 500 on every embed of it (exactly the v1.21
 *      `press-reprints-detector` bug);
 *   4. a per-slug template's `embedSlug` (when it declares one) equals the
 *      slug, and a registry shell declares none — `_generic` passes the
 *      registry key, so a second copy could only disagree with it;
 *   5. embeddable blocks declare an `embedSlug`, non-embeddable ones don't.
 *
 * And in the other direction: every `block_layouts` invokable in the config
 * and every non-abstract class in `src/Site/BlockLayout/` is in the registry,
 * so a block cannot be added to one place and forgotten in the others.
 *
 * Since v1.62.0 the JavaScript is loaded as bundles named in
 * `asset/js/bundles.json` — by a registry `shell` for the twenty generic page
 * blocks, by a template for `on-this-day` and the resource-page blocks. So,
 * additionally:
 *   6. every `bundle` a shell or a template names exists in the manifest;
 *   7. every `blocks` entry in the manifest is named by at least one of them
 *      — a bundle nothing loads is dead weight the build keeps emitting.
 *
 * And the asset declaration inside each shell (2026-10):
 *   8. `blockCss` sits INSIDE `assets` — the shell forwards only `assets` to
 *      the asset partial, so a `blockCss` one level up is silently dropped
 *      (Periodicals Overview shipped without its stylesheet that way) — and
 *      every sheet it names exists as `asset/css/blocks/<name>.css`;
 *   9. every `needs` flag is one `AssetPlan::FLAGS` lists. A misspelt flag
 *      loads nothing and says nothing; AssetPlan now throws on it at render
 *      time, and this moves that failure to the build.
 *
 * Usage: node scripts/check-blocks.js
 * Exit code 1 on any inconsistency (with the offending slug), else 0.
 */
const { readdirSync, existsSync } = require('fs');
const { spawnSync } = require('child_process');
const { join } = require('path');
const { readText } = require('./lib/fs');
const { MANIFEST_PATH, loadManifest } = require('./lib/manifest');
const { fail: failAndExit } = require('./lib/report');

const ROOT = join(__dirname, '..');
const REGISTRY = join(ROOT, 'src', 'Site', 'BlockRegistry.php');
const CONFIG = join(ROOT, 'config', 'module.config.php');
const LAYOUT_DIR = join(ROOT, 'src', 'Site', 'BlockLayout');
const TEMPLATE_DIR = join(ROOT, 'view', 'common', 'block-layout');
const RESOURCE_TEMPLATE_DIRS = [
    join(ROOT, 'view', 'common', 'resource-page-block-layout'),
    join(ROOT, 'view', 'common', 'resource-page-block-layout', 'visualizations'),
];
const ASSET_PLAN = join(ROOT, 'src', 'Site', 'AssetPlan.php');
const BLOCK_CSS_DIR = join(ROOT, 'asset', 'css', 'blocks');

const problems = [];
const fail = (msg) => problems.push(msg);

/**
 * Read `BlockRegistry::BLOCKS` — through PHP when there is a PHP, by regex
 * when there is not.
 *
 * The regex path was the only path, and it kept being the wrong shape: rows
 * had to be found by indentation so that the arrays a `shell` nests would not
 * read as rows of their own, and a `'shell' => [` key had to be detected with
 * a second pattern. `php -r` returns the actual array, which is both simpler
 * and correct by construction. The regex stays as the fallback, because a
 * contributor without a PHP binary should still get the other twenty checks
 * rather than a skipped script (B2).
 */
function parseRegistry() {
    const viaPhp = parseRegistryWithPhp();
    if (!viaPhp) return parseRegistryWithRegex();
    // Both readers exist, so both have to agree, or the CI run (node only,
    // no PHP - so the fallback) would be checking something the local run
    // is not. Comparing costs one extra file read and removes the whole
    // class of "passes here, fails there".
    if (JSON.stringify(viaPhp) !== JSON.stringify(parseRegistryWithRegex())) {
        fail(
            'the PHP and regex registry readers disagree - the fallback in '
            + 'parseRegistryWithRegex() has drifted from BlockRegistry::BLOCKS'
        );
    }
    return viaPhp;
}

function parseRegistryWithPhp() {
    const result = spawnSync('php', [
        '-d', 'error_reporting=0',
        '-r',
        `require ${JSON.stringify(REGISTRY)}; `
        + 'echo json_encode(IwacVisualizations\\Site\\BlockRegistry::BLOCKS);',
    ], { encoding: 'utf8' });
    if (result.error || result.status !== 0 || !result.stdout) return null;
    let raw;
    try {
        raw = JSON.parse(result.stdout);
    } catch (e) {
        return null;
    }
    const out = {};
    for (const [slug, row] of Object.entries(raw)) {
        const cls = String(row.class || '').split('\\').pop();
        const shell = row.shell && typeof row.shell === 'object' ? row.shell : null;
        const assets = shell && shell.assets && typeof shell.assets === 'object' ? shell.assets : {};
        const needs = assets.needs || {};
        out[slug] = {
            invokable: row.invokable ?? null,
            class: cls || null,
            embeddable: row.embeddable !== false,
            shell: Boolean(row.shell),
            bundle: assets.bundle || null,
            declaresEmbedSlug: Boolean(shell && 'embedSlug' in shell),
            blockCss: assets.blockCss === undefined ? [] : [].concat(assets.blockCss).map(String),
            shellBlockCss: Boolean(shell && 'blockCss' in shell),
            // A PHP list json_encodes to an array, a keyed array to an object.
            needs: Array.isArray(needs) ? needs.map(String) : Object.keys(needs),
        };
    }
    return out;
}

/** The fallback: no PHP binary, so read the source. */
function parseRegistryWithRegex() {
    // LF-normalised: every pattern below is anchored on `\n`, and a CRLF
    // checkout used to make this reader find zero rows.
    const src = readText(REGISTRY);
    const body = /const BLOCKS = \[([\s\S]*?)\n {4}\];/.exec(src);
    if (!body) {
        fail('BlockRegistry::BLOCKS not found or not in the expected shape');
        return {};
    }
    const out = {};
    // A row opens at 8 spaces and closes at 8. Anchoring on that indentation
    // is what keeps the arrays a `shell` now nests — `assets`, `needs` — from
    // being read as rows of their own.
    const rowRe = /^ {8}'([a-z0-9-]+)' => \[\n([\s\S]*?)\n {8}\],$/gm;
    let m;
    while ((m = rowRe.exec(body[1])) !== null) {
        const [, slug, row] = m;
        const pick = (key) => {
            const v = new RegExp(`'${key}'\\s*=>\\s*(?:'([^']*)'|BlockLayout\\\\(\\w+)::class|(true|false))`).exec(row);
            return v ? (v[1] ?? v[2] ?? v[3]) : null;
        };
        const bundle = /'bundle'\s*=>\s*'([^']+)'/.exec(row);
        // The shell's keys sit at 16 spaces, `assets`' at 20, a `needs` or a
        // `blockCss` list's entries at 24. Whole-line comments are dropped
        // first: a quote in a comment must not read as a sheet name.
        const assets = /^ {16}'assets'\s*=>\s*\[\n([\s\S]*?)\n {16}\],$/m.exec(row);
        const assetBody = assets ? assets[1].replace(/^\s*\/\/.*$/gm, '') : '';
        const blockCss = [];
        const cssOne = /^ {20}'blockCss'\s*=>\s*'([^']*)'/m.exec(assetBody);
        const cssList = /^ {20}'blockCss'\s*=>\s*\[\n([\s\S]*?)\n {20}\],?$/m.exec(assetBody);
        if (cssOne) blockCss.push(cssOne[1]);
        if (cssList) for (const m of cssList[1].matchAll(/'([^']*)'/g)) blockCss.push(m[1]);
        const needsBody = /^ {20}'needs'\s*=>\s*\[\n([\s\S]*?)\n {20}\],?$/m.exec(assetBody);
        const needs = needsBody
            ? [...needsBody[1].matchAll(/^ {24}'(\w+)'\s*=>/gm)].map((m) => m[1])
            : [];
        out[slug] = {
            invokable: pick('invokable'),
            class: pick('class'),
            embeddable: pick('embeddable') !== 'false',
            // A row that declares its whole shell renders through `_generic`
            // rather than a per-slug template (H5).
            shell: /^ {12}'shell'\s*=>\s*\[/m.test(row),
            bundle: bundle ? bundle[1] : null,
            declaresEmbedSlug: /'embedSlug'\s*=>/.test(row),
            blockCss,
            shellBlockCss: /^ {16}'blockCss'\s*=>/m.test(row),
            needs,
        };
    }
    return out;
}

const registry = parseRegistry();
const slugs = Object.keys(registry);
if (!slugs.length) fail('BlockRegistry::BLOCKS parsed as empty');

const configSrc = existsSync(CONFIG) ? readText(CONFIG) : '';
const configBlock = /'block_layouts'\s*=>\s*\[[\s\S]*?'invokables'\s*=>\s*\[([\s\S]*?)\n {8}\]/.exec(configSrc);
const configMap = {};
if (configBlock) {
    const re = /'(\w+)'\s*=>\s*Site\\BlockLayout\\(\w+)::class/g;
    let m;
    while ((m = re.exec(configBlock[1])) !== null) configMap[m[1]] = m[2];
} else {
    fail('config/module.config.php: block_layouts.invokables not found');
}

for (const [slug, row] of Object.entries(registry)) {
    // 1. class file declares the matching SLUG
    const classFile = join(LAYOUT_DIR, `${row.class}.php`);
    if (!existsSync(classFile)) {
        fail(`${slug}: class file src/Site/BlockLayout/${row.class}.php is missing`);
    } else {
        const declared = /const SLUG\s*=\s*'([a-z0-9-]+)'/.exec(readText(classFile));
        if (!declared) {
            fail(`${slug}: ${row.class} does not declare a const SLUG`);
        } else if (declared[1] !== slug) {
            fail(`${slug}: ${row.class}::SLUG is '${declared[1]}' — registry key and class disagree`);
        }
    }

    // 2. config invokable points at the same class
    if (configBlock) {
        if (!(row.invokable in configMap)) {
            fail(`${slug}: invokable '${row.invokable}' is not registered in module.config.php`);
        } else if (configMap[row.invokable] !== row.class) {
            fail(`${slug}: module.config.php maps '${row.invokable}' to ${configMap[row.invokable]}, registry says ${row.class}`);
        }
    }

    // 3-5. the block has somewhere to render, and agrees about the slug.
    //
    // Two shapes since H5: a row with a `shell` declares everything in the
    // registry and renders through `_generic` (twenty blocks); a row without
    // one keeps its own template, which is for the one block that does more
    // than declare (`on-this-day`).
    if (row.shell) {
        if (!existsSync(join(TEMPLATE_DIR, '_generic.phtml'))) {
            fail(`${slug}: declares a shell but view/common/block-layout/_generic.phtml is missing`);
        }
        if (row.declaresEmbedSlug) {
            fail(`${slug}: the shell declares embedSlug — _generic passes the registry key, so this can only disagree with it`);
        }
        if (existsSync(join(TEMPLATE_DIR, `${slug}.phtml`))) {
            fail(`${slug}: has BOTH a registry shell and a ${slug}.phtml — the template would never render`);
        }
        continue;
    }

    const template = join(TEMPLATE_DIR, `${slug}.phtml`);
    if (!existsSync(template)) {
        fail(`${slug}: no registry shell and no view/common/block-layout/${slug}.phtml — nothing to render`);
        continue;
    }
    const tpl = readText(template);
    const embed = /'embedSlug'\s*=>\s*'([a-z0-9-]+)'/.exec(tpl);
    if (row.embeddable && !embed) {
        fail(`${slug}: registry marks it embeddable but the template declares no embedSlug`);
    } else if (!row.embeddable && embed) {
        fail(`${slug}: registry marks it NOT embeddable but the template declares embedSlug '${embed[1]}'`);
    } else if (embed && embed[1] !== slug) {
        fail(`${slug}: template embedSlug is '${embed[1]}' — the embed route would look for a partial of that name`);
    }
}

// Reverse direction: nothing registered outside the registry.
for (const [invokable, cls] of Object.entries(configMap)) {
    if (!slugs.some((s) => registry[s].invokable === invokable)) {
        fail(`module.config.php registers '${invokable}' => ${cls}, which is not in BlockRegistry`);
    }
}
for (const file of readdirSync(LAYOUT_DIR)) {
    if (!file.endsWith('.php') || file.startsWith('Abstract')) continue;
    const cls = file.replace(/\.php$/, '');
    if (!slugs.some((s) => registry[s].class === cls)) {
        fail(`src/Site/BlockLayout/${file} is not in BlockRegistry`);
    }
}

// 6-7. Bundle manifest ↔ whoever names a bundle.
//
// Since H5 that is two places: the registry's `shell` arrays for the twenty
// generic blocks, and the templates for `on-this-day` plus the resource-page
// ones.
const manifest = loadManifest(MANIFEST_PATH, { optional: true });
if (!manifest || !manifest.blocks) {
    fail('asset/js/bundles.json is missing or has no "blocks" — the shells load bundles from it');
} else {
    const named = new Set();
    for (const slug of slugs) {
        const bundle = registry[slug].bundle;
        if (!bundle) continue;
        named.add(bundle);
        if (!(bundle in manifest.blocks)) {
            fail(`BlockRegistry '${slug}': bundle '${bundle}' is not in asset/js/bundles.json`);
        }
    }
    const templateFiles = [];
    for (const dir of [TEMPLATE_DIR, ...RESOURCE_TEMPLATE_DIRS]) {
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir)) {
            if (file.endsWith('.phtml')) templateFiles.push(join(dir, file));
        }
    }
    for (const file of templateFiles) {
        const src = readText(file);
        const rel = file.slice(ROOT.length + 1);
        if (/'(panels|orchestrator)'\s*=>/.test(src)) {
            fail(`${rel}: declares 'panels' / 'orchestrator' — since v1.62.0 a template names its bundle ('bundle' => …) and asset/js/bundles.json holds the file list`);
        }
        const m = /'bundle'\s*=>\s*'([^']+)'/.exec(src);
        if (!m) continue;
        named.add(m[1]);
        if (!(m[1] in manifest.blocks)) {
            fail(`${rel}: bundle '${m[1]}' is not in asset/js/bundles.json`);
        }
    }
    for (const name of Object.keys(manifest.blocks)) {
        if (!named.has(name)) fail(`asset/js/bundles.json: blocks.${name} is loaded by no template`);
    }
}

// 8-9. The asset declaration inside each shell.
const flags = readAssetPlanFlags();
for (const [slug, row] of Object.entries(registry)) {
    if (row.shellBlockCss) {
        fail(`${slug}: 'blockCss' sits on the shell, not inside 'assets' — _generic forwards only `
            + "'assets' to the asset partial, so the sheet is silently never loaded "
            + `(${registryLine(slug, '\n' + ' '.repeat(16) + "'blockCss'")})`);
    }
    for (const sheet of row.blockCss) {
        if (!existsSync(join(BLOCK_CSS_DIR, `${sheet}.css`))) {
            fail(`${slug}: blockCss '${sheet}' has no asset/css/blocks/${sheet}.css `
                + `(${registryLine(slug, `'${sheet}'`)})`);
        }
    }
    for (const flag of row.needs) {
        if (!flags.has(flag)) {
            fail(`${slug}: needs '${flag}' is not in AssetPlan::FLAGS (${[...flags].join(', ')}) — `
                + `a misspelt flag loads nothing (${registryLine(slug, `'${flag}'`)})`);
        }
    }
}

/**
 * `AssetPlan::FLAGS`, read from the source: `public const FLAGS = [ 'a', … ];`,
 * a flat list of single-quoted strings by contract (its docblock says so).
 */
function readAssetPlanFlags() {
    const src = existsSync(ASSET_PLAN) ? readText(ASSET_PLAN) : '';
    const block = /public const FLAGS\s*=\s*\[([\s\S]*?)\];/.exec(src);
    if (!block) {
        fail('src/Site/AssetPlan.php: `public const FLAGS = [ … ];` not found — the needs check '
            + 'has nothing to check against');
        return new Set();
    }
    const list = new Set([...block[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1]));
    if (!list.size) fail('src/Site/AssetPlan.php: AssetPlan::FLAGS parsed as empty');
    return list;
}

/** `src/Site/BlockRegistry.php:<line>` of `needle` within the row of `slug`. */
function registryLine(slug, needle) {
    const src = readText(REGISTRY);
    const start = src.indexOf(`'${slug}' => [`);
    const found = start === -1 ? -1 : src.indexOf(needle, start);
    // A needle that opens with its line break points at the line after it.
    const at = found === -1 ? -1 : found + (needle.startsWith('\n') ? 1 : 0);
    const line = at === -1 ? '?' : src.slice(0, at).split('\n').length;
    return `src/Site/BlockRegistry.php:${line}`;
}

if (problems.length) {
    failAndExit(
        `block registry guard: ${problems.length} problem(s)`,
        problems,
        '\nThe slug is the spine: registry key = class SLUG = template filename = embedSlug.\n'
    );
}
console.log(`✓ block registry guard: ${slugs.length} blocks consistent, ${Object.keys((manifest && manifest.blocks) || {}).length} bundles named by a shell or a template, every blockCss and needs flag resolves`);
