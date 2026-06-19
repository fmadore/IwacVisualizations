# IWAC Visualizations — precompute pipeline

Python scripts that read the Hugging Face dataset
[`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection)
and write aggregated JSON files into `asset/data/`. The Omeka S module
serves those JSONs statically, and the JavaScript charts fetch them at
page load.

This directory is **not touched at runtime** — Omeka never imports Python.
It's a developer tool that runs on the curator's machine whenever the
dataset changes (roughly monthly), or whenever the schema of a generator
changes.

## Provenance

`iwac_utils.py` and several generators here were originally seeded from the
sibling `iwac-dashboard` SvelteKit project. **That project is deprecated** — this
directory is now the source of truth, and `iwac_utils.py` is fully self-contained:
add and refactor shared helpers freely, with **no** cross-repo sync constraint.
For the HF dataset schema, the `iwac-dataset` skill is the canonical reference;
model new generators on the existing `generate_*.py` here.

## Quickstart

```bash
# From the module root (one level up from this directory):
cd /path/to/IwacVisualizations

# Create and activate a virtualenv (first time only)
python3 -m venv .venv
source .venv/bin/activate           # Linux/macOS
# .\.venv\Scripts\Activate.ps1       # Windows PowerShell

# Install dependencies
pip install -r scripts/requirements.txt

# Run a generator
python3 scripts/generate_collection_overview.py
```

Optional environment variables:

| Variable | Purpose |
|---|---|
| `HF_TOKEN` | Hugging Face access token. Not required — the dataset is public. |

## Available generators

### `generate_collection_overview.py`

Writes `asset/data/collection-overview.json` — the data for the
Collection Overview page block.

```bash
python3 scripts/generate_collection_overview.py
python3 scripts/generate_collection_overview.py --top-n 15
python3 scripts/generate_collection_overview.py --year-min 1980 --year-max 2026
python3 scripts/generate_collection_overview.py --output asset/data/collection-overview.json
python3 scripts/generate_collection_overview.py --minify     # compact JSON
```

**Output structure:**

```json
{
  "metadata": {
    "totalRecords": 19420,
    "dataSource": "fmadore/islam-west-africa-collection",
    "generatedAt": "2026-04-09T14:30:00Z",
    "script": "generate_collection_overview.py",
    "script_version": "0.1.0",
    "top_n": 10
  },
  "summary": {
    "articles": 12287, "publications": 1501, "documents": 26,
    "audiovisual": 45, "references": 864, "index_entries": 4697,
    "total_content": 13859, "total_words": 12345678,
    "countries": 6, "languages": 8,
    "year_min": 1960, "year_max": 2025
  },
  "timeline": {
    "years": [1960, 1961, ...],
    "countries": ["Burkina Faso", "Bénin", ...],
    "series": { "Burkina Faso": [12, 14, ...], "Bénin": [...], ... },
    "totals": [12, 20, ...]
  },
  "countries": [
    { "name": "Burkina Faso", "total": 4500,
      "articles": 4000, "publications": 500, "documents": 0, "audiovisual": 0 },
    ...
  ],
  "languages": [
    { "name": "Français", "count": 11000 },
    ...
  ],
  "top_entities": {
    "Personnes":     [{ "o_id": 1234, "title": "...", "frequency": 287,
                        "countries": ["Burkina Faso"],
                        "first_occurrence": "2001-05-12",
                        "last_occurrence":  "2024-09-30" }, ...],
    "Organisations": [...],
    "Lieux":         [...],
    "Sujets":        [...],
    "Événements":    [...]
  }
}
```

**Aggregation notes:**

- `timeline` counts articles + publications + documents + audiovisual
  items per year, stacked by country. References + index are excluded.
  `extract_year()` uses ranges `[1900, 2100]` by default.
- `countries` parses `country` as pipe-separated (some records carry
  multiple countries). Totals are per subset so the JS can render
  stacked country bars if desired later.
- `languages` parses `language` as pipe-separated, counted across all
  content subsets.
- `top_entities` reads the `index` subset directly — its `frequency`,
  `first_occurrence`, `last_occurrence`, `countries` fields are already
  precomputed by the dataset curator (aggregated against articles +
  publications + references), so no join is needed.

### `generate_article_dashboards.py`

Writes one JSON per newspaper article under
`asset/data/article-dashboards/{o_id}.json` (~12,287 files, ~120 MB
total). Drives the per-article resource-page block that attaches to
`bibo:Article` items (Omeka template id 8).

```bash
python3 scripts/generate_article_dashboards.py
python3 scripts/generate_article_dashboards.py --limit 5              # smoke test
python3 scripts/generate_article_dashboards.py --top-k-semantic 10    # default
python3 scripts/generate_article_dashboards.py --top-k-related 20     # default
```

**Workflow:**

1. Load `articles` + `index` (articles carries the 768-dim `embedding_OCR` column)
2. Build a normalized-name → entity lookup over `index` (same rules
   as `generate_entity_dashboards.py` — NFC + lowercase, with
   `Titre alternatif` aliases)
3. For each article, resolve `subject` + `spatial` names to index
   entity o_ids; record the inverted `entity → articles` map as a side-product
4. **Semantic kNN**: stack embeddings into an `(N, 768)` float32 matrix,
   L2-normalize, batched `X[i:i+500] @ X.T` with `argpartition` for
   top-K per row (~4 s total on 12k articles)
5. **Related-by-entities**: for each article, counter-union its
   entities' article sets, take `most_common(top_k_related)`; record
   up to 3 shared-entity ids inline so the UI tooltip can name them
6. Reshape the 3-model sentiment (Gemini / ChatGPT / Mistral) into
   the same bucket-histogram contract the aggregate sentiment panel
   reads — `count=1` in the bucket the model picked, 0 elsewhere
7. Write one JSON per article (minified)

**Output shape:** `{article, entities, spatial, sentiment, related_by_entities, semantic_neighbors}`.
The client (`network.js`) builds the 3-layer force graph at render time
from `entities` + `related_by_entities` — keeping the graph out of the
precomputed JSON saves ~3 KB per file.

### `generate_spatial_exploration.py`

Writes `asset/data/spatial-exploration.json` — the sidecar behind the
Spatial Exploration page block.

```bash
python3 scripts/generate_spatial_exploration.py
python3 scripts/generate_spatial_exploration.py --no-minify -v
```

**Output structure** (compact array rows, column order in `_meta.columns`):

- `locations` — every geocoded index Lieu with `frequency > 0`:
  `[o_id, name, lat, lng, count, focus_country_index]`. The focus
  country (index into `focus_countries`, −1 = elsewhere) is resolved by
  walking the index's `Partie de` chain up to one of the six IWAC
  countries — it powers the country-focus bubble filter.
- `pickers` — per entity type (Personnes / Organisations / Événements /
  Sujets / Lieux) every index entity with at least one mention, as
  `[o_id, label, frequency]`, sorted by frequency. The block searches
  these client-side; **selection data comes from the existing
  `person-dashboards/` / `entity-dashboards/` fan-outs**, so run those
  generators in the same refresh cycle.
- `country_counts` — items per canonical country across all five
  content subsets (choropleth fill in collection mode).
- `country_bounds` — `[w, s, e, n]` per IWAC country, read from the
  committed `asset/data/iwac-countries.geojson`.
- `country_focus` — administrative Country Focus data ported into the
  block: available countries/levels, per-region or per-prefecture
  counts, per-level bounds, and lazy GeoJSON paths under
  `asset/data/admin-boundaries/`. Counts are derived from the same
  geocoded `locations` rows so rerunning this generator refreshes both
  bubble and administrative choropleth data.

### `generate_entity_networks.py`

Writes the two payloads behind the Entity Networks page block:
`asset/data/entity-networks-global.json` (cross-type entity graph) and
`asset/data/entity-networks-spatial.json` (geographic co-mention
network). Requires `networkx` (ForceAtlas2 layout).

```bash
python3 scripts/generate_entity_networks.py
python3 scripts/generate_entity_networks.py --min-cooccurrence 3 -v
python3 scripts/generate_entity_networks.py --pairs "personnes-organisations,lieux-evenements"
```

**Workflow:**

1. Reuse the `DashboardAggregator` loading + resolution pipeline
   (index lookup with `Titre alternatif` aliases; per-item subject +
   spatial references over articles / publications / references)
2. **Global**: for each item and each configured cross-type pair
   (default mirrors IWAC-spatial-overview: person↔org plus events as
   connective tissue), every co-occurring entity pair adds 1 to its
   edge weight; prune below `--min-cooccurrence` (default 2), drop
   isolated nodes
3. Layout with `networkx.forceatlas2_layout` (seeded, weighted), then
   project to pseudo-lng/lat through the **inverse Web-Mercator** so
   MapLibre's forward projection reproduces the layout plane exactly —
   the client renders with zero layout cost
4. **Spatial**: same pipeline, but edges join geocoded Lieux that
   appear in the same item; nodes carry real coordinates
5. Both payloads are compact array rows (column order in
   `_meta.columns`) with **no per-edge item-id lists** — that's what
   keeps them at ~180 KB / ~145 KB versus the 2–4 MB equivalents in the
   standalone app

## Shared helpers — `iwac_utils.py`

Functions to use instead of rewriting. The **v0.9.0 refactor** promoted
`clean_str`, `clean_float`, `extract_month_num`, `canonical_country`,
and `canonicalize_country_field` out of individual generators into
this shared module, and upgraded `parse_coordinates` to accept
tuples/lists and whitespace-separated strings in addition to the
classic `"lat, lng"` form.

| Function | What it does |
|---|---|
| `load_dataset_safe(config_name, repo_id, token)` | Fetch a HF subset as a pandas DataFrame. Logs and returns `None` on error. |
| `canonical_country(name)` | Apply IWAC display overrides on top of `str.title()` — handles apostrophes ("Côte d'Ivoire") and accents. Re-exported as `_canonical_country` for backwards compatibility. |
| `canonicalize_country_field(value)` | `pandas.Series.apply()`-ready helper: maps a `country` cell to its canonical form, handling None/NaN, plain strings, and pipe-separated strings. Promoted from duplicates in 3 generators. |
| `normalize_country(value, ...)` | Strip, title-case, handle `\|,;/` separators, `None` → `"Unknown"`. |
| `normalize_location_name(name)` | Unicode NFC + lowercase + strip — used for matching against the `index` `Titre` column. |
| `extract_year(value, min_year, max_year)` | Pulls a 4-digit year from strings / datetimes / numbers with validation. |
| `extract_month(value)` | `YYYY-MM` string. |
| `extract_month_num(date_str)` | Pull a 1–12 month number out of an ISO-ish `YYYY-MM[-DD]` date. `None` for bare years or unparseable input. |
| `parse_coordinates(value)` | `"lat, lng"` / `"lat lng"` / `(lat, lng)` tuple / `[lat, lng]` list → `(float, float)` with range validation. |
| `parse_pipe_separated(value)` | Trimmed list from pipe-separated string or list. |
| `parse_multi_value(value, separators)` | Like above but tries `\|;,/` in order. |
| `clean_str(value)` | Strip-and-cast a DataFrame cell, treating NaN/None as `""`. |
| `clean_float(value)` | Cast a DataFrame cell to float, or `None` for NaN / missing / garbage. |
| `find_column(df, candidates, required)` | Return the first matching column name, optionally raise. |
| `save_json(data, path, minify, log)` | Write JSON with auto-mkdir, size-logged. |
| `create_metadata_block(total_records, data_source, **extra)` | Standard metadata dict for output files. |
| `generate_timestamp()` | ISO UTC timestamp with `Z` suffix. |
| `configure_logging(level)` | Standard `%(asctime)s [%(levelname)s] %(message)s` format. Pass `logging.DEBUG` when `--verbose` is set. |

Constants: `DATASET_ID = "fmadore/islam-west-africa-collection"` and
`SUBSETS = ["articles", "audiovisual", "documents", "publications", "references", "index"]`.

## Shared dashboard core — `dashboard_aggregator.py`

`generate_person_dashboards.py` and `generate_entity_dashboards.py`
emit the same JSON section shapes (summary, timeline, newspapers,
countries, network, locations, topics, sentiment, heatmap,
cooccurrence), so the whole pipeline — HF loading, the normalized-name
→ index entity lookup, per-item metadata/reference resolution, the
TF-IDF document-frequency pass, and the ten `compute_*` aggregators —
lives once in `DashboardAggregator`. The two generators subclass it
and only override where they genuinely diverge:

- `_role_slices()` — **the main override point.** Persons yield four
  `(role, item_keys)` slices (`all` / `subject` / `creator` /
  `editor`); entities yield a single `all` slice, which is what
  produces their `by_role.all` wrapper.
- `_register_item()` / `_item_neighbor_ids()` / `_item_location_ids()`
  / `_iter_target_items()` — bridge the per-item storage shapes
  (persons keep role buckets + a separate spatial table; entities
  collapse subject + spatial into one set per item).
- `_is_target()` / `_target_label()` / `_cache_header_columns()` —
  target selection and the person header columns.

The refactor is output-stable: regenerated per-item JSON is
byte-identical to the pre-refactor output (verified on `--limit 5`
samples with the `generated_at` timestamp masked). When adding a new
per-resource dashboard generator, subclass `DashboardAggregator`
instead of copying either script.

## CLI conventions

Every generator supports the same baseline flags (normalized in v1.3.x):

| Flag | Purpose |
|---|---|
| `--repo` | Hugging Face dataset repo id. Defaults to `DATASET_ID`. Override to point at a fork or a dev mirror. |
| `-v`, `--verbose` | Set log level to `DEBUG` (normally `INFO`). Prints per-subset load sizes and aggregation details. |
| `--output` / `--output-dir` | Override the default asset/data target path. Single-bundle generators use `--output`; fan-out / multi-file generators use `--output-dir`. |
| `--minify` / `--no-minify` | Compact vs. pretty-printed JSON (`argparse.BooleanOptionalAction`). Defaults match what each script always did: minified for the per-item dashboards (`person`, `entity`, `article`), `wordcloud`, and `compare-newspapers` per-corpus bundles; pretty for everything else. Typically halves file size. |

Block-specific extras (partial list):

| Flag | Scripts | Purpose |
|---|---|---|
| `--top-n` | `collection-overview`, `index-overview`, `compare-newspapers` | Cap top-N entity lists. |
| `--limit` | `entity-dashboards`, `person-dashboards`, `article-dashboards` | Only emit the first N per-item files (smoke testing). The aggregates inside each file still use the full corpus, which is why the single-bundle overview generators deliberately have no `--limit` — truncating their input would silently corrupt the analytics without making the slow part (subset download/parse) any faster. |
| `--type` | `entity-dashboards` | Restrict to one entity type (`Lieux` / `Organisations` / `Sujets` / `Événements`). |
| `--min-cooccurrence` | `entity-dashboards`, `person-dashboards` | Threshold for the TF-IDF neighbor network. Default 2. Bump to 3–5 to prune noise. |
| `--min-cooccurrence` | `compare-newspapers` | Minimum item count for a country / newspaper corpus to get its own JSON. Default 15. `--min-count` still works as a deprecated alias (logs a warning). |
| `--top-k-semantic` | `article-dashboards` | Semantic-neighbour cap per article. Default 10. |
| `--top-k-related` | `article-dashboards` | Related-by-entities cap per article. Default 20. |
| `--min-country-articles` | `scary-terms` | Drop countries with fewer than N articles from the country view. Default 5. |

## Adding a new generator

1. Create `scripts/generate_<name>.py`.
2. Import the helpers:
   ```python
   from iwac_utils import (
       DATASET_ID, configure_logging, load_dataset_safe,
       parse_pipe_separated, extract_year, save_json, create_metadata_block,
   )
   ```
3. Load only the subsets you need — skip `articles` unless you really
   need its ~275 MB of OCR text + embeddings.
4. Write output under `asset/data/<folder>/<id>.json` or
   `asset/data/<name>.json`. Keep per-item files under a subdirectory
   so `git status` stays readable.
5. Add an entry to this README's "Available generators" section.
6. If the new data feeds a new visualization, also add a chart JS under
   `asset/js/charts/` following the `collection-overview.js` pattern.

## Troubleshooting

- **"Error loading subset 'articles'"** — the dataset is public but
  large (~185 MB download for `articles`). Check network and disk.
  The HF cache defaults to `~/.cache/huggingface/datasets/`.
- **"Required column not found"** — the dataset schema may have changed.
  Check the current schema at the HF dataset page and update the
  generator. `DATA_NOTES.md` at the module root has a snapshot of the
  schema as of project inception.
- **Long-running `articles` aggregation** — most time is spent
  downloading + parsing parquet. Subsequent runs use the HF cache so
  they're fast.

## generate_person_dashboards.py

Produces one JSON per Person in the `index` subset, consumed by the
`personDashboard` resource-page block. Output goes to
`asset/data/person-dashboards/{o_id}.json`.

```bash
python3 scripts/generate_person_dashboards.py                     # all persons (~2,600 files)
python3 scripts/generate_person_dashboards.py --limit 5           # smoke test
python3 scripts/generate_person_dashboards.py -v                  # debug logging
python3 scripts/generate_person_dashboards.py --min-cooccurrence 3  # tighter network
python3 scripts/generate_person_dashboards.py --repo myuser/fork  # alternate dataset
```

Neighbor ranking is TF-IDF (`score = cooc × log(N_persons / df)`) with
a minimum co-occurrence floor of 2 (override via `--min-cooccurrence`)
and a top-50 cap per role slice, so distinctive relationships outrank
globally-common entities.

The generator joins back into content subsets via string-match on
`subject` (role: `subject`) and `author` (role: `creator`) fields
using the same Unicode normalization as
`iwac-dashboard/scripts/generate_entity_spatial.py`. The aggregation
pipeline itself is shared with the entity generator — see
`dashboard_aggregator.py` above; this script only adds the role
buckets and the person header fields.

## generate_entity_dashboards.py

Produces one JSON per non-person entity (Lieux / Organisations /
Sujets / Événements) in the `index` subset, consumed by the
`Visualizations` resource-page block via the `entity.phtml` partial.
Output goes to `asset/data/entity-dashboards/{o_id}.json`.

```bash
python3 scripts/generate_entity_dashboards.py                     # all entities (~1,550 files)
python3 scripts/generate_entity_dashboards.py --type Lieux        # one type only
python3 scripts/generate_entity_dashboards.py --limit 5           # smoke test
python3 scripts/generate_entity_dashboards.py --min-cooccurrence 3
```

Entities with zero mentions still get a placeholder JSON so the
resource page block renders "no data available" states instead of 404-ing.
The output shape mirrors `person-dashboards` exactly but wraps every
section in a `by_role.all` envelope so the person panel JS modules can
be reused unchanged with a no-op facet. Like the person generator,
this is a thin subclass of `dashboard_aggregator.DashboardAggregator`
— it overrides the target filter (`--type`) and the collapsed
subject+spatial reference set, nothing else.
