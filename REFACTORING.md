# REFACTORING.md — IwacVisualizations

Findings from a repo-wide examination for refactoring opportunities, reusable
components, modularity, and **theme-token compliance** (proper use of the IWAC
theme's design tokens).

**Implementation status:** Tier 1 (banner sweep + theme-token + dead-code wins,
landed v1.8.2) and the build-verifiable Tier 2 reuse helpers (`bootPerItemDashboard`,
`translateKeyed`, graph toolbar, `emptyChartOption`, on-brand graph palette —
landed v1.8.3) are **done and ship as v1.9.0** (2026-06-17), merged to `main`.
The remaining Tier 2 items + all of Tier 3 + the Python tier are deferred — see
the unchecked boxes and the "Deferred" note below: most touch map / graph /
heatmap **color rendering** that needs live Playwright verification. (The Python
tier is now **unblocked** — `iwac-dashboard` is deprecated, so `iwac_utils.py` has
no sync constraint.)

**2026-07-02 follow-up:** a second four-way audit (JS · Python · PHP/templates ·
CSS) covering the code that post-dates the June pass — the v1.14–v1.17 embed
stack, `SyncData`, the periodicals landscape — plus cross-block consistency.
New findings live in **Tier 4** below; June items the follow-up merely
re-confirmed stay in their original tiers. Accessibility/visual work and new
visualizations from the same audit are tracked in ROADMAP.md Phases 8–9.
The Tier 4 **quick wins** + ROADMAP **8.1–8.3** shipped as **v1.18.0**
(2026-07-02); the remaining Tier 4 items are open.

**2026-07-12 third pass:** a five-way audit (per-block JS · Python · PHP/
templates · CSS · docs/CI/build) of the **v1.19–v1.21.3 wave** (On This Day,
Press Bylines, Term Trends, Org Co-occurrence, Press Reprints, the Scary Terms
views, the Phase 9 panels, corpus health, the private-HF-repo move), plus
re-verification of open items. New findings live in **Tier 5** below; the
docs-only quick wins in it were applied in the same commit that added the tier.
Headline: one user-facing regression (the Press Reprints embed slug), stale
`fr.po`/`template.pot` for the v1.20+ blocks, and docs that still call the now-
private dataset "public".

**Scope audited:** ~19,000 lines JS (186 source files), ~4,500 CSS, ~2,000 PHP,
~10,900 Python (23 generators + 2 shared modules). Five parallel deep dives
(shared JS infra · per-block JS · CSS/theme tokens · PHP/templates · Python),
with the highest-stakes findings independently verified.

**Conventions reminder for any change below:** bump `config/module.ini`
`version` (busts the `?v=` asset cache) + `package.json`; run `npm run build:js`
(and `build:css` for CSS); commit both source and `.min` siblings; run
`npm run build` (which chains `lint:theme` + `build:js` + `build:css`) before
commit. *(Corrected 2026-07-12: this file used to say `npm run lint && npm run
check`, but no such scripts exist in `package.json`.)*

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
- [x] **On-brand graph palette fallbacks** — **DONE (v1.9.0)**. The off-brand
  `#d97706…` fallback arrays in `chart-options-graph.js` (`:57,343,450`) now mirror
  the module palette (`#e64a19, #394f68, …`), so a theme-JS-missing fallback render
  stays on-brand.
- [x] **`C._forceGraphBase()`** — **DONE (v1.22.0)** (reversing the June deferral: press-reprints added the cross-file copy the assessment said was missing). All three frozen-force skeletons now compose the shared base, option-for-option identical. Read both builders: the
  genuinely-shared `series` skeleton is only ~15 lines, it's a single-file *internal*
  dedup (no cross-file reuse), and extracting it means restructuring a large option
  literal in core graph rendering that the terser build can't validate. Low value
  vs visual risk on all four network views — revisit only with live verification.
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
- [x] **`P.emptyChartOption(label)`** — **DONE (v1.9.0)**. The centered "no data"
  ECharts title overlay (identical `fontSize:13`, center-middle) is now one helper
  in `shared/panels.js`; `compare-newspapers/{wordclouds,sentiment}.js` use it.
- [ ] **`C.hbar`** — **deferred (assessed).** The 4 compare-newspapers hbars are
  NOT near-identical: grouped 2-series (subjects) vs single-series, with
  legend / right-labels / grid-top / inverse-axis all differing. A single helper
  would add params without clear benefit and risk changing a chart — revisit w/ verify.
- [ ] **`ns.getHeatmapRamp()`** — **deferred.** 5-stop ramp dedup across
  `choropleth.js` / `chart-options-special.js` / `renderers/calendar-heatmap.js`;
  visual color output, needs live verification.
- [ ] **Move `C.segmentedBar`** (`chart-options-special.js:571`) into
  `chart-options-hbar.js` and reuse `C._stableLabelColor` / `C._labelHalo`
  instead of its private ink-token fallback.
- [ ] **`map-popup.js:90-164`** — use `P.buildPagination` instead of its bespoke
  prev/next widget (it already reuses the CSS classes; `table.js` is the model).
- [x] **Promote `translateLang`** — **DONE (v1.8.3)**. Generalized to
  `P.translateKeyed(prefix, name)` in `shared/panels.js` (covers `lang_*` *and*
  `ref_type_*`); the locals in `references-overview.js` / `periodicals-overview.js`
  are now 1-line delegates, so the key-fallback logic lives in one place.
- [x] **Promote accent-`fold()`** — **DONE (v1.22.0)** as `P.foldAccents`; entity-networks + spatial-exploration/picker alias it.

> **The unchecked JS items above are deliberately deferred** to a focused pass with
> live Playwright verification on `islam.zmo.de`. Most touch map / graph / heatmap
> **color rendering** (or, for the `buildFacetedChart` migration, facet-update
> behaviour) that the terser build can't confirm — shipping them blind risks subtle
> visual regressions. The safe, build-verifiable Tier 2 wins are done + merged.
> (`map-popup`→`buildPagination`, the `segmentedBar` move, and accent-`fold` are
> lower-risk but were time-boxed out of this pass.)

### Python
- [ ] **Shared dashboard harness** — `build_dashboard_arg_parser(default_subdir,
  extra_args=None)` + `run_dashboard(generator_cls, args)` in
  `dashboard_aggregator.py`. `generate_person_dashboards.py:274-333` and
  `generate_entity_dashboards.py:212-277` are near-identical CLI/`main`/`generate_all`.
- [ ] **`iwac_embeddings.py`** — module **created 2026-07-03** (ROADMAP 9.9)
  with `coerce_embedding`, `build_normalized_matrix`,
  `top_k_cosine(X, valid, k, batch_size=None)` + `pairs_above_threshold`;
  first consumer `generate_reprints.py`. Remaining: migrate the legacy
  copies one at a time with output-diff checks —
  `generate_article_dashboards.py:331-513`,
  `generate_publication_dashboards.py:207-334`,
  `generate_semantic_landscape.py:67-160`,
  `generate_periodicals_landscape.py` (the ×4 copy the July audit flagged).
- [ ] **`ArticleDashboardGenerator` subclass `DashboardAggregator`** (or extract a
  free `build_entity_index(index_df)`) — `generate_article_dashboards.py:171-226`
  is a forked copy of `dashboard_aggregator.py:305-376` `build_entity_lookup`;
  `build_index_lookups` in `generate_compare_newspapers.py:266-342` is a 3rd variant.
- [x] **`is_unknown` consolidated** — **DONE (v1.9.0)**. Added `is_unknown()` and
  `clean_int()` to `iwac_utils.py`; the 4 identical local `_is_unknown` copies
  (`lexical_metrics`, `periodicals_overview`, `references_overview`,
  `sentiment_atlas`) are now one-line aliases of the shared helper. `py_compile`
  clean; **byte-identical output unconfirmed** — generators need the live HF
  dataset, so re-run one on `--limit 5` to verify before regenerating data.
- [ ] **Remaining scalar/aggregation primitives** — consolidate `_int_or_none`
  (3 files) onto the new `clean_int`; add `first_country`, `clean_str_or_none`,
  `count_pipe_field`, `top_n_entries(counter, n, name_to_oid=None)` (~15 inline
  copies, incl. the duplicate `compute_newspapers`/`compute_newspaper_coverage` in
  collection_overview); fold the inline `== "unknown"` checks onto `is_unknown`.
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

> ✅ **Resolved (2026-06-18):** `iwac-dashboard` is being **deprecated** — there is
> no `iwac_utils.py` sync constraint. Add and refactor shared Python helpers freely
> here. *(Generators can't run in this environment — they hit the live HF dataset —
> so a Python refactor is `py_compile`-checked here; confirm byte-identical output by
> re-running the affected generator on `--limit 5`, the project's established check.)*

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

## Tier 4 — 2026-07 follow-up audit (new findings)

Second repo-wide pass (2026-07-02). Focus: code that post-dates the June
audit (the v1.14–v1.17 embed stack, `SyncData`, periodicals landscape) and
cross-block consistency the June pass missed. Two **false positives** are
documented at the end so a future cleanup pass doesn't trip on them.

### Quick wins (build-verifiable, low blast radius)

- [x] ~~spatial-exploration fetch hygiene~~ — **false positive, verified
  2026-07-02**: the only bare `fetch()` in the tree is inside `P.fetchJSON`
  itself; `spatial-exploration/state.js:101` already routes through
  `P.fetchJSON` and `selectEntity` has a proper `.catch` →
  `status: 'error'` path (`state.js:131`). Nothing to do.
- [x] **Zip-slip guard in `SyncData.php`** — **DONE (2026-07-02)**. The
  stage-extract step now validates every entry via `getNameIndex()` before
  `extractTo()`, rejecting empty / absolute / drive-letter / backslash /
  `..`-segment paths. Risk was LOW (the zip comes from the module's own
  GitHub release) — defense-in-depth for a job that writes into `files/`.
  (`php -l` unavailable in this env, per the June note; change follows the
  file's existing idiom.)
- [x] **`P.lazyInit(el, render, opts)`** — **DONE (2026-07-02)**. The
  IntersectionObserver arm-render-disconnect boilerplate was copy-pasted
  across 6 sites (`collection-overview/{map,sources-map,wordcloud}.js`,
  `index-overview/places-map.js`, and the two deferred-fetch gates in
  `index-overview.js` — one more than the audit counted). All now call the
  one-shot `P.lazyInit` helper in `shared/panels.js`; per-site `rootMargin`
  overrides preserved (`400px 0px` on the index-overview gates).
- [x] **Deterministic edge iteration in `generate_entity_networks.py`** —
  **DONE (2026-07-02)**, more surgically than the audit's "8 bare `.items()`
  loops" framing: most of those loops are commutative sums where order
  can't matter. The order actually leaks at two points, now fixed — the
  `pruned` dicts are built from `sorted(edge_weights.items())` (their
  insertion order steers the layout graph's edge order, hence ForceAtlas2's
  numeric path, and the equal-weight ties in the output), and the output
  edge sorts gained a total-order key `(-w, src, tgt)`. Output verification
  against live data belongs to the next CI regeneration.
- [x] **Block-local i18n extraction** — **DONE (2026-07-02)** for the four
  real cases: `sentiment-atlas/i18n.js` (~75 entries/locale — also the
  first step of the Tier 3 split), `semantic-landscape/i18n.js` (serves
  both landscape blocks; both phtml templates load it),
  `periodicals-overview/i18n.js`, `lexical-metrics/i18n.js`. Every table
  verified byte-identical against the removed original. Two audit-listed
  candidates were deliberately NOT extracted: `topic-explorer.js` has no
  inline table at all (audit miscount), and `item-set-dashboard.js`'s
  6-key table is smaller than the extra script request it would cost —
  left inline by design.

### JS consistency

- [ ] **Tooltip formatter helpers** — count+percent / label:value formatters
  are re-rolled inline in 8+ files (sentiment-atlas, references-overview,
  topic-explorer, …). Two or three canonical builders on `chart-options.js`
  would drop ~200 lines and unify tooltip typography.
- [ ] **Document the two bootstrap idioms** — ~8 older blocks boot through
  `P.setupOnView()` (the on-view lazy contract from `iwac-assets.phtml`);
  newer ones query-select and init eagerly. **Investigate before unifying** —
  the eager blocks may be deliberate. Deliverable is a decision + README
  note, not a blind migration.
- [ ] **Hardcoded UI grays in shared JS** — `choropleth.js` (`#fff`, `#ddd`),
  `maplibre.js` (`#999`, `#333`), `spatial-exploration/map.js`
  (`rgba(200,200,200,.3)`). `check-theme-tokens.js` polices CSS hex, not
  arbitrary JS literals, so these slip the lint. Verify each is a token-first
  fallback (the sanctioned pattern) and convert the ones that aren't;
  scary-terms' literals are already tracked in Tier 3.

### Python consolidation (beyond the June items)

- [ ] **`iwac_utils.add_standard_args(parser)` + run helper** — the June
  audit tracked a CLI harness for the two dashboard fan-outs only; in fact
  all 22 generators repeat the same ~20–30-line argparse /
  `configure_logging` prologue (~400–600 lines total). Pure plumbing,
  output-identical, `py_compile`-safe.
- [ ] **`build_timeline_series(df, …)`** — the year×country timeline
  aggregation is re-implemented in `generate_collection_overview.py`
  (`_build_timeline`), `dashboard_aggregator.py` (`compute_timeline`),
  references-overview and ~5 more. Largest single Python dedup not on the
  June list (~200 lines).
- [ ] **`build_wordcloud_series(df, text_col, …)`** — global / by-country /
  by-year Counter aggregation duplicated between `generate_wordcloud.py` and
  the periodicals word-cloud path; extract next to the June-tracked
  `iwac_text.py` stopwords/tokenize move.
- **June item upgraded:** `iwac_embeddings.py` — the kNN stack is now
  copy-pasted **×4** (v1.17's `generate_periodicals_landscape.py` added a
  fourth copy to the three the June audit counted).

### PHP / embed stack (first audit of the v1.14–v1.16 code)

- [ ] **SRI hashes on the pinned CDN assets** — optional; versions are
  already exact-pinned, so `integrity=` is a one-time lookup per bump.
  Decide together with ROADMAP 5.4 (self-hosting would make SRI moot).
- [x] **Everything else clean** — verified 2026-07-02: escaping/XSS (none
  found, again), EmbedController `?theme`/`?primary` whitelist validation,
  DataController CSRF, atomic swap + restore-on-failure in `SyncData`,
  module.ini ↔ package.json version lockstep, zero dead templates/classes.

### CSS (new clusters beyond the June aside/pill/eyebrow items)

- [ ] **Toggle/segmented-button family promotion** — `scary-view-btn` +
  `scary-ctrl-btn` (scary-terms.css), `networks-typechip`
  (entity-networks.css), compare-picker type buttons
  (compare-newspapers.css) all re-implement `.iwac-vis-tab` mechanics
  (~120 lines across 3 sheets).
- [ ] **Core purity pass** — ~350 block-specific lines have accreted into
  `iwac-core.css` (e.g. `.iwac-vis-publication__body`; the sparkline /
  similar-items sections are defensible as shared renderers). Extract so
  core stays "shared only" as the README promises.
- [ ] **Table header padding** — three divergent paddings (core,
  collection-overview.css + its mobile override) → one `clamp()` rule.
- [ ] **compare-newspapers empty state** re-implements the core empty state
  with different sizing → fold into core.
- [ ] **Drop the lone `!important`** (`entity-networks.css`, off-state chip
  dot) — switch to an `aria-disabled` / custom-property override instead.

### False positives — do NOT "fix" these

- **`generate_template_summary.py` is not dead code** — its output
  `template-summary.json` is fetched by `minimal-item-dashboard.js:80`.
- **`hf_xet` in `requirements.txt` is not unused** — it is auto-detected by
  `huggingface_hub` to accelerate Xet-backed dataset downloads; nothing
  imports it directly, and removing it would slow every generator's
  `load_dataset` against the (Xet-hosted) IWAC dataset.

---

## Tier 5 — 2026-07-12 third audit (the v1.19–v1.21.3 wave)

Third repo-wide pass. Focus: everything that post-dates v1.18.0 — the six new
page blocks, the Phase 9/10 panels, the private-HF-repo move — plus a status
check on the open Tier 2–4 items.

**Implementation status: shipped as v1.22.0 (2026-07-12).** Every Tier 5
item below is either DONE or carries an explicit assessed-out note. Items
the implementation pass deliberately did NOT do (with reasons) are marked
*assessed*; they are decisions, not leftovers. Five parallel deep dives; the highest-stakes
findings below were independently re-verified against the tree before being
recorded. Overall: the wave is **unusually disciplined** (token lint passes
with 0 violations, theme-swap compliance is clean, CI covers every generator,
zero minify orphans, zero TODOs) — but it also grew several known duplication
clusters instead of consuming the helpers that shipped alongside it.

### Bugs / user-facing (fix first)

- [x] **Press Reprints embed route is broken** — **DONE (v1.22.0)**: slug renamed to `press-reprints` in `EmbedController::BLOCKS` + `press-reprints.phtml`. — `EmbedController.php:55`
  registers the slug `'press-reprints-detector'`, and the embed contract
  (EmbedController docblock; `embed/block.phtml:14`) resolves the partial as
  `common/block-layout/<slug>` — but the template is `press-reprints.phtml`.
  It is the only one of 18 blocks where slug ≠ filename (all 17 others
  verified matching), so the gallery preview iframe, the whole-block embed,
  and every per-panel embed for this block 500 on a missing view script.
  `press-reprints.phtml:25` propagates the bad slug as `data-embed-slug`.
  Fix (simplest, no working snippet exists to break): rename the slug to
  `'press-reprints'` in both places. **Effort S.**
- [x] **`template.pot` / `fr.po` never re-extracted after v1.19** — **DONE (v1.22.0)**: 17 msgids added + translated, `fr.mo` rebuilt, all 116 entries verified via gettext load. — the
  catalogue (100 msgids, POT-Creation-Date 2026-06-12, header still says
  1.7.0) contains **zero** of the v1.20+ strings: `Term Trends`,
  `Press Reprints`, `Islamic Organisations Co-occurrence`,
  `Periodicals Semantic Landscape`, their admin descriptions and
  `Loading …` messages, and the corpus-health admin strings
  (`admin/data/index.phtml:63-69`). All render English on
  `/s/afrique_ouest/`. The source strings are correctly `@translate`-marked —
  only extraction+translation is missing (~12 msgids). **Effort M.**
- [x] **`embed/index.phtml:192`** — **DONE (v1.22.0)**: iframe title now translated. — iframe `title` uses the raw untranslated
  `$label` while the sibling `<h2>` (`:188`) translates it; the preview
  iframe's accessible name stays English under a French locale. **Effort S.**

### Docs drift — the private-HF-repo move (partly fixed 2026-07-12)

Commit `6948ed0b` switched `DATASET_ID` to the **private** full mirror
`fmadore/islam-west-africa-collection-full` (`iwac_utils.py:53`) and gave CI
`HF_TOKEN`, but touched no prose. Until this pass the docs actively misled: a
local contributor following them would hit an unexplained 401.

- [x] **Markdown corrections** — **DONE (2026-07-12, this commit)**:
  `scripts/README.md` (`HF_TOKEN` "not required — public" table row, header
  dataset link, stale `DATASET_ID` constant value, "dataset is public but
  large" troubleshooting entry), `CLAUDE.md:7,13`, `DATA_NOTES.md` header,
  `README.md:3`, plus the `README.md` block-table gaps (see below).
- [x] **Generator docstrings still say public** — **DONE (v1.22.0)**: all 11 docstrings + the 4 runtime 'anonymous access (public dataset)' log lines swept. —
  `generate_on_this_day.py:44`, `generate_press_bylines.py:38`,
  `generate_scary_terms.py:44-45` ("the dataset is public, so this is
  usually unnecessary"). Code-side, so left for a scripts commit (pushes to
  `main` touching `scripts/*.py` trigger the 30-min regeneration workflow —
  batch these with the next real generator change). **Effort S.**
- [x] **`load_dataset_safe` swallows the 401** — **DONE (v1.22.0)**: targeted 401/403 hint + a `columns=` projection parameter (see efficiency item below). (`iwac_utils.py:669-671`) —
  a tokenless local run gets a generic "Error loading subset" with no hint
  that `HF_TOKEN` is now required. Add a targeted 401/403 message. **Effort S.**
- [x] **`SUBSETS` constant stale** — **DONE (v1.22.0)**. (`iwac_utils.py:64`) — omits `"images"`,
  which `collection_overview` / `world_map` / `corpus_health` all load.
  Harmless (nothing validates against it) but misleading. **Effort S.**
- [x] **`generate_scary_terms.py:6` docstring off-by-one** — **DONE (v1.22.0)**. — says "the seven
  JSON files", then lists and writes eight. **Effort S.**

### README coverage (fixed 2026-07-12)

- [x] **Compare Newspapers missing from the block table** — a live registered
  page block (`module.config.php`, `CompareNewspapers.php`) with generator,
  JS, and CSS, absent from the 25-row status table while its output is
  referenced by the Item Set Dashboard row. Row added. **DONE (this commit).**
- [x] **"twelve page blocks" stale** — the Status intro predated the v1.19+
  wave; 18 page blocks are registered. Reworded. **DONE (this commit).**

### JS — the new-block wave

- [x] **`scary-terms.js:507-635` re-rolls the heatmap `C.heatmapMatrix` now
  owns** — **DONE (v1.22.0)**: composes the shared helper, which gained `cellLabels` / `cellBorder` / `xLabelRotate`; ramp + emphasis converge on the shared style (deliberate unification). — 128 hand-built lines (tooltip/grid/axes/visualMap/series) shipped
  in the same v1.20 wave as the shared helper; `org-cooccurrence.js:213` and
  `periodicals-overview.js:150` adopted it, scary-terms is the lone holdout
  and forks the heatmap look. Replace with a `C.heatmapMatrix` call (needs
  only the existing diagonal-skip cell filter). **Effort M.**
- [x] **`press-reprints.js:131-215` is a 4th copy of the force-graph build
  and skips the shared graph toolbar** — **DONE (v1.22.0)**: `C._forceGraphBase` extracted and adopted by all three in-tree copies; press-reprints gains the shared toolbar (new `legendToggle:false` opt; click-through stays off — nodes are newspapers, not items). — hand-rolls the `layout:'force'`
  series skeleton (the Tier 2 `C._forceGraphBase` candidate, which now has
  the cross-file justification it previously lacked — upgrade that item from
  "deferred") and never calls `P.buildGraphPanelToolbar` /
  `P.attachGraphClickThrough`, so this is the only IWAC network view with no
  download / legend / fullscreen / zoom controls. **Effort M.**
- [x] **Labelled-`<select>` builder ×4** — **DONE (v1.22.0)**: `P.buildSelectControl`; org-cooccurrence delegates, the three scary-terms copies collapsed into `scary-terms/controls.js`. — `org-cooccurrence.js:234-251`
  `buildSelect`, `scary-terms.js:794-813` `buildSelectGroup`, plus
  `scary-terms.js:829-849` and `:851-881` (two more copies inside the same
  file). One `P.buildSelectControl(label, options, current, onChange)` in
  `shared/panels.js` collapses all four. **Effort M.**
- [x] **`term-trends.js:123-267` hand-rolls the debounced search + suggestion
  dropdown** — **DONE (v1.22.0)**: `P.buildSearchDropdown` + `P.foldAccents` (the Tier 2 fold item); term-trends + entity-networks migrated. The spatial-exploration picker was **assessed out** — it is an always-visible filterable listbox, not a dropdown. — a 3rd implementation of the pattern Tier 3 already flags for
  entity-networks + spatial-exploration/picker (and `term-trends.css:54-119`
  is the matching 3rd CSS copy). Bundle into one `P.buildSearchDropdown`
  extraction covering all three. **Effort M.**
- [x] **Tier 4 tooltip-formatter item grew +5 copies** — **DONE (v1.22.0)**: `C.sortedAxisTooltip` on chart-options.js; 4 sites migrated with exact sort/skip semantics. press-bylines was a **false positive** — single-series, not the sorted-multi pattern; left as-is. — the sort-desc /
  drop-zero / bold-header axis formatter is re-rolled fresh at
  `press-bylines.js:85-95`, `term-trends.js:331-350`,
  `scary-terms/trends.js:131-142`, `topic-explorer.js:298-312`,
  `index-overview/keywords-bump.js:131-145`. The canonical
  `C.sortedAxisTooltip()` builder is now worth ~200 lines. **Effort M.**
- [x] **Playback controller ×2** — **DONE (v1.22.0)** as `P.createPlaybackTimer` (the interval state machine only); both consumers migrated. Full DOM unification **assessed out** — the two control shells are deliberately different UX. Bonus fix: switching views mid-race no longer leaves a phantom pause button. — `scary-terms.js:883-1023` (slider +
  play/pause + fill sync + interval) and
  `index-overview/keywords-attention.js:62-150` are independent
  implementations of the same animated-year control →
  `P.buildPlaybackControl({length, onFrame, tickMs})`. **Effort M.**
- [x] **`topicShortLabel` ×2** — **DONE (v1.22.0)**: `P.topicShortLabel`. — identical
  `split(' - ').slice(0,2).join(' · ')` derivation at
  `sentiment-atlas.js:141` and `semantic-landscape.js:152`. **Effort S.**
- [x] **Tier 3 scary-terms de-monolith is now more urgent** — **DONE (v1.22.0)**: `scary-terms/controls.js` extracted (orchestrator 1030 → 607 lines), `fetchJSON` passthrough dropped, dead `isAtEnd`/empty-`if` gone. The view toggle stays hand-rolled (**assessed**): it carries its own visual identity (`scary-view-btn`), and a `P.buildFacetButtons` conversion is a visual change needing live verification. — the file grew
  552 → 1030 lines (`render()` alone ~889 lines, `:139-1028`) while every
  Tier 3 sub-item stayed open: view toggle still not `P.buildFacetButtons`
  (`:746-783`), `fetchJSON` passthrough still present (`:131-133`), the
  empty-`if` + dead `isAtEnd` var still there (`:886-895`). Extract
  `scary-terms/controls.js` + `scary-terms/playback.js` and land the
  heatmap swap above. **Effort L.**
- [x] **JS hygiene smalls** — **DONE (v1.22.0)**: 640→600 threshold, dead `{threshold}` arg, unused `dataA`, and the document listener is now self-cleaning inside `P.buildSearchDropdown`. — `scary-terms.js:359` compact-mode threshold
  still `< 640` (CSS snapped to 600 in Tier 1; last 640 literal left);
  `press-reprints.js:99` passes a `{threshold}` interpolation no i18n string
  uses; `index-overview.js:38` `buildLayout(container, dataA)` — `dataA`
  unused; `term-trends.js:265` document-level click listener never removed
  (stacks if the block re-inits). **Effort S each.**

### Python — the new generators

- [x] **Tier 4 argparse-prologue item grew +8 copies** — **DONE for the 8 new generators (v1.22.0)**: `iwac_utils.add_standard_args` + `parse_standard_args`. The 14 older generators keep bespoke help texts — the original Tier 4 item stays open for them. — every new generator
  re-hand-rolls the ~25-line CLI/`configure_logging` block
  (`on_this_day:120-131`, `press_bylines:89-104`, `term_trends:148-194`,
  `org_cooccurrence:283-333`, `reprints:193-240`, `corpus_health:146-173`,
  `scary_terms:813-864`, `world_map:116-127`). The planned
  `iwac_utils.add_standard_args(parser)` is now worth ~600 lines. **Effort M.**
- [ ] **Tier 3 metadata/output-path drift grew** — **partially done (v1.22.0)**: `world_map` now emits `generate_timestamp()` (the `+00:00` outlier is gone). Full standardization is **deferred**: unifying the metadata key names changes output shapes the JS reads, so it needs a coordinated generator+JS pass verified against live data. — four coexisting metadata
  strategies after the wave: `{"metadata": create_metadata_block(…)}`
  (`press_bylines:171`), `{"_meta": …}` (`on_this_day:144`), inline
  `{"generated_at": …}` dicts with no helper (`term_trends:136`,
  `org_cooccurrence:271`, `reprints:160`, `corpus_health:183`, scary_terms
  `write_all`), and a hand-rolled `datetime.now(timezone.utc).isoformat()`
  (`world_map:107-112` — also the one generator emitting `+00:00` instead of
  the convention's `Z`; switch it to `generate_timestamp()`). `reprints` /
  `org_cooccurrence` / `corpus_health` also take `--output-dir` for
  single-file output. **Effort M.**
- [x] **Column projection in `load_dataset_safe`** — **DONE (v1.22.0)**: `columns=` via `select_columns` before `to_pandas`; on-this-day + press-bylines opt in (4 scalar columns each instead of OCR + 768-dim embeddings). — `on_this_day` and
  `press_bylines` need 4 string columns but materialize the full `articles`
  frame including `OCR` and the 768-dim `embedding_OCR` (hundreds of MB),
  because `load_dataset_safe` (`iwac_utils.py:636`) has no `columns=`
  passthrough. Adding one is the single biggest generator-efficiency win.
  **Effort M.**
- [x] **New shared-helper candidates** — `is_full_date`/`FULL_DATE_RE` **DONE (v1.22.0)** (on-this-day migrated; corpus-health keeps its looser prefix match deliberately — it measures date *precision* coverage). The Lieux-lookup and pair-matrix extractions were **assessed out**: the three Lieux consumers differ materially (aliases + coords vs frequency counts vs picker payloads) and the two pair kernels filter differently — a shared helper would be output-risky for little reuse. — full-date regex ×3
  (`on_this_day:66`, `corpus_health:43`, collection_overview's third
  notion → `iwac_utils.is_full_date()`); the Lieux geocoding join ×3
  (`scary_terms:649-673`, `world_map:40-70`, spatial_exploration →
  `build_lieux_lookup(index_df)`); the symmetric pair-matrix accumulation ×2
  (`org_cooccurrence:133-152`, `scary_terms:440-445`). **Effort S–M each.**
- [x] **Efficiency smalls** — on-this-day + press-bylines `iterrows()` → column-wise `zip` **DONE (v1.22.0)**. The org-cooccurrence OCR re-scan rework is **deferred** — it touches matching semantics and needs a live-data output diff before landing. — `org_cooccurrence.py:236-240` re-scans the full
  lowercased OCR per (article × org × target) before tokenizing; a single
  tokenize-per-article + token-set membership avoids the repeated passes.
  `iterrows()` on 12–14k-row frames at `on_this_day:97`,
  `press_bylines:70,120`, `scary_terms:280`, `org_cooccurrence:192`
  (`itertuples()`/`.iat[]` as `term_trends:92` already does). **Effort S–M.**
- [x] **Determinism defense-in-depth** — **DONE (v1.22.0)**: name tie-breaks at all four flagged sites; scary-terms country slices emit alphabetically. First CI regeneration may reorder count ties once. — output is deterministic today (fixed
  input + Counter insertion order) but not total-ordered: add name tiebreaks
  at `press_bylines:164-165`, `reprints:181-184`, and sort
  `scary_terms:735` (`out_places`) / `:471` (`finalized_countries`) like
  `build_countries` does. **Effort S.**
- [x] **Dead imports** — **DONE (v1.22.0)**, plus a pyflakes sweep that caught 5 more pre-existing items tree-wide (article-dashboards, compare-newspapers, index-overview, wordcloud, entity-networks' dead `pair_set`). pyflakes now exits clean. — `Optional` (`org_cooccurrence:50`), `Any`
  (`term_trends:42`). **Effort S.**

### CSS — the new sheets

- [x] **NEW cluster: block header/title/desc ×4** — **DONE (v1.22.0)**: `.iwac-vis-block-header/__title/__desc` in iwac-core; the four sheets keep only residuals (press-reprints' margin-bottom). — byte-identical modulo
  prefix at `press-reprints.css:14-31`, `term-trends.css:20-36`,
  `org-cooccurrence.css:21-37`, `scary-terms.css:30-49` (~24 lines each:
  flex-column header, font-headings `--text-2xl` title, muted
  `--measure-narrow` desc). Promote `.iwac-vis-block-header/__title/__desc`
  into `iwac-core.css` and reduce the four sheets to markup-only. **Effort M.**
- [x] **Known aside/surface-card cluster grew** — **DONE (v1.22.0)**: the Tier 2 `.iwac-vis-aside` promotion landed with five consumers (entity-networks, spatial-exploration, keyword-explorer sidebar, org-cooccurrence controls); block sheets keep layout residuals only. —
  `org-cooccurrence.css:45-55` (`-controls`) is one more copy of the
  panel-bg + `--border` + `--radius-md` + `--shadow-xs` shell; fold into the
  pending Tier 2 `.iwac-vis-aside` promotion. **Effort S.**
- [x] **Cosmetic** — **DONE (v1.22.0)**: on-this-day margin on the spacing scale; Besley fallback stacks unified. — `on-this-day.css:68` raw `margin-top: 2px` (the only
  non-tokenized length in the wave); the four new title rules use a
  `"Besley", Georgia, serif` fallback stack while `compare-newspapers.css:207`
  adds `"Times New Roman"` — pick one. **Effort S.**

### CI / infra (optional hardening)

- [x] **No JS/CSS CI** — **DONE (v1.22.0)**: `.github/workflows/build-check.yml` (token guard + stale-`.min` detection, narrow path triggers). — the only workflow is data regeneration;
  `npm run build` (token lint + minify freshness) is enforced purely
  locally. A lightweight push-triggered check would catch a forgotten
  `.min` rebuild or token violation. **Effort M.**
- [ ] **Actions pinned to major tags** — still open (optional hardening); SHA pinning needs the real commit SHAs verified against upstream, which the implementation environment could not reach. (`checkout@v7`, `setup-python@v6`),
  not commit SHAs — fine for this repo's risk profile; SHA-pinning is the
  hardening move if wanted. **Effort S.**

### Status changes to prior tiers

- **Tier 4 "PHP / embed stack — everything else clean (2026-07-02)"** —
  downgraded: the Press Reprints embed-slug regression above post-dates that
  verification. The *validation* logic it praised (theme/primary whitelists,
  CSRF, zip-slip guard) remains sound.
- **Tier 2 `C._forceGraphBase` "deferred (assessed)"** — reassess: the
  press-reprints copy gives it the cross-file reuse the assessment said it
  lacked.
- **Tier 2 `iwac_embeddings.py` migration** — no new legacy copies; the two
  new consumers (`reprints`, `corpus_health`) import it correctly. The 3
  legacy copies (article/publication dashboards, semantic + periodicals
  landscape) still await migration.
- **Tier 4 tooltip formatters / Tier 3 scary-terms / Tier 3 search-dropdown
  reuse** — all grew new copies this wave (see JS section).

### Verified clean this pass (don't re-audit)

- `npm run lint:theme` — 0 violations tree-wide; no bare hex, no
  `color-mix(in srgb)`, no 640px breakpoints, no phantom tokens in the new
  sheets. `--primary` usage is state-only (current-year figures, slider
  fill, focus) — the scary-terms slider gradient is a fill-progress
  indicator, not a decorative wash.
- Theme-swap compliance: every new chart registers via
  `IWACVis.registerChart`; zero private `MutationObserver` / `matchMedia`
  listeners; every new map goes through `P.createIwacMap`.
- A11y: `:focus-visible` on every new interactive element via
  `--focus-color`; the `--focus-ring` phantom is eliminated repo-wide; new
  44px tap targets; reduced-motion blanket in core covers the wave (no CSS
  animations shipped).
- CI generator coverage: all 27 HF generators run; `sentiment_arbiter`'s
  exclusion is deliberate and documented. Build scripts auto-discover files
  (no hardcoded lists); zero `.min` orphans across ~40 JS + ~34 CSS pairs;
  `module.ini` 1.21.3 == `package.json` 1.21.3; `.gitignore` exceptions
  correct for both committed sidecars.
- New-block PHP/templates: all five extend `AbstractIwacBlockLayout` with
  only label/description/template; all five use `iwac-block-shell`; escaping
  clean (again, no security findings); `SyncData` / `DataController`
  corpus-health additions sound.
- Python: single-scan `ArticleScan` design in scary_terms; vectorized
  collection-overview sweeps; `reprints`/`corpus_health` batched embeddings
  (no full n×n matrix); `term_trends.shard_key` documented byte-for-byte in
  sync with the JS `shardKey`.

### False positives — do NOT "fix" these (additions)

- **`periodicals-landscape` has no JS module by design** — the block reuses
  `semantic-landscape.js`; not a missing file.
- **Numeric `--space-N` / `--text-*` custom properties are the established
  module-wide convention** (used by `iwac-core.css` itself), not phantom
  tokens; only `compare-newspapers.css` uses the named `--space-{xs…}` scale.
- **`on_this_day.valid_day` accepting Feb 29 every year is intentional**
  (366 MM-DD bucket slots), though a malformed `2001-02-29` passes; document
  rather than "fix".

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
