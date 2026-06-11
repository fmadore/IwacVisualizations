# IWAC Visualizations — Roadmap

Living roadmap **and implementation tracker** for the IwacVisualizations
Omeka S module. See [`README.md`](README.md) for the current
architecture and [`DATA_NOTES.md`](DATA_NOTES.md) for the Hugging Face
dataset schema.

**How tracking works:** the phases below come from the June 2026
full-module evaluation (JS / CSS / PHP / Python audits + ECharts 6.1 /
MapLibre 5.24 capability review + PageSpeed pass). Items are checked
off as the work lands, with the commit hash noted inline. Versions are
assigned at release time (one minor bump per phase-sized milestone, per
the module's cache-busting convention).

## Data source

- Hugging Face dataset: [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) — 6 subsets, ~19,420 rows.
- `o:id` in the dataset maps 1:1 to Omeka item IDs on <https://islam.zmo.de> → per-item JSON can be keyed directly by `o:id` and consumed by resource-page blocks via the existing `data-item-id` attribute.
- Updated roughly monthly; precompute is a manual developer step.
- Subset ↔ template map (verified 2026-06): `articles` = template 8,
  `publications` = template **21** (bibo:Issue, 1,501 issues),
  `documents` = template **22** (own template now; legacy items were on 8),
  `index` = templates 2/3/5/6/7, `references` = templates 10–14/17–18,
  `audiovisual` = templates 9/19. Photographs (template 15, class 58)
  are **not** exported to HF at all.

## Precompute reference

**`iwac-dashboard/scripts/`** — sibling SvelteKit dashboard with ~3,200
lines of working Python reading the same HF dataset. Reuse its patterns
before writing new generators. `iwac_utils.py` has been ported into
`scripts/`. See `scripts/README.md`. Always confirm field names against
the `iwac-dataset` skill / `DATA_NOTES.md` before coding.

---

## Phase 1 — Quick wins: performance, correctness, docs ✅ (v1.3.0)

Target: small, zero-risk changes with outsized PageSpeed / correctness
return. No data regeneration required.

- [x] **1.1 Pin exact CDN versions.** `view/common/iwac-assets.phtml`
      floats on `echarts@6` / `maplibre-gl@5` / `echarts-wordcloud@2`;
      the live site silently auto-upgraded to ECharts 6.1.0 on
      2026-05-19 with no test pass. Pin `echarts@6.1.0`,
      `maplibre-gl@5.24.0`, `echarts-wordcloud@2.1.0` — exact-version
      jsDelivr URLs are also immutable-cached (1 y) instead of
      redirect-resolved, improving repeat-visit LCP. Upgrades become a
      deliberate, tested bump of these constants.
- [x] **1.2 Preconnect to `cdn.jsdelivr.net`.** The on-view lazy loader
      means DNS + TLS starts only when a block nears the viewport; a
      `<link rel="preconnect">` from the head removes 100–200 ms from
      library load. Emit once from `iwac-assets.phtml`.
- [x] **1.3 Shared `P.fetchJSON()` + JSON cache-busting.** One fetch
      helper in `shared/panels.js` (consistent error handling,
      `same-origin` credentials) that appends `?v=<asset version>` to
      module-data URLs — the version is parsed at runtime from
      `dashboard-core.min.js`'s own `<script src>` query string, so JSON
      finally participates in the `config/module.ini` cache-bust
      convention (today a regenerated `asset/data/*.json` can be served
      stale for weeks). Migrate every fetch site: orchestrators
      (collection-overview, index-overview, references-overview,
      scary-terms, topic-explorer, compare-newspapers, person-, entity-,
      article-, minimal-item-dashboard), panels (wordcloud, map,
      places-map), `shared/choropleth.js`.
- [x] **1.4 Defer Index Overview Section B payloads.** The orchestrator
      fetches all four JSONs up-front (~1.9 MB pre-gzip; the three
      keyword-explorer files are 1.08 MB of it) even though Section B
      sits below Section A. Fetch keyword-explorer-*.json on-view via
      IntersectionObserver on the Section B container (fallback: on
      first interaction / immediately when IO unavailable).
- [x] **1.5 Fix documents/photograph template wiring.**
      `Visualizations::TEMPLATE_PARTIALS` maps Photograph (15) → the
      `documents` HF slice, but photographs aren't in HF — those pages
      show unrelated archival-documents data. Real document items moved
      to template 22 and get nothing. Add `22 => 'minimal-item'`
      (documents slice in `minimal-item.phtml`), drop 15, update README.
- [x] **1.6 Explicit `width`/`height` on table thumbnails**
      (`shared/table.js`) — CSS already reserves space, this is
      belt-and-braces for CLS and lets the browser size before style.
- [x] **1.7 Docs accuracy pass.** README: References Overview is
      precompute now (not live HF fetch); architecture/CSS listings
      missing article-dashboard / compare-newspapers / minimal-item /
      topic-explorer sheets + `build-css.js`; changelog entries v0.25 →
      v1.2 absent. `references-overview.js:8` stale live-fetch comment.
      (This ROADMAP rewrite removes the stale "Deferred / orphaned"
      section — the listed RV-namespace files were already deleted.)

## Phase 2 — Publications (template 21): the headline gap

The `publications` subset (1,501 Islamic-periodical issues; OCR,
`tableOfContents`, 768-dim `embedding_tableOfContents`, clean
`publisher` runs) is the one rich resource type with no visualization.

- [ ] **2.1 `scripts/generate_publication_dashboards.py`** — per-issue
      JSON under `asset/data/publication-dashboards/{o_id}.json`:
      metrics (pages, words, language, country), the issue's periodical
      run (per-`publisher` year histogram + position of this issue —
      sibling-sparkline shape), top-10 semantic neighbours via cosine
      kNN over `embedding_tableOfContents` (reuse the
      `generate_article_dashboards.py` kNN code), subjects/spatial of
      the issue. Standard CLI flags; `--limit` for dev.
- [ ] **2.2 `publication.phtml` + dispatch.** `21 => 'publication'` in
      `TEMPLATE_PARTIALS`; partial declares layout + renderers
      (sibling-sparkline, similar-items, horizontal-bar) through
      `iwac-block-shell`.
- [ ] **2.3 `publication-dashboard.js` orchestrator** — declarative
      `dashboardLayout` slots from day 1 (no bridge needed).
- [ ] **2.4 Periodicals Overview page block** — corpus-level view of the
      Islamic press: gantt of periodical runs (reuse the
      collection-overview gantt builder over `publications`),
      issues-per-year stacked by country, language split, top subjects.
      `generate_periodicals_overview.py` + BlockLayout + template +
      orchestrator.
- [ ] **2.5 Generate + commit data** (~1,501 JSONs + 1 bundle), bump
      version.

## Phase 3 — Refactors: efficiency + modularity

- [ ] **3.1 Split `compare-newspapers.js`** (1,452 lines — the last
      monolith) along its nine seams into
      `compare-newspapers/{picker,metrics,overlap,timeline,subjects,wordclouds,map,sentiment,newspapers}.js`
      + a ~200-line orchestrator, mirroring the v0.23.0 scary-terms
      split. No behaviour change; templates gain the `panels` list.
- [ ] **3.2 Python: shared dashboard-aggregation core.**
      `generate_person_dashboards.py` (1,051 lines) and
      `generate_entity_dashboards.py` (892) duplicate ~15 methods
      (`load_index`, `load_content`, `build_entity_lookup`,
      `resolve_items`, `build_document_frequency`, the `compute_*`
      family). Extract a shared `dashboard_aggregator.py` (role
      iteration as the override point; entity keeps its
      `by_role.all` wrap). Verify by diffing regenerated JSON against
      current output on a `--limit` sample.
- [ ] **3.3 CLI normalization** across generators: `--output-dir`,
      `--minify/--no-minify` (person/entity currently hardcode
      minify=True), `--limit` everywhere, `--min-cooccurrence` naming
      (compare-newspapers uses `--min-count`).
- [ ] **3.4 (parked) Migrate collection/index/references overviews to
      `dashboardLayout`.** Possible (~50–80-line orchestrators) but low
      ROI vs. 3.1; scary-terms stays as-is (animation-stateful).

## Phase 4 — ECharts 6.1 / MapLibre 5.24 adoption

- [ ] **4.1 Native `chord` series** (new in 6.0) replaces the
      `graph`+circular emulation in `C.chord` — ribbon widths finally
      encode co-occurrence magnitude. Fix the now-wrong "ECharts dropped
      chord" docblock in `shared/renderers/chord.js`.
- [ ] **4.2 Graph `thumbnail` minimap** (6.0) on the person association
      network and the article 3-layer context network.
- [ ] **4.3 Main-thread budget for heavy series.** Scary-terms
      co-occurrence heatmap → `progressive`; force networks → verify
      the correct 6.x mechanism per docs (`force.layoutAnimation` /
      precomputed layout) and apply; stagger Index Overview panel
      mounts (yield between panels).
- [ ] **4.4 Scatter jitter** (6.0) on Index Overview lifespan ×
      frequency to fix overplotting at low spans.
- [ ] **4.5 `aria.enabled: true`** in the built ECharts theme
      (screen-reader chart descriptions, zero visual change). Decal
      patterns: opt-in flag on stacked-bar builders, applied where
      series count is high — evaluate against the restrained register
      before defaulting on.
- [ ] **4.6 `matrix` coordinate system** for the scary-terms
      co-occurrence view (6.1 adds cell `triggerEvent`); foundation for
      the Phase 6 sentiment model-agreement matrix.
- [ ] **4.7 MapLibre niceties:** GeoJSON `source.getBounds()` to
      simplify fit-to-pins (article spatial map), popup `padding` near
      edges, `cooperativeGestures` enabled on page blocks now that the
      hint dialog is localizable via the map `locale` option (fr/en).
- [ ] **4.8 Re-test the v0.24.0 mobile grid presets against ECharts
      6.1's default auto axis-layout** (labels/names no longer overflow
      by default) — remove hand-tuned gutters that became redundant.
- **Won't do:** globe projection (editorial-product register, not
  research-instrument), color-relief/terrain (n/a to these maps).

## Phase 5 — Payload & deep performance

- [ ] **5.1 Simplify `world_countries_simple.geojson`** (1,022 KB →
      target ≤ ~300 KB via mapshaper/geometry simplification at the
      zoom levels actually used; verify the 6 IWAC countries keep
      crisp borders since they also exist in the dedicated 135 KB file).
- [ ] **5.2 Split `index-overview.json`** (779 KB): chart aggregates vs
      the full index-table rows; the table tab fetches its rows on
      demand. Generator emits two files; orchestrator stitches.
- [ ] **5.3 Audit per-block first-load payloads** after 5.1/5.2 and
      record the before/after in the README perf note.
- [ ] **5.4 DECISION (owner): self-host ECharts/MapLibre vs CDN.**
      Self-hosting = first-party origin, Omeka `?v=` versioning, no
      GDPR question (jsDelivr sees visitor IPs); CDN = better edge
      latency for the West-African audience vs a single German origin.
      Phase 1's exact pins + preconnect are the interim position either
      way.

## Phase 6 — New corpus-level visualizations

- [ ] **6.1 Sentiment Atlas page block.** The 3-model AI sentiment
      exists on all 12,287 articles but is only surfaced per-item.
      Corpus level: polarity over time (country facet),
      centrality-of-Islam trend, subjectivity distribution, and a
      model-agreement matrix (4.6). Generator aggregates the
      `{gemini,chatgpt,mistral}_*` columns; visual treatment follows
      the `.property--ai` convention (model dot-chips, tinted blocks).
- [ ] **6.2 Semantic landscape page block.** Precomputed 2-D UMAP of
      `embedding_OCR` (~12k points ≈ 200 KB JSON; `umap-learn` added to
      requirements, CPU fine), ECharts scatter with progressive
      rendering + dataZoom, colour by topic / country / decade facets,
      click-through to articles. The collection's "map of everything".
- [ ] **6.3 Lexical metrics block.** `Lisibilite_OCR`,
      `Richesse_Lexicale_OCR`, `nb_mots` over time by newspaper /
      country — "the language of the press".
- [ ] **6.4 Item Set Dashboard (template 4).** Newspapers are item
      sets, so this doubles as per-newspaper dashboards. Design:
      resource-page block reads the item set title server-side, slugs
      it with the same rules as `generate_compare_newspapers.py`, and
      loads the matching single-corpus aggregate
      (`compare-newspapers/{articles,publications}/newspaper-*.json` —
      already generated). Item sets with no matching corpus render
      nothing (same silent-skip rule as unsupported templates).
- [x] **6.5 References Overview enhancements** — already shipped
      pre-evaluation (discovered during Phase 1): the block carries a
      co-authorship force network and a country → type treemap since the
      v1.x precompute migration. No further work needed.

## Phase 7 — Visual / theming polish

The June 2026 CSS audit found **zero violations** of the IWAC theme
v2.0.0 rules — this phase is consolidation, not correction.

- [ ] **7.1 Single source for AI-model colours.** The Gemini / ChatGPT /
      Mistral hexes live in both `iwac-theme.js:79-81` and
      `asset/css/blocks/article-dashboard.css:207-209`. Define
      `--iwac-vis-model-{gemini,chatgpt,mistral}` custom properties
      once in `iwac-core.css`; JS reads them with fallbacks. Candidate
      for upstreaming into the IWAC theme later.
- [ ] **7.2 Decal/accessibility review** after 4.5 lands: confirm
      colour-blind-safe distinction on the most colour-dense charts
      (types-over-time, sentiment stacks) without breaking the
      restrained register.

---

## Open questions

1. **`audiovisual` (45) / `documents` (26)** are tiny — keep
   minimal-item only, or fold into collection-level stats entirely?
2. **Topic Explorer outliers** — `lda_topic_id == -1` rows (~2 %)
   hidden today; show as a 31st pseudo-topic?
3. **Phase 5.4** self-host vs CDN — owner decision (GDPR vs edge
   latency).

## Done — pre-evaluation history (condensed)

- **v1.2.0** (2026-06) — Press Archive grammar: almanac KPI figures,
  dot-chip badges.
- **v1.1.x** (2026-05/06) — lazy-load chart libraries on view; module
  CSS minified (`build-css.js`); `--secondary` consumed for chart
  series 2 / corpus B.
- **v1.0.0** — nested treemap with parent header bars.
- **v0.25.x** — theme fonts inherited (no hardcoded Inter/Noto Serif);
  topic-explorer data bundle fix.
- **v0.24.0** — Collection Overview mobile readability + chart polish.
- **v0.23.0** — maintainability pass: block-shell partial,
  chart-options split into core + 4 family files, scary-terms
  modularized, breakpoints normalized to 640/768/1024.
- **v0.22.0 / v0.20.0** — Compare Newspapers split-corpus + combined
  choropleths.
- **v0.21.0** — minimal-item dashboard for Audio (9) / Video (19) /
  Photograph (15; remapped in Phase 1.5) via
  `generate_template_summary.py`.
- **v0.19.0** — Person / Entity / Article orchestrators migrated to
  `dashboardLayout`.
- **v0.18.0** — choropleth toggle on every map; 6-country GeoJSON;
  Compare Projects block retired.
- **v0.16.0–v0.17.0** — declarative dashboard-layout system + 8 shared
  renderers; Topic Explorer block (LDA-30).
- **v0.9.0** — shared asset partial, `AbstractIwacBlockLayout`, shared
  JS helpers, feature-state hover, `iwac_utils.py` consolidation.
- **2026-04** — scaffold from ResourceVisualizations; theme + i18n
  infrastructure; HF dataset audit (`DATA_NOTES.md`); Collection /
  References / Index Overview, Scary Terms, Person / Entity / Article
  dashboards; per-item JSON hosting settled (committed to git).
