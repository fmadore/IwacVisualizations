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

## Canonical reference

Before writing anything new here, look at
`/home/fmadore/projects/iwac-dashboard/scripts/` first. That sibling
project is a standalone SvelteKit dashboard that reads the same dataset
and has ~3,200 lines of working generators covering overview, timeline,
co-occurrence, knowledge graph, treemap, wordcloud, world map, topic
network, and more. Most data-normalization problems are already solved
there. `iwac_utils.py` in this directory is a **verbatim copy** of its
counterpart in iwac-dashboard.

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

## CLI conventions

Every generator supports the same baseline flags (v0.9.0+):

| Flag | Purpose |
|---|---|
| `--repo` | Hugging Face dataset repo id. Defaults to `DATASET_ID`. Override to point at a fork or a dev mirror. |
| `-v`, `--verbose` | Set log level to `DEBUG` (normally `INFO`). Prints per-subset load sizes and aggregation details. |

Block-specific extras (partial list):

| Flag | Scripts | Purpose |
|---|---|---|
| `--output` / `--output-dir` | all | Override the default asset/data target path. |
| `--minify` | `collection-overview`, `index-overview`, `keyword-explorer` | Produce compact JSON (no indentation). Typically halves file size. |
| `--top-n` | `collection-overview`, `index-overview` | Cap top-N entity lists. |
| `--limit` | `entity-dashboards`, `person-dashboards` | Only process the first N entities (smoke testing). |
| `--type` | `entity-dashboards` | Restrict to one entity type (`Lieux` / `Organisations` / `Sujets` / `Événements`). |
| `--min-cooccurrence` | `entity-dashboards`, `person-dashboards` | Threshold for the TF-IDF neighbor network. Default 2. Bump to 3–5 to prune noise. |
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
`iwac-dashboard/scripts/generate_entity_spatial.py`.

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
be reused unchanged with a no-op facet.
