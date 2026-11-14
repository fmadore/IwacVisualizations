'use strict';

// The references dashboard's layout rules, without a browser:
//
//   * the author network's groups are Louvain communities — two tight
//     cliques joined by one edge come out as two groups, the same groups on
//     every run, numbered largest first;
//   * the graph model names a group after its most prolific member, pools
//     the small ones, and keeps the edge relationship as the line style;
//   * `P.packChartsGrid` widens a half-width panel only when nothing on its
//     row could partner it (V: "Content by country" alone on its row).

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, 'asset', 'js', ...parts), 'utf8');

function load() {
    const context = {
        console,
        document: { createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { add() {} }, style: {} }) },
        window: { IWACVis: { t: (k, p) => (p && p.name ? k + ':' + p.name : k), formatNumber: String, locale: 'en' } },
    };
    vm.createContext(context);
    vm.runInContext(read('charts', 'shared', 'panels.js'), context, { filename: 'panels.js' });
    vm.runInContext(read('charts', 'references-overview', 'collaboration-network.js'), context,
        { filename: 'collaboration-network.js' });
    return context.window.IWACVis.panels;
}

/** Every pair inside each group, weight 3, plus the given bridges (weight 1). */
function cliques(groups, bridges) {
    const edges = [];
    groups.forEach((g) => {
        for (let i = 0; i < g.length; i++) {
            for (let j = i + 1; j < g.length; j++) edges.push({ source: g[i], target: g[j], weight: 3, type: 'coauthor' });
        }
    });
    bridges.forEach(([a, b]) => edges.push({ source: a, target: b, weight: 1, type: 'author_editor' }));
    return edges;
}

test('two cliques joined by one edge are two communities, largest first', () => {
    const P = load();
    const big = ['a', 'b', 'c', 'd', 'e'];
    const small = ['v', 'w', 'x', 'y'];
    const ids = big.concat(small);
    const out = P.collaborationCommunities(ids, cliques([big, small], [['e', 'v']]));
    big.forEach((id) => assert.equal(out[id], 0, id));
    small.forEach((id) => assert.equal(out[id], 1, id));
});

test('the communities do not depend on a run', () => {
    const P = load();
    const groups = [['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']];
    const edges = cliques(groups, [['c', 'd'], ['f', 'g'], ['i', 'a']]);
    const ids = groups.flat().sort();
    const first = JSON.stringify(P.collaborationCommunities(ids, edges));
    for (let i = 0; i < 5; i++) {
        assert.equal(JSON.stringify(P.collaborationCommunities(ids, edges.slice().reverse())), first);
    }
    assert.equal(new Set(Object.values(JSON.parse(first))).size, 3);
});

test('a graph with no edges keeps every node in its own group', () => {
    const P = load();
    const out = P.collaborationCommunities(['a', 'b'], []);
    assert.notEqual(out.a, out.b);
});

test('groups are named after their most prolific member, and small ones pooled', () => {
    const P = load();
    const big = ['a', 'b', 'c', 'd'];
    const pair = ['y', 'z'];
    const value = { a: 2, b: 9, c: 1, d: 1, y: 5, z: 1 };
    const model = P.collaborationGraphModel({
        nodes: big.concat(pair).map((id) => ({ id, name: id.toUpperCase(), value: value[id] })),
        edges: cliques([big, pair], [['d', 'y']]),
    });
    // Slot 0 is the renderer's (absent) ego centre; then the big group,
    // named after B; the pair is below MIN_GROUP_SIZE, so it is pooled.
    // JSON round trip: the arrays come from the vm's realm.
    assert.deepEqual(JSON.parse(JSON.stringify(model.categories.map((c) => c.name))),
        ['', 'references_group_around:B', 'references_group_smaller']);
    const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
    assert.equal(byId.a.category, 1);
    assert.equal(byId.y.category, model.otherIndex);
    // The member the group is named after is always labelled.
    assert.equal(byId.b.prominent, true);
    // The most prolific author is drawn largest.
    assert.ok(byId.b.size > byId.a.size);
    // Author–editor pairs are the renderer's dashed `weak` links.
    const bridge = model.links.find((l) => l.source === 'd' && l.target === 'y');
    assert.equal(bridge.weak, true);
    assert.equal(model.links.find((l) => l.source === 'a' && l.target === 'b').weak, false);
});

test('only the most prolific authors and the group anchors keep a label', () => {
    const P = load();
    // Twelve authors who all wrote together: one group, whose anchor is the
    // top author, so exactly the eight most prolific are named.
    const ids = Array.from({ length: 12 }, (_, i) => 'n' + String(i).padStart(2, '0'));
    const model = P.collaborationGraphModel({
        nodes: ids.map((id, i) => ({ id, name: id, value: 20 - i })),
        edges: cliques([ids], []),
    });
    assert.equal(new Set(model.nodes.map((n) => n.category)).size, 1);
    const named = model.nodes.filter((n) => n.prominent).map((n) => n.id);
    assert.deepEqual(JSON.parse(JSON.stringify(named)), ids.slice(0, 8));
});

/* ------------------------------------------------------------------ */
/*  Grid packing                                                       */
/* ------------------------------------------------------------------ */

function panel(wide, hidden) {
    const classes = new Set(['iwac-vis-panel'].concat(wide ? ['iwac-vis-panel--wide'] : []));
    return {
        hidden: !!hidden,
        classList: {
            contains: (c) => classes.has(c),
            toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
        },
        get solo() { return classes.has('iwac-vis-panel--solo'); },
    };
}

function pack(P, children) {
    P.packChartsGrid({ children });
    return children.map((c) => c.solo);
}

test('a half-width panel between two wide ones spans the row', () => {
    const P = load();
    // timeline | types languages | countries | authors — the live layout
    // before this change.
    assert.deepEqual(pack(P, [panel(true), panel(), panel(), panel(), panel(true)]),
        [false, false, false, true, false]);
});

test('paired half-width panels stay half width, and a trailing one widens', () => {
    const P = load();
    assert.deepEqual(pack(P, [panel(), panel(), panel()]), [false, false, true]);
    assert.deepEqual(pack(P, [panel(), panel(), panel(), panel()]), [false, false, false, false]);
});

test('a hidden panel leaves its partner alone', () => {
    const P = load();
    assert.deepEqual(pack(P, [panel(), panel(false, true), panel(true)]), [true, false, false]);
});

test('a panel that regains a partner loses the widening', () => {
    const P = load();
    const kids = [panel(), panel(false, true)];
    assert.deepEqual(pack(P, kids), [true, false]);
    kids[1].hidden = false;
    assert.deepEqual(pack(P, kids), [false, false]);
});
