'use strict';

/**
 * The layout system's horizontal-bar renderer.
 *
 * It bridges two different conventions: `ns.toEntries` and the generators
 * that feed layout slots emit `{name, value}`, while `C.horizontalBar`
 * defaults its `valueKey` to `count` because its direct callers hand it
 * `{name, count}`. Crossing those wires resolves every datum to
 * `undefined`, which errors nowhere — the category axis still draws its
 * labels, the value axis simply has no range, and the panel renders a full
 * set of country names with no bars beside them. Topic Explorer's "Top
 * countries" and "Top newspapers" shipped that way.
 *
 * These assertions read the option the renderer hands the chart rather than
 * the pixels, so the suite needs neither ECharts nor a CDN.
 */

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/horizontal-bar-renderer.html';

test('generator entries resolve to real bar values', async ({ page }) => {
    await page.goto(FIXTURE);

    const built = await page.evaluate(() =>
        window.optionFromRenderer(window.TOPIC_COUNTRIES, { maxBars: 12 }));

    expect(built.categories).toEqual([
        'Togo', "Cote d'Ivoire", 'Burkina Faso', 'Benin', 'Niger',
    ]);
    expect(built.values).toEqual([412, 388, 201, 96, 41]);
    expect(built.values.some((v) => v == null)).toBe(false);
    expect(built.warnings).toEqual([]);
});

test('a keyed map is normalised the same way', async ({ page }) => {
    await page.goto(FIXTURE);

    // ns.toEntries turns {key: count} into {name, value} — the same shape,
    // reached by the other documented route into this renderer.
    const built = await page.evaluate(() =>
        window.optionFromRenderer({ Togo: 412, Niger: 41 }, {}));

    expect(built.categories).toEqual(['Togo', 'Niger']);
    expect(built.values).toEqual([412, 41]);
});

test('a key mismatch says so instead of drawing a blank chart', async ({ page }) => {
    await page.goto(FIXTURE);

    // The failure mode is silent by construction, so the renderer is
    // required to be the thing that speaks.
    const built = await page.evaluate(() =>
        window.optionFromRenderer(
            [{ name: 'Togo', total: 412 }, { name: 'Niger', total: 41 }], {}));

    expect(built.values).toEqual([undefined, undefined]);
    expect(built.warnings.join(' ')).toContain('no entry carries "value"');
    expect(built.warnings.join(' ')).toContain('total');

    // ...and a slot that says which key it uses gets its bars.
    const fixed = await page.evaluate(() =>
        window.optionFromRenderer(
            [{ name: 'Togo', total: 412 }, { name: 'Niger', total: 41 }],
            { valueKey: 'total' }));
    expect(fixed.values).toEqual([412, 41]);
    expect(fixed.warnings).toEqual([]);
});

test('maxBars is honoured by the renderer, not the builder', async ({ page }) => {
    await page.goto(FIXTURE);

    // C.horizontalBar has no opinion on a top-N cap; before the renderer
    // took it on, `maxBars: 12` in a slot did nothing at all.
    const built = await page.evaluate(() =>
        window.optionFromRenderer(window.TOPIC_COUNTRIES, { maxBars: 3 }));

    expect(built.categories).toEqual(['Togo', "Cote d'Ivoire", 'Burkina Faso']);
    expect(built.values).toEqual([412, 388, 201]);
});

test('countries carry their fixed palette slots, newspapers do not', async ({ page }) => {
    await page.goto(FIXTURE);

    const countries = await page.evaluate(() =>
        window.optionFromRenderer(window.TOPIC_COUNTRIES, { useCountryColors: true }));
    const plain = await page.evaluate(() =>
        window.optionFromRenderer(window.TOPIC_COUNTRIES, {}));

    // One series means ECharts paints every bar in slot 0 unless told
    // otherwise, which is why a country ranking has to opt in.
    expect(new Set(countries.colors.filter(Boolean)).size).toBe(5);
    expect(plain.colors.every((c) => c === null)).toBe(true);
});
