'use strict';

const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

for (const theme of ['light', 'dark']) {
    test(`${theme} dense sentiment stacks expose their exact values without colour`, async ({ page }) => {
        await page.goto(`/tests/browser/fixtures/chart-layout.html?theme=${theme}`);
        await page.evaluate(() => window.drawChart('stacked', 12));
        const button = page.getByRole('button', { name: 'View as table', exact: true });
        await button.press('Enter');
        await expect(page.getByRole('table')).toBeVisible();
        await expect(page.getByRole('row')).toHaveCount(13);
        const columns = await page.getByRole('columnheader').allTextContents();
        const names = await page.evaluate(() => window.chart.getOption().series.map(series => series.name));
        expect(columns.slice(1)).toEqual(names);
        // Grouped with U+202F on the English site too (iwac-i18n.js).
        await expect(page.getByRole('table')).toContainText('12\u202F000');
    });

    test(`${theme} badges and slider retain contrast on the theme panel`, async ({ page }) => {
        await page.goto(`/tests/browser/fixtures/chart-layout.html?theme=${theme}`);
        await page.evaluate(() => window.themeReady);
        const ratios = await page.evaluate(() => {
            const ctx = document.createElement('canvas').getContext('2d');
            function rgba(color) {
                ctx.clearRect(0, 0, 1, 1);
                ctx.fillStyle = color;
                ctx.fillRect(0, 0, 1, 1);
                return Array.from(ctx.getImageData(0, 0, 1, 1).data);
            }
            function luminance(rgb) {
                const c = rgb.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
                return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
            }
            function contrast(a, b) {
                const x = luminance(a), y = luminance(b);
                return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
            }
            const badges = ['sim', 'shared'].map(name => {
                const style = getComputedStyle(document.querySelector('.iwac-vis-article-card__' + name));
                const bg = rgba(style.backgroundColor);
                return { alpha: bg[3], ratio: contrast(rgba(style.color), bg) };
            });
            const slider = getComputedStyle(document.querySelector('#year'));
            return { badges, track: contrast(rgba(slider.getPropertyValue('--iwac-vis-scary-track')), rgba(getComputedStyle(document.body).backgroundColor)) };
        });
        for (const badge of ratios.badges) {
            expect(badge.alpha).toBe(255);
            expect(badge.ratio).toBeGreaterThanOrEqual(4.5);
        }
        expect(ratios.track).toBeGreaterThanOrEqual(3);
    });

    test(`${theme} native chord renders named sectors and weighted ribbons on mobile`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width: 360, height: 760 });
        await page.goto(`/tests/browser/fixtures/chart-layout.html?theme=${theme}`);
        await page.evaluate(() => window.drawChart('chord', 3));
        for (const name of ['Islam', 'Education', 'Associations']) {
            await expect(page.locator('#host svg text').filter({ hasText: name })).toHaveCount(1);
        }
        const geometry = await page.evaluate(() => {
            const series = window.chart.getModel().getSeriesByIndex(0);
            return { type: series.subType, edges: series.getGraph().edges.map(edge => {
                const el = edge.getGraphicEl();
                return el && el.getBoundingRect().width;
            }) };
        });
        expect(geometry.type).toBe('chord');
        expect(geometry.edges).toHaveLength(3);
        expect(geometry.edges.every(width => width > 0)).toBe(true);
    });
}

test('value axes print the page locale’s numbers, not ECharts’ commas', async ({ page }) => {
    // ECharts groups axis ticks with a comma in every language, so the
    // French site read "6,000" — six, to a French reader — on every count
    // axis. The theme-level formatter puts them on the module's rule.
    for (const lang of ['fr', 'en']) {
        await page.goto(`/tests/browser/fixtures/chart-layout.html?lang=${lang}`);
        await page.evaluate(() => window.drawChart('timeline', 12));
        const labels = await page.evaluate(() => window.chartLayout().labels.map((label) => label.text));
        const ticks = labels.filter((text) => /^[\d\s\u202F\u00A0,.]+$/.test(text) && /\d{3}/.test(text) && !/^(19|20)\d\d$/.test(text));
        expect(ticks.length, `${lang} value-axis ticks among ${JSON.stringify(labels)}`).toBeGreaterThan(0);
        for (const tick of ticks) {
            expect(tick, `${lang} tick`).not.toContain(',');
            if (Number(tick.replace(/\D/g, '')) >= 1000) expect(tick, `${lang} tick`).toMatch(/^\d{1,3}(\u202F\d{3})+$/);
        }
    }
});

test('offline renderer matches the production ECharts version', () => {
    const assets = readFileSync(path.join(__dirname, '../../view/common/iwac-assets.phtml'), 'utf8');
    const version = require('echarts/package.json').version;
    expect(assets).toContain(`echarts@${version}/dist/echarts.min.js`);
});

test('delayed compact and theme redraws preserve zoom and legend selection', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.goto('/tests/browser/fixtures/chart-layout.html');
    await page.evaluate(() => window.drawChart('growth', 45));
    await page.evaluate(() => {
        window.chart.dispatchAction({ type: 'dataZoom', start: 25, end: 75 });
        window.chart.dispatchAction({ type: 'legendUnSelect', name: window.chart.getOption().series[0].name });
    });
    for (const width of [360, 1000]) {
        const draws = await page.evaluate(() => window.drawCount);
        await page.setViewportSize({ width, height: 600 });
        await expect.poll(() => page.evaluate(() => window.drawCount)).toBeGreaterThan(draws);
    }
    await page.evaluate(() => window.IWACVis.applyThemeToCharts());
    const state = await page.evaluate(() => {
        const option = window.chart.getOption();
        return { zoom: [option.dataZoom[0].start, option.dataZoom[0].end], selected: option.legend[0].selected[option.series[0].name] };
    });
    expect(state).toEqual({ zoom: [25, 75], selected: false });
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
            // ECharts can flush SVG text on the next animation frame after
            // resize; compare settled geometry, not an intermediate frame.
            await expect.poll(() => page.evaluate(() => window.chartLayout())).toEqual(desktop);
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

test('Gantt scrollbar stays narrow on desktop and after mobile resizing', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1800, height: 700 });
    await page.goto('/tests/browser/fixtures/chart-layout.html');
    await page.evaluate(() => window.drawChart('gantt', 30));
    for (const width of [1800, 360, 1000, 1800]) {
        await page.setViewportSize({ width, height: 700 });
        const size = await page.evaluate(() => {
            window.chart.resize();
            const model = window.chart.getModel().getComponent('dataZoom', 0);
            const view = window.chart.getViewOfComponentModel(model);
            const rect = view.group.getBoundingRect();
            return { width: rect.width, height: rect.height };
        });
        expect(size.width).toBeLessThan(100);
        expect(size.height).toBeLessThan(450);
    }
});

test('linked country indicator is absent until a filter is selected and disappears on clear', async ({ page }) => {
    await page.goto('/tests/browser/fixtures/chart-layout.html');
    await page.evaluate(() => {
        const P = window.IWACVis.panels;
        window.linkedStore = P.createStore({ country: null });
        document.body.appendChild(P.buildLinkedFilterBar({ store: window.linkedStore, labelKey: 'linked_country' }));
    });
    const indicator = page.locator('.iwac-vis-linked-filter');
    await expect(indicator).toBeHidden();
    await page.evaluate(() => window.linkedStore.patch({ country: 'Togo' }));
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText('Togo');
    await indicator.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(indicator).toBeHidden();
});

test('language type facets retain finite visible bars when their category count shrinks', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/tests/browser/fixtures/chart-layout.html');
    await page.evaluate(async () => {
        await window.themeReady;
        const P = window.IWACVis.panels;
        const panel = P.buildPanel('iwac-vis-panel', 'Languages represented');
        document.body.appendChild(panel.panel);
        window.languageHost = panel.chart;
        const global = [{ name: 'Français', count: 17000 }, { name: 'Anglais', count: 332 }];
        window.IWACVis.collectionOverview.languages.render(panel, { languages: {
            global, by_type: { article: global, publication: [{ name: 'Français', count: 1499 }, { name: 'Arabe', count: 2 }],
                document: [{ name: 'Français', count: 26 }], reference: [{ name: 'Français', count: 554 }, { name: 'Anglais', count: 318 }, { name: 'Espagnol', count: 1 }] }
        } }, {});
    });
    await page.getByText('By type', { exact: true }).click();
    for (const label of ['Islamic periodical', 'Document', 'Reference', 'News article']) {
        await page.getByText(label, { exact: true }).click();
        await expect.poll(() => page.evaluate(() => {
            const chart = window.echarts.getInstanceByDom(window.languageHost);
            const series = chart.getModel().getSeriesByIndex(0).getData();
            return Array.from({ length: series.count() }, (_, i) => {
                const layout = series.getItemLayout(i);
                return !!layout && Number.isFinite(layout.x) && Number.isFinite(layout.width) && Math.abs(layout.width) > 0;
            }).every(Boolean);
        })).toBe(true);
    }
});

for (const width of [360, 900, 1800]) {
    test(`word cloud fills its ${width}px panel without clipping terms`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height: 650 });
        await page.goto('/tests/browser/fixtures/chart-layout.html');
        await page.evaluate(() => window.drawChart('wordcloud', 150));
        const bounds = () => page.locator('#host svg text').evaluateAll(nodes => {
            const rects = nodes.map(n => n.getBoundingClientRect());
            return { count: rects.length, left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)),
                top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)) };
        });
        await expect.poll(async () => (await bounds()).count).toBeGreaterThanOrEqual(135);
        const rect = await bounds();
        // Clipping is about the letters, not their boxes. A text element's box
        // is its em box — ascent and descent padding included — and turned
        // 45° its corners reach past the ink, so a term the library placed
        // inside the panel (it lays words out by their painted pixels) still
        // had a box 5–10 px over the edge in about one load in ten. So the
        // cloud is painted again with room around it and every pixel outside
        // the panel is measured: nothing may reach more than the same 2 px
        // past the edge the box check allowed (a glyph's anti-aliased rim).
        const ink = await page.evaluate(async () => {
            const source = document.querySelector('#host svg');
            const w = source.width.baseVal.value, h = source.height.baseVal.value, m = 120;
            const svg = source.cloneNode(true);
            svg.setAttribute('width', w + 2 * m);
            svg.setAttribute('height', h + 2 * m);
            svg.setAttribute('viewBox', `${-m} ${-m} ${w + 2 * m} ${h + 2 * m}`);
            svg.setAttribute('overflow', 'visible');
            svg.querySelectorAll('rect').forEach((node) => node.remove());
            const image = new Image();
            image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = w + 2 * m;
            canvas.height = h + 2 * m;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let inside = 0, overshoot = 0;
            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    if (pixels[(y * canvas.width + x) * 4 + 3] < 64) continue;
                    const px = x - m, py = y - m;
                    const past = Math.max(-px, px - (w - 1), -py, py - (h - 1), 0);
                    if (past > 0) overshoot = Math.max(overshoot, past);
                    else inside++;
                }
            }
            return { inside, overshoot };
        });
        expect(ink.inside, 'the re-painted cloud has ink to measure').toBeGreaterThan(10000);
        expect(ink.overshoot, 'no term is painted past the panel edge').toBeLessThanOrEqual(2);
        expect(rect.right - rect.left).toBeGreaterThan(width * 0.65);
        expect(rect.bottom - rect.top).toBeGreaterThan(230);
    });
}
