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
 * A block entry may also name a Svelte entry — `{ svelte:
 * "svelte/<block>/index.js", files: [...] }` — an ES module under
 * asset/js/svelte/ whose `.svelte` components are compiled here with
 * `svelte/compiler` and bundled, with the Svelte runtime, ahead of the
 * block's own files. It is not an application: no router, no SvelteKit, one
 * bundle per block, mounted by the block's ordinary orchestrator. Two rules
 * keep it inside the module's gates. A component may not carry a `<style>`:
 * the block's sheet stays in asset/css/blocks/, where stylelint, the theme
 * token guard and the dead-class check read it. And any compiler warning —
 * most of them accessibility checks — fails the build. Every file under
 * asset/js/svelte/ must be reached from some entry, or the build fails, as
 * an unbundled classic source does.
 *
 * Usage: node scripts/build-js.js
 */

const { readFileSync, statSync, mkdirSync, rmSync, existsSync, writeFileSync } = require('fs');
const { join, relative, dirname } = require('path');
const esbuild = require('esbuild');
const { sourceFiles, posixRelative } = require('./lib/fs');
const { MANIFEST_PATH, loadManifest, ownFiles, usedPanelSets, svelteEntry } = require('./lib/manifest');
const { fail } = require('./lib/report');
const { LOCALES, hasDictionaries, keepLocale } = require('./i18n-strip');

const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'asset', 'js');
const DIST_DIR = join(SRC_DIR, 'dist');
const SVELTE_DIR = join(SRC_DIR, 'svelte');

/**
 * Every bundleable classic source under asset/js/, as manifest-relative
 * paths. asset/js/svelte/ is not walked: its modules are reached through a
 * Svelte entry's imports, and `svelteCoverage` checks them after the build.
 */
function walk() {
    return sourceFiles(SRC_DIR, '.js', { skipDir: (p) => p === DIST_DIR || p === SVELTE_DIR })
        .map((p) => posixRelative(SRC_DIR, p));
}

/** Validate the manifest against the tree; returns the list of bundles. */
function readManifest() {
    const manifest = loadManifest(MANIFEST_PATH);
    const problems = [];
    const sources = new Set(walk());
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
        const files = ownFiles(entry);
        const uses = usedPanelSets(entry);
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
        const svelte = svelteEntry(entry);
        if (svelte !== null) {
            if (!svelte.startsWith(`svelte/${name}/`) || !svelte.endsWith('.js')) {
                problems.push(`blocks.${name}: svelte entry ${svelte} must be a .js module under svelte/${name}/`);
            } else if (!existsSync(join(SRC_DIR, svelte))) {
                problems.push(`blocks.${name}: svelte entry ${svelte} does not exist under asset/js/`);
            }
        }
        add(`blocks/${name}`, join(DIST_DIR, 'blocks', `${name}.min.js`), files);
        if (svelte !== null) bundles[bundles.length - 1].svelte = svelte;
    }
    for (const f of sources) {
        if (!seen.has(f)) problems.push(`${f} is in no bundle — add it to asset/js/bundles.json (or delete it)`);
    }
    if (problems.length) {
        fail(`bundle manifest: ${problems.length} problem(s)`, problems,
            '\nThe load order lives in asset/js/bundles.json and nowhere else.\n');
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

/**
 * An esbuild plugin that compiles `.svelte` components with Svelte's own
 * compiler. Warnings are errors, and so is a `<style>` block (see the file
 * header for why both).
 */
function sveltePlugin() {
    // Loaded only for a bundle with a Svelte entry: the compiler is ESM-only
    // and large, and most bundles never need it.
    const compiler = import('svelte/compiler');
    return {
        name: 'iwac-svelte',
        setup(build) {
            build.onLoad({ filter: /\.svelte$/ }, async (args) => {
                const { compile } = await compiler;
                const filename = posixRelative(ROOT, args.path);
                let compiled;
                try {
                    compiled = compile(readFileSync(args.path, 'utf8'), {
                        filename,
                        generate: 'client',
                        dev: false,
                        css: 'external',
                        runes: true,
                        // No `window.__svelte` version registry on the host page.
                        discloseVersion: false,
                    });
                } catch (err) {
                    const at = err.start ? { file: filename, line: err.start.line, column: err.start.column } : { file: filename };
                    return { errors: [{ text: err.message, location: at }] };
                }
                const errors = compiled.warnings.map((w) => ({
                    text: `${w.code}: ${w.message}`,
                    location: w.start ? { file: filename, line: w.start.line, column: w.start.column } : { file: filename },
                }));
                if (compiled.css && compiled.css.code.trim()) {
                    errors.push({
                        text: 'a component carries a <style> block — block styles live in asset/css/blocks/, where the lints read them',
                        location: { file: filename },
                    });
                }
                if (errors.length) return { errors };
                return {
                    contents: `${compiled.js.code}\n//# sourceMappingURL=${compiled.js.map.toUrl()}`,
                    loader: 'js',
                    resolveDir: dirname(args.path),
                };
            });
        },
    };
}

async function buildBundle(bundle, locale) {
    const imports = bundle.svelte ? [bundle.svelte, ...bundle.files] : bundle.files;
    const entry = imports.map((f) => `import './${f}';`).join('\n');
    const outfile = locale ? bundle.outfile.replace(/\.min\.js$/, `.${locale}.min.js`) : bundle.outfile;
    const plugins = locale ? [localePlugin(locale)] : [];
    if (bundle.svelte) plugins.push(sveltePlugin());
    const result = await esbuild.build({
        stdin: { contents: entry, resolveDir: SRC_DIR, sourcefile: `${bundle.name}.entry.js` },
        plugins,
        bundle: true,
        minify: true,
        sourcemap: true,
        // Nothing is lowered — the sources are ES5 — but the target caps what
        // the minifier may emit, so the bundles run wherever the sources did.
        // A Svelte bundle is the exception: the Svelte 5 runtime needs a
        // modern browser anyway (it is built on Proxy), so lowering its
        // syntax to ES2015 would only add bytes.
        target: [bundle.svelte ? 'es2020' : 'es2015'],
        // The Svelte runtime's production build, without its dev checks.
        conditions: bundle.svelte ? ['svelte', 'production'] : [],
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
    return { outfile, bytes: out ? out[1].bytes : statSync(outfile).size, inputs: Object.keys(result.metafile.inputs) };
}

/**
 * Files under asset/js/svelte/ that no Svelte bundle compiled — the Svelte
 * twin of the manifest's "in no bundle" check, read off esbuild's metafile
 * (whose input paths are relative to the working directory, the repo root).
 */
function svelteCoverage(inputs) {
    if (!existsSync(SVELTE_DIR)) return [];
    const reached = new Set([...inputs].map((p) => posixRelative(ROOT, join(process.cwd(), p))));
    const orphans = [];
    for (const ext of ['.js', '.svelte']) {
        for (const file of sourceFiles(SVELTE_DIR, ext)) {
            if (!reached.has(posixRelative(ROOT, file))) {
                orphans.push(`${posixRelative(SRC_DIR, file)} is reached by no Svelte entry in asset/js/bundles.json (or delete it)`);
            }
        }
    }
    return orphans;
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
    const svelteInputs = new Set();
    for (const bundle of bundles) {
        let inBytes = bundle.files.reduce((n, f) => n + statSync(join(SRC_DIR, f)).size, 0);
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
        if (bundle.svelte) {
            for (const input of builds[0].inputs) svelteInputs.add(input);
            // What the module wrote, components included; the Svelte runtime
            // it bundles is what the output adds on top.
            inBytes = builds[0].inputs
                .filter((p) => !p.startsWith('node_modules/') && existsSync(join(process.cwd(), p)))
                .reduce((n, p) => n + statSync(join(process.cwd(), p)).size, 0);
        }
        // Totals count what one page downloads: one variant of each bundle.
        bytesIn += inBytes;
        bytesOut += builds[0].bytes;
        for (const { outfile, bytes } of builds) {
            // Signed: a Svelte bundle grows, because it carries the runtime.
            const change = ((bytes / inBytes - 1) * 100).toFixed(1);
            console.log(
                `${relative(ROOT, outfile).padEnd(52)} ${String(bundle.files.length).padStart(3)} files ${String(inBytes).padStart(7)}B -> ${String(bytes).padStart(6)}B  (${change > 0 ? '+' : ''}${change}%)`
            );
        }
    }
    for (const orphan of svelteCoverage(svelteInputs)) {
        console.error(`FAIL ${orphan}`);
        process.exitCode = 1;
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
