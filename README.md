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
| Topic Explorer | page block | **Live** — LDA-30 overview + per-topic drill-down (first consumer of `IWACVis.dashboardLayout`) | Precompute (`generate_topic_explorer.py`) |
| Visualizations / Person | resource-page block | **Live** — 11 panels | Precompute (`generate_person_dashboards.py`) |
| Visualizations / Entity (Lieux, Organisations, Sujets, Événements) | resource-page block | **Live** — reuses Person panels | Precompute (`generate_entity_dashboards.py`) |
| Visualizations / Article (bibo:Article, template 8) | resource-page block | **Live** — 5 panels incl. 3-layer context network + semantic neighbours | Precompute (`generate_article_dashboards.py`) |
| Item Set Dashboard | resource-page block | Placeholder (assets enqueued, no orchestrator) | — |

Current version: see `config/module.ini` (`version = …`). This value drives the `?v=` query string Omeka appends to every asset URL, so bumping it is the canonical way to bust the browser cache after a source change.

### v0.20.0 — Compare Newspapers choropleth lit up

The deferred v0.18.0 follow-up: the geographic-comparison map in the Compare Newspapers block now responds to the choropleth toggle. Combined A+B counts per IWAC country fill the polygons; the union answers "which IWAC countries does this two-corpus comparison cover most heavily, overall." Both sides' point clouds (heatmap + circle layers) are hidden when the user switches to choropleth.

- **`scripts/generate_compare_newspapers.py`** extended: `build_index_lookups` now produces a `place_country` map (place name → canonical IWAC country, sourced from the IWAC index's `countries` column on each Lieu, first entry, canonicalised through `canonical_country`). `geo_points` entries inherit it as a `country` field — the front-end aggregates by country without doing point-in-polygon at runtime.
- **61 per-corpus JSONs regenerated** to populate the new field.
- **`asset/js/charts/compare-newspapers.js`** wires `P.attachChoroplethToggle(map, …)` after `createIwacMap`, summing `aPts.concat(bPts)` by `country`. Hides all four bubble/heatmap layers (`compare-a-heat`, `compare-a-circles`, `compare-b-heat`, `compare-b-circles`) when in choropleth mode.

A future enhancement could add an A | B selector to swap which side drives the fill, or a diverging palette (A − B per country) for direct visual comparison.

### v0.19.0 — Person / Entity / Article migrated to `dashboardLayout`

The three resource-page-block orchestrators (Person, Entity, Article) are now declarative slot lists dispatched through `IWACVis.dashboardLayout.render()` instead of hand-rolled `buildLayout(...)` + per-panel `pd.timeline.render(h.timeline, data, facet)` chains. The behaviour is identical — empty-payload predicates, role-faceted slices on Person, no-op facet on Entity / Article — but each orchestrator shrinks to ~120-150 lines of slot definitions plus a tiny bootstrap.

- **`shared/dashboard-panels-bridge.js`** (new) registers thin wrappers around the existing 9 person-panel modules and 2 article-panel modules into `IWACVis.dashboardLayout`. Each wrapper reconstructs the legacy `(panelEl, data, facet, ctx)` signature so the panel modules themselves don't change. Loaded as the **last** entry in each phtml's `panels` array (after the per-panel IIFEs populate `IWACVis.personDashboard.*` / `IWACVis.articleDashboard.*`, before the orchestrator).
- **Three layouts registered**: `'person'` (9 slots, role-faceted via the existing `pd.facet` observer), `'entity'` (same renderer keys, entity-specific `desc_entity_*` strings), `'article'` (2 slots, no facet).
- **Empty-payload predicates** (`hasNewspapersData`, `hasTopicsData`, `hasSentimentData`, `hasNetworkData`, `hasFurtherData`) move from imperative `if (...) ... else null` ternaries into slot-level `hasData` callbacks. Result: dashboards never render "No data available" placeholders — empty slots are filtered before the panel shell is built.
- **i18n keys + descriptors are now data, not code**. Adding a new panel to the person dashboard becomes (a) write the panel module under `person-dashboard/`, (b) add a renderer registration to `dashboard-panels-bridge.js`, (c) add a slot to the `'person'` and `'entity'` layouts. No `buildLayout(...)` edit, no template change.
- **Phtml updates**: each of `person.phtml`, `entity.phtml`, `article.phtml` adds `'layout' => true` to `needs` and `'shared/dashboard-panels-bridge'` as the last `panels` entry.

### v0.18.0 — Choropleth on every map + Compare Projects retired

- **Choropleth toggle button** on every IWAC map. A single MapLibre control swaps between the existing point-bubble view and a 6-country choropleth fill (Bénin, Burkina Faso, Côte d'Ivoire, Niger, Nigeria, Togo). Theme-aware paint via the `--iwac-vis-heatmap-*` ramp the year × month and calendar heatmaps already use, so light/dark propagation is automatic. Wired on **Collection Overview's world map**, the **Index Overview Places map**, and the **Person / Entity locations map** (with role-faceted updates on the latter via `P.setMapTheme`'s sibling `choropleth.updateCounts`).
- **`shared/choropleth.js` helper** — `P.attachChoroplethToggle(map, {countryCounts, bubbleLayers, basePath, labelKey})` returns a `{getMode, setMode, updateCounts, destroy}` handle. Lazy-loads the polygon GeoJSON once per page (cached across maps), re-adds the source + layers after `style.load` (theme swap), and gates same-mode toggles. ~330 lines.
- **6-country polygon GeoJSON** at `asset/data/iwac-countries.geojson` (138 KB) — derived from the [`datasets/geo-countries`](https://github.com/datasets/geo-countries) repository (CC0/PDDL Natural Earth derivative), filtered to the 6 IWAC countries by ISO-3166 alpha-3, with property cleanup so each feature carries `iso_a3 / iso_a2 / name (canonical IWAC) / name_en`.
- **Compare Projects block retired** — the orphan placeholder block layout (no orchestrator) was removed: only **Compare Newspapers** ships in this module. Removed: `src/Site/BlockLayout/CompareProjects.php`, `view/common/block-layout/compare-projects.phtml`, and the `compareProjects` registration in `module.config.php`.
- **Compare Newspapers choropleth deferred** — the geographic-comparison map's data points lack a `country` property in the output of `generate_compare_newspapers.py`, so wiring its choropleth needs a generator change + ~300 JSON regeneration. Tracked as a follow-up in ROADMAP.md.

### v0.17.0 — Topic Explorer block

First end-to-end consumer of the v0.16.0 layout system:

- **`topicExplorer` page block** under `src/Site/BlockLayout/TopicExplorer.php`. Two modes share the same block container: an **overview** with summary cards, a clickable treemap of all 30 LDA topics sized by article count, and a responsive grid of topic cards (top words + article count + year span); a **per-topic detail** view (calendar heatmap of articles, country / newspaper distributions, most-representative articles strip) built declaratively via `IWACVis.dashboardLayout.render(rootEl, 'topicDetail', sliceBundle)`.
- **One new shared renderer** — `horizontal-bar` (8th in `shared/renderers/`) — wraps `C.horizontalBar` so any layout slot can drop in a top-N bar without a bespoke renderer.
- **`generate_topic_explorer.py`** aggregates `articles.lda_topic_id` / `lda_topic_prob` / `lda_topic_label` into one bundle: per-topic counts, year ranges, year × day cells (calendar heatmap, partial-date rows excluded so cells aren't fake-positioned), country and newspaper distributions, and the top 10 most-representative articles per topic by topic probability.
- **Outliers** (`lda_topic_id == -1`, ~2 % of articles) excluded from per-topic stats but counted in the corpus metadata so the un-classified residual stays visible.

### v0.16.0 — declarative dashboard layout + new renderers

Composition refactor (no breaking changes — existing dashboards keep working unchanged):

- **Declarative layout system** (`asset/js/charts/shared/dashboard-layout.js`). `IWACVis.dashboardLayout` exposes a slot / renderer / metadata registry so per-entity orchestrators can be 5–20-line layout arrays. Slots auto-skip when their data fails the registered predicate (`shouldRender`), so dashboards never display "No data available" placeholders. Built-in `isEmpty` predicates cover list, network, chord, geo, hierarchical, radar, and cell-grid shapes; fragments let multiple layouts share common slot groups.
- **7 new shared renderers** under `asset/js/charts/shared/renderers/`, opt-in via `$needs['renderers']`: `calendar-heatmap` (multi-year per-day, ECharts `calendar` coordinate system), `chord` (circular co-occurrence, capped at top-30 nodes by row-sum), `radar-profile` (auto-rescaled per-axis comparison), `sibling-sparkline` (pure inline-SVG, no ECharts, CSS-variable-driven), `similar-items` (DOM card grid that consumes the `semantic_neighbors` shape already produced by `generate_article_dashboards.py`), `sunburst`, and `treemap`.
- **ECharts theme swap via `chart.setTheme()` (supported since 6.0.0)** instead of dispose+reinit. Same registered render callback re-runs after the swap, so charts that bake theme tokens into their option literal still pick up the new colours, but the underlying instance survives — no DOM detach/reattach flash, no re-init cost.
- **MapLibre per-map theme cache** (`P.setMapTheme(map, mode)`) — no-ops when the requested mode already matches, guarding against spurious theme observer fires that would otherwise blow away custom layers. `createIwacMap` stamps the initial theme on the instance.
- **PNG export composites the panel title + description + ISO date footer** onto the chart raster, waiting on `document.fonts.load` first so the export uses Public Sans rather than a canvas fallback. Falls back to the raw `getDataURL` on tainted-canvas / font failure.

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

### Topic Explorer (page block)

LDA-30 topic overview of the IWAC `articles` subset. The block has two modes that share the same container:

- **Overview** — summary cards (total topics, articles classified, outliers, newspapers), a clickable **treemap** of all 30 topics sized by article count, and a responsive grid of **topic cards** (each carrying the top 5 words, article count, and year span). Clicking either a treemap cell or a card swaps to that topic's detail view.
- **Per-topic detail** — a **calendar heatmap** of articles per day (year × day, partial-date rows excluded), top **countries** and top **newspapers** as horizontal bars, and the top 10 **most representative articles** (similar-items strip sorted by `lda_topic_prob` and click-through to each article's page).

This is the first end-to-end consumer of the v0.16.0 declarative dashboard-layout system: the per-topic detail view is registered once as `topicDetail` (a four-slot array) and dispatched via `IWACVis.dashboardLayout.render(detailEl, 'topicDetail', sliceBundle, ctx)`. The four slots map to the `calendarHeatmap`, `horizontalBar` (used twice with different `dataKey`s), and `similarItems` renderers — `horizontalBar` was added as the eighth shared renderer for this block.

Backed by `asset/data/topic-explorer.json` (single bundle, generated by `scripts/generate_topic_explorer.py`). Outlier articles (`lda_topic_id == -1`, ~2 %) are excluded from per-topic stats but counted in corpus metadata.

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

**Item Set Dashboard** (resource-page block) enqueues the module's asset stack and renders a loading spinner container. It's registered so Omeka recognizes the block layout, but no orchestrator JS has been written yet — implementation is the current "Next up" item in `ROADMAP.md`.

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
│   │   ├── TopicExplorer.php               # Live — extends AbstractIwacBlockLayout (v0.17.0)
│   │   └── CompareNewspapers.php           # Live — extends AbstractIwacBlockLayout
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
│   │   ├── topic-explorer.phtml            # Live — precompute path (v0.17.0)
│   │   └── compare-newspapers.phtml        # Live — precompute path
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
│   │       ├── topic-explorer.css          #   topic-card grid, detail header (v0.17.0)
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
│   │       │                               #   dashboard-layout (slot/renderer registry,
│   │       │                               #     shouldRender + isEmpty predicates),
│   │       │                               #   pagination, table, facet-buttons,
│   │       │                               #   chart-options, maplibre, map-popup,
│   │       │                               #   choropleth (toggle button + 6-country
│   │       │                               #     fill, v0.18.0),
│   │       │                               #   panel-toolbar (composited PNG export),
│   │       │                               #   responsive
│   │       ├── shared/renderers/           # Opt-in chart renderers, self-registering into
│   │       │                               #   IWACVis.dashboardLayout: calendar-heatmap,
│   │       │                               #   chord, radar-profile, sibling-sparkline,
│   │       │                               #   similar-items, sunburst, treemap
│   │       ├── collection-overview.js      # Collection Overview orchestrator
│   │       ├── collection-overview/        # Panel modules (growth, gantt, wordcloud, map, …)
│   │       ├── index-overview.js           # Index Overview orchestrator
│   │       ├── index-overview/             # Panel modules — Section A: stats, type-distribution,
│   │       │                               #   top-entities, lifespan, places-map, activity-gantt,
│   │       │                               #   index-table; Section B: keywords-state,
│   │       │                               #   keywords-filters, keywords-chart, keywords-table
│   │       ├── references-overview.js      # References Overview orchestrator
│   │       ├── scary-terms.js              # Scary Terms orchestrator (bar-chart race)
│   │       ├── topic-explorer.js           # Topic Explorer orchestrator — first consumer of dashboardLayout (v0.17.0)
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
│   ├── generate_topic_explorer.py          # LDA-30 topic aggregation (v0.17.0)
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
        'layout'       => true,                 // shared/dashboard-layout (implied by any 'renderers')
        'renderers'    => [                     // opt-in shared renderers under shared/renderers/
            'calendar-heatmap',
            'chord',
            'radar-profile',
            'sibling-sparkline',
            'similar-items',
            'sunburst',
            'treemap',
        ],
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
4. **Dashboard layout system + renderers (opt-in)** — `dashboard-layout.js` (the registry) followed by every entry in `needs.renderers` from `shared/renderers/<name>.js`; each renderer self-registers into `IWACVis.dashboardLayout` on load. Skipped entirely when the block declares neither `'layout' => true` nor a `'renderers' => [...]` list.
5. **Panel modules** — self-registering IIFEs under `charts/<block>/` that attach to `IWACVis.<block>Dashboard.<panel>`
6. **Orchestrator** — `charts/<block>.js` — waits for `DOMContentLoaded`, fetches JSON (or live HF data), builds the DOM scaffold, and dispatches `panel.render(host, data, facet, ctx)` for each registered panel — or, for layout-system blocks, calls `IWACVis.dashboardLayout.render(rootEl, layoutKey, data, ctx)` once and lets the registry walk the slot list

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
| `P.setMapTheme(map, mode)` | Switch a MapLibre instance to the IWAC light/dark basemap, no-opping when the requested mode already matches. Stamps `_iwacThemeMode` on the map; `createIwacMap` initializes it. |
| `IWACVis.dashboardLayout.{register, registerRenderer, registerMetadata, defineFragment, render, shouldRender, isEmpty}` | Declarative entity-dashboard composition. Layouts are arrays of slot objects; renderers self-register from `shared/renderers/<name>.js`; `render()` filters slots whose data fails the predicate cascade and dispatches the rest. See v0.16.0 above for the canonical example. |

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
- On change, it calls `IWACVis.refreshThemes()` (rebuild + re-register the ECharts theme from the live CSS vars) then iterates `IWACVis._charts`, calling `chart.setTheme(...)` on each tracked ECharts instance and re-running its registered render function.
- ECharts theme swap goes through `chart.setTheme()` — supported since 6.0.0. The post-swap render call ensures charts that read theme tokens at option-build time pick up the new colours. Caveat (per ECharts docs): previous `setOption` calls in merge mode are discarded after `setTheme`, but every IWAC render callback rebuilds the full option with `setOption(..., true)` so this is a non-issue.
- MapLibre instances swap basemaps via `P.setMapTheme(map, mode)`, which is gated by a per-map `_iwacThemeMode` cache so a no-op call doesn't blow away custom layers. Falls back to a direct `setStyle()` against the Carto positron / dark-matter URL when `shared/maplibre.js` isn't loaded.

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

# Topic Explorer (LDA-30)
python3 scripts/generate_topic_explorer.py     --minify     # → asset/data/topic-explorer.json

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

Current minification results across **66 files: ≈ 671 KB → 242 KB (−63.9%)**. The biggest single drop is `charts/shared/chart-options.js` (≈ 81 KB → 25 KB). The tiny `faceted-chart.js` helper still minifies to under 1 KB; `dashboard-layout.js` lands at ≈ 3.5 KB and the eight renderers (the v0.16.0 seven plus `horizontal-bar` added in v0.17.0) fit in ≈ 12 KB combined. `choropleth.js` (v0.18.0) lands at ≈ 2.4 KB; the 6-country polygon GeoJSON it loads is a separate 138 KB file fetched once per page on first toggle. `dashboard-panels-bridge.js` (v0.19.0) is ≈ 1 KB.

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
