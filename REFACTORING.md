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

**Implementation status: shipped as v1.23.0 (2026-07-25).** Every Tier 6 item
below is DONE. Two items landed differently from how they were written up, and
say so inline: the 18 near-empty BlockLayout classes were *kept* (reduced to one
`const SLUG` each) rather than collapsed into a factory, and the two unreferenced
`dashboardLayout` exports were *documented as console aids* rather than deleted.
The pass also turned up three findings the audit had not: a duplicate-key trap in
the i18n dictionaries, a stale brand colour hiding inside an `rgba()` literal, and
the theme linter's own comment-blindness. All three are fixed and recorded below.

**2026-07-25 fourth pass:** a **top-down** audit of v1.22.0 — where the module
stores the same fact twice, where coupling points the wrong way, and what the
existing tooling doesn't cover — rather than another sweep for duplicated code
blocks (Tiers 1–5 already own those). New findings live in **Tier 6** below.
Headline: article dashboards never receive the issue-#7 data cache-buster (stale
JSON after every sync); 38 pre-v2.0.0 token fallbacks in the embed templates,
which the theme linter cannot see because it never scans `view/`; a block is
declared in four unreconciled places (the Tier 5 press-reprints regression was
that failure mode); and `P.bootBlock` — the page-block twin of the shipped
`bootPerItemDashboard` — is worth ~500 lines across 18 orchestrators.

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
- [ ] **Actions pinned to major tags** — still open (optional hardening); SHA pinning needs the real commit SHAs verified against upstream. The valid current majors were checked on 2026-08-01 (`checkout@v6`, `setup-python@v6`, `setup-node@v6`, `setup-php@v2`).
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

## Tier 6 — 2026-07-25 fourth audit (structural / single-source-of-truth pass)

Fourth repo-wide pass, run against `main` at v1.22.0. Tiers 1–5 worked
bottom-up (duplicated blocks of code → shared helper). This pass deliberately
looked **top-down** instead: where does the module keep the *same fact* in more
than one place, where does the coupling point the wrong way, and what does the
existing tooling not cover. Findings are therefore mostly new rather than
re-counts of the duplication clusters the earlier tiers track.

**Verified during this pass:** `php -l` clean across all 33 PHP/PHTML files;
99 exported shared-JS functions, only 2 unreferenced; slug ↔ filename ↔
`embedSlug` consistent across all 18 blocks (the Tier 5 press-reprints
regression stays fixed); `EmbedController::BLOCKS` labels all have matching
`@translate`-marked msgids via the block-layout classes.

### Correctness (fix first)

- [x] **Article dashboards miss the data cache-buster** — `dashboard-core.js:36`
  reads the sync stamp from `.iwac-vis-block[data-version]`, which
  `iwac-block-shell.phtml:85-90` emits. `article.phtml:139-142` hand-rolls its
  wrapper and emits only `item-id` / `base-path` / `site-base` — no
  `data-version`. On an article item page that block is the only IWAC block, so
  `ns.assetVersion` degrades to the module version alone and
  `article-dashboards/{id}.json` keeps its old `?v=` after a "Pull latest data"
  run. Article dashboards therefore serve **stale JSON from cache until the next
  module bump** — exactly the failure issue #7's stamp exists to prevent. Fixed
  for free by the `iwac-block-shell` migration below. **Effort S.**
- [x] **`article.phtml:56-58` enqueues the unminified sheet** —
  `css/blocks/article-dashboard.css` (466 lines, 14 KB) while
  `article-dashboard.min.css` is built and committed. Every other block loads
  `.min.css` through `iwac-assets`. Also the only raw `headLink` left in a block
  template, against the CLAUDE.md rule ("declare needs through
  `view/common/iwac-assets.phtml` — do not write raw headScript/headLink").
  Root cause: `iwac-assets.phtml:104-106` accepts a single `blockCss` string, so
  a block needing two sheets has no declarative option. **Fix:** let `blockCss`
  accept a string *or* an array, then pass
  `['person-dashboard', 'article-dashboard']`. **Effort S.**
- [x] **38 stale theme-token fallbacks in the embed views** — and these are the
  routes where fallbacks actually paint. `layout/embed.phtml` deliberately ships
  no compiled theme CSS ("faithful even when the compiled theme CSS isn't on
  this route"), so every `var(--x, #hex)` in the embed chrome renders **from the
  fallback**. All of them are pre-v2.0.0 values: `--primary` `#e64a19` (canonical
  `#ce4115`), `--ink` `#2c2f37` (`#13161c`), `--surface` `#fdfdfd` (`#fdfcfb`),
  `--background` `#f7f7f6` (`#f7f5f3`), `--border` `#d4d6da` (`#ced1d6`),
  `--ink-light` `#535862` (`#3f4349`), `--muted`, `--surface-raised`,
  `--surface-sunken`, `--border-light`, `--ink-strong`. Counts:
  `embed/index.phtml` ×31, `layout/embed.phtml` ×4, `embed/not-found.phtml` ×3.
  Meanwhile `iwac-theme.js`'s `FALLBACK_LIGHT` **is** current (lint rule 5
  covers it), so on the bare embed route the *charts* paint the new palette
  while the *page chrome around them* paints the old one — a visible mismatch
  on the snippet gallery (link hover `#e64a19` next to series `#ce4115`).
  **Effort S** (mechanical value swap), and see the lint-coverage item below for
  why it went unnoticed. **Verified against `tokens.json` this pass.**

### The linter's blind spot (root cause of the item above)

- [x] **`check-theme-tokens.js` scans `asset/css` + `asset/js` only** (`:46-47`),
  never `view/`. The module keeps ~217 lines of inline `<style>` in four
  templates — `embed/index.phtml` (133), `layout/embed.phtml` (34+19),
  `not-found.phtml` (18), `admin/data/index.phtml` (13) — all consuming theme
  tokens with hex fallbacks, none linted. Two options, not exclusive:
  1. **Add `view/**/*.phtml` to the walker** (rules 1/2/4/6 apply verbatim to a
     `<style>` block; rule 3's "bare hex" check needs the `<style>`-block
     extraction so PHP string literals aren't scanned). Cheapest, catches the
     class permanently.
  2. **Move the gallery CSS to `asset/css/blocks/embed-gallery.css`** — it then
     gets minified, cached across gallery visits, and linted for free. The
     `layout/embed.phtml` critical-CSS block is a legitimate inline (it must
     apply before any stylesheet lands on the bare route); keep that one inline
     and lint it in place. **Effort M.**

### Single source of truth — the block registry

- [x] **One block is declared in four places, none authoritative.** Adding a page
  block today means editing: `module.config.php` (invokable name →
  class), the `BlockLayout` subclass (label + description + partial path),
  `EmbedController::BLOCKS` (slug → label — a *second* copy of the label), and
  the template's `embedSlug` / `blockCss` / `orchestrator` strings. Nothing
  cross-checks them; the Tier 5 press-reprints regression (slug ≠ filename, every
  embed 500ing) is precisely this class of failure, and it survived two audits.
  **Fix:** one `Site\BlockRegistry` class holding
  `slug => [label, description, embeddable]`, consumed by
  `EmbedController::BLOCKS` (derive), by the block classes (label/description
  lookup), and asserted against the config invokables. **Effort M.**
- [x] **18 BlockLayout classes × 20 lines are pure declaration** — each supplies
  only `label()` / `description()` / `templateViewScript()`, and the template
  path is always `common/block-layout/<slug>`. With the registry above they
  collapse to one `ConfiguredBlockLayout` registered through a factory keyed by
  slug (`'factories' => array_map(...)` over the registry), deleting ~360 lines
  of files that exist only to hold two strings. **Assess before doing:** the
  per-class form is greppable and matches Omeka convention; the registry item
  above delivers most of the safety benefit on its own. **Effort M, optional.**

### JS — the boot epilogue (largest remaining duplication cluster)

- [x] **`P.bootBlock()` — ~500 lines across 18 orchestrators.** Every page-block
  orchestrator ends with the identical scaffold: guard `typeof echarts`,
  `querySelectorAll(selector)` loop, build `ctx` from
  `container.dataset.{basePath,siteBase}`, `P.fetchJSON(basePath +
  '/files/iwac-visualizations/<file>')`, `.catch` → `console.error` +
  `innerHTML = ''` + `P.buildFetchErrorState(err)`, then the
  `document.readyState === 'loading'` two-branch boot. Measured: 14–19 lines of
  epilogue × 18 files plus a 12–15-line `initBlock` each. `P.bootPerItemDashboard`
  (`panels.js:726`) is the proven precedent — the same extraction for
  *page* blocks was never done. Signature:
  `P.bootBlock({selector, dataFile, warnLabel, requireECharts, render})`, each
  orchestrator reduced to one call. Side benefits: the literal
  `'/files/iwac-visualizations/'` (25 source files today) gets one home, and the
  `container.innerHTML = ''` error path stops being re-derived per file.
  **Effort M, mechanical, output-identical.**
- [x] **`person-dashboard.js` ≈ `entity-dashboard.js`** — structurally identical
  layout registrations (same nine slots, same renderer keys, same
  `DL.fullSlice` accessors) plus three byte-identical predicates
  (`hasNewspapersData` / `hasTopicsData` / `hasSentimentData`), diverging only
  in the description i18n keys (`desc_*` vs `desc_entity_*`) and the person-only
  facet header. ~90 lines duplicated, and a slot added to one silently diverges
  from the other. **Fix:** shared `buildDashboardSlots(descPrefix)` +
  shared predicates; register `'person'` and `'entity'` from it. The differing
  copy stays (verified: 4 of the 5 `desc_entity_*` strings are genuinely
  reworded for entities — only `desc_entity_countries_covered` is byte-identical
  to its person twin and could collapse). **Effort S–M.**
- [x] **`panels.js` is a 941-line grab-bag** — DOM helpers, i18n proxies, status
  banners, GeoJSON/feature-state map helpers, panel + summary-card builders,
  select/search-dropdown controls, a playback timer, the per-item dashboard
  bootstrapper, and the force-graph toolbar. The module already established the
  split pattern for exactly this (`chart-options.js` → 5 files). Split along the
  existing section comments: `panels.js` (core DOM + states) ·
  `panels-controls.js` (select / search / playback) · `panels-map.js` (feature
  state, count features, map theme) · `panels-boot.js` (`bootPerItemDashboard` +
  the new `bootBlock`). No load-order risk — all four extend the same `P`
  namespace and `iwac-assets` already emits `panels.min.js` unconditionally.
  **Effort M.**
- [x] **Dead exports:** `DL.hasRenderer` (`dashboard-layout.js:105`) and
  `DL.listRenderers` (`:338`) have zero call sites — the only two of 99 exported
  shared functions that do. Keep if intended as a debugging API (say so in the
  docblock), else delete. **Effort S.**

### Assets shipped to every page

- [x] **~11 KB of `iwac-i18n.min.js` (23% of 48 KB) is an identity table.** 299
  of the 428 `en` entries map a key to itself, and `ns.t()` (`:1145`) *already*
  falls back to the key when no entry exists — so deleting them is
  provably behavior-identical (the `fr` lookup is tried first and unaffected;
  `DICTIONARY.en[key] !== undefined ? … : key` returns the same string either
  way). `iwac-i18n.min.js` is the module's **largest asset**, bigger than
  `iwac-core.min.css` (22 KB), and loads on every page with any block.
  **Trade-off to weigh:** the `en` table doubles as the discoverable list of
  valid keys. Keep the 129 non-identity entries (the `desc_*` sentences,
  `ref_type_*` maps, interpolated strings) and consider a comment block or a
  build-time check listing the identity keys instead. **Effort S, measure after.**
- [x] **`iwac-core.css:960-996` enumerates block-specific class names.** The
  shared form-control rule lists `.iwac-vis-keywords-filters__select`,
  `.iwac-vis-index-table-search`, `.iwac-vis-scary-select`,
  `.iwac-vis-spatial-picker__search`, `.iwac-vis-networks-toolbar__select`, … —
  the coupling points backwards: core has to learn every block's private class
  names, and the section comment admits it ("Add new selectors to the list below
  when a new form control is introduced"). Now that `P.buildSelectControl` and
  `P.buildSearchDropdown` (v1.22.0) construct these elements centrally, the fix
  is nearly free: have the builders add a shared `.iwac-vis-control` class and
  collapse the selector list to one. This also finishes part of the Tier 4 "core
  purity" item (`.iwac-vis-publication__body:693` and the
  `.iwac-vis-badge--publication:1130` remain). **Effort S–M.**

### Accessibility

- [x] **Loading and error states are silent for screen readers.** The shared
  spinner (`iwac-block-shell.phtml:118-121`, `P.buildLoadingState`
  `panels.js:217`) and every banner from `buildErrorState` / `buildNoDataState` /
  `buildEmptyState` are plain `<div>`s: no `role="status"`, no
  `aria-live="polite"`, no `aria-busy` on the block wrapper. Dashboards fetch for
  1–3 s and then swap the spinner for content, so a screen-reader user hears
  nothing at either end. The module is otherwise disciplined here (ECharts
  `aria.enabled` in `dashboard-core.js:79`, `:focus-visible` everywhere,
  `aria-live` on the pagination indicator `pagination.js:54`) — this is the one
  gap, and it is two attributes in two shared places covering all 20 blocks.
  **Effort S.**

### CI / tooling

- [x] **No PHP or Python check runs anywhere.** `build-check.yml` covers JS/CSS
  only; `regenerate-data.yml` executes the generators but doesn't lint them. A
  PHP syntax error in a template reaches production and 500s the site — the
  earlier audits noted `php -l` was simply unavailable in their environment.
  Add a `lint.yml` with `php -l` over `src/ view/ Module.php config/` (paths
  filter `**/*.php`, `**/*.phtml`) and `pyflakes scripts/*.py` (which Tier 5
  already got to a clean state manually, so it starts green). Both are seconds
  of runtime. **Effort S.** *(Confirmed clean this pass: `php -l` passes on all
  33 files.)*
- [x] **`.min` freshness is only checked on `main` pushes and PRs touching
  `asset/**`** — correct today, but a PR that edits only `view/` while relying on
  a stale committed `.min` slips through. Minor; note rather than fix.

### PHP smalls

- [x] **`SentimentExtractor::fromItem` reads each property twice** — `polarite`
  and `centralite` each go through `linkedItemId()` *and* `linkedItemLabel()`,
  and both call `firstValue()` → `$item->value(…, ['all' => true])` inside its
  own try/catch. That's 4 redundant `value()` calls per model, 12 per article.
  Fold to one `firstValueResource()` per property and read `id()` + `displayTitle()`
  off it. Behavior-identical; the try/catch stays. **Effort S.**

### Docs drift (mechanical, fix while nearby)

- [x] **`Module.php:11-19` describes an asset strategy that no longer exists** —
  "every block partial in this module enqueues its own stylesheet, CDN
  libraries, and JS dependencies via `$this->headLink` / `headScript`". Since
  v1.13 they declare needs through `common/iwac-assets`; the docblock's "mirror
  the asset-enqueueing pattern from `…/person.phtml`" (`:31-33`) now points at a
  file that enqueues nothing directly. A contributor following it writes exactly
  the template CLAUDE.md forbids. **Effort S.**
- [x] **`dashboard-core.js:9`** — "Load order (set by Module.php)"; it is set by
  `view/common/iwac-assets.phtml`. **Effort S.**
- **Tier 4 "Document the two bootstrap idioms" is moot — close it.** `P.setupOnView`
  no longer exists anywhere in the tree; all 20 orchestrators use the single
  `DOMContentLoaded` idiom (on-view deferral moved into the `iwac-assets` lazy
  loader). Superseded by the `P.bootBlock` item above.
- **Tier 5 verification note is stale in one line:** `truncateLabel` /
  `buildDataZoom` / `addClickHandler` are no longer *defined* either — they were
  removed, not just callerless.

### Found during implementation (not in the audit)

- [x] **Duplicate keys in the i18n dictionaries — 3 of them silently shadowing a
  different translation.** Surfaced by the identity-table trim: removing the
  `en` identity entry for `'No similar articles'` *changed* what `t()` returned,
  because the table declared that key twice and the later (identity) entry won.
  A full sweep found 8 duplicated keys across the two tables; three had
  divergent values, so one string was live and its twin dead:
  `en` `'No similar articles'` (`'No articles with similar content'` shadowed),
  `fr` `'No similar articles'` (`'Aucun article au contenu similaire'` shadowed),
  `fr` `'Subject co-occurrence'` (`'Cooccurrence des sujets'` shadowed).
  De-duplicated keeping the value the site renders **today** — so this fix is
  invisible to visitors — and the dead twins are gone. **The shadowed strings
  were arguably the better copy** ("Aucun article au contenu similaire" reads
  better than "Aucun article similaire"); switching to them is a copy decision,
  not a refactor, so it is left to the maintainer. Verified: all 429 declared
  keys resolve identically in both locales before and after.
- [x] **A pre-v2.0.0 brand colour hiding in an `rgba()` literal.** The gallery's
  copy-button focus ring fell back to `rgba(230, 74, 25, .4)` — `#e64a19`, the
  old orange, in a form no hex-based rule can see. It also used `outline: none`
  plus a box-shadow ring instead of the module's canonical focus pattern. Now
  `outline: 2px solid var(--focus-color, var(--primary, #ce4115))`, matching
  `iwac-core.css:587`. A tree-wide sweep found no other colour literal encoding
  a theme value this way (the three remaining `rgba()` uses are shadow
  fallbacks).
- [x] **The theme linter flagged its own documentation.** Extending it to
  templates immediately produced a false positive: `layout/embed.phtml`'s
  comment *explaining* the dark-mode accent shift ("#e64a19 → #ec653f") tripped
  the bare-hex rule. Comments are not CSS — the scanner now blanks comment
  interiors (preserving newlines so `file:line` stays exact) before applying
  rules 1–4, while deliberately keeping `/* allow-hex */` markers intact, since
  those *are* load-bearing. This latent false-positive applied to `asset/css`
  too; no sheet happened to have a comment mentioning a colour.

---

### False positives — do NOT "fix" these (Tier 6 additions)

- **`'Year × day calendar'` is not an i18n key mismatch.** `iwac-i18n.js:442`
  writes the key with a literal `×`, `:979` writes it as the `\u00d7` escape —
  the same string at runtime. A naive source-text diff of the two tables reports
  it as an `fr`-only key; it isn't.
- **`P.foldAccents` is not dead.** It has no direct call sites because both
  consumers alias it first (`var fold = P.foldAccents` — `entity-networks.js:30`,
  `spatial-exploration/picker.js:27`).
- **Raw `$primary` / `$secondary` output in `layout/embed.phtml:115-122` is
  correct**, and the existing comment explains why (CSS context; `escapeHtmlAttr`
  would emit `&#x23;` and truncate the declaration). Both values are hex-validated
  twice. Do not "fix" the escaping.
- **`$blockCss` is not sanitized like `$needs['renderers']` is** — deliberate
  asymmetry, not an oversight: renderer names come from a per-block array that a
  future caller might build dynamically, `blockCss` is a literal in a template.
  If `blockCss` gains array support (item above), keep it literal-only.

---

## Tier 7 — 2026-07-31 fifth audit (behavioral contracts + failure boundaries)

This pass reviewed current `main` at v1.30.0 after the stored-Hijri and
model-specific sentiment-column changes. It re-ran the existing theme, block,
minification and Python lint checks; inspected the Omeka controllers/events,
resource-page dispatch, sync job, shared JS runtime, generator utilities,
statistics/embedding kernels, workflows and documentation; and deliberately
looked for behavior the existing syntax-only CI could not falsify.

### Implemented in v1.31.0

- [x] **Behavioral CI, three runtimes.** Node's built-in test runner now covers
  i18n locale/interpolation, HTML escaping, one-shot lazy initialization and
  cache-busted JSON fetching. Python `unittest` covers IWAC country/pipe/date
  contracts, current+legacy sentiment-column resolution, column projection,
  embeddings, BH/G² statistics and stored Hijri dates. A dependency-free PHP
  runner stubs only Omeka/Laminas interfaces and exercises the real module
  classes: sentiment maps/filter/extraction, one-read-per-property, block
  registry, resource-template dispatch, sync status and ZIP path safety.
- [x] **One-row kNN returned itself.** `top_k_cosine()` computed `kk = 0` and
  then sliced with `[-0:]` (the whole array), returning `(self, -inf)` despite
  its contract. Singleton matrices now return `[[]]`; invalid batch sizes fail
  fast and nested embedding arrays are rejected instead of entering a matrix
  under a misleading dimension.
- [x] **Dunning G² omitted half of the contingency table.** The implementation
  summed only the token-present observations `a` and `b`; a binomial 2×2
  likelihood ratio also requires `total_a-a` and `total_b-b`. The complete
  table now drives significance/BH filtering. Ranking remains log-ratio based,
  but a regeneration is required because marginal significance decisions can
  change. Port the same correction to the sibling pipeline's older copy.
- [x] **Unknown-value drift across Python/JS.** Python recognized bilingual
  placeholders (`inconnu`, `n/a`, em dash, etc.) but did not trim; JS trimmed
  but recognized only `unknown`. Both now implement the same set, so stale or
  live-fetched placeholders do not become chart categories.
- [x] **Release version single-source guard.** `package-lock.json` still said
  1.28.0 while `package.json`/`module.ini` said 1.30.0. `check-versions.js`
  verifies all four declarations on every build.
- [x] **Duplicate-i18n-key guard.** The v1.23 audit found real shadowed keys but
  added no permanent check. `check-i18n.js` decodes source spellings (including
  Unicode escapes) and rejects duplicate runtime keys per locale. Its first run
  caught the same-valued French `Type` and `Authors` declarations; the redundant
  copies were removed without changing output.
- [x] **Sync extraction boundary hardened.** The job now caps entry count,
  individual expanded size and total expanded size; rejects NULs, traversal,
  absolute/Windows paths, symlinks and Unix special files; treats a `stopping`
  job as active; and removes only a stale job-scoped old-tree directory before
  an atomic retry.
- [x] **Mechanical documentation drift.** Page-block count 18→19, retired
  Compare Projects installation example, stale Scary Terms summary, build-size
  count 98→128, and the missing `images` entry in `scripts/README.md` fixed.

### Implemented in v1.32.0

- [x] **Reproducible Python environment.** The short direct-requirements file
  now compiles to a Python 3.12/Linux lock with hashes for every artifact. CI
  installs with `--require-hashes`; a recorded input digest and npm lint guard
  fail on drift. `uv==0.12.1` was verified upstream before pinning.
- [x] **Exact production integration.** A dedicated job downloads and verifies
  the official Omeka S 4.2.1 archive, imports its real schema, activates the
  module under PHP 8.5 + MariaDB 11.8, boots the application, resolves all
  registered layouts/controllers/templates/routes and exercises the real
  Laminas response-header path. No module-local Laminas/PSR packages were added.
- [x] **G² upstream handoff.** The complete-table correction is tracked in
  `fmadore/IWAC-Hugging-Face#8`, with a numerical reproduction and regression
  test contract. The upstream code remains intentionally untouched here.
- [x] **CSP composition.** Embed responses now rewrite `frame-ancestors` inside
  every existing policy while preserving unrelated directives; a missing CSP
  receives one policy. Multiple-header/list behavior has pure and real-Laminas
  coverage, including the Omeka 4.0-era implementation whose `Headers::get()`
  returns only the first generic header. Proxy-added headers still require
  proxy configuration.
- [x] **Browser/render regression suite.** Playwright runs the production
  minified CSS/JS in Chromium across desktop, French, dark mobile and
  single-panel embed cases, checking translation, snippets, overflow and panel
  selection. The first run caught missing French embed-control strings.
- [x] **Schema authority reconciliation.** The installed `iwac-data` skill now
  documents the private full mirror and public per-row-masked projection, all
  seven subsets, images/multimodal embeddings, reference OCR/LDA, stored Hijri
  fields and exact model-specific sentiment prefixes. The skill validator
  passes on the installed copy.
- [x] **Sync URL policy.** `SyncData` no longer accepts a caller-supplied URL;
  it constructs the fixed repository release URL from one encoded tag segment.
- [x] **Runnable action pins.** All workflows used nonexistent future `v7`
  tags for GitHub-maintained actions. Official upstream releases confirm v6 is
  current for checkout/setup-node/setup-python; every workflow now uses those
  valid majors, while setup-php remains on its documented rolling v2 tag.
- [x] **Declared-floor integration coverage.** The real-Omeka workflow is now
  a fail-independent matrix: literal floor Omeka S 4.0.0/PHP 8.1 plus the exact
  production Omeka S 4.2.1/PHP 8.5 pair. Both checksum-verified distributions
  hydrate and render a database-seeded page block through Omeka's API, service
  and view layers in addition to resolving every registered module service.
- [x] **Lazy Hugging Face client.** Pure `iwac_utils` imports now require only
  pandas. The heavyweight `datasets` client is imported inside the actual load
  boundary, retaining a focused install error for generators while keeping the
  normalization/statistics test environment lightweight.

### Remaining opportunities, prioritized

No P1/P2 opportunities from this audit remain open.

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
- `AbstractIwacBlockLayout` — all 19 page blocks extend it, supplying only
  label/description/template. Zero boilerplate.
- `iwac-block-shell.phtml` used by all 19 page-block templates.
- `SentimentExtractor` property readers genuinely folded onto one `firstValue()`.
- Escaping discipline across all templates (no unescaped resource data).
- Theme-swap path centralized: one `MutationObserver`, one `applyThemeToCharts`,
  MapLibre routed through `P.setMapTheme`; no panel registers its own listener.
- MapLibre color normalization centralized in `P.normalizeColorForMapLibre`
  (canvas-rasterized to dodge oklab/oklch rejection) — no paint property bypasses it.
- Python: 100% of generators write via `save_json` / load via
  `load_dataset_safe`; all use `BooleanOptionalAction` for `--minify`.
