'use strict';
const { test, expect } = require('@playwright/test');

test('real boot helpers isolate distant instances and share their scripts', async ({ page }) => {
    const data = [];
    let orchestratorLoads = 0;
    await page.route('**/files/iwac-visualizations/**', route => {
        data.push(route.request().url());
        return route.fulfill({ json: { title: 'Loaded' } });
    });
    await page.route('**/lazy-orchestrator.js', route => {
        orchestratorLoads++;
        return route.fulfill({ contentType: 'text/javascript', body: `
            IWACVis.panels.bootBlock({selector: '.audit-block', requireECharts: false,
                dataFile: 'fixture.json', render: function(host, data) {host.textContent = data.title;}});
        ` });
    });
    const payload = JSON.stringify({ scripts: [
        '/asset/js/charts/shared/panels.js', '/asset/js/charts/shared/panels-boot.js', '/lazy-orchestrator.js'
    ] });
    await page.route('**/lazy-fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
        <script type="application/json" class="iwac-vis-lazy-manifest">${payload}</script>
        <div class="iwac-vis-block audit-block" data-generation="generations/${'a'.repeat(64)}"><div class="iwac-vis-loading">Loading</div></div>
        <div style="height:2500px"></div>
        <script type="application/json" class="iwac-vis-lazy-manifest">${payload}</script>
        <div class="iwac-vis-block audit-block"><div class="iwac-vis-loading">Loading</div></div>
        <script src="/asset/js/iwac-lazy.js" defer></script>
    ` }));
    await page.goto('/lazy-fixture');
    await expect(page.locator('.audit-block').first()).toHaveText('Loaded');
    await expect(page.locator('.audit-block').last()).toHaveText('Loading');
    expect(data).toHaveLength(1);
    expect(data[0]).toContain(`/generations/${'a'.repeat(64)}/fixture.json`);
    await page.locator('.audit-block').last().scrollIntoViewIfNeeded();
    await expect(page.locator('.audit-block').last()).toHaveText('Loaded');
    expect(data).toHaveLength(2);
    expect(orchestratorLoads).toBe(1);
});

test('a dependency outage offers a keyboard-accessible retry and recovers', async ({ page }) => {
    let failing = true;
    await page.route('**/recoverable.js', route => failing ? route.fulfill({ status: 503, body: 'Unavailable' }) : route.fulfill({
        contentType: 'text/javascript', body: `
            window.IWACVisLazy.whenVisible(document.querySelector('.iwac-vis-block'), function () {
                document.querySelector('.iwac-vis-block').textContent = 'Ready';
            });
        `
    }));
    await page.route('**/retry-fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
        <script type="application/json" class="iwac-vis-lazy-manifest">${JSON.stringify({
            scripts: ['/recoverable.js'], error: 'La visualisation n’a pas pu être chargée.', retry: 'Réessayer'
        })}</script>
        <div class="iwac-vis-block"><div class="iwac-vis-loading">Loading</div></div>
        <script src="/asset/js/iwac-lazy.js" defer></script>
    ` }));
    await page.goto('/retry-fixture');
    const retry = page.getByRole('button', { name: 'Réessayer' });
    await expect(retry).toBeVisible();
    failing = false;
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.iwac-vis-block')).toHaveText('Ready');
});
