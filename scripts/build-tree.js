#!/usr/bin/env node
/**
 * Generate the repository tree in ARCHITECTURE.md — and check it in CI.
 *
 * WHY THIS EXISTS
 * ---------------
 * The tree was hand-maintained, and by the 2026-09-05 audit (Tier 8 / D1) it
 * listed 6 `BlockLayout` classes where the registry has 21, named six panel
 * directories out of twenty, and showed `asset/data/*.json` as tree contents
 * although that directory has been gitignored since issue #7 — a reader
 * following it would have looked for files the repo does not contain. A
 * hand-written picture of a directory listing is a copy, and copies go stale.
 *
 * The tree is derived from `git ls-files` over the working tree, so it describes what is
 * actually tracked, and `--check` fails the build when the file and the repo
 * disagree. Annotations (the `# …` comments that carry the reasoning a bare
 * listing cannot) live in ANNOTATIONS below, keyed by path: they are the part
 * a human writes, and an annotation for a path that no longer exists is
 * reported rather than silently dropped.
 *
 * Fan-out directories are summarised with a file count instead of listed:
 * nobody needs 21 `BlockLayout` filenames, they need to know there are 21.
 *
 *   node scripts/build-tree.js            # rewrite the block in ARCHITECTURE.md
 *   node scripts/build-tree.js --check    # fail if it is out of date
 */
'use strict';

const { execFileSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const TARGET = join(ROOT, 'ARCHITECTURE.md');
const BEGIN = '<!-- BEGIN GENERATED TREE (npm run build:tree) -->';
const END = '<!-- END GENERATED TREE -->';

/**
 * Directories shown as a count rather than a listing, with the note that
 * replaces the listing. A trailing `/` matches a directory's direct children.
 */
const SUMMARIZE = {
    'src/Site/BlockLayout/': 'one `const SLUG` each; BlockRegistry.php is the truth',
    'src/Site/ResourcePageBlockLayout/': 'template-ID dispatch + the item-set block',
    'view/common/block-layout/': 'one per registered block, filename === slug',
    'asset/css/blocks/': 'block-local sheets, layered over iwac-core.css',
    'asset/js/charts/shared/': 'the reusable primitives every block draws on',
    'asset/js/charts/shared/renderers/': 'self-registering dashboardLayout renderers',
    'asset/js/dist/': 'built by scripts/build-js.js from bundles.json; committed',
    'asset/geo/': 'static map geometry, the only committed data',
    'language/': 'template.pot + fr.po + the compiled fr.mo',
    'tests/js/': 'node:test units',
    'tests/browser/': 'Playwright specs',
    'scripts/laicite/': 'one module per bundle, mirroring asset/js/charts/laicite/',
};

/**
 * Pattern rules, applied when no exact SUMMARIZE entry matches. A block's panel
 * modules are the clearest case: `laicite/` holding seventeen files is the fact
 * worth printing, not seventeen filenames a reader will never look up here.
 */
const SUMMARIZE_PATTERNS = [
    [/^asset\/js\/charts\/(?!shared\/)[^/]+\/$/, (n) => `panel module${n === 1 ? '' : 's'}`],
    [/^scripts\/laicite\/$/, () => 'one module per bundle'],
];

function summaryFor(path, count) {
    const key = `${path}/`;
    if (SUMMARIZE[key]) return SUMMARIZE[key];
    for (const [pattern, note] of SUMMARIZE_PATTERNS) {
        if (pattern.test(key)) return note(count);
    }
    return null;
}

/** Paths whose reasoning a bare listing cannot carry. */
const ANNOTATIONS = {
    'Module.php': 'Structural only — NO asset listeners (see docblock)',
    'config/module.ini': 'Module metadata; version drives the asset cache-bust',
    'config/module.config.php': 'Block + resource-page-block invokables',
    'src/Site/BlockRegistry.php': 'THE single source of truth for every block',
    'src/Job/SyncData.php': 'Pure-PHP "Pull latest data" job (issue #7)',
    'view/common/iwac-assets.phtml': 'Shared asset-loader partial — declare needs here',
    'view/common/iwac-block-shell.phtml': 'Shared block wrapper + loading scaffold',
    'asset/js/bundles.json': 'The load order: shared bundles, panel sets, one per block',
    'asset/js/iwac-i18n.js': 'Locale detection + en/fr dictionary + t()',
    'asset/js/iwac-theme.js': 'ECharts theme from live CSS vars; owns BASEMAP',
    'asset/js/dashboard-core.js': 'IWACVis namespace, chart tracking, theme observer',
    'asset/css/iwac-core.css': 'Tokens, panel, chip controls, table, form controls',
    'asset/css/iwac-maplibre.css': 'MapLibre chrome + shared popup body styles',
    'scripts/run_all.py': 'Every generator in one process, sharing loaded subsets',
    'scripts/iwac_frames.py': 'The FrameStore run_all installs',
    'scripts/iwac_utils.py': 'Shared generator helpers (self-contained)',
    'scripts/dashboard_aggregator.py': 'Shared person/entity aggregation core',
    'scripts/build-js.js': 'esbuild bundler driven by asset/js/bundles.json',
    'scripts/requirements.lock': 'Hash-pinned; `npm run lint:python-lock` checks it',
    'ARCHITECTURE.md': 'This file',
    'CHANGELOG.md': 'Version history',
    'DATA_NOTES.md': 'The Hugging Face dataset schema',
    'ROADMAP.md': 'Consolidated maintenance status and decisions',
    'tokens.json': 'Synced from the IWAC theme; `npm run lint:theme` enforces it',
};

/** Top-level entries never worth showing. */
const HIDE = new Set(['.gitattributes', '.gitignore', '.editorconfig']);

function trackedFiles() {
    // `--others --exclude-standard` as well as the index, and existing files
    // only. Plain `git ls-files` reads the INDEX, so a new file counted only
    // once it had been `git add`ed - which meant `npm run build:tree` before
    // staging wrote a tree that `lint:tree` then rejected after staging, and
    // the failure surfaced in CI rather than locally. Reading the working
    // tree makes the two orders agree, and matches CI, where everything is
    // committed anyway. A file deleted but not yet staged is still in the
    // index, so `existsSync` drops it.
    const listed = execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate'],
        { cwd: ROOT, encoding: 'utf8' }
    );
    return listed
        .split('\n')
        .filter(Boolean)
        .filter((p) => !p.startsWith('.impeccable/'))
        .filter((p) => !HIDE.has(p))
        .filter((p) => existsSync(join(ROOT, p)));
}

/** Nested {name: node} tree; a file is null. */
function buildTree(paths) {
    const root = {};
    for (const path of paths) {
        const parts = path.split('/');
        let node = root;
        parts.forEach((part, i) => {
            if (i === parts.length - 1) node[part] = null;
            else node = (node[part] ||= {});
        });
    }
    return root;
}

function countFiles(node) {
    let n = 0;
    for (const value of Object.values(node)) n += value === null ? 1 : countFiles(value);
    return n;
}

/** Sort directories first, then files, each alphabetically. */
function entriesOf(node) {
    return Object.keys(node).sort((a, b) => {
        const da = node[a] !== null;
        const db = node[b] !== null;
        if (da !== db) return da ? -1 : 1;
        return a.localeCompare(b);
    });
}

const used = new Set();

function render(node, prefix, base, out) {
    const names = entriesOf(node);
    names.forEach((name, i) => {
        const last = i === names.length - 1;
        const branch = last ? '└── ' : '├── ';
        const path = base ? `${base}/${name}` : name;
        const isDir = node[name] !== null;
        const label = isDir ? `${name}/` : name;

        let note = ANNOTATIONS[path];
        if (note) used.add(path);
        const n = isDir ? countFiles(node[name]) : 0;
        const summary = isDir ? summaryFor(path, n) : null;
        if (summary) note = `${n} file${n === 1 ? '' : 's'} — ${summary}`;

        out.push({ text: prefix + branch + label, note });
        if (isDir && !summary) {
            render(node[name], prefix + (last ? '    ' : '│   '), path, out);
        }
    });
}

function tree() {
    const rows = [{ text: 'IwacVisualizations/', note: null }];
    render(buildTree(trackedFiles()), '', '', rows);

    const width = Math.max(...rows.map((r) => (r.note ? r.text.length : 0))) + 2;
    const body = rows
        .map((r) => (r.note ? `${r.text.padEnd(width)}# ${r.note}` : r.text))
        .join('\n');

    const orphans = Object.keys(ANNOTATIONS).filter((p) => !used.has(p));
    return { block: '```\n' + body + '\n```', orphans };
}

function main() {
    const check = process.argv.includes('--check');
    const current = readFileSync(TARGET, 'utf8');
    const start = current.indexOf(BEGIN);
    const stop = current.indexOf(END);
    if (start === -1 || stop === -1) {
        console.error(`✗ tree guard: ${BEGIN} / ${END} markers missing from ARCHITECTURE.md`);
        return 1;
    }

    const { block, orphans } = tree();
    if (orphans.length) {
        console.error('✗ tree guard: annotation(s) for path(s) that are not tracked:\n');
        for (const p of orphans) console.error(`  ${p}`);
        console.error('\n  Update ANNOTATIONS in scripts/build-tree.js — an annotation'
            + '\n  for a file that no longer exists is the drift this script prevents.\n');
        return 1;
    }

    const next = current.slice(0, start + BEGIN.length)
        + '\n\n' + block + '\n\n'
        + current.slice(stop);

    if (check) {
        if (next !== current) {
            console.error(
                '\n✗ tree guard: ARCHITECTURE.md\'s tree does not match the repository.'
                + '\n  Run `npm run build:tree` and commit the result.\n'
            );
            return 1;
        }
        console.log(`✓ tree guard: ARCHITECTURE.md matches ${trackedFiles().length} tracked files`);
        return 0;
    }

    writeFileSync(TARGET, next);
    console.log(`✓ wrote the tree for ${trackedFiles().length} tracked files into ARCHITECTURE.md`);
    return 0;
}

process.exit(main());
