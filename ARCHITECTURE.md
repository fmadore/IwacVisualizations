# Architecture — IWAC Visualizations

Native timelines: [authoring, data pipeline, editor and migration](docs/TIMELINES.md).

How the module is put together: the file layout, how assets are declared and
loaded, the two data paths and how generated data reaches the server, then the
cross-cutting concerns — i18n, theme switching, mobile behaviour — and the
build.

For what the module *is* and which blocks exist, see [README.md](README.md).
For the dataset the generators read, [DATA_NOTES.md](DATA_NOTES.md). For the
maintenance status and architectural decisions, see the [consolidated roadmap](https://github.com/fmadore/IwacVisualizations/blob/main/ROADMAP.md).

## Repository layout

<!-- BEGIN GENERATED TREE (npm run build:tree) -->

```
IwacVisualizations/
├── .github/
│   ├── workflows/
│   │   ├── build-check.yml
│   │   ├── cdn-versions.yml
│   │   ├── lint.yml
│   │   ├── omeka-integration.yml
│   │   ├── regenerate-data.yml
│   │   ├── release.yml
│   │   └── theme-contract.yml
│   └── dependabot.yml
├── asset/
│   ├── css/
│   │   ├── blocks/                      # 50 files — block-local sheets, layered over iwac-core.css
│   │   ├── iwac-core.css                # Tokens, panel, chip controls, table, form controls
│   │   ├── iwac-core.min.css
│   │   ├── iwac-embed-tokens.css
│   │   ├── iwac-embed-tokens.min.css
│   │   ├── iwac-embed.css
│   │   ├── iwac-embed.min.css
│   │   ├── iwac-maplibre.css            # MapLibre chrome + shared popup body styles
│   │   └── iwac-maplibre.min.css
│   ├── data/
│   │   ├── laicite-events.json
│   │   └── scary-terms-events.json
│   ├── geo/                             # 9 files — static map geometry, the only committed data
│   ├── img/
│   │   └── ai-logos/
│   │       ├── ChatGPT_logo.svg
│   │       ├── DeepSeek_logo.svg
│   │       ├── Gemma_logo.png
│   │       ├── Mistral_AI_logo.svg
│   │       └── Qwen_logo.png
│   └── js/
│       ├── charts/
│       │   ├── article-dashboard/       # 4 files — panel modules
│       │   ├── audiovisual-overview/    # 3 files — panel modules
│       │   ├── collection-overview/     # 11 files — panel modules
│       │   ├── compare-newspapers/      # 11 files — panel modules
│       │   ├── distinctive-vocabulary/  # 1 file — panel module
│       │   ├── entity-networks/         # 3 files — panel modules
│       │   ├── index-overview/          # 14 files — panel modules
│       │   ├── laicite/                 # 18 files — panel modules
│       │   ├── lexical-metrics/         # 1 file — panel module
│       │   ├── minimal-item-dashboard/  # 1 file — panel module
│       │   ├── on-this-day/             # 4 files — panel modules
│       │   ├── periodicals-overview/    # 2 files — panel modules
│       │   ├── person-dashboard/        # 11 files — panel modules
│       │   ├── publication-dashboard/   # 1 file — panel module
│       │   ├── reference-dashboard/     # 1 file — panel module
│       │   ├── references-overview/     # 2 files — panel modules
│       │   ├── scary-terms/             # 7 files — panel modules
│       │   ├── semantic-landscape/      # 1 file — panel module
│       │   ├── sentiment-atlas/         # 2 files — panel modules
│       │   ├── shared/                  # 41 files — the reusable primitives every block draws on
│       │   ├── spatial-exploration/     # 4 files — panel modules
│       │   ├── timeline/                # 4 files — panel modules
│       │   ├── topic-explorer/          # 1 file — panel module
│       │   ├── article-dashboard.js
│       │   ├── audiovisual-overview.js
│       │   ├── collection-overview.js
│       │   ├── compare-newspapers.js
│       │   ├── distinctive-vocabulary.js
│       │   ├── entity-dashboard.js
│       │   ├── entity-networks.js
│       │   ├── index-overview.js
│       │   ├── item-set-dashboard.js
│       │   ├── laicite.js
│       │   ├── lexical-metrics.js
│       │   ├── minimal-item-dashboard.js
│       │   ├── on-this-day.js
│       │   ├── org-cooccurrence.js
│       │   ├── periodicals-overview.js
│       │   ├── person-dashboard.js
│       │   ├── press-bylines.js
│       │   ├── press-reprints.js
│       │   ├── publication-dashboard.js
│       │   ├── reference-dashboard.js
│       │   ├── references-overview.js
│       │   ├── scary-terms.js
│       │   ├── semantic-landscape.js
│       │   ├── sentiment-atlas.js
│       │   ├── spatial-exploration.js
│       │   ├── term-trends.js
│       │   ├── timeline.js
│       │   └── topic-explorer.js
│       ├── dist/                        # 131 files — built by scripts/build-js.js from bundles.json; committed
│       ├── bundles.json                 # The load order: shared bundles, panel sets, one per block
│       ├── dashboard-core.js            # IWACVis namespace, chart tracking, theme observer
│       ├── iwac-embed-gallery.js
│       ├── iwac-embed-height.js
│       ├── iwac-i18n.js                 # Locale detection + en/fr dictionary + t()
│       ├── iwac-lazy.js
│       └── iwac-theme.js                # ECharts theme from live CSS vars; owns BASEMAP
├── bin/
│   └── migrate-timelines.php
├── config/
│   ├── module.config.php                # Block + resource-page-block invokables
│   ├── module.ini                       # Module metadata; version drives the asset cache-bust
│   ├── sentiment-models.json
│   ├── theme-seeds.php                  # GENERATED by build:embed-tokens — the theme's brand seeds
│   └── timelines.json
├── docs/
│   ├── images/
│   │   ├── timeline-dark.png
│   │   ├── timeline-light.png
│   │   └── timeline-mobile.png
│   └── TIMELINES.md
├── language/                            # 4 files — template.pot + fr.po + the compiled fr.mo
├── scripts/
│   ├── laicite/                         # 25 files — one module per bundle, mirroring asset/js/charts/laicite/
│   ├── lib/                             # 4 files — file walk, bundle manifest and failure report the guards share
│   ├── audit_laicite.py
│   ├── build-css.js
│   ├── build-embed-tokens.js
│   ├── build-js.js                      # esbuild bundler driven by asset/js/bundles.json
│   ├── build-mo.js
│   ├── build-model-registry.js
│   ├── build-tree.js
│   ├── cdn-integrity.js                 # SRI hashes for the CDN pins: --check / --update / --verify
│   ├── check-audit.js
│   ├── check-blocks.js
│   ├── check-cdn-versions.js
│   ├── check-css-dead.js
│   ├── check-design-record.js
│   ├── check-flakes.js
│   ├── check-i18n-mo.js
│   ├── check-i18n.js
│   ├── check-maplibre-gates.js
│   ├── check-python.js
│   ├── check-theme-tokens.js
│   ├── check-versions.js
│   ├── dashboard_aggregator.py          # Shared person/entity aggregation core
│   ├── extract-pot.js
│   ├── generate_article_dashboards.py
│   ├── generate_audiovisual_overview.py
│   ├── generate_collection_overview.py
│   ├── generate_compare_newspapers.py
│   ├── generate_corpus_health.py
│   ├── generate_entity_dashboards.py
│   ├── generate_entity_networks.py
│   ├── generate_index_overview.py
│   ├── generate_keyness.py
│   ├── generate_keyword_explorer.py
│   ├── generate_laicite.py
│   ├── generate_lexical_metrics.py
│   ├── generate_on_this_day.py
│   ├── generate_org_cooccurrence.py
│   ├── generate_periodicals_landscape.py
│   ├── generate_periodicals_overview.py
│   ├── generate_person_dashboards.py
│   ├── generate_press_bylines.py
│   ├── generate_publication_dashboards.py
│   ├── generate_reference_dashboards.py
│   ├── generate_references_overview.py
│   ├── generate_reprints.py
│   ├── generate_scary_terms.py
│   ├── generate_semantic_landscape.py
│   ├── generate_sentiment_atlas.py
│   ├── generate_spatial_exploration.py
│   ├── generate_template_summary.py
│   ├── generate_term_trends.py
│   ├── generate_timeline.py
│   ├── generate_topic_explorer.py
│   ├── generate_wordcloud.py
│   ├── generate_world_map.py
│   ├── gettext.js
│   ├── i18n-strip.js                    # Empties the other locale's dictionaries for per-locale bundles
│   ├── iwac_embeddings.py
│   ├── iwac_frames.py                   # The FrameStore run_all installs
│   ├── iwac_stats.py
│   ├── iwac_timeline.py
│   ├── iwac_utils.py                    # Shared generator helpers (self-contained)
│   ├── org_cooccurrence_targets.json
│   ├── python-lock.js
│   ├── README.md
│   ├── requirements.lock                # Hash-pinned; `npm run lint:python-lock` checks it
│   ├── requirements.txt
│   ├── run_all.py                       # Every generator in one process, sharing loaded subsets
│   ├── theme-token-guard.cjs
│   └── validate_data.py
├── src/
│   ├── Controller/
│   │   ├── Admin/
│   │   │   └── DataController.php
│   │   └── Site/
│   │       └── EmbedController.php
│   ├── Data/
│   │   ├── Deployment.php
│   │   └── Manifest.php
│   ├── Job/
│   │   └── SyncData.php                 # Pure-PHP "Pull latest data" job (issue #7)
│   ├── Mvc/
│   │   └── EmbedFramingListener.php
│   ├── Sentiment/
│   │   ├── Centralite.php
│   │   ├── ModelRegistry.php
│   │   ├── Polarite.php
│   │   └── Subjectivite.php
│   ├── Service/
│   │   ├── Controller/
│   │   │   └── Admin/
│   │   │       └── DataControllerFactory.php
│   │   └── ViewHelper/
│   │       └── TimelineDataFactory.php
│   ├── Site/
│   │   ├── BlockLayout/                 # 23 files — one `const SLUG` each; BlockRegistry.php is the truth
│   │   ├── ResourcePageBlockLayout/     # 3 files — template-ID dispatch + the item-set block
│   │   ├── AssetPlan.php
│   │   ├── BlockRegistry.php            # THE single source of truth for every block
│   │   └── EmbedBrand.php               # Embed brand seeds → accent overrides; theme webfont URL
│   ├── Timeline/
│   │   ├── Catalog.php
│   │   └── Migration.php
│   └── View/
│       └── Helper/
│           └── TimelineData.php
├── tests/
│   ├── browser/                         # 39 files — Playwright specs
│   ├── fixtures/
│   │   └── timeline.json
│   ├── integration/
│   │   ├── block_assets.php
│   │   ├── omeka_boot.php
│   │   ├── sync_form.php
│   │   └── timeline.php
│   ├── js/                              # 34 files — node:test units
│   ├── php/
│   │   ├── run.php
│   │   ├── sync_data_archive.php
│   │   └── timeline.php
│   └── python/
│       ├── requirements.txt
│       ├── test_entity_networks.py
│       ├── test_iwac_helpers.py
│       ├── test_laicite_audit.py
│       ├── test_laicite_methodology.py
│       ├── test_publication.py
│       └── test_timeline.py
├── view/
│   ├── common/
│   │   ├── block-layout/                # 3 files — one per registered block, filename === slug
│   │   ├── resource-page-block-layout/
│   │   │   ├── visualizations/
│   │   │   │   ├── article.phtml
│   │   │   │   ├── entity.phtml
│   │   │   │   ├── minimal-item.phtml
│   │   │   │   ├── person.phtml
│   │   │   │   ├── publication.phtml
│   │   │   │   └── reference.phtml
│   │   │   └── item-set-dashboard.phtml
│   │   ├── iwac-assets.phtml            # Shared asset-loader partial — declare needs here
│   │   ├── iwac-block-shell.phtml       # Shared block wrapper + loading scaffold
│   │   └── timeline-reading.phtml
│   └── iwac-visualizations/
│       ├── admin/
│       │   └── data/
│       │       └── index.phtml
│       ├── embed/
│       │   ├── block.phtml
│       │   ├── index.phtml
│       │   └── not-found.phtml
│       └── layout/
│           └── embed.phtml
├── .stylelintrc.json
├── ARCHITECTURE.md                      # This file
├── CHANGELOG.md                         # Version history
├── CITATION.cff
├── CLAUDE.md
├── DATA_NOTES.md                        # The Hugging Face dataset schema
├── DESIGN.md
├── eslint.config.js
├── LAICITE_METHODOLOGY.md
├── LICENSE
├── Module.php                           # Structural only — NO asset listeners (see docblock)
├── package-lock.json
├── package.json
├── phpstan.neon.dist
├── playwright.config.js
├── PRODUCT.md
├── README.md
├── ROADMAP.md                           # Consolidated maintenance status and decisions
├── ruff.toml
└── tokens.json                          # Synced from the IWAC theme; `npm run lint:theme` enforces it
```

<!-- END GENERATED TREE -->

### Asset loading — shared partial

`Module.php` attaches no asset listeners. Loading ECharts and MapLibre on every Item and ItemSet view once cost ~600 KB of unused JavaScript on every Article page, even when no Visualizations block was configured. A block declares what it needs, and only pages that render a block pay for it.

**A page block declares its assets in its `BlockRegistry` row**, under `shell`, and renders through `view/common/block-layout/_generic.phtml`, which hands the row to `common/iwac-block-shell` → `common/iwac-assets`:

```php
'collection-overview' => [
    // invokable, class, label, description, embeddable …
    'shell' => [
        'assets' => [
            'blockCss' => 'collection-overview',   // css/blocks/<name>.min.css; a list for several sheets
            'needs' => [                           // AssetPlan::FLAGS — an unknown flag throws
                'maplibre'     => true,            // MapLibre (ES module import) + shared-map + iwac-maplibre.css
                'wordcloud'    => true,            // echarts-wordcloud CDN
                'chartOptions' => true,            // shared-charts
                'facetButtons' => true,            // any of these five: shared-ui
                'table'        => true,
                'pagination'   => true,
            ],
            'bundle' => 'collection-overview',     // blocks.<name> in asset/js/bundles.json
        ],
        'blockClass' => 'iwac-vis-overview',
        'loading'    => 'Loading collection overview', // @translate
    ],
],
```

The other flags are `timeline` and `concordance` (shared-ui), `layout` (shared-layout: the dashboard layout registry and every shared renderer), `d3` (the d3-force CDN modules + shared-d3) and `echarts`, the one that defaults on and is only ever passed as `false`. `BlockRegistry::partialFor($slug)` is the routing rule — `_generic` for a row with a `shell`, `common/block-layout/<slug>` for one without — and the block layouts, the embed view and the integration suite all call it. A row without a `shell` is for a block that does more than declare: today `on-this-day`, which reads its layout setting and builds a noscript slot, and `iwac-timeline`, which server-renders its whole reading view. Resource-page blocks (`view/common/resource-page-block-layout/**`) call `common/iwac-block-shell` with the same `assets` array directly.

The partial:

- always loads `iwac-core.min.css`, the ECharts CDN build (unless `'echarts' => false`) and the `shared-core` bundle
- turns `needs` into CDN libraries and the shared bundles in a fixed order (`Site\AssetPlan::bundles()`), then the block's panel sets and its own bundle, orchestrator last
- pins CDN versions at the top of the partial, so an upgrade is a deliberate one-line bump
- emits every URL through `$this->assetUrl($path, 'IwacVisualizations')`, so Omeka's `?v=` cache-bust tracks `config/module.ini`
- hands the ordered list to the on-view loader (`iwac-lazy.js`) as inert JSON beside the block; `headLink()` / `headScript()` and the loader de-duplicate by URL, so two blocks on a page share every bundle they have in common

Consequences for contributors:

- **Blocks are declared once**, in `IwacVisualizations\Site\BlockRegistry`: slug, label, description, embeddable and the `shell`. The `BlockLayout` subclass declares only `const SLUG`; the embed whitelist derives from the registry; `npm run lint:blocks` fails the build if the registry, the config invokables, the classes, the templates and the bundle manifest stop agreeing, and `tests/php/run.php` fails on a `shell` or `assets` key that nothing reads (a `blockCss` one level too high is silently dropped — Periodicals Overview shipped without its stylesheet that way) and on a `blockCss` with no sheet on disk.
- **Name the bundle, not the files** — `'bundle' => '<name>'`; the block's panel modules and orchestrator are listed, in order, under `blocks.<name>` in `asset/js/bundles.json`, and `npm run lint:blocks` fails on a template that still lists `panels` or `orchestrator`. Don't write raw `$this->headScript()` calls in a block template.
- Shared JS primitives live under `asset/js/charts/shared/`; panel modules under `asset/js/charts/<block>/`; orchestrators at `asset/js/charts/<block>.js`.
- A truly new shared primitive goes into the matching `panels*.js` part (small additions) or a new `shared/<name>.js` file listed in the right shared bundle; a new shared bundle also needs a flag in `AssetPlan::FLAGS` and its group in `AssetPlan::bundles()`.
- **No inline script or style.** The lazy-loader payload is `<script type="application/json">`, the embed page's height reporter and the `/iwac-embed` snippet gallery are their own bundles (`shared-embed-height`, `shared-embed-gallery`), so a host with `script-src 'self'` breaks nothing. `tests/js/assets.test.js` fails on any literal `assetUrl()` target that is not on disk — the gallery requested a deleted per-file `embed.min.js` for months after the bundling commit, and rendered no snippets.

### Load order (runtime)

The shared partial hands the on-view loader a fixed sequence of bundles (built by `scripts/build-js.js` from `asset/js/bundles.json`); the loader injects them in order once a block nears the viewport, so the orchestrator always runs last, with its dependencies populated. MapLibre is the exception — an ES module imported in parallel, awaited only by the panels that draw a map.

1. **CDN libraries** — `echarts.min.js`, optionally `echarts-wordcloud.min.js` and the four d3-force modules
2. **`shared-core`** — every block: `iwac-i18n` → `iwac-theme` → `dashboard-core` → the `panels` family (core, controls, store, map, boot) → `chart-rows` → `panel-toolbar` → `embed` → `responsive` → `hijri`
3. **Shared bundles the block opts into via `needs`** — `shared-charts` (the chart-options builders), `shared-ui` (pagination, the entities panel, table, facet buttons, faceted chart, annotated timeline, concordance), `shared-layout` (the dashboard layout registry, the panels bridge and every renderer, each self-registering on load), `shared-map` (the IWAC map helpers, the popup, the choropleth, the filtered places map), `shared-d3` (the canvas force graph)
4. **Panel sets the block shares** — `panels/<name>` (the person and entity dashboards draw the same eleven panels)
5. **The block bundle** — `blocks/<name>`: its panel modules (self-registering IIFEs under `charts/<block>/`) in order, then the orchestrator `charts/<block>.js`, which fetches JSON, builds the DOM scaffold, and dispatches `panel.render(host, data, facet, ctx)` for each registered panel — or, for layout-system blocks, calls `IWACVis.dashboardLayout.render(rootEl, layoutKey, data, ctx)` once and lets the registry walk the slot list

### Shared JS helpers (`asset/js/charts/shared/panels*.js`)

Every panel module gets a small API hung off `window.IWACVis.panels` (aliased as `P`). Since v1.23.0 the namespace is assembled from four files — `panels.js` (DOM, fetch, lazy-init, i18n shortcuts, status banners, layout primitives), `panels-controls.js` (select / search dropdown / playback timer), `panels-map.js` (GeoJSON features, feature-state hover), `panels-boot.js` (`bootBlock`, `bootPerItemDashboard`, force-graph chrome) — following the same split as the chart-options family. They all extend the same `P` object and load unconditionally, so callers see one flat API. Beyond the DOM primitives (`P.el`, `P.escapeHtml`, `P.buildPanel`, `P.buildSummaryCards`) there are a handful of helpers panel modules should reach for before rolling their own:

| Helper | What it does |
|---|---|
| `P.t(key, params)` / `P.formatNumber(n)` / `P.formatDecimal(v, digits)` / `P.formatPercent(v, digits)` / `P.formatCompact(n)` / `P.formatDate(iso, opts)` | i18n shortcuts over `iwac-i18n.js`, the module's one number formatter: thousands grouped with U+202F in both locales, the decimal mark and percent spacing of the page locale (`12,5 %` / `12.5%`). `npm run lint:i18n` rejects `toFixed()` and a bare `+ '%'` in display code. `formatDate` formats a date-only value in UTC, so it keeps its day west of Greenwich; a year-month reads "May 2009" and anything else (range dates) passes through. |
| `P.buildLoadingState(key)` / `P.buildEmptyState(key)` / `P.buildErrorState(key)` | Consistent spinner / "No data available" / "Failed to load" banners. Default keys translate to the obvious messages. Each is a `role="status"` / `aria-live="polite"` live region, so a screen reader announces the state change a sighted reader takes in at a glance. |
| `P.bootBlock({ selector, dataFile \| load, render, … })` | The page-block boot contract: DOM-ready + ECharts guard, container sweep, `ctx` from the block's data-\* attributes, bundle fetch under `P.DATA_BASE`, error banner (or `onError: 'remove'` for blocks that must vanish rather than show an error). Every page-block orchestrator ends in one call to this. |
| `P.bootPerItemDashboard({ selector, classToken, dataDir, layout, … })` | The same contract for resource-page dashboards: fetch `<dataDir>/<itemId>.json`, swap the spinner for a `__body` wrapper, mount an optional header, dispatch the grid through `dashboardLayout.render`. |
| `P.buildCountFeatures(items, { countKey, minCount, toProps })` | Turns a list of `{lng, lat, count, …}` records into a GeoJSON `FeatureCollection` for MapLibre bubble maps, plus the max count for the radius interpolation. Used by every map panel in the module. |
| `P.lazyInit(el, render, { rootMargin })` | Runs `render` exactly once when `el` first nears the viewport (IntersectionObserver with a pre-trigger margin; immediate fallback without IO support). Returns a one-shot trigger for forcing the render early. The shared pattern behind every lazy map / wordcloud / deferred data fetch. |
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
| **Precompute** | Heavy aggregations (the full `articles` subset is 12,287 rows × 47 cols including 768-dim embeddings), cross-subset joins, networks, per-entity dashboards. A Python script reads the HF dataset via the `datasets` lib and writes compact JSON into `asset/data/`. Runs in CI (`.github/workflows/regenerate-data.yml`) on a push to a generator or a monthly cron, and is pulled onto the server by the "Pull latest data" admin job — see **Data delivery** below. | Collection Overview, Person dashboards, Entity dashboards, word cloud, world map | Yes |

Rough decision rule: **precompute if fetching would take > 50 parallel HF requests OR the source rows carry large blobs (OCR, embeddings, images)**. Networks and semantic-neighbor computations also belong in precompute — they're expensive and stable between dataset updates.

### Data delivery — built in CI, pulled into `files/` (issue #7)

The precomputed JSON is **not committed to git** and is **not generated on the
production server**. Three stages keep the repo lean and the ZMO host a plain
PHP box:

1. **Compute** — the runner pins all subsets to one Hugging Face commit and
   records source IDs, OCR visibility and generator output receipts. Validation
   checks JSON contracts, eligible item outputs and published references, then
   writes a versioned manifest containing per-file SHA-256 hashes.
2. **Publish** — the workflow creates an immutable `data-build-<run>-<attempt>`
   release containing the archive and checksum, then updates `data/latest.json`.
3. **Deliver** — SyncData resolves the pointer once, fetches the checksum
   sidecar *before* the archive (a release without a usable one fails before
   the download), requires the manifest, and publishes
   `generations/<manifest-sha256>/`. One Omeka setting activates the directory.
   The permanent lock serializes workers; deployment recovery preserves usable
   legacy backups only while no `generations/` exists, after which the work-dir
   sweep removes them like any orphan. Retention keeps the previous and all
   generations younger than 30 days. Logs appear in **Admin → Jobs**. The live
   root, the work sibling (`iwac-visualizations.tmp/`) and the lock all derive
   from `Data\Deployment::forStore()`, for the job and the admin controller
   alike. "Retry an interrupted sync" on the admin page closes the stale job
   (status `error`, an end time, a log line) before dispatching its replacement.

**Published cross-repo contract — the root `collection-overview.json`.** The IWAC
theme's homepage banner (`helper/BannerStats.php` in
[IWAC-theme](https://github.com/fmadore/IWAC-theme)) reads
`OMEKA_PATH/files/iwac-visualizations/collection-overview.json` — the store
*root*, not a generation — for its `summary` figures (newspapers, references,
words, pages…). After every successful activation, including a re-run of the
same generation, SyncData copies the active generation's file there through a
temporary file and a rename (`Deployment::publishRootSnapshot()`); a failure only
warns, because the generation is already live. Between v1.66, which moved
publication into `generations/`, and this copy, the root file froze at its last
pre-generation snapshot (81 newspapers against 85 in the data) and fresh installs
had none. Renaming, moving or no longer writing it hides banner cards with no
error anywhere, so change it in both repositories together; the same goes for
the `summary` keys the theme's `SUMMARY_KEYS` lists. Only this one file is
mirrored — the rest of a legacy root tree is left for pages loaded before the
upgrade.

Each page carries `data-generation`; the shared fetcher resolves aggregate and
sidecar requests into that immutable directory. Legacy pages retain their old
root until reloaded. `Site/AssetPlan` caches the bundle registry once per request.
The browser loader maintains per-block readiness and shared dependency promises;
a failed script stops dependent execution and exposes a translated retry control.

The chart JS therefore fetches generated data same-origin from
`{basePath}/files/iwac-visualizations/generations/<sha256>/…`. The only data **still committed** to
the module is `asset/geo/` (static map geometry the generators read as input and
the client fetches from `{basePath}/modules/IwacVisualizations/asset/geo/…`) and
the two hand-curated event annotation files, `asset/data/scary-terms-events.json`
and `asset/data/laicite-events.json`, which ride into the archive from the
checkout. Before the first pull, blocks render a graceful “data not available
yet” state instead of a 404 error.

## Internationalization

Two layers:

1. **PHP (`$this->translate()`)** — block labels, form hints, loading messages, and any other text rendered server-side. Edit `language/fr.po` and compile with `npm run build:mo` (the repository's own po/mo codec, `scripts/gettext.js`; no `msgfmt` needed). `npm run lint:i18n-mo` fails while `fr.mo` disagrees with `fr.po`, and `npm run lint:i18n-pot` while a source string is missing from it. See `language/README.md`.
   French typography is part of the translation: a no-break space (U+00A0) before `:` and inside « », a narrow one (U+202F) before `;`, `!`, `?` and `%`, in the PHP catalogue and the JavaScript dictionaries alike.
2. **JavaScript (`IWACVis.t()`)** — chart labels, tooltips, summary card labels, tab names, facet UI. Dictionary lives inline in `asset/js/iwac-i18n.js`. Locale is detected once at render time from `document.documentElement.lang` (populated by Omeka's Internationalisation module).
3. **Numbers and calendar names** — `IWACVis.formatNumber` / `formatDecimal` / `formatPercent` / `formatCompact` and `monthNames` / `weekdayNames` / `formatYearMonth`, all in `iwac-i18n.js` and all keyed to the page locale, never the browser's. Value axes take the number rule at theme level (`iwac-theme.js`); ECharts' French locale (calendar month and day names) is registered from the same month table in `dashboard-core.js`.

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
- **Force-graph toolbar** — the item-page networks (article context, associated entities) float their zoom / labels / freeze / download / fullscreen column top-right of the canvas on desktop. Below `sm` that column is taller than the phone canvas, so `iwac-core.css` drops it into the panel after the legend as a grid of 44px controls and gives the stage a 22rem floor; the selection card spans the stage. The ECharts graph toolbar (`P.buildGraphPanelToolbar`, press reprints) reaches the same row through a zero-height anchor inserted before its chart host: its host is the chart itself, so the bar cannot live inside it without ratcheting the chart's height, and on phones the anchor is simply in flow above the graph.
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

Full workflow documented in **`scripts/README.md`**.

The Laïcité generator's population, field restrictions, denominators, comparison
methods and validation protocol are documented in
[LAICITE_METHODOLOGY.md](LAICITE_METHODOLOGY.md). Its `research.py` module builds
whole-collection coverage and field-sensitivity cells, including records
without matches or full text; they ship inside `laicite-trends.json` under
`research`, not as a file of their own. Regenerate and sync
these data alongside the other Laïcité bundles after a methodology update;
installing the module archive alone does not refresh them.

`scripts/audit_laicite.py` sits beside that generator as a separate, manual
tool: an incremental model-assisted relevance screen of the dossier, whose
verdicts live in the committed sidecar `scripts/laicite/audit_ledger.json`
(identifiers, verdicts, model and rule hash only — never source text, never
reader notes, both of which stay in the gitignored `.test-tmp`). Its
`extract` / `merge` / `status` subcommands write batches only for records the
ledger does not already cover, against the rule sheets in
`scripts/laicite/audit/`. The generator never runs the screen; it reads the
ledger through `laicite/audit_ledger.py` and publishes one aggregate,
`audit_screen` in `laicite-metadata.json`, which the block renders. A
checkout without the ledger still builds, with an empty aggregate. See
[LAICITE_METHODOLOGY.md](LAICITE_METHODOLOGY.md) for what the screen is and
is not.

CI does not run the generators one at a time. `scripts/run_all.py` runs all 31
in a single interpreter with a `FrameStore` installed, so the seven Hugging
Face subsets are converted to pandas once each rather than ~90 times across 31
process starts, and the order lives in `run_all.GENERATORS` where a test checks
it against what is on disk:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt   # the lock is CI's Linux/3.12 env
export HF_TOKEN=...            # the mirror is private

python3 scripts/run_all.py                    # everything, CI's flags
python3 scripts/run_all.py --only laicite     # one generator
python3 scripts/run_all.py --list             # the order, and nothing else
```

Any generator still runs on its own exactly as before — no store is installed,
so nothing is shared and nothing is retained:

```bash
cd /path/to/IwacVisualizations

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
python3 scripts/generate_periodicals_landscape.py --minify  # → asset/data/periodicals-landscape.json (needs umap-learn)
python3 scripts/generate_sentiment_atlas.py      --minify   # → asset/data/sentiment-atlas.json
python3 scripts/generate_lexical_metrics.py      --minify   # → asset/data/lexical-metrics.json

# v1.19.0 blocks
python3 scripts/generate_on_this_day.py                     # → asset/data/on-this-day/{MM-DD}.json + h/{MM-DD}.json (366 + 360 files)
python3 scripts/generate_press_bylines.py                   # → asset/data/press-bylines.json
```

`--minify` strips indentation and whitespace from the JSON output. Use it on the heavier bundles (`collection-overview`, `index-overview`, `keyword-explorer-*`) — it typically halves file size with no downside, since the JSON is only ever consumed by JS, not read by humans. Per-entity dashboards are individually small enough that pretty-printed output stays below a few KB each.

The HF dataset updates roughly monthly, so the workflow regenerates on a monthly schedule, on generator changes, or by manual dispatch. The archive manifest and Omeka sync timestamp provide data cache busting independently of the module version. When adding a new visualization, add a new `generate_*.py` next to the existing ones and document it in `scripts/README.md`.

**Provenance:** `iwac_utils.py` and several generators here were originally ported from the sibling [`iwac-dashboard`](https://github.com/fmadore/iwac-dashboard) project (`generate_keyword_explorer.py`, for instance, generalizes its `/keywords` generator). **That project is now deprecated** — this module's `scripts/` is self-contained and the source of truth; there is no cross-repo sync constraint. Use the `iwac-dataset` skill for the dataset schema.

## Build & development

JS sources under `asset/js/` are bundled by `scripts/build-js.js` (esbuild) into `asset/js/dist/`, in the order `asset/js/bundles.json` states — the one place the load order lives. Six shared bundles (`shared-core`, always; `shared-charts`, `shared-ui`, `shared-layout`, `shared-map`, `shared-d3`, each behind a `$needs` flag in the asset partial), one bundle per shared panel set (`panels/person`, drawn by the person and entity dashboards), and one bundle per block (`blocks/<name>`, panels in order, orchestrator last). Every bundle has a `.map` beside it pointing back at the original sources with their contents embedded, so the browser's devtools show the unminified files. Templates name their bundle (`'bundle' => 'laicite'`) and their needs; the partial emits the bundles in a fixed order and nothing else.

```bash
npm install          # esbuild, eslint, csso (one-time)
npm run build        # lint, then build:js + build:css
npm run build:js     # reads asset/js/bundles.json and writes asset/js/dist/**
npm run build:tree   # regenerates this file's repository tree from git ls-files
npm run lint         # every gate CI runs, in CI's order
```

The tree at the top of this file is **generated**. Edit
`scripts/build-tree.js`'s `ANNOTATIONS` to change a note, then
`npm run build:tree`; `npm run lint:tree` fails the build when the file and
the repository disagree, which is the drift that left the hand-written version
naming 6 `BlockLayout` classes out of 21.

**Bundles that carry translations are built once per locale.** A page is read in one language, so a bundle containing a dictionary — `shared-core` (the shared `iwac-i18n.js`) and every block with an `addTranslations` file — is written as `<name>.en.min.js` and `<name>.fr.min.js`, each with the other locale's tables emptied by `scripts/i18n-strip.js`, and listed in the generated `dist/locales.json`. `Site\AssetPlan::bundlePath()` hands the loader both URLs; the loader requests the one matching `<html lang>` and publishes its choice as `IWACVisLazy.locale`, which `iwac-i18n.js` adopts, so the language `t()` uses is always the one whose strings were fetched. Emptying the other tables changes nothing `t()` can observe — `lint:i18n` requires every `en` key to exist in `fr` — and `tests/js/i18n-locales.test.js` proves it for every key of all twenty-six dictionaries. Dictionaries must stay inline object literals (`ns.addTranslations('fr', { … })`); the build fails on a call it cannot strip.

**A string lives in the dictionary of the only bundle that reads it.** The shared `iwac-i18n.js` ships in `shared-core` on every page carrying *any* block, so it holds only strings read by shared code, by templates, or by more than one block. A string one block alone reads goes in that block's `charts/<block>/i18n.js`, first in its bundle. Until v1.73.0 the shared dictionary also carried 146 single-block keys — about 27 KB of both locales' strings that every page downloaded for blocks it did not have; moving them took `shared-core` from 105 to 89 KB (French) and from 93 to 81 KB (English).

`node_modules/` is gitignored; `asset/js/dist/` **is** committed, so a fresh clone works without running the build. Re-run `npm run build:js` after editing any `.js` source and commit both the source and the bundles. The build fails when a source is missing, listed in two bundles, or in none — a new file has to be added to the manifest, which is how the order stays data.

A block is now three to seven script requests (the ECharts CDN, `shared-core`, the shared bundles it needs, its own) instead of about thirty-three; 155 sources → 34 bundles, ≈ 1.93 MB → 722 KB (−62.7%). Shared code never goes into a block bundle: the on-view loader de-duplicates by URL, so two blocks on one page share every bundle they have in common and each executes once, whereas a shared file inlined into two block bundles would execute twice.

Every sheet under `asset/css/` is hand-authored; the styles are split per-block, mirroring the JS architecture:

`asset/css/iwac-core.css` carries what every block shares — tokens, panel,
chip controls (tabs / facets / pagination), buttons, summary card, table, form
controls, section headings, badges. `asset/css/iwac-maplibre.css` is the
MapLibre chrome plus the shared `P.buildMapPopup` body styles, enqueued only by
map-using blocks. `asset/css/blocks/` is one file per block, block-specific
layouts and modifiers only — the tree above has the current count.

Every sheet is mirrored to a committed `.min.css` sibling by `scripts/build-css.js` (csso); the shared partial enqueues the minified variants. Run `npm run build:css` (or `npm run build` for JS + CSS) after editing any sheet.

Each block template enqueues `iwac-core.css` first, then `iwac-maplibre.css` if it uses a map, then its own block sheet (if any). **References Overview** now requests `iwac-maplibre.css` for its provenance bubble map but otherwise has no block-specific chrome beyond the generic panel + table. HTTP/2 makes the extra requests free, and splitting keeps each file under ~600 lines so conflicts stay localised to the block that touches them.

### Keeping dependencies current

The module has four dependency surfaces, and they are watched by two different mechanisms:

| Surface | Where | Watched by |
| --- | --- | --- |
| GitHub Actions | `.github/workflows/*.yml` | Dependabot (`.github/dependabot.yml`), monthly, grouped |
| npm devDependencies | `package.json` — `esbuild`, `eslint`, `csso`, `stylelint`, `playwright` | Dependabot, monthly, grouped; `npm run check:audit` (in `Build check`) fails on any high or critical advisory not written into `scripts/lib/audit-exceptions.js` with its reason. Build-only; never served to visitors |
| Python | `scripts/requirements.txt` + `scripts/requirements.lock` | Hash-verified Python 3.12/Linux lock; refresh with `npm run lock:python` after changing direct requirements |
| **CDN libraries** | `view/common/iwac-assets.phtml` | **`CDN versions` workflow** |

That last row is the one that matters to visitors and the one Dependabot structurally cannot see: ECharts, echarts-wordcloud, MapLibre GL and the four d3 modules are jsDelivr URLs written as PHP string constants, not npm dependencies. `view/common/iwac-assets.phtml` is the only place those versions live — `npm run check:cdn` reads them from there and compares them against the registry, so this file deliberately names no version of its own. (Historical changelog and roadmap entries naming MapLibre 5.24 or ECharts 6.0 are records of when a decision was taken, not statements about the current pin.) Exact-pinning them in v1.22.0 stopped the live site from upgrading itself mid-flight (ECharts 6.1.0 landed unannounced on 2026-05-19) but left no signal that anything had moved.

`scripts/check-cdn-versions.js` closes that loop — it parses the pins out of the partial and compares them against the npm registry:

```bash
npm run check:cdn
```

It runs monthly on a schedule (a red run is the notification) and on pull requests that touch the partial, where it is advisory only — pinning behind `latest` is a legitimate choice. One thing stays fatal in both modes: the same package pinned at two different versions, which is what happens when the MapLibre JS URL gets bumped and the CSS one next to it does not.

**Every pinned file also carries a Subresource Integrity hash** (since v1.72.0), in a generated `$cdnIntegrity` block of the same partial. The loader sets `integrity` and `crossorigin="anonymous"` on each CDN script, its `preload`, and the MapLibre sheet, so a browser refuses a file whose bytes differ from what was published. `import()` takes no `integrity`, so MapLibre's two main-thread modules are verified through `modulepreload` links that carry it, and the loader imports only once the entry's preload has settled — the import then resolves against the verified module rather than fetching again. MapLibre's worker is the one file outside this: it boots from a blob and imports its chunk in its own module graph. A version bump is therefore three steps:

```bash
# 1. edit the URL constants in view/common/iwac-assets.phtml
npm run update:sri   # 2. rewrite the hashes from the npm tarballs (each verified against the registry's own sha512)
npm run lint:sri     # 3. (also part of `npm run lint`) fails while the block and the pins disagree
```

The `CDN versions` workflow then runs `node scripts/cdn-integrity.js --verify`, which downloads every file from jsDelivr itself and fails on any hash that does not match — the one check against the bytes visitors are actually served.

**Conventions for adding a new block:**

1. Add block-specific selectors to `asset/css/blocks/<block>.css`. If the block shares a pattern with an existing one (e.g. "chip controls", "form controls"), add your selector to the canonical rule in `iwac-core.css` — never redefine base chip/button styles per block.
2. Enqueue `iwac-core.css` first in the block template, then maplibre (if needed), then the block sheet.
3. Colors and spacing must resolve through IWAC theme tokens (`--primary`, `--ink`, `--surface`, `--space-*`, `--radius-*`). **Never hardcode hex in JS** — shared chart code reads these via `getComputedStyle` / `ns.resolveCssVar`.
