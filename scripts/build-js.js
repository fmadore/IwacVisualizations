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
 * `svelte/compiler` and bundled ahead of the block's own files. It is not an
 * application: no router, no SvelteKit, one bundle per block, mounted by the
 * block's ordinary orchestrator. The Svelte runtime is NOT in the block
 * bundle: it ships once, in `dist/shared-svelte.min.js`, holding exactly the
 * runtime names the Svelte blocks import (scripts/lib/svelte-runtime.js
 * says how, and why a global rather than an import), and Site\AssetPlan
 * loads it ahead of any block with a Svelte entry. The entry points it may
 * provide are `svelteRuntime` in the manifest; a block importing any other
 * fails the build. Two rules
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
const svelteRuntime = require('./lib/svelte-runtime');
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
    // The shared Svelte runtime: built when some block compiles Svelte, from
    // the entry points `svelteRuntime` lists (scripts/lib/svelte-runtime.js).
    const runtimeEntries = manifest.svelteRuntime;
    const svelteBlocks = bundles.filter((b) => b.svelte);
    if (runtimeEntries !== undefined && (!Array.isArray(runtimeEntries)
        || runtimeEntries.some((e) => typeof e !== 'string' || !svelteRuntime.SVELTE_SPECIFIER.test(e) || e === 'svelte/compiler'))) {
        problems.push('svelteRuntime: must be a list of Svelte runtime entry points ("svelte", "svelte/internal/client", …)');
    } else if (svelteBlocks.length && !(runtimeEntries || []).length) {
        problems.push(`svelteRuntime: ${svelteBlocks.map((b) => b.name).join(', ')} compile Svelte, but no runtime entry point is listed`);
    }
    if (problems.length) {
        fail(`bundle manifest: ${problems.length} problem(s)`, problems,
            '\nThe load order lives in asset/js/bundles.json and nowhere else.\n');
    }
    const runtime = svelteBlocks.length
        ? { name: svelteRuntime.RUNTIME_BUNDLE, outfile: join(DIST_DIR, `${svelteRuntime.RUNTIME_BUNDLE}.min.js`), files: [], runtime: true, entries: runtimeEntries }
        : null;
    return { bundles, runtime };
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
let compilerModule = null;
const compiled = new Map();

function sveltePlugin() {
    // Loaded only when a bundle has a Svelte entry: the compiler is ESM-only
    // and large, and most bundles never need it.
    if (!compilerModule) compilerModule = import('svelte/compiler');
    const compiler = compilerModule;
    return {
        name: 'iwac-svelte',
        setup(build) {
            // Each component is compiled once per build run and the result
            // reused: the runtime scan (below) and the block bundle read the
            // same output.
            build.onLoad({ filter: /\.svelte$/ }, (args) => {
                if (!compiled.has(args.path)) compiled.set(args.path, compileComponent(compiler, args.path));
                return compiled.get(args.path);
            });
        },
    };
}

/** One component through svelte/compiler, as an esbuild onLoad result. */
async function compileComponent(compiler, path) {
    const { compile } = await compiler;
    const filename = posixRelative(ROOT, path);
    let out;
    try {
        out = compile(readFileSync(path, 'utf8'), {
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
    const errors = out.warnings.map((w) => ({
        text: `${w.code}: ${w.message}`,
        location: w.start ? { file: filename, line: w.start.line, column: w.start.column } : { file: filename },
    }));
    if (out.css && out.css.code.trim()) {
        errors.push({
            text: 'a component carries a <style> block — block styles live in asset/css/blocks/, where the lints read them',
            location: { file: filename },
        });
    }
    if (errors.length) return { errors };
    return {
        contents: `${out.js.code}\n//# sourceMappingURL=${out.js.map.toUrl()}`,
        loader: 'js',
        resolveDir: dirname(path),
    };
}

/** The resolve options every Svelte build shares (see buildBundle). */
const SVELTE_BUILD = { target: ['es2020'], conditions: ['svelte', 'production'] };

/**
 * Refuse a Svelte entry point the shared runtime does not list, wherever a
 * block module imports it.
 */
function onSvelteSpecifier(build, entries, resolved) {
    build.onResolve({ filter: svelteRuntime.SVELTE_SPECIFIER }, (args) => {
        if (args.namespace === 'iwac-svelte-runtime') return undefined;
        if (!entries.includes(args.path)) {
            return {
                errors: [{
                    text: `'${args.path}' is not provided by the shared Svelte runtime — add it to "svelteRuntime" in asset/js/bundles.json (the runtime then carries what the blocks use of it)`,
                }],
            };
        }
        return resolved(args.path);
    });
}

/**
 * Pass 1, for every Svelte block: follow its entry's imports with Svelte
 * left external, then scan every module it reached (components as
 * compiled) for the runtime names it uses. Returns the per-block usage and
 * the inputs reached, for the coverage check.
 */
async function analyseSvelte(svelteBundles, entries) {
    const perBundle = new Map();
    const inputs = new Set();
    const problems = [];
    for (const bundle of svelteBundles) {
        let result;
        try {
            result = await esbuild.build({
                stdin: { contents: `import './${bundle.svelte}';`, resolveDir: SRC_DIR, sourcefile: `${bundle.name}.svelte-scan.js` },
                plugins: [
                    sveltePlugin(),
                    { name: 'iwac-svelte-external', setup: (build) => onSvelteSpecifier(build, entries, (path) => ({ path, external: true })) },
                ],
                bundle: true,
                write: false,
                metafile: true,
                format: 'esm',
                logLevel: 'silent',
                ...SVELTE_BUILD,
            });
        } catch (err) {
            problems.push(`${bundle.name}: ${err.message}`);
            continue;
        }
        const usage = new Map();
        for (const input of Object.keys(result.metafile.inputs)) {
            const abs = join(process.cwd(), input);
            if (!abs.startsWith(SVELTE_DIR + '/')) continue;
            inputs.add(input);
            const label = posixRelative(ROOT, abs);
            const code = abs.endsWith('.svelte') ? (await compiled.get(abs)).contents : readFileSync(abs, 'utf8');
            try {
                svelteRuntime.mergeUsage(usage, svelteRuntime.scanModule(code, label));
            } catch (err) {
                problems.push(...(err.svelteProblems || [`${label}: ${err.message}`]).map((p) => `${bundle.name}: ${p}`));
            }
        }
        perBundle.set(bundle.name, usage);
    }
    return { perBundle, inputs, problems };
}

/**
 * Pass 2, for one Svelte block: `svelte` and `svelte/*` resolve to virtual
 * modules that read the names this block uses off the shared runtime.
 */
function runtimeImportPlugin(bundle, entries, usage) {
    return {
        name: 'iwac-svelte-runtime',
        setup(build) {
            onSvelteSpecifier(build, entries, (path) => ({ path, namespace: 'iwac-svelte-runtime' }));
            build.onLoad({ filter: /.*/, namespace: 'iwac-svelte-runtime' }, (args) => ({
                contents: svelteRuntime.externalModuleSource(args.path, (usage.get(args.path) || { names: [] }).names, bundle.name),
                loader: 'js',
            }));
        },
    };
}

/** The shared runtime: the union of every Svelte block's names. */
async function buildRuntime(runtime, union) {
    const result = await esbuild.build({
        stdin: { contents: svelteRuntime.runtimeEntrySource(union), resolveDir: ROOT, sourcefile: `${runtime.name}.entry.js` },
        bundle: true,
        minify: true,
        sourcemap: true,
        charset: 'utf8',
        legalComments: 'none',
        logLevel: 'silent',
        outfile: runtime.outfile,
        write: true,
        metafile: true,
        ...SVELTE_BUILD,
    });
    if (result.warnings.length) {
        throw new Error(result.warnings.map((w) => w.text).join('; '));
    }
    const out = Object.entries(result.metafile.outputs).find(([k]) => k.endsWith('.min.js'));
    return { outfile: runtime.outfile, bytes: out ? out[1].bytes : statSync(runtime.outfile).size, inputs: Object.keys(result.metafile.inputs) };
}

async function buildBundle(bundle, locale, svelte) {
    const imports = bundle.svelte ? [bundle.svelte, ...bundle.files] : bundle.files;
    const entry = imports.map((f) => `import './${f}';`).join('\n');
    const outfile = locale ? bundle.outfile.replace(/\.min\.js$/, `.${locale}.min.js`) : bundle.outfile;
    const plugins = locale ? [localePlugin(locale)] : [];
    if (bundle.svelte) {
        plugins.push(runtimeImportPlugin(bundle, svelte.entries, svelte.perBundle.get(bundle.name)));
        plugins.push(sveltePlugin());
    }
    const result = await esbuild.build({
        stdin: { contents: entry, resolveDir: SRC_DIR, sourcefile: `${bundle.name}.entry.js` },
        plugins,
        bundle: true,
        minify: true,
        sourcemap: true,
        // Nothing is lowered — the sources are ES5 — but the target caps what
        // the minifier may emit, so the bundles run wherever the sources did.
        // A Svelte bundle is the exception: the Svelte 5 runtime it reads
        // needs a modern browser anyway (it is built on Proxy), so lowering
        // the compiled components to ES2015 would only add bytes.
        target: ['es2015'],
        conditions: [],
        // The Svelte runtime's production build, without its dev checks.
        ...(bundle.svelte ? SVELTE_BUILD : {}),
        charset: 'utf8',
        legalComments: 'none',
        logLevel: 'silent',
        outfile,
        write: true,
        metafile: true,
    });
    if (result.warnings.length) {
        // In a Svelte bundle a warning is an error: the one that matters —
        // "Import "x" will always be undefined" — is a runtime name the scan
        // did not find, which would reach the page as `undefined`.
        if (bundle.svelte) throw new Error(result.warnings.map((w) => `${w.location ? `${w.location.file}:${w.location.line}: ` : ''}${w.text}`).join('; '));
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

const report = (outfile, files, inBytes, bytes) => {
    // Signed: a bundle can grow over its sources, and the runtime has none.
    const change = inBytes ? ((bytes / inBytes - 1) * 100).toFixed(1) : null;
    console.log(
        `${relative(ROOT, outfile).padEnd(52)} ${String(files).padStart(3)} files ${String(inBytes).padStart(7)}B -> ${String(bytes).padStart(6)}B  `
        + (change === null ? '(Svelte runtime, from node_modules)' : `(${change > 0 ? '+' : ''}${change}%)`)
    );
};

(async () => {
    const { bundles, runtime } = readManifest();
    // A clean slate: a bundle renamed or removed from the manifest must not
    // leave its old file behind to be served.
    if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true });
    mkdirSync(join(DIST_DIR, 'blocks'), { recursive: true });
    mkdirSync(join(DIST_DIR, 'panels'), { recursive: true });

    let bytesIn = 0;
    let bytesOut = 0;
    let built = 0;
    const localized = [];

    // The Svelte blocks first: what they import from Svelte decides what the
    // shared runtime carries, and what each block's bundle reads from it.
    const svelte = { entries: runtime ? runtime.entries : [], perBundle: new Map(), inputs: new Set() };
    if (runtime) {
        const analysis = await analyseSvelte(bundles.filter((b) => b.svelte), runtime.entries);
        if (analysis.problems.length) {
            for (const p of analysis.problems) console.error(`FAIL ${p}`);
            process.exitCode = 1;
            return;
        }
        Object.assign(svelte, analysis);
        const union = new Map();
        for (const usage of analysis.perBundle.values()) svelteRuntime.mergeUsage(union, usage);
        try {
            const { outfile, bytes } = await buildRuntime(runtime, union);
            report(outfile, 0, 0, bytes);
            bytesOut += bytes;
            built += 1;
        } catch (err) {
            console.error(`FAIL ${runtime.name}: ${err.message}`);
            process.exitCode = 1;
        }
    }

    for (const bundle of bundles) {
        let inBytes = bundle.files.reduce((n, f) => n + statSync(join(SRC_DIR, f)).size, 0);
        let builds;
        try {
            const perLocale = bundle.files.some((f) => hasDictionaries(readFileSync(join(SRC_DIR, f), 'utf8'), f));
            if (perLocale) localized.push(bundle.name);
            builds = [];
            for (const locale of perLocale ? LOCALES : [null]) builds.push(await buildBundle(bundle, locale, svelte));
        } catch (err) {
            console.error(`FAIL ${bundle.name}: ${err.message}`);
            process.exitCode = 1;
            continue;
        }
        built += 1;
        if (bundle.svelte) {
            // What the module wrote, components included.
            inBytes = builds[0].inputs
                .filter((p) => !p.startsWith('node_modules/') && existsSync(join(process.cwd(), p)))
                .reduce((n, p) => n + statSync(join(process.cwd(), p)).size, 0);
        }
        // Totals count what one page downloads: one variant of each bundle.
        bytesIn += inBytes;
        bytesOut += builds[0].bytes;
        for (const { outfile, bytes } of builds) report(outfile, bundle.files.length, inBytes, bytes);
    }
    for (const orphan of svelteCoverage(svelte.inputs)) {
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
        `\n${built} bundles (${localized.length} per locale): ${bytesIn}B -> ${bytesOut}B per page set `
        + `(-${totalPct}%, saved ${bytesIn - bytesOut}B) in ${relative(ROOT, DIST_DIR)}/`
    );
})();
