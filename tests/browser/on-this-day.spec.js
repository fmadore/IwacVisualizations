'use strict';

/**
 * On This Day, as the homepage serves it: no chart library, the theme's
 * switch grammar, and a section rule rather than a panel box.
 *
 * The almanac is pure DOM, but `echarts` is the one asset need that defaults
 * ON, so the homepage — where this is the only module block — downloaded
 * ECharts (359 KB) for nothing. The template now declares it off; this
 * fixture loads exactly what that template loads and must render.
 */

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const FIXTURE = '/tests/browser/fixtures/on-this-day.html';

function contrastOf(page, selector) {
    return page.evaluate((sel) => {
        const ctx = document.createElement('canvas').getContext('2d');
        const rgba = (color) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        };
        const lum = (rgb) => {
            const c = rgb.slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
            return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        const el = document.querySelector(sel);
        // The ground the text actually sits on: every background from the
        // nearest opaque ancestor inwards, composited — a selected chip's
        // wash is translucent, and reading it alone measured the wash's hue
        // as if it were opaque.
        const layers = [];
        for (let node = el; node; node = node.parentElement) {
            const bg = getComputedStyle(node).backgroundColor;
            if (rgba(bg)[3] === 0) continue;
            layers.unshift(bg);
            if (rgba(bg)[3] === 255) break;
        }
        ctx.clearRect(0, 0, 1, 1);
        for (const layer of layers) {
            ctx.fillStyle = layer;
            ctx.fillRect(0, 0, 1, 1);
        }
        const ground = Array.from(ctx.getImageData(0, 0, 1, 1).data);
        const style = getComputedStyle(el);
        const [x, y] = [lum(rgba(style.color)), lum(ground)].sort((a, b) => b - a);
        return { ratio: (x + 0.05) / (y + 0.05), opacity: style.opacity };
    }, selector);
}

for (const theme of ['light', 'dark']) {
    test(`renders without ECharts and keeps its switch counts readable (${theme})`, async ({ page }) => {
        await page.goto(`${FIXTURE}?theme=${theme}`);
        await expect(page.locator('.iwac-vis-otd-panel')).toBeVisible();
        expect(await page.evaluate(() => typeof window.echarts)).toBe('undefined');
        await expect(page.locator('.iwac-vis-otd-register__row, .iwac-vis-otd-body > *').first()).toBeVisible();

        // V-07: the calendar counts are --muted itself, not faded ink.
        const hint = await contrastOf(page, '.iwac-vis-otd-switch__hint');
        expect(hint.opacity).toBe('1');
        expect(hint.ratio, 'switch count contrast').toBeGreaterThanOrEqual(4.5);
    });
}

test('switches are outlined chips, never pills', async ({ page }) => {
    await page.goto(FIXTURE);
    const radii = await page.locator('.iwac-vis-otd-switch .iwac-vis-facets__btn')
        .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).borderTopLeftRadius));
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) expect(parseFloat(r)).toBeLessThanOrEqual(8);

    // A layout switch still switches.
    await page.getByRole('button', { name: 'Clippings' }).click();
    await expect(page.locator('.iwac-vis-otd-body--clippings')).toHaveCount(1);
});

test('opens on the section rule, without a panel box, and puts the embed control in the footer row', async ({ page }) => {
    await page.goto(FIXTURE);
    await expect(page.locator('.iwac-vis-otd-panel')).toBeVisible();
    const box = await page.evaluate(() => {
        const panel = document.querySelector('.iwac-vis-otd-panel');
        const style = getComputedStyle(panel);
        const rule = panel.querySelector(':scope > h2');
        return {
            border: style.borderTopWidth,
            shadow: style.boxShadow,
            rule: getComputedStyle(rule).borderTopWidth,
        };
    });
    expect(box.border).toBe('0px');
    expect(box.shadow).toBe('none');
    expect(box.rule).toBe('2px');

    // No floating panel toolbar: the copy-embed control sits in the footer
    // row, beside the see-all toggle, not on the rule or on a line of its own.
    await expect(page.locator('.iwac-vis-otd-panel > .iwac-vis-panel-toolbar')).toHaveCount(0);
    const actions = page.locator('.iwac-vis-otd-foot__actions');
    await expect(actions.locator('.iwac-vis-otd-foot__toggle')).toHaveCount(1);
    await expect(actions.locator('.iwac-vis-embed-btn')).toHaveCount(1);
    const rows = await page.evaluate(() => {
        const a = document.querySelector('.iwac-vis-otd-foot__toggle').getBoundingClientRect();
        const b = document.querySelector('.iwac-vis-otd-foot__actions .iwac-vis-embed-btn').getBoundingClientRect();
        return { a: a.top + a.height / 2, b: b.top + b.height / 2 };
    });
    expect(Math.abs(rows.a - rows.b)).toBeLessThanOrEqual(2);
});

test('the French page loads the French bundle and its switches', async ({ page }) => {
    await page.goto(`${FIXTURE}?lang=fr`);
    await expect(page.getByRole('button', { name: 'Coupures' })).toBeVisible();
    await expect(page.locator('.iwac-vis-otd-panel > h2')).toContainText('Ce jour-là');
    expect(await page.evaluate(() => typeof window.echarts)).toBe('undefined');
});

/* ------------------------------------------------------------------- */
/*  The Edition layout                                                  */
/* ------------------------------------------------------------------- */

// The fixture's Gregorian day: rows(24, 0), one item a year.
const FIXTURE_YEARS = Array.from({ length: 24 }, (_, i) => 1965 + ((i * 7) % 60)).sort((a, b) => a - b);
// Fixed, so "years ago" — and with it the anniversary rule — cannot drift.
const NOW = new Date('2026-11-15T10:00:00');
const EDITION = `${FIXTURE}?otd.layout=edition`;
// A 1×1 PNG behind every scan the `thumbs=1` fixture asks for.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function openEdition(page, query = '') {
    await page.clock.setFixedTime(NOW);
    await page.route('**/files/large/*.jpg', (route) => route.fulfill({ contentType: 'image/png', body: PIXEL }));
    await page.goto(EDITION + query);
    await expect(page.locator('.iwac-vis-otd-edition')).toBeVisible();
}

const leadYear = (page) => page.locator('.iwac-vis-otd-lead:not(.is-leaving)').getAttribute('data-year');

test.describe('Edition', () => {
    test('is a fourth layout in the switch, and the spine has one control per year with an item', async ({ page }) => {
        await openEdition(page);
        await expect(page.getByRole('button', { name: 'Edition', exact: true })).toHaveAttribute('aria-pressed', 'true');
        const spine = page.getByRole('toolbar', { name: /^Years with items on / });
        const years = await spine.locator('.iwac-vis-otd-tick')
            .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute('data-year'))));
        expect(years).toEqual(FIXTURE_YEARS);
        await expect(spine.getByRole('button', { name: '1986, 1 item' })).toHaveCount(1);
        // The scale sentence carries the day's span.
        await expect(page.locator('.iwac-vis-otd-folio__scale')).toHaveText('24 items on this date, from 1965 to 2024.');
    });

    test('leads on the rarest round anniversary, and a tick makes its year the lead', async ({ page }) => {
        await openEdition(page);
        // 1986 is 40 years before NOW; 1996 (30) and 2006 (20) are round too,
        // but a larger anniversary is rarer and wins. Not the oldest (1965).
        expect(await leadYear(page)).toBe('1986');
        await expect(page.locator('.iwac-vis-otd-tick[data-year="1986"]')).toHaveAttribute('aria-pressed', 'true');

        await page.locator('.iwac-vis-otd-tick[data-year="2010"]').click();
        await expect.poll(() => leadYear(page)).toBe('2010');
        await expect(page.locator('.iwac-vis-otd-tick[data-year="2010"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.iwac-vis-otd-tick[data-year="1986"]')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.iwac-vis-otd-lead')).toHaveCount(1);
        expect(new URL(page.url()).searchParams.get('otd.year')).toBe('2010');
        // The new lead is not repeated among the briefs.
        await expect(page.locator('.iwac-vis-otd-brief .iwac-vis-otd-brief__year', { hasText: /^2010$/ })).toHaveCount(0);
    });

    test('the spine is one tab stop, walked with the arrow keys', async ({ page }) => {
        await openEdition(page);
        const ticks = page.locator('.iwac-vis-otd-tick');
        await expect(ticks.and(page.locator('[tabindex="0"]'))).toHaveCount(1);
        await page.locator('.iwac-vis-otd-tick[data-year="1986"]').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.iwac-vis-otd-tick[data-year="1989"]')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect.poll(() => leadYear(page)).toBe('1989');
        await page.keyboard.press('End');
        await expect(page.locator('.iwac-vis-otd-tick[data-year="2024"]')).toBeFocused();
        await page.keyboard.press('Home');
        await expect(page.locator('.iwac-vis-otd-tick[data-year="1965"]')).toBeFocused();
        // A visible focus indicator.
        const outline = await page.locator('.iwac-vis-otd-tick[data-year="1965"]')
            .evaluate((n) => getComputedStyle(n).outlineStyle);
        expect(outline).not.toBe('none');
    });

    test('under reduced motion it draws complete and swaps the lead without a fade', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openEdition(page);
        await expect(page.locator('.iwac-vis-otd-edition.is-drawing')).toHaveCount(0);
        const anim = await page.locator('.iwac-vis-otd-spine__axis').evaluate((n) => getComputedStyle(n).animationName);
        expect(anim).toBe('none');
        await page.locator('.iwac-vis-otd-tick[data-year="1972"]').click();
        await expect(page.locator('.iwac-vis-otd-lead')).toHaveCount(1);
        expect(await leadYear(page)).toBe('1972');
    });

    test('draws in once on first view, with motion allowed', async ({ page }) => {
        await openEdition(page);
        await expect(page.locator('.iwac-vis-otd-edition.is-drawing')).toHaveCount(1);
        await expect(page.locator('.iwac-vis-otd-edition.is-drawing')).toHaveCount(0, { timeout: 3000 });
    });

    test('never draws a placeholder box: an unscanned lead is set in type, a scanned one at size', async ({ page }) => {
        await openEdition(page);
        await expect(page.locator('.iwac-vis-otd-plate--empty')).toHaveCount(0);
        await expect(page.locator('.iwac-vis-otd-lead--type')).toHaveCount(1);
        await expect(page.locator('.iwac-vis-otd-lead img')).toHaveCount(0);

        await openEdition(page, '&thumbs=1');
        await expect(page.locator('.iwac-vis-otd-plate--empty')).toHaveCount(0);
        // With scans on offer the anniversary still leads only if it has one;
        // 1986 is row 3 — scanned — so it leads with its clipping.
        expect(await leadYear(page)).toBe('1986');
        const img = page.locator('.iwac-vis-otd-lead__scan');
        await expect(img).toHaveAttribute('src', /\/files\/large\/0+1003\.jpg$/);
        await expect(img).toHaveAttribute('loading', 'lazy');
        expect(await img.evaluate((n) => getComputedStyle(n).objectPosition)).toBe('50% 0%');
        // No scans in the briefs: they are type.
        await expect(page.locator('.iwac-vis-otd-briefs img')).toHaveCount(0);
    });

    test('a phone gets no horizontal page scroll and 24 px spine targets', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openEdition(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        const boxes = await page.locator('.iwac-vis-otd-tick').evaluateAll((nodes) =>
            nodes.map((n) => n.getBoundingClientRect()).map((r) => ({ x: r.left + r.width / 2, w: r.width, h: r.height })));
        for (const b of boxes) {
            expect(b.w).toBeGreaterThanOrEqual(24);
            expect(b.h).toBeGreaterThanOrEqual(24);
        }
        const xs = boxes.map((b) => b.x).sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(24);
        // The lead's year is scrolled into the spine's view.
        const lead = await page.locator('.iwac-vis-otd-tick.is-lead').boundingBox();
        expect(lead.x).toBeGreaterThanOrEqual(0);
        expect(lead.x + lead.width).toBeLessThanOrEqual(390);
    });

    test('the chosen day and year round-trip through the URL, and Today returns', async ({ page }) => {
        await openEdition(page, '&otd.day=03-07&otd.year=1993');
        await expect(page.locator('.iwac-vis-otd-panel > h2')).toContainText('7 March');
        expect(await leadYear(page)).toBe('1993');
        expect(await page.evaluate(() => window.__fetched.some((u) => u.endsWith('/on-this-day/03-07.json')))).toBe(true);

        await page.getByRole('button', { name: 'Next day, 8 March' }).click();
        await expect(page.locator('.iwac-vis-otd-panel > h2')).toContainText('8 March');
        let params = new URL(page.url()).searchParams;
        expect(params.get('otd.day')).toBe('03-08');
        expect(params.get('otd.year')).toBeNull();
        await expect(page.getByRole('button', { name: 'Next day, 9 March' })).toBeFocused();

        // The picker: month, then day.
        await page.locator('.iwac-vis-otd-daynav__month').selectOption('2');
        await expect(page.locator('.iwac-vis-otd-panel > h2')).toContainText('8 February');
        await page.getByLabel('Choose a date').selectOption('29');
        await expect(page.locator('.iwac-vis-otd-panel > h2')).toContainText('29 February');
        expect(new URL(page.url()).searchParams.get('otd.day')).toBe('02-29');

        await page.getByRole('button', { name: 'Today', exact: true }).click();
        await expect(page.locator('.iwac-vis-otd-panel > h2')).toContainText('15 November');
        params = new URL(page.url()).searchParams;
        expect(params.get('otd.day')).toBeNull();
        await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute('aria-disabled', 'true');
    });

    test('its embed snippet carries the layout', async ({ page }) => {
        await openEdition(page);
        await page.evaluate(() => {
            window.IWACVis.embed.copyToClipboard = (text) => { window.__snippet = text; return Promise.resolve(); };
        });
        await page.locator('.iwac-vis-otd-foot__actions .iwac-vis-embed-btn').click();
        await expect.poll(() => page.evaluate(() => window.__snippet || '')).toContain('otd.layout=edition');
    });

    test('French: switch, scale sentence and day names', async ({ page }) => {
        await openEdition(page, '&lang=fr');
        await expect(page.getByRole('button', { name: 'Édition', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.iwac-vis-otd-folio__scale')).toHaveText('24 documents à cette date, de 1965 à 2024.');
        await expect(page.getByRole('button', { name: 'Jour suivant, 16 novembre' })).toBeVisible();
        await expect(page.getByRole('toolbar', { name: 'Années comptant des documents le 15 novembre' })).toBeVisible();
    });

    for (const theme of ['light', 'dark']) {
        test(`passes axe (${theme})`, async ({ page }) => {
            await openEdition(page, `&theme=${theme}&thumbs=1`);
            await expect(page.locator('.iwac-vis-otd-edition.is-drawing')).toHaveCount(0, { timeout: 3000 });
            const results = await new AxeBuilder({ page })
                .include('.iwac-vis-on-this-day')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
                .analyze();
            expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
        });
    }
});
