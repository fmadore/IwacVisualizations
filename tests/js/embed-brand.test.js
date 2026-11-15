'use strict';

/**
 * The embed route's brand and type, against the theme's contract.
 *
 * The route renders without the theme's stylesheet, so two things it needs
 * come from the theme's contract: the webfont stylesheet (tokens.json
 * `fontsCss`, copied into config/theme-seeds.php) and the seed-to-token
 * derivation (asset/css/iwac-embed.css). Neither can read tokens.json at
 * runtime — it does not ship — so these tests hold the copies to it.
 */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const ROOT = join(__dirname, '..', '..');
const tokens = JSON.parse(readFileSync(join(ROOT, 'tokens.json'), 'utf8'));
const brand = readFileSync(join(ROOT, 'src', 'Site', 'EmbedBrand.php'), 'utf8');
const embedCss = readFileSync(join(ROOT, 'asset', 'css', 'iwac-embed.css'), 'utf8');

test('the embed loads the theme’s self-hosted font stylesheet, and nothing else', () => {
    const seeds = readFileSync(join(ROOT, 'config', 'theme-seeds.php'), 'utf8');
    assert.equal(tokens.fontsCss, 'asset/css/fonts.css');
    assert.match(seeds, new RegExp(`'fontsCss'\\s*=> '${tokens.fontsCss}'`));
    const layout = readFileSync(join(ROOT, 'view', 'iwac-visualizations', 'layout', 'embed.phtml'), 'utf8');
    assert.match(layout, /EmbedBrand::themeFontsAsset\(/, 'the embed layout no longer asks for the theme fonts');
    // No third-party font request is left, on any path: a theme without
    // fonts.css gets the system stack (issue #34).
    for (const [name, source] of [['embed.phtml', layout], ['EmbedBrand.php', brand], ['theme-seeds.php', seeds]]) {
        assert.doesNotMatch(source, /fonts\.bunny\.net|fonts\.googleapis\.com/, `${name} requests a third-party font`);
    }
    assert.doesNotMatch(seeds, /'fontsUrl'/, 'theme-seeds.php still carries the deprecated fontsUrl');
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
    // Dark re-lights the seed (theme 2.33): 10 % of it against a colour with
    // a fixed oklab lightness and no a/b, so hue and chroma are the seed's.
    assert.match(dark, /--primary: color-mix\(in oklab, var\(--iwac-vis-embed-primary\) 10%, oklab\(78% none none\)\)/);
    assert.match(dark, /--primary-hover: color-mix\(in oklab, var\(--iwac-vis-embed-primary\) 10%, oklab\(86% none none\)\)/);
    assert.match(dark, /--primary-active: color-mix\(in oklab, var\(--iwac-vis-embed-primary\) 10%, oklab\(70% none none\)\)/);
    // The glows are flat in the theme now; re-composing them would bring the
    // halo back on a tuned embed.
    assert.doesNotMatch(embedCss, /--glow-(xs|sm|md):/);
    assert.match(rule('html[style*="--iwac-vis-embed-secondary"] body[data-theme="dark"]'),
        /--secondary: color-mix\(in oklab, var\(--iwac-vis-embed-secondary\), white 30%\)/);
    // Never the raw seed as the working colour.
    assert.doesNotMatch(light, /--primary: var\(--iwac-vis-embed-primary\)/);
});

/* sRGB hex <-> oklab, enough to replay a color-mix the way a browser does. */
function hexToOklab(hex) {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}
function oklabToRgb([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const enc = (v) => {
        const c = Math.min(1, Math.max(0, v));
        return Math.round(255 * (c >= 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c));
    };
    return [
        enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        enc(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
}
const rgbOfHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test('replayed on the stock seed, the embed recipes land on tokens.json’s primaries', () => {
    const seed = tokens.seeds['--primary-base'];
    const lab = hexToOklab(seed);
    const near = (got, want, label) => {
        const off = Math.max(...got.map((v, i) => Math.abs(v - want[i])));
        assert.ok(off <= 2, `${label}: replayed ${got} vs tokens.json ${want}`);
    };
    // light: seed + black 8 %
    near(oklabToRgb([lab[0] * 0.92, lab[1] * 0.92, lab[2] * 0.92]), rgbOfHex(tokens.light['--primary']), 'light --primary');
    // dark: 10 % seed against L 78 % with the seed's own a/b
    near(oklabToRgb([lab[0] * 0.1 + 0.78 * 0.9, lab[1], lab[2]]), rgbOfHex(tokens.dark['--primary']), 'dark --primary');
    near(oklabToRgb([lab[0] * 0.1 + 0.86 * 0.9, lab[1], lab[2]]), rgbOfHex(tokens.dark['--primary-hover']), 'dark --primary-hover');
});

test('the generated seeds file carries tokens.json’s seeds', () => {
    const seeds = readFileSync(join(ROOT, 'config', 'theme-seeds.php'), 'utf8');
    assert.ok(seeds.includes(`'primary'   => '${tokens.seeds['--primary-base'].toLowerCase()}'`));
    assert.ok(seeds.includes(`'secondary' => '${tokens.seeds['--secondary-base'].toLowerCase()}'`));
});
