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
 *   6. Every `var(--…)` must NAME a token that exists: one published in
 *      `tokens.json`'s `names` (the theme's full vocabulary), one this module
 *      declares itself, or one in the module-owned `--iwac-vis-` namespace.
 *      Rules 3-4 only ever checked hex *values*, so a reference to a token the
 *      theme never defined — or has since removed — passed cleanly while
 *      rendering from its fallback forever, silently decoupled from the scale
 *      it appeared to track. `--panel-border-color` sat here undetected that
 *      way until the theme published `names` (IWAC-theme 2.9.1).
 *
 *      The exemption is the DOCUMENTED prefix, `--iwac-vis-`, not the looser
 *      `--iwac-`: the module namespace is the one place a competing variable
 *      can legally live, so it should be exactly as wide as §4 of
 *      DESIGN-SYSTEM.md says it is. The loose form had already let
 *      `--iwac-compare-color-a/b` and `--iwac-otd-axis-gap` drift out of it.
 *
 * Rules added 2026-08 (design review F1 / F3 / F5) — the whole class of drift
 * that no guard could see, because every rule above is about colour:
 *   7. Non-colour fallbacks must equal `tokens.json`'s generated
 *      `values.light`: type steps, spacing, radii, control sizes,
 *      line-heights, font stacks, shadows, transitions. Several here were a
 *      generation behind, including a `--font-headings` fallback still naming
 *      the removed "Noto Serif" — in the one property whose quoting bug had
 *      already silently rendered ~30 declarations in the wrong face.
 *   8. A fallback may not itself contain `var()`. It only renders when the
 *      theme is absent, in which case the nested token is absent too.
 *   9. `font-size` must come from a `--text-*` token, not a literal. ~91
 *      literals ran a second, undeclared scale here on the 12/14/18px steps
 *      of a generic utility framework rather than the theme's 11/13/15/17/19.
 *  10. Media-query widths must be one of the theme's published breakpoints.
 *      `blocks/laicite.css` reflowed at 640px under a `/* sm *​/` comment
 *      while the theme's `$sm` — and every other block on the page — is 600.
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
const VIEW_DIR = join(ROOT, 'view');
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

/**
 * Blank out `/* … *\/` comment interiors, preserving every newline and the
 * overall character count so file:line references stay exact.
 *
 * Without this, prose that merely *discusses* a colour trips the hex rule —
 * `layout/embed.phtml`'s comment explaining the dark-mode accent shift
 * ("#e64a19 → #ec653f") is a documented example, and any comment naming a
 * removed token would fail rule 1 the same way. Comments are not CSS.
 */
function blankComments(text) {
    // `/* allow-hex */` is itself a comment and IS load-bearing — the opt-out
    // marker rules 3 and 4 look for. Leave those intact and blank the rest.
    return text.replace(/\/\*[\s\S]*?\*\//g, (m) =>
        /allow-hex/.test(m) ? m : m.replace(/[^\n]/g, ' '));
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
const VAR_USE = /var\(\s*(--[\w-]+)/g;
const DECL = /(--[\w-]+)\s*:/g;
const MEDIA_WIDTH = /\((min|max)-width\s*:\s*([\d.]+)px\)/g;
// Absolute font-size literals only: em / % / unitless scale WITH whatever
// token the cascade already set, so they don't fork the scale.
const ABS_FONT_SIZE = /font-size:\s*(-?[\d.]+(?:px|rem|pt))\b/i;
// Module-owned namespace: data-series colours and properties set at runtime.
// Exactly the prefix DESIGN-SYSTEM.md §4 documents — see rule 6.
const MODULE_PREFIX = /^--iwac-vis-/;

/**
 * Every `var(--token, <fallback>)` on a line, fallback extracted by balancing
 * parens so a nested `var()` is captured whole rather than truncated.
 */
function varFallbacks(line) {
    const out = [];
    for (let i = 0; (i = line.indexOf('var(', i)) !== -1;) {
        let depth = 0, j = i + 3;
        for (; j < line.length; j++) {
            if (line[j] === '(') depth++;
            else if (line[j] === ')') { depth--; if (depth === 0) break; }
        }
        if (j >= line.length) break; // spans lines — not our business
        const inner = line.slice(i + 4, j);
        const comma = inner.indexOf(',');
        if (comma !== -1) out.push({ name: inner.slice(0, comma).trim(), fallback: inner.slice(comma + 1).trim() });
        i = j + 1;
    }
    return out;
}

/**
 * Is the position after `before` inside the fallback slot of an open `var()`?
 *
 * Not "does a comma immediately precede it": a fallback is a whole CSS value,
 * so `var(--panel-border, 1px solid #ced1d6)` puts the hex three tokens past
 * the comma. Requiring adjacency reported every composite fallback as bare
 * chrome — a standing incentive to write the nested-var() chains rule 8
 * forbids.
 */
function isInVarFallback(before) {
    let depth = 0, varDepth = -1, sawComma = false;
    for (let i = 0; i < before.length; i++) {
        if (before[i] === '(') {
            if (before.slice(Math.max(0, i - 3), i) === 'var' && varDepth === -1) {
                varDepth = depth; sawComma = false;
            }
            depth++;
        } else if (before[i] === ')') {
            depth--;
            if (varDepth !== -1 && depth <= varDepth) varDepth = -1;
        } else if (before[i] === ',' && varDepth !== -1 && depth === varDepth + 1) {
            sawComma = true;
        }
    }
    return varDepth !== -1 && sawComma;
}

/** Compare CSS values ignoring case, spacing, quote style and leading zeros. */
function normValue(s) {
    return s.trim().toLowerCase().replace(/'/g, '"').replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ',').replace(/(^|[\s,(])\.(\d)/g, '$10.$2');
}

/** The canonical value of a token, colour or otherwise, or undefined. */
function canonicalOf(name) {
    if (!TOKENS) return undefined;
    return (TOKENS.light && TOKENS.light[name])
        || (TOKENS.values && TOKENS.values.light && TOKENS.values.light[name]);
}

/**
 * Resolve a fallback expression the way CSS would if only the COARSER tokens
 * in it were defined: substitute each `var(--X, Y)` with X's canonical value,
 * or with Y when X is one the theme doesn't publish (module-owned).
 */
function resolveFallbackExpr(expr) {
    let out = '', i = 0;
    while (i < expr.length) {
        const at = expr.indexOf('var(', i);
        if (at === -1) { out += expr.slice(i); break; }
        out += expr.slice(i, at);
        let depth = 0, j = at + 3;
        for (; j < expr.length; j++) {
            if (expr[j] === '(') depth++;
            else if (expr[j] === ')') { depth--; if (depth === 0) break; }
        }
        if (j >= expr.length) { out += expr.slice(at); break; }
        const inner = expr.slice(at + 4, j);
        const comma = splitTopLevelComma(inner);
        const tok = comma === -1 ? inner.trim() : inner.slice(0, comma).trim();
        const rest = comma === -1 ? '' : inner.slice(comma + 1).trim();
        const canon = canonicalOf(tok);
        out += canon !== undefined ? canon : resolveFallbackExpr(rest);
        i = j + 1;
    }
    return out;
}

/** Index of the first comma at paren depth 0, or -1. */
function splitTopLevelComma(s) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') depth--;
        else if (s[i] === ',' && depth === 0) return i;
    }
    return -1;
}

/**
 * Rule 8 — a nested fallback chain must RESOLVE to the outer token's value.
 *
 * `var(--A, var(--B, lit))` is legitimate when B is a coarser token that
 * resolves to the same thing as A: a consumer holding only a partial token set
 * — a third-party Omeka theme that defines `--surface` but not `--panel-bg`,
 * or this module's own embed routes, which deliberately ship without the
 * compiled theme CSS — still lands on the right value instead of a frozen
 * literal. Flattening those chains is a real loss, not tidying, and the
 * browser tests catch it: the dashboard fixture defines `--surface` and no
 * `--panel-bg`, so a flattened panel background renders LIGHT in dark mode.
 *
 * A chain is a LIE when it resolves to something else. `var(--ink-strong,
 * var(--ink, …))` claims a headline ink degrades to a body ink;
 * `var(--panel-radius, var(--radius-lg, …))` claims an 8px panel degrades to a
 * 12px one. Those are the substitutions nobody meant.
 *
 * Resolving rather than comparing token-by-token also keeps COMPONENT
 * substitution legal: in `var(--focus-outline, 2px solid var(--focus-color,
 * #ce4115))` the inner token supplies one part of the composite, so its value
 * is correctly not equal to the outer's.
 */
function checkFallbackChain(file, raw, n, name, fallback) {
    const want = canonicalOf(name);
    if (want === undefined) return; // module-owned, or a token we can't judge
    const got = resolveFallbackExpr(fallback);
    if (got.includes('var(')) return; // unresolvable — nothing to assert
    if (normValue(got) !== normValue(want)) {
        flag(file, n, `fallback chain for ${name} resolves to "${got.trim()}" ≠ canonical ${want} (tokens.json)`, raw);
    }
}

/** Rules 7 + 8 — the non-colour half of the fallback contract. */
function checkNonColourFallbacks(file, raw, n) {
    if (!TOKENS || !TOKENS.values || !TOKENS.values.light || /allow-hex/.test(raw)) return;
    for (const { name, fallback } of varFallbacks(raw)) {
        if (fallback.includes('var(')) {
            checkFallbackChain(file, raw, n, name, fallback);
            continue;
        }
        if (fallback.startsWith('#')) continue; // rule 4 owns hex
        const canon = TOKENS.values.light[name];
        if (canon && normValue(fallback) !== normValue(canon)) {
            flag(file, n, `fallback "${fallback}" for ${name} ≠ canonical ${canon} (tokens.json values.light)`, raw);
        }
    }
}

/** Rule 9 — font-size comes from the published type scale. */
function checkTypeScale(file, raw, n) {
    const m = ABS_FONT_SIZE.exec(raw);
    if (m) flag(file, n, `font-size: ${m[1]} — use a --text-* token (--text-2xs is the floor)`, raw);
}

/**
 * Rule 10 — media-query widths are one of the theme's breakpoints.
 *
 * `@media` only. A `@container` query measures its own container, not the
 * viewport, so the viewport scale does not apply to it — on-this-day's
 * `@container iwac-otd (max-width: 900px)` is a legitimate 900px.
 */
function checkBreakpoints(file, raw, n) {
    if (!TOKENS || !TOKENS.breakpoints || !/@media\b/.test(raw)) return;
    const bps = Object.values(TOKENS.breakpoints).map(parseFloat);
    // `min-width` sits ON the breakpoint; `max-width` sits JUST BELOW it, so
    // the two halves of a pair never both match. `max-width: 600px` alongside
    // `min-width: 600px` means both rules fire in a 1px sliver at exactly
    // 600px — which is how a "reflows at sm" pair quietly stops being one.
    const minOk = new Set(bps);
    const maxOk = new Set(bps.flatMap((v) => [v - 1, v - 0.02]));
    const names = Object.entries(TOKENS.breakpoints).map(([k, v]) => `${k} ${v}`).join(', ');
    MEDIA_WIDTH.lastIndex = 0;
    let m;
    while ((m = MEDIA_WIDTH.exec(raw)) !== null) {
        const [, kind, px] = m;
        const v = parseFloat(px);
        if (kind === 'min' ? !minOk.has(v) : !maxOk.has(v)) {
            const hint = kind === 'max' && minOk.has(v) ? ` — use ${v - 1}px so it doesn't overlap min-width: ${v}px` : '';
            flag(file, n, `${kind}-width: ${px}px is not one of the theme's breakpoints (${names})${hint}`, raw);
        }
    }
}

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

/**
 * Every custom property this module declares itself. Collected up front so
 * rule 6 can tell a module-owned property from a reference to a theme token
 * that does not exist.
 */
const moduleOwned = new Set();
function collectModuleOwned(files) {
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        let m;
        DECL.lastIndex = 0;
        while ((m = DECL.exec(src)) !== null) moduleOwned.add(m[1]);
    }
}

/**
 * Rule 6: every `var(--…)` must name a token that actually exists.
 *
 * Rules 3-4 check hex *values*; nothing checked the *names*, so a reference to
 * a token the theme never defined (or has since removed) passed cleanly while
 * rendering from its fallback forever — silently decoupled from the scale it
 * appears to track. `--panel-border-color` (deleted from the theme) and
 * `--space-2xs` (never existed) both lived here undetected for exactly that
 * reason. `names` in tokens.json is the theme's published vocabulary.
 */
function checkVarNames(file, raw, n) {
    if (!TOKENS || !Array.isArray(TOKENS.names)) return;
    let m;
    VAR_USE.lastIndex = 0;
    while ((m = VAR_USE.exec(raw)) !== null) {
        const name = m[1];
        if (MODULE_PREFIX.test(name) || moduleOwned.has(name) || TOKENS.names.includes(name)) {
            continue;
        }
        flag(file, n, `unknown token ${name} — not a theme token (tokens.json names), not module-owned (--iwac-*)`, raw);
    }
}

/**
 * Extract the `<style>` regions of a .phtml template as [lineNumber, text]
 * pairs, so template CSS is linted with real file:line references.
 *
 * Templates are scanned for the same reason asset CSS is — but they matter
 * MORE than most sheets: the embed routes (`layout/embed.phtml` and friends)
 * deliberately ship without the compiled theme CSS, so every `var(--x, #hex)`
 * there renders FROM THE FALLBACK. A stale fallback in `asset/css` is a latent
 * competing variable; a stale fallback in an embed template is the colour a
 * visitor actually sees. Until this scan existed, 38 pre-v2.0.0 values sat in
 * those three files while the linter reported the tree clean.
 *
 * Only the `<style>` interiors are scanned: PHP string literals and HTML
 * attributes elsewhere in the file are not CSS, and a `#` in a URL fragment
 * or a colour name in prose would produce noise.
 */
function templateStyleLines(file) {
    const src = blankComments(readFileSync(file, 'utf8'));
    const out = [];
    const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
        const firstLine = src.slice(0, m.index).split('\n').length;
        // +0 keeps the opening <style …> tag's own line out of the numbering:
        // m[1] starts right after `>`, so its first line IS the <style> line.
        m[1].split('\n').forEach((raw, i) => out.push([firstLine + i, raw]));
    }
    return out;
}

function scanLines(file, numbered, { hexCheck }) {
    numbered.forEach(([n, raw]) => {
        if (REMOVED_TOKEN.test(raw)) {
            flag(file, n, 'removed token --primary-hue/--primary-sat (derive via color-mix from --primary)', raw);
        }
        if (SRGB_MIX.test(raw)) {
            flag(file, n, 'color-mix(in srgb …) — use `in oklab`', raw);
        }
        checkVarFallbackValues(file, raw, n);
        checkVarNames(file, raw, n);
        checkNonColourFallbacks(file, raw, n);
        checkBreakpoints(file, raw, n);
        if (hexCheck) checkTypeScale(file, raw, n);
        if (!hexCheck || /allow-hex/.test(raw)) return;

        let m;
        HEX.lastIndex = 0;
        while ((m = HEX.exec(raw)) !== null) {
            const before = raw.slice(0, m.index);
            if (!isInVarFallback(before)) {
                flag(file, n, 'bare hex outside a var() fallback (use a theme token, or mark /* allow-hex */)', raw);
                break; // one report per line is enough
            }
        }
    });
}

function scan(file, opts) {
    const numbered = blankComments(readFileSync(file, 'utf8'))
        .split('\n').map((raw, i) => [i + 1, raw]);
    scanLines(file, numbered, opts);
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

const cssFiles = walk(CSS_DIR, ['.css']);
const jsFiles = walk(JS_DIR, ['.js']);
const viewFiles = walk(VIEW_DIR, ['.phtml']);
// Templates carry CSS only inside <style>; pre-extract so both the
// module-vocabulary collection and the scan see the same lines.
const templateStyles = new Map(
    viewFiles.map((f) => [f, templateStyleLines(f)]).filter(([, lines]) => lines.length)
);

// Rule 6 needs the module's own vocabulary before any file is scanned — a
// property declared in one file is legitimately consumed from another.
collectModuleOwned(cssFiles.concat(jsFiles));
for (const lines of templateStyles.values()) {
    for (const [, raw] of lines) {
        DECL.lastIndex = 0;
        let m;
        while ((m = DECL.exec(raw)) !== null) moduleOwned.add(m[1]);
    }
}

cssFiles.forEach((f) => scan(f, { hexCheck: true }));
jsFiles.forEach((f) => scan(f, { hexCheck: false }));
jsFiles.forEach(checkFallbackObjects);
for (const [file, lines] of templateStyles) {
    scanLines(file, lines, { hexCheck: true });
}

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
