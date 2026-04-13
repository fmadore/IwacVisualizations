# ECharts Responsive, Visual & Refactoring Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make IWAC ECharts visualizations responsive across screen sizes, visually polished, and DRY — with unified breakpoints, theme-token-driven colors, and shared helpers replacing duplicated code.

**Architecture:** New `responsive.js` module provides breakpoint constants and ECharts media-query presets. Chart builders in `chart-options.js` are refactored to use shared defaults (`_grid`, `_dataZoom`, `_truncate`, `_barDefaults`, `_countryColor`) and wrap their options with responsive media rules. `dashboard-core.js` gains ResizeObserver for container-aware resize. CSS is unified to three breakpoints (640/768/1024px) with badge colors via CSS variables.

**Tech Stack:** Vanilla ES5 JavaScript (no bundler), ECharts 6 media query API, ResizeObserver with window.resize fallback, CSS custom properties, Omeka S module (PHP templates).

**Spec:** `docs/superpowers/specs/2026-04-12-echarts-responsive-visual-refactor-design.md`

---

### Task 1: Create `responsive.js` — breakpoints, media presets, merge utility

**Files:**
- Create: `asset/js/charts/shared/responsive.js`

- [ ] **Step 1: Create responsive.js with breakpoints and container-width helper**

```js
/**
 * IWAC Visualizations — Responsive helpers
 *
 * Breakpoint constants (single source of truth for JS), container-width
 * utility, and reusable ECharts media-query presets that chart builders
 * merge into their option objects via R.withMedia().
 *
 * Load order: after panels.js, before chart-options.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var R = ns.responsive = ns.responsive || {};

    /* ----------------------------------------------------------------- */
    /*  Breakpoint constants                                              */
    /* ----------------------------------------------------------------- */

    R.BP = { sm: 640, md: 768, lg: 1024 };

    /* ----------------------------------------------------------------- */
    /*  Container width helper                                            */
    /* ----------------------------------------------------------------- */

    R.containerWidth = function (el) {
        var node = el && (el.parentElement || el);
        if (!node) return window.innerWidth;
        return node.getBoundingClientRect().width || window.innerWidth;
    };

    /* ----------------------------------------------------------------- */
    /*  ECharts media presets                                              */
    /* ----------------------------------------------------------------- */

    R.legendMedia = function () {
        return [
            {
                query: { maxWidth: R.BP.sm },
                option: {
                    legend: {
                        orient: 'horizontal',
                        left: 'center',
                        bottom: 0,
                        top: null,
                        right: null
                    }
                }
            }
        ];
    };

    R.gridMedia = function () {
        return [
            {
                query: { maxWidth: R.BP.sm },
                option: {
                    grid: { left: 24, right: 12, top: 36, bottom: 24 }
                }
            }
        ];
    };

    R.labelMedia = function (opts) {
        opts = opts || {};
        var smWidth = opts.smWidth || 100;
        var smFontSize = opts.smFontSize || 11;
        return [
            {
                query: { maxWidth: R.BP.sm },
                option: {
                    yAxis: {
                        axisLabel: {
                            width: smWidth,
                            fontSize: smFontSize,
                            overflow: 'truncate'
                        }
                    }
                }
            }
        ];
    };

    R.dataZoomMedia = function () {
        return [
            {
                query: { maxWidth: R.BP.sm },
                option: {
                    dataZoom: [{ height: 14 }]
                }
            }
        ];
    };

    /* ----------------------------------------------------------------- */
    /*  Merge utility                                                     */
    /* ----------------------------------------------------------------- */

    R.withMedia = function (baseOption /*, mediaArray1, mediaArray2, ... */) {
        var allRules = [];
        for (var i = 1; i < arguments.length; i++) {
            var arr = arguments[i];
            if (Array.isArray(arr)) {
                for (var j = 0; j < arr.length; j++) {
                    allRules.push(arr[j]);
                }
            }
        }
        if (allRules.length === 0) return baseOption;
        allRules.push({ option: baseOption });
        return { baseOption: baseOption, media: allRules };
    };
})();
```

- [ ] **Step 2: Verify file is syntactically valid**

Run: `node --check asset/js/charts/shared/responsive.js`
Expected: no output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/shared/responsive.js
git commit -m "feat: add responsive.js — breakpoints, media presets, merge utility"
```

---

### Task 2: Add ResizeObserver to `dashboard-core.js`

**Files:**
- Modify: `asset/js/dashboard-core.js`

- [ ] **Step 1: Add debounce helper and ResizeObserver to registerChart**

In `dashboard-core.js`, add a debounce utility near the top of the IIFE (after `var ns = ...`), then modify `ns.registerChart` to create a ResizeObserver, and update `ns.pruneCharts` to disconnect observers.

Add debounce function after line 18 (`var ns = ...`):

```js
    function debounce(fn, ms) {
        var timer;
        return function () {
            if (timer) clearTimeout(timer);
            timer = setTimeout(fn, ms);
        };
    }
```

Replace the existing `ns.registerChart` function (lines 60-67) with:

```js
    ns.registerChart = function (el, render) {
        var instance = ns.initChart(el);
        if (!instance) return null;
        var entry = { el: el, render: render, instance: instance, kind: 'echarts' };

        if (typeof ResizeObserver !== 'undefined') {
            var ro = new ResizeObserver(debounce(function () {
                if (entry.instance && !entry.instance.isDisposed()) {
                    entry.instance.resize({
                        animation: { duration: 200, easing: 'cubicOut' }
                    });
                }
            }, 150));
            ro.observe(el.parentElement || el);
            entry._resizeObserver = ro;
        }

        ns._charts.push(entry);
        try { render(el, instance); } catch (e) { console.error('IWACVis: render failed', e); }
        return instance;
    };
```

Replace the existing `ns.pruneCharts` function (lines 81-87) with:

```js
    ns.pruneCharts = function () {
        ns._charts = ns._charts.filter(function (c) {
            var alive = false;
            if (c.kind === 'echarts') alive = c.instance && !c.instance.isDisposed();
            else if (c.kind === 'maplibre') alive = c.instance && !c.instance._removed;
            if (!alive && c._resizeObserver) {
                c._resizeObserver.disconnect();
                c._resizeObserver = null;
            }
            return alive;
        });
    };
```

- [ ] **Step 2: Replace inline debounce in handleWindowResize with the new utility**

Replace the `handleWindowResize` function (lines 164-177) — use the same `debounce` utility:

```js
    var handleWindowResize = debounce(function () {
        ns.pruneCharts();
        ns._charts.forEach(function (entry) {
            try {
                if (entry.kind === 'echarts' && entry.instance) entry.instance.resize();
                else if (entry.kind === 'maplibre' && entry.instance) entry.instance.resize();
            } catch (e) {
                // Swallow — a disposed chart shouldn't take the whole page down
            }
        });
    }, 120);
```

Remove the old `var _resizeTimer = null;` line (163).

- [ ] **Step 3: Verify syntax**

Run: `node --check asset/js/dashboard-core.js`
Expected: no output (clean parse)

- [ ] **Step 4: Commit**

```bash
git add asset/js/dashboard-core.js
git commit -m "feat: ResizeObserver per chart, debounce utility in dashboard-core"
```

---

### Task 3: Extract shared helpers in `chart-options.js`

**Files:**
- Modify: `asset/js/charts/shared/chart-options.js`

- [ ] **Step 1: Add shared helpers at the top of the IIFE (after `var esc = P.escapeHtml;` on line 28)**

```js
    var R = ns.responsive;

    /* ----------------------------------------------------------------- */
    /*  Shared private helpers                                            */
    /* ----------------------------------------------------------------- */

    C._grid = function (overrides) {
        var defaults = { left: 48, right: 24, top: 48, bottom: 32, containLabel: true };
        if (!overrides) return defaults;
        var result = {};
        for (var k in defaults) {
            if (Object.prototype.hasOwnProperty.call(defaults, k)) {
                result[k] = overrides[k] !== undefined ? overrides[k] : defaults[k];
            }
        }
        for (var k2 in overrides) {
            if (Object.prototype.hasOwnProperty.call(overrides, k2) && !(k2 in defaults)) {
                result[k2] = overrides[k2];
            }
        }
        return result;
    };

    C._dataZoom = function (count, opts) {
        opts = opts || {};
        var threshold = opts.threshold || 20;
        if (count <= threshold) return [];
        var start = opts.start != null ? opts.start : 60;
        return [
            { type: 'slider', start: start, end: 100, bottom: 8, height: 18 },
            { type: 'inside' }
        ];
    };

    C._truncate = function (str, maxLen) {
        if (!str || str.length <= maxLen) return str || '';
        var head = Math.floor((maxLen - 1) / 2);
        var tail = maxLen - 1 - head;
        return str.slice(0, head) + '\u2026' + str.slice(-tail);
    };

    C._barDefaults = function (direction) {
        var radius = direction === 'horizontal'
            ? [0, 2, 2, 0]
            : [2, 2, 0, 0];
        return {
            barMaxWidth: 24,
            emphasis: { focus: 'series' },
            blur: { itemStyle: { opacity: 0.35 } },
            itemStyle: { borderRadius: radius }
        };
    };

    /* ----------------------------------------------------------------- */
    /*  Country color map                                                 */
    /* ----------------------------------------------------------------- */

    var COUNTRY_MAP = {
        'Benin':            0,
        'Bénin':            0,
        'Burkina Faso':     1,
        "Côte d'Ivoire":    2,
        'Niger':            3,
        'Nigeria':          4,
        'Togo':             5,
        'Sénégal':          6,
        'Senegal':          6
    };
    var _dynamicIdx = 7;
    var _dynamicMap = {};

    C._countryColor = function (country) {
        var palette = (ns.getPalette && ns.getPalette()) || [];
        if (palette.length === 0) palette = ['#e67a14', '#394f68', '#4a8c6f', '#c5504d', '#7c5295', '#d4a574', '#2c5f7c', '#8b6f47'];
        var idx;
        if (COUNTRY_MAP[country] != null) {
            idx = COUNTRY_MAP[country];
        } else if (_dynamicMap[country] != null) {
            idx = _dynamicMap[country];
        } else {
            idx = _dynamicIdx++;
            _dynamicMap[country] = idx;
        }
        return palette[idx % palette.length];
    };
```

- [ ] **Step 2: Verify syntax**

Run: `node --check asset/js/charts/shared/chart-options.js`
Expected: no output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/shared/chart-options.js
git commit -m "refactor: extract shared helpers (_grid, _dataZoom, _truncate, _barDefaults, _countryColor)"
```

---

### Task 4: Refactor `C.timeline` and `C.stackedBar` builders

**Files:**
- Modify: `asset/js/charts/shared/chart-options.js`

- [ ] **Step 1: Replace the `C.timeline` function (lines 44-95) with refactored version using shared helpers + media**

```js
    C.timeline = function (timeline, opts) {
        opts = opts || {};
        var filter = opts.filterUnknown !== false;
        var categories = (timeline.categories || timeline.countries || []);
        if (filter) categories = categories.filter(function (c) { return !P.isUnknown(c); });
        var years = timeline.years || [];

        var barDef = C._barDefaults('vertical');
        var series = categories.map(function (cat) {
            return {
                name: cat,
                type: 'bar',
                stack: 'total',
                barMaxWidth: barDef.barMaxWidth,
                emphasis: barDef.emphasis,
                blur: barDef.blur,
                itemStyle: Object.assign({}, barDef.itemStyle, {
                    color: opts.useCountryColors !== false ? C._countryColor(cat) : undefined
                }),
                data: (timeline.series && timeline.series[cat]) || []
            };
        });

        var useZoom = years.length > 20;
        var base = {
            grid: C._grid({ bottom: useZoom ? 56 : 32 }),
            legend: { type: 'scroll', top: 4, itemWidth: 12, itemHeight: 10 },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'category',
                data: years,
                name: opts.categoryName || t('Year'),
                nameLocation: 'middle',
                nameGap: useZoom ? 36 : 24
            },
            yAxis: { type: 'value', name: opts.valueName || t('Count') },
            dataZoom: C._dataZoom(years.length),
            series: series,
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.gridMedia(), R.dataZoomMedia())
            : base;
    };
```

Note: `Object.assign` is ES6 but available in all browsers that support ECharts 6. For the `color: undefined` case, ECharts ignores undefined values, so no special handling needed.

- [ ] **Step 2: Replace the `C.stackedBar` function (lines 493-530) with refactored version**

```js
    C.stackedBar = function (d, opts) {
        opts = opts || {};
        var categories = d.categories || [];
        var stackKeys = d.stackKeys || [];
        var seriesMap = d.series || {};

        var barDef = C._barDefaults('vertical');
        var series = stackKeys.map(function (k) {
            return {
                name: opts.labelFor ? opts.labelFor(k) : k,
                type: 'bar',
                stack: 'total',
                barMaxWidth: barDef.barMaxWidth,
                emphasis: barDef.emphasis,
                blur: barDef.blur,
                itemStyle: barDef.itemStyle,
                data: seriesMap[k] || []
            };
        });

        var useZoom = categories.length > 20;
        var base = {
            grid: C._grid({ bottom: useZoom ? 56 : 32 }),
            legend: { type: 'scroll', top: 4, itemWidth: 12, itemHeight: 10 },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'category',
                data: categories,
                name: opts.categoryName || '',
                nameLocation: 'middle',
                nameGap: useZoom ? 36 : 24
            },
            yAxis: { type: 'value', name: opts.valueName || t('Count') },
            dataZoom: C._dataZoom(categories.length),
            series: series,
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.gridMedia(), R.dataZoomMedia())
            : base;
    };
```

- [ ] **Step 3: Verify syntax**

Run: `node --check asset/js/charts/shared/chart-options.js`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add asset/js/charts/shared/chart-options.js
git commit -m "refactor: timeline + stackedBar use shared helpers, media rules, country colors"
```

---

### Task 5: Refactor `C.horizontalBar`, `C.entities`, `C.newspaper` builders

**Files:**
- Modify: `asset/js/charts/shared/chart-options.js`

- [ ] **Step 1: Replace `C.horizontalBar` (lines 110-146)**

```js
    C.horizontalBar = function (entries, opts) {
        opts = opts || {};
        var nameKey = opts.nameKey || 'name';
        var valueKey = opts.valueKey || 'count';
        var list = (entries || []).slice();
        if (opts.filterUnknown !== false) {
            list = list.filter(function (e) { return !P.isUnknown(e && e[nameKey]); });
        }
        var names = list.map(function (e) { return e[nameKey]; });
        var values = list.map(function (e) { return e[valueKey]; });
        var barDef = C._barDefaults('horizontal');

        var base = {
            grid: C._grid({ left: 8, top: 8, bottom: 8 }),
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false }
            },
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: barDef.barMaxWidth - 2,
                itemStyle: barDef.itemStyle,
                label: {
                    show: true,
                    position: 'right',
                    formatter: function (p) { return fmt(p.value); }
                }
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.gridMedia())
            : base;
    };
```

- [ ] **Step 2: Replace `C.entities` (lines 273-336)**

```js
    C.entities = function (entries, opts) {
        opts = opts || {};
        var maxLen = opts.maxLabelLength || 30;
        var list = entries || [];
        var names = list.map(function (e) { return e.title; });
        var values = list.map(function (e) {
            return { value: e.frequency, o_id: e.o_id };
        });
        var barDef = C._barDefaults('horizontal');

        var base = {
            grid: C._grid({ left: 8, right: 48, top: 8, bottom: 8 }),
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var entry = list[p.dataIndex] || {};
                    var lines = [
                        '<strong>' + esc(entry.title || '') + '</strong>',
                        t('mentions_count', { count: fmt(entry.frequency || 0) })
                    ];
                    if (entry.first_occurrence || entry.last_occurrence) {
                        lines.push(
                            (entry.first_occurrence || '?') + ' \u2013 ' + (entry.last_occurrence || '?')
                        );
                    }
                    if (entry.countries && entry.countries.length) {
                        lines.push(entry.countries.join(', '));
                    }
                    return lines.join('<br>');
                }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false },
                axisLabel: {
                    width: 220,
                    overflow: 'truncate',
                    formatter: function (v) { return C._truncate(v, maxLen); }
                }
            },
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: barDef.barMaxWidth - 4,
                itemStyle: barDef.itemStyle,
                label: {
                    show: true,
                    position: 'right',
                    formatter: function (p) { return fmt(p.value); }
                },
                cursor: 'pointer'
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 120, smFontSize: 11 }), R.gridMedia())
            : base;
    };
```

- [ ] **Step 3: Replace `C.newspaper` (lines 216-258)**

```js
    C.newspaper = function (entries) {
        var list = entries || [];
        var names = list.map(function (e) { return e.name; });
        var values = list.map(function (e) { return e.total; });
        var barDef = C._barDefaults('horizontal');

        var base = {
            grid: C._grid({ left: 8, right: 48, top: 8, bottom: 8 }),
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var entry = list[p.dataIndex] || {};
                    var lines = ['<strong>' + esc(entry.name || '') + '</strong>'];
                    if (entry.year_min && entry.year_max) {
                        lines.push(t('coverage_range', { min: entry.year_min, max: entry.year_max }));
                    }
                    var bits = [];
                    if (entry.articles)     bits.push(fmt(entry.articles) + ' ' + t('Articles').toLowerCase());
                    if (entry.publications) bits.push(fmt(entry.publications) + ' ' + t('Publications').toLowerCase());
                    if (bits.length) lines.push(bits.join(' &middot; '));
                    if (entry.country) lines.push(esc(entry.country));
                    return lines.join('<br>');
                }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false }
            },
            series: [{
                type: 'bar',
                data: values,
                barMaxWidth: barDef.barMaxWidth - 6,
                itemStyle: barDef.itemStyle,
                label: {
                    show: true,
                    position: 'right',
                    formatter: function (p) { return fmt(p.value); }
                }
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.gridMedia())
            : base;
    };
```

- [ ] **Step 4: Verify syntax**

Run: `node --check asset/js/charts/shared/chart-options.js`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add asset/js/charts/shared/chart-options.js
git commit -m "refactor: horizontalBar, entities, newspaper use shared helpers + media rules"
```

---

### Task 6: Refactor `C.pie`, `C.growthBar` builders

**Files:**
- Modify: `asset/js/charts/shared/chart-options.js`

- [ ] **Step 1: Replace `C.pie` (lines 161-203)**

```js
    C.pie = function (entries, opts) {
        opts = opts || {};
        var nameKey = opts.nameKey || 'name';
        var valueKey = opts.valueKey || 'count';
        var data = (entries || []).map(function (e) {
            return { name: e[nameKey], value: e[valueKey] };
        });

        var base = {
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    return '<strong>' + esc(p.name) + '</strong><br>'
                        + fmt(p.value) + ' (' + p.percent + '%)';
                }
            },
            legend: {
                orient: 'vertical',
                left: 'right',
                top: 'middle',
                itemWidth: 12,
                itemHeight: 10
            },
            series: [{
                type: 'pie',
                radius: ['40%', '68%'],
                center: ['38%', '50%'],
                avoidLabelOverlap: true,
                label: {
                    show: true,
                    formatter: function (p) {
                        return p.percent >= 5 ? p.name + '\n' + p.percent + '%' : '';
                    }
                },
                emphasis: {
                    label: { show: true, fontWeight: 'bold' },
                    scale: true,
                    scaleSize: 6
                },
                labelLine: { show: true },
                data: data
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        var pieMedia = [
            {
                query: { maxWidth: R ? R.BP.sm : 640 },
                option: {
                    legend: {
                        orient: 'horizontal',
                        left: 'center',
                        bottom: 0,
                        top: null,
                        right: null
                    },
                    series: [{
                        center: ['50%', '45%'],
                        radius: ['30%', '58%']
                    }]
                }
            }
        ];

        return R && R.withMedia
            ? R.withMedia(base, pieMedia)
            : base;
    };
```

- [ ] **Step 2: Replace `C.growthBar` (lines 424-473)**

```js
    C.growthBar = function (growth) {
        var months = growth.months || [];
        var monthly = growth.monthly_additions || [];
        var cumulative = growth.cumulative_total || [];
        var barDef = C._barDefaults('vertical');

        var base = {
            grid: C._grid({ right: 56, bottom: months.length > 24 ? 56 : 32 }),
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: {
                top: 4,
                itemWidth: 12,
                itemHeight: 10,
                data: [t('Monthly additions'), t('Cumulative total')]
            },
            xAxis: {
                type: 'category',
                data: months,
                name: t('Month'),
                nameLocation: 'middle',
                nameGap: months.length > 24 ? 36 : 24
            },
            yAxis: [
                { type: 'value', name: t('Monthly') },
                { type: 'value', name: t('Cumulative'), splitLine: { show: false } }
            ],
            dataZoom: C._dataZoom(months.length, { threshold: 24 }),
            series: [
                {
                    name: t('Monthly additions'),
                    type: 'bar',
                    yAxisIndex: 0,
                    data: monthly,
                    barMaxWidth: barDef.barMaxWidth - 4,
                    emphasis: barDef.emphasis,
                    itemStyle: barDef.itemStyle
                },
                {
                    name: t('Cumulative total'),
                    type: 'line',
                    yAxisIndex: 1,
                    data: cumulative,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 2 }
                }
            ],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.gridMedia(), R.dataZoomMedia())
            : base;
    };
```

- [ ] **Step 3: Verify syntax**

Run: `node --check asset/js/charts/shared/chart-options.js`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add asset/js/charts/shared/chart-options.js
git commit -m "refactor: pie + growthBar use shared helpers, responsive media, visual polish"
```

---

### Task 7: Refactor `C.gantt` — theme tokens + country colors

**Files:**
- Modify: `asset/js/charts/shared/chart-options.js`

- [ ] **Step 1: Replace `C.gantt` (lines 547-654)**

```js
    C.gantt = function (entries, opts) {
        opts = opts || {};
        var list = (entries || []).slice();
        var names = list.map(function (e) { return e.name; });
        var data = list.map(function (e, i) {
            return {
                value: [i, e.year_min, e.year_max],
                entry: e
            };
        });

        var yearMin = Infinity;
        var yearMax = -Infinity;
        list.forEach(function (e) {
            if (e.year_min != null && e.year_min < yearMin) yearMin = e.year_min;
            if (e.year_max != null && e.year_max > yearMax) yearMax = e.year_max;
        });
        if (!isFinite(yearMin)) yearMin = 1900;
        if (!isFinite(yearMax)) yearMax = new Date().getFullYear();

        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var strokeColor = tokens.border ? tokens.border + '36' : 'rgba(0,0,0,0.13)';

        function renderItem(params, api) {
            var yIndex = api.value(0);
            var start = api.coord([api.value(1), yIndex]);
            var end = api.coord([api.value(2) + 1, yIndex]);
            var height = api.size([0, 1])[1] * 0.6;
            var width = Math.max(2, end[0] - start[0]);
            var entry = data[params.dataIndex] && data[params.dataIndex].entry;
            var color = C._countryColor(entry && entry.country);
            return {
                type: 'rect',
                shape: {
                    x: start[0],
                    y: start[1] - height / 2,
                    width: width,
                    height: height,
                    r: 2
                },
                style: { fill: color, stroke: strokeColor }
            };
        }

        var base = {
            grid: C._grid({ left: 8, right: 48, bottom: 48 }),
            tooltip: {
                formatter: function (p) {
                    var entry = (data[p.dataIndex] || {}).entry || {};
                    var lines = [
                        '<strong>' + esc(entry.name || '') + '</strong>',
                        (entry.year_min || '?') + ' \u2013 ' + (entry.year_max || '?')
                    ];
                    if (entry.country) lines.push(esc(entry.country));
                    if (entry.type)    lines.push(t('item_type_' + entry.type));
                    if (entry.total != null) {
                        lines.push(fmt(entry.total) + ' ' + t('items_count', { count: '' }).trim());
                    }
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'value',
                min: yearMin,
                max: yearMax + 1,
                interval: Math.max(1, Math.ceil((yearMax - yearMin) / 10)),
                axisLabel: { formatter: '{value}' },
                name: t('Year'),
                nameLocation: 'middle',
                nameGap: 28
            },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false },
                axisLabel: { width: 160, overflow: 'truncate' }
            },
            dataZoom: list.length > 20 ? [
                { type: 'slider', yAxisIndex: 0, start: 0, end: 100 / Math.max(1, list.length / 20), right: 8 },
                { type: 'inside', yAxisIndex: 0 }
            ] : [],
            series: [{
                type: 'custom',
                renderItem: renderItem,
                encode: { x: [1, 2], y: 0 },
                data: data
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return R && R.withMedia
            ? R.withMedia(base, R.labelMedia({ smWidth: 100 }), R.gridMedia())
            : base;
    };
```

- [ ] **Step 2: Verify syntax**

Run: `node --check asset/js/charts/shared/chart-options.js`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/shared/chart-options.js
git commit -m "refactor: gantt uses _countryColor, theme tokens, shared helpers + media"
```

---

### Task 8: Refactor `C.treemap`, `C.wordcloud`, `C.network` builders

**Files:**
- Modify: `asset/js/charts/shared/chart-options.js`

- [ ] **Step 1: Replace `C.treemap` (lines 356-415)**

```js
    C.treemap = function (tree, opts) {
        opts = opts || {};
        var tokens = (ns.getChartTokens && ns.getChartTokens()) || {};
        var surfaceColor = tokens.surface || '#fdfdfc';

        function sanitize(node, depth, depthRef) {
            if (!node || typeof node !== 'object') return null;
            depthRef.max = Math.max(depthRef.max, depth);
            var kids = node.children;
            if (Array.isArray(kids) && kids.length > 0) {
                var cleanKids = [];
                for (var i = 0; i < kids.length; i++) {
                    var c = sanitize(kids[i], depth + 1, depthRef);
                    if (c) cleanKids.push(c);
                }
                if (cleanKids.length > 0) {
                    return { name: node.name || '', children: cleanKids };
                }
            }
            if (node.value != null && Number(node.value) > 0) {
                return { name: node.name || '', value: Number(node.value) };
            }
            return null;
        }

        var depthRef = { max: 0 };
        var sanitized = sanitize(tree || { children: [] }, 0, depthRef);
        var children = (sanitized && sanitized.children) || [];

        var base = {
            tooltip: {
                formatter: function (info) {
                    var path = info.treePathInfo || [];
                    var crumbs = path.slice(1).map(function (p) { return esc(p.name); }).join(' \u203a ');
                    return crumbs + '<br><strong>' + fmt(info.value) + '</strong>';
                }
            },
            series: [{
                type: 'treemap',
                name: opts.rootName || (tree && tree.name) || 'Root',
                roam: false,
                nodeClick: 'zoomToNode',
                leafDepth: 2,
                breadcrumb: { show: true, bottom: 4 },
                label: { show: true, formatter: '{b}' },
                itemStyle: { borderWidth: 1, gapWidth: 2, borderColor: surfaceColor },
                levels: [
                    { itemStyle: { borderWidth: 0, gapWidth: 3, borderColor: surfaceColor } },
                    { itemStyle: { gapWidth: 2, borderColor: surfaceColor } },
                    { colorSaturation: [0.35, 0.5], itemStyle: { gapWidth: 1, borderColor: surfaceColor } }
                ],
                data: children
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        return base;
    };
```

- [ ] **Step 2: Update `C.wordcloud` — add enhanced emphasis + animation**

Replace the emphasis section (lines 759-765 of the current file) and add animation:

Find the existing wordcloud return object and update the emphasis and add animation properties. Replace the full `C.wordcloud` function:

```js
    C.wordcloud = function (pairs, opts) {
        opts = opts || {};
        var data = (pairs || []).map(function (pair) {
            return { name: pair[0], value: pair[1] };
        });
        if (!isWordCloudAvailable()) {
            return C.horizontalBar(
                data.slice(0, 20).map(function (d) { return { name: d.name, count: d.value }; }),
                { nameKey: 'name', valueKey: 'count' }
            );
        }

        var count = data.length;
        var minFont = count > 100 ? 10 : count > 50 ? 12 : 14;
        var maxFont = count > 100 ? 56 : count > 50 ? 64 : (count > 10 ? 72 : 88);
        var grid = count > 100 ? 4 : count > 50 ? 6 : 8;

        var smMaxFont = Math.round(maxFont * 0.8);

        var palette = (ns.getPalette && ns.getPalette())
            || ['#e67a14', '#c9442a', '#2d6a4f', '#1d4e6b', '#7a3b89', '#8a5a2b', '#4d3a1f'];

        var base = {
            tooltip: {
                confine: true,
                formatter: function (p) {
                    return '<strong>' + esc(p.name) + '</strong>: ' + fmt(p.value);
                }
            },
            aria: { enabled: true },
            series: [{
                type: 'wordCloud',
                shape: function (theta) {
                    var cos = Math.abs(Math.cos(theta));
                    var sin = Math.abs(Math.sin(theta));
                    return 1 / Math.max(cos, sin);
                },
                left: 'center',
                top: 'center',
                width: '100%',
                height: '100%',
                right: null,
                bottom: null,
                sizeRange: [minFont, maxFont],
                rotationRange: [-45, 45],
                rotationStep: 15,
                gridSize: grid,
                drawOutOfBound: false,
                shrinkToFit: true,
                layoutAnimation: count <= 100,
                textStyle: {
                    fontFamily: 'sans-serif',
                    fontWeight: 'bold',
                    color: function () {
                        return palette[Math.floor(Math.random() * palette.length)];
                    }
                },
                emphasis: {
                    textStyle: {
                        fontWeight: 'bold',
                        shadowBlur: 14,
                        shadowColor: 'rgba(0,0,0,0.4)'
                    }
                },
                data: data
            }]
        };

        var wcMedia = [
            {
                query: { maxWidth: R ? R.BP.sm : 640 },
                option: {
                    series: [{ sizeRange: [minFont, smMaxFont] }]
                }
            }
        ];

        return R && R.withMedia
            ? R.withMedia(base, wcMedia)
            : base;
    };
```

- [ ] **Step 3: Update `C.network` — use shared truncate + enhanced emphasis**

Replace the full `C.network` function:

```js
    C.network = function (graph, opts) {
        opts = opts || {};
        var maxLen = opts.maxLabelLength || 24;
        var nodes = (graph && graph.nodes) || [];
        var edges = (graph && graph.edges) || [];

        var palette = (ns.getPalette && ns.getPalette())
            || ['#d97706', '#2563eb', '#059669', '#9333ea', '#dc2626', '#0891b2'];
        var TYPE_COLORS = {
            'center':        palette[0],
            'Personnes':     palette[1],
            'Organisations': palette[2],
            'Lieux':         palette[3],
            'Sujets':        palette[4],
            '\u00c9v\u00e9nements': palette[5]
        };
        if (opts.typeColors) {
            for (var k in opts.typeColors) {
                if (Object.prototype.hasOwnProperty.call(opts.typeColors, k)) {
                    TYPE_COLORS[k] = opts.typeColors[k];
                }
            }
        }

        var scores = nodes.map(function (n) { return n.score || 0; });
        var maxScore = Math.max.apply(null, scores.concat([1]));
        var weights = edges.map(function (e) { return e.weight || 0; });
        var maxWeight = Math.max.apply(null, weights.concat([1]));

        var graphNodes = nodes.map(function (n, idx) {
            var isCenter = n.type === 'center';
            var normScore = isCenter ? 1 : Math.max(0, Math.min(1, (n.score || 0) / maxScore));
            var symbolSize = isCenter ? 46 : 14 + Math.sqrt(normScore) * 26;
            return {
                id: String(n.o_id),
                name: C._truncate(n.title || '', maxLen),
                fullTitle: n.title || '',
                entityType: n.type,
                o_id: n.o_id,
                cooc: n.cooc,
                score: n.score,
                symbolSize: symbolSize,
                itemStyle: { color: TYPE_COLORS[n.type] || palette[idx % palette.length] },
                fixed: isCenter,
                x: isCenter ? 0 : undefined,
                y: isCenter ? 0 : undefined,
                label: { show: true, position: 'right', formatter: '{b}' }
            };
        });

        var graphEdges = edges.map(function (e) {
            var normWeight = Math.max(0, Math.min(1, (e.weight || 0) / maxWeight));
            return {
                source: String(e.source),
                target: String(e.target),
                value: e.weight,
                cooc: e.cooc,
                lineStyle: {
                    width: 1 + Math.sqrt(normWeight) * 4,
                    opacity: 0.55
                }
            };
        });

        var uniqueTypes = {};
        nodes.forEach(function (n) { if (n.type && n.type !== 'center') uniqueTypes[n.type] = true; });
        var legendData = Object.keys(uniqueTypes).map(function (type) {
            return {
                name: t('entity_type_' + type),
                itemStyle: { color: TYPE_COLORS[type] }
            };
        });

        var base = {
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        var nodeData = p.data || {};
                        var lines = ['<strong>' + esc(nodeData.fullTitle || '') + '</strong>'];
                        if (nodeData.entityType && nodeData.entityType !== 'center') {
                            lines.push(t('entity_type_' + nodeData.entityType));
                        }
                        if (nodeData.cooc != null) {
                            lines.push(t('mentions_count', { count: fmt(nodeData.cooc) }));
                        }
                        if (nodeData.score != null) {
                            lines.push(t('Distinctiveness score') + ': ' + fmt(Math.round(nodeData.score * 10) / 10));
                        }
                        return lines.join('<br>');
                    }
                    if (p.dataType === 'edge') {
                        var edgeData = p.data || {};
                        return t('mentions_count', { count: fmt(edgeData.cooc || 0) });
                    }
                    return '';
                }
            },
            legend: legendData.length ? [{
                data: legendData,
                top: 4,
                itemWidth: 12,
                itemHeight: 10
            }] : [],
            series: [{
                type: 'graph',
                layout: 'force',
                roam: true,
                draggable: true,
                focusNodeAdjacency: true,
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 4 },
                    scale: true,
                    scaleSize: 3
                },
                force: {
                    repulsion: 180,
                    edgeLength: [40, 120],
                    gravity: 0.05
                },
                data: graphNodes,
                links: graphEdges,
                cursor: 'pointer'
            }],
            animationDuration: 600,
            animationEasing: 'cubicOut'
        };

        var networkMedia = [
            {
                query: { maxWidth: R ? R.BP.sm : 640 },
                option: {
                    series: [{
                        force: {
                            repulsion: 120,
                            edgeLength: [30, 80]
                        }
                    }]
                }
            }
        ];

        return R && R.withMedia
            ? R.withMedia(base, networkMedia)
            : base;
    };
```

- [ ] **Step 4: Verify syntax**

Run: `node --check asset/js/charts/shared/chart-options.js`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add asset/js/charts/shared/chart-options.js
git commit -m "refactor: treemap, wordcloud, network — theme tokens, shared truncate, media rules"
```

---

### Task 9: CSS refactoring — unified breakpoints + responsive heights

**Files:**
- Modify: `asset/css/iwac-visualizations.css`

- [ ] **Step 1: Add breakpoint documentation comment at the top (after line 14)**

Add after the existing header comment block:

```css
/* Breakpoints (cannot use var() in @media — values documented here):
   sm: 640px   (large phones)
   md: 768px   (tablets)
   lg: 1024px  (small laptops)
*/
```

- [ ] **Step 2: Update chart panel min-height (line 97)**

Replace:
```css
    min-height: 320px;
```
with:
```css
    min-height: 320px;
```

Then add a mobile media query after the `.iwac-vis-panel > .iwac-vis-chart` block (after line 98):

```css
@media (max-width: 640px) {
    .iwac-vis-panel > .iwac-vis-chart {
        min-height: 280px;
    }
}
```

- [ ] **Step 3: Unify dashboard grid breakpoint (line 114: change 768px — already correct)**

The `@media (min-width: 768px)` at line 114 is already at `md`. No change needed.

- [ ] **Step 4: Unify summary cards breakpoints (lines 228-234)**

Replace:
```css
@media (min-width: 600px) {
    .iwac-vis-overview-summary { grid-template-columns: repeat(3, 1fr); }
}

@media (min-width: 900px) {
    .iwac-vis-overview-summary { grid-template-columns: repeat(6, 1fr); }
}
```

with:
```css
@media (min-width: 640px) { /* sm */
    .iwac-vis-overview-summary { grid-template-columns: repeat(3, 1fr); }
}

@media (min-width: 1024px) { /* lg */
    .iwac-vis-overview-summary { grid-template-columns: repeat(6, 1fr); }
}
```

- [ ] **Step 5: Unify overview grid breakpoint (lines 286-293)**

Replace `min-width: 800px` with `min-width: 768px`:

```css
@media (min-width: 768px) { /* md */
    .iwac-vis-overview-grid {
        grid-template-columns: 1fr 1fr;
    }
    .iwac-vis-overview-grid .iwac-vis-panel--wide {
        grid-column: 1 / -1;
    }
}
```

- [ ] **Step 6: Update overview chart heights (lines 308-314)**

Replace:
```css
.iwac-vis-overview-grid .iwac-vis-chart {
    min-height: 280px;
}

.iwac-vis-overview-grid .iwac-vis-panel--wide .iwac-vis-chart {
    min-height: 360px;
}
```

with:
```css
.iwac-vis-overview-grid .iwac-vis-chart {
    min-height: 280px;
}

.iwac-vis-overview-grid .iwac-vis-panel--wide .iwac-vis-chart {
    min-height: clamp(280px, 40vh, 360px);
}

@media (max-width: 640px) { /* sm */
    .iwac-vis-overview-grid .iwac-vis-chart {
        min-height: 240px;
    }
}
```

- [ ] **Step 7: Update wordcloud min-height (line 563-565)**

Replace:
```css
.iwac-vis-panel--wordcloud .iwac-vis-chart {
    min-height: 520px;
}
```

with:
```css
.iwac-vis-panel--wordcloud .iwac-vis-chart {
    min-height: clamp(320px, 50vh, 520px);
}
```

- [ ] **Step 8: Update map height (line 690-696)**

Replace:
```css
.iwac-vis-map {
    width: 100%;
    height: 520px;
```

with:
```css
.iwac-vis-map {
    width: 100%;
    height: clamp(320px, 60vh, 520px);
```

- [ ] **Step 9: Commit**

```bash
git add asset/css/iwac-visualizations.css
git commit -m "refactor: unify CSS breakpoints to 640/768/1024, responsive chart heights"
```

---

### Task 10: CSS refactoring — badge variables, mobile spacing, recent-additions breakpoints

**Files:**
- Modify: `asset/css/iwac-visualizations.css`

- [ ] **Step 1: Refactor badge colors to use CSS variables (lines 435-458)**

Replace the full badge section:

```css
.iwac-vis-badge {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: var(--text-xs, 0.75rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--badge-bg, var(--surface-raised, #f9f7f3));
    color: var(--badge-fg, var(--ink, #18202a));
    border: 1px solid var(--badge-border, var(--border, #dcd7ce));
}

.iwac-vis-badge--article     { --badge-bg: #fef3c7; --badge-fg: #92400e; --badge-border: #fde68a; }
.iwac-vis-badge--publication { --badge-bg: #dbeafe; --badge-fg: #1e40af; --badge-border: #bfdbfe; }
.iwac-vis-badge--document    { --badge-bg: #ede9fe; --badge-fg: #5b21b6; --badge-border: #ddd6fe; }
.iwac-vis-badge--audiovisual { --badge-bg: #fce7f3; --badge-fg: #9d174d; --badge-border: #fbcfe8; }
.iwac-vis-badge--reference   { --badge-bg: #d1fae5; --badge-fg: #065f46; --badge-border: #a7f3d0; }

body[data-theme="dark"] .iwac-vis-badge--article     { --badge-bg: #78350f; --badge-fg: #fef3c7; --badge-border: #92400e; }
body[data-theme="dark"] .iwac-vis-badge--publication { --badge-bg: #1e3a8a; --badge-fg: #dbeafe; --badge-border: #1e40af; }
body[data-theme="dark"] .iwac-vis-badge--document    { --badge-bg: #4c1d95; --badge-fg: #ede9fe; --badge-border: #5b21b6; }
body[data-theme="dark"] .iwac-vis-badge--audiovisual { --badge-bg: #831843; --badge-fg: #fce7f3; --badge-border: #9d174d; }
body[data-theme="dark"] .iwac-vis-badge--reference   { --badge-bg: #064e3b; --badge-fg: #d1fae5; --badge-border: #065f46; }
```

- [ ] **Step 2: Add mobile spacing tightening**

Add after the overview-grid mobile breakpoint from Task 9:

```css
@media (max-width: 640px) { /* sm — mobile spacing */
    .iwac-vis-panel {
        padding: var(--space-3, 0.75rem);
    }
    .iwac-vis-block .dashboard-charts,
    .iwac-vis-overview-grid {
        gap: var(--space-3, 0.75rem);
    }
    .iwac-vis-summary-card {
        padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
    }
    .iwac-vis-summary-card__value {
        font-size: clamp(1.25rem, 1rem + 1vw, 1.75rem);
    }
}
```

- [ ] **Step 3: Unify recent additions breakpoints (lines 638-684)**

Replace the two media queries:

```css
/* Tablet: reduce padding, shrink thumbnail, hide source column */
@media (max-width: 768px) { /* md */
    .iwac-vis-recent-additions .iwac-vis-table {
        font-size: var(--text-xs, 0.85rem);
    }
    .iwac-vis-recent-additions .iwac-vis-table__header,
    .iwac-vis-recent-additions .iwac-vis-table__cell {
        padding: 0.6rem 0.75rem;
    }
    .iwac-vis-recent-additions .iwac-vis-table__cell--thumbnail {
        width: 60px;
        padding: 0.5rem 0.25rem 0.5rem 0.75rem;
    }
    .iwac-vis-recent-additions .iwac-vis-table__thumb,
    .iwac-vis-recent-additions .iwac-vis-thumb-placeholder {
        width: 48px;
        height: 48px;
    }
    .iwac-vis-recent-additions .iwac-vis-table th:nth-child(3),
    .iwac-vis-recent-additions .iwac-vis-table td:nth-child(3) {
        display: none;
    }
}

/* Mobile: also hide the Added date column so only thumb + title remain */
@media (max-width: 640px) { /* sm */
    .iwac-vis-recent-additions .iwac-vis-table__header,
    .iwac-vis-recent-additions .iwac-vis-table__cell {
        padding: 0.5rem 0.6rem;
    }
    .iwac-vis-recent-additions .iwac-vis-table__cell--thumbnail {
        width: 52px;
        padding: 0.4rem 0.2rem 0.4rem 0.6rem;
    }
    .iwac-vis-recent-additions .iwac-vis-table__thumb,
    .iwac-vis-recent-additions .iwac-vis-thumb-placeholder {
        width: 40px;
        height: 40px;
    }
    .iwac-vis-recent-additions .iwac-vis-table th:nth-child(4),
    .iwac-vis-recent-additions .iwac-vis-table td:nth-child(4) {
        display: none;
    }
    .iwac-vis-recent-additions .iwac-vis-table__link {
        -webkit-line-clamp: 3;
    }
}
```

- [ ] **Step 4: Unify person header breakpoint (line 907)**

Replace `max-width: 640px` — already at sm, no change needed.

- [ ] **Step 5: Commit**

```bash
git add asset/css/iwac-visualizations.css
git commit -m "refactor: badge CSS variables, mobile spacing, unified recent-additions breakpoints"
```

---

### Task 11: Register `responsive.js` in load order + delete `knowledge-graph.js`

**Files:**
- Modify: `view/common/block-layout/collection-overview.phtml`
- Modify: `view/common/block-layout/references-overview.phtml`
- Modify: `view/common/resource-page-block-layout/person-dashboard.phtml`
- Delete: `asset/js/knowledge-graph.js`

- [ ] **Step 1: Add responsive.js to collection-overview.phtml (after panels.js, before chart-options.js)**

In `collection-overview.phtml`, after line 39 (`panels.js`), add:

```php
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/responsive.js', 'IwacVisualizations'));
```

- [ ] **Step 2: Add responsive.js to references-overview.phtml**

In `references-overview.phtml`, after line 30 (`panels.js`), add:

```php
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/responsive.js', 'IwacVisualizations'));
```

- [ ] **Step 3: Add responsive.js to person-dashboard.phtml**

In `person-dashboard.phtml`, after line 21 (`panels.js`), add:

```php
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/responsive.js', 'IwacVisualizations'));
```

- [ ] **Step 4: Delete knowledge-graph.js**

```bash
rm asset/js/knowledge-graph.js
```

- [ ] **Step 5: Verify all templates reference responsive.js correctly**

Run: `grep -l 'responsive.js' view/`
Expected: 3 files listed (collection-overview.phtml, references-overview.phtml, person-dashboard.phtml)

- [ ] **Step 6: Commit**

```bash
git add view/common/block-layout/collection-overview.phtml \
        view/common/block-layout/references-overview.phtml \
        view/common/resource-page-block-layout/person-dashboard.phtml
git rm asset/js/knowledge-graph.js
git commit -m "feat: register responsive.js in templates, delete knowledge-graph.js"
```

---

### Task 12: Final syntax check + integration verification

**Files:** (read-only verification)

- [ ] **Step 1: Syntax-check all modified JS files**

```bash
node --check asset/js/charts/shared/responsive.js && \
node --check asset/js/charts/shared/chart-options.js && \
node --check asset/js/dashboard-core.js && \
echo "All JS files parse OK"
```

Expected: `All JS files parse OK`

- [ ] **Step 2: Verify no orphaned references to knowledge-graph.js**

```bash
grep -r 'knowledge-graph.js' asset/ view/ config/ Module.php || echo "No references found"
```

Expected: `No references found`

- [ ] **Step 3: Verify responsive.js is in all templates that load chart-options.js**

```bash
for f in $(grep -rl 'chart-options.js' view/); do
    echo "=== $f ==="
    grep -c 'responsive.js' "$f"
done
```

Expected: Each file prints `1`

- [ ] **Step 4: Verify no remaining old breakpoints in CSS**

```bash
grep -n '600px\|800px\|900px\|560px' asset/css/iwac-visualizations.css || echo "All old breakpoints removed"
```

Expected: `All old breakpoints removed`

- [ ] **Step 5: Verify badge CSS uses variables**

```bash
grep -c 'badge-bg\|badge-fg\|badge-border' asset/css/iwac-visualizations.css
```

Expected: A count > 15 (vars used in base class + each badge type + dark mode)

- [ ] **Step 6: Commit (only if any fixes were needed)**

```bash
# If any fixes were applied:
git add -A
git commit -m "fix: address integration issues from final verification"
```
