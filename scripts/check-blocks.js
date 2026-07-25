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
 *   3. `view/common/block-layout/<slug>.phtml` exists — the embed route
 *      resolves the partial by slug, so a mismatch is a 500 on every embed
 *      of that block (exactly the v1.21 `press-reprints-detector` bug);
 *   4. that template's `embedSlug` (when it declares one) equals the slug;
 *   5. embeddable blocks declare an `embedSlug`, non-embeddable ones don't.
 *
 * And in the other direction: every `block_layouts` invokable in the config
 * and every non-abstract class in `src/Site/BlockLayout/` is in the registry,
 * so a block cannot be added to one place and forgotten in the others.
 *
 * Usage: node scripts/check-blocks.js
 * Exit code 1 on any inconsistency (with the offending slug), else 0.
 */
const { readdirSync, readFileSync, existsSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const REGISTRY = join(ROOT, 'src', 'Site', 'BlockRegistry.php');
const CONFIG = join(ROOT, 'config', 'module.config.php');
const LAYOUT_DIR = join(ROOT, 'src', 'Site', 'BlockLayout');
const TEMPLATE_DIR = join(ROOT, 'view', 'common', 'block-layout');

const problems = [];
const fail = (msg) => problems.push(msg);

/** Parse BlockRegistry::BLOCKS into { slug: {invokable, class, embeddable} }. */
function parseRegistry() {
    const src = readFileSync(REGISTRY, 'utf8');
    const body = /const BLOCKS = \[([\s\S]*?)\n    \];/.exec(src);
    if (!body) {
        fail('BlockRegistry::BLOCKS not found or not in the expected shape');
        return {};
    }
    const out = {};
    const rowRe = /'([a-z0-9-]+)'\s*=>\s*\[([\s\S]*?)\n        \]/g;
    let m;
    while ((m = rowRe.exec(body[1])) !== null) {
        const [, slug, row] = m;
        const pick = (key) => {
            const v = new RegExp(`'${key}'\\s*=>\\s*(?:'([^']*)'|BlockLayout\\\\(\\w+)::class|(true|false))`).exec(row);
            return v ? (v[1] ?? v[2] ?? v[3]) : null;
        };
        out[slug] = {
            invokable: pick('invokable'),
            class: pick('class'),
            embeddable: pick('embeddable') !== 'false',
        };
    }
    return out;
}

const registry = parseRegistry();
const slugs = Object.keys(registry);
if (!slugs.length) fail('BlockRegistry::BLOCKS parsed as empty');

const configSrc = existsSync(CONFIG) ? readFileSync(CONFIG, 'utf8') : '';
const configBlock = /'block_layouts'\s*=>\s*\[[\s\S]*?'invokables'\s*=>\s*\[([\s\S]*?)\n        \]/.exec(configSrc);
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
        const declared = /const SLUG\s*=\s*'([a-z0-9-]+)'/.exec(readFileSync(classFile, 'utf8'));
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

    // 3-5. template exists and agrees about the slug
    const template = join(TEMPLATE_DIR, `${slug}.phtml`);
    if (!existsSync(template)) {
        fail(`${slug}: view/common/block-layout/${slug}.phtml is missing (embed route resolves the partial by slug)`);
        continue;
    }
    const tpl = readFileSync(template, 'utf8');
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

if (problems.length) {
    console.error(`\n✗ block registry guard: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nThe slug is the spine: registry key = class SLUG = template filename = embedSlug.\n');
    process.exit(1);
}
console.log(`✓ block registry guard: ${slugs.length} blocks consistent`);
