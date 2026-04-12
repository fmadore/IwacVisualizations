# ECharts Responsive, Visual & Refactoring Overhaul

**Date:** 2026-04-12
**Status:** Draft
**Scope:** All active ECharts chart builders, CSS, dashboard-core, shared modules

## Goal

Improve the IWAC Visualizations module across three axes:

1. **Responsiveness** — Charts adapt their internal layout (legend, grid, labels, dataZoom) to container width. Decent mobile/tablet experience while keeping desktop-first priority.
2. **Visual polish** — Rounded bars, better hover effects, consistent spacing, theme-token-driven colors everywhere.
3. **Refactoring** — Eliminate code duplication, extract shared helpers, unify breakpoints, enforce CSS variable usage.

## Non-Goals

- No changes to the chart registration API (`registerChart`, `initChart`, `registerMap`).
- No changes to data formats or Python precompute scripts.
- No changes to legacy `dashboard-*.js` files (kept as reference).
- No new chart types or dashboard blocks.

---

## 1. New Shared Module: `responsive.js`

**File:** `asset/js/charts/shared/responsive.js`
**Load order:** After `panels.js`, before `chart-options.js`

### 1.1 Breakpoint Constants

```js
ns.BP = { sm: 640, md: 768, lg: 1024 };
```

These are the single source of truth for breakpoints across JS. CSS uses matching literal values with comments (CSS custom properties cannot be used in `@media` queries per spec).

### 1.2 Container Width Helper

```js
ns.containerWidth = function (el) { ... }
```

Returns the current pixel width of a chart's nearest sized ancestor. Used by builders that need imperative width checks beyond what ECharts `media` rules provide.

### 1.3 Reusable ECharts Media Presets

Functions that return `media: [...]` rule arrays for common responsive patterns:

| Preset | What it does | Breakpoint |
|--------|-------------|------------|
| `R.legendMedia()` | Legend switches from right/vertical to bottom/horizontal | < sm (640px) |
| `R.gridMedia()` | Grid padding tightens (e.g., left: 48 -> 24, top: 48 -> 32) | < sm |
| `R.labelMedia(opts)` | Axis label width shrinks, fontSize decreases, rotation added | < sm, < md |
| `R.dataZoomMedia()` | DataZoom slider height shrinks from 18px to 14px | < sm |

Each returns an array of `{ query: { maxWidth: N }, option: {...} }` objects. Builders merge these into their returned option object.

### 1.4 Merge Utility

```js
R.withMedia = function (baseOption /*, mediaArray1, mediaArray2, ... */) { ... }
```

Takes a base ECharts option and one or more media preset arrays (via `arguments`), returns the combined option with a `media` key containing the merged rules plus a default (no-query) entry for the baseOption. Uses `arguments` rather than rest parameters since the project is vanilla ES5-compatible JS with no bundler.

---

## 2. Chart Option Builders Refactoring: `chart-options.js`

### 2.1 Extracted Shared Defaults

| Helper | Replaces | Notes |
|--------|----------|-------|
| `C._grid(overrides)` | Hardcoded grid objects in every builder | Default: `{ left: 48, right: 24, top: 48, bottom: 32, containLabel: true }` |
| `C._dataZoom(count, opts)` | Duplicated dataZoom in timeline, stackedBar, growthBar, gantt | Threshold configurable (default 20), returns `[]` below threshold |
| `C._truncate(str, maxLen)` | Duplicated in entities + network | Middle-ellipsis truncation |
| `C._barDefaults()` | Repeated barMaxWidth/emphasis/blur in 5+ builders | Returns `{ barMaxWidth: 24, emphasis: {...}, blur: {...} }` |

### 2.2 ECharts Media Rules per Builder

Every builder that returns an option object includes `media` rules via `R.withMedia()`:

**`C.pie()`:**
- Default: legend right/vertical, center `['38%', '50%']`, radius `['40%', '68%']`
- < 640px: legend bottom/horizontal, center `['50%', '45%']`, radius `['30%', '58%']`

**`C.timeline()` / `C.stackedBar()`:**
- Default: grid left 48, legend top with scroll
- < 640px: grid left 24, right 8, legend fontSize smaller

**`C.horizontalBar()` / `C.entities()` / `C.newspaper()`:**
- Default: yAxis label width 220px (entities) / auto
- < 640px: label width 120px, label fontSize 11, grid left reduced

**`C.gantt()`:**
- Default: yAxis label width 160px
- < 640px: label width 100px, grid tightened
- < 768px: label width 130px

**`C.growthBar()`:**
- Default: dual y-axis with padding
- < 640px: grid tightened, legend itemWidth smaller

**`C.network()`:**
- Default: full labels, repulsion 180
- < 640px: shorter label truncation (16 chars), repulsion 120

**`C.wordcloud()`:**
- Default: current size ranges
- < 640px: maxFont reduced by ~20%, minFont stays

**`C.treemap()`:**
- Minimal media changes (treemaps adapt well naturally), just tighten breadcrumb fontSize

### 2.3 Hardcoded Colors Replaced with Theme Tokens

| Location | Current | After |
|----------|---------|-------|
| `C.gantt` palette array | Hardcoded 10 hex colors | `ns.getPalette()` |
| `C.gantt` bar stroke | `'#00000022'` | Token-derived: `color-mix` or `rgba` from `tokens.border` |
| `C.treemap` borderColor | `'#fff'` | `tokens.surface` via `ns.getChartTokens()` |
| `C.treemap` levels gapWidth colors | Hardcoded | Theme-aware |
| `C.network` TYPE_COLORS fallback | Hardcoded 6 hex colors | `ns.getPalette()` (already partially done) |

### 2.4 Visual Polish

| Builder | Enhancement |
|---------|------------|
| All vertical bars (timeline, stackedBar, growthBar) | `itemStyle: { borderRadius: [2, 2, 0, 0] }` |
| All horizontal bars (horizontalBar, entities, newspaper, gantt) | `itemStyle: { borderRadius: [0, 2, 2, 0] }` |
| `C.pie` | `emphasis: { scale: true, scaleSize: 6 }` for pop-out hover |
| `C.network` | Node hover `scaleSize` increased, edge emphasis width 4 |
| `C.wordcloud` | Emphasis shadow intensity increased |
| All builders | `animationDuration: 600, animationEasing: 'cubicOut'` as defaults |

---

## 3. Shared Country Color Map

### 3.1 Stable Country-to-Color Mapping

New export: `C._countryColor(country)` (private helper on the `chartOptions` namespace)

Provides a deterministic, stable color for each IWAC country. The mapping uses slots from `ns.getPalette()` with a fixed assignment:

| Country | Palette Index |
|---------|--------------|
| Bénin | 0 (primary) |
| Burkina Faso | 1 |
| Côte d'Ivoire | 2 |
| Niger | 3 |
| Togo | 4 |
| Sénégal | 5 |
| (others) | Assigned from remaining slots |

The exact country list will be derived from the data at implementation time.

### 3.2 Usage

Replaces:
- `C.gantt`: inline `colorForCountry()` function and local `countryColorMap`
- `C.timeline`: implicit ECharts auto-assignment for country series — now explicit `itemStyle.color` per series using `C._countryColor()`
- Available for map panels to align if desired (MapLibre paint expressions can reference the same hex values)

---

## 4. CSS Refactoring: `iwac-visualizations.css`

### 4.1 Unified Breakpoints

All media queries use exactly three breakpoints:

```css
/* Breakpoints (cannot use var() in @media — values documented here):
   --bp-sm: 640px   (large phones)
   --bp-md: 768px   (tablets)
   --bp-lg: 1024px  (small laptops)
*/
```

**Consolidation mapping:**

| Current | New | Notes |
|---------|-----|-------|
| 560px | 640px (sm) | Recent additions mobile |
| 600px | 640px (sm) | Summary cards 3-col |
| 640px | 640px (sm) | Person header vertical |
| 768px | 768px (md) | Dashboard grid 2-col |
| 800px | 768px (md) | Overview grid 2-col |
| 900px | 1024px (lg) | Summary cards 6-col, recent additions tablet |

### 4.2 Badge Colors via CSS Variables

Each badge type defines `--badge-bg`, `--badge-fg`, `--badge-border` variables. The base `.iwac-vis-badge` class consumes them. Dark mode overrides just the variables, not every property:

```css
.iwac-vis-badge {
    background: var(--badge-bg);
    color: var(--badge-fg);
    border-color: var(--badge-border);
}

.iwac-vis-badge--article {
    --badge-bg: #fef3c7;
    --badge-fg: #92400e;
    --badge-border: #fde68a;
}

body[data-theme="dark"] .iwac-vis-badge--article {
    --badge-bg: #78350f;
    --badge-fg: #fef3c7;
    --badge-border: #92400e;
}
```

### 4.3 Responsive Chart Heights

| Selector | Current | After |
|----------|---------|-------|
| `.iwac-vis-chart` | `min-height: 320px` | `min-height: 320px` default, `280px` below `--bp-sm` |
| `.iwac-vis-panel--wordcloud .iwac-vis-chart` | `min-height: 520px` | `min-height: clamp(320px, 50vh, 520px)` |
| `.iwac-vis-map` | `height: 520px` | `height: clamp(320px, 60vh, 520px)` |
| `.iwac-vis-overview-grid .iwac-vis-chart` | `min-height: 280px` | `min-height: 280px` default, `240px` below `--bp-sm` |
| `.iwac-vis-overview-grid .iwac-vis-panel--wide .iwac-vis-chart` | `min-height: 360px` | `min-height: clamp(280px, 40vh, 360px)` |

### 4.4 Mobile Spacing Tightening (below 640px)

- Panel padding: `var(--space-4)` to `var(--space-3)`
- Grid gap: `var(--space-4)` to `var(--space-3)`
- Summary card padding: tightened
- Summary card value font-size: clamped smaller

### 4.5 Cleanup

- Remove `.knowledge-graph-*` CSS classes (dead styles for deleted `knowledge-graph.js`)
- Keep `.knowledge-graph-block`, `.knowledge-graph-container`, `.knowledge-graph-toolbar` removal in scope

---

## 5. `dashboard-core.js` Changes

### 5.1 ResizeObserver Integration

`ns.registerChart()` attaches a `ResizeObserver` to the chart's container element:

```js
var ro = new ResizeObserver(debounce(function () {
    entry.instance.resize({ animation: { duration: 200, easing: 'cubicOut' } });
}, 150));
ro.observe(el.parentElement || el);
entry._resizeObserver = ro;
```

- Tracked on each chart entry for cleanup on dispose
- `ns.pruneCharts()` disconnects observers for disposed charts
- Fallback: existing `window.resize` listener kept for browsers without ResizeObserver (IE11 edge case, but costs nothing to keep)

### 5.2 No API Changes

`registerChart(el, render)`, `registerMap(map, el)`, `initChart(el)` signatures remain identical. The ResizeObserver is an internal enhancement.

---

## 6. Cleanup

| Action | File |
|--------|------|
| Delete | `asset/js/knowledge-graph.js` |
| Delete CSS | `.knowledge-graph-block`, `.knowledge-graph-container`, `.knowledge-graph-toolbar`, `.iwac-vis-fullscreen` classes |
| Keep | All `dashboard-*.js` legacy files (future chart type reference) |

---

## Files Changed (Summary)

| File | Type of Change |
|------|---------------|
| `asset/js/charts/shared/responsive.js` | **New** — breakpoints, media presets, merge utility |
| `asset/js/charts/shared/chart-options.js` | **Major refactor** — extract shared defaults, add media rules, theme tokens, visual polish |
| `asset/js/dashboard-core.js` | **Minor** — add ResizeObserver, keep fallback |
| `asset/css/iwac-visualizations.css` | **Major refactor** — unify breakpoints, badge variables, responsive heights, cleanup |
| `asset/js/knowledge-graph.js` | **Delete** |
| `Module.php` | **Minor** — add `responsive.js` to load order, remove `knowledge-graph.js` |
| `asset/js/charts/collection-overview/gantt.js` | **Minor** — use `C._countryColor()` instead of local palette |
| `asset/js/charts/collection-overview/growth.js` | **Minor** — use `C._barDefaults()` |
| `asset/js/charts/collection-overview/entities.js` | **Minor** — use shared truncate, bar defaults |
| `asset/js/charts/collection-overview/languages.js` | **Minor** — pie media rules handled by builder |
| `asset/js/charts/collection-overview/types-over-time.js` | **Minor** — stacked bar uses shared defaults |
| `asset/js/charts/collection-overview/wordcloud.js` | **Minimal** — builder handles media |
| `asset/js/charts/collection-overview/map.js` | **Minimal** — country colors available |
| `asset/js/charts/person-dashboard/timeline.js` | **Minor** — builder handles media |
| `asset/js/charts/person-dashboard/newspapers.js` | **Minor** — builder handles media |
| `asset/js/charts/person-dashboard/countries.js` | **Minor** — builder handles media |
| `asset/js/charts/person-dashboard/network.js` | **Minor** — shared truncate, builder media |
| `asset/js/charts/references-overview.js` | **Minor** — uses shared defaults from builders |

## Risk Assessment

- **Low risk:** CSS changes, visual polish, cleanup — purely additive or cosmetic
- **Medium risk:** ECharts `media` rules — well-documented stable API, but need testing across all chart types at multiple widths
- **Medium risk:** ResizeObserver — straightforward, but edge cases around rapid dispose/reinit during theme changes need attention
- **Low risk:** Shared helper extraction — pure refactoring, no behavior change

## Testing Strategy

- Manual resize testing at 360px, 640px, 768px, 1024px, 1440px widths
- Verify all three active blocks: collection overview, references overview, person dashboard
- Light/dark theme toggle at each width
- Facet switching after resize to confirm re-render uses correct media rules
