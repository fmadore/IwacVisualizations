'use strict';

/**
 * The embed route's brand and type, against the theme's contract.
 *
 * The route renders without the theme's stylesheet, so two things it needs
 * are restated in this module: the webfont request (src/Site/EmbedBrand.php)
 * and the seed-to-token derivation (asset/css/iwac-embed.css). Neither can
 * read tokens.json at runtime — it does not ship — so these tests hold the
 * copies to it.
 */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const ROOT = join(__dirname, '..', '..');
const tokens = JSON.parse(readFileSync(join(ROOT, 'tokens.json'), 'utf8'));
const brand = readFileSync(join(ROOT, 'src', 'Site', 'EmbedBrand.php'), 'utf8');
const embedCss = readFileSync(join(ROOT, 'asset', 'css', 'iwac-embed.css'), 'utf8');

/** Bunny/Google v1 family list → { family: { normal: [[lo, hi]], italic: [[lo, hi]] } }. */
function parseFamilies(url) {
    const query = new URL(url).searchParams.get('family');
    const out = {};
    for (const spec of query.split('|')) {
        const [name, axes] = spec.split(':');
        const entry = { normal: [], italic: [] };
        if (!axes.includes('@')) {
            for (const w of axes.split(',')) entry.normal.push([Number(w), Number(w)]);
        } else {
            const [names, tuples] = axes.split('@');
            const keys = names.split(',');
            for (const tuple of tuples.split(';')) {
                const values = tuple.split(',');
                const ital = keys.includes('ital') ? values[keys.indexOf('ital')] === '1' : false;
                const wght = values[keys.indexOf('wght')];
                const [lo, hi = lo] = wght.split('..').map(Number);
                (ital ? entry.italic : entry.normal).push([lo, hi]);
            }
        }
        out[name] = entry;
    }
    return out;
}

test('the embed loads exactly the faces and weights the theme loads', () => {
    const url = /WEBFONT_URL = '([^']+)'/.exec(brand)[1];
    const loaded = parseFamilies(url);
    for (const font of Object.values(tokens.fonts)) {
        const key = font.family.toLowerCase().replace(/\s+/g, '-');
        assert.ok(loaded[key], `${font.family} is not requested by the embed`);
        assert.deepEqual(loaded[key].normal, font.normal, `${font.family} upright weights`);
        assert.deepEqual(loaded[key].italic, font.italic, `${font.family} italic weights`);
    }
    assert.equal(Object.keys(loaded).length, Object.keys(tokens.fonts).length,
        'the embed requests a family the theme does not load');
    // Once the theme publishes its request verbatim (tokens.json `fontsUrl`),
    // the constant must be that request.
    if (tokens.fontsUrl) assert.equal(url, tokens.fontsUrl);
});

test('the embed derives its accent from a seed with the theme’s own mixes', () => {
    // tokens.json resolves the stock seed through the theme's derivation;
    // the embed rules must use the same percentages to land on the same
    // literals for a tuned seed.
    const rule = (selector) => {
        const start = embedCss.indexOf(selector + ' {');
        assert.ok(start >= 0, `missing rule ${selector}`);
        return embedCss.slice(start, embedCss.indexOf('}', start));
    };
    const light = rule('html[style*="--iwac-vis-embed-primary"]');
    const dark = rule('html[style*="--iwac-vis-embed-primary"] body[data-theme="dark"]');
    assert.match(light, /--primary: color-mix\(in oklab, var\(--iwac-vis-embed-primary\), black 8%\)/);
    assert.match(light, /--primary-hover: color-mix\(in oklab, var\(--iwac-vis-embed-primary\), black 18%\)/);
    assert.match(dark, /--primary: color-mix\(in oklab, var\(--iwac-vis-embed-primary\), white 12%\)/);
    assert.match(rule('html[style*="--iwac-vis-embed-secondary"] body[data-theme="dark"]'),
        /--secondary: color-mix\(in oklab, var\(--iwac-vis-embed-secondary\), white 30%\)/);
    // Never the raw seed as the working colour.
    assert.doesNotMatch(light, /--primary: var\(--iwac-vis-embed-primary\)/);
});

test('the generated seeds file carries tokens.json’s seeds', () => {
    const seeds = readFileSync(join(ROOT, 'config', 'theme-seeds.php'), 'utf8');
    assert.ok(seeds.includes(`'primary'   => '${tokens.seeds['--primary-base'].toLowerCase()}'`));
    assert.ok(seeds.includes(`'secondary' => '${tokens.seeds['--secondary-base'].toLowerCase()}'`));
});
