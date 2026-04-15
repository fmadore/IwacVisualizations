# IWAC Visualizations

An [Omeka S](https://omeka.org/s/) module that adds interactive visualizations to the [Islam West Africa Collection (IWAC)](https://islam.zmo.de/) digital archive at ZMO. Charts are powered by [ECharts 6](https://echarts.apache.org/) and [MapLibre GL](https://maplibre.org/); the underlying data is either fetched live from the public Hugging Face dataset [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection) or precomputed via Python scripts under `scripts/`.

The module targets the [IWAC theme](https://github.com/fmadore/IWAC-theme). It reads the theme's CSS custom properties at runtime so chart colors track the site's configured `--primary` / `--ink` / `--surface` tokens, it respects the light/dark toggle via a `MutationObserver` on `body[data-theme]`, and it follows the Internationalisation module's language switching (English / French).

## Status

Five page blocks and one resource-page block layout are fully wired end-to-end with live data. Two placeholder blocks load the asset stack but have no orchestrator code yet.

| Block | Type | Status | Data path |
|---|---|---|---|
| Collection Overview | page block | **Live** — 13 panels | Precompute (`generate_collection_overview.py` + two sidecar generators) |
| Index Overview | page block | **Live** — 7 Section A panels + Keyword Explorer | Precompute (`generate_index_overview.py` + `generate_keyword_explorer.py`) |
| References Overview | page block | **Live** — 6 panels | Live fetch from HF datasets-server |
| Scary Terms | page block | **Live** — bar-chart race + country view + global view | Precompute (`generate_scary_terms.py`) |
| Visualizations / Person | resource-page block | **Live** — 11 panels | Precompute (`generate_person_dashboards.py`) |
| Visualizations / Entity (Lieux, Organisations, Sujets, Événements) | resource-page block | **Live** — reuses Person panels | Precompute (`generate_entity_dashboards.py`) |
| Compare Projects | page block | Placeholder (assets enqueued, no orchestrator) | — |
| Item Set Dashboard | resource-page block | Placeholder (assets enqueued, no orchestrator) | — |

Current version: see `config/module.ini` (`version = …`). This value drives the `?v=` query string Omeka appends to every asset URL, so bumping it is the canonical way to bust the browser cache after a source change.

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

Section A is backed by `asset/data/index-overview.json` (one bundle, ~790 KB minified) generated by `scripts/generate_index_overview.py`. Section B is backed by three files — `keyword-explorer-subjects.json`, `keyword-explorer-spatial.json`, `keyword-explorer-metadata.json` — generated by `scripts/generate_keyword_explorer.py` (~1 MB total minified). State is in-memory only; filters reset on reload (page blocks can be embedded anywhere, so hijacking the page URL for block-local state is explicitly avoided).

### References Overview (page block)

Bibliographic dashboard pulled directly from the Hugging Face dataset at page load — no Python precompute needed. `asset/js/charts/references-overview.js` paginates the HF `datasets-server /rows` endpoint (9 parallel requests of 100 rows each, ~1 s on a good network), then aggregates in the browser:

- Summary cards — references / authors / publishers / types / languages / countries
- Timeline — stacked bar by reference type
- Reference types, languages — top-10 horizontal bars
- Top 15 authors, top 15 subjects

### Scary Terms (page block)

Tracks the frequency of a curated set of "scary" term families (terrorisme, extrémisme, djihadisme, intégrisme, …) across the IWAC corpus from 1961–2025:

- **Metric row** — total matching articles, term families, variants, total occurrences
- **View mode switcher** — Bar-chart race / By country / Global
- **Animated bar-chart race** — horizontal bars animated one year at a time (1 s per frame), term families cycled through IWAC palette colors
- **Country view** — per-country breakdown selectable via dropdown
- **Global view** — single time-series of total occurrences
- **Term definitions table** — each family with its variants, for provenance

Backed by four precomputed JSONs (`scary-terms-metadata.json`, `scary-terms-temporal.json`, `scary-terms-countries.json`, `scary-terms-global.json`) generated by `scripts/generate_scary_terms.py`.

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

### Placeholders

**Compare Projects** (page block) and **Item Set Dashboard** (resource-page block) both enqueue the module's asset stack and render a loading spinner container. They're registered so Omeka recognizes the block layouts, but no orchestrator JS has been written yet — they'll be implemented in follow-up passes. See `ROADMAP.md` for timelines.

## Architecture

```
IwacVisualizations/
├── Module.php                              # Structural only — NO asset listeners (see docblock)
├── config/
│   ├── module.ini                          # Module metadata (version drives asset cache-bust)
│   └── module.config.php                   # Block + resource-page-block registration
├── src/Site/
│   ├── BlockLayout/
│   │   ├── CollectionOverview.php          # Live
│   │   ├── IndexOverview.php               # Live
│   │   ├── ReferencesOverview.php          # Live
│   │   ├── ScaryTerms.php                  # Live
│   │   └── CompareProjects.php             # Placeholder
│   └── ResourcePageBlockLayout/
│       ├── Visualizations.php              # Template-ID dispatch (person vs entity)
│       └── ItemSetDashboard.php            # Placeholder
├── view/common/
│   ├── block-layout/
│   │   ├── collection-overview.phtml       # Live — precompute path
│   │   ├── index-overview.phtml            # Live — precompute path
│   │   ├── references-overview.phtml       # Live — live-fetch path
│   │   ├── scary-terms.phtml               # Live — precompute path
│   │   └── compare-projects.phtml          # Placeholder
│   └── resource-page-block-layout/
│       ├── visualizations/
│       │   ├── person.phtml                # Live — dispatched for template 5
│       │   └── entity.phtml                # Live — dispatched for templates 2/3/6/7
│       └── item-set-dashboard.phtml        # Placeholder
├── asset/
│   ├── css/
│   │   └── iwac-visualizations.css         # Consumes IWAC theme tokens
│   ├── js/                                 # Every .js has a .min.js sibling (terser, committed)
│   │   ├── iwac-i18n.js                    # Locale detection + en/fr dictionary + t()
│   │   ├── iwac-theme.js                   # ECharts theme built from live CSS vars
│   │   ├── dashboard-core.js               # IWACVis namespace, chart tracking, theme observer
│   │   └── charts/
│   │       ├── shared/                     # Reusable primitives (panels, pagination,
│   │       │                               #   table, facet-buttons, chart-options,
│   │       │                               #   maplibre, panel-toolbar, responsive)
│   │       ├── collection-overview.js      # Collection Overview orchestrator
│   │       ├── collection-overview/        # Panel modules (growth, gantt, wordcloud, map, …)
│   │       ├── index-overview.js           # Index Overview orchestrator
│   │       ├── index-overview/             # Panel modules — Section A: stats, type-distribution,
│   │       │                               #   top-entities, lifespan, places-map, activity-gantt,
│   │       │                               #   index-table; Section B: keywords-state,
│   │       │                               #   keywords-filters, keywords-chart, keywords-table
│   │       ├── references-overview.js      # References Overview orchestrator
│   │       ├── scary-terms.js              # Scary Terms orchestrator (bar-chart race)
│   │       ├── person-dashboard.js         # Person orchestrator
│   │       ├── person-dashboard/           # Panel modules (stats, network, sentiment, …)
│   │       └── entity-dashboard.js         # Entity orchestrator (reuses person panels)
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
│       ├── person-dashboards/{o_id}.json   # ~2,800 files
│       └── entity-dashboards/{o_id}.json   # ~1,550 files
├── scripts/                                # Python precompute + Node build
│   ├── iwac_utils.py                       # Shared helpers (ported from iwac-dashboard)
│   ├── generate_collection_overview.py
│   ├── generate_wordcloud.py
│   ├── generate_world_map.py
│   ├── generate_index_overview.py          # Section A — authority index bundle
│   ├── generate_keyword_explorer.py        # Section B — subjects + spatial + metadata
│   ├── generate_scary_terms.py
│   ├── generate_person_dashboards.py
│   ├── generate_entity_dashboards.py
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

### Asset loading — per-partial, no module listeners

`Module.php` is intentionally minimal and only wires `getConfig()`. Per the top-of-file docblock:

> Every block partial in this module enqueues its own stylesheet, CDN libraries, and JS dependencies via `$this->headLink` / `headScript`. We deliberately do NOT attach a controller listener that blanket-loads ECharts/MapLibre on every Item and ItemSet view — doing so cost ~600 KB of unused JavaScript on every Article page, even when no Visualizations block was configured.

Consequences for contributors:

- When adding a new block, mirror the enqueueing pattern from `view/common/resource-page-block-layout/visualizations/person.phtml` or `view/common/block-layout/collection-overview.phtml`.
- Assets must be attributed as `'IwacVisualizations'` in `$this->assetUrl($path, 'IwacVisualizations')`.
- **Reference `.min.js`, not `.js`** — the templates load minified bundles (see [Build](#build--development) below).
- **Pass `['defer' => 'defer']`** as the third argument to `headScript()->appendFile()` so the browser can keep parsing HTML while scripts download in parallel. Example:

  ```php
  $this->headScript()->appendFile(
      $this->assetUrl('js/charts/shared/chart-options.min.js', 'IwacVisualizations'),
      'text/javascript',
      ['defer' => 'defer']
  );
  ```

### Load order (runtime)

A live block partial enqueues scripts in the following order. All are deferred, so they download in parallel during HTML parse and execute in document order after parsing completes — the orchestrator always runs last, with its dependencies populated.

1. CDN libraries — `echarts.min.js`, optionally `echarts-wordcloud.min.js`, `maplibre-gl.js` + CSS (not deferred for CSS)
2. **IWAC infrastructure** — order matters: `iwac-i18n.min.js` → `iwac-theme.min.js` → `dashboard-core.min.js`
3. **Shared primitives** — `panels`, `responsive`, `chart-options`, `pagination`, `table`, `facet-buttons`, `maplibre` (only the ones the block uses)
4. **Panel modules** — self-registering IIFEs under `charts/<block>/` that attach to `IWACVis.<block>Dashboard.<panel>`
5. **Orchestrator** — `charts/<block>.js` — waits for `DOMContentLoaded`, fetches JSON (or live HF data), builds the DOM scaffold, and dispatches `panel.render(host, data, facet, ctx)` for each registered panel

### Data strategy — hybrid

The module intentionally supports **two data paths**, chosen per-block based on cost:

| Path | When to use | Example | Python needed? |
|---|---|---|---|
| **Live fetch** | Small subsets (< ~5k rows) without heavy per-row blobs. The chart JS paginates the Hugging Face `datasets-server /rows` endpoint (100 rows/request, parallel) and aggregates client-side. Always fresh, no precompute. | **References Overview** — 864 rows, 9 parallel requests, ~1 s | No |
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

1. **PHP (`$this->translate()`)** — block labels, form hints, loading messages, and any other text rendered server-side. Edit `language/fr.po` and compile with `msgfmt language/fr.po -o language/fr.mo`. Current catalog is 17 entries. See `language/README.md`.
2. **JavaScript (`IWACVis.t()`)** — chart labels, tooltips, summary card labels, tab names, facet UI. Dictionary lives inline in `asset/js/iwac-i18n.js`. Locale is detected once at render time from `document.documentElement.lang` (populated by Omeka's Internationalisation module).

Language switching in IWAC is a full page navigation (the Internationalisation module links to equivalent URLs under each locale), so no runtime switch is needed — `IWACVis.t()` just reads the locale when the orchestrator fires.

## Theme switching

- Signal: `body[data-theme="light" | "dark"]`, owned by the IWAC theme's `theme-toggle.js` (persisted in `localStorage['iwac-theme-preference']`).
- `dashboard-core.js` attaches a `MutationObserver` to `document.body` filtered on `data-theme` changes.
- On change, it calls `IWACVis.refreshThemes()` (rebuild + re-register the ECharts theme from the live CSS vars) then iterates `IWACVis._charts` to dispose every tracked ECharts instance and re-run its render function.
- ECharts 6 removed `chart.setTheme()`, which is why we use dispose + reinit. MapLibre instances get `setStyle()` pointed at the Carto positron / dark-matter URL.

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

# Per-entity data
python3 scripts/generate_person_dashboards.py   # → asset/data/person-dashboards/{o_id}.json
python3 scripts/generate_entity_dashboards.py   # → asset/data/entity-dashboards/{o_id}.json
```

`--minify` strips indentation and whitespace from the JSON output. Use it on the heavier bundles (`collection-overview`, `index-overview`, `keyword-explorer-*`) — it typically halves file size with no downside, since the JSON is only ever consumed by JS, not read by humans. Per-entity dashboards are individually small enough that pretty-printed output stays below a few KB each.

The HF dataset updates roughly monthly, so regeneration is a manual developer step, not a scheduled job. After every data regeneration, bump the version in `config/module.ini` (and `package.json` to match) so Omeka's `?v=` query string busts any stale browser caches pointing at the old asset URLs. When adding a new visualization, add a new `generate_*.py` next to the existing ones and document it in `scripts/README.md`.

**Canonical reference:** the sibling project [`iwac-dashboard`](https://github.com/fmadore/iwac-dashboard) has ~3,200 lines of working Python that reads the same dataset. `iwac_utils.py` in this module is ported from it, and `generate_keyword_explorer.py` is a direct port of iwac-dashboard's `/keywords` generator generalized to scan every content subset. Consult it before writing new generators.

## Build & development

JS sources under `asset/js/` are mirrored to `.min.js` siblings by `scripts/build-js.js` (terser). Templates load the `.min.js` variants; the unminified sources stay in-tree for development and debugging.

```bash
npm install          # installs terser as a devDependency (one-time)
npm run build:js     # walks asset/js/**/*.js and writes .min.js next to each source
```

`node_modules/` is gitignored; the generated `.min.js` files **are** committed, so a fresh clone works without running the build. Re-run `npm run build:js` after editing any `.js` source and commit both the source and the minified output.

Current minification results across 47 files: **≈ 390 KB → 150 KB (−61.7%)**. The biggest single drop is `charts/shared/chart-options.js` (≈ 69 KB → 22 KB).

There is no build step for CSS — `asset/css/iwac-visualizations.css` is hand-authored and loaded as-is.

## Related projects

- [IWAC Theme](https://github.com/fmadore/IWAC-theme) — the Omeka S theme this module targets
- [iwac-dashboard](https://github.com/fmadore/iwac-dashboard) — standalone SvelteKit dashboard with the canonical Python data pipeline
- [ResourceVisualizations](https://github.com/fmadore/ResourceVisualizations) — the module this was scaffolded from
- Hugging Face dataset: [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection)

## License

MIT
