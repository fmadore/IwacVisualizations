'use strict';

// Geometry guard for C.divergingBar — the Likert plot behind the sentiment
// atlas's "polarity by topic" / "by newspaper" panels.
//
// None of what this checks is visible in a screenshot review, and all of it
// is easy to break while editing something else:
//
//   * the midpoint grade is drawn as TWO series carrying half its share
//     each, one signed negative and one positive. Lose the halving and every
//     bar grows by the neutral share; lose the sign and the whole chart
//     collapses onto the right of the axis;
//   * those two series share ONE name, which is what makes the legend show a
//     single "Neutre" swatch that toggles both. Rename either and the legend
//     silently grows a sixth entry that hides half the neutral block;
//   * series ORDER is the stacking order, so it has to run outward from zero
//     on each side. Reverse it and the extremes end up next to the axis, with
//     the ramp reading inside-out;
//   * a zero-count grade must be null rather than 0, because ECharts paints a
//     0-height segment as a hairline — five of them on a 15px bar read as
//     real categories;
//   * the extent has to snap to a lattice THROUGH zero, or the axis grows a
//     tick beside zero instead of on it.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const SHARED = join(ROOT, 'asset', 'js', 'charts', 'shared');
const read = (file) => readFileSync(join(SHARED, file), 'utf8');

const SCALE = ['Très négatif', 'Négatif', 'Neutre', 'Positif', 'Très positif'];
const NEUTRAL = 'Neutre';

/** Load the real chart-options core + horizontal-bar builders in a VM. */
function loadChartOptions() {
    const window = {
        IWACVis: {
            getChartTokens: () => ({ ink: '#111', inkLight: '#444', surface: '#fff' }),
            getPalette: () => ['#111', '#222'],
            readColorVar: (name) => `resolved:${name}`,
            locale: 'fr',
            panels: {
                t: (key) => key,
                formatNumber: (n) => String(n),
                escapeHtml: (s) => String(s),
                isUnknown: () => false,
            },
            responsive: {
                BP: { sm: 640, md: 768, lg: 1024 },
                withMedia: (base, ...media) => ({ baseOption: base, media: media.flat() }),
            },
        },
    };
    const sandbox = { window, console, document: undefined };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('chart-options.js'), sandbox);
    vm.runInContext(read('chart-options-hbar.js'), sandbox);
    return window.IWACVis.chartOptions;
}

/** Three rows spanning the shapes that matter: lopsided, balanced, sparse. */
function fixtureRows() {
    return [
        { name: 'positive row', full: 'positive row (full)', counts: { 'Très positif': 20, Positif: 60, Neutre: 20, 'Négatif': 0, 'Très négatif': 0 } },
        { name: 'negative row', full: 'negative row (full)', counts: { 'Très positif': 0, Positif: 10, Neutre: 40, 'Négatif': 30, 'Très négatif': 20 } },
        { name: 'empty row', full: 'empty row (full)', counts: { 'Très positif': 0, Positif: 0, Neutre: 0, 'Négatif': 0, 'Très négatif': 0 } },
    ];
}

function build(C, overrides) {
    const wrapped = C.divergingBar(Object.assign({
        rows: fixtureRows(),
        order: SCALE,
        neutralKey: NEUTRAL,
        colors: { 'Très négatif': '#a', 'Négatif': '#b', Neutre: '#c', Positif: '#d', 'Très positif': '#e' },
        labelFor: (k) => k,
        extent: { min: -60, max: 100, interval: 20 },
        countName: 'Articles',
    }, overrides || {}));
    return wrapped.baseOption || wrapped;
}

test('diverging bar splits the midpoint grade across zero, half to each side', () => {
    const C = loadChartOptions();
    const opt = build(C);
    const neutrals = opt.series.filter((s) => s.name === NEUTRAL);

    assert.equal(neutrals.length, 2, 'midpoint grade must be drawn as two half-series');
    // Row 0: neutral is 20 of 100 → 20%, so ±10 on each side.
    assert.equal(neutrals[0].data[0], -10);
    assert.equal(neutrals[1].data[0], 10);
    // Row 1: neutral is 40 of 100 → ±20.
    assert.equal(neutrals[0].data[1], -20);
    assert.equal(neutrals[1].data[1], 20);
});

test('every row spans exactly 100 points of its own total', () => {
    const C = loadChartOptions();
    const opt = build(C);
    // Rows with no ratings are dropped, so only the two real ones remain.
    assert.equal(opt.yAxis[0].data.length, 2, 'a row with no ratings must not be plotted');

    for (let row = 0; row < 2; row++) {
        const span = opt.series.reduce((sum, s) => sum + Math.abs(s.data[row] || 0), 0);
        assert.ok(Math.abs(span - 100) < 1e-9, `row ${row} spans ${span}, not 100`);
    }
});

test('each side stacks outward from zero, extremes furthest out', () => {
    const C = loadChartOptions();
    const opt = build(C);
    const names = opt.series.map((s) => s.name);

    assert.deepEqual([...names], [
        NEUTRAL, 'Négatif', 'Très négatif',   // left, nearest the axis first
        NEUTRAL, 'Positif', 'Très positif',   // right, same
    ]);

    const sign = (n) => opt.series.filter((s) => s.name === n);
    assert.ok(sign('Négatif').every((s) => s.data.every((v) => v === null || v < 0)));
    assert.ok(sign('Très négatif').every((s) => s.data.every((v) => v === null || v < 0)));
    assert.ok(sign('Positif').every((s) => s.data.every((v) => v === null || v > 0)));
    assert.ok(sign('Très positif').every((s) => s.data.every((v) => v === null || v > 0)));
});

test('the legend names each grade once, in scale order', () => {
    const C = loadChartOptions();
    const opt = build(C);
    assert.deepEqual([...opt.legend.data], SCALE);
    assert.equal(new Set(opt.legend.data).size, SCALE.length, 'legend must not repeat a grade');
});

test('a grade with no articles is omitted rather than drawn as a hairline', () => {
    const C = loadChartOptions();
    const opt = build(C);
    // Row 0 has no negative ratings at all.
    for (const s of opt.series.filter((x) => /négatif/i.test(x.name))) {
        assert.equal(s.data[0], null, `${s.name} should be null, not 0, where the count is 0`);
    }
});

test('the count gutter carries each row total, aligned to its bar', () => {
    const C = loadChartOptions();
    const opt = build(C);
    assert.equal(opt.yAxis[1].position, 'right');
    assert.equal(opt.yAxis[1].inverse, opt.yAxis[0].inverse, 'the two axes must run the same way');
    assert.deepEqual([...opt.yAxis[1].data], ['100', '100']);
    // The labels have to clear the plot: right-aligned text grows leftward
    // from its anchor, so the margin must exceed the default 8px gap.
    assert.ok(opt.yAxis[1].axisLabel.margin > 8, 'count labels would overlap the bar ends');
});

test('extent snaps to a lattice through zero', () => {
    const C = loadChartOptions();
    const extent = C.divergingExtent(fixtureRows(), SCALE, NEUTRAL, 20);

    // negative row: 50 negative + half of 40 neutral = 70 → snaps to 80.
    // positive row: 80 positive + half of 20 neutral = 90 → snaps to 100.
    assert.deepEqual({ ...extent }, { min: -80, max: 100, interval: 20 });
    // Math.abs because -80 % 20 is -0, which strict equality rejects.
    assert.equal(Math.abs(extent.min % extent.interval), 0, 'zero must fall on a tick');
    assert.equal(Math.abs(extent.max % extent.interval), 0, 'zero must fall on a tick');
});

test('extent never reports a range of zero for an all-neutral corpus', () => {
    const C = loadChartOptions();
    const flat = [{ name: 'n', counts: { 'Très positif': 0, Positif: 0, Neutre: 10, 'Négatif': 0, 'Très négatif': 0 } }];
    const extent = C.divergingExtent(flat, SCALE, NEUTRAL, 20);
    assert.ok(extent.min < 0 && extent.max > 0, 'a degenerate extent would collapse the axis');
});

test('polarity is painted from the diverging token ramp, keyed on the raw grade', () => {
    const C = loadChartOptions();
    const palette = C.polarityPalette();
    assert.deepEqual([...Object.keys(palette)], [...SCALE].reverse().concat('Non applicable'));
    for (const grade of SCALE) {
        assert.ok(palette[grade], `${grade} has no colour`);
    }
    // The positive half steps by LIGHTNESS off one token, so which of the two
    // is the raw token matters: --success is the STRONG grade, and "Positif"
    // is the mix that sits nearer the surface. Reversing these is how the
    // ramp came to invert in dark mode (see iwac-core.css).
    assert.equal(palette['Très positif'], 'resolved:--iwac-vis-sent-pos-strong');
    assert.equal(palette.Positif, 'resolved:--iwac-vis-sent-pos');
});

// Centralité is ordered too, and had been left on the categorical palette a
// release after polarité was fixed. The grade names are the raw French keys
// the bundle's `centrality_order` carries — a typo here means a silent
// fallback to whatever ECharts assigns, which is exactly the bug.
test('centrality is painted from the sequential token ramp, keyed on the raw grade', () => {
    const C = loadChartOptions();
    const palette = C.centralityPalette();
    const ORDER = ['Très central', 'Central', 'Secondaire', 'Marginal', 'Non abordé'];
    assert.deepEqual([...Object.keys(palette)], ORDER);
    // Slots run 1..4 from most central, then the flat "not addressed" tint.
    assert.equal(palette['Très central'], 'resolved:--iwac-vis-cent-1');
    assert.equal(palette.Marginal, 'resolved:--iwac-vis-cent-4');
    assert.equal(palette['Non abordé'], 'resolved:--iwac-vis-cent-na');
});

// Every slot of every ramp, spelled out.
//
// The three tables were consolidated here out of person-dashboard/sentiment.js
// and laicite/sentiment.js, which means this file is now the only place a
// wrong slot would show up. Partial coverage is not enough: the older
// person-dashboard test asserted subjectivité slot 5 and nothing else, and a
// deliberate slot-3 → slot-5 swap sailed straight through it. The distinctness
// check below is what actually catches that class of typo — two grades
// resolving to one token cannot be correct on any ordered scale.
test('every ramp maps each grade to its own distinct token', () => {
    const C = loadChartOptions();
    const expected = {
        polarity: [C.polarityPalette(), {
            'Très positif': 'resolved:--iwac-vis-sent-pos-strong',
            'Positif': 'resolved:--iwac-vis-sent-pos',
            'Neutre': 'resolved:--iwac-vis-sent-neutral',
            'Négatif': 'resolved:--iwac-vis-sent-neg',
            'Très négatif': 'resolved:--iwac-vis-sent-neg-strong',
            'Non applicable': 'resolved:--iwac-vis-sent-na',
        }],
        centrality: [C.centralityPalette(), {
            'Très central': 'resolved:--iwac-vis-cent-1',
            'Central': 'resolved:--iwac-vis-cent-2',
            'Secondaire': 'resolved:--iwac-vis-cent-3',
            'Marginal': 'resolved:--iwac-vis-cent-4',
            'Non abordé': 'resolved:--iwac-vis-cent-na',
        }],
        subjectivity: [C.subjectivityPalette(), {
            1: 'resolved:--iwac-vis-subj-1',
            2: 'resolved:--iwac-vis-subj-2',
            3: 'resolved:--iwac-vis-subj-3',
            4: 'resolved:--iwac-vis-subj-4',
            5: 'resolved:--iwac-vis-subj-5',
        }],
    };
    for (const [name, [actual, want]] of Object.entries(expected)) {
        assert.deepEqual({ ...actual }, want, `${name}: slot mapping drifted`);
        const values = Object.values(actual);
        assert.equal(
            new Set(values).size, values.length,
            `${name}: two grades resolve to the same token`
        );
    }
});

// The rule the light/dark inversion broke: a ramp step taken toward literal
// black or white is not theme-relative, so it reverses direction when the
// surface flips. scripts/check-theme-tokens.js enforces this at build time;
// this asserts the guard is actually wired to the ramp tokens rather than
// passing because it never looked at them.
test('no module ramp token mixes toward literal black or white', () => {
    const css = readFileSync(join(ROOT, 'asset', 'css', 'iwac-core.css'), 'utf8');
    const offenders = css.split(/\r?\n/)
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => /--iwac-vis-(?:sent|cent|subj|heatmap)-/.test(line))
        .filter(([, line]) => /color-mix\([^;]*\b(?:black|white)\b/i.test(line));
    assert.deepEqual(offenders, [], 'mix toward --surface or --ink instead');
});
