#!/usr/bin/env node
/**
 * Minify every asset/css/**\/*.css (except existing *.min.css) to a sibling
 * .min.css file. Templates reference the .min.css variants; the .css sources
 * stay readable for development. Mirrors scripts/build-js.js.
 *
 * csso runs with `restructure: false` so it only strips whitespace/comments
 * and compresses values it understands — it never reorders or merges rules.
 * That keeps the theme's modern color syntax (oklch(), color-mix(in oklab,…),
 * CSS masks) byte-for-byte intact; csso passes functions it doesn't recognize
 * straight through.
 *
 * Usage: node scripts/build-css.js
 */
const { readdirSync, readFileSync, writeFileSync, statSync } = require('fs');
const { join, relative } = require('path');
const csso = require('csso');

const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'asset', 'css');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const st = statSync(p);
        if (st.isDirectory()) {
            walk(p, out);
        } else if (p.endsWith('.css') && !p.endsWith('.min.css')) {
            out.push(p);
        }
    }
    return out;
}

const files = walk(SRC_DIR).sort();
let bytesIn = 0;
let bytesOut = 0;
for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const { css } = csso.minify(src, { restructure: false });
    const out = file.replace(/\.css$/, '.min.css');
    writeFileSync(out, css);
    bytesIn += Buffer.byteLength(src);
    bytesOut += Buffer.byteLength(css);
    const pct = ((1 - css.length / src.length) * 100).toFixed(1);
    console.log(
        `${relative(ROOT, file).padEnd(45)} ${String(src.length).padStart(7)}B -> ${String(css.length).padStart(6)}B  (-${pct}%)`
    );
}
const totalPct = bytesIn ? ((1 - bytesOut / bytesIn) * 100).toFixed(1) : '0.0';
console.log(`\n${files.length} files: ${bytesIn}B -> ${bytesOut}B (-${totalPct}%, saved ${bytesIn - bytesOut}B)`);
