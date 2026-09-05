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

## Dashboard migration status

The deprecated [`iwac-dashboard`](https://github.com/fmadore/iwac-dashboard)
migration is **complete as of v1.12.0**. All retained dashboard
visualizations are represented in Omeka S page/resource blocks. The final
dashboard-only gap, Sources Map, is integrated into Collection Overview as
Source locations. `KnowledgeGraph` and `TopicNetwork` are deliberate
non-ports: do not add their generators, routes, UI, data contracts, i18n
strings, or Svelte/Sigma/Graphology dependency chain.

## Data source

- Hugging Face dataset: [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) — 6 subsets, ~19,420 rows.
- `o:id` in the dataset maps 1:1 to Omeka item IDs on <https://islam.zmo.de> → per-item JSON can be keyed directly by `o:id` and consumed by resource-page blocks via the existing `data-item-id` attribute.
- Updated roughly monthly; precompute is a manual developer step.
- Subset ↔ template map (verified 2026-06): `articles` = template 8,
  `publications` = template **21** (bibo:Issue, 1,501 issues),
  `documents` = template **22** (own template now; legacy items were on 8),
  `index` = templates 2/3/5/6/7, `references` = templates 10–14/17–18,
  `audiovisual` = templates 9/19/**23**. Photographs (template 15, class
  58) were **not** exported to HF when this note was written; they are the
  `images` subset since 2026-07.
- Template **23 (YouTube video)** joined class 38 on 2026-08-12 — same
  resource class as template 19, different provenance (ingested channel
  uploads rather than deposited media). Split the two on `source_type`,
  never on `medium`. See DATA_NOTES.md.

## Precompute reference

**Historical note:** `iwac-dashboard/scripts/` was the sibling SvelteKit
dashboard whose generators seeded several early module scripts. The
dashboard is now deprecated and no longer a migration backlog. This
module's `scripts/` directory is the source of truth; `iwac-dashboard`
should be consulted only as historical provenance when explaining an
already-ported visualization. Always confirm field names against the
`iwac-dataset` skill / `DATA_NOTES.md` before coding.

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
      (A `C.beeswarm` builder with deterministic jitter existed for
      single-axis cases; it never gained a caller and was removed in
      v1.59.0.)
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
- [x] **6.5 References Overview enhancements.** The block carries the
      v1.x co-authorship force network and country → type treemap, plus
      the dashboard-deprecation slice for references: top publishers,
      country-faceted publisher rankings in the JSON contract,
      provenance-map empty-state/geocoding contract, and subject
      co-occurrence chord data. `KnowledgeGraph` and `TopicNetwork` are
      intentionally not ported.
- [x] **6.6 Spatial Exploration + Entity Networks page blocks
      (v1.7.0)** — port of the standalone IWAC-spatial-overview
      dashboard's world map / country focus / entity drill-down and
      networks views onto module infrastructure.
      `generate_spatial_exploration.py` → `spatial-exploration.json`
      (148 KB: places + per-type picker indexes + country counts/
      bounds; per-entity data reuses the person-/entity-dashboards
      fan-outs, zero duplication). `generate_entity_networks.py`
      (networkx ForceAtlas2, seeded) → `entity-networks-global.json`
      (1,554 nodes / 7,356 edges, 183 KB) +
      `entity-networks-spatial.json` (508 / 11,030, 145 KB).
      **Renderer decision:** both networks draw with MapLibre GL —
      precomputed positions through inverse Web-Mercator, blank
      theme-aware canvas style (`P.buildGraphStyle`, new
      `styleMode: 'graph'` in shared/maplibre.js) — instead of
      ECharts graph (canvas roam jank at 7k+ edges, client-side force
      cost) or Sigma.js (second graph dependency duplicating MapLibre's
      WebGL + collision + popup + theming infrastructure).
- [x] **6.7 Sources Map + dashboard migration closure (v1.12.0).**
      The last retained `iwac-dashboard` visualization without an Omeka
      equivalent, `/spatial/sources`, is ported into Collection Overview.
      `generate_collection_overview.py` now writes `sources_map` into
      `collection-overview.json` using content-subset `source` fields,
      exact IWAC index coordinate joins, and the old dashboard's curated
      coordinate overrides for repositories/platforms not geocoded as
      authority records. `collection-overview/sources-map.js` renders a
      MapLibre bubble map plus ranked source table using shared popup,
      map, table, and i18n helpers. With this, dashboard deprecation is
      closed except for the explicit non-ports `KnowledgeGraph` and
      `TopicNetwork`.

## Phase 7 — Theme & i18n consolidation

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

## Phase 8 — Accessibility & motion (2026-07 audit)

The 2026-07-02 follow-up audit found one real accessibility hole and two
smaller ones. The code-hygiene siblings from the same audit live in
REFACTORING.md **Tier 4**.

- [x] **8.1 `prefers-reduced-motion` support** — **DONE (2026-07-02)**,
      with a better mechanism than planned: instead of a post-render merge
      (which cannot suppress the *initial* render animation — it is
      already in flight by merge time), `iwac-theme.js::buildTheme` bakes
      `animation: !prefersReducedMotion()` into the ECharts theme itself,
      applied at `init`. Option builders only ever set durations/easings,
      never `animation: true`, so the single theme switch silences initial
      AND update animation everywhere. Plus: the ResizeObserver resize
      animation honors it; a `change` listener rebuilds themes on a
      mid-session preference flip; and `iwac-core.css` zeroes
      `.iwac-vis-*` transitions under the query (spinner keeps its
      deliberate slow-spin override). **Audit correction:** the Scary
      Terms race has NO autoplay — `play()` is wired only to the Play
      button — so there was nothing to gate; under reduced motion its
      user-initiated frames now snap instead of easing, which is the
      correct behaviour.
- [x] **8.2 Touch targets** — **DONE (2026-07-02)**. Scary Terms playback
      buttons went 32px → `var(--size-control-lg, 2.75rem)` (44px WCAG
      target) — they are primary controls on that block. Panel-toolbar
      icons stay 32px as documented secondary affordances
      (`iwac-core.css` icon-button token comment).
- [x] **8.3 Focus-ring consistency** — **DONE (2026-07-02)**, and it
      uncovered a phantom token (the `--ink-muted` class of bug): six
      sites referenced `--focus-ring`, which the theme never defines — the
      canonical token per `tokens.json` is `--focus-color` (light
      `#ce4115`, dark `#ec653f`). All 15 focus outlines now share
      `outline: 2px solid var(--focus-color, var(--primary, #ce4115))`,
      so dark mode gets the theme's dedicated lighter focus colour
      instead of silently falling through to `--primary`.
- [ ] **8.4 Colour-blind / decal review** — unchanged from 7.2, still gated
      on the 4.8 live-site session.
- [ ] **8.5 Dark-mode spot checks (live session):** Scary Terms slider
      track on dark surfaces; the similarity badge over article thumbnails
      (`article-dashboard.css`) is contrast-risky.

## Phase 9 — New corpus visualizations, round 2 (2026-07 audit)

Checked against every existing panel and the explicit non-ports
(KnowledgeGraph / TopicNetwork / globe stay out). Ranked by research value
÷ effort. Payload discipline per Phase 5 applies (minify, lazy-load on
view, split heavy bundles).

- [x] **9.1 Topic dynamics over time** — **DONE (v1.20.0)**, cheaper than
      planned: the bundle's per-topic `year_distribution` arrays already
      carried everything, so it is a pure client-side panel (no generator
      change, no payload growth). 100%-stacked area (not themeRiver —
      cartesian axes + dataZoom read as research instrument, and the
      share encoding factors out corpus growth) of top-12 + "Other
      topics", tooltip sorted by share with raw counts, click a band to
      drill into the topic. Share math smoke-tested against the live
      bundle.
- [x] **9.2 Sentiment × topic** — **DONE (v1.20.0)**. "Polarity by
      topic" panel in the Atlas breakdown section, driven by the global
      model facet; categories show each topic's two top words.
      `generate_sentiment_atlas.py` 0.3.0 adds `polarity_by_topic` +
      the `topics` axis.
- [x] **9.3 Sentiment by newspaper** — **DONE (v1.20.0)**. "Polarity by
      newspaper" panel for the 31 outlets ≥ 50 articles (threshold
      shipped as `newspaper_min`, interpolated into the description).
      Both 9.2/9.3 panels self-elide when the deployed bundle predates
      their generator sections, so code ships safely ahead of the next
      data pull.
- [x] **9.4 Periodical holdings matrix** — **DONE (v1.20.0)**.
      Periodical × year issue-count heatmap under the runs gantt, same
      row order, so a blank cell inside a run reads as a collection gap.
      Regenerated bundle verified (44 years × 25 periodicals, 132 cells
      summing to exactly 1,501 issues). Introduces the generic
      `C.heatmapMatrix` builder the June audit wanted (Tier 3) —
      new-code-only; migrating the atlas's two bespoke heatmaps onto it
      stays gated on the live session. 4.6's matrix-coordinate rewrite
      can absorb it later.
- [x] **9.5 Semantic Landscape cluster labels** — **DONE (v1.20.0)**,
      with zero data change: per-topic label positions are computed
      client-side as the median x/y of each topic's points (the bundle
      already carries per-point topic indices; medians resist UMAP's
      stray points). Silent zero-symbol scatter overlay with
      `labelLayout.hideOverlap`, excluded from the legend, shown in
      every facet — the labels are the map's place names. Publications
      bundles carry no topic array, so their landscape stays unlabelled
      automatically.
- [x] **9.6 Term-trends explorer ("IWAC Ngram viewer")** — **DONE
      (2026-07-03)**. `generate_term_trends.py` → frequency-sorted search
      index (83 KB: 5,000 lemmas, per-year article totals for the
      share-of-articles normalization) + 25 lazy per-letter shards (max
      87 KB) keyed by ASCII-folded initial (shard_key mirrored in JS).
      New `term-trends` page block: search + suggestion dropdown, term
      chips (max 8), share/count toggle. Counting via the shared
      `tokenize` vocabulary so numbers agree with the collection
      word cloud.
- [x] **9.7 Rising/falling subjects bump chart** — **DONE (2026-07-03)**,
      pure client-side from the already-deferred keyword-explorer
      subjects bundle (no new precompute): decade top-8 ranks, lines
      break when a subject drops off, empty decades (stray 1910s rows)
      dropped. Verified: Coopération/Tabaski lead the 1960s;
      Paix/Prière/Terrorisme the 2010s; Covid-19 tops the 2020s.
- [x] **9.8 Geographic attention over time** — **DONE (2026-07-03)**.
      Always-on 6-country choropleth + year slider/play in the Keyword
      Explorer section, from the spatial bundle. `choropleth.js` gained
      `paint.fixedMax` so the ramp pins to the all-years max (honest
      cross-year comparison). Caveat: Nigeria sits outside the top-100
      spatial pool (no Nigerian press corpus) and renders as zero.
- [x] **9.9 Reprint / wire-copy detector** — **DONE (2026-07-03)** as the
      Press Reprints block. `iwac_embeddings.py` extracted (Tier 4) with
      `generate_reprints.py` as first consumer; the generator logs a
      0.90–0.99 similarity histogram on every build (the prototyped-
      thresholds evidence) and publishes cross-newspaper pairs ≥ 0.97.
      Verified live: 58 pairs / 13 newspapers, **median day gap 1** (the
      wire-copy signature); strongest circuits L'Observateur Paalga ↔
      Le Pays and LeFaso.net ↔ Sidwaya. The ≥ 0.99 bucket is dominated
      by same-newspaper duplicates (52 vs 8 cross) — excluded by design.
- [x] **9.10 Corpus-health dashboard (admin)** — **DONE (2026-07-03)**.
      `generate_corpus_health.py` → 1.7 KB bundle; the Sync Data admin
      page renders server-side meters from the synced copy (no JS,
      degrades silently pre-sync). Live numbers: ToC embeddings now
      **473/1,501 (31.5 %)**, Lieux geocoded 555/683 (81.3 %), articles
      sentiment/embeddings ~100 %, references full dates 8 %.
      DataController moved to a factory (file-store injection; ACL
      service name unchanged).
- [x] **9.11 Press Bylines page block** — **DONE (v1.19.0)**. The gate
      passed decisively: 78.7 % of articles carry an `author` byline
      (9,664 / 12,287; verified by column-selective parquet read after
      the HF statistics endpoint kept 500-ing), 2,463 distinct names,
      225 with ≥ 10 articles — and 184 of the top 200 match a
      `Personnes` authority record, so the block's bars click through to
      the existing person dashboards. `generate_press_bylines.py` →
      `press-bylines.json` (5.9 KB): coverage cards, signed-share per
      year, top-25 bylines with span / newspapers / subjects tooltips.
- [x] **9.12 On This Day page block** — **DONE (v1.19.0)**. Originally
      parked as editorial-register; the owner opted in as the module's
      one deliberate engagement hook. `generate_on_this_day.py` fans out
      `on-this-day/{MM-DD}.json` (366 files; 13,422 fully-dated items,
      5–91 per day). Deterministic daily picks spread across the
      decades; the block removes itself silently when data is absent, so
      it is homepage-safe.
- **Won't do (unchanged):** KnowledgeGraph, TopicNetwork, globe
  projection. A Compare Countries block is unnecessary — the Compare
  Newspapers picker already has a whole-country scope.

## Phase 10 — GitHub-issue backlog (triaged 2026-07-03)

All five open issues (#1–#5) were checked against the codebase on
2026-07-03; 10.1–10.4 shipped the same day (issues #1–#4 close on
merge). The issues predated the data decoupling (issue #7), so their
"commit JSON under `asset/data/`" instructions were read as the CI →
`data` release → SyncData pipeline.

- [x] **10.1 Scary Terms "Trends" view + event annotations
      ([#2](https://github.com/fmadore/IwacVisualizations/issues/2))** —
      **DONE (2026-07-03)**. Fifth view mode: line chart per family with
      `markLine` point events + `markArea` period band from the
      hand-curated `scary-terms-events.json` (**committed**, gitignore
      exception like sentiment-arbiter.json: 14 events + Algerian Civil
      War band, en/fr labels, provenance URLs; country-scoped events
      render only under that country's filter). The issue's claim that
      `scary-terms-temporal.json` was per-country was wrong — the
      generator now also emits `scary-terms-trends.json` (11 KB) with
      per-country series; the view falls back to the temporal bundle
      (global only) on deploys that predate it. Events toggle,
      `<details>` events list, label-free markers under 640 px.
- [x] **10.2 Scary Terms "Word cloud" view
      ([#4](https://github.com/fmadore/IwacVisualizations/issues/4))** —
      **DONE (2026-07-03)**. `scary-terms-wordcloud.json` (85 KB,
      lazy-fetched on first activation): document-frequency slices
      global / by family / by country / 5-year buckets over
      `lemma_nostop`, with the scary variants themselves excluded (they
      are the selection criterion). Renders through the shared
      `C.wordcloud` (hbar fallback included); facet bar via
      `P.buildFacetButtons` — single-select per module convention
      rather than the issue's multi-select chips. `<details>` word
      table with per-slice percentages. The stop-list was already
      shared (`iwac_utils.STOPWORDS`) — the issue's lift-request was
      satisfied back in v1.x.
- [x] **10.3 Scary Terms "Map" view
      ([#3](https://github.com/fmadore/IwacVisualizations/issues/3))** —
      **DONE (2026-07-03)**. `scary-terms-places.json` (107 KB, lazy):
      `articles.spatial` → geocoded `Lieux` joins (verified live: 295
      places ≥ 3 articles; 52 unresolved names logged). MapLibre bubble
      map on the shared stack (theme basemap swap, feature-state hover,
      canvas-normalized paint colors), family / article-country filters
      (mutually exclusive — the bundle has both splits, not their cross
      product), popups with item links, `<details>` places table.
      Deferred from the issue spec: the year-range slider (per-year
      data already ships in the bundle, so it lands later without a
      data change).
- [x] **10.4 Islamic organisations co-occurrence matrix
      ([#1](https://github.com/fmadore/IwacVisualizations/issues/1))** —
      **DONE (2026-07-03)**. `generate_org_cooccurrence.py` (±50-token
      window kernel from the issue) + editable
      `org_cooccurrence_targets.json` sidecar (six orgs, o_ids verified
      against the live index: UIB 765, CNI 653, COSIM 662, CSI 23601,
      FAIB 572, UMT 830; `cni`/`csi` acronyms deliberately excluded as
      matching targets — identity-card / media-regulator collisions —
      and each org's own acronym excluded from its context vocabulary).
      New page block renders through the shared `C.heatmapMatrix`
      (the prerequisite the issue demanded — landed as 9.4). Verified
      live: COSIM 876 articles (fofana, imam…), CNI 649 (idriss,
      koudouss…). Migrating Scary Terms' own matrix onto
      `C.heatmapMatrix` stays gated on the 4.8 live session (per 9.4).
- **10.5 Theme-aware timeline block
      ([#5](https://github.com/fmadore/IwacVisualizations/issues/5)) —
      DROPPED (owner decision, 2026-07-03).** The Knight Lab TimelineJS
      iframes stay as they are; the issue remains open as reference if
      the decision is ever revisited.

---

## Open questions

1. ~~**`audiovisual` (45) / `documents` (26)** are tiny — keep
   minimal-item only, or fold into collection-level stats entirely?~~ —
   **answered by the data (2026-08-13)**: `audiovisual` is no longer
   tiny. The YouTube ingest took it past a thousand rows in an
   afternoon, and v1.46.0 made the minimal-item block source-scoped
   rather than folding it away. `documents` (26) still qualifies.
2. ~~Topic Explorer outliers~~ — **moot (2026-07-03)**: the current
   dataset ships **0** `lda_topic_id == -1` rows (upstream now assigns
   every article a topic). The outlier-handling code stays as a guard
   for future dataset versions.
3. **Phase 5.4** self-host vs CDN — owner decision (GDPR vs edge
   latency). **Input from the 2026-09-05 audit (REFACTORING.md Tier 8,
   8.C / B1 / M14):** an order-preserving esbuild bundle is a
   zero-semantics first step independent of this decision; a
   tree-shaken `echarts/core` build of the 13 series types and ~14
   components in use is estimated at 30–40 % below the full CDN
   bundle; and the Carto basemap tiles raise the same visitor-IP
   question as jsDelivr, one request per tile per pan, so the
   decision should cover both (self-hosted style JSON + glyphs is
   the cheap half; PMTiles via `addProtocol` the fully first-party
   one).

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
