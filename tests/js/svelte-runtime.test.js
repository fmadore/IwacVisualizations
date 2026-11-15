'use strict';

// The shared Svelte runtime (scripts/lib/svelte-runtime.js): the scan that
// decides which runtime names shared-svelte carries, and the two generated
// modules that publish and read them. The build's end-to-end behaviour —
// both blocks mounting off one runtime — is in the browser suite.

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const rt = require('../../scripts/lib/svelte-runtime.js');

const names = (usage, spec) => [...(usage.get(spec) || { names: new Set() }).names].sort();

test('the scan collects named imports and namespace reads, reserved words included', () => {
    const usage = rt.scanModule([
        "import * as $ from 'svelte/internal/client';",
        "import { onMount, tick as t } from 'svelte';",
        "import 'svelte/internal/flags/legacy';",
        "import { helper } from './helper.js';",
        'export default function C(node) { const x = { $: 1, key: $.template };',
        '  $.if(node, () => $.append(node, x)); onMount(t); helper(x.$); }',
    ].join('\n'), 'C.svelte');
    assert.deepEqual(names(usage, 'svelte/internal/client'), ['append', 'if', 'template']);
    assert.deepEqual(names(usage, 'svelte'), ['onMount', 'tick']);
    assert.equal(usage.get('svelte/internal/flags/legacy').sideEffect, true);
    assert.equal(usage.has('./helper.js'), false);
});

test('the scan refuses what a published name cannot stand for', () => {
    const refused = [
        ["import S from 'svelte';", /default import/],
        ["export { mount } from 'svelte';", /re-exports/],
        ["export * from 'svelte/internal/client';", /re-exports/],
        ["const m = import('svelte');", /dynamic import/],
        ["import * as $ from 'svelte/internal/client'; $['tem' + 'plate']();", /computed read/],
        ["import * as $ from 'svelte/internal/client'; const { template } = $;", /used as a value/],
        ["import * as $ from 'svelte/internal/client'; f($);", /used as a value/],
    ];
    for (const [code, message] of refused) {
        assert.throws(() => rt.scanModule(code, 'X.js'), message, code);
    }
});

test('the scan reads the real components: every Svelte module the build compiles is accepted', async () => {
    const { compile } = await import('svelte/compiler');
    const file = join(__dirname, '..', '..', 'asset', 'js', 'svelte', 'collection-intro', 'Count.svelte');
    const { js } = compile(readFileSync(file, 'utf8'), { generate: 'client', runes: true, discloseVersion: false, css: 'external' });
    const usage = rt.scanModule(js.code, 'Count.svelte');
    assert.ok(names(usage, 'svelte/internal/client').length > 0);
    assert.deepEqual(names(usage, 'svelte'), ['onDestroy']);
});

test('the runtime publishes the union, and a block reads back only its own names', () => {
    const union = rt.mergeUsage(new Map(), new Map([['svelte/internal/client', { names: new Set(['if', 'template']), sideEffect: false }]]));
    rt.mergeUsage(union, new Map([['svelte', { names: new Set(['mount']), sideEffect: false }]]));
    const entry = rt.runtimeEntrySource(union);
    assert.match(entry, /import \{ if as __svelte\d+, template as __svelte\d+ \} from "svelte\/internal\/client";/);
    assert.match(entry, /ns\.svelteRuntime = Object\.freeze/);

    const block = rt.externalModuleSource('svelte/internal/client', new Set(['template']), 'blocks/x');
    assert.match(block, /export \{ __svelte0 as template \};/);
    assert.doesNotMatch(block, /R\["if"\]/);
});

test('a block bundle without the runtime fails with a message naming it', () => {
    const source = rt.externalModuleSource('svelte', new Set(['mount']), 'blocks/x')
        .replace(/^export .*$/m, '');
    assert.throws(() => vm.runInNewContext(source, { window: {} }), /blocks\/x needs the shared Svelte runtime \(shared-svelte\)/);
});
