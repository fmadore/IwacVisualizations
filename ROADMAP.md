# IWAC Visualizations — Roadmap

Living roadmap for the IwacVisualizations Omeka S module. See
[`README.md`](README.md) for the current architecture and
[`DATA_NOTES.md`](DATA_NOTES.md) for the full Hugging Face dataset
schema.

## Data source

- Hugging Face dataset: [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) — 6 subsets, ~19,420 rows.
- `o:id` in the dataset maps 1:1 to Omeka item IDs on <https://islam.zmo.de> → per-item JSON can be keyed directly by `o:id` and consumed by resource-page blocks via the existing `data-item-id` attribute.
- Updated roughly monthly; precompute is a manual developer step.

## Precompute reference

**`/home/fmadore/projects/iwac-dashboard/scripts/`** — sibling SvelteKit
dashboard with ~3,200 lines of working Python reading the same HF
dataset. Reuse its patterns before writing new generators. `iwac_utils.py`
has been ported verbatim into `scripts/`. See `scripts/README.md`.

## Done

- **Scaffold** (2026-04) — module structure forked from
  ResourceVisualizations; namespace renamed to `IwacVisualizations`;
  fresh git history; 200+ MB of stale precomputed data cleared.
- **Theme + i18n infrastructure** (2026-04) — `iwac-i18n.js`,
  `iwac-theme.js`, rewritten `dashboard-core.js` under the `IWACVis`
  namespace. ECharts themes are built from the IWAC theme's live CSS
  custom properties (`--primary`, `--ink`, `--surface`, ...), so chart
  colors always track the site's brand config and the light/dark
  toggle. `MutationObserver` on `body[data-theme]` disposes and
  re-renders every tracked chart when the user toggles.
- **Gettext catalog** (2026-04) — `language/template.pot`,
  `language/fr.po`; loading/UI strings covered for the first block.
- **HF dataset audit** (2026-04) — full schema for all 6 subsets
  documented in `DATA_NOTES.md`.
- **Collection Overview page block** (2026-04) — first end-to-end
  visualization, precompute-backed:
  - `scripts/generate_collection_overview.py` pulls summary stats,
    timeline by year × country, country / language distributions, and
    top-N entities per type from the `index` subset
  - `asset/js/charts/collection-overview.js` renders 4 ECharts panels
    (timeline, countries, languages, tabbed top-entities) with
    click-through to Omeka items on the entity bars
  - Summary cards use HTML/CSS only (no chart framework) for the
    big-number row
  - Responsive grid: single column on mobile, two columns above 800 px,
    full-width panels for the timeline and entities
- **Hybrid data strategy** (2026-04) — module now supports two data
  paths chosen per block:
  * **Live fetch** — paginated parallel calls to the Hugging Face
    datasets-server `/rows` endpoint, aggregation in the browser. Used
    when the source subset is small enough (< ~5k rows) and doesn't
    carry large per-row blobs.
  * **Precompute** — Python script reads HF dataset, writes JSON to
    `asset/data/`. Used for heavy subsets (articles with 12k rows +
    embeddings), networks, and cross-subset joins.
- **References Overview page block** (2026-04) — live-fetch exemplar:
  - `asset/js/charts/references-overview.js` paginates the `references`
    subset (864 rows, 9 parallel requests), then aggregates in the
    browser into summary / timeline-by-type / types / languages /
    top authors / top subjects
  - No Python step — drop the module in, activate, add the block
  - Registered as `referencesOverview` block layout

- **Collection Overview v0.2 expansion** (2026-04-10) — 13-panel block,
  hybrid architecture with shared primitives and per-panel modules:
  - Refreshed summary row: **11 cards** (Articles, Index, Total words,
    Total pages, Scanned pages, Unique sources, Document types,
    Audiovisual minutes, References, Countries, Languages). Dropped the
    confusing "1,501 Publications" card.
  - **Reusable primitives** under `asset/js/charts/shared/`:
    `pagination.js` (`P.buildPagination`), `table.js` (`P.buildTable`
    with text/link/date/badge/thumbnail/number render modes + client
    pagination), `facet-buttons.js` (`P.buildFacetButtons` with
    buttons-or-select auto rule + per-facet override).
  - **New ECharts builders** in `chart-options.js`: `C.gantt` (custom
    series, horizontal period bars), `C.wordcloud` (echarts-wordcloud
    with horizontal-bar fallback), `C.growthBar` (dual-axis bar +
    cumulative line), `C.stackedBar` (generic stacked bar).
  - **Treemap crash fixed** via defensive tree sanitization + dynamic
    `levels[]` array sized to max tree depth.
  - **Entities revamp**: 50 per type (was 10), client pagination at
    10/page, middle-ellipsis label truncation via `maxLabelLength: 30`.
  - **New panels** under `asset/js/charts/collection-overview/`:
    recent-additions (table with thumbnail/title/source/type/date,
    20/page), languages (facets: global / by type / by country),
    growth (monthly additions + cumulative), types-over-time
    (stacked, country facet), gantt (newspaper coverage periods,
    country + type facets), wordcloud (lazy, global / by country /
    by year facets), map (lazy MapLibre bubbles with type facet,
    GeoJSON plumbed for future choropleth).
  - **Three Python generators** emit `collection-overview.json`
    (extended), `collection-wordcloud.json`, `collection-map.json`.
    Wordcloud uses Unicode letter class to preserve `œ/æ/ÿ/ñ`.
    Country handling uses `parse_pipe_separated` across all aggregators
    so multi-tagged items contribute to each country independently.
  - **i18n**: new EN+FR keys for summary labels, chart titles, facet UI,
    item type badges. French labels use "Article de presse",
    "Périodique islamique", "Enregistrement audio-visuel".
  - **Lazy loading**: word cloud + map panels use `IntersectionObserver`
    with 200px rootMargin so sidecar JSONs only fetch when in view.
  - Design spec: `docs/superpowers/specs/2026-04-10-collection-overview-expansion-design.md`
  - Plan: `docs/superpowers/plans/2026-04-10-collection-overview-expansion.md`

## Next up

- [ ] **Audit Omeka resource templates** on islam.zmo.de → HF subset
      mapping. Needed before implementing any resource-page block
      (knowledge graph, per-item dashboards). User will point at the
      templates directly.
- [ ] **Per-entity page block** (live-fetch): the `index` subset is only
      4,697 rows with pre-aggregated `frequency` / `first_occurrence` /
      `last_occurrence` / `countries` — a good fit for the live-fetch
      path. One block per entity, keyed by `data-item-id` = Omeka
      `o:id`, fetching just the row that matches then optionally
      pulling related articles from a precomputed file.
- [ ] **Decide per-item JSON hosting** for precompute-backed per-item
      dashboards: commit ~5k entity dashboards to git, or generate
      into an Omeka volume at deploy time. Only relevant if the
      per-entity block ends up using precompute (e.g. for
      co-occurrence joins against articles).
- [ ] **Per-entity dashboard** (resource-page block attached to the
      `index`-backed item templates): timeline of mentions, top
      newspapers, co-occurring entities, geographic footprint.
      Generator will be `scripts/generate_entity_dashboards.py`.
- [ ] **Per-article page** (resource-page block attached to the
      "article de presse" template): 3-model AI sentiment comparison
      panel (centrality, polarity, subjectivity), LDA topic badge,
      readability + word count, entities mentioned (linked back to the
      authority pages).

## Later

- [ ] Semantic-neighbor "related articles" using `embedding_OCR` cosine
      similarity (precomputed kNN offline)
- [ ] Knowledge graph per entity — model on
      `iwac-dashboard/scripts/generate_knowledge_graph.py`
- [ ] World map page block — polygon choropleth of the 6 countries +
      marker clusters from `index` `Lieux` entries with `Coordonnées`
- [ ] Topic explorer page block — LDA 30-topic overview with drill-down
- [ ] Item-set dashboard — aggregate per Omeka item set

## Open questions

1. **Omeka template → HF subset mapping**: which templates map to
   `articles` vs `publications` vs `documents` vs `audiovisual` vs
   `index:{Personnes|Organisations|Lieux|...}`? Waiting on user input.
2. **audiovisual (45) / documents (26)** are tiny — skip per-item
   dashboards entirely and fold them into collection-level stats only?
3. **Hosting strategy** for 5k+ per-item JSONs — git vs deploy-time
   volume vs sharded index file.

## Deferred / orphaned

The following inherited assets from ResourceVisualizations are on disk
but **not loaded** anywhere. They exist only as reference patterns
while the rewrite is in progress and will be deleted once the
replacements land:

- `asset/js/dashboard-*.js` (20+ chart files under the old `RV`
  namespace)
- `asset/js/knowledge-graph.js`
- `asset/js/dashboard-compare.js`, `dashboard-compare-unify.js`
- `asset/js/dashboard-collab-network.js`

Their PHTML stubs (`knowledge-graph.phtml`, `linked-items-dashboard.phtml`,
`item-set-dashboard.phtml`, `compare-projects.phtml`) render a loading
spinner only — no chart code is wired yet.
