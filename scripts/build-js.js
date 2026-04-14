#!/usr/bin/env node
/**
 * Minify every asset/js/**\/*.js (except existing *.min.js) to a sibling
 * .min.js file. Templates reference the .min.js variants; the .js sources
 * remain readable for development and debugging.
 *
 * Usage: node scripts/build-js.js
 */

const { readdirSync, readFileSync, writeFileSync, statSync } = require('fs');
const { join, relative } = require('path');
const { minify } = require('terser');

const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'asset', 'js');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const st = statSync(p);
        if (st.isDirectory()) {
            walk(p, out);
        } else if (p.endsWith('.js') && !p.endsWith('.min.js')) {
            out.push(p);
        }
    }
    return out;
}

const TERSER_OPTS = {
    compress: {
        drop_console: false,
        passes: 2,
    },
    mangle: true,
    format: { comments: false },
};

(async () => {
    const files = walk(SRC_DIR).sort();
    let bytesIn = 0;
    let bytesOut = 0;
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        const result = await minify(src, TERSER_OPTS);
        if (result.error) {
            console.error(`FAIL ${relative(ROOT, file)}: ${result.error}`);
            process.exitCode = 1;
            continue;
        }
        const out = file.replace(/\.js$/, '.min.js');
        writeFileSync(out, result.code);
        bytesIn += Buffer.byteLength(src);
        bytesOut += Buffer.byteLength(result.code);
        const pct = ((1 - result.code.length / src.length) * 100).toFixed(1);
        console.log(
            `${relative(ROOT, file).padEnd(55)} ${String(src.length).padStart(7)}B -> ${String(result.code.length).padStart(6)}B  (-${pct}%)`
        );
    }
    const totalPct = ((1 - bytesOut / bytesIn) * 100).toFixed(1);
    console.log(
        `\n${files.length} files: ${bytesIn}B -> ${bytesOut}B (-${totalPct}%, saved ${bytesIn - bytesOut}B)`
    );
})();
