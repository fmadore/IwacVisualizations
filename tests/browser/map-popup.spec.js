'use strict';

const { test, expect } = require('@playwright/test');

const FIXTURE = '/tests/browser/fixtures/map-popup.html';

test('keeps a long popup inside a short, narrow map at every anchor threshold', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 700 });
    await page.goto(FIXTURE);

    const points = [
        [30, 30],
        [345, 30],
        [30, 290],
        [345, 290],
        [130, 160],
        [187, 160],
        [245, 160],
    ];

    for (const [x, y] of points) {
        const layout = await page.evaluate(([px, py]) => {
            window.openTestPopup(px, py);
            const map = document.getElementById('map').getBoundingClientRect();
            const popup = document.querySelector('.maplibregl-popup').getBoundingClientRect();
            const body = document.querySelector('.iwac-vis-map-popup');
            return {
                map: { left: map.left, top: map.top, right: map.right, bottom: map.bottom },
                popup: {
                    left: popup.left,
                    top: popup.top,
                    right: popup.right,
                    bottom: popup.bottom,
                },
                bodyClientHeight: body.clientHeight,
                bodyScrollHeight: body.scrollHeight,
            };
        }, [x, y]);

        expect(layout.popup.left).toBeGreaterThanOrEqual(layout.map.left + 15);
        expect(layout.popup.right).toBeLessThanOrEqual(layout.map.right - 15);
        expect(layout.popup.top).toBeGreaterThanOrEqual(layout.map.top + 15);
        expect(layout.popup.bottom).toBeLessThanOrEqual(layout.map.bottom - 15);
        expect(layout.bodyScrollHeight).toBeGreaterThan(layout.bodyClientHeight);
    }
});
