'use strict';

const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('offline renderer matches the production ECharts version', () => {
    const assets = readFileSync(path.join(__dirname, '../../view/common/iwac-assets.phtml'), 'utf8');
    const version = require('echarts/package.json').version;
    expect(assets).toContain(`echarts@${version}/dist/echarts.min.js`);
});

for (const kind of ['timeline', 'stacked', 'growth']) {
    for (const count of [12, 45]) {
        test(`${kind} (${count} categories) restores desktop layout after mobile resize`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.setViewportSize({ width: 1000, height: 600 });
            await page.goto('/tests/browser/fixtures/chart-layout.html');
            await page.evaluate(({ kind, count }) => window.drawChart(kind, count), { kind, count });
            await expect(page.locator('#host svg path')).not.toHaveCount(0);
            const desktop = await page.evaluate(() => window.chartLayout());

            for (const width of [360, 640, 1000]) {
                await page.setViewportSize({ width, height: 600 });
                await page.evaluate(() => window.chart.resize());
                const labels = await page.locator('#host svg text').evaluateAll((nodes) => nodes
                    .filter((node) => ['Year', 'Count', 'Month', 'Monthly', 'Cumulative'].includes(node.textContent))
                    .map((node) => {
                        const r = node.getBoundingClientRect();
                        return { text: node.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
                    }));
                expect(labels.length).toBeGreaterThanOrEqual(2);
                for (const label of labels) {
                    expect(label.left, label.text).toBeGreaterThanOrEqual(-1);
                    expect(label.right, label.text).toBeLessThanOrEqual(width + 1);
                    expect(label.top, label.text).toBeGreaterThanOrEqual(-1);
                    expect(label.bottom, label.text).toBeLessThanOrEqual(401);
                }
            }
            expect(await page.evaluate(() => window.chartLayout())).toEqual(desktop);
            if (count > 20) {
                await page.evaluate(() => window.chart.dispatchAction({ type: 'dataZoom', start: 25, end: 75 }));
                await page.setViewportSize({ width: 360, height: 600 });
                await page.evaluate(() => window.chart.resize());
                await page.setViewportSize({ width: 1000, height: 600 });
                await page.evaluate(() => window.chart.resize());
                expect(await page.evaluate(() => {
                    const zoom = window.chart.getOption().dataZoom[0];
                    return [zoom.start, zoom.end];
                })).toEqual([25, 75]);
            }
            expect(errors).toEqual([]);
        });
    }
}
