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

- [x] **2.1 `scripts/generate_publication_dashboards.py`** — per-issue
      JSON under `asset/data/publication-dashboards/{o_id}.json`:
      metrics (pages, words, language, country), the issue's periodical
      run (per-`publisher` year histogram + position of this issue —
      sibling-sparkline shape), top-10 semantic neighbours via cosine
      kNN over `embedding_tableOfContents` (reuse the
      `generate_article_dashboards.py` kNN code), subjects/spatial of
      the issue. Standard CLI flags; `--limit` for dev.
- [x] **2.2 `publication.phtml` + dispatch.** `21 => 'publication'` in
      `TEMPLATE_PARTIALS`; partial declares layout + renderers
      (sibling-sparkline, similar-items, horizontal-bar) through
      `iwac-block-shell`.
- [x] **2.3 `publication-dashboard.js` orchestrator** — declarative
      `dashboardLayout` slots from day 1 (no bridge needed).
      **Data reality found during the build:** the live dataset carries
      a `tableOfContents` (and hence an embedding) for only **4 of
      1,501 issues** — the upstream ToC pipeline has barely started. So
      the dashboard leads with panels that work for every issue today
      (stat cards; the periodical-run sparkline; "other issues of this
      periodical" — the chronologically nearest issues in the same run)
      and keeps the semantic-neighbours slot wired but auto-elided
      until upstream coverage grows. Re-run the generator after each
      dataset update to light it up progressively.
- [x] **2.4 Periodicals Overview page block** — done:
      `generate_periodicals_overview.py` → `periodicals-overview.json`
      (4.6 KB; 25 runs / 1,501 issues / 1981–2024 verified),
      `PeriodicalsOverview.php` + phtml + `periodicals-overview.js`
      (summary cards, periodical-runs gantt with built-in dataZoom,
      issues-per-year stacked by country, languages on a log axis —
      Français is 99.9% — countries, top subjects).
- [x] **2.5 Generate + commit data** — 1,501 issue JSONs (~2.5 MB,
      avg 1.7 KB) + the periodicals bundle committed; version bumped.

## Phase 3 — Refactors: efficiency + modularity

- [x] **3.1 Split `compare-newspapers.js`** — done: 1,452 lines → a
      239-line orchestrator + 10 modules under `compare-newspapers/`
      (`helpers, picker, metrics, overlap, timeline, subjects,
      wordclouds, map, sentiment, newspapers`), every moved function
      verified byte-identical against the pre-refactor file (the only
      substitutions: `compareColors()`/`_uid` now route through the
      shared `helpers.js`). The phtml gained the ordered `panels` list.
- [x] **3.2 Python: shared dashboard-aggregation core** — done:
      `scripts/dashboard_aggregator.py` (933 lines, template-method
      base; `_role_slices()` is the person/entity override point).
      Person generator 1,051 → 337 lines, entity 892 → 281. Output
      verified **byte-identical** on samples — with one discovery worth
      keeping: entity output iterates raw string-key sets, so
      reproducible runs require `PYTHONHASHSEED=0` (true of the OLD
      code too; the verification pinned it for both sides).
- [x] **3.3 CLI normalization** — done across all 13 generators:
      `--minify/--no-minify` everywhere via BooleanOptionalAction with
      defaults matching prior behaviour (and fixing a latent bug:
      collection_overview's `--minify` flag was never wired to
      `save_json`); `--min-count` → `--min-cooccurrence` on
      compare-newspapers with the old spelling kept as a deprecated
      alias; `--limit` deliberately kept fan-out-only (a row cap would
      silently corrupt single-bundle analytics — rationale in
      `scripts/README.md`, which now documents the full flag table).
      Drive-by: `references_overview --help` no longer crashes on
      cp1252 Windows consoles.
- [ ] **3.4 (parked) Migrate collection/index/references overviews to
      `dashboardLayout`.** Possible (~50–80-line orchestrators) but low
      ROI vs. 3.1; scary-terms stays as-is (animation-stateful).

## Phase 4 — ECharts 6.1 / MapLibre 5.24 adoption

- [x] **4.1 Native `chord` series** (new in 6.0) replaces the
      `graph`+circular emulation in `C.chord` — ribbon widths finally
      encode co-occurrence magnitude. Same `{names, matrix}` contract,
      so the renderer + person co-occurrence panel needed no changes;
      the stale "ECharts dropped chord" docblock in
      `shared/renderers/chord.js` is fixed. *Needs a visual pass on the
      live site (4.8 session).*
- [x] **4.2 Graph `thumbnail` minimap** (6.0 component, opt-in via
      `C.network(…, {thumbnail: true})`) on the person association
      network and the article 3-layer context network; token-styled,
      auto-hidden ≤ 640px.
- [x] **4.3 Main-thread budget.** Index Overview panels now mount one
      macrotask apiece (yield between panels) instead of one
      synchronous 7-panel pass. Evaluated and *not* applied: heatmap
      `progressive` (the scary-terms co-occurrence matrix is ≤ ~20×20
      cells — nothing to chunk) and force-layout changes (the
      networks already freeze layout via `layoutAnimation: false`).
- [x] **4.4 Scatter jitter — evaluated, not applicable.** ECharts 6
      jitter lives on category/single axes only; lifespan × frequency
      is value × value and already blends overplot via 0.75 opacity.
      (A `C.beeswarm` builder with deterministic jitter already exists
      for single-axis cases.)
- [x] **4.5 `aria.enabled: true`** applied to every registered chart
      via `ns._applyAria` (merge-mode setOption after each render, so
      the notMerge render pattern and theme swaps can't drop it).
      Decal patterns deliberately left off → 7.2.
- [ ] **4.6 `matrix` coordinate system** for the scary-terms
      co-occurrence view (6.1 adds cell `triggerEvent`); foundation for
      the Phase 6 sentiment model-agreement matrix. *Deferred: the
      heatmap version works; converting is a visual rewrite that needs
      a live render-test session, not a blind swap.*
- [x] **4.7 MapLibre niceties.** `cooperativeGestures` now on for every
      IWAC map with fr/en hint strings via the map `locale` option
      (opt-out per map via `mapOptions`); popup `padding` turned out to
      be already shipped in `P.createIwacPopup`. GeoJSON `getBounds()`
      fit-simplification skipped — the only manual-bounds map
      (compare-newspapers) deliberately avoids fitBounds (Mecca/Paris
      outliers would zoom the view out of West Africa).
- [ ] **4.8 Re-test the v0.24.0 mobile grid presets against ECharts
      6.1's default auto axis-layout** (labels/names no longer overflow
      by default) — remove hand-tuned gutters that became redundant.
      *Needs a Playwright session against the live site after deploy —
      includes the 4.1 chord visual check.*
- **Won't do:** globe projection (editorial-product register, not
  research-instrument), color-relief/terrain (n/a to these maps).

## Phase 5 — Payload & deep performance

- [x] **5.1 Simplify `world_countries_simple.geojson`** — done with
      mapshaper (visvalingam 15%, keep-shapes, coordinate precision
      0.001°): **1,022 KB → 200 KB**, 242 features and the `name`
      property set verified identical (incl. the unaccented `Benin` /
      `Cote d'Ivoire` variants the map's `COUNTRY_ALIASES` already
      handles). The 6-country choropleth file is untouched.
- [x] **5.2 Split `index-overview.json`** — done: the generator now
      writes the chart aggregates to `index-overview.json` (**186 KB**,
      was 779) and the 4,385 table rows to a sibling
      `index-overview-table.json` (**567 KB**) that the orchestrator
      fetches only when the table panel nears the viewport. Combined
      with 1.4, the block's eager payload dropped from ~1.9 MB to
      ~190 KB.
- [x] **5.3 Per-block payload numbers recorded** (README + this file):
      Index Overview eager payload ~1.9 MB → ~190 KB (1.4 + 5.2);
      world map polygons 1,022 → 200 KB (5.1); publications fan-out
      avg 1.7 KB/issue; semantic landscape deliberately heavy
      (1 MB / ~300 KB gzipped, on-view only). A formal PageSpeed
      re-test against the deployed site belongs to the 4.8 live
      session.
- [ ] **5.4 DECISION (owner): self-host ECharts/MapLibre vs CDN.**
      Self-hosting = first-party origin, Omeka `?v=` versioning, no
      GDPR question (jsDelivr sees visitor IPs); CDN = better edge
      latency for the West-African audience vs a single German origin.
      Phase 1's exact pins + preconnect are the interim position either
      way.

## Phase 6 — New corpus-level visualizations

- [x] **6.1 Sentiment Atlas page block** — done:
      `generate_sentiment_atlas.py` → `sentiment-atlas.json` (10.4 KB).
      Per model: polarity + centralité over time (canonical stack
      order, 'Non applicable' excluded from stacks but captioned),
      polarity by country, subjectivity trend (one line per model via
      `--iwac-vis-model-*` tokens); cross-model agreement panel
      (pairwise % cards + pair-selectable 6×6 cross-tab heatmap).
      Every panel carries the AI-provenance sentence (en/fr).
      Side-finding worth knowing: pairwise polarity agreement is
      gemini↔chatgpt 71.0 %, chatgpt↔mistral 70.9 %, gemini↔mistral
      64.1 %.
- [x] **6.2 Semantic landscape page block** — done:
      `generate_semantic_landscape.py` (UMAP cosine, n_neighbors 15,
      random_state 42; umap-learn in the venv) emits a columnar bundle
      of **12,286 points** — `semantic-landscape.json` is 1,048 KB
      minified (titles dominate; ~300 KB gzipped, lazy-loaded on-view
      and only on pages carrying the block). Orchestrator renders
      per-category scatter series (Country / Decade / Topic facets,
      top-12 LDA topics + Other), progressive rendering, hidden axes,
      inside-dataZoom pan/zoom, click-through to articles. *Visual
      pass on the live site pending (4.8 session).*
- [x] **6.3 Lexical metrics block ("Press Language")** — done:
      `generate_lexical_metrics.py` → `lexical-metrics.json` (5.7 KB).
      Readability (Flesch FR) / lexical richness (TTR) / article
      length over time; newspapers ranked by readability and richness
      (≥ 50 articles, 31 qualify); per-country means; metric
      explanations in plain language in both locales.
- [x] **6.4 Item Set Dashboard.** Done — and cheaper than designed: no
      slug re-implementation needed. The orchestrator
      (`asset/js/charts/item-set-dashboard.js`) matches the item set's
      title (NFC + case-folded) against the corpus display names in
      `compare-newspapers/index.json` (newspapers before countries,
      articles before publications) and renders the matching
      single-corpus aggregate: summary cards + period subtitle, items
      per year, top subjects, spatial coverage, most-frequent words
      (wordcloud with hbar fallback). No new precompute. Item sets with
      no matching corpus remove the whole block client-side.
      *Caveat:* because assets lazy-load on-view, a non-matching item
      set shows the heading + spinner until the visitor scrolls near
      it, then the block disappears — acceptable, but if it bothers,
      the fix is a server-side corpus-name allowlist exported into the
      phtml at precompute time.
- [x] **6.5 References Overview enhancements** — already shipped
      pre-evaluation (discovered during Phase 1): the block carries a
      co-authorship force network and a country → type treemap since the
      v1.x precompute migration. No further work needed.

## Phase 7 — Visual / theming polish

The June 2026 CSS audit found **zero violations** of the IWAC theme
v2.0.0 rules — this phase is consolidation, not correction.

- [x] **7.1 Single source for AI-model colours — already satisfied.**
      Verified during implementation: `--iwac-vis-model-{gemini,
      chatgpt,mistral}` are defined exactly once in
      `iwac-core.css:79-81`; `article-dashboard/radar.js` and
      `article-dashboard.css` both consume them via `var()` with
      documented fallbacks (the audit had read the fallback values as
      duplication). Still a candidate for upstreaming into the IWAC
      theme.
- [ ] **7.2 Decal/accessibility review** after 4.5 lands: confirm
      colour-blind-safe distinction on the most colour-dense charts
      (types-over-time, sentiment stacks) without breaking the
      restrained register. Fold into the 4.8 live-site session.
- [x] **7.3 PHP translation catalog refresh** (v1.6.1) — done:
      `template.pot` + `fr.po` regenerated from the current sources —
      **58 entries** (was 17), covering every block label, admin
      description, and loading string from v1.5/v1.6; six
      retired-block entries dropped; `fr.mo` compiled via polib (no
      gettext on this machine — the README documents both compile
      paths). Also fixed `ReferencesOverview`'s stale "fetched live
      from Hugging Face" admin description while extracting it.

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
