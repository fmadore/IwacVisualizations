# IWAC Visualizations

An [Omeka S](https://omeka.org/s/) module that adds interactive visualizations to the [Islam West Africa Collection (IWAC)](https://islam.zmo.de/) digital archive at ZMO. Charts are powered by [ECharts 6](https://echarts.apache.org/) and [MapLibre GL](https://maplibre.org/); the underlying data is either fetched live from the public Hugging Face dataset [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) or precomputed via Python scripts under `scripts/`.

The module targets the [IWAC theme](https://github.com/fmadore/IWAC-theme). It reads the theme's CSS custom properties at runtime so chart colours and type track the site's configured `--primary` / `--ink` / `--surface` colours and `--font-headings` / `--font-body` stacks, it respects the light/dark toggle via a `MutationObserver` on `body[data-theme]`, and it follows the Internationalisation module's language switching (English / French).

## Status

Every registered block is wired end-to-end with live data — twelve page blocks and the template-dispatched resource-page blocks (plus the Item Set Dashboard, which lights up opportunistically where a corpus aggregate exists).

| Block | Type | Status | Data path |
|---|---|---|---|
| Collection Overview | page block | **Live** — 13 panels | Precompute (`generate_collection_overview.py` + two sidecar generators) |
| Index Overview | page block | **Live** — 7 Section A panels + Keyword Explorer | Precompute (`generate_index_overview.py` + `generate_keyword_explorer.py`) |
| References Overview | page block | **Live** — 10 panels | Precompute (`generate_references_overview.py`) |
| Scary Terms | page block | **Live** — bar-chart race + country view + global view | Precompute (`generate_scary_terms.py`) |
| Topic Explorer | page block | **Live** — LDA-30 overview + per-topic drill-down (first consumer of `IWACVis.dashboardLayout`) | Precompute (`generate_topic_explorer.py`) |
| Periodicals Overview | page block | **Live** — 6 panels: runs gantt, issues/year, languages, countries, top subjects | Precompute (`generate_periodicals_overview.py`) |
| Semantic Landscape | page block | **Live** — zoomable UMAP scatter of all 12,286 articles, Country/Decade/Topic facets | Precompute (`generate_semantic_landscape.py`) |
| Sentiment Atlas | page block | **Live** — corpus-level 3-model AI sentiment: polarity/centralité over time, subjectivity trends, polarity×subjectivity, centralité-by-country heatmap, extreme-article keywords, cross-model agreement + Gemini 3 Pro arbiter | Precompute (`generate_sentiment_atlas.py` + `generate_sentiment_arbiter.py`) |
| Press Language | page block | **Live** — readability / lexical richness / article length over time and by newspaper | Precompute (`generate_lexical_metrics.py`) |
| Spatial Exploration | page block | **Live** — world bubble map + 6-country focus + entity picker (persons / organizations / events / subjects / places) with per-place item popovers | Precompute (`generate_spatial_exploration.py`) + existing per-entity dashboard fan-outs |
| Entity Networks | page block | **Live** — cross-type co-occurrence graph (precomputed ForceAtlas2 layout) + geographic co-mention network, both rendered with MapLibre GL | Precompute (`generate_entity_networks.py`) |
| Visualizations / Audio (template 9) | resource-page block | **Live** — minimal-item dashboard (sibling sparkline + similar-items strip) | Precompute (`generate_template_summary.py`) |
| Visualizations / Video recording (template 19) | resource-page block | **Live** — same minimal-item dashboard, audiovisual subset | Precompute (`generate_template_summary.py`) |
| Visualizations / Document (template 22) | resource-page block | **Live** — same minimal-item dashboard, documents subset | Precompute (`generate_template_summary.py`) |
| Visualizations / Person | resource-page block | **Live** — 11 panels | Precompute (`generate_person_dashboards.py`) |
| Visualizations / Entity (Lieux, Organisations, Sujets, Événements) | resource-page block | **Live** — reuses Person panels | Precompute (`generate_entity_dashboards.py`) |
| Visualizations / Article (bibo:Article, template 8) | resource-page block | **Live** — 5 panels incl. 3-layer context network + semantic neighbours | Precompute (`generate_article_dashboards.py`) |
| Visualizations / Publication (bibo:Issue, template 21) | resource-page block | **Live** — stat cards + periodical-run sparkline + nearest issues in the run + semantic neighbours (auto-elided until upstream ToC coverage grows) | Precompute (`generate_publication_dashboards.py`) |
| Item Set Dashboard | resource-page block | **Live** — opportunistic: renders the matching compare-newspapers corpus aggregate (newspapers / periodicals / countries); silently removes itself elsewhere | Reuses `generate_compare_newspapers.py` output |

Current version: see `config/module.ini` (`version = …`). This value drives the `?v=` query string Omeka appends to every asset URL, so bumping it is the canonical way to bust the browser cache after a source change.

### v1.7.0 — Spatial Exploration + Entity Networks page blocks

Two new page blocks porting the core views of the standalone [IWAC-spatial-overview](https://github.com/fmadore/IWAC-spatial-overview) dashboard into the module, on module infrastructure:

- **Spatial Exploration page block** — world bubble map of every geocoded place in the collection with an entity picker (Persons / Organizations / Events / Subjects / Places, accent-insensitive search over the full authority index). Selecting an entity re-scopes the map to its related places; hovering a bubble previews the first items, clicking pins the full paginated item list (shared `P.buildMapPopup`). Country-focus select zooms + filters to one of the six IWAC countries (place→country resolved at generation time by walking the index's `Partie de` chain); the existing choropleth toggle fills countries with item counts (collection-wide, or the selected entity's). Entity selections hydrate from the **existing** `person-dashboards/` / `entity-dashboards/` fan-outs — zero data duplication; the block's own sidecar (`spatial-exploration.json`, 148 KB minified) carries only places, picker indexes, country counts and bounds.
- **Entity Networks page block** — co-occurrence networks rendered with **MapLibre GL instead of a graph library**: positions are precomputed (networkx ForceAtlas2 in `generate_entity_networks.py`, inverse-Web-Mercator-projected so on-screen geometry is isometric to the layout), so the client does zero layout work and pan/zoom over ~7,400 edges (Entities) / ~11,000 edges (Places) stays GPU-bound; symbol layers give label-collision management for free, and theming / popups / fullscreen / PNG export ride the existing map infrastructure. ECharts graph was rejected (canvas re-render per frame janks at this edge count, force layout on load worse), as was Sigma.js (a second graph dependency duplicating what MapLibre already does here). Two modes: *Entities* (cross-type graph on a blank theme-aware canvas — `P.buildGraphStyle()`; type-filter chips, min-weight select, node search) and *Places* (geographic co-mention network over the basemap, lazily fetched). Clicking a node dims the rest of the graph, highlights incident links, and lists the strongest co-occurrences in a details sidebar (each row jumps the camera; title links to the item page).
- **Shared infra:** `shared/maplibre.js` gains `styleMode: 'graph'` + `P.buildGraphStyle()` — blank-canvas maps whose theme swap rebuilds the canvas style (background token + CartoCDN glyphs) instead of applying a Carto basemap; `iwac-core.css` form-control lists extended with the new controls.
- Payloads: `entity-networks-global.json` 183 KB / `entity-networks-spatial.json` 145 KB minified (compact array rows, no per-edge item-id lists — vs 2.2 MB / 4.4 MB for the equivalent data in the standalone app). `networkx` added to `scripts/requirements.txt`.

### v1.6.1 — French translation catalog regenerated (ROADMAP 7.3)

- `language/template.pot` + `language/fr.po` rebuilt from the current sources: **58 entries** (was 17) — all v1.5/v1.6 block labels, admin descriptions, and loading strings now have French; six entries for retired blocks (Knowledge Graph, Compare Projects, …) dropped. `fr.mo` compiled (polib — no gettext needed on Windows).
- `ReferencesOverview`'s admin description corrected (it still claimed live Hugging Face fetch; the block has been precompute-backed since v1.x) and translated accordingly.

### v1.6.0 — four new corpus blocks + Index Overview payload split (Phases 5–6 of [ROADMAP](ROADMAP.md))

- **Periodicals Overview page block** — corpus view of the Islamic press: periodical-runs gantt (25 runs, 1981–2024), issues/year by country, languages (log axis), countries, top subjects. 4.6 KB bundle.
- **Semantic Landscape page block** — zoomable UMAP scatter of all 12,286 articles by full-text embedding similarity, faceted by Country / Decade / Topic, click-through to articles. The bundle is deliberately the module's heaviest (~1 MB minified / ~300 KB gzipped; titles dominate) and loads on-view only. `umap-learn` added to `scripts/requirements.txt`.
- **Sentiment Atlas page block** — the 3-model AI sentiment at corpus level: polarity + centralité over time, polarity by country, polarity × subjectivity, a centralité-by-country-and-year heatmap, the subject/place keywords driving the most extreme-rated articles, per-model subjectivity trends, and cross-model agreement (Gemini↔ChatGPT 71.0 %, ChatGPT↔Mistral 70.9 %, Gemini↔Mistral 64.1 % — pairwise cards + a selectable 6×6 cross-tab). A closing section surfaces the **Gemini 3 Pro arbiter**'s verdicts on the 366 articles where two models diverged sharply, ported from the sibling [IWAC-sentiment-analysis](https://github.com/fmadore/IWAC-sentiment-analysis) study and pre-aggregated to a 1.4 KB bundle. Every panel is labelled as AI-generated assessment.
- **Press Language page block** — readability (Flesch FR), lexical richness (TTR), and article length over time and by newspaper (31 newspapers ≥ 50 articles).
- **Item Set Dashboard went live** (was a placeholder since the scaffold) — see its section above; reuses the compare-newspapers corpus aggregates, zero new precompute.
- **Index Overview split**: `index-overview.json` now carries only the chart aggregates (**186 KB**, was 779); the 4,385 table rows moved to `index-overview-table.json` (**567 KB**) fetched when the table panel nears the viewport. With the v1.3.0 Section B deferral, the block's eager payload dropped ~1.9 MB → ~190 KB.

### v1.4.0 — ECharts 6 adoption + compare-newspapers modularization + payload diet (Phases 3–5 of [ROADMAP](ROADMAP.md))

- **Native `chord` series.** `C.chord` now emits ECharts 6.0's reintroduced `series-chord` instead of the `graph`+`layout:'circular'` emulation written in the ECharts-5 era — ribbon widths finally encode the pairwise co-occurrence weights directly. Same `{names, matrix}` contract, so the shared `chord` renderer and the person-dashboard co-occurrence panel needed no changes.
- **Graph minimap.** The person association network and the article 3-layer context network opt into ECharts 6's `thumbnail` component (`C.network(…, {thumbnail: true})`) — a token-styled minimap with a viewport window for orientation while roaming; auto-hidden ≤ 640px.
- **`aria.enabled` on every chart.** `dashboard-core.js` merges a baseline aria config after each render (and re-applies after theme swaps), so every ECharts canvas now carries a generated screen-reader description. Zero visual change — decal patterns deliberately stay off.
- **Cooperative gestures on every map.** Wheel zoom now requires Ctrl/⌘ and touch pan two fingers, so page scrolling never fights the map. The historical blocker (English-only hint dialog) is gone: the hint strings ship in French/English via MapLibre's `locale` option. Opt out per map with `mapOptions: { cooperativeGestures: false }`.
- **Index Overview INP**: Section A's seven panels mount one macrotask apiece instead of one synchronous pass, letting the browser paint and respond between chart inits.
- **`compare-newspapers.js` modularized** (the last monolith): 1,452 lines → a 239-line orchestrator + 10 panel modules under `compare-newspapers/` (helpers, picker, metrics, overlap, timeline, subjects, wordclouds, map, sentiment, newspapers), mirroring the v0.23.0 scary-terms split. Every moved function verified byte-identical; the block template gained the ordered `panels` list.
- **Python dedup**: the ~15 methods duplicated between `generate_person_dashboards.py` and `generate_entity_dashboards.py` (loaders, entity lookup, document frequency, the whole `compute_*` family) moved into a shared `scripts/dashboard_aggregator.py`; both generators verified byte-identical output on samples. Generator CLI flags normalized (`--output-dir`, `--minify/--no-minify`, `--limit`, `--min-cooccurrence`).
- **World map payload**: `world_countries_simple.geojson` simplified with mapshaper from **1,022 KB to 200 KB** (242 features and the `name` property set verified identical).
- **`P.formatDate`** passes unparseable inputs through verbatim instead of slicing them to 10 chars (the publications subset's range dates like `2009-05/2009-08` were being cut mid-range).

### v1.3.0 — performance + correctness quick wins (Phase 1 of [ROADMAP](ROADMAP.md))

- **Exact CDN pins.** `iwac-assets.phtml` now pins `echarts@6.1.0`, `maplibre-gl@5.24.0`, `echarts-wordcloud@2.1.0` instead of floating major tags — the floating `@6` had silently auto-upgraded the live site to ECharts 6.1.0 on 2026-05-19. Exact-version jsDelivr URLs are also immutable-cached for a year (floating tags resolve through a short-TTL redirect), so repeat-visit LCP improves and every upgrade becomes a deliberate, testable constant bump.
- **CDN preconnect.** A `<link rel="preconnect">` (+ `dns-prefetch` fallback) to `cdn.jsdelivr.net` is emitted from the shared partial — the on-view lazy loader meant the first library request also paid DNS + TCP + TLS (~100–200 ms) right when the user reached the block.
- **`P.fetchJSON()` + JSON cache-busting.** New shared fetch helper in `shared/panels.js` (same-origin credentials, JSON Accept header, consistent error messages) that appends `?v=<asset version>` to every `asset/data/` request. The version is parsed at runtime from `dashboard-core.min.js`'s own script URL (Omeka's `assetUrl` puts it there from `config/module.ini`), so regenerated data bundles finally bust browser caches in lockstep with code — previously a monthly regeneration could serve stale dashboards for weeks. All 13 fetch sites migrated; the per-block `fetchJson`/`fetchJSON` wrappers in compare-newspapers / scary-terms now delegate to it.
- **Index Overview Section B deferred.** The three keyword-explorer JSONs (~1.08 MB of the block's ~1.9 MB payload) now load only when the Keyword Explorer section nears the viewport instead of up-front with Section A. Panels keep their height reservations, so no layout shift — just a spinner if you outrun the fetch.
- **Documents/Photograph wiring fixed.** `Visualizations::TEMPLATE_PARTIALS` mapped Photograph (15) to the `documents` HF slice, but photographs aren't exported to the HF dataset at all — those pages showed unrelated archival-documents data, while real Document items (which moved to their own template 22 upstream) got nothing. Now: `22 => minimal-item`; photograph pages intentionally render nothing.
- **Table thumbnails** get intrinsic `width`/`height` attributes (CLS belt-and-braces; the `--iwac-vis-thumb-*` ramp still owns rendered size).
- **Docs**: References Overview sections updated to the precompute reality (the live-fetch path remains documented as a supported strategy, currently unused); ROADMAP.md rewritten as the phased implementation tracker for the June 2026 evaluation.

### v0.24.0 — Collection Overview mobile + chart polish

Targeted fixes to the Collection Overview block, mostly mobile readability:

- **Vertical y-axis titles.** The value-axis name (e.g. "Count") on every vertical bar chart now sits rotated along the left edge instead of floating at the top-left. New shared helper `C._valueAxisName()` (chart-options core) applied to `timeline`, `stackedBar`, and `growthBar`; the left grid gutter widens to clear the tick numbers. Declutters the panel top, especially on phones.
- **dataZoom no longer collides with the x-axis label.** New `R.valueChartMedia({hasZoom})` preset replaces the blunt `gridMedia`/`dataZoomMedia` combo on the vertical bar charts: on ≤640px it keeps a left gutter wide enough for the rotated name, reserves bottom space so the "Year"/"Month" label sits **above** the slider, and shrinks the slider + fonts. (gridMedia's `bottom:24` under a 36px name gap was dropping the label into the slider track.)
- **Collection growth over time** gets a dedicated mobile preset: both axis names rotate to their respective edges, the long `YYYY-MM` month labels rotate 45° with `hideOverlap`, and fonts/margins tighten so the dual-axis chart stops overlapping itself on phones.
- **Newspaper coverage (Gantt)** thins its year ticks on mobile (interval `/5` instead of `/10`) and keeps a bottom gutter so the "Year" label clears the bars.
- **Languages represented** switches from a donut to a **log-scale horizontal bar**. French is ~97% of the corpus, so the donut buried the other eight languages as unreadable slivers; a log axis (`C.horizontalBar({log:true})`) keeps every language a legible, labelled row while French still clearly leads. A "Logarithmic scale" caption makes the axis explicit.
- **World map** redesign. The Type facet was a no-op (the place bubbles carry no per-type split). Replaced the cryptic toggle glyph + broken type pills with a **Places · By country** segmented control; "By country" reveals a Type sub-facet (All / News article / Islamic periodical / …) that re-fills a choropleth from `country_counts.by_type`. The choropleth gains an opt-in **hover read-out** (`choropleth.js` `hoverInfo`) showing each country's name + count.
- **Facet controls restyle.** Single-facet bars (the "Country" / "Type" labels) rendered their lone button as a permanently-active salmon chip that toggled nothing; they now render as a plain eyebrow `label`. The facet chips themselves get a cleaner segmented-control treatment — a self-evidently tappable pill at rest with the brand color reserved for the selected state (border + weight + a 10% tint), not a heavy wash.

### v0.23.0 — maintainability refactor pass

Structural cleanup, no behavior changes:

- **Shared block-shell partial** (`view/common/iwac-block-shell.phtml`) collapses the asset-loader call + `.iwac-vis-block` wrapper + loading-spinner scaffold that was copy-pasted across nine block templates. Each template now declares only what differs (asset config, modifier class, loading message, optional heading + `data-*` attributes). `SentimentExtractor.php`'s three near-identical property readers fold onto two shared helpers.
- **Breakpoints normalized** to the documented `640 / 768 / 1024` (sm / md / lg) scale. `compare-newspapers.css` had four off-scale one-offs (560 / 720×2 / 900) and `iwac-maplibre.css` used 480; all now snap to the standard tier with a label comment.
- **`chart-options.js` split** from one 1982-line god-module into a core (shared private helpers + country-color map) plus four chart-family files — `chart-options-bar.js`, `-hbar.js`, `-graph.js`, `-special.js` — all extending the same `IWACVis.chartOptions` namespace. The split was a lossless line-range slice (all 26 builders preserved). The repeated right-aligned bar-label config shared by `horizontalBar` / `newspaper` / `entities` is factored into `haloLabel()` / `haloEmphasis()` helpers.
- **Compare Newspapers colors centralized** into one `compareColors()` helper (was copy-pasted across five panels). It reads `--iwac-compare-color-b` off the live block element so the ECharts / MapLibre series track the CSS swatches in *both* themes — fixing a latent bug where dark mode left the charts slate-blue while the CSS legend dots switched to the lighter accent.
- **Scary Terms modularized** — the 60-line en/fr i18n table moves to `scary-terms/i18n.js` and the four stateless builders to `scary-terms/helpers.js`; the orchestrator shrinks from 814 → 670 lines. Its stateful render closure (view modes / playback / co-occurrence matrix) stays in place.

### v0.22.0 — Compare Newspapers split-corpus choropleth

The geographic-comparison map's choropleth toggle replaced with a 4-way segmented control: **Bubbles · A · B · A − B**. Click A or B to see one corpus's per-country mention distribution as a sequential surface→corpus-color ramp; click "A − B" for a diverging fill where countries dominated by A render in the primary color, countries dominated by B render in slate blue, and balanced countries render near surface neutral. The bubble layers (heatmap + circles) for both sides hide automatically while a choropleth view is active.

- **`shared/choropleth.js`** extended with two new options:
  - `hideDefaultControl: true` — skip the built-in toggle button so a caller can wire its own UI (used here so the segmented selector replaces the toggle).
  - `paint` config — `{ mode: 'sequential', accentColor }` builds a surface→accent ramp (corpus A or B), `{ mode: 'diverging', negColor, posColor, neutralColor }` builds neg ← neutral → pos centred on zero (the A − B diff). The `updateCounts(newCounts, { paint: {...} })` method now accepts a paint override on every call, so cycling through the selector swaps both data and palette without re-init.
- **`compare-newspapers.js`** computes three count maps from the regenerated `geo_points` (`country` per point landed in v0.20.0): `aCounts`, `bCounts`, `diffCounts = aCounts − bCounts` over the union of country keys. The custom `CompareSelectorCtrl` MapLibre control hosts the four buttons, calls `applySelector(key)` on click, and tracks active state via an `--active` modifier.
- **`asset/css/iwac-maplibre.css`** ships an `iwac-compare-choropleth-ctrl` style — horizontal segmented buttons (vs the default vertical `maplibregl-ctrl-group`), corpus-name labels (rather than glyphs) so the picker is self-describing at a glance.

### v0.21.0 — Minimal-item dashboard for Audio / Video / Photograph templates

The Visualizations resource-page block now dispatches three more templates: Audio (9), Video recording (19), and Photograph (15). All three route to a new lightweight ``minimal-item.phtml`` partial that renders a small two-slot dashboard via the v0.16.0 layout system — sibling sparkline + "other items in this collection" strip. No per-item bundle bloat: a single corpus-level ``asset/data/template-summary.json`` (37 KB minified) drives every per-item page.

- **`scripts/generate_template_summary.py`** (new) walks the `audiovisual` (45 items) and `documents` (26 items) HF subsets, emits per-subset year histograms + the 30 most-recent items, plus optional `by_medium` (audiovisual) and `by_type` (documents) facet slices for future granular splits when the upstream data grows. Slice keys are NFC-lowercase normalised so the front-end can look them up case-insensitively.
- **`view/common/resource-page-block-layout/visualizations/minimal-item.phtml`** dispatches based on template ID: 9/19 → `audiovisual`, 15 → `documents`. Reads `dcterms:date` to populate `data-pub-year` so the sparkline can highlight the current item's year.
- **`asset/js/charts/minimal-item-dashboard.js`** (~120 lines) registers a `'minimalItem'` layout (two declarative slots) and dispatches via `IWACVis.dashboardLayout.render(body, 'minimalItem', sliceBundle, ctx)`. The `siblingSparkline` and `similarItems` renderers come from the v0.16.0 shared/renderers/ collection — first non-Topic-Explorer external consumer of the layout system + first reuse of those two renderers outside the article dashboard / Topic Explorer.
- **`Visualizations.php`** TEMPLATE_PARTIALS map gains three entries: `9 ⇒ minimal-item`, `19 ⇒ minimal-item`, `15 ⇒ minimal-item`. The dispatcher's "items whose template is not in the map produce no output" rule means unsupported templates remain silent — no regression risk.

Caveats picked up during the build:

- The HF `audiovisual.medium` field carries physical-format labels (`DVD` × 43, `CD` × 1) rather than `audio` / `video`. So Audio and Video pages currently show the **whole audiovisual subset** as siblings, not a clean per-medium slice. The `by_medium` slices are emitted in the JSON for when the upstream pipeline gains cleaner per-template tagging.
- The HF `documents.type` field is currently uniform `'Document'` across all 26 items — Photograph (15) reads from the entire `documents` subset for the same reason. The `by_type` map is in place for the future.

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

Section A is backed by `asset/data/index-overview.json` (chart aggregates, **186 KB** minified) plus `index-overview-table.json` (the 4,385 table rows, **567 KB**, fetched only when the table panel nears the viewport) — both written by `scripts/generate_index_overview.py` since the v1.6.0 split. Section B is backed by three files — `keyword-explorer-subjects.json`, `keyword-explorer-spatial.json`, `keyword-explorer-metadata.json` — generated by `scripts/generate_keyword_explorer.py` (~1 MB total minified), fetched on-view when the Keyword Explorer section approaches (v1.3.0). Net effect: the block's eager payload dropped from ~1.9 MB to ~190 KB. State is in-memory only; filters reset on reload (page blocks can be embedded anywhere, so hijacking the page URL for block-local state is explicitly avoided).

### References Overview (page block)

Bibliographic dashboard over the `references` subset (864 rows), backed by a precomputed bundle (`asset/data/references-overview.json`, generated by `scripts/generate_references_overview.py`). It began life as the live-fetch exemplar that paged the HF `datasets-server /rows` endpoint at every visit (9 parallel requests + client-side aggregation); the move to precompute makes repeat visits one cacheable JSON. 10 panels:

- Summary cards — references / authors / publishers / types / languages / countries
- "Period covered" subtitle
- Timeline — stacked bar of references per year, by type
- Reference types, languages, countries studied — horizontal bars / pie
- Top authors, top subjects — horizontal bars
- References breakdown — country → type treemap
- Author collaborations — force-directed co-authorship network

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

### Periodicals Overview (page block)

Corpus-level view of the Islamic press (`publications` subset, 1,501 issues across 25 periodicals, 1981–2024). Backed by `asset/data/periodicals-overview.json` (4.6 KB, `generate_periodicals_overview.py`): summary cards, a periodical-runs gantt (first → last issue per title, colored by country), issues-per-year stacked by country, languages on a log axis (Français is 99.9 % of issues), countries, and top subjects.

### Semantic Landscape (page block)

The "map of everything": a zoomable scatter of all 12,286 articles placed by UMAP over their 768-dim Gemini `embedding_OCR` (cosine metric, fixed seed). Color facets: Country / Decade / Topic (top-12 LDA topics + Other). Axes are hidden — only proximity means anything, and the panel description says so plainly. Click any point to open the article. Backed by `asset/data/semantic-landscape.json` (columnar, ~1 MB minified / ~300 KB gzipped — the heaviest single bundle in the module, loaded on-view only on pages carrying the block; `generate_semantic_landscape.py`, requires `umap-learn`).

### Sentiment Atlas (page block)

Corpus-level view of the 3-model AI sentiment (Gemini Flash 3.0 / ChatGPT GPT-5 mini / Mistral Ministral 14B) that until now was only visible item-by-item. A global model facet drives polarity and centralité-of-Islam over time, polarity by country, a polarity × subjectivity breakdown, and a centralité-by-country-and-year intensity heatmap; an extremes section shows the subject/place keywords most frequent among the articles a model rated at the ends of each scale; a subjectivity trend overlays all three models; and a model-pair facet drives cross-model agreement (pairwise rates + a polarity cross-tab) alongside the **Gemini 3 Pro arbiter** — an independent judge that, blind to which model was which, adjudicated the 366 articles where two models diverged sharply (≥ 3 points on a dimension). Every panel is explicitly labelled as AI-generated assessment, per the module's convention for computational artefacts.

The polarity/centrality/subjectivity/correlation/heatmap/extremes cuts all recompute from Hugging Face via `generate_sentiment_atlas.py` (≈ 40 KB bundle). The arbiter verdicts cannot be regenerated from HF (they are paid-API Gemini 3 Pro output), so `generate_sentiment_arbiter.py` reads the sibling [IWAC-sentiment-analysis](https://github.com/fmadore/IWAC-sentiment-analysis) study's per-article files once and reduces them to a counts-only 1.4 KB bundle — keeping the page-block payload tiny rather than fetching the study's multi-MB raw data at runtime. The block fetches the arbiter bundle optionally and omits the arbitration panels if it is absent.

### Press Language (page block)

"The language of the press": readability (Flesch FR), lexical richness (type-token ratio), and article length over time and by newspaper, from the dataset's precomputed OCR text metrics. Backed by `generate_lexical_metrics.py`.

### Spatial Exploration (page block)

"Where the collection looks": a world bubble map of all 543 geocoded places in the authority index (bubble size = mention frequency), with an entity picker sidebar covering the full index — Persons (2,707), Organizations (398), Events (222), Subjects (209), Places (664) — behind accent-insensitive search. Selecting an entity re-scopes the map to the places mentioned alongside it; hover previews the first related items, click pins the full paginated item list with links to the Omeka items. A country-focus select zooms and filters to one of the six IWAC countries, and the shared choropleth toggle fills countries with item counts (entity-specific when one is selected). The block's sidecar `spatial-exploration.json` (`generate_spatial_exploration.py`, 148 KB minified) carries places + picker indexes + country counts/bounds; per-entity data comes from the existing `person-dashboards/` / `entity-dashboards/` fan-outs, fetched lazily per selection and LRU-cached.

### Entity Networks (page block)

Co-occurrence networks rendered with MapLibre GL (see the v1.7.0 changelog entry for why not ECharts/Sigma). *Entities* mode draws the cross-type graph — persons↔organizations plus events as connective tissue to every other type — on a blank theme-aware canvas, with positions precomputed by ForceAtlas2 at generation time (`generate_entity_networks.py`, 1,554 nodes / 7,356 edges at co-occurrence ≥ 2). *Places* mode draws co-mentioned places over the basemap (508 nodes / 11,030 edges, lazily fetched). Node color = entity type (module palette), size = items mentioning it; labels collide via symbol layers with a hubs-first priority rank. Type chips, a min-link-strength select, and node search filter the view; clicking a node highlights its neighborhood and lists its strongest co-occurrences in the details sidebar.

### Item Set Dashboard (resource-page block)

Newspapers, Islamic periodicals, and countries exist as item sets on islam.zmo.de — and the Compare Newspapers precompute already aggregates each of them. This block reuses those single-corpus JSONs: the orchestrator matches the item set's title against `compare-newspapers/index.json` (newspapers before countries, articles before publications) and renders summary cards + period subtitle, items per year, top subjects, spatial coverage, and most-frequent words (wordcloud with bar fallback). Item sets with no matching corpus remove the block client-side, so it is safe to enable for **all** item sets. Zero additional precompute.

### Visualizations (resource-page block) — Publication

Attaches to `bibo:Issue` items (template 21 — the Islamic periodical issues of the `publications` subset, 1,501 items). `Visualizations::render()` routes to `publication.phtml`, which loads the per-issue JSON at `asset/data/publication-dashboards/{o_id}.json` (generated by `scripts/generate_publication_dashboards.py`). Panels, all declarative `dashboardLayout` slots:

- **Stat cards** — words, pages, issue number, language, country, date (missing values elide their card; range dates like `2009-05/2009-08` display verbatim)
- **Most frequent words in this issue** — word cloud of the issue's own text, from a precomputed `[word, count]` frequency list (source-column priority `lemma_nostop` → `lemma_text` → `OCR`, tokenized server-side through the shared `iwac_utils.tokenize`)
- **This issue in its periodical run** — sibling sparkline of issues-per-year for the same periodical (`newspaper` is clean in this subset, so the per-periodical slice is honest), with this issue's year dotted
- **Similar issues** — semantic neighbours by cosine similarity over `embedding_tableOfContents` (768-dim Gemini). This replaced the earlier chronological "other issues of this periodical" strip now that the table-of-contents embeddings cover the subset — regenerate after each dataset update.

*(No placeholder blocks remain — every registered layout is live as of v1.6.0.)*

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
│   ├── iwac-block-shell.phtml              # Shared block wrapper + loading scaffold (v0.23.0)
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
│   │       ├── entity-dashboard.js         # Entity orchestrator (reuses person panels)
│   │       ├── article-dashboard.js        # Article orchestrator
│   │       ├── article-dashboard/          # Panel modules (network, radar, further-reading)
│   │       ├── publication-dashboard.js    # Publication-issue orchestrator (v1.5.0)
│   │       ├── minimal-item-dashboard.js   # Audio / Video / Document two-slot dashboard
│   │       ├── compare-newspapers.js       # Compare Newspapers orchestrator (split in v1.4.0)
│   │       ├── compare-newspapers/         # Panel modules (helpers, picker, map, sentiment, …)
│   │       ├── spatial-exploration.js      # Spatial Exploration orchestrator (v1.7.0)
│   │       ├── spatial-exploration/        # Panel modules (state, picker, map)
│   │       ├── entity-networks.js          # Entity Networks orchestrator (v1.7.0)
│   │       └── entity-networks/            # Panel modules (graph renderer, details sidebar)
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
│       ├── spatial-exploration.json        # Places + pickers + country counts/bounds (v1.7.0)
│       ├── entity-networks-global.json     # Cross-type graph w/ FA2 positions (v1.7.0)
│       ├── entity-networks-spatial.json    # Geographic co-mention network (v1.7.0)
│       ├── person-dashboards/{o_id}.json   # ~2,800 files
│       ├── entity-dashboards/{o_id}.json   # ~1,550 files
│       ├── article-dashboards/{o_id}.json  # ~12,287 files (~120 MB)
│       └── publication-dashboards/{o_id}.json # 1,501 files (~2.5 MB)
├── scripts/                                # Python precompute + Node build
│   ├── iwac_utils.py                       # Shared helpers (self-contained)
│   ├── dashboard_aggregator.py             # Shared person/entity aggregation core (v1.4.0)
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
│   ├── generate_spatial_exploration.py     # Spatial Exploration sidecar (v1.7.0)
│   ├── generate_entity_networks.py         # Co-occurrence graphs + FA2 layout (v1.7.0)
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
| **Live fetch** | Small subsets (< ~5k rows) without heavy per-row blobs. The chart JS paginates the Hugging Face `datasets-server /rows` endpoint (100 rows/request, parallel) and aggregates client-side. Always fresh, no precompute. | *(none currently — References Overview used this path until it moved to precompute; the strategy remains supported for future small-subset blocks)* | No |
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

1. **PHP (`$this->translate()`)** — block labels, form hints, loading messages, and any other text rendered server-side. Edit `language/fr.po` and compile with `msgfmt language/fr.po -o language/fr.mo` (or, without gettext installed: `python -c "import polib; polib.pofile('language/fr.po').save_as_mofile('language/fr.mo')"`). Current catalog is 58 entries, regenerated v1.6.1. See `language/README.md`.
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

# Per-publication-issue data (periodical runs + kNN over embedding_tableOfContents)
python3 scripts/generate_publication_dashboards.py  # → asset/data/publication-dashboards/{o_id}.json

# Corpus-level blocks added in v1.6.0
python3 scripts/generate_periodicals_overview.py            # → asset/data/periodicals-overview.json
python3 scripts/generate_semantic_landscape.py   --minify   # → asset/data/semantic-landscape.json (needs umap-learn)
python3 scripts/generate_sentiment_atlas.py      --minify   # → asset/data/sentiment-atlas.json
python3 scripts/generate_sentiment_arbiter.py    --minify   # → asset/data/sentiment-arbiter.json (reads ../IWAC-sentiment-analysis)
python3 scripts/generate_lexical_metrics.py      --minify   # → asset/data/lexical-metrics.json
```

`--minify` strips indentation and whitespace from the JSON output. Use it on the heavier bundles (`collection-overview`, `index-overview`, `keyword-explorer-*`) — it typically halves file size with no downside, since the JSON is only ever consumed by JS, not read by humans. Per-entity dashboards are individually small enough that pretty-printed output stays below a few KB each.

The HF dataset updates roughly monthly, so regeneration is a manual developer step, not a scheduled job. After every data regeneration, bump the version in `config/module.ini` (and `package.json` to match) so Omeka's `?v=` query string busts any stale browser caches pointing at the old asset URLs. When adding a new visualization, add a new `generate_*.py` next to the existing ones and document it in `scripts/README.md`.

**Provenance:** `iwac_utils.py` and several generators here were originally ported from the sibling [`iwac-dashboard`](https://github.com/fmadore/iwac-dashboard) project (`generate_keyword_explorer.py`, for instance, generalizes its `/keywords` generator). **That project is now deprecated** — this module's `scripts/` is self-contained and the source of truth; there is no cross-repo sync constraint. Use the `iwac-dataset` skill for the dataset schema.

## Build & development

JS sources under `asset/js/` are mirrored to `.min.js` siblings by `scripts/build-js.js` (terser). Templates load the `.min.js` variants; the unminified sources stay in-tree for development and debugging.

```bash
npm install          # installs terser as a devDependency (one-time)
npm run build:js     # walks asset/js/**/*.js and writes .min.js next to each source
```

`node_modules/` is gitignored; the generated `.min.js` files **are** committed, so a fresh clone works without running the build. Re-run `npm run build:js` after editing any `.js` source and commit both the source and the minified output.

Current minification results across **73 files: ≈ 685 KB → 249 KB (−63.6%)**. The chart-options builders (formerly a single ≈ 81 KB `charts/shared/chart-options.js`) were split in v0.23.0 into a small core plus four chart-family files (`chart-options-bar`, `-hbar`, `-graph`, `-special`) that together minify to ≈ 25 KB. The tiny `faceted-chart.js` helper still minifies to under 1 KB; `dashboard-layout.js` lands at ≈ 3.5 KB and the eight renderers (the v0.16.0 seven plus `horizontal-bar` added in v0.17.0) fit in ≈ 12 KB combined. `choropleth.js` (v0.18.0) lands at ≈ 2.4 KB; the 6-country polygon GeoJSON it loads is a separate 138 KB file fetched once per page on first toggle. `dashboard-panels-bridge.js` (v0.19.0) is ≈ 1 KB.

Every sheet under `asset/css/` is hand-authored; the styles are split per-block, mirroring the JS architecture:

```
asset/css/
├── iwac-core.css          # Shared by every block — tokens, panel, chip
│                          #   controls (tabs / facets / pagination), btn,
│                          #   summary card, table, form controls, section
│                          #   headings, badges.
├── iwac-maplibre.css      # MapLibre chrome + shared P.buildMapPopup body
│                          #   styles. Enqueued only by map-using blocks.
└── blocks/                # One file per live block, block-specific
    │                      #   layouts and modifiers only.
    ├── article-dashboard.css
    ├── collection-overview.css
    ├── compare-newspapers.css
    ├── index-overview.css
    ├── minimal-item.css
    ├── person-dashboard.css   # Used by the person + entity resource-page blocks
    ├── scary-terms.css
    └── topic-explorer.css
```

Every sheet is mirrored to a committed `.min.css` sibling by `scripts/build-css.js` (csso); the shared partial enqueues the minified variants. Run `npm run build:css` (or `npm run build` for JS + CSS) after editing any sheet.

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
