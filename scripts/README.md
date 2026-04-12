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

Functions to use instead of rewriting:

| Function | What it does |
|---|---|
| `load_dataset_safe(config_name, ...)` | Fetch a HF subset as a pandas DataFrame. Logs and returns `None` on error. |
| `normalize_country(value, ...)` | Strip, title-case, handle `\|,;/` separators, `None` → `"Unknown"`. |
| `normalize_location_name(name)` | Unicode NFC + lowercase + strip — used for matching against the `index` `Titre` column. |
| `extract_year(value, min_year, max_year)` | Pulls a 4-digit year from strings / datetimes / numbers with validation. |
| `extract_month(value)` | `YYYY-MM` string. |
| `parse_coordinates(coord_str)` | `"lat, lng"` → `(float, float)` with range validation. |
| `parse_pipe_separated(value)` | Trimmed list from pipe-separated string or list. |
| `parse_multi_value(value, separators)` | Like above but tries `\|;,/` in order. |
| `find_column(df, candidates, required)` | Return the first matching column name, optionally raise. |
| `save_json(data, path, minify, log)` | Write JSON with auto-mkdir, size-logged. |
| `create_metadata_block(total_records, data_source, **extra)` | Standard metadata dict for output files. |
| `generate_timestamp()` | ISO UTC timestamp with `Z` suffix. |
| `configure_logging(level)` | Standard `%(asctime)s [%(levelname)s] %(message)s` format. |

Constants: `DATASET_ID = "fmadore/islam-west-africa-collection"` and
`SUBSETS = ["articles", "audiovisual", "documents", "publications", "references", "index"]`.

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
python3 scripts/generate_person_dashboards.py              # all persons (~2,600 files)
python3 scripts/generate_person_dashboards.py --limit 5    # smoke test
python3 scripts/generate_person_dashboards.py -v           # debug logging
```

Neighbor ranking is TF-IDF (`score = cooc × log(N_persons / df)`) with
a minimum co-occurrence floor of 2 and a top-50 cap per role slice,
so distinctive relationships outrank globally-common entities.

The generator joins back into content subsets via string-match on
`subject` (role: `subject`) and `author` (role: `creator`) fields
using the same Unicode normalization as
`iwac-dashboard/scripts/generate_entity_spatial.py`.
