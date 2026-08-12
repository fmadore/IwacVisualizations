'use strict';

// Regression guard for the person/entity dashboard sentiment bars. IWAC-theme
// deliberately exposes OKLCH and color-mix() tokens; browsers can paint those
// strings, but ECharts' zrender hover-emphasis path cannot parse and lift them.
// The panel must therefore use IWACVis.readColorVar(), which resolves every
// token to a legacy rgb()/rgba() value before it reaches C.segmentedBar.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = join(__dirname, '..', '..');
const SOURCE = readFileSync(
    join(ROOT, 'asset', 'js', 'charts', 'person-dashboard', 'sentiment.js'),
    'utf8'
);

class FakeElement {
    constructor(className = '') {
        this.children = [];
        this.className = className;
        this.innerHTML = '';
        this.style = {};
        this.textContent = '';
        this.classList = {
            add: (...names) => {
                const current = new Set(this.className.split(/\s+/).filter(Boolean));
                names.forEach((name) => current.add(name));
                this.className = [...current].join(' ');
            },
        };
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }
}

test('sentiment palettes resolve modern CSS colours before ECharts receives them', () => {
    const segmentedCalls = [];
    let rawStyleReads = 0;

    const P = {
        buildEmptyState: () => new FakeElement('empty'),
        buildFacetButtons: () => ({ root: new FakeElement('facets') }),
        el: (tag, className) => new FakeElement(className || ''),
        sentimentModelLabel: (key) => key,
        t: (key) => key,
    };
    const C = {
        segmentedBar(segments, opts) {
            segmentedCalls.push({
                axisLabel: opts.axisLabel,
                colors: { ...opts.colors },
                fallbackColor: opts.fallbackColor,
            });
            return { series: [] };
        },
    };
    const ns = {
        panels: P,
        chartOptions: C,
        readColorVar: (name) => `resolved:${name}`,
        registerChart(el, paint) {
            const chart = {
                clear() {},
                isDisposed: () => false,
                setOption() {},
            };
            paint(el, chart);
            return chart;
        },
    };
    const context = {
        console,
        document: { body: {} },
        getComputedStyle() {
            rawStyleReads += 1;
            throw new Error('sentiment panel bypassed IWACVis.readColorVar()');
        },
        window: { IWACVis: ns },
    };
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'person-dashboard/sentiment.js' });

    const model = {
        rated_articles: 3,
        polarite: [{ name: 'Positif', count: 1 }],
        centralite: [{ name: 'Très central', count: 1 }],
        subjectivite: [{ name: '5', count: 1 }],
    };
    context.window.IWACVis.personDashboard.sentiment.render(
        { chart: new FakeElement('host') },
        {
            sentiment: {
                by_role: {
                    all: { models: ['model'], by_model: { model } },
                },
            },
        },
        { role: 'all', subscribe() {} }
    );

    assert.equal(rawStyleReads, 0, 'raw OKLCH/color-mix values reached the panel');
    const latest = new Map(segmentedCalls.slice(-3).map((call) => [call.axisLabel, call]));
    assert.equal(latest.size, 3, 'expected polarity, centrality and subjectivity bars');
    assert.equal(
        latest.get('Polarity').colors.Positif,
        'resolved:--iwac-vis-sent-pos'
    );
    assert.equal(
        latest.get('Centrality').colors['Très central'],
        'resolved:--iwac-vis-cent-1'
    );
    assert.equal(
        latest.get('Subjectivity').colors['5'],
        'resolved:--iwac-vis-subj-5'
    );
    for (const call of latest.values()) {
        assert.ok(
            Object.values(call.colors).every((value) => value.startsWith('resolved:')),
            `${call.axisLabel} contains an unresolved colour`
        );
        assert.equal(call.fallbackColor, 'resolved:--iwac-vis-sent-neutral');
    }
});
