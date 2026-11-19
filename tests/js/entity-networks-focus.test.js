'use strict';

/**
 * Entity Networks: the opening frame and the neighbourhood close-up.
 *
 * The opening view used to be fitted to the layout's extremes, so one
 * straggling node ("Sacrifice", 2026-11) put 2,852 nodes in the bottom 15%
 * of the canvas. `coreBounds` fits the central share instead. `ego.build`
 * turns a map selection into the payload the force renderer draws.
 */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (...parts) => readFileSync(join(ROOT, 'asset', 'js', 'charts', ...parts), 'utf8');

function load() {
    const window = {
        IWACVis: {
            panels: {
                // graph.js only checks these exist before registering.
                createIwacMap() {}, createIwacPopup() {}, deferMaplibre() {},
            },
        },
    };
    const context = vm.createContext({ window, console });
    vm.runInContext(read('entity-networks', 'graph.js'), context, { filename: 'graph.js' });
    vm.runInContext(read('entity-networks', 'ego.js'), context, { filename: 'ego.js' });
    return window.IWACVis.entityNetworks;
}

const EN = load();

test('the opening frame ignores a straggler', () => {
    const points = [];
    for (let i = 0; i < 200; i++) points.push({ lng: (i % 20) - 10, lat: Math.floor(i / 20) - 5 });
    const whole = EN.graph.coreBounds(points, 0.01);
    points.push({ lng: 0, lat: 80 }); // one node far above the rest
    const withStraggler = EN.graph.coreBounds(points, 0.01);
    assert.ok(withStraggler[3] < 5, `north edge followed the straggler: ${withStraggler[3]}`);
    assert.deepEqual(withStraggler.map(Math.round), whole.map(Math.round));
});

test('q = 0 is the plain bounding box', () => {
    const b = EN.graph.coreBounds([{ lng: -3, lat: 1 }, { lng: 4, lat: -2 }, { lng: 0, lat: 9 }], 0);
    assert.deepEqual(Array.from(b), [-3, -2, 4, 9]);
});

function sample() {
    const nodes = [
        { id: 100, label: 'Hadj', type: 3 },
        { id: 101, label: 'Tabaski', type: 2 },
        { id: 102, label: 'La Mecque', type: 4 },
        { id: 103, label: 'Pèlerin', type: 0 },
        { id: 104, label: 'Ailleurs', type: 0 },
    ];
    return {
        types: ['Personnes', 'Organisations', 'Événements', 'Sujets', 'Lieux'],
        nodes,
        edges: [[0, 1, 300], [0, 2, 40], [0, 3, 5], [1, 2, 12], [2, 3, 2], [3, 4, 9], [1, 4, 50]],
    };
}

function selectionOf(data, index) {
    const neighbours = [];
    data.edges.forEach(([a, b, w]) => {
        if (a === index) neighbours.push({ index: b, node: data.nodes[b], weight: w });
        if (b === index) neighbours.push({ index: a, node: data.nodes[a], weight: w });
    });
    neighbours.sort((x, y) => y.weight - x.weight);
    return { index, node: data.nodes[index], neighbors: neighbours };
}

test('the close-up is the centre, its strongest neighbours and the links among them', () => {
    const data = sample();
    const payload = JSON.parse(JSON.stringify(EN.ego.build(data, selectionOf(data, 0), { cap: 2 })));
    assert.deepEqual(payload.nodes.map((n) => n.title), ['Hadj', 'Tabaski', 'La Mecque']);
    assert.equal(payload.nodes[0].type, 'center');
    assert.deepEqual(payload.nodes.slice(1).map((n) => n.type), ['Événements', 'Lieux']);
    const ego = payload.edges.filter((e) => e.kind === 'ego');
    const cross = payload.edges.filter((e) => e.kind === 'cross');
    assert.deepEqual(ego.map((e) => [e.source, e.target, e.weight]), [[100, 101, 300], [100, 102, 40]]);
    // Tabaski–La Mecque joins two kept neighbours; links to Ailleurs or
    // Pèlerin (not kept) and the centre's own links stay out.
    assert.deepEqual(cross.map((e) => [e.source, e.target, e.weight]), [[101, 102, 12]]);
});

test('cross links below the reader\'s minimum strength stay out', () => {
    const data = sample();
    const payload = JSON.parse(JSON.stringify(EN.ego.build(data, selectionOf(data, 0), { weightMin: 3 })));
    const cross = payload.edges.filter((e) => e.kind === 'cross');
    assert.deepEqual(cross.map((e) => [e.source, e.target]), [[101, 102]]); // 102–103 weighs 2
});

test('a place-network node is a place', () => {
    const data = sample();
    data.types = null;
    const payload = JSON.parse(JSON.stringify(EN.ego.build(data, selectionOf(data, 0), { cap: 1 })));
    assert.equal(payload.nodes[1].type, 'Lieux');
});
