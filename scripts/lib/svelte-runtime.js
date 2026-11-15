'use strict';
/**
 * The shared Svelte runtime: one copy per page, however many Svelte blocks.
 *
 * Until it existed each Svelte block bundle (the Pipeline explainer, the
 * Collection Introduction) inlined its own copy of the runtime, so a page
 * carrying both downloaded and executed it twice — and ran two separate
 * reactivity systems side by side. Now `dist/shared-svelte.min.js` carries
 * it once, and the block bundles read it from a global.
 *
 * The bundles are classic scripts, executed in order by the loader
 * (asset/js/iwac-lazy.js), not ES modules, so the runtime cannot be shared
 * by `import`. Instead:
 *
 *   1. Every module a Svelte block reaches is scanned (components after
 *      compilation) for what it imports from `svelte` and `svelte/*`: the
 *      named imports, and the members read off a namespace import — the
 *      compiler writes `import * as $ from 'svelte/internal/client'` and then
 *      `$.template(…)`, `$.append(…)`.
 *   2. The shared bundle imports exactly the union of those names and
 *      publishes them as `IWACVis.svelteRuntime[<entry point>][<name>]`.
 *      Only what some block uses is included: the whole of
 *      `svelte/internal/client` is ~114 KB minified, more than either block
 *      bundle used to weigh with its tree-shaken copy inside.
 *   3. Each block bundle resolves `svelte` and `svelte/*` to a small virtual
 *      module that reads that global and exports the names the block uses.
 *
 * Nothing about it is maintained by hand except the list of entry points
 * the runtime may provide (`svelteRuntime` in asset/js/bundles.json), and
 * nothing in a block's template or registry row names it:
 * `Site\AssetPlan::bundles()` adds `shared-svelte` to every block whose
 * manifest entry has a `svelte` entry. A block author writes ordinary
 * Svelte imports.
 *
 * The build fails, loudly, when a module imports an entry point the list
 * does not have, imports a default, re-exports from Svelte, imports Svelte
 * dynamically, or uses a namespace import as anything but `ns.name` — and,
 * independently of the scan, esbuild's own "no matching export" checks run
 * against the virtual modules with every warning promoted to an error, so a
 * name the scan missed cannot reach a bundle as `undefined`.
 *
 * The published values are the exports' values when the runtime ran, not
 * live bindings. That is sound for what the compiler emits — functions and
 * constants — and is why the scan refuses a namespace used as a value.
 */

const acorn = require('acorn');

/** The shared bundle's name, as AssetPlan and the dist path spell it. */
const RUNTIME_BUNDLE = 'shared-svelte';

/** The global the runtime publishes on (under window.IWACVis). */
const RUNTIME_GLOBAL = 'svelteRuntime';

/** `svelte` and every `svelte/<sub>` specifier. */
const SVELTE_SPECIFIER = /^svelte(\/.*)?$/;

/**
 * What one module imports from Svelte: Map(entry point → { names: Set,
 * sideEffect: boolean }). Throws an Error whose message says what the
 * runtime cannot share, for the build to report with the file.
 *
 * @param {string} code   ES module source (a component after compilation)
 * @param {string} label  the file, for messages
 */
function scanModule(code, label) {
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    const usage = new Map();
    const problems = [];
    const entry = (spec) => {
        if (!usage.has(spec)) usage.set(spec, { names: new Set(), sideEffect: false });
        return usage.get(spec);
    };
    const at = (node) => `${label}:${node.loc.start.line}:${node.loc.start.column + 1}`;
    // Local namespace binding → the entry point it stands for.
    const namespaces = new Map();

    for (const node of ast.body) {
        if (node.type === 'ImportDeclaration' && SVELTE_SPECIFIER.test(node.source.value)) {
            const spec = node.source.value;
            const record = entry(spec);
            if (!node.specifiers.length) record.sideEffect = true;
            for (const s of node.specifiers) {
                if (s.type === 'ImportSpecifier') {
                    record.names.add(s.imported.type === 'Identifier' ? s.imported.name : s.imported.value);
                } else if (s.type === 'ImportNamespaceSpecifier') {
                    namespaces.set(s.local.name, spec);
                } else {
                    problems.push(`${at(s)}: a default import from '${spec}' — Svelte's entry points have none; import by name`);
                }
            }
        } else if ((node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration')
            && node.source && SVELTE_SPECIFIER.test(node.source.value)) {
            problems.push(`${at(node)}: re-exports from '${node.source.value}' — import what you use instead; the shared runtime publishes names, not modules`);
        }
    }

    // Walk for namespace reads (`$.name`) and anything else that touches a
    // namespace binding or imports Svelte dynamically.
    const walk = (node, parent) => {
        if (!node || typeof node.type !== 'string') return;
        switch (node.type) {
            case 'ImportDeclaration':
                return;
            case 'ImportExpression':
                if (node.source.type === 'Literal' && SVELTE_SPECIFIER.test(String(node.source.value))) {
                    problems.push(`${at(node)}: a dynamic import of '${node.source.value}' — the shared runtime is static; import it at the top of the module`);
                }
                break;
            case 'MemberExpression':
                if (node.object.type === 'Identifier' && namespaces.has(node.object.name)) {
                    if (node.computed) {
                        problems.push(`${at(node)}: '${node.object.name}[…]' — a computed read off a Svelte namespace cannot be resolved at build time; write ${node.object.name}.name`);
                    } else {
                        entry(namespaces.get(node.object.name)).names.add(node.property.name);
                    }
                    return;
                }
                walk(node.object, node);
                if (node.computed) walk(node.property, node);
                return;
            case 'Property':
            case 'MethodDefinition':
            case 'PropertyDefinition':
                if (node.computed) walk(node.key, node);
                walk(node.value, node);
                return;
            case 'LabeledStatement':
                walk(node.body, node);
                return;
            case 'BreakStatement':
            case 'ContinueStatement':
                return;
            case 'Identifier':
                if (namespaces.has(node.name)) {
                    problems.push(`${at(node)}: the Svelte namespace '${node.name}' is used as a value — the shared runtime can only provide '${node.name}.name' reads`);
                }
                return;
            default:
                break;
        }
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'start' || key === 'end') continue;
            const value = node[key];
            if (Array.isArray(value)) value.forEach((v) => walk(v, node));
            else if (value && typeof value.type === 'string') walk(value, node);
        }
    };
    for (const node of ast.body) walk(node, null);

    if (problems.length) {
        const err = new Error(problems.join('\n'));
        err.svelteProblems = problems;
        throw err;
    }
    return usage;
}

/** Fold `from` (a scanModule result) into `into`. */
function mergeUsage(into, from) {
    for (const [spec, { names, sideEffect }] of from) {
        if (!into.has(spec)) into.set(spec, { names: new Set(), sideEffect: false });
        const record = into.get(spec);
        for (const n of names) record.names.add(n);
        if (sideEffect) record.sideEffect = true;
    }
    return into;
}

const sorted = (set) => [...set].sort();

/**
 * The shared bundle's entry module: import the union of every block's
 * names, publish them on `IWACVis.svelteRuntime`.
 */
function runtimeEntrySource(usage) {
    const lines = [];
    const published = [];
    let n = 0;
    for (const spec of sorted(usage.keys())) {
        const { names, sideEffect } = usage.get(spec);
        if (!names.size) {
            if (sideEffect) lines.push(`import ${JSON.stringify(spec)};`);
            published.push(`  ${JSON.stringify(spec)}: Object.freeze({}),`);
            continue;
        }
        const specifiers = [];
        const members = [];
        for (const name of sorted(names)) {
            const local = `__svelte${n++}`;
            specifiers.push(`${name} as ${local}`);
            members.push(`${JSON.stringify(name)}: ${local}`);
        }
        lines.push(`import { ${specifiers.join(', ')} } from ${JSON.stringify(spec)};`);
        published.push(`  ${JSON.stringify(spec)}: Object.freeze({ ${members.join(', ')} }),`);
    }
    lines.push(
        'const ns = (window.IWACVis = window.IWACVis || {});',
        `ns.${RUNTIME_GLOBAL} = Object.freeze({`,
        ...published,
        '});'
    );
    return lines.join('\n') + '\n';
}

/**
 * The virtual module a block bundle gets for one Svelte entry point: the
 * names it uses, read off the shared runtime.
 */
function externalModuleSource(spec, names, bundleName) {
    const lines = [
        `const R = window.IWACVis && window.IWACVis.${RUNTIME_GLOBAL} && window.IWACVis.${RUNTIME_GLOBAL}[${JSON.stringify(spec)}];`,
        `if (!R) throw new Error(${JSON.stringify(`IWACVis: ${bundleName} needs the shared Svelte runtime (${RUNTIME_BUNDLE}), which is not loaded or does not provide '${spec}'`)});`,
    ];
    const list = sorted(names);
    if (list.length) {
        lines.push(`const ${list.map((name, i) => `__svelte${i} = R[${JSON.stringify(name)}]`).join(', ')};`);
        lines.push(`export { ${list.map((name, i) => `__svelte${i} as ${name}`).join(', ')} };`);
    }
    return lines.join('\n') + '\n';
}

module.exports = {
    RUNTIME_BUNDLE,
    RUNTIME_GLOBAL,
    SVELTE_SPECIFIER,
    scanModule,
    mergeUsage,
    runtimeEntrySource,
    externalModuleSource,
};
