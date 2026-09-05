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

**2026-09-05 sixth pass:** a modernisation audit of **v1.58.0** against
current ECharts 6.1 / MapLibre 6.x practice — reactive rendering, controls,
dashboards, facets, deep links — rather than another duplication sweep. Five
parallel deep dives (ECharts · MapLibre · state/controls · Python ·
PHP/CSS/build/CI); every High finding re-verified by the lead. New findings
live in **Tier 8** below, with a suggested implementation order. Headline:
the aria re-description patch makes every chart render four update passes;
one block in twenty-one is deep-linkable; the two control-dense blocks
destroy keyboard focus on every change; a WebGL2-less device gets an empty
map or a whole-block error because the gate never catches the constructor
throw; ~92 dataset loads per CI run with no cache; and the CI path filters
let a view-only PR skip `lint:theme` / `lint:blocks`. Two mechanical doc
fixes (the page-block count in README.md and PRODUCT.md) were applied in the
same commit that added the tier.

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

## Tier 8 — 2026-09-05 sixth audit (modernisation: reactive charts, controls, dashboards, facets)

This pass reviewed current `main` at **v1.58.0** (after the v1.57 record
layout, the audiovisual block and the fifth sentiment rater). Unlike Tiers 4–7,
which hunted duplication and single-source-of-truth drift, it asks a different
question: **measured against current ECharts 6.1 / MapLibre 6.x practice,
where does the module still behave like a set of static pictures rather than a
reactive research instrument?** Five parallel deep dives (ECharts · MapLibre ·
state/controls/dashboards/facets · Python · PHP/CSS/build/CI), every High and
most Medium findings re-verified by the lead against the source before being
recorded here. Items marked ✓ were reproduced independently by grep or diff.

**Baseline at audit time (verified locally):** `npm test` 89/89; every
`npm run lint:*` gate green; `npm run build` reproduces the committed `.min`
siblings byte-for-byte; `php -l` under PHP 8.4 raises no deprecation on any of
the 32 PHP / 33 phtml files (no implicit-nullable parameters remain).
ECharts **6.1.0 is the current release** (npm `latest`, checked 2026-09-04);
MapLibre is one minor behind (**6.6.0 pinned, 6.7.0 current**). Nothing below
is firefighting; the security posture (escaping, CSRF, ACL, embed whitelists,
zip hardening) re-checked clean.

### The numbers that frame this tier

| Measure | Value | How |
|---|---|---|
| `setOption` call sites | 134, of which **67 are `setOption(opt, true)`** and 5 pass `{ notMerge, lazyUpdate }` ✓ | grep over `asset/js/**/*.js` |
| `replaceMerge` / `universalTransition` / `dataset` / `echarts.connect` | **0 / 0 / 0 / 0** ✓ | idem |
| `echarts.init` options (`locale`, `renderer`, `useDirtyRect`) | none ✓ | `dashboard-core.js:271` |
| Hand-rolled tooltip/label `formatter: function` | 70 ✓ (34 emit HTML; all 34 escape) | idem |
| MapLibre `setStyle(…, { transformStyle })` / GeoJSON `cluster:` / `map.on('error')` | **0 / 0 / 0** ✓ | idem |
| `onStyleReady` rebuild callbacks · `map.remove()` sites | 37 across 14 `createIwacMap` calls · **1** (compare-newspapers) ✓ | idem |
| Blocks with URL-addressable state | **1 of 21** (Topic Explorer `?topic=`) ✓ | `grep history\.\|URLSearchParams` |
| Hand-rolled state / facet / observer mechanisms | 16 (inventory in §S below) | read |
| `innerHTML = ''` sites | 90 ✓ | grep |
| `P.fetchJSON` calls with a timeout | **2 of 36** ✓ | `grep timeoutMs` |
| ECharts `dispose()` sites · `aria-valuetext` on the two year sliders | 1 real · **0** ✓ | grep |
| Module scripts injected per block (before CDN libraries) | 19 (entity-networks) … **43 (laïcité)** | simulated from the partial + templates |
| Module JS shipped for the collection overview | 33 files, 183 KB minified ✓ | `stat` over the chain |
| Shared i18n dictionary on every page | 66 KB min (`iwac-i18n`), + 51 KB for laïcité's own ✓ | `stat` |
| Python: subset loads per CI run · `iterrows()` sites · generators with a pure `build()` | ~92 (26 of `articles`) · 55 · **0 of 30** | `ast` + grep |
| CSS: byte-identical declaration groups | 59 groups / 110 instances | normalised-block hash |

### Cross-cutting recommendations (lead-verified)

Five changes move the module from "pictures that re-render" to "instrument";
the per-area sections carry the evidence and the smaller items.

**8.A — Make every render one update pass, and let rows keep their identity
across a state change (ECharts).** The audit's first instinct — "67 notMerge
rebuilds are killing transitions" — turned out to be wrong on inspection, and
the correction matters. ECharts reuses series views across notMerge when
series names are stable, so bars do animate; what notMerge actually discards
is *component* state (legend selection, the dataZoom window). The real costs
are elsewhere: (1) the aria re-description patch in `dashboard-core.js` turns
every render into **four** full update passes plus deep `getOption()` clones
and silently defeats all five `lazyUpdate` callers; (2) diverging and ranked
bars ship *unnamed* data items, so a sort toggle re-lengthens bars in place
instead of gliding rows to their new rank; (3) the "bar chart race" never uses
`series-bar.realtimeSort`, so rank changes teleport. The fixes are small and
independent: describe the outgoing option *before* the native `setOption`
(one pass), `{ name, value }` items plus `yAxis.animationDurationUpdate`,
`realtimeSort` on the race, and `replaceMerge: ['series','xAxis','yAxis']`
where the option shape is stable so legend and zoom survive.
`universalTransition` and `dataset`/`transform` were evaluated and do **not**
apply (nothing morphs between chart types over the same items; facets are
pre-aggregated by design). See E1–E5.

**8.B — One store, URL-bound, driving linked facets (state/controls).**
Sixteen hand-rolled state mechanisms, one deep-linkable block, and controls
that destroy their own keyboard focus on every change are the same problem
seen from three sides. A ~90-line `P.createStore` (keyed subscriptions,
microtask batching, a `reduce` hook for the cross-field rules keywords-state
and laïcité already encode by hand) is the prerequisite for `P.bindUrlState`
(shareable, citable views), for `mount()`/`sync()` controls that survive their
own change events, and for a block-level `country` facet that every panel
consumes. Honest cost/benefit and adoption order in S1, S2, S4, S11.

**8.C — Bundle per block with esbuild and self-host a tree-shaken ECharts
(build).** The loader injects 19–43 module scripts per block in a
load-order-is-load-bearing chain, then the ~1 MB full ECharts bundle and the
MapLibre ESM from jsDelivr. The IIFE sources are already order-dependent, so
step one — concatenate the exact chain into `dist/shared-*.min.js` plus
`dist/<slug>.min.js`, same order, same globals — is a zero-semantics change
the existing `build-check` guard verifies. Step two builds `echarts/core` with
only the 13 series types and ~14 components actually used (inventory in B1)
and serves it first-party under Omeka's `?v=`. That is what ROADMAP 5.4 has
been waiting on: it removes the jsDelivr GDPR question, gains sourcemaps and
an ESLint hook, and trims the chart library by an estimated 30–40 % (not more:
graph, sankey, treemap, sunburst, custom and chord all pull layout code). Keep
the d3 UMD chain and the MapLibre `import()` exactly as they are.

**8.D — Stop losing the map on a theme toggle (MapLibre).** Every toggle
re-runs 37 `onStyleReady` callbacks that re-add sources and layers and, in two
places, re-register event listeners (M2); the laïcité places view leaks a
WebGL context per activation (M3); a device without WebGL2 gets an empty box
or a whole-block error because the gate's two-argument `.then` never catches
the constructor throw (M1). Fix those three first, then carry the module's own
layers across the swap with `map.setStyle(next, { transformStyle })` (M13),
bump to **6.7.0**, and handle the `GPUInitializationError` it now throws.

**8.E — Give every chart its data back (a11y + research use).** No chart
offers a table view or CSV; the toolbar exports PNG only. The data is already
inside every cartesian option, so a ~60-line `P.optionToRows(option)` plus two
toolbar buttons ("View as table", "Download CSV") wired in
`autoAttachPanelToolbar` covers ~55 panels with no per-block code. WCAG G94 for
non-text content, and the thing a historian citing a figure actually needs
(S3).

### E — ECharts

- [ ] **E1 (High, M) — The aria re-description patch makes one render four
      update passes.** ✓ `dashboard-core.js:211-221` wraps `setOption`;
      `_applyAria` (`:157-170`) calls `getOption()` (a documented deep clone
      including series data) and then a synchronous, non-lazy
      `setOption({ aria })` — a full update pipeline. `registerChart:303-306`
      runs `render()` (1) → wrapper aria (2) → explicit `ns._applyAria` (3) →
      its wrapper aria (4); `applyThemeToCharts:463-470` repeats the sequence.
      The five `{ notMerge: true, lazyUpdate: true }` callers
      (`laicite.js:298,327`, `term-trends.js:332`, `scary-terms.js:293`,
      `org-cooccurrence.js:170`) gain nothing — the wrapper's follow-up forces
      the deferred frame immediately; on the 12k-point landscape each extra
      pass restarts progressive rendering. Fix: compute the description from
      the *outgoing* option and inject `aria` into it before `native.apply`
      (normalise `opt.baseOption || opt` for the `R.withMedia` form; on a
      partial merge re-inject the cached description); delete the explicit
      calls at `:306` and `:470`. The signature stays form-agnostic
      (`native.apply(instance, arguments)` — that part is right).
- [ ] **E2 (Med, M) — The bar-chart race does not race.** ✓ `realtimeSort`
      has 0 uses. `scary-terms.js:242-249` slices the top-N per frame and
      `C.scaryTerms` (`chart-options-hbar.js:330-336`) builds *unnamed*
      `{ value, itemStyle }` items on a re-supplied category axis, so
      `animationDurationUpdate: 800` (`:378`) animates bar length in fixed
      slots while labels swap instantly. Race view only: pass every term with
      a `name`, `series-bar.realtimeSort: true`, `yAxis.max: TOP_N - 1`,
      `yAxis.animationDurationUpdate`, `label.valueAnimation`, and a
      merge-mode tick `setOption({ series: [{ data }] })` with
      `animationDurationUpdate ≈ tick − 100` linear. The reduced-motion switch
      at theme level (`iwac-theme.js:478`) still snaps frames.
- [ ] **E3 (Med, S) — Sort toggles and model switches animate by slot, not by
      row.** `C.divergingBar` builds `data` as bare numbers
      (`chart-options-hbar.js:477-484`) and discards `names` into
      `yAxis.data` (`:460`); the toggles at `sentiment-atlas.js:936-950`
      re-render with notMerge. ECharts diffs bar items by `name` when present,
      by index otherwise. `{ name, value }` items plus
      `yAxis: { animationDurationUpdate: 400 }` — same for `C.horizontalBar`
      / `C.entities` pagination (`top-entities.js:90`). notMerge is not the
      blocker; `universalTransition` would not help (it morphs *between*
      series/chart types keyed by `groupId`).
- [ ] **E4 (Med, S) — Ten axis-trigger tooltips show unformatted, unlocalised
      numbers.** `chart-options-bar.js:73,113,236` (`C.timeline`,
      `C.growthBar`, `C.stackedBar` — every stacked timeline on the site),
      `laicite/references.js:88`, `laicite/corpora.js:161,258`,
      `compare-newspapers/{timeline:45, newspapers:81, sentiment:122,
      subjects:45}.js` render `6000`, not `6 000` / `6,000`. One theme-level
      line in `buildTheme` (`iwac-theme.js:487`): `tooltip.valueFormatter`
      resolving `ns.panels.formatNumber` lazily (panels.js loads later).
- [ ] **E5 (Med, S) — notMerge discards legend selection and the dataZoom
      window on every facet/term change.** `term-trends.js:332` (65-year
      slider resets to 0–100 when a term is added), `sentiment-atlas.js:890`
      (model switch drops legend toggles), `topic-explorer.js:463`,
      `faceted-chart.js:83`. Where the option shape is stable use
      `setOption(opt, { replaceMerge: ['series', 'xAxis', 'yAxis'] })`; keep
      notMerge where the component set changes (scary-terms view switch,
      `P.emptyChartOption`).
- [ ] **E6 (Med, S–M) — `sentiment-atlas.js` re-implements `C.heatmapMatrix`
      twice (~185 lines).** `buildCentralityHeatmap` (`:423-510`) and
      `buildAgreementMatrix` (`:532-627`) vs `C.heatmapMatrix`
      (`chart-options-special.js:1298-1411`), which already takes
      `tooltipFormatter`, `visualMin/visualMax`, `cellLabels`, `cellBorder`,
      `xLabelRotate` and `{ value: [x, y, v], n }` cells. ~150 lines.
- [ ] **E7 (Med, M) — Three copies of the UMAP landscape option and three
      identical click-through handlers.** `semantic-landscape.js:181-247,
      305-312`, `laicite/semantic.js:101-160, 255-262`,
      `references-overview.js:436-489, 547-552`; only `symbolSize` (4/6/7),
      opacity, tooltip bits and an optional label overlay differ.
      `C.landscape(points, grouped, opts)` saves ~120 lines and gives one home
      for the perf flags in E12.
- [ ] **E8 (Med, S) — `index-overview/top-entities.js` is a rename of
      `collection-overview/entities.js`.** ✓ both 131 lines, 24 lines differ
      (header, i18n map name, position of `Lieux` in the type order).
      `P.buildEntitiesPanel(ctx, { typeOrder, i18n, ns })` saves ~115 lines.
- [ ] **E9 (Low/Med, S) — Click→navigate is copy-pasted 8×; a shared helper
      is dead.** ✓ `window.location.href = siteBase + '/item/' + oId` at
      `semantic-landscape.js:309`, `laicite/semantic.js:259`,
      `references-overview.js:551`, `activity-gantt.js:128`,
      `lifespan.js:158`, `top-entities.js:99`, `entities.js:99`,
      `press-bylines.js:152`; 43 `'/item/'` string builds overall;
      `on-this-day/shared.js:326` already has a private `itemUrl`.
      `P.attachGraphClickThrough` (`panels-boot.js:406-427`) has **zero
      callers** although this file (Tier 2/5) describes it as wired. Add
      `P.itemUrl(siteBase, oId)` + `P.navigateOnClick(chart, pick)`; delete or
      wire the dead helper to the one remaining ECharts force graph
      (`references-overview.js:913`).
- [ ] **E10 (Low/Med, S) — Repeated option literals that `chart-options`
      should own.** `animationDuration: 600, animationEasing: 'cubicOut'` ×24
      → theme-level next to `animation` (`iwac-theme.js:478`);
      `legend: { type: 'scroll', top: 4, itemWidth: 12, itemHeight: 10 }` ×3
      exact / 15 variants → `C._legend(overrides)`;
      `compare-newspapers/timeline.js:55-57` re-types `C._dataZoom`; `grid:`
      literals in 12 panel files bypass `C._grid`; percent axis labels
      `v + ' %'` ×5 vs `'{value}%'` ×3 (`laicite/{bylines:78, sentiment:488,
      arenas:175}.js` drop the space French typography needs) →
      `C._percentAxisLabel()`; `buildSubjectivityOption`
      (`sentiment-atlas.js:352-421`) vs term-trends `draw()` (`:261-332`) →
      `C.multiLine`. ~155 lines.
- [ ] **E11 (Low/Med, S) — Inline chrome colours re-declare (and contradict)
      the theme.** `axisLine … border` ×7 and `axisLabel.color: muted` ×7
      (`sentiment-atlas.js:469-470,478-479,576-577,585-586`;
      `chart-options-special.js:1349-1351,1362,1366`), `visualMap.textStyle`
      ×3 — the theme paints axes `inkLight`, so heatmaps alone read `muted`.
      `special.js:998` `color: '#fff'` is a genuine hardcode → `C.readableInks`
      (`:82`). `fontSize` literals: special 15, hbar 7, bar 3, graph 3 —
      `readTokens()` reads no type-scale token; add `fontSizeSm` from the
      theme's `--text-*` scale and consume it in builders and
      `responsive.js:107-110`.
- [ ] **E12 (Low/Med, S) — Big-series flags actually missing.**
      `semantic-landscape.js:188-200` sets `progressive: 2500 /
      progressiveThreshold: 3000` *per series*, but points are split across
      facet groups, so it rarely engages. `large: true` is compatible there
      (only series-level `itemStyle.opacity`; cost: per-point hover emphasis
      at `:195` stops). `sampling: 'lttb'` is irrelevant (≤ 65 points/series).
      `layoutAnimation: false` (`chart-options-graph.js:79`) runs the whole
      force simulation synchronously — confirm the generator caps the
      collaboration graph (`references-overview.js:911`) or it blocks the main
      thread on large inputs. Measure `useDirtyRect` on the landscape's hover
      repaint (E13).
- [ ] **E13 (Low, S) — `echarts.init` receives no `opts`.** ✓
      `dashboard-core.js:271`. `locale` changes nothing visible today (no
      toolbox, aria overridden, zero `type: 'time'` axes ✓) — pass
      `ns.locale === 'fr' ? 'FR' : 'EN'` anyway. `renderer: 'svg'` candidates
      are the small static renderers (pie/sunburst/radar/treemap) for
      crispness and a vector export (E17); the sparkline is hand-rolled SVG
      already (right call). Extend `registerChart(el, render, initOpts)`.
- [ ] **E14 (Low, S) — `focusNodeAdjacency: true` is a removed ECharts 4
      option.** ✓ `chart-options-graph.js:328`, two lines above the correct
      `emphasis.focus: 'adjacency'`. No other 5-era leftovers found (no
      `normal:` nesting, no `axisLabel.textStyle`, no `hoverAnimation`; all
      six `visualMap` literals set `inRange`).
- [ ] **E15 (Low, S each) — ECharts 6 features: adopt / skip.** `matrix`
      coordinate system: no benefit for the 12×12 co-occurrence or the 5×5
      agreement matrix beyond model-name super-headers — close ROADMAP 4.6 as
      "no benefit unless that header is wanted". `axis.jitter`: `C.beeswarm`
      (`special.js:1096-1141`) hand-rolls a jitter and has **zero callers** ✓
      — delete, or if revived use `yAxis.jitter`. `legend.selector` (0 uses):
      useful on the 12-series term-trends line and the topic river.
      `visualMap` piecewise + `selectedMode`: the ordinal 1–5 centrality
      heatmap (`sentiment-atlas.js:483-494`) reads better as five pieces the
      reader can isolate. `C._dataZoom` (`chart-options.js:71-82`) leaves the
      default `filterMode: 'filter'` — `'weakFilter'` if the y-axis jump on
      line charts is unwanted. `colorBy`, `toolbox`: no action.
- [ ] **E16 (Low, S) — Tooltips: escaping is clean, no shared item helper.**
      42 tooltip formatters, 34 emit HTML, all 34 escape; the four unescaped
      `p.name` hits (`special.js:136,442,471`, `keywords-bump.js:138`) are
      rich-text *label* formatters, not HTML. `C.itemTooltip(title, lines)` is
      a nicety (≥ 15 copies of the `<strong>` + `<br>` shape;
      `dot(color)` at `hbar.js:666` duplicates `p.marker`).
- [ ] **E17 (Low, M) — PNG export is raster-only.** `panel-toolbar.js:55-60`
      (`pixelRatio: 2`, `excludeComponents: ['toolbox']` is moot),
      `panels-boot.js:353-357`. `getSvgDataURL` needs an SVG-renderer
      instance (E13). Cheapest print win: `pixelRatio: 3`.

### M — MapLibre

- [ ] **M1 (High, S) — The WebGL2-unavailable path is unreachable code.** ✓
      `shared/maplibre.js:253` `new maplibregl.Map(baseOptions)` has no
      try/catch; MapLibre 6 requires WebGL2 (6.7 throws
      `GPUInitializationError`). `panels-map.js:86-95` passes the rejection
      handler as the *second argument* of the same `.then`, so a throw inside
      `build()` rejects the returned promise without ever painting "Map
      library unavailable"; `deferMaplibre`'s `!built` branch (`:153-174`) is
      dead. Panels that re-enter `render()` synchronously
      (`article-dashboard/map.js:75-80`, `spatial-exploration/map.js:175-178`)
      let the throw reach `panels-boot.js:108-112` — the whole block errors.
      `map.on('error')` has 0 hits ✓. Fix: try/catch in `createIwacMap`
      returning `null`; chain `.then(build).catch(banner)`; one `error`
      listener in the factory that swaps the host for the banner on
      `GPUInitializationError`.
- [ ] **M2 (High, S) — Listener stacking on every theme swap.**
      `compare-newspapers/map.js:255-288` registers
      `m.on('click'|'mouseenter'|'mouseleave', layerId)` for two layers
      *inside* `onStyleReady`, no guard; `shared/choropleth.js:340-398`
      `ensureLayers()` calls `attachInteractions()` (`:391`) ✓ each time the
      source is missing — i.e. after every `setStyle`, re-entered from its own
      `style.load` hook (`:488-490`) — adding `click`, `mousemove`,
      `mouseleave` and two map-level feature-state listeners each time.
      Delegated listeners live on the `Map`, not the style, so after N toggles
      one click opens N popups. `references-overview.js:201-202` and
      `spatial-exploration/map.js:435-437` guard correctly; every other panel
      attaches once outside `onStyleReady` (the hazard is documented at
      `places-map.js:214-224`). Move compare's block after `createIwacMap`;
      call `attachInteractions()` once in the helper body.
- [ ] **M3 (High, S–M) — The laïcité places view leaks one MapLibre instance
      per view switch.** `laicite.js:334-335` clears `viewHost`; `:424-433`
      mounts the map via `mountLazy('places', …)`; `laicite/map.js:93-95`
      creates a fresh map every activation. `map.remove()` is called only in
      `compare-newspapers.js:81-83` ✓; `pruneCharts` drops only `_removed`
      maps, so detached zombies are `setStyle`'d (Carto style + tile fetches)
      on every theme toggle. Browsers cap live WebGL contexts (~16) and
      silently lose the oldest — the "blank map after flipping views"
      symptom. Cache the built view like `scary-terms.js:446-455`, or give
      views a teardown hook; also let `pruneCharts` treat a maplibre entry
      whose `el` is no longer connected as dead and `remove()` it.
- [ ] **M4 (Med, S) — A 205 KB GeoJSON source is added to the collection map
      and never drawn.** ✓ `collection-overview/map.js:178-180` adds
      `countries` from `world_countries_simple.geojson` (205,295 B); no layer
      references it; the worker parses and tiles it on load and after every
      theme swap. Delete with the `geoUrl` plumbing (`:31, 45, 77`).
- [ ] **M5 (Med, S–M) — The choropleth re-tiles its polygons on every count
      change.** `choropleth.js:507-521` does `setPaintProperty` *and*
      `setData(annotate(cache))` because the fill expression reads
      `['get', '_iwac_count']` (`:143, 167-172`);
      `keywords-attention.js:126-130` calls it per slider tick and per play
      step. Keep the GeoJSON static and put the counts in the expression
      (`['match', ['get', 'name'], 'Bénin', 245, …, 0]`).
- [ ] **M6 (Med, S) — `preserveDrawingBuffer: true` on every map to serve a
      rare PNG export.** `maplibre.js:237-242`; `panel-toolbar.js:67-90`
      already calls `redraw()` synchronously. Default it off and export via
      `map.once('render', …); map.triggerRepaint()`; keep
      `mapOptions.preserveDrawingBuffer` as the escape hatch; verify on
      Safari.
- [ ] **M7 (Med, S) — Control set and camera defaults don't match the
      maps.** A globe toggle ships on 10 of 12 maps though ROADMAP 4 lists
      globe as "Won't do"; `visualizePitch` / `touchPitch` / `dragRotate` stay
      on for flat thematic maps; the references provenance panel has two
      fullscreen buttons (`FullscreenControl` + `P.addFullscreenButton`,
      `references-overview.js:264-270`). Seven different "West Africa"
      defaults for one region (`[2,10]@3.2`, `[2,10]@2.6`, `[2.5,12]@4`,
      `[0,10]@2.2`, `[0,10]@3.5`, `[2.5,10.5]@3.4`, `[0,16]@1.8`), fitBounds
      padding 40/42/48/60, maxZoom 5/7/8. Factory defaults `globe: false`,
      `NavigationControl({ showCompass: false })`, rotate/pitch off;
      `P.WEST_AFRICA_VIEW` + `P.FIT_OPTS`; `fullscreen: false` where the
      panel toolbar already has one.
- [ ] **M8 (Med, S) — MapLibre's own UI strings stay English on the French
      site; map hosts carry no label.** `maplibre.js:216-227` localises only
      the three cooperative-gesture keys; `Map.Title`, `NavigationControl.*`,
      `FullscreenControl.*`, `GlobeControl.*`, `Popup.Close`,
      `AttributionControl.ToggleAttribution` fall back to English. Only
      `keywords-attention.js:83` sets an `aria-label` on its host (12 hosts).
      One `fr` table merged into `locale`; `config.title` → `Map.Title` + host
      `aria-label`.
- [ ] **M9 (Med, S) — No reduced-motion handling in any camera move.**
      `ns.prefersReducedMotion` exists (`iwac-theme.js:457`) and the canvas
      graphs honour it; zero map files do. Animated moves at
      `spatial-exploration/map.js:493-494, 704, 887, 916, 920, 937, 944`,
      `person-dashboard/map.js:101-105`, `entity-networks/graph.js:527-531`.
      `P.mapMotion(ms)` returning 0 under the preference.
- [ ] **M10 (Med, S) — Radius encodings disagree and nothing sets
      `circle-sort-key`.** Linear-on-count in six panels
      (`collection-overview/map.js:187-191`, `sources-map.js:160-164`,
      `places-map.js:159-163, 188-192`, `person-dashboard/map.js:148-152`,
      `references-overview.js:185-189`, `spatial-exploration/map.js:311-317`),
      sqrt in three (`laicite/map.js:150-154`, `scary-terms/map.js:95-99`,
      `compare-newspapers/map.js:133-145`, with the rationale). Linear makes
      area ∝ count², so the same 10:1 ratio reads as ~3× on one panel and
      ~100× on the next; without a sort key small bubbles near Abidjan sit
      under the big one and are never hit-tested. One
      `P.countRadius(key, max, minPx, maxPx)` on sqrt + `circle-sort-key`
      big-first.
- [ ] **M11 (Med, M) — Choropleths have no legend.** `choropleth.js` normalises
      to `[0, max]` / `±maxAbs` (`:136-172`) and never says so;
      `spatial-exploration/map.js:142-168, 468-487` has a private legend for
      its admin mode. `P.buildChoroplethLegend(stops, domain)` shared by both.
- [ ] **M12 (Med, M) — Duplicated map code, five pairs (~350 lines).**
      (a) the `ml / resolvePrimary / resolveInk` colour trio ×4–6
      (`collection-overview/map.js:150-160`, `sources-map.js:117-127`,
      `places-map.js:113-123`, `person-dashboard/map.js:116-126`) →
      `P.mapColor`; (b) the feature-state hover paint block ×10 (~120 lines)
      → `P.bubblePaint`; (c) `laicite/map.js` vs `scary-terms/map.js` are
      near-clones (`buildFeatures` 117-130 ≡ 55-74, `paintFor` 132-156 ≡
      76-101, create/update/resize 158-231 ≡ 103-175, `<details>` fallback) →
      `P.createFilteredPlacesMap`; (d) the click→popup handler ×6 →
      `P.attachMapClickPopup`; (e) hand-rolled bbox reduces ×3 vs
      `LngLatBounds.extend` → `P.boundsOf`, and string-built popups in
      `choropleth.js:409-410, 432-433`, spatial `:446-447, 461-463`, compare
      `:270-271` → `P.buildMapPopup`. `COUNTRY_ALIASES` is *not* duplicated.
- [ ] **M13 (Low/Med, M) — Theme swap: carry the module's layers across with
      `transformStyle`.** Per swap today every module source is re-parsed and
      re-tiled (spatial ~544 places, the entity network's ~10k edges, the
      choropleth polygons), feature-state hover resets, filters are re-applied
      by hand (`spatial:614-616`, `graph.js:373`, `places:211`) and spatial's
      admin mode re-fits the camera (M15). Camera, open popups, selections and
      fit-once flags survive. `map.setStyle(next, { transformStyle: (prev,
      next) => … })` copying `iwac-`-prefixed sources/layers from `prev`
      keeps sources, layers, filters and feature-state. It does *not* stop
      `style.load` (so `onStyleReady` still runs — the `getSource` guards make
      that a no-op in ten panels; laïcité and scary would throw, M17), and
      paint colours are baked at add time, so a re-colour pass is still needed
      (`references-overview.js:196-199` shows the `setPaintProperty` form).
      Prerequisite: today's ids are unprefixed (`locations`, `net-nodes`,
      `places-authority`, `compare-a`, `spatial-places`, …). Do after M2 and
      M17, with a live test.
- [ ] **M14 (Low/Med, owner) — Basemap privacy and three copies of the style
      URLs.** Every map view fetches `basemaps.cartocdn.com` and
      `tiles.basemaps.cartocdn.com` — one request per tile per pan, so Carto
      sees far more of the visitor than jsDelivr does; ROADMAP 5.4 discusses
      only jsDelivr. Even the non-geographic entity graph pulls Noto glyphs
      from Carto (`maplibre.js:109`, `graph.js:355-357`). URLs are hardcoded
      at `iwac-theme.js:641-642`, `maplibre.js:77-78` and `:206`
      (`P.setMapTheme` re-implements `ns.getBasemapStyle()`); no `preconnect`
      for cartocdn. Options, cheapest first: self-host the two style JSONs and
      the Latin glyph ranges under `asset/geo/` (tiles still remote);
      OpenFreeMap positron (keyless, no dark twin); PMTiles via
      `maplibregl.addProtocol` + a Protomaps Africa extract (fully
      first-party, ~1–2 GB, self-hosted glyphs/sprites). Collapse the three
      literals now regardless.
- [ ] **M15 (Low, S)** — spatial admin mode re-fits the camera on every
      `style.load` (`spatial-exploration/map.js:617-619 → 568`, 600 ms): a
      theme toggle moves the map.
- [ ] **M16 (Low, S)** — `attachFeatureStateHover`'s `clearHover`
      (`panels-map.js:234-242`) calls `setFeatureState` without a `getSource`
      guard, firing MapLibre `error` events mid-swap that nobody listens for.
- [ ] **M17 (Low, S)** — `addSource` without a `getSource` guard in
      `laicite/map.js:163` and `scary-terms/map.js:109` (the other ten guard);
      harmless today, the first landmine for M13.
- [ ] **M18 (Low, M)** — no keyboard / non-pointer route to place data on the
      collection, sources, places, person and spatial maps; laïcité, scary and
      keywords-attention already ship a `<details>` ranked list or slider —
      reuse it.
- [ ] **M19 (Low, S–M)** — the popup monkey-patch (`maplibre.js:365-486`, six
      overridden methods, constants pinned to "MapLibre 6.3 CSS" while the pin
      is 6.6.0) can become CSS: the host has an explicit height, so
      `.iwac-vis-map { container-type: size }` +
      `max-height: min(460px, calc(50cqh - 10px))` /
      `max-width: min(320px, 66cqw)` give the same half-height / two-thirds
      guarantee with no JS and free resize tracking.
- [ ] **M20 (Info)** — entity networks on MapLibre: **keep it**. GPU
      `line`/`circle` over ~10k precomputed edges, zoom-adaptive symbol
      collision (`graph.js:348-370`), expression filters, shared chrome. The
      d3 canvas renderer would need a static-positions mode and a fixed
      46-label budget; and the same block's geo mode is a real map, so the
      library loads regardless. Fix the Carto glyph fetch via M14 instead.
- [ ] **M21 (Low, S)** — docs drift: `ROADMAP.md:10, 177` and `README.md:537`
      say MapLibre 5.24 (historical entries — leave those) but nothing states
      the current 6.6.0 pin outside the partial; `maplibre.js:305-307` cites
      6.3.

### S — State, controls, dashboards, facets

The inventory this section rests on — sixteen mechanisms, none shared:

| # | Mechanism | Where | Shape |
|---|---|---|---|
| 1 | Role facet | `person-dashboard/facet.js:22-34` | `{ role, set, subscribe }`, no unsubscribe |
| 2 | No-op facet | `panels-boot.js:197-199` **and** `dashboard-panels-bridge.js:69` | duplicated |
| 3 | Keywords state | `index-overview/keywords-state.js:45-224` | get/set with cross-field resets, derived selector, unsubscribe |
| 4 | Spatial state | `spatial-exploration/state.js:36-147` | keyed notify, async selection with race guard + LRU |
| 5–8 | `state` objects | `scary-terms.js:196-208` (10 fields), `laicite.js:152-171` (18), `sentiment-atlas.js:820-829`, `term-trends.js:102-107` | plain objects mutated by controls, `render(); ctx.draw()` by hand |
| 9–10 | Compare picker, entity-networks | `compare-newspapers/picker.js:22-26`, `entity-networks.js:117-119, 230` | closures |
| 11 | Per-panel facet closures | collection-overview ×5, `distinctive-vocabulary.js:147`, `semantic-landscape.js:280`, `references-overview.js:515` | one panel each |
| 12–13 | Topic explorer (URL), On This Day (localStorage) | `topic-explorer.js:112-146`, `on-this-day.js:261` | |
| 14–15 | `buildFacetButtons`, table/pagination/window-disclosure internals | `facet-buttons.js:46-48`, `table.js:249`, `pagination.js:384-387` | `setActive` without `get` |
| 16 | DOM-as-state | `entity-networks.js:282,324`, `compare-newspapers/sentiment.js:112-113`, `on-this-day/shared.js:394`, `scary-terms/controls.js:299` | widget is the source of truth |

- [ ] **S1 (High, M) — Controls are rebuilt from inside their own change
      handlers; keyboard focus is destroyed on every interaction.** ✓
      `scary-terms/controls.js:71-72` `render()` starts with
      `controlsEl.innerHTML = ''` and is invoked from the map selects' own
      `onChange` (`:151-156, 164-169`), every playback step (`:274-280`) and
      the timer's `onPlay`/`onStop` (`scary-terms.js:562-570`): pressing Play
      destroys the Play button under the pointer. `laicite/controls.js:59-60`
      does the same from the axis select (`:127-131`), trends country
      (`:173-178`), trends subset (`:190-195`), collocate scope (`:222-227`),
      every `simpleSelect` (`:261-269`) and the KWIC subset (`:372-377`). With
      a `<select>` focused, ArrowDown fires `change` immediately in
      Chrome/Firefox, so the select is removed on the first keystroke and the
      list cannot be traversed by keyboard at all.
      `spatial-exploration/picker.js:94-108` clears the listbox on
      `'selection'`. The one place that got it right —
      `scary-terms/controls.js:294-304` (targeted slider label update "because
      re-rendering would steal the slider focus") and `syncSliderPosition`
      (`:335-343`) — is the template. Split `render()` into `mount()` (once
      per view) and `sync()`; only a change of `state.view` may remount;
      repopulate dependent selects in place (`compare-newspapers/picker.js:
      135-166` `rebuildName()` already does this).
- [ ] **S2 (High, M) — Only Topic Explorer is deep-linkable; the citable views
      are the ones that reset.** ✓ `keywords-state.js:8-13` argues the URL must
      not be used because a block "can be embedded on any page alongside other
      content"; `?topic=` already collides with nothing, and block-prefixed
      keys cannot. State that should be addressable: compare-newspapers A/B
      `{type, scope, slug}`; term-trends `selected[]` + `mode` (the
      Google-Ngram value proposition *is* the shareable URL); laïcité `view`,
      one `country`, `subset`, `axis`, `frame`, `kwicQuery`; scary-terms
      `view`, `country`, year; sentiment-atlas `model`, `pair`, extremes
      facets, sorts; index-overview keywords; spatial `entityType`, selection,
      `focusCountry`, mode; entity-networks `mode`, `weightMin`, selection;
      the overview facets. One `P.bindUrlState(store, { prefix, keys,
      serialize, parse, push })`: hydrate on boot, `replaceState` by default
      (`pushState` + `popstate` only for navigation-like changes such as
      topic detail), the same code runs inside the embed iframe against its
      own same-origin `location`, so `E.url()` only appends the query it wants
      pre-set — no PHP change. Add "Copy link to this view" beside the
      per-panel "Copy embed code" (`embed.js:176-200`; `topic-explorer.js:
      669-684` does it by hand).
- [ ] **S3 (High, M) — No chart offers its data as a table or CSV.** ✓
      `panel-toolbar.js:383-409` exports PNG only; `dashboard-core.js:110-141`
      replaces the aria description with one sentence — by design the only
      thing assistive tech gets. `P.optionToRows(option)` (~60 lines: category
      axis + N series → header + rows; pie → name/value; heatmap → x/y/v),
      custom series opt out via `data-iwac-no-table`; "Download CSV" (Blob +
      `<a download>`, same mechanism as the PNG) and "View as table"
      (`P.buildTable` under the chart, `aria-controls`/`aria-expanded`) wired
      in `autoAttachPanelToolbar`; filename from `filenameFromPanel`
      (`:339-347`).
- [ ] **S4 (High, M) — Cross-panel linking is absent on every overview
      block.** Collection overview: `types-over-time.js:36-50`,
      `gantt.js:58-70`, `languages.js:133-155`, `map.js:110`,
      `wordcloud.js:53` each build their own Country facet — selecting Bénin
      in one leaves four on "All"; timeline, country bar and treemap are not
      faceted at all. Laïcité holds `trendsCountry`, `kwicCountry`,
      `arenaCountry`, `mapCountry` (`laicite.js:154, 163, 166, 169`) — a
      reader who picks Togo on the timeline must pick it again on the map.
      Sentiment atlas links the model (`:878-895`, the good example) but not
      the country; `keywordsBump`/`keywordsAttention`
      (`index-overview.js:221-222`) ignore the keyword facet. No chart click
      anywhere sets a facet (all 11 navigate or open a popup). One `country`
      in a block-level store; each panel declares whether it consumes it or
      shows a muted "all countries" note; country bars dispatch
      `store.set('country', name)` on click with a visible clear chip.
- [ ] **S5 (Med, S) — Compare Newspapers: a stale corpus response overwrites a
      newer selection.** ✓ `compare-newspapers.js:173-192` has no request
      token and no `AbortController`; both sides fire on boot (`:200-202`) and
      on every picker change, so a large response landing after a small one
      repaints side A as the previous newspaper while the picker says
      otherwise. `spatial-exploration/state.js:121-137` has the correct guard.
      Per-side sequence number + `signal` through `fetchJSON`'s `opts` (it
      already forwards `init.signal`, `panels.js:127`); lift into
      `P.latest(fn)` and use it in `entity-networks.js:179`,
      `laicite.js:207`, `scary-terms.js:356, 413`.
- [ ] **S6 (Med, S) — Orphaned ECharts instances accumulate on every view
      switch.** ✓ `laicite.js:335` clears `viewHost` on every `draw()` and the
      sentiment view registers four charts (`laicite/sentiment.js:121, 136,
      147, 171`); `topic-explorer.js:602` clears `detail` and `DL.render`
      registers three per topic opened. Only `compare-newspapers.js:77-109`
      disposes; `pruneCharts` keeps any non-disposed instance, so
      `ns._charts` grows by 3–4 entries (instance + canvas + `ResizeObserver`)
      per interaction and `applyThemeToCharts` re-renders all of them on the
      next dark-mode toggle. Promote compare's `disposeCharts(root)` to
      `P.disposeWithin(root)` in dashboard-core; call it before both clears;
      let `pruneCharts` treat `!el.isConnected` as dead for `'echarts'` (it
      already does for `'renderer'`, `:419`). Pairs with M3.
- [ ] **S7 (Med, S) — Both year sliders announce an array index, not a
      year.** ✓ `aria-valuetext` 0 uses. `scary-terms/controls.js:286-292` and
      `index-overview/keywords-attention.js:68-74` are near-identical (60
      lines): `min=0`, `max=years.length-1`, `aria-label="Year"` — a screen
      reader says "Year, 12 of 64" while the label says 1973.
      `P.buildYearSlider({ years, index, onInput, onCommit })` owning
      `aria-valuetext`/`aria-valuenow`, the fill paint (`:317-322`) and a
      `set()` for the playback tick (replacing `:335-343` and `:122-131`).
- [ ] **S8 (Med, M) — Three ARIA vocabularies for "pick one of N", one of
      them wrong.** ✓ `laicite/controls.js:64-80` `role=tablist` + `role=tab`
      + `aria-selected` with no `aria-controls`, no `tabpanel`, no arrow keys
      and every tab in the tab order — that *is* the tabs pattern's contract,
      and failing it is worse than a plain toggle group;
      `compare-newspapers/picker.js:41-73` `role=radiogroup` + `aria-checked`
      **and** `aria-pressed` on the same button (`:53, 111-112`);
      `scary-terms/controls.js:185-228` a bare `--active` class with a
      `<span>` label; seven copies of `highlight(btn)` (`keywords-filters.js:
      38-52, 104-118`, spatial `picker.js:38-50`, `entities.js:52-64`,
      `term-trends.js:155-177`, `on-this-day/shared.js:371-405`,
      `person-dashboard/network.js`). One `P.buildSegmented({ label |
      labelledBy, options, active, onChange, arrowKeys })` → `role=group` +
      `aria-pressed` (the module's established, correct pattern — rationale
      at `collection-overview/entities.js:46-51`); `buildFacetButtons` uses
      it internally.
- [ ] **S9 (Med, S) — Three per-item dashboards bypass
      `bootPerItemDashboard`; ~20 secondary fetches have no timeout.** ✓ only
      the two calls in `panels-boot.js` pass `timeoutMs` (2 of 36).
      `publication-dashboard.js:106-163`, `minimal-item-dashboard.js:189-312`,
      `reference-dashboard.js:130-192` hand-roll the scaffold with an
      unbounded fetch and no retry — the "eternal spinner" v1.5x fixed for
      person/entity/article. Unbounded also: `index-overview.js:192, 240-242`,
      `laicite.js:207`, `scary-terms.js:356, 413`, `term-trends.js:207`,
      `entity-networks.js:179`, spatial `state.js:102`,
      `compare-newspapers.js:177`, `item-set-dashboard.js:180-185`, the
      collection map/wordcloud sidecars. Default `timeoutMs =
      P.FETCH_TIMEOUT_MS` inside `fetchJSON` (opt out with `0`); migrate the
      three dashboards via a `beforeRender` hook (which `mountHeader` already
      is).
- [ ] **S10 (Med, S) — The i18n parity lint covers the shared dictionary
      only.** `scripts/check-i18n.js:33` reads `asset/js/iwac-i18n.js` and
      nothing else. Unchecked: 7 per-block dictionaries (`charts/*/i18n.js`,
      1,164 lines) and 6 inline `ns.addTranslations` blocks
      (`on-this-day.js:45-90`, `term-trends.js:37-72`,
      `press-bylines.js:32-63`, `press-reprints.js:31-74`,
      `org-cooccurrence.js:30-63`, `item-set-dashboard.js:44-59`) — ~45 % of
      the strings can regrow exactly the failure the lint was written for.
      Walk every `ns.addTranslations('en'|'fr', {…})` literal in
      `asset/js/**`; pair per file; flag a per-block key that shadows a shared
      one.
- [ ] **S11 (Med, M) — A shared store primitive: worth it only together with
      S1, S2 and S4.** Line savings alone do not justify it (keywords-state
      228 → ~130, spatial −40, person facet −12, the duplicated no-op −6;
      scary/laïcité/sentiment-atlas would not shrink — their repaint lists
      become subscriptions of the same length; net ≈ 200–300 lines against a
      ~90-line primitive). What it buys that nothing here can: keyed
      subscriptions (`subscribe(fn, { keys: ['view'] })` remounts, everything
      else syncs — the mechanism S1 needs), one hook for `bindUrlState`,
      microtask batching so `toggleKeyword` (which sets `selected` *and*
      flips `view`) notifies once, and a testable unit (none of the 16
      mechanisms has a test). `P.createStore(initial, { reduce })` with
      `get / patch / set / subscribe(fn, {keys}) / derive`; `reduce` carries
      the cross-field rules keywords-state (`:166-172`) and laïcité's six
      `onChange` handlers already encode by hand. Adopt: person facet →
      keywords-state → spatial → laïcité + scary with S1. Leave the per-panel
      closures (row 11) alone.
- [ ] **S12 (Med, S) — `keywords-table` reverse-engineers `P.buildTable`'s
      page by regex-parsing the pagination label.** ✓
      `index-overview/keywords-table.js:103-133` (`render: 'action'` is not a
      mode `table.js` knows; `/(\d+)\s*\/\s*\d+/` on the indicator text
      `:109-114`; a `MutationObserver` on `<tbody>` `:138-143`). Any change to
      the pagination copy, page size or French label breaks Add/Remove
      silently. `table.js` accepts `render: function (row, td)` (~5 lines in
      `renderCell`) and its API exposes `page()`; delete `:103-143`.
- [ ] **S13 (Med, S) — Embed panel slugs are positional.** `embed.js:137-150`
      assigns `'panel-' + index` in document order; sentiment-atlas
      conditionally inserts panels (`:730-749`), periodicals conditionally
      removes one (`:235-237`), and panels created after the 120 ms settle
      window (`:284-307`) are never enumerated. `P.buildPanel(…, { key })`
      stamps `data-iwac-panel`; enumeration prefers the key.
- [ ] **S14 (Med, S) — `t()` has no plural support.** `iwac-i18n.js:1179-1188`
      interpolates only: `articles_count` ("1 articles",
      `person-dashboard/sentiment.js:200`), `places_count`, `mentions_count`,
      `items_count`, `references_count`, `laicite.references_count`,
      `otd.more`; three hand-rolled exceptions with three conventions
      (`on-this-day/shared.js:410`, `on-this-day.js:199`,
      `graph-panel.js:44`); French "0 article" is not expressible. ~12 lines:
      when `params.count` is a number look up `key + '_' +
      Intl.PluralRules(locale).select(count)` first. Also the hardcoded
      `label + ':'` (`panels-controls.js:106`, `scary-terms/controls.js:188`)
      — French wants `Pays :`.
- [ ] **S15 (Med, M) — `dashboardLayout`: extend modestly, migrate the static
      overviews, leave the stateful ones.** ~700 lines of
      `buildPanel / grid.appendChild / registerChart / emptyState` boilerplate
      across `references-overview.js:604-722, 793-929`,
      `collection-overview.js:35-107, 140-189`,
      `periodicals-overview.js:58-115, 186-290`,
      `audiovisual-overview.js:50-101`, `sentiment-atlas.js:654-798`,
      `index-overview.js:38-151`, `lexical-metrics.js:154-222`,
      `press-bylines.js:162-191`, `item-set-dashboard.js:95-172`. What
      `dashboard-layout.js` lacks (verified against `:282-342`): interstitial
      rows (section headings, facet hosts, summary cards),
      `slot.empty: 'omit' | 'placeholder'` (overviews want a placeholder
      panel, not omission), `chartClass` (six host modifiers are added after
      the fact), lazy slots and per-slot async `load`, an addressable result
      (`byKey`), and a facet re-render hook. Migrate references, periodicals,
      audiovisual, lexical, press-bylines, item-set, collection-overview
      (~350–450 lines). Do **not** migrate scary-terms, laïcité,
      compare-newspapers or term-trends — ROADMAP 3.4 was right about those.
- [ ] **S16 (Low/Med, S)** — the `compact` flag is sampled once per draw
      (`laicite.js:325`, `scary-terms.js:342` read `clientWidth < 600` outside
      any `media` rule; `laicite/arenas.js:95` reads `window.innerWidth`
      instead of `R.containerWidth`, so a 400 px embed on a desktop viewport
      gets the desktop layout). Express as an ECharts `media` rule or re-run
      `draw()` from the panel's existing `ResizeObserver` (expose `onResize` on
      `registerChart`).
- [ ] **S17 (Low/Med, S)** — facet changes that only need `setOption` rebuild
      whole views: `laicite.js:334-464` clears `viewHost` for every state
      change, including the actor / arena / model / frame / reference selects
      whose views hold live charts (lost transitions, re-registration → S6,
      scroll jump, `role=status` re-announce). The sentiment-atlas approach
      (`getLiveChart(host).setOption(…)`, `:841-846`) is the model;
      compare-newspapers may keep its rebuild (new corpus is new data) with a
      reserved `min-height`.
- [ ] **S18 (Low/Med, S)** — `fullscreenchange` listeners stack on `document`
      and are never removed ✓ (`panel-toolbar.js:444`, `panels-boot.js:379`,
      `graph-panel.js:114`); copy the self-removing pattern
      `panels-controls.js:218-225` already uses.
- [ ] **S19 (Low, S)** — 17 ad-hoc `<select>` builders beside the 13
      `P.buildSelectControl` calls (`keywords-filters.js:55, 70, 86, 122`,
      spatial `map.js:215, 229, 245, 250`, `entity-networks.js:262`, person
      `network.js:238, 335`, compare `picker.js:82, 98`,
      `sentiment.js:61, 75` — the last two carry no class at all and miss the
      `.iwac-vis-control` skin). Latent trap: `facet-buttons.js:187-198`
      `setActive(key, subKey)` in button mode cannot reach `markSub`, so
      highlight and state diverge — no caller passes a `subKey` today.
- [ ] **S20 (Low, S)** — empty/error states bypassing the shared banners:
      `compare-newspapers.js:183-184` (no `role=status`),
      `keywords-chart.js:113-116, 138-145`, `scary-terms.js:488-508` (an
      ECharts `graphic` text where the same file uses `P.emptyChartOption`
      at `:383, 390`); `noopFacet` defined twice.
- [ ] **S21 (Low, S)** — `setTimeout` sequencing a lifecycle hook would
      remove: `laicite.js:354-358`, `scary-terms.js:461-463`, spatial's popup
      720 ms after a 700 ms `easeTo` (→ `map.once('moveend')`),
      `embed.js:245-249` firing seven synthetic `resize` events, the 50 ms
      fullscreen timers. Keep `index-overview.js:170-175` — a deliberate
      main-thread yield.
- [ ] **S22 (Low, S)** — stale comments that will mislead the next refactor:
      `laicite.js:228-232` and `keywords-chart.js:155-160` say dashboard-core
      "disposes and re-inits" on theme swap (it calls `setTheme` on the same
      instance, `dashboard-core.js:463-467`); `laicite/documents.js:80-88`
      promises the year chip "moves the timeline" but `laicite.js:365-374`
      discards the year (`void year`); `keywords-state.js:173-176` is an `if`
      with an empty body.
- [ ] **S23 (Low, S)** — no in-flight fetch memo: `item-set-dashboard.js:180`
      and `compare-newspapers.js:209` both fetch
      `compare-newspapers/index.json`; each `.iwac-vis-minimal-item` container
      fetches `template-summary.json`; `choropleth.js:59` and spatial
      `state.js:99-108` keep private memos a ~10-line URL→promise map in
      `fetchJSON` would retire.
- [ ] **S24 (Low, M)** — the shared dictionary is 66 KB on every page,
      including article pages that use ~10 % of it; five block-only sections
      (references overview, collection overview, spatial, entity networks,
      keyword explorer) can move to the per-block mechanism that already
      exists. Do after S10.
- [ ] **S25 (Low, S)** — nothing in `tests/js` exercises `buildFacetButtons`,
      `createPlaybackTimer`, keywords-state transitions, the spatial race
      guard or the compare picker; S5, S7, S8, S11 and S12 are each a 20-line
      `node:test` away from being locked in.

### P — Python generators

- [ ] **P1 (High, M) — ~92 subset loads per CI run, 26 of `articles`, no
      process-level memo.** ✓ 43 `load_dataset_safe(` call sites (loops at
      `generate_collection_overview.py:1245`, `generate_index_overview.py:505`,
      `generate_spatial_exploration.py:195`, `generate_world_map.py:83`,
      `generate_corpus_health.py:288`, `dashboard_aggregator.py:344` ×3);
      ~20 of the `articles` loads take no `columns=`, so OCR and the 768-d
      embedding are materialised ~20 times — and `iwac_utils.py:1023-1029`
      itself says the pandas conversion, not the download, is where the
      memory goes. `regenerate-data.yml:84-88` runs 31 interpreters
      sequentially. A `scripts/run_all.py` with a `FrameStore.get(subset,
      columns)` memo (one wide frame per subset, `df[cols]` views handed out)
      collapses 92 loads to 7 and 31 process starts to 1 — realistically
      20–40 % of the non-UMAP wall time. Cheaper interim: add `columns=` to
      the full `articles` loads that never touch OCR/embeddings (world_map,
      spatial_exploration, index_overview, collection_overview,
      compare_newspapers, keyword_explorer, sentiment_atlas, lexical_metrics,
      topic_explorer, org_cooccurrence).
- [ ] **P2 (High, S) — No Hugging Face cache across CI runs.**
      `regenerate-data.yml:55-58` caches pip only; every push to
      `scripts/*.py` and every monthly run re-downloads all seven subsets.
      `actions/cache` on `~/.cache/huggingface` keyed on
      `HfApi().dataset_info(…).sha` (with `HF_TOKEN` in that step — the
      private mirror 401s otherwise, `iwac_utils.py:1067-1074`); add
      `NUMBA_CACHE_DIR` to the same cache for the four UMAP generators.
- [ ] **P3 (High, M) — The kNN / embedding stack is still copied six times
      after `iwac_embeddings.py`.** ✓ `_coerce_embedding` at
      `generate_article_dashboards.py:498-522`,
      `generate_publication_dashboards.py:288-305`,
      `generate_semantic_landscape.py:67`,
      `generate_periodicals_landscape.py:67` (lines 67–100 of the two
      landscape files are byte-identical bar the output path ✓); L2-normalise
      blocks in six files; `argpartition` top-k in four.
      `generate_article_dashboards.py:59` even imports
      `build_normalized_matrix` (used at `:236` for references) while keeping
      its own 94-line version for articles (`:429-522`). Drift already exists:
      `iwac_embeddings.coerce_embedding:33-55` rejects `ndim != 1`; the local
      copies do not. ~250 lines; verify with the `--limit 5` output diff.
- [ ] **P4 (High, L) — `generate_laicite.py` → a `scripts/laicite/` package
      mirroring `asset/js/charts/laicite/`.** `LaiciteGenerator` (`:572-2993`,
      41 methods, 2,420 lines); `write_all` (`:2933-2989`) is already the
      module map (trends 1091-1150 + seasonality 1700-1743; collocates
      1242-1475 + implicit 1477-1596; corpora 1598-1698; actors 1792-1887 +
      `_authority_index` 1751-1790; arenas 1889-1968; sentiment 1970-2114;
      semantic 2121-2345; bylines 2351-2463; circulation 2469-2618; places
      2620-2702; references 2704-2763; concordance 2767-2927), with
      `List[ItemScan]` (`:517-565`) from `scan_all` (`:637-822`) + `Lexicon`
      (`:385-499`) as the shared input. Three gates must move with it or they
      silently skip a subpackage: `regenerate-data.yml:25` (`scripts/*.py`),
      `lint.yml:101` (`pyflakes scripts/*.py`), `check-python.js:41-45`
      (`readdirSync` of the top directory).
- [ ] **P5 (Med, M) — Entity-index / resolve pipeline forked three ways.**
      `dashboard_aggregator.build_entity_lookup:357-428` vs
      `generate_article_dashboards.build_entity_lookup:269-324` (identical
      except `"row"` and the `_is_target` hook); `resolve_items:434-547` vs
      `resolve_articles:330-404`; `generate_compare_newspapers.
      build_index_lookups:266-342` a third `.iat`-based variant. Extract
      `build_entity_index(index_df, keep_row=False) -> EntityIndex`; make
      `ArticleDashboardGenerator` a `DashboardAggregator` subclass. ~120
      lines.
- [ ] **P6 (Med, S–M) — Timeline year × category aggregation ×4.**
      `generate_collection_overview.compute_timeline:221-285` (count-desc,
      `totals`), `dashboard_aggregator.compute_timeline:612-642` (alpha),
      `generate_references_overview.compute_timeline:295-331`
      (`most_common`), `generate_audiovisual_overview.py:264` — all feed
      `C.timeline`. `iwac_stats.build_timeline_series(pairs, order=…,
      totals=False)`; ordering must be a parameter or outputs change.
- [ ] **P7 (Med, S) — Scalar helpers still duplicated after the v1.9.0
      sweep.** Byte-identical to `iwac_utils.clean_int:625-636`:
      `_int_or_none` at `collection_overview:193-200`,
      `compare_newspapers:134-141`, `index_overview:88-95`; `_clean_text`
      `collection_overview:203-207` = `clean_str:603-612`;
      `_top_n_pipe` `periodicals_overview:297-306` =
      `references_overview:334-342`. **Semantic trap** while merging
      `_first_country`: `dashboard_aggregator:550` and
      `article_dashboards:407` return `""` when the *first* segment is
      unknown; `keyness:189-196` skips to the first non-unknown segment — an
      `"Unknown|Togo"` cell is attributed differently. Pick one, document it.
- [ ] **P8 (Med, S) — `extract_year` is pandas-first per scalar.**
      `iwac_utils.py:362-372` calls `pd.to_datetime(errors="coerce")` before
      the regex, ~40 call sites × several passes over 12k rows. ISO fast
      path (`^\s*(\d{4})(?:-\d{2}(?:-\d{2})?)?\s*$`) first, `to_datetime` as
      the fallback — output-identical for the dataset's ISO dates. Narrow the
      two `except Exception: pass` at `:389` and `:501`.
- [ ] **P9 (Med, S each) — 55 `iterrows()` sites; the hot ones run on 12k
      rows.** `laicite:658` (`_scan_row`, 125 lines per row, four subsets),
      `:900, 1766, 2188`; `dashboard_aggregator:378, 494` (×3 generators);
      `article_dashboards:287, 356`; `scary_terms:281`;
      `sentiment_atlas:330`; `topic_explorer:218`; `semantic_landscape:146`;
      `lexical_metrics:155`; `iwac_utils.aggregate_prevalence:942`.
      `index_overview` recomputes `index_df["Type"].apply(_entity_type_label)`
      five times (`:181, 230, 266, 289, 385`). Use the `zip` / `itertuples`
      form v1.22 already applied to `on_this_day` / `press_bylines`.
- [ ] **P10 (Med, S check / M versioning) — Output contract is convention,
      not contract.** Four metadata idioms coexist: `create_metadata_block`
      under `"metadata"` (17 files) vs `"_meta"` (`entity_networks:297, 361`,
      `on_this_day:482`, `spatial_exploration:446`) vs inline `generated_at`
      (13 files; laicite ×20) vs raw `isoformat()` at
      `article_dashboards:928`, `entity_dashboards:171`,
      `person_dashboards:248` — the three fan-outs still emit `+00:00`,
      contradicting Tier 5's "the `+00:00` outlier is gone". `script_version`
      is hand-maintained in 7 files and read by nothing; the JS reads exactly
      four metadata fields and never `_meta.columns`, so compact-row column
      order is a silent break. Minimal: `scripts/validate_data.py` as a CI
      step with a per-file required-key / row-arity table mirrored from the
      JS consumers, plus `test -s` for every expected output in "Package
      archive" (today only `collection-overview.json`, `:106`). Longer:
      `schema_version` in `create_metadata_block` + `P.assertSchema()`.
- [ ] **P11 (Med, S) — CI: no timings, no failure notice, a 3.12-only lock,
      test deps that drift from it.** ✓ `regenerate-data.yml:84-88` has
      `::group::` only and no `if: failure()` step; `python-lock.js` compiles
      for 3.12/linux only while `scripts/README.md` tells local users to
      `pip install --require-hashes -r requirements.lock` (fails on
      3.11/macOS/Windows); `tests/python/requirements.txt` pins
      `numpy==2.5.1` while `requirements.txt` says `numpy<2.5` and the lock
      has `numpy==2.4.6` (`:692`) — the unit tests run on a numpy the
      generators cannot.
- [ ] **P12 (Med, S) — Empty-data exit codes are inconsistent; one generator
      publishes an empty payload with exit 0.** ✓ `generate_wordcloud.py:
      54-66` returns `_empty_result` when `articles` fails to load and
      `main:180-191` writes it and exits 0 — CI would publish an empty
      `collection-wordcloud.json`. Others raise (`index_overview:494`,
      `keyword_explorer:397`, `laicite:646`, `on_this_day:363`) or
      `return 2`. `required=True` on `load_dataset_safe` + P10's `test -s`.
- [ ] **P13 (Med, S) — Sentiment scale constants triplicated.** ✓
      `POLARITE_ORDER` / `CENTRALITE_ORDER` at `dashboard_aggregator.py:
      131-145`, `generate_compare_newspapers.py:573-586`,
      `generate_sentiment_atlas.py:110-122` (as `POLARITY_ORDER`);
      `laicite:2007-2024` tallies with no order at all. Home: next to
      `SENTIMENT_MODELS` (`iwac_utils.py:1117`).
- [ ] **P14 (Med, S) — Stopword / tokenizer copy in `compare_newspapers`.**
      `generate_compare_newspapers.py:79-115` duplicates
      `iwac_utils.py:785-832` byte-for-byte; the comment at `:77-78`
      ("duplicated here to avoid cross-script imports") is stale — the file
      already imports `iwac_utils`. `laicite:327` `TOKEN_RE` is deliberately
      different — rename it `ASCII_TOKEN_RE` so it isn't "fixed".
- [ ] **P15 (Low, S)** — the argparse prologue is hand-rolled in 20 of 31
      generators (~400 lines) although `add_standard_args` exists;
      `--minify` defaults to False in `collection_overview:1330`,
      `index_overview:594`, `keyword_explorer:369`,
      `audiovisual_overview:512`, `laicite:3081`, `scary_terms:850`,
      `world_map:119`, so those bundles ship pretty-printed — probably
      intentional for diffability; say so in the README table.
- [ ] **P16 (Low, S)** — four generators count raw `country` without
      canonicalising (`world_map.py:83-90`, `wordcloud`, `reprints`,
      `publication_dashboards`); `FOCUS_COUNTRIES`
      (`spatial_exploration:71`) restates the six names → promote to
      `iwac_utils.IWAC_COUNTRIES`.
- [ ] **P17 (Low, S)** — `collection_overview.compute_newspapers:695-789` and
      `compute_newspaper_coverage:544-616` run the same per-row loop over the
      same two subsets; one pass, two shapers (~60 lines).
- [ ] **P18 (Low, S)** — provenance: `iwac_utils.copy_to_build:1385-1411` has
      0 callers and targets a `build/data` dir this repo doesn't have;
      `iwac-dashboard` references survive as design rationale in
      `collection_overview:20, 85, 108, 977`, `keyword_explorer:15, 20, 70,
      127, 145`, `scary_terms:29`, `wordcloud:10`, `entity_networks:67`,
      `spatial_exploration:77`; `check-python.js:36` hard-codes a personal
      Windows path ✓.
- [ ] **P19 (Low/Med, M)** — 51 test cases, none for the three largest
      generators. Highest value, all synthetic-frame: (1)
      `collection_overview.compute_timeline` + `compute_newspapers` (pipe
      countries, `Unknown`, partial dates, ordering, `totals`); (2)
      `dashboard_aggregator.build_entity_lookup` + `resolve_items` vs
      `ArticleDashboardGenerator` parity — pins the fork until P5 lands; (3)
      `sentiment_atlas` with one model absent; (4)
      `laicite._scan_row` with a hand-built `Lexicon` (overlap claimed once,
      laity demotion, `OCR_is_public` gating); (5)
      `references_overview.compute_subject_cooccurrence` +
      `compute_author_collaborations` (`min_weight`, node order, the
      `edge_refs` cap).

### H — PHP / templates

- [ ] **H1 (Med, S) — `iwac-data.zip` has no integrity check.** ✓
      `regenerate-data.yml:125-147` uploads with `--clobber` and no digest;
      `SyncData.php:104-109` checks `bytes > 0`; `:117` `CHECKCONS` catches
      structural corruption only. Publish `iwac-data.zip.sha256` alongside;
      download the sidecar first and `hash_file` the archive in `perform()`,
      degrading to a logged warning when an older release has no sidecar.
- [ ] **H2 (Med, S–M) — The sync job has no retry, no disk check, and
      orphans its temp trees on a hard kill.** `SyncData.php:279-309` one
      curl attempt; no `disk_free_space()`; job-scoped temp names (`:72-74`)
      cleaned only in `finally` (`:220-227`), which does not run on SIGKILL /
      OOM, and `:198` clears only the job's own sibling — each killed run
      leaves ~18k files under `files/iwac-visualizations.tmp/`. Sweep stale
      `stage-*` / `old-*` / `download-*` at job start; require
      `disk_free_space > 2 × bytes` before `extractTo`; retry once on curl 7 /
      28 / 56.
- [ ] **H3 (Med, S) — No pot extraction; the catalogue drifts with no
      lint.** ✓ `OnThisDay.php:24-26` (the three layout labels), `:38`
      `Default layout` and `:39-40` are `// @translate` strings rendered
      through `$view->translate()` in the admin form and appear in neither
      `template.pot` nor `fr.po` — French admins see English. Source strings
      123, pot 125, po 128; four stale pot entries. `scripts/extract-pot.js`
      (the two patterns `xgettext` uses) + `lint:i18n-pot` failing on
      `source ⊄ pot` and `pot ⊄ po`; `lint:i18n-mo` stays as the second half.
- [ ] **H4 (Med, M) — `Module.php` carries four concerns; the sentiment
      vocabulary is the one enum win.** ACL `:154-166`, ~100 lines of CSP
      parsing `:198-296`, the vocabulary with hard-coded item IDs `:30-119` +
      five static helpers `:351-370`, the display-values listener `:298-349`.
      `match` 0, `readonly` 0, `enum` 0, `strict_types` 0/32 ✓. Move the
      header rewrite to `src/Mvc/EmbedFramingListener.php`; three backed enums
      (`Polarite` / `Centralite` / `Subjectivite` with `fromItemId()` and
      `label()` via `match`) replace six arrays and five helpers, keeping
      `Module::getPolariteLabel()` as one-line shims because `article.phtml`
      calls them statically. Add `strict_types` to `src/` in one batch under
      the integration matrix.
- [ ] **H5 (Med, M) — Assets live in 21 near-identical templates while
      `BlockRegistry` is the truth for everything else.** 19 of 21
      `block-layout/*.phtml` are a single `iwac-block-shell` call with a
      literal `assets` array (only `collection-overview` and `on-this-day`
      carry logic), and nothing verifies that a `panels` / `orchestrator` /
      `renderers` entry resolves to an existing `.min.js` — a typo is a
      silent 404 in the lazy chain. Do the file-existence lint first (parse
      the templates' arrays; it is the stronger half of `check-blocks` rules
      3–4). The generic template (manifest in
      `BlockRegistry::BLOCKS[slug]['assets']`, `templateViewScript()` and
      `embed/block.phtml:2` dispatching to `_generic`, an optional
      `'template' =>` override for the two logic-bearing blocks) deletes ~19
      files and makes "which block loads d3?" a one-array question.
- [ ] **H6 (Med, S–M) — The inline lazy loader should be a real script with
      a JSON payload.** `iwac-assets.phtml:322-372` is a string-concatenated
      inline script — the only inline script per block page —
      `tests/js/assets.test.js:131-134` has to regex it out of PHP output, and
      a host CSP with `script-src 'self'` breaks every block page (Omeka's
      `headScript` has no nonce plumbing). `asset/js/iwac-lazy.js` +
      `<script type="application/json" class="iwac-vis-lazy-manifest">`
      (inert under CSP); the embed layout's dynamic `<style>`
      (`layout/embed.phtml:104-127`) → a `style` attribute on `<html>`.
- [ ] **H7 (Low, S)** — embed responses carry no `Cache-Control`
      (`EmbedController.php:66-118`; public, read-only, third-party fetched
      → `public, max-age=300`); `site_admin` may run the global filesystem
      job (`Module.php:162-165`); `embeddable` is `true` on 21/21 rows so
      `embeddable()` and `check-blocks` rule 5 guard a case that cannot occur;
      the two-rename swap (`SyncData.php:199-207`) has a sub-ms 404 window a
      symlink flip would close if the web server follows symlinks under
      `files/`.

### C — CSS

- [ ] **C1 (Med, M) — 59 byte-identical declaration groups / 110 instances.**
      `.iwac-vis-scary-view-btn` = the core tab/pagination/facets button
      verbatim (10 declarations; the open "toggle family" item); ×3 toolbars
      (`-index-table-controls`, `-spatial-toolbar`, `-networks-toolbar`); ×3
      sidebar labels; ×4 `__item-name`; ×5 two-column layouts — two of them
      inside core (`.iwac-vis-overview-grid`, `.iwac-vis-block
      .dashboard-charts`); ×5 chip rows; ×6 eyebrow labels inside
      `compare-newspapers.css` alone; ×8 flex-column wrappers in
      laicite/scary; ×4 `:focus-visible` blocks re-stating core; core
      `.iwac-vis-block-header__desc` = core `.iwac-vis-section-desc`. Promote
      `.iwac-vis-toolbar`, `.iwac-vis-aside__label`, `.iwac-vis-list__name`,
      `.iwac-vis-chip-row`, `.iwac-vis-eyebrow`, `.iwac-vis-layout--sidebar`
      (~250–300 lines).
- [ ] **C2 (Low/Med, S each) — Modern CSS: adopt / don't.** Counts:
      `@container` 6, `:has()` 0, `@layer` 0, `clamp()` 12, `text-wrap` 1,
      `overscroll-behavior` 0, `forced-colors` 0, logical properties 8 vs
      physical 22, `color-mix()` 112. Adopt: `overscroll-behavior: contain`
      on the scroll containers (tables, concordance, sidebars — stops scroll
      chaining inside embeds); `text-wrap: balance` on block/section
      headings; `:has()` for JS-toggled state classes; more `@container` on
      the panel grid (inside the theme's 27 % sidebar layout, viewport
      queries mis-size panels). **Do not** adopt `@layer`: the host theme is
      unlayered, and unlayered rules beat any layered rule regardless of
      specificity, so wrapping module CSS in a layer silently inverts every
      module override. Low value: logical properties (en/fr LTR only),
      `forced-colors` (canvas cannot honour it).
- [ ] **C3 (Low, S)** — residue the linter cannot see: `z-index` literals
      with no scale (1, 2, 5, 6, −1, `30` at `entity-networks.css:144` /
      `term-trends.css:48`, `1000` at `iwac-core.css:690`) →
      `--iwac-vis-z-{raised,overlay,popover}`; four raw `border-radius`
      (`person-dashboard.css:386, 437, 573`, `iwac-core.css:1260`); two
      unsanctioned `!important` (`person-dashboard.css:113`,
      `entity-networks.css:106`). Media widths are all on the theme scale
      (640px: 0 — the Tier 2 drift is gone); `font-size` px literals: 0.
- [ ] **C4 (Low, S)** — dead CSS is ~4 rules (`.iwac-vis-scary-details-list`
      `scary-terms.css:485`, `.iwac-vis-article__body`
      `article-dashboard.css:28`, `.iwac-vis-entity__body`
      `person-dashboard.css:27`, `.iwac-vis-sent-axis__verdict--differ`
      `article-dashboard.css:224`); the other 16 unmatched names are
      dynamically composed BEM (`table.js:126, 148-149, 213`,
      `clippings.js:47`). Keep the detector as `lint:css-dead` with a
      composed-prefix allowlist.
- [ ] **C5 (Low, M)** — `laicite.css` is 1,471 lines, larger than
      `iwac-maplibre.css` plus five block sheets; split by view since
      `blockCss` already takes a list.

### B — Build, CI, tests

- [ ] **B1 (Med, M step 1 / L step 2) — esbuild: order-preserving bundles
      first, ESM later; self-hosted ECharts settles ROADMAP 5.4.** Today: 153
      sources → 669 KB `.min.js`; ~33 files per block; the always-loaded set
      is 11 files / 111 KB (`iwac-i18n.min.js` 66 KB, 827 keys in both
      languages, to every visitor) + 5 chart-options files / 34 KB; terser
      has no sourcemaps (`build-js.js:30-37`); the load order lives in PHP
      (`iwac-assets.phtml:196-289`). Step 1: move the order into a JSON
      manifest read by *both* `build-js.js` and the partial; concatenate in
      that exact order into `dist/shared-core.min.js` (+ `shared-charts`,
      `shared-map`, `shared-d3`) and `dist/<slug>.min.js`, with external
      `.map` files. The loader's URL-dedupe queue (`:333-336`) already handles
      two blocks on one page as long as shared code stays in its own bundle —
      never inline shared code into per-block bundles or the IIFEs execute
      twice. Requests per block: ~33 → 3–5. Step 2: real `import`/`export`
      via `esbuild --format=iife --global-name=IWACVis`; `d3` stays a global
      read, `maplibregl` stays behind `P.withMaplibre`,
      `check-maplibre-gates.js` keeps scanning sources. Risks: `.min`
      committed convention and the `git diff --exit-code` guard keep working
      (esbuild is deterministic); Playwright fixtures reference `.min` paths;
      `release.yml:113`'s required-file list gains the bundles; Omeka `?v=`
      is per-URL and unaffected. ECharts self-host (estimate — `echarts` is
      not installed here): series used bar 28, line 22, heatmap 7, scatter 6,
      graph 2, treemap, sunburst, sankey, radar, pie, custom, chord (+
      `wordCloud` via the plugin); components tooltip, title, grid, legend,
      dataZoom, axisPointer, visualMap, calendar, aria, toolbox, markLine,
      markArea, graphic; API `init`, `registerTheme`, `color.*` — all
      exported by `echarts/core`. Full 6.x ≈ 1.0–1.1 MB (~330 KB gz); this
      set ≈ 650–750 KB (~210–240 KB gz). The decisive argument is 5.4's
      GDPR / first-party point, `?v=` busting and SRI becoming moot, at the
      cost of jsDelivr's edge latency for the West-African audience.
- [ ] **B2 (Med, S–M) — Lint gaps, ranked by value over noise.** (1) eslint
      `recommended`, `sourceType: script`, globals `IWACVis, echarts,
      maplibregl, d3` — `no-undef` / `no-unused-vars` cover the class of bug
      `check-maplibre-gates.js` hand-rolls in 283 lines; (2) phpstan level
      5–6 with `scanDirectories` at the Omeka checkout
      `omeka-integration.yml:80-84` already downloads; (3) ruff `select =
      ["F", "E9"]` — pyflakes-equivalent, zero added noise; (4) stylelint only
      for `no-duplicate-selectors` / `declaration-no-important`; (5)
      php-cs-fixer last. Regex-based scripts worth naming:
      `check-theme-tokens.js` (701 lines, 33 regex sites),
      `check-blocks.js` (parses PHP arrays with regex — replace with
      `php -r 'echo json_encode(BlockRegistry::BLOCKS);'`),
      `check-maplibre-gates.js`, `check-i18n.js`.
- [ ] **B3 (Med, M) — Tests: 89 JS + 31 browser + ~30 PHP checks; the block
      option builders and several pure helpers are untested.** Not covered:
      the 55 files calling `setOption`, `dashboard-core.js` (theme rebuild /
      `registerChart`), `hijri.js` (pure, 14 consumers, 0 tests), `embed.js`,
      `table.js`, `annotated-timeline.js`, `concordance.js`. Playwright
      fixtures load `.min.js` only and no ECharts — charts never render in
      browser tests; `retries: 2` (`playwright.config.js:10`) hides flakes
      without a report. Five to add: (1) `SyncData::perform()` against local
      zip fixtures (a `../` entry, a symlink, a truncated archive — only the
      static predicates are tested, `run.php:333-351`); (2) every `panels` /
      `orchestrator` / `renderers` entry across the 21 templates resolves to
      an existing `.min.js` (H5); (3) `hijri.js` round-trips; (4)
      `EmbedController::blockAction` param matrix in `omeka_boot.php`; (5)
      the i18n source ⊂ pot ⊂ po chain (H3).
- [ ] **B4 (Med, S) — Path filters skip `lint:theme` / `lint:blocks` on view-
      and src-only PRs.** ✓ `build-check.yml:20-52` lists `asset/**`,
      `language/**`, scripts, tests, `config/module.ini`, `tokens.json`,
      package files — not `view/**`, `src/**`, `Module.php`,
      `config/module.config.php`; `lint.yml` triggers on `**/*.phtml` but
      never runs `npm run lint`. So a `<style>` token violation in a view
      (exactly what `check-theme-tokens.js:483-501` scans) or an `embedSlug`
      mismatch reaches `main`; `omeka-integration` catches only a missing
      template. Add the four paths to `build-check`, or a cheap
      `npm run lint` job to `lint.yml`.
- [ ] **B5 (Low/Med, S)** — `regenerate-data.yml`: sequential, uncached (P2),
      unchecksummed (H1), no `if: failure()` notice (P11); matrix parallelism
      only after the cache lands (each matrix job would re-download).
- [ ] **B6 (Low, S)** — `CITATION.cff` (1.54.0) and the README citation
      (1.37.0) sit outside `lint:versions` (`check-versions.js:16-22`) ✓; add
      both to the lockstep. (Not touched in this commit: whether v1.58.0 is
      released is not visible from a shallow clone.)
- [ ] **B7 (Low, S)** — `dependabot.yml` says pip is "intentionally
      unpinned" while `requirements.lock` + `--require-hashes` exist; update
      the comment or target the lock.
- [ ] **B8 (Low, S)** — no sourcemaps (`build-js.js:30-37`) — folds into B1;
      Playwright `retries: 2` should at least report flakes (JSON/GitHub
      reporter, fail on `flaky > 0`).

### D — Docs

- [ ] **D1 (Med, M) — README is 234 KB, 64 % changelog, and its reference
      sections are stale.** ✓ `:9` "nineteen page blocks" (the registry has
      21 — corrected in this commit, as was PRODUCT.md's "twenty"); the
      Architecture tree (`:887-894`) lists 6 `BlockLayout` classes (there are
      21 + the `OnThisDay` form override) and shows `asset/data/*.json` as
      tree contents although they are gitignored since #7; `:238` "run
      manually when the dataset updates" contradicts `:473`; `:1363` cites
      1.37.0. `CLAUDE.md` tells every session to read this file first. Split
      into `CHANGELOG.md` (lines 7–651) and `ARCHITECTURE.md`; add
      `CHANGELOG.md` to `release.yml:113`'s required list; regenerate the tree
      from `find`.
- [ ] **D2 (Low, S)** — `.impeccable/` + `DESIGN.md` + `PRODUCT.md` are
      correctly export-ignored and deny-listed, but the `--iwac-vis-model-*`
      colours now exist in CSS, `design.json` and `DESIGN.md` front-matter with
      no lint tying them together; either `lint:design-record` or drop the
      literals from the prose and reference the CSS.
- [ ] **D3 (Low, S)** — this file (Tiers 2 and 5) describes
      `P.attachGraphClickThrough` as wired; it has no callers (E9). Tier 5's
      "the `+00:00` outlier is gone" is contradicted by three fan-outs (P10).

### Suggested waves

1. **Quick, safe, build-verifiable (one release):** E1, E4, E14, E15
   (beeswarm delete), M1, M2, M4, M16, M17, S5, S6, S9, S18, S22, P2, P12,
   P13, P14, H1, H3, B4, B6, B7 — roughly two days, every item has a lint or
   a test that proves it.
2. **The reactive core (S11 → S1 → S2 → S4, with E3/E5, S7/S8):** store, URL
   state, focus-safe controls, linked country facet; land block by block
   (person facet → keywords → spatial → laïcité/scary), each behind the
   existing Playwright fixtures plus S25's unit tests.
3. **Data back to the reader (S3, E17, M11, M18):** table/CSV toolbar,
   choropleth legend, keyboard routes.
4. **Build (B1 step 1 → B2 eslint → B1 step 2 + ECharts self-host):** the
   ROADMAP 5.4 decision is the owner's; steps 1 and eslint are independent
   of it.
5. **Consolidation (E6–E10, M10, M12, C1, P3–P7, S15, H5):** the duplication
   clusters, each verified with output diffs or the fixture suite.
6. **Structural (P1 + P4, M13, M14, D1):** the generator runner and the
   laïcité package, `transformStyle`, the basemap decision, the README split.

### Verified clean this pass (don't re-audit)

- ECharts event hygiene: no `.on()` inside any `registerChart` render
  callback; all 11 click bindings sit on the instance `registerChart`
  returns, which survives theme swaps. No ECharts 5-era options other than
  E14. Tooltip HTML is escaped at all 34 sites.
- MapLibre: `onStyleReady` re-runs do not double-add (guards + the diff path);
  `generateId` is right (no panel depends on ids across `setData`); no
  clustering and no DOM markers is right at these volumes; the choropleth's
  `whenStyleReady` race fix, page cache and id suffix; compare-newspapers'
  disposal is complete; the abstract graph's option subset.
- State: closing over `registerChart`'s return value is safe; the spatial
  race guard; `buildSearchDropdown`'s self-removing listener; the deliberate
  non-fire of `buildFacetButtons` on init; the `aria-pressed` choice over
  `tablist` for chart switchers; the lazy-loading discipline throughout; the
  `IWACVisLazy` merge for two blocks on one page (covered by
  `assets.test.js:274`).
- Python: pipe splitting, Hijri reads, `lda_topic_id` float handling,
  multi-model sentiment resolution, `is_unknown` parity with JS, embeddings
  batching, fan-out `log=False`, type hints / logging / pathlib / main guards
  uniform, the five `except Exception` all targeted, template ids not
  duplicated as constants.
- PHP: raw `$primary` in the embed layout's CSS context (hex-validated
  twice), CSRF + POST-only + ACL on the sync form, `releaseUrlForTag` as the
  only download origin, zip hardening, `relaxEmbedFraming`, the
  `SENTIMENT_MODEL_STEMS` ⊃ `MODEL_INFO` asymmetry, no `headScript` outside
  the partial except the embed views.
- CSS: the module-wide reduced-motion catch-all covers all 42 transitions;
  media widths all on the theme scale; the 16 "unreferenced" classes are
  composed BEM.
- CI: fork-PR secrets safe; only `release` / `regenerate-data` are
  `contents: write`; Playwright uses structural assertions against a static
  server; the release archive deny-list.

### False positives — do NOT "fix" these (Tier 8 additions)

- **`setOption(opt, true)` is not the transition killer.** Series views are
  reused across notMerge when names are stable; fix item names (E3), not the
  merge mode. `universalTransition` and `dataset`/`transform` do not apply.
- **The `setOption` monkey-patch signature is fine** (`native.apply(instance,
  arguments)`); the problem is what runs after it (E1).
- **`progressive: 0` on the two small sentiment heatmaps** is deliberate.
- **`filterMode: 'none'` on the landscape zooms** is required.
- **Entity networks on MapLibre** (M20) — do not port to the canvas renderer.
- **Manual `ResizeObserver` / `setTimeout(resize)` on maps** is redundant
  (`trackResize`) but harmless; not a bug.
- **`index-overview.js:170-175` `setTimeout(next, 0)`** is a main-thread
  yield, not sloppy sequencing.
- **`keyness`'s "sibling pipeline" comments** name the live IWAC-Hugging-Face
  pipeline, not the deprecated `iwac-dashboard`.
- **`laicite:327` `TOKEN_RE`** is a deliberately different post-fold
  tokenizer — rename, don't merge (P14).
- **`@layer` for the module CSS** would invert every override of the
  unlayered host theme (C2).
- **Historical changelog lines that say "MapLibre 5.24"** (`README.md:537`,
  ROADMAP Phase 4's title) describe the release they belong to; leave them.

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
