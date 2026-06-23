#!/usr/bin/env node
/**
 * Theme-token contract guard.
 *
 * The IWAC module is built to consume the IWAC theme's design tokens
 * (IWAC-theme/docs/DESIGN-SYSTEM.md) rather than redefine them. This linter
 * fails the build when a source file drifts from that contract, so the
 * discipline the codebase already follows stays automatic as new blocks land.
 * It scans only hand-written sources (*.css / *.js, never the generated
 * *.min.* mirrors).
 *
 * Rules (shape):
 *   1. No removed tokens — `--primary-hue` / `--primary-sat` were dropped
 *      in theme v2.0.0 (derive variants via color-mix from `--primary`).
 *   2. No `color-mix(in srgb …)` — sRGB mixing muddies mid-tones; the
 *      contract is `in oklab`.
 *   3. (CSS only) Every hex colour must sit in a `var(--token, #fallback)`
 *      fallback slot. Bare hex chrome is forbidden. Genuine exceptions
 *      (sanctioned data-series colours) opt out with a trailing
 *      `/​* allow-hex *​/` marker on the same line.
 *
 * Rules (value) — only when `tokens.json` is present (synced from the theme
 * by IWAC-theme/scripts/build-tokens.js; the SINGLE SOURCE OF TRUTH):
 *   4. Every `var(--token, #hex)` fallback must EQUAL the token's canonical
 *      light value. A stale fallback (old brand orange, cream surface) is a
 *      competing variable even if it never paints a pixel.
 *   5. The runtime `FALLBACK_LIGHT` / `FALLBACK_DARK` objects (iwac-theme.js)
 *      must equal the canonical light / dark values.
 * Lines marked `/​* allow-hex *​/` are exempt from 3 and 4.
 *
 * Usage: node scripts/check-theme-tokens.js
 * Exit code 1 on any violation (with file:line + reason), else 0.
 */
const { readdirSync, readFileSync, statSync, existsSync } = require('fs');
const { join, relative } = require('path');

const ROOT = join(__dirname, '..');
const CSS_DIR = join(ROOT, 'asset', 'css');
const JS_DIR = join(ROOT, 'asset', 'js');
const TOKENS_PATH = join(ROOT, 'tokens.json');

function walk(dir, exts, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            walk(p, exts, out);
        } else if (exts.some((e) => p.endsWith(e)) && !/\.min\.(css|js)$/.test(p)) {
            out.push(p);
        }
    }
    return out;
}

/** Normalise #rgb / #rgba / #rrggbb / #rrggbbaa → lowercase #rrggbb. */
function normHex(hex) {
    let h = hex.replace('#', '').toLowerCase();
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    return '#' + h.slice(0, 6);
}

// Single source of truth: generated tokens.json. Absent → value checks skip
// (shape checks still run), so the guard degrades gracefully if a checkout
// hasn't synced tokens yet.
let TOKENS = null;
if (existsSync(TOKENS_PATH)) {
    try {
        TOKENS = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
    } catch (e) {
        console.warn('  ! tokens.json present but unparseable — value checks skipped\n');
    }
} else {
    console.warn('  ! tokens.json not found — value checks skipped (run `npm run build:tokens` in IWAC-theme)\n');
}

const REMOVED_TOKEN = /--primary-(hue|sat)\b/;
const SRGB_MIX = /color-mix\(\s*in\s+srgb\b/i;
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g;
const VAR_FALLBACK = /var\(\s*(--[\w-]+)\s*,\s*(#[0-9a-fA-F]{3,8})\b/g;

const violations = [];
function flag(file, line, msg, snippet) {
    violations.push({ file: relative(ROOT, file), line, msg, snippet: snippet.trim() });
}

/** Rule 4: `var(--token, #hex)` fallbacks must equal canonical light value. */
function checkVarFallbackValues(file, raw, n) {
    if (!TOKENS || /allow-hex/.test(raw)) return;
    let m;
    VAR_FALLBACK.lastIndex = 0;
    while ((m = VAR_FALLBACK.exec(raw)) !== null) {
        const name = m[1];
        const canon = TOKENS.light[name];
        if (canon && normHex(m[2]) !== canon.toLowerCase()) {
            flag(file, n, `fallback ${m[2]} for ${name} ≠ canonical light ${canon} (tokens.json)`, raw);
        }
    }
}

function scan(file, { hexCheck }) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((raw, i) => {
        const n = i + 1;
        if (REMOVED_TOKEN.test(raw)) {
            flag(file, n, 'removed token --primary-hue/--primary-sat (derive via color-mix from --primary)', raw);
        }
        if (SRGB_MIX.test(raw)) {
            flag(file, n, 'color-mix(in srgb …) — use `in oklab`', raw);
        }
        checkVarFallbackValues(file, raw, n);
        if (!hexCheck || /allow-hex/.test(raw)) return;

        let m;
        HEX.lastIndex = 0;
        while ((m = HEX.exec(raw)) !== null) {
            const before = raw.slice(0, m.index);
            // Allowed only as a var() fallback: the hex follows a comma and
            // there is an unterminated `var(` opened earlier on the line.
            const isFallback = /,\s*$/.test(before)
                && (before.match(/var\(/g) || []).length > (before.match(/\)/g) || []).length;
            if (!isFallback) {
                flag(file, n, 'bare hex outside a var() fallback (use a theme token, or mark /* allow-hex */)', raw);
                break; // one report per line is enough
            }
        }
    });
}

/** Rule 5: FALLBACK_LIGHT / FALLBACK_DARK objects must equal canonical values. */
const camelToVar = (k) => '--' + k.replace(/([A-Z])/g, '-$1').toLowerCase();
function checkFallbackObjects(file) {
    if (!TOKENS) return;
    const src = readFileSync(file, 'utf8');
    for (const [objName, theme] of [['FALLBACK_LIGHT', 'light'], ['FALLBACK_DARK', 'dark']]) {
        const block = new RegExp(objName + '\\s*=\\s*\\{([\\s\\S]*?)\\}').exec(src);
        if (!block) continue;
        const startLine = src.slice(0, block.index).split('\n').length;
        const entryRe = /(\w+)\s*:\s*'(#[0-9a-fA-F]{3,8})'/g;
        let e;
        while ((e = entryRe.exec(block[1])) !== null) {
            const name = camelToVar(e[1]);
            const canon = TOKENS[theme] && TOKENS[theme][name];
            if (canon && normHex(e[2]) !== canon.toLowerCase()) {
                const line = startLine + block[1].slice(0, e.index).split('\n').length - 1;
                flag(file, line, `${objName}.${e[1]} ${e[2]} ≠ canonical ${theme} ${canon} (${name})`, e[0]);
            }
        }
    }
}

walk(CSS_DIR, ['.css']).forEach((f) => scan(f, { hexCheck: true }));
const jsFiles = walk(JS_DIR, ['.js']);
jsFiles.forEach((f) => scan(f, { hexCheck: false }));
jsFiles.forEach(checkFallbackObjects);

if (violations.length) {
    console.error(`\n✗ theme-token guard: ${violations.length} violation(s)\n`);
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}  ${v.msg}`);
        console.error(`      ${v.snippet}`);
    }
    console.error('\nSee CLAUDE.md → "Match the IWAC theme" and IWAC-theme/docs/DESIGN-SYSTEM.md.');
    console.error('Canonical values: tokens.json (regenerate with `npm run build:tokens` in IWAC-theme).\n');
    process.exit(1);
}

console.log('✓ theme-token guard: no violations');
