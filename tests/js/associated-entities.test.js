'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = readFileSync(join(
    __dirname, '..', '..', 'asset', 'js', 'charts', 'person-dashboard', 'network.js'
), 'utf8');

function loadModule() {
    const context = {
        console,
        window: {
            IWACVis: {
                panels: { mountEntityGraph() {} },
            },
        },
    };
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'network.js' });
    return context.window.IWACVis.personDashboard.network;
}

test('associated-entity type filter prefers the generator-ranked variant', () => {
    const mod = loadModule();
    const centre = { o_id: 1, type: 'center' };
    const rootPerson = { o_id: 2, type: 'Personnes' };
    const rankedPerson = { o_id: 99, type: 'Personnes' };
    const graph = {
        nodes: [centre, rootPerson],
        edges: [{ source: 1, target: 2, kind: 'ego' }],
        by_type: {
            Personnes: {
                nodes: [centre, rankedPerson],
                edges: [{ source: 1, target: 99, kind: 'ego' }],
            },
        },
    };
    const result = mod.graphForType(graph, 'Personnes');
    assert.deepEqual(Array.from(result.nodes, (node) => node.o_id), [1, 99]);
});

test('associated-entity type filter degrades safely against legacy payloads', () => {
    const mod = loadModule();
    const graph = {
        nodes: [
            { o_id: 1, type: 'center' },
            { o_id: 2, type: 'Personnes' },
            { o_id: 3, type: 'Organisations' },
        ],
        edges: [
            { source: 1, target: 2, kind: 'ego' },
            { source: 1, target: 3, kind: 'ego' },
            { source: 2, target: 3, kind: 'cross' },
        ],
    };
    const result = mod.graphForType(graph, 'Personnes');
    assert.deepEqual(Array.from(result.nodes, (node) => node.o_id), [1, 2]);
    assert.deepEqual(
        Array.from(result.edges, (edge) => [edge.source, edge.target]),
        [[1, 2]]
    );
});

test('associated-entity top-N keeps only edges whose endpoints remain visible', () => {
    const mod = loadModule();
    const graph = {
        nodes: [
            { o_id: 1, type: 'center' },
            { o_id: 2, type: 'Personnes' },
            { o_id: 3, type: 'Personnes' },
        ],
        edges: [
            { source: 1, target: 2, kind: 'ego' },
            { source: 1, target: 3, kind: 'ego' },
            { source: 2, target: 3, kind: 'cross' },
        ],
    };
    const result = mod.limitGraph(graph, 1);
    assert.deepEqual(Array.from(result.nodes, (node) => node.o_id), [1, 2]);
    assert.deepEqual(
        Array.from(result.edges, (edge) => [edge.source, edge.target]),
        [[1, 2]]
    );
});

test('associated-entity time matrix keeps rank order and aggregates into periods', () => {
    const mod = loadModule();
    const graph = {
        nodes: [
            { o_id: 1, type: 'center' },
            { o_id: 2, type: 'Personnes', title: 'First' },
            { o_id: 3, type: 'Organisations', title: 'Second' },
        ],
        edges: [],
    };
    const temporal = {
        year_min: 1998,
        year_max: 2007,
        dated_items: 5,
        undated_items: 2,
        entities: {
            2: [[1999, 1], [2001, 2], [2006, 1]],
            3: [[2004, 3]],
            99: [[2001, 20]],
        },
    };

    const fiveYear = mod.buildTimeMatrix(graph, temporal, 5);
    assert.deepEqual(Array.from(fiveYear.periods, (period) => period.start), [1995, 2000, 2005]);
    assert.deepEqual(Array.from(fiveYear.rows, (row) => row.node.o_id), [2, 3]);
    assert.deepEqual(Array.from(fiveYear.rows[0].values), [1, 2, 1]);
    assert.deepEqual(Array.from(fiveYear.rows[1].values), [0, 3, 0]);
    assert.equal(fiveYear.rows[0].total, 4);
    assert.equal(fiveYear.maxCount, 3);
    assert.equal(fiveYear.undatedItems, 2);

    const decades = mod.buildTimeMatrix(graph, temporal, 10);
    assert.deepEqual(Array.from(decades.periods, (period) => period.start), [1990, 2000]);
    assert.deepEqual(Array.from(decades.rows[0].values), [1, 3]);
});
