#!/usr/bin/env node
/**
 * Fail when the Playwright run passed only on retry.
 *
 * CI runs the browser contracts with `retries: 2`, which is right for a
 * suite that drives a real browser — a lost frame must not block a release
 * — but a retry that quietly passes hides a real intermittent failure until
 * the day it stops passing. Playwright records such a test as `flaky` in its
 * JSON report; this script reads that report and turns any flaky test into a
 * red run with its name, so the intermittency is a finding rather than a
 * silence.
 *
 * Usage: node scripts/check-flakes.js [path/to/report.json]
 *   (default: test-results/report.json — where playwright.config.js writes
 *   it in CI). A missing report is an error: the check must not pass because
 * nothing was measured.
 */

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const path = process.argv[2] || join(__dirname, '..', 'test-results', 'report.json');
if (!existsSync(path)) {
    console.error(`✗ flake guard: no Playwright JSON report at ${path}`);
    process.exit(1);
}

const report = JSON.parse(readFileSync(path, 'utf8'));
const flaky = [];
let total = 0;

function visit(suite, trail) {
    const here = suite.title ? trail.concat(suite.title) : trail;
    for (const spec of suite.specs || []) {
        for (const t of spec.tests || []) {
            total++;
            if (t.status === 'flaky') flaky.push(here.concat(spec.title).join(' › '));
        }
    }
    for (const child of suite.suites || []) visit(child, here);
}
for (const suite of report.suites || []) visit(suite, []);

if (flaky.length) {
    console.error(`\n✗ flake guard: ${flaky.length} of ${total} browser contracts passed only on retry\n`);
    for (const name of flaky) console.error(`  ${name}`);
    console.error('\nA test that needs a retry is intermittent; make it deterministic or report why it cannot be.\n');
    process.exit(1);
}
console.log(`✓ flake guard: ${total} browser contracts passed first time`);
