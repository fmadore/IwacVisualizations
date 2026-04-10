# Collection Overview Expansion — Design

**Date:** 2026-04-10
**Block:** `CollectionOverview` (site-wide page block)
**Status:** Design approved in brainstorming, pending user spec review before plan

## 1. Goals

Extend the Collection Overview block with:

1. Refreshed summary cards (total words, pages, unique sources, doc types, AV minutes, references; rename Entities → Index; drop misleading Publications card).
2. Reusable "recent additions" table component (thumbnail · title · source · type · added_date) with client-side pagination.
3. Fix the treemap runtime crash (`Cannot set properties of undefined (setting '2')`).
4. Faceted language pie (Global / By type / By country).
5. Newspaper coverage **Gantt chart** (periods, not counts), filterable by country and type.
6. Collection growth bar chart (monthly additions + cumulative, using `added_date`).
7. Items-by-type-over-time stacked bar, faceted by country.
8. Entities chart revamp: pagination, more entities per type, label truncation.
9. French word cloud with Global / By country / By year facets.
10. MapLibre world map with bubbles (choropleth noted as follow-up).

All changes stay **modular**, reuse existing `IWACVis.panels` / `IWACVis.chartOptions` / `IWACVis.registerChart` infrastructure, and mirror patterns from the sister project `iwac-dashboard`.

## 2. Architectural approach (C — Hybrid extraction)

- Keep `asset/js/charts/collection-overview.js` as a **thin orchestrator**: fetch data, compose layout, delegate to per-panel modules.
- **Extract new/complex panels** into `asset/js/charts/collection-overview/*.js`:
  - `recent-additions.js`, `languages.js` (rewritten with facets), `gantt.js`, `growth.js`, `types-over-time.js`, `entities.js` (rewritten with pagination+truncation), `wordcloud.js`, `map.js`.
  - Each panel attaches to `IWACVis.collectionOverview.<name>` and exposes a `render(panel, data, ctx)` function.
- **Add shared primitives** in `asset/js/charts/shared/`:
  - `table.js` — `P.buildTable(config)`
  - `facet-buttons.js` — `P.buildFacetButtons(config)`
  - `pagination.js` — `P.buildPagination(config)`
- **Extend `chart-options.js`** with new builders: `C.gantt`, `C.wordcloud`, `C.growthBar`, `C.stackedBar`.
- **Simple existing panels** (stacked timeline, country bar, treemap) stay inline in the orchestrator — only touched for the treemap fix and the dropped Publications card.

## 3. Data layer

### 3.1 File layout

```
asset/data/
├── collection-overview.json         (existing — extended)
├── collection-wordcloud.json        (sidecar, lazy-loaded when word-cloud panel enters view)
├── collection-map.json              (sidecar, lazy-loaded when map panel enters view)
└── world_countries_simple.geojson   (static asset copied from iwac-dashboard)
```

Sidecars are fetched lazily via `IntersectionObserver` so initial page load stays fast.

### 3.2 Python generators

- `scripts/generate_collection_overview.py` — **extended** to compute the new aggregates (see 3.3).
- `scripts/generate_wordcloud.py` — **new**, ported from `iwac-dashboard/scripts/generate_wordcloud.py`; emits unified JSON with 3 facets.
- `scripts/generate_world_map.py` — **new**, ported from `iwac-dashboard/scripts/generate_world_map.py`; emits unified JSON with locations + country counts + type facets.
- All three reuse `scripts/iwac_utils.py` (already present from a prior commit).
- Scripts are idempotent, run manually when the HF dataset updates (~monthly).

### 3.3 Extended `collection-overview.json` schema

```json
{
  "summary": {
    "articles": 12287,
    "index_entries": 4697,
    "total_words": 8921345,
    "total_pages": 52318,
    "scanned_pages": 52318,
    "unique_sources": 38,
    "document_types": 12,
    "audiovisual_minutes": 1247,
    "references_count": 864,
    "countries": 6,
    "languages": 4,
    "year_min": 1960,
    "year_max": 2025
  },
  "timeline": { "years": [...], "countries": [...], "series": {...} },
  "growth": {
    "months": ["2020-01", ...],
    "monthly_additions": [...],
    "cumulative_total": [...]
  },
  "types_over_time": {
    "years": [...],
    "types": ["article", "publication", "document", "audiovisual", "reference"],
    "series_global": { "article": [...], ... },
    "series_by_country": { "Burkina Faso": { "article": [...], ... }, ... }
  },
  "countries": [...],
  "languages": {
    "global":     [{"name": "French", "count": 11234}, ...],
    "by_type":    { "article": [...], "publication": [...], ... },
    "by_country": { "Burkina Faso": [...], ... }
  },
  "newspapers": {
    "coverage": [
      { "name": "Sidwaya", "country": "Burkina Faso", "type": "article",
        "year_min": 1984, "year_max": 2025, "total": 3421 },
      ...
    ]
  },
  "top_entities": {
    "Personnes": [{...}, ... up to 50],
    "Organisations": [..., 50],
    "Lieux": [..., 50],
    "Sujets": [..., 50],
    "Événements": [..., 50]
  },
  "treemap": { "name": "Collection", "children": [...] },
  "recent_additions": [
    { "o_id": 2231, "title": "...", "source": "Sidwaya", "type": "article",
      "added_date": "2025-03-12", "thumbnail": "https://..." },
    ...                          // up to 100 items → 5 pages × 20
  ]
}
```

**Data sources for each aggregate:**

| Field | Source columns | Subsets |
|---|---|---|
| `total_words` | `nb_mots` | articles |
| `total_pages` | `nb_pages` or derived from OCR page breaks | publications, documents (TBD: confirm column name during impl) |
| `scanned_pages` | same, filtered on OCR presence | same (drop if column unavailable) |
| `unique_sources` | `nunique(source)` | articles + audiovisual + publications (references excluded) |
| `document_types` | `nunique(o:resource_class)` | articles + publications + documents + audiovisual |
| `audiovisual_minutes` | sum `duration` | audiovisual |
| `references_count` | row count | references |
| `growth.*` | `added_date` | **all content subsets**: articles, publications, documents, audiovisual, references (index subset excluded — authority records are not "additions") |
| `types_over_time.*` | `pub_date` + subset label | all content subsets |
| `languages.global/by_type/by_country` | `language` (pipe-split), `country`, subset | all content subsets |
| `newspapers.coverage` | `dcterms:publisher`, `country`, `pub_date` min/max, subset | articles + publications |
| `recent_additions` | `added_date` desc, top 100 | articles + publications + documents + audiovisual + references (no index) |

### 3.4 `collection-wordcloud.json` schema

```json
{
  "global":     { "data": [["islam", 2341], ...], "total_articles": 11234, "unique_words": 8500 },
  "by_country": { "Burkina Faso": { "data": [...], "total_articles": ... }, ... },
  "by_year":    { "1980": { "data": [...], "total_articles": ... }, ... },
  "metadata": {
    "generated_at": "2026-04-10T...",
    "language_filter": "French",
    "min_word_length": 4,
    "min_frequency": 5,
    "max_words_per_facet": 150,
    "stopwords_applied": "fr-nltk+custom",
    "countries": [...],
    "years": [...]
  }
}
```

### 3.5 `collection-map.json` schema

```json
{
  "locations": [
    { "name": "Ouagadougou", "country": "Burkina Faso", "lat": 12.37, "lng": -1.52, "count": 1234 },
    ...
  ],
  "country_counts": {
    "Burkina Faso": { "total": 4321, "by_type": { "article": 3200, "publication": 900, ... } },
    ...
  },
  "metadata": {
    "generated_at": "2026-04-10T...",
    "source": "index subset where Type == 'Lieux', filtered to valid coordinates"
  }
}
```

## 4. Shared primitives (new, in `asset/js/charts/shared/`)

### 4.1 `table.js` — `P.buildTable(config)`

Minimal accessible HTML table, themable, zero external deps.

```js
P.buildTable({
  columns: [
    { key: 'thumbnail',  label: '',      render: 'thumbnail', width: '56px' },
    { key: 'title',      label: P.t('Title'),  render: 'link', linkKey: 'url' },
    { key: 'source',     label: P.t('Source') },
    { key: 'type',       label: P.t('Type'),   render: 'badge', i18nPrefix: 'item_type_' },
    { key: 'added_date', label: P.t('Added'),  render: 'date' }
  ],
  rows: [...],
  pageSize: 20,
  currentPage: 0,
  onPageChange: function (newPage) { ... },
  emptyMessage: P.t('No data available'),
  className: 'iwac-vis-table--recent'
});
// → { root: HTMLElement, update: fn(newRows, newPage) }
```

**Supported render modes:**
- `text` (default) — raw, escaped
- `link` — `<a href={row[linkKey]}>{value}</a>`
- `date` — ISO parse + `toLocaleDateString(IWACVis.locale)`
- `badge` — pill with i18n lookup (`{i18nPrefix}{value}`)
- `thumbnail` — lazy `<img>` with placeholder fallback when value absent
- `number` — `P.formatNumber()`

**Pagination integration:** when `pageSize` is set, table uses `P.buildPagination` internally and exposes `update(rows, page)` for in-place re-render.

**CSS:** new classes in `asset/css/iwac-visualizations.css`:
`.iwac-vis-table`, `.iwac-vis-table th/td`, `.iwac-vis-table__thumb`,
`.iwac-vis-thumb-placeholder`, `.iwac-vis-badge`, `.iwac-vis-badge--article/publication/document/audiovisual/reference`.

### 4.2 `facet-buttons.js` — `P.buildFacetButtons(config)`

Generic facet switcher, supports optional sub-facet (second dimension).

```js
P.buildFacetButtons({
  facets: [
    { key: 'global', label: P.t('Global') },
    { key: 'by_type', label: P.t('By type'),
      subFacets: { article: P.t('item_type_article'), ... } },
    { key: 'by_country', label: P.t('By country'),
      subFacets: { 'Burkina Faso': 'Burkina Faso', ... } }
  ],
  activeKey: 'global',
  onChange: function (evt) { /* evt = { facet, subFacet? } */ }
});
// → { root, setActive }
```

**Sub-facet rendering rule:** default is "≤ 5 keys → sub-buttons; > 5 → `<select>`". Each panel can override with an explicit `renderAs: 'buttons' | 'select'` in the facet config. For countries (6 total) the design uses **select** consistently; for the 5 content types, **buttons**.

**Behaviour:** when a facet with sub-facets becomes active, the first sub-facet is auto-selected and `onChange` fires immediately so the chart updates without extra clicks.

### 4.3 `pagination.js` — `P.buildPagination(config)`

Simple "‹ Prev | Page N / M | Next ›" control.

```js
P.buildPagination({
  currentPage: 0,
  totalPages: 5,
  onChange: function (newPage) { ... },
  labels: { prev: P.t('Previous'), next: P.t('Next'), page: P.t('Page') }
});
// → { root, update: fn({ currentPage, totalPages }) }
```

Prev/Next disabled at extremes. Accessible (keyboard, `aria-label`, `aria-current="page"` on the current page indicator).

### 4.4 Extensions to `chart-options.js`

- **`C.gantt(entries, opts)`** — ECharts `custom` series with `renderItem` drawing horizontal bars on a time-year axis. Each entry: `{ name, country, type, year_min, year_max, total }`. Filtering by country/type is done **before** calling the builder. Bar colors follow the active theme palette keyed by `country`. Optional `opts.onClick(entry)` for filtering-by-newspaper drill-downs (not wired in v1).
- **`C.wordcloud(entries, opts)`** — uses the `wordCloud` series type from the `echarts-wordcloud@2` extension (already loaded via CDN in `Module.php`). Graceful fallback to `C.horizontalBar` if the extension is unavailable. Size min/max, rotation `[-30, 30]`, tooltip with freq + percentage.
- **`C.growthBar(growth, opts)`** — dual-axis chart: bar (`monthly_additions`, left) + line (`cumulative_total`, right). DataZoom slider when `months.length > 24`.
- **`C.stackedBar(data, opts)`** — generic stacked bar (not necessarily temporal). Different from `C.timeline` which is specialized for year × country. Accepts `{ categories, stackKeys, series }` + `opts.labelFor(key)` for i18n. Reused by the types-over-time panel and potentially others.

Existing builders (`timeline`, `horizontalBar`, `pie`, `newspaper`, `entities`, `treemap`) **unchanged** except `C.entities` gains an `opts.maxLabelLength` parameter for middle-ellipsis truncation (default 30), and `C.treemap` is hardened against the runtime crash (see 5.3).

## 5. Panels

### 5.1 Summary cards (refreshed)

New card list in order: **Articles · Index · Total words · Total pages · Scanned pages · Unique sources · Document types · Audiovisual minutes · References · Countries · Languages**. Drop the confusing Publications card. `P.buildSummaryCards` API unchanged — just a new array. The CSS grid auto-fit handles 11 cards (4 cols desktop, 2 tablet, 1 mobile).

**New i18n keys** (EN + FR) in `iwac-i18n.js`:
`Index`, `Total words`, `Total pages`, `Scanned pages`, `Unique sources`, `Document types`, `Audiovisual minutes`, `References`, `Title`, `Source`, `Type`, `Added`, `No recent additions`, `Global`, `By type`, `By country`, `By year`, `Previous`, `Next`, `Page`, `All countries`, `All types`, `Monthly additions`, `Cumulative total`, `Monthly`, `Cumulative`, `Collection growth over time`, `Items by type, over time`, `Recent additions`, `Word cloud`, `Map`, plus `item_type_article`, `item_type_publication`, `item_type_document`, `item_type_audiovisual`, `item_type_reference`.

**TBD during impl:** `nb_pages` column availability in HF. If missing, drop the two page-related cards and fall back to a single "Words" card.

### 5.2 Recent additions table (new, wide)

Placement: after the summary cards + period subtitle, before the charts grid.

Module: `asset/js/charts/collection-overview/recent-additions.js`. Reads `data.recent_additions`, enriches each row with `url = siteBase + '/item/' + o_id` (uses the Omeka site slug, which is already locale-correct — `afrique_ouest` / `westafrica`), and passes to `P.buildTable` with pagination `pageSize: 20`. Fallback message from `P.t('No recent additions')` when empty. Thumbnail placeholder when value absent.

### 5.3 Treemap fix

**Root cause hypothesis:** ECharts 6 crashes in `di()` (internal layout) when `levels[]` is shorter than the actual tree depth, when non-leaf nodes carry `children: []`, or when parents are missing `value`. The current `C.treemap` hardcodes a 3-level `levels[]` array.

**Fix strategy** (implemented in `C.treemap`):

1. **Sanitize tree recursively** before passing to ECharts:
   - If a node has `children: []` (empty), demote it to a leaf (delete `children`).
   - If a parent is missing `value`, compute it as the sum of descendant leaves.
   - Prune nodes whose total value is 0.
   - Track max depth encountered.
2. **Generate `levels[]` dynamically** based on max depth (helper `buildTreemapLevels(depth)` repeats styling per level).
3. **Fallback if the crash persists**: set `leafDepth: 1` so only the top level renders, with `nodeClick: 'zoomToNode'` for drill-down. Safe worst-case.
4. **Temporary debug log** `console.debug('IWACVis treemap tree', tree)` during dev to capture live structure if the bug recurs.

No Python-side change — client-side sanitization is more robust against future data.

### 5.4 Entities revamp

**Data**: top_n raised from 10 → **50** per type in the Python generator.

**Module**: `asset/js/charts/collection-overview/entities.js` — handles entity type tabs + per-tab pagination (10 per page × 5 pages). Tab switch resets pagination to page 0. Uses `P.buildPagination` below the chart.

**Label truncation**: `C.entities` gains `opts.maxLabelLength` (default 30). `yAxis.axisLabel.formatter` applies middle ellipsis (`"Longinteresting…ng title"`). Full title preserved in tooltip.

**Click-through** unchanged: barre click → `siteBase + '/item/' + o_id`.

### 5.5 Languages with facets

Module: `asset/js/charts/collection-overview/languages.js`. State machine `{ facet, subFacet }`, default `{ facet: 'global', subFacet: null }`. `P.buildFacetButtons` rendered inside the panel above the chart. On facet change, `chart.setOption(C.pie(currentEntries()), true)` re-renders in place (no dispose). Chart instance stays registered in the theme-change lifecycle.

### 5.6 Newspaper coverage Gantt

Module: `asset/js/charts/collection-overview/gantt.js`. Reads `data.newspapers.coverage`.

**Facets** (via `P.buildFacetButtons`):
- Country: `All countries` + per-country — rendered as `<select>` (7 options including "All") per the 4.2 rule.
- Type: `All types | Articles | Publications` — 3 buttons.

The two facets are **independent**: selecting Burkina Faso + Articles filters rows where both match. Default `{ country: 'all', type: 'all' }` returns the full list. Internal state object, with `onChange` from each facet bar merging into a single re-render.

**Chart**: `C.gantt(filteredEntries)`. The gantt is built with ECharts `custom` series. Y axis = newspaper names (category), X axis = years (value or time). `renderItem` draws a rect from `year_min` to `year_max` on each row, colored by country. Tooltip: `{name} ({country})` · `{year_min}–{year_max}` · `{total}` articles/publications.

**Layout** replaces the current "Newspaper coverage" bar chart. The existing `C.newspaper` builder is left in place for `ReferencesOverview` (which still uses it) — no regression there.

**Note on existing `dashboard-charts-gantt.js`**: it's in the legacy `RV.*` namespace (used by the standalone iwac-dashboard HTML, not this block). We do **not** reuse it directly; we write a fresh `C.gantt` option builder in the `IWACVis` namespace. The old file can be consulted for ECharts `renderItem` reference but not imported.

### 5.7 Collection growth over time

Module: `asset/js/charts/collection-overview/growth.js`. Reads `data.growth`. Single call to `C.growthBar` — no facets in v1. Panel width = `--wide`. Placed after "Items per year, by country".

### 5.8 Items by type, over time (with country facet)

Module: `asset/js/charts/collection-overview/types-over-time.js`. Reads `data.types_over_time`. Country facet rendered as `<select>` (7 options: "All countries" + 6). Chart: `C.stackedBar` with `labelFor: k => P.t('item_type_' + k)`. Placed directly **below** the existing "Items per year, by country" panel so the two temporal charts form a pair.

### 5.9 French word cloud

Module: `asset/js/charts/collection-overview/wordcloud.js`. **Lazy-loaded**: on controller init, registers an `IntersectionObserver` on the word cloud panel; when it enters the viewport (even partially), fetches `collection-wordcloud.json`, then renders.

**Facets** (`P.buildFacetButtons`):
- `Global` (no sub-facet)
- `By country` → dropdown (6 options)
- `By year` → dropdown (many years → select auto, per 4.2 rule)

**Chart**: `C.wordcloud(data[facet][subFacet].data)`. Below the chart, a small metadata line: `"{total_articles} articles · {unique_words} mots uniques"`.

**Stopwords and tokenization**: handled server-side in `generate_wordcloud.py` (min_word_length: 4, min_frequency: 5, French NLTK + custom stopword list). The browser never tokenizes.

**Echarts-wordcloud availability**: `C.wordcloud` feature-detects the `wordCloud` series type at call time by briefly rendering an ephemeral chart into a throwaway `<div>` (matches the pattern already in the legacy `dashboard-charts-wordcloud.js`). Falls back to `C.horizontalBar` if unavailable, with a single `console.warn` for diagnostics.

### 5.10 MapLibre world map (bubbles; choropleth as follow-up)

Module: `asset/js/charts/collection-overview/map.js`. **Lazy-loaded** via `IntersectionObserver` like the word cloud.

**Stack**: MapLibre GL (already loaded via CDN in `Module.php`), no ECharts here. The map instance is registered via `IWACVis.registerMap(mapInstance, containerEl)` so it participates in theme-change basemap swaps.

**Data**: `collection-map.json` (locations + country_counts + by_type).

**Layers**:
- `CircleLayer` with radius scaled by `count` (log-ish scale) and color from theme palette. Popup on click showing `{name}` + `{country}` + `{count}`.
- Country GeoJSON (`world_countries_simple.geojson`) loaded but **hidden by default** in v1 — left in the sources so adding the choropleth layer later is a few lines, no data regeneration.

**Facets** (v1): `All types | Articles | Publications | Documents | Audiovisual | References` via `P.buildFacetButtons`. Switching refilters both circles and country counts without remounting the map.

**Follow-up (not v1)**: choropleth overlay on the GeoJSON country polygons driven by `country_counts[country].total` with a sequential color scale. Documented here so the implementer knows the data is already plumbed.

### 5.11 Final layout order

```
┌─ Summary cards (11 cards, grid)
├─ "Period covered: 1960 – 2025" subtitle
├─ Recent additions table (wide)
└─ Charts grid:
   ┌─ Items per year, by country          (wide, existing, stacked timeline)
   ├─ Items by type, over time            (wide, NEW, stacked, country facet)
   ├─ Collection growth over time         (wide, NEW, bar + cumulative line)
   ├─ Newspaper coverage (Gantt)          (wide, REWRITTEN, country + type facets)
   ├─ Content by country                  (standard width, existing)
   ├─ Languages represented               (standard, NEW facets)
   ├─ Most-cited entities                 (wide, REVAMPED: 50/type, pagination, truncation)
   ├─ Collection breakdown                (wide, existing — bug fixed)
   ├─ French word cloud                   (wide, NEW, lazy, 3 facets)
   └─ World map                           (wide, NEW, lazy, bubbles + type facet)
```

## 6. Integration, i18n, testing

### 6.1 `.phtml` template

`view/common/block-layout/collection-overview.phtml` gains new `<script>` tags (in load order, after the shared infrastructure):

```
shared/panels.js
shared/chart-options.js
shared/table.js                    (NEW)
shared/facet-buttons.js            (NEW)
shared/pagination.js               (NEW)
collection-overview/recent-additions.js
collection-overview/entities.js
collection-overview/languages.js
collection-overview/gantt.js
collection-overview/growth.js
collection-overview/types-over-time.js
collection-overview/wordcloud.js
collection-overview/map.js
collection-overview.js             (orchestrator — last)
```

Each panel module is a self-registering IIFE, so load order only matters to the extent that shared + chart-options must come before them, and the orchestrator last.

### 6.2 `Module.php` / CDN

No change — MapLibre GL, ECharts 6, and echarts-wordcloud 2 are already enqueued.

### 6.3 CSS

`asset/css/iwac-visualizations.css` extended with new classes for:
- table, badges, thumbnail placeholder
- facet buttons group (button + sub-select)
- pagination control

All styling via the existing CSS custom properties (`--surface`, `--ink`, `--border`, `--primary`, `--space-*`, `--text-*`, `--radius-*`). Both light and dark themes pick up automatically.

### 6.4 i18n

All new chart labels and UI strings added to `iwac-i18n.js` (EN + FR dictionaries). Omeka .po files untouched (only block label and form hints live there, and those are unchanged).

### 6.5 Testing / verification plan

Local verification before commit:

1. **Data generation**: run the three Python scripts, sanity-check the JSON outputs against the schemas in §3.
2. **Block render**: open a page that hosts the block in a local Omeka S instance (or the dev site), verify:
   - All 11 summary cards render.
   - Recent additions table paginates 5 pages of 20.
   - Treemap renders without the `Cannot set properties of undefined` error — test with `console.debug` on.
   - Language pie switches facets without flicker.
   - Gantt renders period bars, filters by country and type.
   - Growth chart shows both bar and line, zoom works when > 24 months.
   - Types-over-time stacks correctly, country buttons filter.
   - Entities: 5 pages per type, tab switch resets page, long labels truncated.
   - Word cloud lazy-loads, facets work, fallback triggers when extension missing.
   - Map lazy-loads, bubbles sized, popups show, type facet filters.
3. **Theme switch**: toggle light/dark mid-session, all charts re-init correctly (ECharts via `registerChart`, MapLibre via `registerMap`).
4. **Locale switch**: open the block on the French site and the English site, verify all strings + item URLs use the right slug.
5. **Empty data**: simulate an empty JSON for each panel, verify "No data available" fallbacks.

No automated tests in this module historically — manual verification is the standard. Document manual QA steps in the PR.

## 7. Out of scope (explicit)

- Choropleth layer on the map (data plumbed, layer implementation deferred).
- Word cloud for languages other than French.
- Gantt click-through to filter on a single newspaper.
- Automated unit tests.
- Server-side caching / on-demand regeneration of the JSON files.
- Changes to `ReferencesOverview` (left untouched; still uses `C.newspaper` and current `P` / `C` APIs).

## 8. Risks and open questions

| # | Risk / question | Mitigation |
|---|---|---|
| 1 | `nb_pages` column may not exist on HF | Drop "Total pages" and "Scanned pages" cards if so; flagged during impl |
| 2 | Treemap fix may not resolve the crash if root cause is different | Fallback plan: `leafDepth: 1` mode |
| 3 | `echarts-wordcloud` extension may fail to load from CDN | Fallback to `C.horizontalBar` with warning |
| 4 | `collection-wordcloud.json` size could exceed ~500 KB with all facets | Cap `max_words_per_facet` at 150; drop by-year facets below a minimum article count |
| 5 | MapLibre choropleth needs the GeoJSON, which is ~1 MB | Load only when user toggles the (future) choropleth button; keep sidecar lean |
| 6 | Many new i18n keys → easy to miss a translation | Add all EN/FR keys in a single commit; grep for `P.t(` in new files to audit |
| 7 | Ordering of 11 summary cards on narrow viewports | `grid-auto-flow: dense` + test on mobile |
