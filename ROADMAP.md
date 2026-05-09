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
dataset. Reuse its patterns before writing new generators.
`iwac_utils.py` has been ported verbatim into `scripts/`. See
`scripts/README.md`.

## Done

- **Scaffold** (2026-04) — module structure forked from
  ResourceVisualizations; namespace renamed to `IwacVisualizations`;
  fresh git history; 200+ MB of stale precomputed data cleared.
- **Theme + i18n infrastructure** (2026-04) — `iwac-i18n.js`,
  `iwac-theme.js`, rewritten `dashboard-core.js` under the `IWACVis`
  namespace. ECharts themes are built from the IWAC theme's live CSS
  custom properties (`--primary`, `--ink`, `--surface`, ...), so chart
  colors always track the site's brand config and the light/dark
  toggle. `MutationObserver` on `body[data-theme]` re-renders every
  tracked chart when the user toggles.
- **Gettext catalog** (2026-04) — `language/template.pot`,
  `language/fr.po`; loading/UI strings covered for the first block.
- **HF dataset audit** (2026-04) — full schema for all 6 subsets
  documented in `DATA_NOTES.md`.
- **Collection Overview page block** (2026-04, expanded 2026-04-10) —
  13 panels: 11 summary cards, recent additions table, growth
  (monthly + cumulative), types-over-time, countries, languages, top
  entities (5 tabs × 50/type, paginated), gantt of newspaper
  coverage, lazy word cloud + world map.
- **Hybrid data strategy** (2026-04) — live-fetch + precompute paths
  documented in README, picked per-block based on subset size +
  per-row blob weight.
- **References Overview page block** (2026-04) — live-fetch exemplar:
  864 rows fetched in 9 parallel requests, aggregated client-side
  into 6 panels (timeline, types, languages, top authors, top
  subjects, summary cards). Drop-in: no Python step required.
- **Per-Person resource-page block** (2026-04-11) — 11 panels, global
  role facet, TF-IDF neighbor network, mentions timeline, year ×
  month heatmap, top newspapers, countries, top LDA topics, AI
  sentiment (3-model), associated locations map. Backed by
  `scripts/generate_person_dashboards.py`.
- **Per-Entity resource-page block** (2026-04) — same template
  dispatch as Person; reuses every Person panel for templates 2/3/6/7
  (`Lieux`, `Organisations`, `Sujets`, `Événements`). Backed by
  `scripts/generate_entity_dashboards.py`. **Resolves the original
  "audit Omeka resource templates" task** — the dispatch in
  `Visualizations::render()` lives in
  `src/Site/ResourcePageBlockLayout/Visualizations.php`.
- **Per-Article resource-page block** (2026-04-16) — `bibo:Article`
  template (id 8): 5 panels including 3-layer context network
  (article + entities + top related articles via shared-entity
  overlap) and top-10 semantic neighbours via cosine similarity over
  the 768-dim Gemini `embedding_OCR`. Backed by
  `scripts/generate_article_dashboards.py`.
- **Index Overview page block** (2026-04) — 7-panel Section A
  (entities by type, top entities, lifespan × frequency, places map,
  temporal extent, index table) plus Section B Keyword Explorer
  (Subjects + Spatial Coverage tabs, faceted by country / newspaper,
  Top frequent / Compare modes). Backed by
  `generate_index_overview.py` + `generate_keyword_explorer.py`.
- **Scary Terms page block** (2026-04) — bar chart race + by-country
  + global views over a curated set of "scary"/radical term families
  (terrorisme, djihadisme, extrémisme, …) from 1961–2025. Backed by
  `generate_scary_terms.py`.
- **Per-item JSON hosting** — settled in favour of "commit to git":
  ~12,287 article-dashboards, ~2,800 person-dashboards, ~1,550
  entity-dashboards committed in `asset/data/`.
- **v0.9.0 — refactor pass** (2026-04) — shared
  `view/common/iwac-assets.phtml` partial replaces 70-line
  `headLink`/`headScript` blocks per template. `AbstractIwacBlockLayout`
  base class collapses 5 near-identical block layouts to ~15 lines
  each. Shared JS helpers (`P.buildFacetedChart`,
  `P.buildCountFeatures`, `P.buildLoadingState`/`buildEmptyState`,
  `P.formatDate`, `P.attachFeatureStateHover`).
  `feature-state`-driven hover highlights on every map.
  `iwac_utils.py` upgraded with `canonical_country`, `clean_str`,
  `extract_month_num`, etc.
- **v0.16.0 — declarative dashboard layout + new renderers**
  (2026-05-09) — `IWACVis.dashboardLayout` slot/renderer/metadata
  registry with empty-payload predicate cascade. Seven new shared
  renderers under `asset/js/charts/shared/renderers/`:
  `calendar-heatmap`, `chord`, `radar-profile`, `sibling-sparkline`,
  `similar-items`, `sunburst`, `treemap`. ECharts theme swap migrated
  to `chart.setTheme()` (no more dispose+reinit). MapLibre per-map
  theme cache via `P.setMapTheme(map, mode)`. Composited PNG export
  with title/description/footer + font preload via
  `document.fonts.load`. See README v0.16.0 section.
- **v0.17.0 — Topic Explorer block** (2026-05-09) — first end-to-end
  consumer of the layout system. LDA-30 overview (clickable treemap
  + topic cards) with per-topic drill-down (calendar heatmap +
  country / newspaper distributions + most-representative articles).
  Eighth shared renderer added: `horizontal-bar`. Backed by
  `scripts/generate_topic_explorer.py`.
- **v0.18.0 — Choropleth on every map + Compare Projects retired**
  (2026-05-09) — single-button MapLibre control on every IWAC map
  that toggles between point-bubble view and a 6-country choropleth
  fill (Bénin, Burkina Faso, Côte d'Ivoire, Niger, Nigeria, Togo).
  Theme-aware paint via the `--iwac-vis-heatmap-*` ramp (same tokens
  the year × month and calendar heatmaps use, so light/dark
  propagates without manual re-paint). 6-country GeoJSON staged at
  `asset/data/iwac-countries.geojson` (138 KB, derived from Natural
  Earth via the `datasets/geo-countries` repository). Wired on
  Collection Overview, Index Overview Places map, and the
  Person / Entity locations map (4 of 4 in-scope maps). Compare
  Newspapers' geographic-comparison map needs `country` per point
  in its precompute output before its choropleth can light up —
  see "Next up" below. The orphan `Compare Projects` block layout
  (placeholder, no orchestrator) was removed: only Compare
  Newspapers ships in this module.

## Next up

- [ ] **Item Set Dashboard resource-page block** — registered
      placeholder; binds to template 4 (`Item set`). The natural
      next pick: aggregate Collection Overview panels filtered to a
      specific item set's membership. Reuses every existing
      Collection Overview generator with an item-set filter and
      consumes the v0.16.0 dashboard-layout system from day 1
      (no migration cost).
- [ ] **Migrate existing dashboards to `dashboardLayout`** — Person,
      Entity, and Article orchestrators are still hand-rolled.
      Converting each to a declarative layout array shrinks the
      orchestrator by ~150 lines and lets new chart types drop in
      via a single slot edit. Low-risk, behind-the-scenes — do
      alongside Item Set Dashboard so the latter validates against
      a freshly-migrated Person dashboard's slot vocabulary.
- [ ] **Compare Newspapers choropleth** (v0.18.0 follow-up) — wire
      the geographic-comparison map's choropleth toggle. Needs
      `scripts/generate_compare_newspapers.py` to emit a `country`
      property on every `geo_points` entry (currently only
      `name / lng / lat / count / o_id`). Once the generator emits
      it, the orchestrator can compute per-corpus country counts
      and call `P.attachChoroplethToggle` like the other maps. ~300
      JSON files to regenerate.
- [ ] **Resource templates audit (informational)** — the live Omeka S
      installation at `islam.zmo.de` exposes 19 resource templates;
      6 are already wired (Person/5, Location/6, Organization/7,
      Newspaper article/8, Topic/3, Event/2). Untapped: Item set/4
      (placeholder ready), Audio/9, Book and friends/10–14 + 17–18
      (covered by References Overview at corpus level — likely no
      need for per-item dashboards), Photograph/15, Blog post/16,
      Video recording/19, Media/20. Audio + Video together = 45
      items (the audiovisual subset); Photograph alone is a
      candidate for a small dedicated dashboard but ROI is low.

## Later

- [ ] **Knowledge graph per entity** — model on
      `iwac-dashboard/scripts/generate_knowledge_graph.py`. Dedicated
      resource-page block; force-directed graph at corpus scale with
      filters per entity type.
- [ ] **World map page block — choropleth** — polygon choropleth of
      the 6 IWAC countries with a metric picker (article count, index
      entries, sentiment polarity). The Index Overview *Places map*
      already covers point-level mention bubbles, so this is
      complementary, not a replacement.
- [ ] **Country dashboards** — per-country resource-page block (or
      page block keyed by country slug) reusing entity-dashboard
      panels with the country slice as the data filter.
- [ ] **Cross-entity timelines** — chord / sankey of how entities
      co-travel across the corpus over time.

## Open questions

1. **`audiovisual` (45) / `documents` (26)** are tiny — skip per-item
   dashboards entirely and fold them into collection-level stats only?
2. **Topic Explorer outliers** — `lda_topic_id == -1` rows (~2 % of
   articles) should they be hidden or shown as a 31st pseudo-topic?

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
