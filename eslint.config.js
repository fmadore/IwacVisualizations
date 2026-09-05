'use strict';

// ESLint for the module's JavaScript — `npm run lint:js`, part of `npm run lint`.
//
// `recommended` and nothing stylistic: what this gate is for is the class of
// bug the regex scripts in scripts/ could only approximate — a name that is
// never defined (`no-undef`), a value assigned and never read
// (`no-unused-vars`), a duplicate key, an unreachable branch. The browser
// sources are classic scripts (IIFEs over `window.IWACVis`) written in ES5
// with a few ES2015+ built-ins (`Promise`, `Object.assign`, `URL`), so they
// are parsed as scripts against the browser globals plus the four this module
// reads: its own namespace and the three libraries it loads from a CDN.
//
// Callback parameters are exempt from `no-unused-vars` because half the
// codebase is `function (el, instance)` render callbacks that use one of the
// two, and an empty `catch` is allowed because "best effort, never throw" is
// a deliberate and documented pattern here.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'asset/js/dist/**',
            '**/*.min.js',
            'playwright-report/**',
            'test-results/**',
        ],
    },
    js.configs.recommended,
    {
        files: ['asset/js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2017,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                IWACVis: 'writable',
                echarts: 'readonly',
                maplibregl: 'readonly',
                d3: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            // `obj.hasOwnProperty(k)` on plain objects the module built itself.
            'no-prototype-builtins': 'off',
        },
    },
    {
        files: ['scripts/**/*.js', 'tests/**/*.js', 'playwright.config.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: {
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            // check-theme-tokens.js writes `/* … */` inside its own block
            // comments with a zero-width space so the comment does not end.
            'no-irregular-whitespace': ['error', { skipComments: true }],
        },
    },
    {
        // Browser-side code inside the fixtures' <script> tags is not linted
        // (it is HTML); the specs run in Node but call into the page.
        files: ['tests/browser/**/*.js'],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser },
        },
    },
];
