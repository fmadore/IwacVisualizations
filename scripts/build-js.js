#!/usr/bin/env node
/**
 * Bundle the module's JavaScript, in the order the manifest says.
 *
 * `asset/js/bundles.json` is the one place the load order lives. It names
 * six shared bundles — `core` (every block), `charts`, `ui`, `layout`, `map`,
 * `d3` (each behind a `$needs` flag in view/common/iwac-assets.phtml) —
 * panel sets two blocks share (`panels.person`: the person and entity
 * dashboards draw the same eleven panels), and one bundle per block: its
 * panel modules, in load order, then the orchestrator last, or `{ uses:
 * [panel sets], files }`. Each entry is a list of source paths under
 * asset/js/, and each bundle becomes `asset/js/dist/shared-<name>.min.js`,
 * `dist/panels/<name>.min.js` or `dist/blocks/<name>.min.js` plus a `.map`.
 *
 * Until v1.62.0 every source was minified to a `.min.js` sibling and the
 * partial listed them one by one — about thirty-three `<script>` tags per
 * block, the order held in PHP where nothing could check it against the
 * files. Now a block is three to seven requests and the order is data.
 *
 * Every source is an IIFE that reads and writes `window.IWACVis`, so a bundle
 * is a concatenation with each file in its own scope — esbuild's bundling of
 * side-effect imports does exactly that, minifies, and writes a sourcemap
 * that points back at the original files with their contents embedded.
 * Nothing is transformed: the sources are ES5 and stay so.
 *
 * Shared code never goes into a block bundle: the loader de-duplicates by
 * URL, so two blocks on one page share `shared-core` once, but a shared file
 * inlined into two block bundles would execute twice. The checks below
 * enforce that, and that every source under asset/js/ is in exactly one
 * bundle and every listed source exists — the build fails otherwise, which
 * is the point of having the order in data.
 *
 * A bundle that carries translation dictionaries is built once per locale —
 * `<name>.en.min.js`, `<name>.fr.min.js` — each with the other locale's
 * tables emptied (scripts/i18n-strip.js), and listed in the generated
 * `dist/locales.json`. The asset partial hands the loader both URLs and the
 * loader requests the one matching the page, so an English page no longer
 * downloads the French half of every dictionary, and vice versa.
 *
 * Usage: node scripts/build-js.js
 */

const { readdirSync, readFileSync, statSync, mkdirSync, rmSync, existsSync, writeFileSync } = require('fs');
const { join, relative } = require('path');
const esbuild = require('esbuild');
const { LOCALES, hasDictionaries, keepLocale } = require('./i18n-strip');

const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'asset', 'js');
const DIST_DIR = join(SRC_DIR, 'dist');
const MANIFEST = join(SRC_DIR, 'bundles.json');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            if (p === DIST_DIR) continue;
            walk(p, out);
        } else if (p.endsWith('.js') && !p.endsWith('.min.js')) {
            out.push(relative(SRC_DIR, p).split('\\').join('/'));
        }
    }
    return out;
}

/** Validate the manifest against the tree; returns the list of bundles. */
function readManifest() {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const problems = [];
    const sources = new Set(walk(SRC_DIR));
    const seen = new Map();
    const bundles = [];

    const add = (name, outfile, files) => {
        if (!Array.isArray(files) || !files.length) {
            problems.push(`${name}: empty bundle`);
            return;
        }
        for (const f of files) {
            if (!sources.has(f)) problems.push(`${name}: ${f} does not exist under asset/js/`);
            if (seen.has(f)) problems.push(`${name}: ${f} is already in ${seen.get(f)} — a source belongs to one bundle`);
            seen.set(f, name);
        }
        bundles.push({ name, outfile, files });
    };

    for (const [name, files] of Object.entries(manifest.shared || {})) {
        add(`shared-${name}`, join(DIST_DIR, `shared-${name}.min.js`), files);
    }
    const panelSets = manifest.panels || {};
    for (const [name, files] of Object.entries(panelSets)) {
        add(`panels/${name}`, join(DIST_DIR, 'panels', `${name}.min.js`), files);
    }
    for (const [name, entry] of Object.entries(manifest.blocks || {})) {
        const files = Array.isArray(entry) ? entry : (entry && entry.files) || [];
        const uses = Array.isArray(entry) ? [] : (entry && entry.uses) || [];
        for (const u of uses) {
            if (!panelSets[u]) problems.push(`blocks.${name}: uses '${u}', which is not a panel set in "panels"`);
        }
        for (const f of files) {
            if (f.startsWith('charts/shared/') || !f.startsWith('charts/')) {
                problems.push(`blocks.${name}: ${f} is shared code — it belongs in a shared bundle, never inlined per block`);
            }
        }
        if (files.length && files[files.length - 1] !== `charts/${name}.js`) {
            problems.push(`blocks.${name}: the orchestrator charts/${name}.js must be the LAST entry`);
        }
        add(`blocks/${name}`, join(DIST_DIR, 'blocks', `${name}.min.js`), files);
    }
    for (const f of sources) {
        if (!seen.has(f)) problems.push(`${f} is in no bundle — add it to asset/js/bundles.json (or delete it)`);
    }
    if (problems.length) {
        console.error(`\n✗ bundle manifest: ${problems.length} problem(s)\n`);
        for (const p of problems) console.error(`  ${p}`);
        console.error('\nThe load order lives in asset/js/bundles.json and nowhere else.\n');
        process.exit(1);
    }
    return bundles;
}

/** An esbuild plugin that loads every source with only `locale`'s dictionaries. */
function localePlugin(locale) {
    return {
        name: 'iwac-locale',
        setup(build) {
            build.onLoad({ filter: /\.js$/ }, (args) => {
                if (!args.path.startsWith(SRC_DIR)) return undefined;
                const source = readFileSync(args.path, 'utf8');
                return { contents: keepLocale(source, locale, relative(ROOT, args.path)), loader: 'js' };
            });
        },
    };
}

async function buildBundle(bundle, locale) {
    const entry = bundle.files.map((f) => `import './${f}';`).join('\n');
    const outfile = locale ? bundle.outfile.replace(/\.min\.js$/, `.${locale}.min.js`) : bundle.outfile;
    const result = await esbuild.build({
        stdin: { contents: entry, resolveDir: SRC_DIR, sourcefile: `${bundle.name}.entry.js` },
        plugins: locale ? [localePlugin(locale)] : [],
        bundle: true,
        minify: true,
        sourcemap: true,
        // Nothing is lowered — the sources are ES5 — but the target caps what
        // the minifier may emit, so the bundles run wherever the sources did.
        target: ['es2015'],
        charset: 'utf8',
        legalComments: 'none',
        logLevel: 'silent',
        outfile,
        write: true,
        metafile: true,
    });
    if (result.warnings.length) {
        for (const w of result.warnings) console.warn(`  warning (${bundle.name}): ${w.text}`);
    }
    const out = Object.entries(result.metafile.outputs).find(([k]) => k.endsWith('.min.js'));
    return { outfile, bytes: out ? out[1].bytes : statSync(outfile).size };
}

(async () => {
    const bundles = readManifest();
    // A clean slate: a bundle renamed or removed from the manifest must not
    // leave its old file behind to be served.
    if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true });
    mkdirSync(join(DIST_DIR, 'blocks'), { recursive: true });
    mkdirSync(join(DIST_DIR, 'panels'), { recursive: true });

    let bytesIn = 0;
    let bytesOut = 0;
    const localized = [];
    for (const bundle of bundles) {
        const inBytes = bundle.files.reduce((n, f) => n + statSync(join(SRC_DIR, f)).size, 0);
        let builds;
        try {
            const perLocale = bundle.files.some((f) => hasDictionaries(readFileSync(join(SRC_DIR, f), 'utf8'), f));
            if (perLocale) localized.push(bundle.name);
            builds = [];
            for (const locale of perLocale ? LOCALES : [null]) builds.push(await buildBundle(bundle, locale));
        } catch (err) {
            console.error(`FAIL ${bundle.name}: ${err.message}`);
            process.exitCode = 1;
            continue;
        }
        // Totals count what one page downloads: one variant of each bundle.
        bytesIn += inBytes;
        bytesOut += builds[0].bytes;
        for (const { outfile, bytes } of builds) {
            const pct = ((1 - bytes / inBytes) * 100).toFixed(1);
            console.log(
                `${relative(ROOT, outfile).padEnd(52)} ${String(bundle.files.length).padStart(3)} files ${String(inBytes).padStart(7)}B -> ${String(bytes).padStart(6)}B  (-${pct}%)`
            );
        }
    }
    // Which bundles the partial must request per locale. Generated, committed
    // with the bundles, and read by Site\AssetPlan — so the PHP side cannot
    // name a variant the build did not write.
    writeFileSync(
        join(DIST_DIR, 'locales.json'),
        JSON.stringify({ locales: LOCALES, bundles: localized }, null, 2) + '\n'
    );
    const totalPct = bytesIn ? ((1 - bytesOut / bytesIn) * 100).toFixed(1) : '0.0';
    console.log(
        `\n${bundles.length} bundles (${localized.length} per locale): ${bytesIn}B -> ${bytesOut}B per page set `
        + `(-${totalPct}%, saved ${bytesIn - bytesOut}B) in ${relative(ROOT, DIST_DIR)}/`
    );
})();
