'use strict';

// The Sentiment Atlas's pure helpers (charts/sentiment-atlas/scales.js,
// compare.js, trends.js), run in a VM against stub panels.
//
// Three things here are easy to get subtly wrong and invisible on a chart:
//   - Spearman's rho from a cross-tab of counts must equal rho over the
//     articles it counts, ties and all — the midrank shortcut is only right
//     if every cell's articles share one rank pair;
//   - a v0.3.0 bundle (polarity, exact agreement) must adapt into the
//     v0.4.0 shape with every statistic it never carried left null, so the
//     panel prints "n/a" rather than a kappa of 0;
//   - folding years into decades must sum counts before taking shares, never
//     average the yearly shares.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const read = (file) => readFileSync(join(ROOT, 'asset', 'js', 'charts', 'sentiment-atlas', file), 'utf8');

function load() {
    const ns = {
        panels: {
            t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
            formatNumber: (n) => String(n),
            escapeHtml: (s) => String(s),
            el: () => ({ appendChild() {} }),
        },
        chartOptions: {
            polarityPalette: () => ({}),
            centralityPalette: () => ({}),
            subjectivityPalette: () => ({}),
            // The option scaffolding trendOption composes with.
            _dataZoom: () => [],
            _grid: (o) => o,
            _legend: (o) => o || {},
            _percentAxisLabel: () => ({}),
            _valueAxisName: () => ({}),
        },
    };
    const context = { window: { IWACVis: ns }, console };
    vm.createContext(context);
    for (const file of ['scales.js', 'compare.js', 'trends.js']) {
        vm.runInContext(read(file), context, { filename: file });
    }
    return ns.sentimentAtlas;
}

/** A VM value as a plain one: its arrays come from another realm. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Spearman's rho over expanded observations, by brute force. */
function spearmanBrute(pairs) {
    const rank = (values) => {
        const sorted = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
        const ranks = new Array(values.length);
        for (let i = 0; i < sorted.length;) {
            let j = i;
            while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
            const mid = (i + j) / 2 + 1;
            for (let k = i; k <= j; k++) ranks[sorted[k][1]] = mid;
            i = j + 1;
        }
        return ranks;
    };
    const x = rank(pairs.map((p) => p[0]));
    const y = rank(pairs.map((p) => p[1]));
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(x);
    const my = mean(y);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    x.forEach((xi, i) => {
        sxy += (xi - mx) * (y[i] - my);
        sxx += (xi - mx) ** 2;
        syy += (y[i] - my) ** 2;
    });
    return sxy / Math.sqrt(sxx * syy);
}

test('Spearman from a cross-tab equals Spearman over its articles', () => {
    const S = load();
    const table = [
        [12, 4, 0, 1, 0],
        [6, 20, 9, 2, 1],
        [1, 8, 30, 11, 3],
        [0, 2, 9, 18, 7],
        [0, 1, 2, 6, 10],
    ];
    const pairs = [];
    table.forEach((row, i) => row.forEach((n, j) => {
        for (let k = 0; k < n; k++) pairs.push([i, j]);
    }));
    const out = S.spearmanFromTable(table);
    assert.equal(out.n, pairs.length);
    assert.ok(Math.abs(out.rho - spearmanBrute(pairs)) < 1e-12);
    assert.ok(out.p < 0.001);
    assert.equal(S.rhoBand(out.rho), 'strong');
});

test('Spearman is null, not zero, when a margin has no spread', () => {
    const S = load();
    assert.equal(S.spearmanFromTable([[5, 3, 2]]).rho, null);
    assert.equal(S.spearmanFromTable([]).rho, null);
    // Too few articles for a p-value at all.
    assert.equal(S.spearmanFromTable([[3, 0], [0, 4]]).p, null);
});

test('kappa bands follow Landis and Koch, and an undefined kappa has none', () => {
    const S = load();
    assert.deepEqual(
        plain([-0.1, 0.1, 0.3, 0.5, 0.7, 0.9].map(S.kappaBand)),
        ['poor', 'slight', 'fair', 'moderate', 'substantial', 'almost_perfect'],
    );
    assert.equal(S.kappaBand(null), null);
    assert.equal(S.kappaBand(NaN), null);
});

test('reading order runs low to high, with Not applicable after the scale', () => {
    const S = load();
    const data = {
        polarity_order: ['Très positif', 'Positif', 'Neutre', 'Négatif', 'Très négatif', 'Non applicable'],
        centrality_order: ['Très central', 'Central', 'Secondaire', 'Marginal', 'Non abordé'],
    };
    assert.deepEqual(plain(S.readingOrder(data, 'polarity')),
        ['Très négatif', 'Négatif', 'Neutre', 'Positif', 'Très positif', 'Non applicable']);
    assert.deepEqual(plain(S.readingOrder(data, 'centrality')),
        ['Non abordé', 'Marginal', 'Secondaire', 'Central', 'Très central']);
    assert.deepEqual(plain(S.readingOrder(data, 'subjectivity')), ['1', '2', '3', '4', '5']);
    // The map's colour steps cover the same five grades, lowest first.
    assert.deepEqual(plain(S.meanScale('polarity').steps.map((s) => s[1])),
        ['Très négatif', 'Négatif', 'Neutre', 'Positif', 'Très positif']);
});

test('a v0.3.0 bundle adapts to polarity alone, with no invented kappa', () => {
    const S = load();
    const legacy = {
        polarity_order: ['Très positif', 'Positif', 'Neutre', 'Négatif', 'Très négatif', 'Non applicable'],
        agreement: [{ models: ['a', 'b'], co_rated: 10, agreement_pct: 60, matrix: [[1]] }],
    };
    assert.deepEqual(plain(S.compareDimensions(legacy)), ['polarity']);
    const rel = S.reliabilityFor(legacy, 'polarity');
    assert.equal(rel.pairs[0].n, 10);
    assert.equal(rel.pairs[0].exact, 60);
    for (const key of ['kappa', 'weighted_kappa', 'within_one', 'n_ordinal']) {
        assert.equal(rel.pairs[0][key], null, key);
    }
    assert.equal(rel.panel, null);
    assert.equal(S.reliabilityFor(legacy, 'centrality'), null);
    assert.equal(S.panelCaption(legacy, 'polarity'), '');
});

test('decades sum the yearly counts before the share is taken', () => {
    const S = load();
    const data = {
        years: [1998, 1999, 2000, 2001],
        trends: {
            common: { negative: { n: [10, 30, 5, 5], k: { a: [1, 9, 0, 5] } } },
            available: { negative: { n: { a: [12, 30, 5, 6] }, k: { a: [1, 9, 0, 6] } } },
        },
    };
    const models = [{ key: 'a', label: 'A' }];
    const decades = S.trendSeries(data, 'negative', 'decade', 'common', models);
    assert.deepEqual(plain(decades.periods), [1990, 2000]);
    assert.deepEqual(plain(decades.n.a), [40, 10]);
    assert.deepEqual(plain(decades.k.a), [10, 5]);
    const own = S.trendSeries(data, 'negative', 'year', 'available', models);
    assert.deepEqual(plain(own.n.a), [12, 30, 5, 6]);

    // A point under the minimum is a gap, not a share of a handful.
    const option = S.trendOption(data, { target: 'negative', period: 'year', cohort: 'common', min: 10 },
        models, () => '');
    assert.deepEqual(plain(option.series[2].data), [10, 30, null, null]);
});
