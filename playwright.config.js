'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/browser',
    testMatch: '**/*.spec.js',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    timeout: 15_000,
    expect: { timeout: 5_000 },
    reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
    use: {
        baseURL: 'http://127.0.0.1:4187',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'node tests/browser/server.js',
        url: 'http://127.0.0.1:4187/tests/browser/fixtures/dashboard.html',
        reuseExistingServer: !process.env.CI,
        timeout: 10_000,
    },
});
