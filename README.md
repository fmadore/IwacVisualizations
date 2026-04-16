# IWAC Visualizations

An [Omeka S](https://omeka.org/s/) module that adds interactive visualizations to the [Islam West Africa Collection (IWAC)](https://islam.zmo.de/) digital archive at ZMO. Charts are powered by [ECharts 6](https://echarts.apache.org/) and [MapLibre GL](https://maplibre.org/); the underlying data is either fetched live from the public Hugging Face dataset [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) or precomputed via Python scripts under `scripts/`.

The module targets the [IWAC theme](https://github.com/fmadore/IWAC-theme). It reads the theme's CSS custom properties at runtime so chart colors track the site's configured `--primary` / `--ink` / `--surface` tokens, it respects the light/dark toggle via a `MutationObserver` on `body[data-theme]`, and it follows the Internationalisation module's language switching (English / French).

## Status

Five page blocks and two resource-page block layouts are fully wired end-to-end with live data. Two placeholder blocks load the asset stack but have no orchestrator code yet.

| Block | Type | Status | Data path |
|---|---|---|---|
| Collection Overview | page block | **Live** — 13 panels | Precompute (`generate_collection_overview.py` + two sidecar generators) |
| Index Overview | page block | **Live** — 7 Section A panels + Keyword Explorer | Precompute (`generate_index_overview.py` + `generate_keyword_explorer.py`) |
| References Overview | page block | **Live** — 6 panels | Live fetch from HF datasets-server |
| Scary Terms | page block | **Live** — bar-chart race + country view + global view | Precompute (`generate_scary_terms.py`) |
| Visualizations / Person | resource-page block | **Live** — 11 panels | Precompute (`generate_person_dashboards.py`) |
| Visualizations / Entity (Lieux, Organisations, Sujets, Événements) | resource-page block | **Live** — reuses Person panels | Precompute (`generate_entity_dashboards.py`) |
| Visualizations / Article (bibo:Article, template 8) | resource-page block | **Live** — 5 panels incl. 3-layer context network + semantic neighbours | Precompute (`generate_article_dashboards.py`) |
| Compare Projects | page block | Placeholder (assets enqueued, no orchestrator) | — |
| Item Set Dashboard | resource-page block | Placeholder (assets enqueued, no orchestrator) | — |

Current version: see `config/module.ini` (`version = …`). This value drives the `?v=` query string Omeka appends to every asset URL, so bumping it is the canonical way to bust the browser cache after a source change.

### v0.9.0 — refactor pass

Major consolidation without behavior changes:

- **Shared asset-loader partial** (`view/common/iwac-assets.phtml`) replaces the 70-line `headLink`/`headScript` blocks that used to live in every template. Templates now declare *what* they need (maplibre, wordcloud, table, facet-buttons, panel list, orchestrator) and the partial handles the rest. CDN versions and load order live in one place.
- **`AbstractIwacBlockLayout`** base class collapses 5 near-identical `Site\BlockLayout` classes to ~15 lines each.
- **New JS helpers** in `asset/js/charts/shared/`: `P.buildFacetedChart()`, `P.buildCountFeatures()`, `P.buildLoadingState()` / `buildEmptyState()` / `buildErrorState()`, `P.formatDate()`, `P.attachFeatureStateHover()`. Migrated 8 panel modules to use them.
- **MapLibre `feature-state` hover** on every map: bubbles brighten and thicken their stroke on hover/tap via the modern GPU-driven pattern instead of JS cursor swapping. `generateId: true` on every GeoJSON source.
- **Python helpers** promoted into `iwac_utils.py`: `canonical_country`, `canonicalize_country_field`, `clean_str`, `clean_float`, `extract_month_num`, and an upgraded `parse_coordinates` that accepts tuples/lists and whitespace separators. 8 generators migrated, ~180 lines of dupe removed.
- **CLI consistency** across all 9 generators: `--repo`, `-v/--verbose`, and `--min-cooccurrence` (for the TF-IDF network threshold) are now standard.
- **CSS tokens**: `--iwac-vis-thumb-{lg,md,sm}`, `--iwac-vis-thumb-col-{lg,md,sm}`, `--iwac-vis-panel-toolbar-reserve`. Zero hardcoded colors remain in block CSS.
- **Security**: fixed one unescaped `$resource->id()` in `item-set-dashboard.phtml`; fixed a latent MapLibre listener-leak bug in `collection-overview/map.js` where theme swaps stacked duplicate layer-bound handlers.

## Features

### Collection Overview (page block)

A bird's-eye summary of the whole IWAC collection, designed to drop onto a site page. 13 panels total:

- **Summary row — 11 cards**: Articles, Index, Total words, Total pages, Scanned pages, Unique sources, Document types, Audiovisual minutes, References, Countries, Languages
- **Recent additions table** — thumbnail / title / source / type / date, client-paginated 20 per page
- **Growth** — monthly additions bar + cumulative line (dual axis)
- **Types over time** — stacked bar with country facet
- **Countries covered** — horizontal bar
- **Languages** — horizontal bar with global / by-type / by-country facets
- **Top entities** — tabbed bar (Persons / Orgs / Places / Subjects / Events), 50 per type with client pagination at 10/page; bars click through to the Omeka entity page
- **Gantt** — newspaper coverage periods (start → end) with country and type facets
- **Word cloud** — `echarts-wordcloud` with a horizontal-bar fallback; facets for global / by country / by year; lazy-loaded via `IntersectionObserver`
- **World map** — MapLibre bubbles from `index.Lieux` entries with a type facet; lazy-loaded; GeoJSON plumbed for future choropleth

### Index Overview (page block)

Two complementary sections bundled in one block.

**Section A — Entity Index Explorer** walks the IWAC authority index (~4,385 entities of type Personnes / Lieux / Organisations / Sujets / Événements):

- **Summary row** — total entities, per-type counts, total mentions, time span, places with coordinates
- **Entities by type** — donut chart
- **Most frequent entities in Dublin Core Subject and Spatial Coverage** — tabbed horizontal bar (5 tabs, paginated 10/page, 50/type), each bar clicks through to the Omeka entity page
- **Lifespan × frequency** — scatter of every entity with both a first and last occurrence; x = span years, y = total mentions, color by type; click → entity page
- **Places map** — MapLibre with two toggleable layers: **authority pins** (every place in the index with parseable coordinates, ~555 places) and **mention bubbles** (how often each place is tagged in an item's dct:spatial field, joined back to authorities by name, ~541 resolved). Click → place page via `siteBase + '/item/' + o_id`.
- **Temporal extent** — gantt of first→last year each entity appears (top 30 per type, type facet)
- **Index table** — searchable, type-faceted, paginated (25/page) table of every entity with frequency, year span, and countries; click → entity page

**Section B — Keyword Explorer** is a vanilla-JS port of [iwac-dashboard's `/keywords` route](https://github.com/fmadore/iwac-dashboard/tree/main/src/routes/keywords), generalized to scan every content subset (not just articles):

- Type tabs: **Subjects** (dcterms:subject) / **Spatial Coverage** (dcterms:spatial)
- Facet sidebar — Global / By country / By newspaper — the newspaper dropdown always lists only newspapers that have precomputed keyword series (no dead entries)
- View modes: **Top frequent** (3 / 5 / 10) and **Compare** (search + multi-select up to 10 keywords)
- Multi-series line chart with adaptive tick density (≤ 10 years every year, ≤ 20 every 2nd, ≤ 40 every 5th, otherwise every 10th), bisect-x tooltip, subject-to-surface halo on labels
- All-keywords table with client search and 20-row pagination; each row has an Add → compare-mode action
- Counts reflect **item-level tagging**, not text occurrence: a document tagged with "Terrorisme" contributes exactly one mention per year regardless of how often the word appears in the body. The section subheading says so.

Section A is backed by `asset/data/index-overview.json` (one bundle, ~790 KB minified) generated by `scripts/generate_index_overview.py`. Section B is backed by three files — `keyword-explorer-subjects.json`, `keyword-explorer-spatial.json`, `keyword-explorer-metadata.json` — generated by `scripts/generate_keyword_explorer.py` (~1 MB total minified). State is in-memory only; filters reset on reload (page blocks can be embedded anywhere, so hijacking the page URL for block-local state is explicitly avoided).

### References Overview (page block)

Bibliographic dashboard pulled directly from the Hugging Face dataset at page load — no Python precompute needed. `asset/js/charts/references-overview.js` paginates the HF `datasets-server /rows` endpoint (9 parallel requests of 100 rows each, ~1 s on a good network), then aggregates in the browser:

- Summary cards — references / authors / publishers / types / languages / countries
- Timeline — stacked bar by reference type
- Reference types, languages — top-10 horizontal bars
- Top 15 authors, top 15 subjects

### Scary Terms (page block)

Tracks the frequency of a curated set of "scary" term families (terrorisme, extrémisme, djihadisme, intégrisme, …) across the IWAC corpus from 1961–2025:

- **Metric row** — total matching articles, term families, variants, total occurrences
- **View mode switcher** — Bar-chart race / By country / Global
- **Animated bar-chart race** — horizontal bars animated one year at a time (1 s per frame), term families cycled through IWAC palette colors
- **Country view** — per-country breakdown selectable via dropdown
- **Global view** — single time-series of total occurrences
- **Term definitions table** — each family with its variants, for provenance

Backed by four precomputed JSONs (`scary-terms-metadata.json`, `scary-terms-temporal.json`, `scary-terms-countries.json`, `scary-terms-global.json`) generated by `scripts/generate_scary_terms.py`.

### Visualizations (resource-page block) — Person

Per-Person resource-page block that renders when attached to an item whose resource template is `Personnes` (template ID 5). 11 panels:

- **Summary stats row** — total mentions, year range, newspapers, countries
- **Global role facet** — `All / As subject / As creator / As editor` — re-filters every panel below with no refetch
- **Mentions timeline** — year × country stacked bar
- **Year × month heatmap**
- **Top newspapers** — horizontal bar with year-range tooltip (panel elided when empty)
- **Countries covered** — horizontal bar
- **Top LDA topics** — horizontal bar (panel elided when empty)
- **AI sentiment** — three-model comparison (Gemini / ChatGPT / Mistral, panel elided when empty)
- **Associated entities network** — TF-IDF ranked force graph (`score = cooc × log(N_persons / df)`, `min_cooccurrence = 2`, top-50 cap), nodes colored by index `Type`, click → Omeka entity page; ships a custom toolbar (zoom +/−, reset, legend toggle, download)
- **Subject co-occurrence** — pairwise co-occurrence among top 15 neighbors
- **Associated locations map** — MapLibre bubbles from mentioned `Lieux` entities, sized by count

Data comes from one JSON per person under `asset/data/person-dashboards/{o_id}.json`, generated by `scripts/generate_person_dashboards.py` using the `articles`, `publications`, `references`, and `index` HF subsets.

### Visualizations (resource-page block) — Entity

Same block layout, same template dispatch. When attached to an item whose template is `Lieux` (6), `Organisations` (7), `Sujets` (3), or `Événements` (2), `Visualizations::render()` routes to `entity.phtml`, which reuses every Person panel module with `by_role.all` wrappers (no role facet). Data comes from `asset/data/entity-dashboards/{o_id}.json`, generated by `scripts/generate_entity_dashboards.py`.

### Visualizations (resource-page block) — Article

Attaches to `bibo:Article` items (template id 8 on islam.zmo.de). `Visualizations::render()` routes to `article.phtml`, which loads the per-article JSON at `asset/data/article-dashboards/{o_id}.json` (generated by `scripts/generate_article_dashboards.py`, one file per article, ~12,287 files / ~120 MB). 5 panels:

- **Article metrics** — compact stat cards: word count, Flesch readability, type-token ratio, page count, language, LDA topic label (cards with missing values are silently elided)
- **AI sentiment** — 3-model (Gemini / ChatGPT / Mistral) comparison for THIS article. Reuses the segmented-bar shape from the aggregate sentiment panel with `count=1` in the bucket the model picked; a caption names the chosen polarité / centralité / subjectivité explicitly so the 100%-wide stripes aren't ambiguous.
- **Context network** — the unified 3-layer force graph. Centre = the article, inner ring = its tagged persons / orgs / places / subjects, outer ring = the top 20 articles that share the most entities with it. Each related-article node is connected to every entity it shares with the centre, so ECharts' force layout clusters articles by the entities they overlap with. Click an entity to open its page; click an outer-ring article to jump to that article's dashboard (self-reinforcing feedback loop). The panel ships the same 6-button toolbar (zoom ±, reset, legend, download, fullscreen) as the person / entity networks.
- **Similar articles** — top 10 articles by cosine similarity of the precomputed `embedding_OCR` (768-dim Gemini). Horizontal bar chart with similarity as a 0–100% x-axis so the long-tail drop-off is legible at a glance. Tooltip shows full title + newspaper + date + similarity; bar click routes to the article page.
- **Spatial coverage** — MapLibre map with one pin per place in the article's `dcterms:spatial` field, geocoded through the IWAC authority index. Uniform pin radius (all counts = 1); popup links to the place's authority page. Auto-fits the viewport to the pins.

The 3-layer network is built client-side in `network.js` from the precomputed `entities` + `related_by_entities` arrays (no separate `network` key in the JSON — saves ~3 KB per file). Reuses `C.network` unchanged: the builder is topology-agnostic, so adding `type: 'article'` for the outer ring just picks up the next palette colour and a new legend entry via the `entity_type_article` i18n key.

### Placeholders

**Compare Projects** (page block) and **Item Set Dashboard** (resource-page block) both enqueue the module's asset stack and render a loading spinner container. They're registered so Omeka recognizes the block layouts, but no orchestrator JS has been written yet — they'll be implemented in follow-up passes. See `ROADMAP.md` for timelines.

## Architecture

```
IwacVisualizations/
├── Module.php                              # Structural only — NO asset listeners (see docblock)
├── config/
│   ├── module.ini                          # Module metadata (version drives asset cache-bust)
│   └── module.config.php                   # Block + resource-page-block registration
├── src/Site/
│   ├── BlockLayout/
│   │   ├── AbstractIwacBlockLayout.php     # Shared base: label/description/template
│   │   ├── CollectionOverview.php          # Live — extends AbstractIwacBlockLayout
│   │   ├── IndexOverview.php               # Live — extends AbstractIwacBlockLayout
│   │   ├── ReferencesOverview.php          # Live — extends AbstractIwacBlockLayout
│   │   ├── ScaryTerms.php                  # Live — extends AbstractIwacBlockLayout
│   │   └── CompareProjects.php             # Placeholder — extends AbstractIwacBlockLayout
│   └── ResourcePageBlockLayout/
│       ├── Visualizations.php              # Template-ID dispatch (person vs entity)
│       └── ItemSetDashboard.php            # Placeholder
├── view/common/
│   ├── iwac-assets.phtml                   # Shared asset-loader partial (v0.9.0+)
│   ├── block-layout/
│   │   ├── collection-overview.phtml       # Live — precompute path
│   │   ├── index-overview.phtml            # Live — precompute path
│   │   ├── references-overview.phtml       # Live — live-fetch path
│   │   ├── scary-terms.phtml               # Live — precompute path
│   │   └── compare-projects.phtml          # Placeholder
│   └── resource-page-block-layout/
│       ├── visualizations/
│       │   ├── person.phtml                # Live — dispatched for template 5
│       │   └── entity.phtml                # Live — dispatched for templates 2/3/6/7
│       └── item-set-dashboard.phtml        # Placeholder
├── asset/
│   ├── css/                                # Per-block split; every template
│   │   │                                   #   enqueues iwac-core.css first,
│   │   │                                   #   then iwac-maplibre.css (if it
│   │   │                                   #   uses a map), then its block
│   │   │                                   #   sheet.
│   │   ├── iwac-core.css                   # Tokens, panel, btn, chip
│   │   │                                   #   controls, table, summary card,
│   │   │                                   #   form controls, section heading
│   │   ├── iwac-maplibre.css               # MapLibre chrome + shared
│   │   │                                   #   P.buildMapPopup body styles
│   │   └── blocks/                         # Block-specific layouts
│   │       ├── collection-overview.css     #   overview grid, wordcloud, recent additions
│   │       ├── index-overview.css          #   section layout, keyword explorer sidebar
│   │       ├── scary-terms.css             #   metrics, view toggle, slider, matrix
│   │       └── person-dashboard.css        #   body/stats, sentiment, graph/chord host
│   ├── js/                                 # Every .js has a .min.js sibling (terser, committed)
│   │   ├── iwac-i18n.js                    # Locale detection + en/fr dictionary + t()
│   │   ├── iwac-theme.js                   # ECharts theme built from live CSS vars
│   │   ├── dashboard-core.js               # IWACVis namespace, chart tracking, theme observer
│   │   └── charts/
│   │       ├── shared/                     # Reusable primitives:
│   │       │                               #   panels (DOM + formatters + count-features
│   │       │                               #     + loading/empty/error states
│   │       │                               #     + attachFeatureStateHover),
│   │       │                               #   faceted-chart (buildFacetedChart helper),
│   │       │                               #   pagination, table, facet-buttons,
│   │       │                               #   chart-options, maplibre, map-popup,
│   │       │                               #   panel-toolbar, responsive
│   │       ├── collection-overview.js      # Collection Overview orchestrator
│   │       ├── collection-overview/        # Panel modules (growth, gantt, wordcloud, map, …)
│   │       ├── index-overview.js           # Index Overview orchestrator
│   │       ├── index-overview/             # Panel modules — Section A: stats, type-distribution,
│   │       │                               #   top-entities, lifespan, places-map, activity-gantt,
│   │       │                               #   index-table; Section B: keywords-state,
│   │       │                               #   keywords-filters, keywords-chart, keywords-table
│   │       ├── references-overview.js      # References Overview orchestrator
│   │       ├── scary-terms.js              # Scary Terms orchestrator (bar-chart race)
│   │       ├── person-dashboard.js         # Person orchestrator
│   │       ├── person-dashboard/           # Panel modules (stats, network, sentiment, …)
│   │       └── entity-dashboard.js         # Entity orchestrator (reuses person panels)
│   └── data/
│       ├── collection-overview.json
│       ├── collection-wordcloud.json
│       ├── collection-map.json
│       ├── index-overview.json             # Section A bundle (~790 KB minified)
│       ├── keyword-explorer-subjects.json  # Section B — Subjects (~680 KB minified)
│       ├── keyword-explorer-spatial.json   # Section B — Spatial Coverage (~400 KB minified)
│       ├── keyword-explorer-metadata.json  # Section B — filters metadata
│       ├── scary-terms-metadata.json
│       ├── scary-terms-temporal.json
│       ├── scary-terms-countries.json
│       ├── scary-terms-global.json
│       ├── person-dashboards/{o_id}.json   # ~2,800 files
│       ├── entity-dashboards/{o_id}.json   # ~1,550 files
│       └── article-dashboards/{o_id}.json  # ~12,287 files (~120 MB)
├── scripts/                                # Python precompute + Node build
│   ├── iwac_utils.py                       # Shared helpers (ported from iwac-dashboard)
│   ├── generate_collection_overview.py
│   ├── generate_wordcloud.py
│   ├── generate_world_map.py
│   ├── generate_index_overview.py          # Section A — authority index bundle
│   ├── generate_keyword_explorer.py        # Section B — subjects + spatial + metadata
│   ├── generate_scary_terms.py
│   ├── generate_person_dashboards.py
│   ├── generate_entity_dashboards.py
│   ├── generate_article_dashboards.py      # per-article + semantic kNN
│   ├── build-js.js                         # terser-driven JS minification
│   ├── requirements.txt
│   └── README.md
├── language/
│   ├── template.pot                        # Gettext template for PHP-rendered strings
│   ├── fr.po                               # French translations
│   └── README.md
├── package.json                            # Node build: `npm run build:js`
├── DATA_NOTES.md                           # Full HF dataset schema (6 subsets, ~19,420 rows)
├── ROADMAP.md
└── README.md
```

### Asset loading — shared partial

`Module.php` is intentionally minimal and only wires `getConfig()`. Per the top-of-file docblock:

> Every block partial in this module enqueues its own stylesheet, CDN libraries, and JS dependencies. We deliberately do NOT attach a controller listener that blanket-loads ECharts/MapLibre on every Item and ItemSet view — doing so cost ~600 KB of unused JavaScript on every Article page, even when no Visualizations block was configured.

**As of v0.9.0, enqueueing is centralized in a single shared partial** (`view/common/iwac-assets.phtml`) that owns the stylesheet + CDN + JS stack. Templates only declare *what* they need and the partial handles the rest:

```php
echo $this->partial('common/iwac-assets', [
    'blockCss' => 'collection-overview',        // optional: loads css/blocks/<name>.css
    'needs' => [
        'maplibre'     => true,                 // MapLibre CDN + iwac-maplibre.css + shared/maplibre + shared/map-popup
        'wordcloud'    => true,                 // echarts-wordcloud CDN
        'chartOptions' => true,                 // shared/chart-options
        'facetButtons' => true,                 // shared/facet-buttons + shared/faceted-chart
        'table'        => true,                 // shared/table (implicitly loads pagination)
        'pagination'   => true,                 // shared/pagination
    ],
    'panels' => [                               // block-specific panel modules, in order
        'collection-overview/recent-additions',
        'collection-overview/growth',
        'collection-overview/map',
        // ...
    ],
    'orchestrator' => 'collection-overview',    // orchestrator loads LAST
]);
```

The partial:

- always loads `iwac-core.css`, ECharts CDN, i18n, theme, dashboard-core, panels, panel-toolbar, responsive
- loads optional primitives per `needs` (each is tiny and opt-in — `panels.js` alone is enough for blocks that don't render charts yet)
- loads each panel module in the order given, then the orchestrator **last**
- pins CDN versions at the top of the partial so bumping `@6` → `@7` is a one-line change
- emits every URL through `$this->assetUrl($path, 'IwacVisualizations')` so Omeka's `?v=` cache-bust tracks `config/module.ini`
- deduplicates via `headScript()` / `headLink()` — if two blocks appear on the same page, each asset is still enqueued only once

Consequences for contributors:

- **When adding a new block**, write the template body (markup + data attributes) and call `$this->partial('common/iwac-assets', [...])` at the top. Don't write raw `$this->headScript()` calls — that's what the partial is for.
- **Reference `.min.js`, not `.js`** — the partial already appends `.min.js`; pass panel paths without any extension.
- Shared JS primitives live under `asset/js/charts/shared/`; panel modules under `asset/js/charts/<block>/`; orchestrators at `asset/js/charts/<block>.js`.
- If you need a truly new shared primitive, add it to `panels.js` (small additions) or a new `shared/<name>.js` file, add it as an opt-in flag in the partial, and document it in this README.

### Load order (runtime)

The shared partial enqueues scripts in this fixed order. All are deferred, so they download in parallel during HTML parse and execute in document order after parsing completes — the orchestrator always runs last, with its dependencies populated.

1. **CDN libraries** — `echarts.min.js`, optionally `echarts-wordcloud.min.js`, `maplibre-gl.js` + CSS (not deferred for CSS)
2. **IWAC infrastructure** — order matters: `iwac-i18n.min.js` → `iwac-theme.min.js` → `dashboard-core.min.js`
3. **Shared primitives** — `panels` + `panel-toolbar` + `responsive` always load; `chart-options`, `pagination`, `table`, `facet-buttons` + `faceted-chart`, `maplibre` + `map-popup` load only when the block opts in via `needs`
4. **Panel modules** — self-registering IIFEs under `charts/<block>/` that attach to `IWACVis.<block>Dashboard.<panel>`
5. **Orchestrator** — `charts/<block>.js` — waits for `DOMContentLoaded`, fetches JSON (or live HF data), builds the DOM scaffold, and dispatches `panel.render(host, data, facet, ctx)` for each registered panel

### Shared JS helpers (`asset/js/charts/shared/panels.js`)

Every panel module gets a small API hung off `window.IWACVis.panels` (aliased as `P`). Beyond the DOM primitives (`P.el`, `P.escapeHtml`, `P.buildPanel`, `P.buildSummaryCards`) there are a handful of helpers panel modules should reach for before rolling their own:

| Helper | What it does |
|---|---|
| `P.t(key, params)` / `P.formatNumber(n)` / `P.formatDate(iso, opts)` | i18n shortcuts. `formatDate` is locale-aware (fr-FR / en-US) and gracefully falls back to the ISO date slice on parse failure. |
| `P.buildLoadingState(key)` / `P.buildEmptyState(key)` / `P.buildErrorState(key)` | Consistent spinner / "No data available" / "Failed to load" banners. Default keys translate to the obvious messages. |
| `P.buildCountFeatures(items, { countKey, minCount, toProps })` | Turns a list of `{lng, lat, count, …}` records into a GeoJSON `FeatureCollection` for MapLibre bubble maps, plus the max count for the radius interpolation. Used by every map panel in the module. |
| `P.buildFacetedChart(panelEl, { facet, getData, hasData, buildOption, emptyKey })` | Collapses the 30-line "register chart → subscribe to facet → re-setOption on change → show empty state" pattern into one call. Works with both external facet observers (person/entity dashboards) and locally-held state (collection-overview facet bars — use `ctrl.rerender()` from the button `onChange` handler). |
| `P.attachFeatureStateHover(map, layers)` | Wires `feature-state`-driven hover highlights to one or more MapLibre layers. Pair with `'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], <hover>, <normal>]` in the paint spec. Prerequisite: each source must be created with `generateId: true` so MapLibre has a stable feature identity. |
| `P.createIwacMap(container, config)` / `P.createIwacPopup(options)` / `P.buildMapPopup(config)` | The MapLibre stack: theme-aware basemap, auto-restyle on theme swap, shared popup CSS hooks, paginated article-list popup body. |
| `P.buildFacetButtons(config)` / `P.buildTable(config)` / `P.buildPagination(config)` | Facet bar (buttons / select / subcategories), accessible HTML table with column renderers, and a reusable pagination widget. |

### Data strategy — hybrid

The module intentionally supports **two data paths**, chosen per-block based on cost:

| Path | When to use | Example | Python needed? |
|---|---|---|---|
| **Live fetch** | Small subsets (< ~5k rows) without heavy per-row blobs. The chart JS paginates the Hugging Face `datasets-server /rows` endpoint (100 rows/request, parallel) and aggregates client-side. Always fresh, no precompute. | **References Overview** — 864 rows, 9 parallel requests, ~1 s | No |
| **Precompute** | Heavy aggregations (the full `articles` subset is 12,287 rows × 47 cols including 768-dim embeddings), cross-subset joins, networks, per-entity dashboards. A Python script reads the HF dataset via the `datasets` lib and writes compact JSON into `asset/data/`. Run manually when the dataset updates (~monthly). | Collection Overview, Person dashboards, Entity dashboards, word cloud, world map | Yes |

Rough decision rule: **precompute if fetching would take > 50 parallel HF requests OR the source rows carry large blobs (OCR, embeddings, images)**. Networks and semantic-neighbor computations also belong in precompute — they're expensive and stable between dataset updates.

## Installation

Not yet released. For local development:

1. Place this directory (or a clone of the repo) under your Omeka S `modules/` folder.
2. If you plan to regenerate the minified JS bundles or the precomputed data:
   - **Node 18+** for the JS build: `npm install && npm run build:js`
   - **Python 3.9+** for the precompute pipeline: `python3 -m venv .venv && source .venv/bin/activate && pip install -r scripts/requirements.txt`
3. Regenerate data as needed (see [Precompute pipeline](#precompute-pipeline)).
4. Activate the module in **Admin → Modules**.
5. On any site page, add one of the page blocks (**Collection Overview**, **References Overview**, **Compare Projects**). For resource-page blocks (**Visualizations**, **Item Set Dashboard**), attach them to the appropriate resource templates from the admin.

Already-committed `.min.js` files mean a fresh clone works without running `npm install` — the Node build is only needed when you change a `.js` source.

### Requirements

- **Omeka S 4.0+** (declared in `config/module.ini`)
- **Node 18+** — only needed when rebuilding minified JS bundles (dev step)
- **Python 3.9+** — only needed when running Python precompute generators. `datasets`, `pandas`, `pyarrow`, `huggingface-hub`, `numpy`, … see `scripts/requirements.txt`
- **Theme:** [IWAC theme](https://github.com/fmadore/IWAC-theme). The module works without it (CSS fallback values + ECharts theme fallback constants), but chart colors will look generic and the dark-mode toggle will only follow the OS preference.

### IWAC theme integration

`asset/js/iwac-theme.js::readTokens()` pulls these CSS custom properties off `:root` via `getComputedStyle`, with fallbacks in `FALLBACK_LIGHT` / `FALLBACK_DARK` so charts still render on sites without the IWAC theme:

| Token | Used for |
|---|---|
| `--primary` | First palette color + accents (dataZoom handle, hover borders, …) |
| `--ink` | Primary text |
| `--ink-light` | Axis labels, legend text |
| `--muted` | Secondary text, tabs, subtitle |
| `--surface` | Tooltip background, button background |
| `--surface-raised` | Panel background, card background |
| `--background` | Chart background fill |
| `--border` | Axis lines, panel borders |
| `--border-light` | Split lines, subtle dividers |

If you add new theme-dependent properties, register them in `readTokens()` and provide a fallback in `FALLBACK_LIGHT` / `FALLBACK_DARK`. **Never hardcode hex values in chart code** — the IWAC theme's `--primary` is admin-configurable per site.

## Internationalization

Two layers:

1. **PHP (`$this->translate()`)** — block labels, form hints, loading messages, and any other text rendered server-side. Edit `language/fr.po` and compile with `msgfmt language/fr.po -o language/fr.mo`. Current catalog is 17 entries. See `language/README.md`.
2. **JavaScript (`IWACVis.t()`)** — chart labels, tooltips, summary card labels, tab names, facet UI. Dictionary lives inline in `asset/js/iwac-i18n.js`. Locale is detected once at render time from `document.documentElement.lang` (populated by Omeka's Internationalisation module).

Language switching in IWAC is a full page navigation (the Internationalisation module links to equivalent URLs under each locale), so no runtime switch is needed — `IWACVis.t()` just reads the locale when the orchestrator fires.

## Theme switching

- Signal: `body[data-theme="light" | "dark"]`, owned by the IWAC theme's `theme-toggle.js` (persisted in `localStorage['iwac-theme-preference']`).
- `dashboard-core.js` attaches a `MutationObserver` to `document.body` filtered on `data-theme` changes.
- On change, it calls `IWACVis.refreshThemes()` (rebuild + re-register the ECharts theme from the live CSS vars) then iterates `IWACVis._charts` to dispose every tracked ECharts instance and re-run its render function.
- ECharts 6 removed `chart.setTheme()`, which is why we use dispose + reinit. MapLibre instances get `setStyle()` pointed at the Carto positron / dark-matter URL.

## Mobile & touch UX

Every block is responsive and works on mobile/touch without extra configuration:

- **Maps** — MapLibre handles pinch-zoom, single-finger pan, two-finger rotate, pitch natively. Tapping a bubble fires `map.on('click', ...)` the same way a desktop click does, so popups open identically. The `feature-state`-driven hover highlight (brighter fill + thicker stroke) fires as visual confirmation on tap, then clears on the next interaction — a nice side-effect of the modern idiom.
- **Popups** — sized via `min-width: min(200px, calc(100vw - 3rem))` and `max-width: min(320px, calc(100vw - 1.5rem))` so they breathe even on 320-px-wide phones without clipping off-screen. Internal height caps at `min(70vh, 420px)` so long article lists scroll inside the popup instead of overflowing the map. iOS Safari gets `-webkit-overflow-scrolling: touch` for momentum scrolling.
- **Charts** — ECharts handles tap-to-select, tap-to-dismiss-tooltip, pinch-zoom on brush-selectable charts, and touch-driven dataZoom sliders out of the box.
- **Tables** — `P.buildTable` wraps every table in a horizontally scrollable container. The `recent-additions` table progressively hides columns at 768px and 640px breakpoints (source → added-date → …) and shrinks thumbnails via the `--iwac-vis-thumb-{lg,md,sm}` token ramp.
- **Facet bars + pagination + toolbar buttons** — rendered as real `<button>` elements, tap targets ≥ 32px.
- **Layouts** — every block is mobile-first CSS. `index-overview`'s keyword sidebar collapses from a two-column grid to single-column below 1024px. `scary-terms` shifts from a 4-column metrics grid on tablets+ to 2-column on phones. `person-dashboard` reflows stats and graph panels at 640px.
- **Text + line clamps** — article titles in popups and table cells use `-webkit-line-clamp: 2` with a `title` attribute fallback, so long French headlines never break the layout.

Known trade-offs (same on every web map, not IWAC-specific):

- **Small bubble markers** (radius ~3 px at minimum count) are hard to tap precisely on a phone. Users zoom in to hit them, which is standard map UX.
- **Page scroll vs. map pan** — we use MapLibre defaults (`dragPan: true`), so a single-finger drag that starts inside the map captures the drag for panning, and a drag that starts above/below the map scrolls the page. If a block is embedded in a long scrollable page and you'd rather force two-finger pan, pass `mapOptions: { cooperativeGestures: true }` via `P.createIwacMap()`. We don't force it by default because the built-in hint dialog is English-only and many users find the two-finger requirement annoying.

### Registering a theme-aware chart

To register a new chart so it auto-updates on toggle:

```js
IWACVis.registerChart(el, function (el, chart) {
    chart.setOption({
        // ... use IWACVis.t() for labels,
        //     don't set explicit colors —
        //     the registered theme supplies them
    });
});
```

## Precompute pipeline

Full workflow documented in **`scripts/README.md`**. Short version:

```bash
cd /path/to/IwacVisualizations
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt

# Collection-level data
python3 scripts/generate_collection_overview.py  --minify   # → asset/data/collection-overview.json
python3 scripts/generate_wordcloud.py                       # → asset/data/collection-wordcloud.json
python3 scripts/generate_world_map.py                       # → asset/data/collection-map.json

# Index Overview — Section A (authority entity explorer)
python3 scripts/generate_index_overview.py     --minify     # → asset/data/index-overview.json

# Index Overview — Section B (Dublin Core Subject + Spatial Coverage over time)
python3 scripts/generate_keyword_explorer.py   --minify     # → asset/data/keyword-explorer-{subjects,spatial,metadata}.json

# Scary Terms
python3 scripts/generate_scary_terms.py                     # → asset/data/scary-terms-*.json (4 files)

# Per-entity data
python3 scripts/generate_person_dashboards.py   # → asset/data/person-dashboards/{o_id}.json
python3 scripts/generate_entity_dashboards.py   # → asset/data/entity-dashboards/{o_id}.json

# Per-article data (includes semantic kNN over embedding_OCR)
python3 scripts/generate_article_dashboards.py  # → asset/data/article-dashboards/{o_id}.json
```

`--minify` strips indentation and whitespace from the JSON output. Use it on the heavier bundles (`collection-overview`, `index-overview`, `keyword-explorer-*`) — it typically halves file size with no downside, since the JSON is only ever consumed by JS, not read by humans. Per-entity dashboards are individually small enough that pretty-printed output stays below a few KB each.

The HF dataset updates roughly monthly, so regeneration is a manual developer step, not a scheduled job. After every data regeneration, bump the version in `config/module.ini` (and `package.json` to match) so Omeka's `?v=` query string busts any stale browser caches pointing at the old asset URLs. When adding a new visualization, add a new `generate_*.py` next to the existing ones and document it in `scripts/README.md`.

**Canonical reference:** the sibling project [`iwac-dashboard`](https://github.com/fmadore/iwac-dashboard) has ~3,200 lines of working Python that reads the same dataset. `iwac_utils.py` in this module is ported from it, and `generate_keyword_explorer.py` is a direct port of iwac-dashboard's `/keywords` generator generalized to scan every content subset. Consult it before writing new generators.

## Build & development

JS sources under `asset/js/` are mirrored to `.min.js` siblings by `scripts/build-js.js` (terser). Templates load the `.min.js` variants; the unminified sources stay in-tree for development and debugging.

```bash
npm install          # installs terser as a devDependency (one-time)
npm run build:js     # walks asset/js/**/*.js and writes .min.js next to each source
```

`node_modules/` is gitignored; the generated `.min.js` files **are** committed, so a fresh clone works without running the build. Re-run `npm run build:js` after editing any `.js` source and commit both the source and the minified output.

Current minification results across **49 files: ≈ 408 KB → 153 KB (−62.4%)**. The biggest single drop is `charts/shared/chart-options.js` (≈ 69 KB → 22 KB). The tiny `faceted-chart.js` helper minifies to under 1 KB.

There is no build step for CSS — every sheet under `asset/css/` is hand-authored and loaded as-is. The module's styles are split per-block, mirroring the JS architecture:

```
asset/css/
├── iwac-core.css          # Shared by every block — tokens, panel, chip
│                          #   controls (tabs / facets / pagination), btn,
│                          #   summary card, table, form controls, section
│                          #   headings, badges. ~600 lines.
├── iwac-maplibre.css      # MapLibre chrome + shared P.buildMapPopup body
│                          #   styles. Enqueued only by map-using blocks.
└── blocks/                # One file per live block, block-specific
    │                      #   layouts and modifiers only.
    ├── collection-overview.css
    ├── index-overview.css
    ├── scary-terms.css
    └── person-dashboard.css   # Used by the person + entity resource-page blocks
```

Each block template enqueues `iwac-core.css` first, then `iwac-maplibre.css` if it uses a map, then its own block sheet (if any). **References Overview** uses `iwac-core.css` alone — it has no block-specific chrome beyond the generic panel + table. HTTP/2 makes the extra requests free, and splitting keeps each file under ~600 lines so conflicts stay localised to the block that touches them.

**Conventions for adding a new block:**

1. Add block-specific selectors to `asset/css/blocks/<block>.css`. If the block shares a pattern with an existing one (e.g. "chip controls", "form controls"), add your selector to the canonical rule in `iwac-core.css` — never redefine base chip/button styles per block.
2. Enqueue `iwac-core.css` first in the block template, then maplibre (if needed), then the block sheet.
3. Colors and spacing must resolve through IWAC theme tokens (`--primary`, `--ink`, `--surface`, `--space-*`, `--radius-*`). **Never hardcode hex in JS** — shared chart code reads these via `getComputedStyle` / `ns.resolveCssVar`.

## Related projects

- [IWAC Theme](https://github.com/fmadore/IWAC-theme) — the Omeka S theme this module targets
- [iwac-dashboard](https://github.com/fmadore/iwac-dashboard) — standalone SvelteKit dashboard with the canonical Python data pipeline
- [ResourceVisualizations](https://github.com/fmadore/ResourceVisualizations) — the module this was scaffolded from
- Hugging Face dataset: [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection)

## License

MIT
