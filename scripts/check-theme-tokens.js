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
 *     `--iwac-compare-color-a/b` and `--iwac-otd-axis-gap` drift out of it.
 */
const { join } = require('path');
const { cli } = require('./theme-token-guard.cjs');

cli({
    root: join(__dirname, '..'),
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
