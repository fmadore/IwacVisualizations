'use strict';

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/dashboard.html';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        window.__iwacCopiedText = '';
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText(text) {
                    window.__iwacCopiedText = text;
                    return Promise.resolve();
                },
            },
        });
    });
});

test('enumerates panels and produces the shared embed snippet', async ({ page }) => {
    await page.goto(FIXTURE);
    const panels = page.locator('.iwac-vis-panel');
    await expect(panels).toHaveCount(3);
    await expect.poll(() => page.locator('.iwac-vis-embed-btn').count()).toBe(3);
    await expect(panels.nth(0)).toHaveAttribute('data-iwac-panel', 'panel-0');
    await expect(panels.nth(2)).toHaveAttribute('data-iwac-panel', 'panel-2');

    const button = panels.nth(1).getByRole('button', { name: 'Copy embed code' });
    await button.click();
    await expect(button).toHaveClass(/iwac-vis-embed-btn--copied/);
    const copied = await page.evaluate(() => window.__iwacCopiedText);
    expect(copied).toContain('/s/iwac/iwac-embed/collection-overview/panel-1');
    expect(copied).toContain('title="Geographic coverage"');
    expect(copied).toContain("type!=='iwac-embed-height'");
});

test('localizes embed controls in French', async ({ page }) => {
    await page.goto(`${FIXTURE}?lang=fr-FR`);
    const buttons = page.getByRole('button', { name: 'Copier le code d’intégration' });
    await expect(buttons).toHaveCount(3);
    await buttons.first().click();
    await expect(buttons.first().locator('span').last()).toHaveText('✓');
});

test('keeps dark mobile layouts inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.goto(`${FIXTURE}?theme=dark`);
    await expect.poll(() => page.locator('.iwac-vis-embed-btn').count()).toBe(3);

    const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        panelBackground: getComputedStyle(document.querySelector('.iwac-vis-panel')).backgroundColor,
        panels: Array.from(document.querySelectorAll('.iwac-vis-panel')).map((panel) => {
            const rect = panel.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width };
        }),
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(layout.panelBackground).toBe('rgb(26, 29, 33)');
    for (const panel of layout.panels) {
        expect(panel.left).toBeGreaterThanOrEqual(0);
        expect(panel.right).toBeLessThanOrEqual(layout.viewport);
        expect(panel.width).toBeGreaterThan(250);
    }
});

test('single-panel embeds hide siblings and suppress nested embed controls', async ({ page }) => {
    await page.goto(`${FIXTURE}?embed=panel-1`);
    const target = page.locator('[data-iwac-panel="panel-1"]');
    await expect(target).toHaveAttribute('data-iwac-panel-active', '1');
    await expect(page.locator('.iwac-vis-panel:visible')).toHaveCount(1);
    await expect(page.locator('.iwac-vis-embed-btn')).toHaveCount(0);
    await expect(target).toContainText('Geographic coverage');
});
