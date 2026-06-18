# REFACTORING.md — IwacVisualizations

Findings from a repo-wide examination for refactoring opportunities, reusable
components, modularity, and **theme-token compliance** (proper use of the IWAC
theme's design tokens).

**Implementation status:** Tier 1 landed in **v1.8.2** (2026-06-17) — see the
checked items below. Tiers 2–3 pending. Each shipped batch bumps
`config/module.ini` + `package.json` and rebuilds the `.min` assets. Two Tier 1
items were reclassified to Tier 2 during implementation (rationale inline).

**Scope audited:** ~19,000 lines JS (186 source files), ~4,500 CSS, ~2,000 PHP,
~10,900 Python (23 generators + 2 shared modules). Five parallel deep dives
(shared JS infra · per-block JS · CSS/theme tokens · PHP/templates · Python),
with the highest-stakes findings independently verified.

**Conventions reminder for any change below:** bump `config/module.ini`
`version` (busts the `?v=` asset cache) + `package.json`; run `npm run build:js`
(and `build:css` for CSS); commit both source and `.min` siblings; run
`npm run lint && npm run check` before commit.

---

## Overall assessment: good bones, uneven adoption

This is a well-maintained, deliberately-refactored codebase — **not** one with
rot. A real shared toolkit exists (`P.buildPanel`, `buildFacetedChart`,
`buildErrorState`, `dashboardLayout`, `normalizeColorForMapLibre`; Python
`iwac_utils` + `dashboard_aggregator`). Escaping is clean (**no security
findings**). The theme bridge is solid and `color-mix(in oklab)` is used
throughout. The work is about **consistency and leverage**, not firefighting.

### Five cross-cutting themes

1. **Shared helpers exist but adoption is uneven** — the newest blocks hand-roll
   equivalents (~12 orchestrators open-code error/empty banners;
   sentiment-atlas/scary-terms/entity-networks skip `buildFacetButtons` /
   `buildFacetedChart`).
2. **Helpers exist but are copy-pasted at call sites** — `ml()` normalizer ×6;
   `translateLang`/`noopFacet`/`fetchJSON` wrappers; Python `_int_or_none`,
   `_first_country`, `_is_unknown`, `tokenize`/stopwords, the embedding/kNN
   stack (~250 lines), the dashboard CLI harness.
3. **A few monoliths never got the split their peers did** — `sentiment-atlas.js`
   (1013 lines, no folder), `scary-terms.js` (552-line `render`),
   `compare-newspapers/map.js` (388-line `buildMap`), Python
   `generate_collection_overview.py` (1166), the `sentiment_atlas` god-function.
4. **Theme-token compliance is strong, with specific gaps** — 640/600 breakpoint
   drift; `--ink-muted` phantom token; stale pre-v2.0.0 hex fallbacks. No HIGH
   violations.
5. **Small dead code / hygiene** — 3 dead JS exports, dead Python imports, empty
   `if` blocks, passthrough wrappers, doc nits.

---

## Tier 1 — Quick, safe, high-confidence (mechanical, behavior-preserving) — ✅ COMPLETE (v1.8.2)

Recommended first batch. Low blast radius; closes the only forward-compat
liability (PHP 8.4) and the most material theme gap (breakpoints).

- [x] **Snap `640px` → `600px`** breakpoints — **DONE (v1.8.2)**. Replaced
  `width: 640px)` in the 6 media-query sites across `iwac-core.css`,
  `iwac-maplibre.css`, and `blocks/{collection-overview,compare-newspapers,
  person-dashboard,scary-terms}.css`, plus the `sm: 640px` doc comment. Left the
  3 `min-height: 640px` rules untouched (those are sizing, not breakpoints — a
  blind replace would have corrupted them).
- [x] **Fix `--ink-muted` phantom token** — **DONE (v1.8.2)**. Removed the
  redundant inline `meta.style.{marginTop,fontSize,color}` overrides in
  `collection-overview/wordcloud.js`; the existing `.iwac-vis-wordcloud-meta`
  CSS rule already uses the correct `var(--muted)` / `var(--text-sm)` tokens, so
  deleting the inline styles both fixes the bug (was stuck on `#666`) and removes
  style-in-JS.
- [x] **Delete 3 dead namespace exports** — **DONE (v1.8.2)**. Removed
  `ns.truncateLabel` / `ns.buildDataZoom` / `ns.addClickHandler` from
  `dashboard-core.js`. `ns.toEntries` kept (used by `renderers/horizontal-bar.js`).
- [x] **Explicit-nullable `form()` params** — **DONE (v1.8.2)**.
  `AbstractIwacBlockLayout::form()` now takes `?SitePageRepresentation` /
  `?SitePageBlockRepresentation`. (Standard PHP 8 nullable syntax; `php -l` not
  run — php not on PATH in this env.)
- [x] **Replace hand-rolled error/empty banners** with `P.buildErrorState()` /
  `P.buildEmptyState()` — **DONE (v1.8.2)**. Converted **all ~42 sites**
  (orchestrators *and* panel modules, including the custom-key and two multi-line
  ones) via a verified context-free literal pass. Only the two helper
  definitions in `shared/panels.js` and the variable-driven `shared/table.js:151`
  remain (correct). Behaviorally identical.
- [ ] **Delete the `ml()` wrappers** — **➜ MOVED TO TIER 2**. On inspection each
  per-file `ml()` is a thin *guard* (`P.normalizeColorForMapLibre ? … : c`), not
  a byte-for-byte copy; dropping the guard belongs with the shared map-primitives
  work in Tier 2, not the "safe" batch.
- [ ] **getters never-falsy + drop `|| {}`/`|| [...]` guards** — **➜ MOVED TO
  TIER 2**. `getPalette()` / `getChartTokens()` *already* never return falsy
  (`iwac-theme.js:514-528`), so the guards are dead defensive code and the
  off-brand `#d97706` fallback in `chart-options-graph.js` never actually renders.
  Bundle this with the graph-builder refactor (`C._forceGraphBase`) in Tier 2
  rather than churn the file twice.
- [x] **Remove dead Python imports** — **DONE (v1.8.2)**. Dropped unused
  `create_metadata_block` (`generate_wordcloud.py`), `normalize_country`
  (`generate_keyword_explorer.py`), and the unused `_str_or_none` function
  (`generate_references_overview.py`). The JS empty-`if`s (`scary-terms.js`,
  `keywords-state.js`) are deferred to those files' Tier 2/3 rewrites to avoid
  editing soon-to-be-rewritten code twice.
- [x] **Corpus-B fallback consistency** — **DONE (v1.8.2)**. The 7 bare `#394f68`
  fallbacks in `blocks/compare-newspapers.css` now nest
  `var(--secondary, #394f68)`, matching the already-correct lines 252/487.

---

## Tier 2 — Shared-helper consolidation (clear reuse win, light verification)

### JavaScript
- [x] **`P.bootPerItemDashboard({selector, classToken, dataDir, layout,
  warnLabel, makeFacet, mountHeader})`** — **DONE (v1.8.3)**. Collapsed the
  triplicated boot sequence (fetch → spinner-swap → optional header → `DL.render`
  → error banner) in `person/entity/article-dashboard.js` to ~10-line configs;
  `noopFacet` now lives once inside the helper (`shared/panels.js`). The three
  orchestrators shrank ~60% each; header mount order preserved (behavior-identical).
- [ ] **Shared map primitives** `P.addBubbleLayer` / `P.resolveMapColors` /
  `P.computeBounds` — the bubble-map build + bounds scan is re-implemented across
  5 map panels (collection-overview, person-dashboard, index-overview/places-map,
  compare-newspapers, spatial-exploration). **Also fold in here:** the 6
  copy-pasted `ml()` guard wrappers (collection-overview/map:162,
  entity-networks/graph:48, person-dashboard/map:110, index-overview/places-map:131,
  spatial-exploration/map:35, shared/choropleth:83) → one shared guarded entry.
  *(reclassified from Tier 1)*
- [ ] **`C._forceGraphBase()`** shared by `C.network` (`chart-options-graph.js:50-314`)
  and `C.collaborationNetwork` (`:443-590`) — ~120 duplicated lines (identical
  force/scaleLimit/tooltip skeleton). **While in this file:** drop the dead
  `|| [...]` palette guards and the off-brand `#d97706` fallback arrays
  (`:57,343,450`) — `getPalette()` already never returns falsy, so they're dead
  code. *(reclassified from Tier 1)*
- [x] **Shared graph toolbar + click-through** — **DONE (v1.8.3)**. Added
  `P.buildGraphPanelToolbar(panelEl, chart, {downloadName})` (owns legend state,
  exposes `isLegendVisible()`) + `P.attachGraphClickThrough(chart, onNode)` to
  `shared/panels.js`; both network panels call them, dropping ~115 lines of
  duplicated toolbar / zoom / download / fullscreen / drag-suppression each. The
  only per-panel differences (download filename, centre-node guard, `o_id` check)
  stay at the call site.
- [ ] **Migrate hand-rolled person-dashboard panels** (`countries.js:26-46`,
  `newspapers.js:26-46`, `cooccurrence.js`, `sentiment.js`, `network.js`) onto
  the existing `P.buildFacetedChart` (half the folder already uses it).
- [ ] **Collapse `dashboard-core.js:353-380` `resolveCssVar`** into iwac-theme's
  cached `resolveCssColor` — removes per-call DOM append/remove churn on the
  heatmap/choropleth/map hot paths. ⚠️ **Deferred (behavior-sensitive):** the old
  probe resolves `var(--x, transparent)` *in-context*, while `readVar` returns the
  raw (possibly nested-`var()`) token, so equivalence is browser-context-specific.
  Needs Playwright color-equivalence checks on the live site before landing — not
  worth a blind change on a hot color path.
- [ ] **Add `C.hbar` + `ns.emptyChartOption(label)` + `ns.getHeatmapRamp()`** —
  the hbar option shape is copied 4× across compare-newspapers panels
  (`newspapers/sentiment/subjects/wordclouds`); the 5-stop heatmap ramp is
  resolved independently in `choropleth.js:89-103`,
  `chart-options-special.js:787-800`, `renderers/calendar-heatmap.js:82-91`.
- [ ] **Move `C.segmentedBar`** (`chart-options-special.js:571`) into
  `chart-options-hbar.js` and reuse `C._stableLabelColor` / `C._labelHalo`
  instead of its private ink-token fallback.
- [ ] **`map-popup.js:90-164`** — use `P.buildPagination` instead of its bespoke
  prev/next widget (it already reuses the CSS classes; `table.js` is the model).
- [x] **Promote `translateLang`** — **DONE (v1.8.3)**. Generalized to
  `P.translateKeyed(prefix, name)` in `shared/panels.js` (covers `lang_*` *and*
  `ref_type_*`); the locals in `references-overview.js` / `periodicals-overview.js`
  are now 1-line delegates, so the key-fallback logic lives in one place.
- [ ] **Promote accent-`fold()`** (`spatial-exploration/picker.js:27`) → shared util.

### Python
- [ ] **Shared dashboard harness** — `build_dashboard_arg_parser(default_subdir,
  extra_args=None)` + `run_dashboard(generator_cls, args)` in
  `dashboard_aggregator.py`. `generate_person_dashboards.py:274-333` and
  `generate_entity_dashboards.py:212-277` are near-identical CLI/`main`/`generate_all`.
- [ ] **`iwac_embeddings.py`** — `coerce_embedding`, `build_normalized_matrix`,
  `top_k_cosine(X, valid, k, batch_size=None)`. De-dups ~250 lines:
  `generate_article_dashboards.py:331-513`,
  `generate_publication_dashboards.py:207-334`,
  `generate_semantic_landscape.py:67-160`.
- [ ] **`ArticleDashboardGenerator` subclass `DashboardAggregator`** (or extract a
  free `build_entity_index(index_df)`) — `generate_article_dashboards.py:171-226`
  is a forked copy of `dashboard_aggregator.py:305-376` `build_entity_lookup`;
  `build_index_lookups` in `generate_compare_newspapers.py:266-342` is a 3rd variant.
- [ ] **Aggregation + scalar primitives in `iwac_utils.py`**: `count_pipe_field`,
  `top_n_entries(counter, n, name_to_oid=None)` (~15 inline copies, e.g. the
  duplicate `compute_newspapers`/`compute_newspaper_coverage` in
  collection_overview); `clean_int`, `first_country`, `is_unknown`,
  `clean_str_or_none` (~9 local copies across 8 files). Unify the inconsistent
  `== "unknown"` vs full `_is_unknown` token-set checks.
- [ ] **Shared sentiment constants + `tally_sentiment`** — `SENTIMENT_MODELS`,
  `POLARITE_ORDER`, `CENTRALITE_ORDER`, subjectivité buckets defined 2-3× across
  `dashboard_aggregator.py:114-142`, `generate_compare_newspapers.py:566-690`,
  `generate_sentiment_atlas.py:87-136`.
- [ ] **`iwac_text.py`** — `FR_STOPWORDS`, `CUSTOM_STOPWORDS`, `TOKEN_RE`,
  `tokenize` copy-pasted between `generate_wordcloud.py:45-86` and
  `generate_compare_newspapers.py:75-109`. **Do NOT add Islamic-domain research
  terms to the stopword set** (per CLAUDE.md).
- [ ] **`generate_collection_overview.py:417-444`** — use `iwac_utils.extract_month`
  instead of the fragile manual `YYYY-MM` slice.
- [ ] **`generate_entity_networks.py:80`** — import `DEFAULT_MIN_COOCCURRENCE`
  from `dashboard_aggregator` rather than redeclaring.

> ⚠️ **Confirm first:** the README claims `iwac_utils.py` is kept in sync with
> the sibling `iwac-dashboard` repo. If that constraint is live, new helpers
> land in both repos or the constraint is dropped.

### CSS — promote duplicated patterns into `iwac-core.css`
- [ ] **Aside / surface-card shell** — identical rule 3×:
  `spatial-exploration.css:23`, `entity-networks.css:27`,
  `index-overview.css:71` (+ scary-terms controls/def-card). → `.iwac-vis-aside`.
- [ ] **Picker list-item** — byte-identical: `spatial-exploration.css:103` &
  `entity-networks.css:256` (+ their `__item-name`/`__item-count`). →
  `.iwac-vis-list-item`.
- [ ] **Eyebrow / uppercase metadata label** — ≥8× in compare-newspapers + the
  sidebar-label variants. Core already has two near-versions
  (`.iwac-vis-summary-card__label:557`, `.iwac-vis-facets__label:717`). →
  one `.iwac-vis-eyebrow`.
- [ ] **Pill / chip base** — `compare-overlap__tag:362` & `scary-def-tag:497`
  overlap with core `.iwac-vis-chip:762` / `.iwac-vis-badge:933`. → `.iwac-vis-pill`.

---

## Tier 3 — Structural modularization (larger; follow the established split pattern)

- [ ] **Split `sentiment-atlas.js` (1013 lines, no folder)** →
  `sentiment-atlas/i18n.js` (the `:71-184` `addTranslations`),
  `sentiment-atlas/options.js` (11 builders `:215-594`),
  `sentiment-atlas/layout.js` (`buildLayout :626-727`), thin orchestrator. Promote
  the two ~80-line heatmap builders (`buildCentralityHeatmap`, `buildAgreementMatrix`)
  to a shared `C.heatmapMatrix({cells,xLabels,yLabels})`. Migrate facet wiring to
  `P.buildFacetedChart`. *(Model exemplars: `compare-newspapers.js`,
  `topic-explorer.js`, `spatial-exploration.js`.)*
- [ ] **De-monolith `scary-terms.js` (552-line `render :116-668`)** — extract
  `buildMatrixOption` (`:273-401`) to `chart-options-special.js`; add
  `scary-terms/controls.js` + `scary-terms/playback.js`; replace the hand-rolled
  view toggle (`:435-467`) with `P.buildFacetButtons`; drop the `fetchJSON`
  passthrough (`:108-110`). It's the only orchestrator carrying stale hardcoded
  color/font literals (`:282-301`).
- [ ] **Extract `entity-networks/toolbar.js`** from the 289-line `build`
  (`entity-networks.js:86-375`) — type chips, min-weight select, debounced search
  dropdown (the search is a reuse candidate alongside
  `spatial-exploration/picker.js`).
- [ ] **`compare-newspapers/map.js`** — hoist the per-call `CompareSelectorCtrl`
  class (`:358-413`) to module level; extract country-count/diff aggregation +
  paint-expression builders into the shared map helpers.
- [ ] **Migrate `article.phtml` onto `iwac-block-shell`** — it's the lone template
  of 18 still hand-rolling the `.iwac-vis-block` wrapper + spinner
  (`:139-149`). Add an optional `'innerHtml'`/`'append'` slot to the shell for the
  server-rendered sentiment `<section>`.
- [ ] **Centralize the AI-model roster** (names/orgs/short/logo) into one PHP
  constant (e.g. `Module::SENTIMENT_MODELS` or on `SentimentExtractor`) consumed
  by both the sentiment cards (`article.phtml:73-92`) and the radar label — model
  renames currently drift across `article.phtml` + `sentiment-atlas.phtml`.
- [ ] **De-dup template-ID magic numbers** — `minimal-item.phtml:47-51`
  re-declares `[9,19,22]` already in `Visualizations::TEMPLATE_PARTIALS`. Promote
  named constants, or pass the resolved `subset` down from the dispatcher.
- [ ] **`item-set-dashboard.js`** — the lone dashboard not using `DL.render`;
  migrate to a registered `itemSet` layout, or document the exception.
- [ ] **Python god-functions** — pull `generate_semantic_landscape.py:89-264`
  `main()` body into `build_semantic_landscape(...)`; split
  `generate_sentiment_atlas.py:217-448` `build_sentiment_atlas` into
  accumulate/shape helpers.
- [ ] **Standardize Python metadata + output-path conventions** — 4 different
  metadata strategies today (some `create_metadata_block` w/ `script_version`,
  some without, some inline dicts; spatial_exploration uses `_meta` not
  `metadata`). And relative `--output` resolves to module-root in 5 generators but
  is used raw in 7. Add a `resolve_output_path(arg, module_root)` helper;
  standardize `--output` (single file) vs `--output-dir` (fan-out).

---

## Verification notes

Confirmed by direct inspection during the audit:
- Theme `$sm = 600px` (`_breakpoints.scss`); module uses `640px` ×17 / 6 files.
- `truncateLabel` / `buildDataZoom` / `addClickHandler` — zero callers; `toEntries` used.
- `AbstractIwacBlockLayout::form()` uses implicit-nullable params.
- `--ink-muted` is referenced (`wordcloud.js:90`) but undefined by the theme.
- Corpus-B: `--iwac-compare-color-b` defined as `var(--secondary, #394f68)`; 7
  bare-hex fallback sites confirmed.

**Correction to one audit finding:** `article-dashboard/radar.js:40-42` was
flagged as "hardcoding colors instead of tokens." It actually reads
`cssVar('--iwac-vis-model-' + modelKey)` **first** and only falls back to the
hex — the sanctioned token-first pattern. **Not a violation.** At most, the
fallback hex values duplicate the token values (minor drift risk). No action
needed beyond optionally sourcing the fallbacks from a single constant.

## What's already right (don't "refactor" these away)
- `AbstractIwacBlockLayout` — all 12 page blocks extend it, supplying only
  label/description/template. Zero boilerplate.
- `iwac-block-shell.phtml` used by 17 of 18 templates (article.phtml is the holdout).
- `SentimentExtractor` property readers genuinely folded onto one `firstValue()`.
- Escaping discipline across all templates (no unescaped resource data).
- Theme-swap path centralized: one `MutationObserver`, one `applyThemeToCharts`,
  MapLibre routed through `P.setMapTheme`; no panel registers its own listener.
- MapLibre color normalization centralized in `P.normalizeColorForMapLibre`
  (canvas-rasterized to dodge oklab/oklch rejection) — no paint property bypasses it.
- Python: 100% of generators write via `save_json` / load via
  `load_dataset_safe`; all use `BooleanOptionalAction` for `--minify`.
