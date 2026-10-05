#!/usr/bin/env node
/**
 * Theme-token contract guard — `npm run lint:theme`.
 *
 * The module is built to consume the IWAC theme's design tokens
 * (IWAC-theme/docs/DESIGN-SYSTEM.md) rather than redefine them. The RULES live
 * in `scripts/theme-token-guard.cjs`, a copy of
 * IWAC-theme/scripts/lib/theme-token-guard.cjs that the theme's
 * `npm run sync:tokens` writes beside tokens.json. Do not edit that copy —
 * edit the theme's, re-sync, and both modules move with the contract.
 *
 * This file used to BE the guard: a 701-line fork of IwacSearch's 621-line
 * one. The forks had drifted (this one could not see a media query in rem, a
 * declaration wrapped over several lines, or an `oklch()` literal), which is
 * the drift the token contract exists to prevent, happening to the thing that
 * enforces it. What stays here is only what is genuinely this module's:
 *
 *   - where the hand-written sources live: `asset/css` (never the *.min.css
 *     mirrors), `asset/js` (never `dist/`), and the `<style>` blocks of the
 *     `view/` templates — which matter MORE than most sheets, because the
 *     embed routes ship without the theme's CSS and render from fallbacks;
 *   - the generated embed token sheet, which is skipped here because
 *     `npm run lint:embed-tokens` asserts it byte-for-byte against tokens.json;
 *   - the namespace it owns: `--iwac-vis-`, exactly as DESIGN-SYSTEM.md §4
 *     documents it. The looser `--iwac-` form had already let
 *     `--iwac-compare-color-a/b` and `--iwac-otd-axis-gap` drift out of it;
 *   - one rule about this module's chart JS, run before the shared engine:
 *     a token read in chart code never falls back to a hex literal.
 */
const { join } = require('path');
const { cli, collectFiles } = require('./theme-token-guard.cjs');

const ROOT = join(__dirname, '..');

/**
 * Chart JS: no hex literal as the fallback of a token read —
 * `tokens.surface || '#fdfdfd'`, `readVar('--x', '#66696e')`.
 *
 * The shared engine exempts JS from its hex rules (a canvas has no cascade,
 * so chart code legitimately handles colour values), and these slipped
 * through it: three dozen copies of the theme's colours, most already stale
 * (`#e64a19` is the old brand orange; `#fafaf9`, `#fdfcfb` and `#fdfdfd`
 * were all "the surface"), every one unreachable because
 * `ns.getChartTokens()` already fills each key from iwac-theme.js's
 * FALLBACK_LIGHT / FALLBACK_DARK — the one sanctioned degraded mode, which
 * the engine pins to tokens.json and which this rule therefore skips.
 *
 * Matched on the whole source, so a fallback wrapped onto the next line is
 * found too; comments are blanked first so prose quoting the old pattern
 * does not trip it.
 */
const STALE_FALLBACKS = [
    [/\btokens\.\w+\s*\|\|\s*['"]#[0-9a-fA-F]{3,8}/g, 'a token read falls back to a hex literal'],
    [/\breadVar\([^)]*,\s*['"]#[0-9a-fA-F]{3,8}/g, 'readVar() is given a hex fallback'],
];

/** Comments replaced by spaces, newlines kept, so offsets and lines still match. */
function blankComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[\s;{}(,])\/\/[^\n]*/g, (m, lead) => lead + m.slice(lead.length).replace(/[^\n]/g, ' '));
}

function lineOf(src, index) {
    return src.slice(0, Math.max(0, index)).split('\n').length;
}

function staleHexFallbacks() {
    const files = collectFiles(ROOT, [['asset/js', ['.js']]],
        (rel) => /\.min\.js$/.test(rel) || rel.startsWith('asset/js/dist/'));
    const found = [];
    for (const { rel, text } of files) {
        const src = blankComments(text);
        const exempt = [];
        if (rel === 'asset/js/iwac-theme.js') {
            for (const name of ['FALLBACK_LIGHT', 'FALLBACK_DARK']) {
                const block = new RegExp(name + '\\s*=\\s*\\{[\\s\\S]*?\\}').exec(src);
                if (block) exempt.push([block.index, block.index + block[0].length]);
            }
        }
        for (const [pattern, what] of STALE_FALLBACKS) {
            pattern.lastIndex = 0;
            let m;
            while ((m = pattern.exec(src)) !== null) {
                if (exempt.some(([from, to]) => m.index >= from && m.index < to)) continue;
                found.push(`  ${rel}:${lineOf(src, m.index)}  ${what} — read it from ns.getChartTokens() `
                    + `(which falls back to FALLBACK_LIGHT/DARK) and drop the literal\n      ${m[0].replace(/\s+/g, ' ')}`);
            }
        }
    }
    return found;
}

const stale = staleHexFallbacks();
if (stale.length) {
    console.error(`\n✗ theme-token guard: ${stale.length} hex fallback(s) in chart JS\n`);
    console.error(stale.join('\n'));
    console.error('\nSee CLAUDE.md → "Match the IWAC theme".\n');
    process.exit(1);
}

cli({
    root: ROOT,
    roots: [
        ['asset/css', ['.css']],
        ['asset/js', ['.js']],
        ['view', ['.phtml']],
    ],
    skip: (rel) => /\.min\.(css|js)$/.test(rel)
        || rel.startsWith('asset/js/dist/')
        || rel === 'asset/css/iwac-embed-tokens.css',
    ownPrefix: /^--iwac-vis-/,
    docs: 'CLAUDE.md → "Match the IWAC theme"',
});
