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

test('the calendar switch is outlined chips, never pills, and the only switch in the masthead', async ({ page }) => {
    await page.goto(FIXTURE);
    const radii = await page.locator('.iwac-vis-otd-switch .iwac-vis-facets__btn')
        .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).borderTopLeftRadius));
    expect(radii.length).toBe(2);
    for (const r of radii) expect(parseFloat(r)).toBeLessThanOrEqual(8);
    await expect(page.locator('.iwac-vis-otd-head button')).toHaveCount(2);
});

test('the layout switch is a labelled select in the footer row, and it remembers', async ({ page }) => {
    await page.goto(FIXTURE);
    const layout = page.getByLabel('Layout');
    await expect(page.locator('.iwac-vis-otd-foot__actions').getByLabel('Layout')).toHaveCount(1);
    await expect(layout).toHaveValue('register');
    await layout.focus();
    await layout.selectOption('clippings');
    await expect(page.locator('.iwac-vis-otd-body--clippings')).toHaveCount(1);
    // Rebuilt with the body, and focus came back to it.
    await expect(page.getByLabel('Layout')).toBeFocused();
    expect(new URL(page.url()).searchParams.get('otd.layout')).toBe('clippings');
    expect(await page.evaluate(() => localStorage.getItem('iwac-vis-otd-layout'))).toBe('clippings');
    // Toggle and select share one row.
    const rows = await page.evaluate(() => {
        const a = document.querySelector('.iwac-vis-otd-foot__select').getBoundingClientRect();
        const b = document.querySelector('.iwac-vis-otd-foot__actions .iwac-vis-embed-btn').getBoundingClientRect();
        return { a: a.top + a.height / 2, b: b.top + b.height / 2 };
    });
    expect(Math.abs(rows.a - rows.b)).toBeLessThanOrEqual(2);
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
    await expect(page.getByLabel('Présentation').locator('option', { hasText: 'Coupures' })).toHaveCount(1);
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
        await expect(page.getByLabel('Layout')).toHaveValue('edition');
        const spine = page.getByRole('toolbar', { name: /^Years with items on / });
        const years = await spine.locator('.iwac-vis-otd-tick')
            .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute('data-year'))));
        expect(years).toEqual(FIXTURE_YEARS);
        await expect(spine.getByRole('button', { name: '1986, 1 item' })).toHaveCount(1);
        // The scale sentence carries the day's span and its geography.
        await expect(page.locator('.iwac-vis-otd-folio__scale')).toHaveText('24 items from 5 countries and 3 newspapers, 1965–2024.');
    });

    test('among equally furnished items the rarest round anniversary leads, and a tick makes its year the lead', async ({ page }) => {
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
        // The lead is an item now: `otd.item` carries its o_id (row 15).
        expect(new URL(page.url()).searchParams.get('otd.item')).toBe('5015');
        expect(new URL(page.url()).searchParams.get('otd.year')).toBeNull();
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
        // With scans on offer a scanned item always leads; 1986 is row 3 —
        // scanned, and the rarest anniversary among the scanned — so it
        // leads with its clipping.
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
        // An old `otd.year` link is rewritten to the item it resolved to.
        await expect.poll(() => new URL(page.url()).searchParams.get('otd.year')).toBeNull();
        expect(new URL(page.url()).searchParams.get('otd.item')).toBe(
            await page.locator('.iwac-vis-otd-lead:not(.is-leaving)').getAttribute('data-o-id'));
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
        await expect(page.getByLabel('Présentation')).toHaveValue('edition');
        await expect(page.locator('.iwac-vis-otd-folio__scale')).toHaveText('24 documents de 5 pays et 3 titres, de 1965 à 2024.');
        await expect(page.getByRole('button', { name: 'Jour suivant, 16 novembre' })).toBeVisible();
        await expect(page.getByRole('toolbar', { name: 'Années comptant des documents le 15 novembre' })).toBeVisible();
    });

    for (const theme of ['light', 'dark']) {
        test(`passes axe (${theme})`, async ({ page }) => {
            await openEdition(page, `&theme=${theme}&thumbs=1&multi=1`);
            await expect(page.locator('.iwac-vis-otd-edition.is-drawing')).toHaveCount(0, { timeout: 3000 });
            const results = await new AxeBuilder({ page })
                .include('.iwac-vis-on-this-day')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
                .analyze();
            expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
        });
    }
});

/* ------------------------------------------------------------------- */
/*  On This Day v2, phase 1                                             */
/* ------------------------------------------------------------------- */

test.describe('Edition v2', () => {
    test('the date selects are one line with one arrow, even without the theme', async ({ page }) => {
        // The fixture loads no theme CSS — the case where the native arrow
        // used to come back beside (and wrap under) the value.
        await openEdition(page);
        for (const sel of ['.iwac-vis-otd-daynav__day', '.iwac-vis-otd-daynav__month', '.iwac-vis-otd-foot__select']) {
            const s = await page.locator(sel).evaluate((n) => {
                const cs = getComputedStyle(n);
                return {
                    appearance: cs.appearance,
                    image: cs.backgroundImage,
                    wrap: cs.whiteSpace,
                    height: n.getBoundingClientRect().height,
                    arrows: n.parentElement.querySelectorAll(':scope > svg').length,
                };
            });
            expect(s.appearance, sel).toBe('none');
            expect(s.image, sel).toBe('none');
            expect(s.wrap, sel).toBe('nowrap');
            expect(s.arrows, sel).toBe(1);
            expect(s.height, sel).toBeLessThanOrEqual(37);
        }
        // Compact: the day select is sized by "30", not by a 72 px floor.
        const w = await page.locator('.iwac-vis-otd-daynav__day').evaluate((n) => n.getBoundingClientRect().width);
        expect(w).toBeLessThan(64);
    });

    test('the folio bar: previous, picker, next, Today, Random date — the label is not drawn', async ({ page }) => {
        await openEdition(page);
        const order = await page.locator('.iwac-vis-otd-daynav > *').evaluateAll((nodes) =>
            nodes.map((n) => n.getAttribute('data-iwac-control') || n.className));
        expect(order).toEqual(['otd-prev', 'iwac-vis-otd-daynav__pick', 'otd-next', 'otd-today', 'otd-random']);
        const label = await page.locator('.iwac-vis-otd-daynav__label').boundingBox();
        expect(label.width).toBeLessThanOrEqual(1);
    });

    test('Random date lands on one of the rich days, or on any other day without metadata', async ({ page }) => {
        await openEdition(page);
        await page.getByRole('button', { name: 'Random date' }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get('otd.day')).not.toBeNull();
        expect(['03-07', '07-04']).toContain(new URL(page.url()).searchParams.get('otd.day'));
        await expect(page.getByRole('button', { name: 'Random date' })).toBeFocused();
        expect((await page.evaluate(() => window.__fetched)).filter((u) => u.includes('metadata.json')).length).toBe(1);

        await openEdition(page, '&nometa=1');
        await page.getByRole('button', { name: 'Random date' }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get('otd.day')).toMatch(/^\d\d-\d\d$/);
        expect(new URL(page.url()).searchParams.get('otd.day')).not.toBe('11-15');
    });

    test('in Hijri the picker lists Hijri months and days, and the feast shortcuts navigate', async ({ page }) => {
        await openEdition(page);
        await page.locator('.iwac-vis-otd-switch .iwac-vis-facets__btn').nth(1).click();
        // 15 November 2026 is 5 Jumada II 1448.
        const month = page.locator('.iwac-vis-otd-daynav__month');
        await expect(month).toHaveValue('6');
        await expect(month.locator('option:checked')).toHaveText('Jumada II');
        await expect(month.locator('option')).toHaveCount(12);
        await expect(page.locator('.iwac-vis-otd-daynav__day')).toHaveValue('5');
        await expect(page.locator('.iwac-vis-otd-daynav__day option')).toHaveCount(30);

        // 1 Ramadan: 1448 begins in 2027, so the most recent, 18 February 2026.
        await month.selectOption('9');
        await page.locator('.iwac-vis-otd-daynav__day').selectOption('1');
        await expect.poll(() => new URL(page.url()).searchParams.get('otd.day')).toBe('02-18');
        await expect(page.locator('.iwac-vis-otd-daynav__month')).toHaveValue('9');
        await expect(page.locator('.iwac-vis-otd-feast[aria-current="date"]')).toHaveText('Ramadan');

        await page.getByRole('button', { name: 'Eid al-Fitr (Korité)' }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get('otd.day')).toBe('03-20');
        await expect(page.getByRole('button', { name: 'Eid al-Fitr (Korité)' })).toHaveAttribute('aria-current', 'date');
        await expect(page.locator('.iwac-vis-otd-feast[aria-current]')).toHaveCount(1);
        // Gregorian mode has no shortcuts.
        await page.locator('.iwac-vis-otd-switch .iwac-vis-facets__btn').nth(0).click();
        await expect(page.locator('.iwac-vis-otd-feasts')).toHaveCount(0);
    });

    test('the lead’s round anniversary is worded as one and set apart', async ({ page }) => {
        await openEdition(page);
        const ago = page.locator('.iwac-vis-otd-lead:not(.is-leaving) .iwac-vis-otd-lead__ago');
        await expect(ago).toHaveText('Exactly 40 years ago');
        await expect(ago).toHaveClass(/iwac-vis-otd-lead__ago--exact/);
        await page.locator('.iwac-vis-otd-tick[data-year="1989"]').click();
        await expect(page.locator('.iwac-vis-otd-lead:not(.is-leaving) .iwac-vis-otd-lead__ago')).toHaveText('37 years ago');
    });

    test('dots are coloured by type and stacked by type; the legend names only the types present', async ({ page }) => {
        await openEdition(page);
        const legend = page.locator('.iwac-vis-otd-spine__key');
        await expect(legend).toHaveText(['Article', 'Periodical', 'Audiovisual', 'Document', 'Image']);
        const colours = await page.locator('.iwac-vis-otd-spine__legend .iwac-vis-otd-tick__dot')
            .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).backgroundColor));
        expect(new Set(colours).size).toBe(5);

        await openEdition(page, '&old=1');
        await expect(page.locator('.iwac-vis-otd-spine__key')).toHaveText(['Article', 'Periodical']);
        // An old file keeps the old folio sentence.
        await expect(page.locator('.iwac-vis-otd-folio__scale')).toHaveText('24 items on this date, from 1965 to 2024.');
    });

    test('a year’s tooltip on keyboard focus: count, sources, countries, best title; Escape dismisses', async ({ page }) => {
        await openEdition(page);
        await page.locator('.iwac-vis-otd-tick[data-year="1986"]').focus();
        await page.keyboard.press('ArrowRight');
        const tip = page.locator('.iwac-vis-otd-tip');
        await expect(tip).toBeVisible();
        await expect(tip).toContainText('1989 · 1 item');
        await expect(tip).toContainText('Article du 1989 sur la vie associative');
        await expect(tip).toHaveAttribute('aria-hidden', 'true');
        // The tick's description says the same, once, for a screen reader.
        const desc = await page.locator('.iwac-vis-otd-tick[data-year="1989"]').evaluate((n) =>
            document.getElementById(n.getAttribute('aria-describedby')).textContent);
        expect(desc).toMatch(/Sidwaya|Fraternité Matin|L’Observateur Paalga/);
        expect(desc).toMatch(/Burkina Faso|Côte d’Ivoire|Benin|Niger|Togo/);
        // Not inside the scroller, so nothing clips it.
        expect(await tip.evaluate((n) => !!n.closest('.iwac-vis-otd-spine__scroller'))).toBe(false);
        await page.keyboard.press('Escape');
        await expect(tip).toBeHidden();
    });

    test('a tap chooses a year without opening its tooltip', async ({ browser }) => {
        const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        await openEdition(page);
        await page.locator('.iwac-vis-otd-tick[data-year="2010"]').tap();
        await expect.poll(() => leadYear(page)).toBe('2010');
        await expect(page.locator('.iwac-vis-otd-tip')).toBeHidden();
        await context.close();
    });

    for (const hidden of [false, true]) {
        test(`a phone opens the spine on its lead${hidden ? ', even when rendered without a width' : ''}`, async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            if (hidden) {
                await page.clock.setFixedTime(NOW);
                await page.goto(EDITION + '&hidden=1');
                await expect(page.locator('.iwac-vis-otd-edition')).toHaveCount(1);
                await page.waitForTimeout(300);
                await page.evaluate(() => { document.querySelector('main').style.display = ''; });
            } else {
                await openEdition(page);
            }
            await expect(page.locator('.iwac-vis-otd-spine--scrolls')).toHaveCount(1);
            const scrollY = await page.evaluate(() => window.scrollY);
            await expect.poll(() => page.evaluate(() => {
                const s = document.querySelector('.iwac-vis-otd-spine__scroller').getBoundingClientRect();
                const t = document.querySelector('.iwac-vis-otd-tick.is-lead').getBoundingClientRect();
                const centre = t.left + t.width / 2;
                return centre > s.left + 28 && centre < s.right - 28;
            })).toBe(true);
            // Centred, near enough.
            const off = await page.evaluate(() => {
                const s = document.querySelector('.iwac-vis-otd-spine__scroller').getBoundingClientRect();
                const t = document.querySelector('.iwac-vis-otd-tick.is-lead').getBoundingClientRect();
                return Math.abs((t.left + t.width / 2) - (s.left + s.width / 2));
            });
            expect(off).toBeLessThanOrEqual(30);
            // The spine scrolled; the page did not.
            expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
        });
    }
});

/* ------------------------------------------------------------------- */
/*  On This Day v2, phase 2: the lead is an item                        */
/* ------------------------------------------------------------------- */

const lead = (page) => page.locator('.iwac-vis-otd-lead:not(.is-leaving)');
const leadItem = (page) => lead(page).getAttribute('data-o-id');

test.describe('Edition v2, the lead', () => {
    test('a year with several items gets a pager that cycles them in rank order and keeps focus', async ({ page }) => {
        await openEdition(page, '&multi=1');
        await expect(page.locator('.iwac-vis-otd-pager__count')).toHaveText('1 / 4 in 1986');
        expect(await leadItem(page)).toBe('5003');
        const sizes = await page.locator('.iwac-vis-otd-pager__btn').evaluateAll((n) => n.map((b) => b.getBoundingClientRect()));
        for (const r of sizes) {
            expect(r.width).toBeGreaterThanOrEqual(24);
            expect(r.height).toBeGreaterThanOrEqual(24);
        }

        await page.getByRole('button', { name: 'Next item from 1986' }).focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => leadItem(page)).toBe('7001');
        await expect(lead(page).locator('.iwac-vis-otd-pager__count')).toHaveText('2 / 4 in 1986');
        // Focus followed the button into the rebuilt lead.
        await expect(lead(page).getByRole('button', { name: 'Next item from 1986' })).toBeFocused();
        expect(new URL(page.url()).searchParams.get('otd.item')).toBe('7001');

        await page.keyboard.press('Enter');
        await expect.poll(() => leadItem(page)).toBe('7003');
        await page.keyboard.press('Enter');
        await expect.poll(() => leadItem(page)).toBe('7002');
        await page.keyboard.press('Enter');
        await expect.poll(() => leadItem(page)).toBe('5003');
        // Back on the default lead: the address forgets it.
        await expect.poll(() => new URL(page.url()).searchParams.get('otd.item')).toBeNull();
        await lead(page).getByRole('button', { name: 'Previous item from 1986' }).click();
        await expect.poll(() => leadItem(page)).toBe('7002');
        // The spine still marks the lead's year.
        await expect(page.locator('.iwac-vis-otd-tick[data-year="1986"]')).toHaveAttribute('aria-pressed', 'true');
        // A year with one item has no pager.
        await page.locator('.iwac-vis-otd-tick[data-year="2010"]').click();
        await expect.poll(() => leadYear(page)).toBe('2010');
        await expect(lead(page).locator('.iwac-vis-otd-pager')).toHaveCount(0);
    });

    test('otd.item opens on that item; one the day does not hold falls back', async ({ page }) => {
        await openEdition(page, '&multi=1&otd.item=7003');
        expect(await leadItem(page)).toBe('7003');
        await expect(page.locator('.iwac-vis-otd-pager__count')).toHaveText('3 / 4 in 1986');
        await openEdition(page, '&otd.item=123456');
        expect(await leadItem(page)).toBe('5003');
        await expect.poll(() => new URL(page.url()).searchParams.get('otd.item')).toBeNull();
    });

    test('"Show as lead" promotes a brief, moves focus to its headline, and the seventh brief fills in', async ({ page }) => {
        await openEdition(page);
        const briefs = page.locator('.iwac-vis-otd-brief');
        await expect(briefs).toHaveCount(6);
        const first = briefs.first();
        const id = await first.getAttribute('data-o-id');
        const title = (await first.locator('.iwac-vis-otd-brief__title').textContent()).trim();
        await first.getByRole('button', { name: 'Show as lead: ' + title }).click();
        await expect.poll(() => leadItem(page)).toBe(id);
        await expect(lead(page).locator('.iwac-vis-otd-lead__title a')).toBeFocused();
        expect(new URL(page.url()).searchParams.get('otd.item')).toBe(id);
        await expect(briefs).toHaveCount(6);
        await expect(page.locator(`.iwac-vis-otd-brief[data-o-id="${id}"]`)).toHaveCount(0);

        // From the foot of the page, the lead is off screen: it is brought into view.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const last = briefs.last();
        const id2 = await last.getAttribute('data-o-id');
        await last.locator('.iwac-vis-otd-brief__promote').click();
        await expect.poll(() => leadItem(page)).toBe(id2);
        await expect.poll(() => page.evaluate(() => {
            const r = document.querySelector('.iwac-vis-otd-lead:not(.is-leaving) .iwac-vis-otd-lead__title').getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight;
        })).toBe(true);
        await expect(lead(page).locator('.iwac-vis-otd-lead__title a')).toBeFocused();
    });

    test('promoting a brief whose lead is on screen does not move the page', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 2400 });
        await openEdition(page);
        await page.locator('.iwac-vis-otd-brief__promote').first().click();
        await expect(lead(page).locator('.iwac-vis-otd-lead__title a')).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test('the AI label is there exactly when a summary is shown', async ({ page }) => {
        // English: the lead shows its English summary, marked.
        await openEdition(page, '&multi=1');
        await expect(lead(page).locator('.iwac-vis-otd-lead__lede')).toHaveText('Summary 1986.');
        await expect(lead(page).locator('.iwac-vis-otd-ai')).toHaveText('AI-generated summary');
        await lead(page).getByRole('button', { name: 'Next item from 1986' }).click();
        // Only a French summary: shown, marked, and tagged French.
        await expect.poll(() => leadItem(page)).toBe('7001');
        await expect(lead(page).locator('.iwac-vis-otd-lead__lede')).toHaveAttribute('lang', 'fr');
        await expect(lead(page).locator('.iwac-vis-otd-ai')).toHaveCount(1);
        await lead(page).getByRole('button', { name: 'Next item from 1986' }).click();
        // An excerpt: not marked.
        await expect.poll(() => leadItem(page)).toBe('7003');
        await expect(lead(page).locator('.iwac-vis-otd-lead__lede')).toHaveText('Légende de l’image.');
        await expect(lead(page).locator('.iwac-vis-otd-ai')).toHaveCount(0);
        await lead(page).getByRole('button', { name: 'Next item from 1986' }).click();
        // No copy at all: neither.
        await expect.poll(() => leadItem(page)).toBe('7002');
        await expect(lead(page).locator('.iwac-vis-otd-lead__lede, .iwac-vis-otd-ai')).toHaveCount(0);
        // The briefs set their excerpts: never marked.
        await expect(page.locator('.iwac-vis-otd-brief .iwac-vis-otd-ai')).toHaveCount(0);

        // French: the excerpt leads, unmarked.
        await openEdition(page, '&lang=fr');
        await expect(lead(page).locator('.iwac-vis-otd-lead__lede')).toHaveText('Un extrait du texte de 1986.');
        await expect(lead(page).locator('.iwac-vis-otd-ai')).toHaveCount(0);
        await expect(lead(page).locator('.iwac-vis-otd-lead__cta')).toHaveText(/Lire le document/);
    });

    test('dateline country, subject chips to the index records, and the call to action', async ({ page }) => {
        await openEdition(page);
        await expect(lead(page).locator('.iwac-vis-otd-lead__dateline')).toContainText('Niger');
        const subjects = page.getByRole('list', { name: 'Subjects' });
        await expect(subjects.getByRole('link')).toHaveCount(2);
        await expect(subjects.getByRole('link', { name: 'Tabaski' })).toHaveAttribute('href', '/s/iwac/item/903');
        await expect(subjects.getByRole('link', { name: 'Laïcité' })).toHaveAttribute('href', '/s/iwac/item/953');
        // A subject with no index record is named, not linked.
        await expect(subjects.locator('li')).toHaveCount(3);
        const cta = lead(page).locator('.iwac-vis-otd-lead__cta');
        await expect(cta).toHaveText(/Read the item/);
        await expect(cta).toHaveAttribute('href', '/s/iwac/item/5003');
        await expect(cta).toHaveAttribute('aria-hidden', 'true');
        await expect(cta).toHaveAttribute('tabindex', '-1');
    });

    test('the country filter: offered at three countries or more, it narrows the spine, lead and briefs', async ({ page }) => {
        await openEdition(page);
        const togo = () => page.getByRole('group', { name: 'Country' }).getByRole('button', { name: /^Togo/ });
        await expect(page.getByRole('group', { name: 'Country' }).getByRole('button')).toHaveCount(6);
        await togo().click();
        await expect(page.locator('.iwac-vis-otd-folio__scale')).toHaveText('4 items from Togo and 3 newspapers, 1968–2003.');
        const years = await page.locator('.iwac-vis-otd-tick').evaluateAll((n) => n.map((b) => Number(b.getAttribute('data-year'))));
        expect(years).toEqual([1968, 1978, 1993, 2003]);
        await expect(togo()).toHaveAttribute('aria-pressed', 'true');
        // Focus came back to the chip after the redraw.
        await expect(togo()).toBeFocused();
        expect(new URL(page.url()).searchParams.get('otd.country')).toBe('Togo');
        for (const c of await page.locator('.iwac-vis-otd-brief .iwac-vis-otd-meta__country').allTextContents()) {
            expect(c).toBe('Togo');
        }
        await expect(page.locator('.iwac-vis-otd-foot__count')).toContainText('from Togo');

        // A new day resets it.
        await page.getByRole('button', { name: 'Next day, 16 November' }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get('otd.country')).toBeNull();
        // A country the day does not hold is ignored, and leaves the address.
        await openEdition(page, '&otd.country=Atlantis');
        await expect(page.locator('.iwac-vis-otd-tick')).toHaveCount(24);
        await expect.poll(() => new URL(page.url()).searchParams.get('otd.country')).toBeNull();
        // Two countries: no filter.
        await openEdition(page, '&countries=2');
        await expect(page.locator('.iwac-vis-otd-countries')).toHaveCount(0);
    });

    test('an old-format day renders with none of the new furniture', async ({ page }) => {
        await openEdition(page, '&old=1');
        await expect(page.locator('.iwac-vis-otd-lead')).toHaveCount(1);
        await expect(page.locator('.iwac-vis-otd-countries, .iwac-vis-otd-pager, .iwac-vis-otd-subjects, .iwac-vis-otd-ai, .iwac-vis-otd-meta__country')).toHaveCount(0);
        await expect(lead(page).locator('.iwac-vis-otd-lead__lede')).toHaveText('Un extrait du texte de 1986.');
    });
});
