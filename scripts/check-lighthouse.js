#!/usr/bin/env node
/**
 * Lighthouse budgets for the block pages — `npm run check:lighthouse`.
 *
 *     node scripts/check-lighthouse.js              # measure, compare, fail on a breach
 *     node scripts/check-lighthouse.js --update     # measure, then rewrite the baseline
 *     node scripts/check-lighthouse.js --only=albani-sermons,timeline --runs=5
 *
 * Every block fixture in PAGES is loaded by Lighthouse (mobile, simulated slow
 * 4G — its defaults) through the Chromium @playwright/test pins, RUNS times,
 * from tests/browser/server.js, which serves text gzipped as the live site
 * does. The median of those runs is held against tests/lighthouse/baseline.json:
 *
 *   - transfer bytes of script, stylesheet, image and font, counting only what
 *     the module and its libraries ship (the fixture harness under
 *     /tests/browser/ is left out), and the page's request count: no more
 *     than BYTES_HEADROOM over the baseline. These are deterministic — every
 *     run must load the same bytes, or the page is reported as unstable —
 *     so this is the part of the gate that cannot flake;
 *   - the accessibility and best-practices scores: no lower than the
 *     baseline. They repeat run to run on one host (the same DOM, the same
 *     audits), but not across hosts, since fonts size the text (below);
 *   - the performance score: no lower than the baseline minus
 *     PERFORMANCE_MARGIN. This one is timed on the host's CPU, so it is the
 *     noisy one, and its baseline must come from the CI runner (below).
 *
 * SEO is not measured. A fixture's <head> — title, meta description, robots,
 * canonical — is the harness's, not the module's: the theme and IWAC-SEO own
 * it on the live site, and the only SEO audit a fixture failed in the baseline
 * run was the meta description it does not have.
 *
 * Like scripts/check-audit.js, the baseline retires its own slack: a page
 * that got BYTES_STALE lighter, or whose accessibility or best-practices score
 * rose, fails until the baseline is rewritten, so an improvement is locked in
 * rather than left as headroom for the next regression to spend.
 *
 * Re-baselining. Every run writes the baseline it measured to
 * test-results/lighthouse/baseline.json (uploaded as the CI job's artifact),
 * beside one HTML report per page. `--update` copies it over the committed
 * file — except outside CI, where the committed scores are kept and only the
 * byte and request counts are rewritten. A laptop is not the runner: its CPU
 * times the performance score, and its fonts size the text the accessibility
 * audits measure (IwacSearch's pages passed `target-size` on the Linux runner
 * and failed it on Windows). To move a score, take baseline.json from a CI
 * run — for performance, the median of several attempts, not one (see
 * PERFORMANCE_MARGIN).
 */
'use strict';

const { spawn } = require('node:child_process');
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { printFailure } = require('./lib/report');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'tests', 'lighthouse', 'baseline.json');
const OUT = path.join(ROOT, 'test-results', 'lighthouse');

/**
 * One fixture per block page. The component fixtures (chart-layout,
 * horizontal-bar-renderer, embed-tokens, map-popup, theme-toggle) are not
 * pages a reader loads, and are left to the Playwright suite.
 */
const PAGES = [
    'albani-sermons',
    'article-dashboard',
    'associated-entities',
    'dashboard',
    'index-ledger',
    'minimal-item',
    'on-this-day',
    'sentiment-atlas',
    'table-records',
    'timeline',
    'topic-explorer',
];

const CATEGORIES = ['performance', 'accessibility', 'best-practices'];
const BYTE_TYPES = ['script', 'stylesheet', 'image', 'font'];

/** Bytes and requests may grow by this factor before the gate fails. */
const BYTES_HEADROOM = 1.10;
/** A page this much lighter than its baseline fails until it is re-baselined. */
const BYTES_STALE = 0.80;
/**
 * How far a page's median performance score may sit below its baseline.
 * Measured, 2026-10-27: three attempts of the CI job on three runner VMs
 * (benchmark index 2,080–2,480), nine runs per page. No page's median of three
 * fell more than 0.01 below its nine-run median, so 0.05 is five times the
 * worst drop seen. One page is bimodal: article-dashboard scores either ~0.74
 * or ~0.93 run by run, and one attempt drew 0.93 three times. So a performance
 * baseline is the median of several CI attempts' runs (details.json lists
 * each run), never a single attempt's — that one would have set a floor the
 * page's other mode fails.
 */
const PERFORMANCE_MARGIN = 0.05;

function parseArgs(argv) {
    const args = { update: false, runs: 3, only: null };
    for (const arg of argv) {
        if (arg === '--update') args.update = true;
        else if (arg.startsWith('--runs=')) args.runs = Number(arg.slice(7));
        else if (arg.startsWith('--only=')) args.only = arg.slice(7).split(',').filter(Boolean);
        else throw new Error(`unknown argument: ${arg}`);
    }
    if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error('--runs must be a positive integer');
    const unknown = (args.only || []).filter((page) => !PAGES.includes(page));
    if (unknown.length) throw new Error(`not in PAGES: ${unknown.join(', ')}`);
    return args;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

/** Start the fixture server on a free port; resolves once it is listening. */
async function startServer() {
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(ROOT, 'tests', 'browser', 'server.js')], {
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`fixture server exited (${code})`)));
        child.stdout.once('data', resolve);
    });
    return { origin: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The figures the gate reads from one Lighthouse result. */
function measure(lhr) {
    const bytes = Object.fromEntries(BYTE_TYPES.map((type) => [type, 0]));
    const broken = [];
    let requests = 0;
    for (const request of lhr.audits['network-requests'].details.items) {
        if (!/^https?:/.test(request.url)) continue;
        requests++;
        if (request.statusCode >= 400) broken.push(`${request.statusCode} ${request.url}`);
        if (new URL(request.url).pathname.startsWith('/tests/browser/')) continue;
        const type = String(request.resourceType || '').toLowerCase();
        if (type in bytes) bytes[type] += request.transferSize || 0;
    }
    const scores = Object.fromEntries(CATEGORIES.map((id) => [id, lhr.categories[id].score]));
    return { ...scores, ...bytes, requests, broken };
}

async function runPage(lighthouse, origin, page, runs) {
    const url = `${origin}/tests/browser/fixtures/${page}.html`;
    const results = [];
    for (let i = 0; i < runs; i++) {
        const port = await freePort();
        const browser = await chromium.launch({ channel: 'chromium', args: [`--remote-debugging-port=${port}`] });
        try {
            const result = await lighthouse(url, {
                port,
                output: 'html',
                logLevel: 'error',
                onlyCategories: CATEGORIES,
            });
            if (result.lhr.runtimeError) throw new Error(`${page}: ${result.lhr.runtimeError.message}`);
            results.push({ lhr: result.lhr, html: result.report, figures: measure(result.lhr) });
        } finally {
            await browser.close();
        }
    }
    return results;
}

/** Collapse a page's runs to one row; report anything that should not vary. */
function summarise(page, results, problems) {
    const first = results[0].figures;
    for (const key of [...BYTE_TYPES, 'requests']) {
        const seen = [...new Set(results.map((r) => r.figures[key]))];
        if (seen.length > 1) problems.push(`${page}: ${key} differs between runs (${seen.join(', ')}) — the page does not load the same thing twice`);
    }
    for (const line of new Set(results.flatMap((r) => r.figures.broken))) problems.push(`${page}: ${line}`);
    const row = {};
    for (const id of CATEGORIES) {
        const values = results.map((r) => r.figures[id]);
        if (values.some((v) => typeof v !== 'number')) {
            problems.push(`${page}: no ${id} score in at least one run`);
            row[id] = null;
        } else {
            row[id] = Math.round(median(values) * 100) / 100;
        }
    }
    for (const key of [...BYTE_TYPES, 'requests']) row[key] = first[key];
    // The report kept is the run whose performance score is the median one.
    const perf = results.map((r) => r.figures.performance);
    const kept = results[perf.indexOf([...perf].sort((a, b) => a - b)[Math.floor(perf.length / 2)])];
    return {
        row,
        runs: perf,
        benchmarkIndex: results.map((r) => r.lhr.environment.benchmarkIndex),
        html: kept.html,
        meta: { lighthouse: kept.lhr.lighthouseVersion, userAgent: kept.lhr.environment.hostUserAgent },
    };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const limitOf = (base) => Math.ceil(base * BYTES_HEADROOM);

/** Compare a measured row with its baseline; returns the cells to print. */
function compare(page, row, base, problems) {
    const cells = [];
    for (const id of CATEGORIES) {
        if (row[id] === null) { cells.push(`${id} —`); continue; }
        const floor = id === 'performance' ? Math.round((base[id] - PERFORMANCE_MARGIN) * 100) / 100 : base[id];
        cells.push(`${id} ${row[id].toFixed(2)} (≥ ${floor.toFixed(2)})`);
        if (row[id] < floor) problems.push(`${page}: ${id} ${row[id].toFixed(2)} is below its floor of ${floor.toFixed(2)} (baseline ${base[id].toFixed(2)})`);
        else if (id !== 'performance' && row[id] > base[id]) problems.push(`${page}: ${id} rose to ${row[id].toFixed(2)} from ${base[id].toFixed(2)} — lock it in with --update`);
    }
    for (const key of [...BYTE_TYPES, 'requests']) {
        const show = key === 'requests' ? String : kb;
        const limit = limitOf(base[key]);
        if (row[key] || base[key]) cells.push(`${key} ${show(row[key])} (≤ ${show(limit)})`);
        if (row[key] > limit) problems.push(`${page}: ${key} ${show(row[key])} is over its budget of ${show(limit)} (baseline ${show(base[key])})`);
        else if (row[key] < base[key] * BYTES_STALE) problems.push(`${page}: ${key} fell to ${show(row[key])} from ${show(base[key])} — lock it in with --update`);
    }
    return cells;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const pages = args.only || PAGES;
    const committed = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { pages: {} };
    const { default: lighthouse } = await import('lighthouse');
    mkdirSync(OUT, { recursive: true });

    const server = await startServer();
    const problems = [];
    const measured = {};
    const details = {};
    try {
        for (const page of pages) {
            const started = Date.now();
            const summary = summarise(page, await runPage(lighthouse, server.origin, page, args.runs), problems);
            writeFileSync(path.join(OUT, `${page}.html`), summary.html);
            measured[page] = summary.row;
            details[page] = { performanceRuns: summary.runs, benchmarkIndex: summary.benchmarkIndex, ...summary.meta };
            console.log(`  measured ${page} in ${((Date.now() - started) / 1000).toFixed(0)} s — performance runs ${summary.runs.join(', ')}`);
        }
    } finally {
        server.stop();
    }

    const meta = Object.values(details)[0];
    const candidate = {
        _: 'Written by `npm run check:lighthouse -- --update` (scripts/check-lighthouse.js), never by hand.',
        lighthouse: meta.lighthouse,
        userAgent: meta.userAgent,
        runs: args.runs,
        pages: { ...committed.pages, ...measured },
    };
    writeFileSync(path.join(OUT, 'baseline.json'), `${JSON.stringify(candidate, null, 2)}\n`);
    writeFileSync(path.join(OUT, 'details.json'), `${JSON.stringify(details, null, 2)}\n`);

    if (args.update) {
        // A baseline taken from a page that broke or would not hold still
        // would make the next run's comparison meaningless.
        if (problems.length) {
            printFailure(`lighthouse: not re-baselining over ${problems.length} problem(s)`, problems, undefined, { leadingBlank: false });
            return 1;
        }
        if (!process.env.CI) {
            for (const page of pages) {
                for (const id of CATEGORIES) {
                    const kept = committed.pages[page]?.[id];
                    if (typeof kept === 'number') candidate.pages[page][id] = kept;
                    else console.warn(`  ! ${page}: no committed ${id} baseline; wrote this machine's ${measured[page][id]} — replace it with the CI run's`);
                }
            }
        }
        writeFileSync(BASELINE, `${JSON.stringify(candidate, null, 2)}\n`);
        console.log(`✓ lighthouse: wrote ${path.relative(ROOT, BASELINE)} for ${pages.length} page(s)${process.env.CI ? '' : ' (scores kept from the committed baseline)'}`);
        return 0;
    }

    const lines = [];
    for (const page of pages) {
        const base = committed.pages[page];
        if (!base) {
            problems.push(`${page}: no baseline — run with --update`);
            continue;
        }
        lines.push(`${page.padEnd(20)} ${compare(page, measured[page], base, problems).join('  ')}`);
    }
    if (!args.only) {
        for (const page of Object.keys(committed.pages)) {
            if (!PAGES.includes(page)) problems.push(`${page}: has a baseline but is not in PAGES — run with --update`);
        }
    }
    console.log(`\n${lines.join('\n')}\n`);

    if (process.env.GITHUB_STEP_SUMMARY) {
        const head = ['page', ...CATEGORIES, ...BYTE_TYPES, 'requests'];
        const table = [
            `| ${head.join(' | ')} |`,
            `|${head.map(() => ' --- ').join('|')}|`,
            ...pages.map((page) => `| ${page} | ${CATEGORIES.map((id) => measured[page][id]).join(' | ')} | ${BYTE_TYPES.map((t) => kb(measured[page][t])).join(' | ')} | ${measured[page].requests} |`),
        ];
        const verdict = problems.length ? `**${problems.length} budget problem(s):**\n\n${problems.map((p) => `- ${p}`).join('\n')}` : 'Every page within budget.';
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Lighthouse (median of ${args.runs})\n\n${table.join('\n')}\n\n${verdict}\n`);
    }

    if (problems.length) {
        printFailure(
            `lighthouse: ${problems.length} budget problem(s) over ${pages.length} page(s)`,
            problems,
            `\nReports: ${path.relative(ROOT, OUT)}/<page>.html. A deliberate change re-baselines with --update;\nscores come from the CI run's baseline.json artifact.\n`,
            { leadingBlank: false },
        );
        return 1;
    }
    console.log(`✓ lighthouse: ${pages.length} page(s) within budget (median of ${args.runs} runs)`);
    return 0;
}

main().then((code) => process.exit(code), (error) => {
    console.error(`✗ lighthouse: ${error.stack || error}`);
    process.exit(1);
});
