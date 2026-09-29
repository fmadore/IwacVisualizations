'use strict';

/**
 * Every fixture, in both themes, has no serious or critical WCAG A/AA finding.
 *
 * IWAC-theme's live smoke suite scans the theme's chrome and deliberately
 * EXCLUDES `[class*="iwac-vis"]`, on the grounds that the module answers for
 * its own markup. Until this file, it did not: no scan ran here, and the
 * first one found a real defect — `createIwacMap` named every map host with
 * `aria-label` on a role-less <div>, which ARIA 1.2 prohibits, so the fix
 * that gave twelve maps an accessible name was one assistive technology may
 * drop. (It also found three fixtures whose dark palettes lacked
 * `--ink-subtle`, rendering the light fallback on a dark ground — a fixture
 * gap, not a product one, since the theme defines the token.)
 *
 * The fixtures are the module's real markup and CSS on stubbed data, so this
 * is the scan's natural home; the theme's live suite scans the deployed
 * blocks as well.
 */

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const WCAG_A_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const FIXTURES = [
    'associated-entities',
    'chart-layout',
    'dashboard',
    'embed-tokens',
    'horizontal-bar-renderer',
    'map-popup',
    'minimal-item',
    'table-records',
];

for (const fixture of FIXTURES) {
    for (const theme of ['light', 'dark']) {
        test(`${fixture} (${theme}) has no serious WCAG A/AA violation`, async ({ page }) => {
            await page.goto(`/tests/browser/fixtures/${fixture}.html?theme=${theme}`);
            // Panels render after the shared bundle boots; scan what a reader gets.
            await page.waitForLoadState('networkidle');
            const results = await new AxeBuilder({ page }).withTags(WCAG_A_AA).analyze();
            const blocking = results.violations
                .filter((v) => v.impact === 'serious' || v.impact === 'critical')
                .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
            expect(blocking).toEqual([]);
        });
    }
}
