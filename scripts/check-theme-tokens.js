#!/usr/bin/env node
/**
 * Theme-token contract guard.
 *
 * The IWAC module is built to consume the IWAC theme's design tokens
 * (IWAC-theme/docs/DESIGN-SYSTEM.md) rather than redefine them. This
 * linter fails the build when a source file drifts from that contract,
 * so the discipline the codebase already follows stays automatic as new
 * blocks land. It scans only hand-written sources (*.css / *.js, never
 * the generated *.min.* mirrors).
 *
 * Rules:
 *   1. No removed tokens — `--primary-hue` / `--primary-sat` were dropped
 *      in theme v2.0.0 (derive variants via color-mix from `--primary`).
 *   2. No `color-mix(in srgb …)` — sRGB mixing muddies mid-tones; the
 *      contract is `in oklab`.
 *   3. (CSS only) Every hex colour must sit in a `var(--token, #fallback)`
 *      fallback slot. Bare hex chrome is forbidden. Genuine exceptions
 *      (sanctioned data-series colours) opt out with a trailing
 *      `/* allow-hex *​/` marker on the same line.
 *
 * Usage: node scripts/check-theme-tokens.js
 * Exit code 1 on any violation (with file:line + reason), else 0.
 */
const { readdirSync, readFileSync, statSync } = require('fs');
const { join, relative } = require('path');

const ROOT = join(__dirname, '..');
const CSS_DIR = join(ROOT, 'asset', 'css');
const JS_DIR = join(ROOT, 'asset', 'js');

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

const REMOVED_TOKEN = /--primary-(hue|sat)\b/;
const SRGB_MIX = /color-mix\(\s*in\s+srgb\b/i;
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g;

const violations = [];
function flag(file, line, msg, snippet) {
    violations.push({ file: relative(ROOT, file), line, msg, snippet: snippet.trim() });
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

walk(CSS_DIR, ['.css']).forEach((f) => scan(f, { hexCheck: true }));
walk(JS_DIR, ['.js']).forEach((f) => scan(f, { hexCheck: false }));

if (violations.length) {
    console.error(`\n✗ theme-token guard: ${violations.length} violation(s)\n`);
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}  ${v.msg}`);
        console.error(`      ${v.snippet}`);
    }
    console.error('\nSee CLAUDE.md → "Match the IWAC theme" and IWAC-theme/docs/DESIGN-SYSTEM.md.\n');
    process.exit(1);
}

console.log('✓ theme-token guard: no violations');
