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
    // CI also writes the JSON report scripts/check-flakes.js reads: with
    // `retries: 2` a test that passes on its second try is recorded as
    // `flaky`, and that guard turns it into a red run with the test's name.
    reporter: process.env.CI
        ? [['line'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/report.json' }]]
        : 'line',
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
