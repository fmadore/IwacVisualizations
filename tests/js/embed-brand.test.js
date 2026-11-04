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
