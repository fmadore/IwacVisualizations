# IWAC Visualizations — precompute pipeline

Python scripts that read the Hugging Face dataset
`fmadore/islam-west-africa-collection-full` — the **private** full mirror of
the public [`fmadore/islam-west-africa-collection`](https://huggingface.co/datasets/fmadore/islam-west-africa-collection)
— and write aggregated JSON files into `asset/data/`. Reading it requires an
`HF_TOKEN` with access to the mirror (see below).

**Where the output is served from (issue #7).** `asset/data/` is **not committed
to git** and is **not generated on the production server**. The
`.github/workflows/regenerate-data.yml` workflow runs these generators on a
GitHub runner, zips `asset/data/`, and publishes `iwac-data.zip` to the moving
`data` release. The Omeka module's admin **“Pull latest data”** button then
unpacks that archive into `files/iwac-visualizations/`, which the JavaScript
charts fetch same-origin at page load. Static map geometry the generators read
as input lives committed under `asset/geo/` (not regenerated here).

This directory is **not touched at runtime** — Omeka never imports Python.
The generators run in CI (or on the curator's machine) whenever the dataset
changes (roughly monthly), or whenever the schema of a generator changes.

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

# Install the exact, hash-verified CI environment
pip install --require-hashes -r scripts/requirements.lock

# Run a generator
python3 scripts/generate_collection_overview.py
```

`scripts/requirements.txt` remains the short, human-maintained list of direct
dependencies. `scripts/requirements.lock` is the reproducible Python 3.12/Linux
environment used by the data workflow. After changing the input, regenerate it
with the currently verified uv release:

```bash
npm run lock:python
```

The command uses `uv==0.12.1`, resolves for the GitHub runner platform, writes
hashes for every artifact, and records the input-file digest. `npm run lint`
fails if the input and lock drift apart.

Environment variables:

| Variable | Purpose |
|---|---|
| `HF_TOKEN` | Hugging Face access token. **Required** — the default dataset (`fmadore/islam-west-africa-collection-full`) is a private mirror. `datasets` picks the token up from the environment (or `huggingface-cli login`) automatically. In CI it comes from the `HF_TOKEN` repository secret. |

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
6. Write one JSON per article (minified)

Sentiment is deliberately **not** precomputed here: since v0.11.0 the
article dashboard renders its sentiment panel server-side straight from
the Omeka `iwac:<model><Axis>` properties via `SentimentExtractor.php`,
so it stays in sync with editorial changes on islam.zmo.de without
waiting for a regenerator pass.

**Output shape:** `{article, entities, spatial, related_by_entities, semantic_neighbors}`.
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
  committed `asset/geo/iwac-countries.geojson`.
- `country_focus` — administrative Country Focus data ported into the
  block: available countries/levels, per-region or per-prefecture
  counts, per-level bounds, and lazy GeoJSON paths under
  `asset/geo/admin-boundaries/`. Counts are derived from the same
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

### `generate_on_this_day.py`

Fans out `asset/data/on-this-day/{MM-DD}.json` (366 files, ~1 KB each) for
the On This Day page block: every fully-dated (`YYYY-MM-DD`) article and
periodical issue, bucketed by calendar day as compact
`[year, o_id, title, source, type]` rows. A dir-level `metadata.json`
carries provenance. Standard flags (`--repo`, `--output-dir`,
`--minify/--no-minify`, `-v`).

### `generate_press_bylines.py`

Writes `asset/data/press-bylines.json` (~6 KB) for the Press Bylines page
block: byline coverage summary, per-year signed/total counts, and the top
`--top-n` (default 25) bylines with active span, top newspapers, frequent
subjects, and the `Personnes` authority `o_id` where the name resolves
(`Titre` + `Titre alternatif`, both sides through
`normalize_location_name`). Extra flag: `--prolific-min` (default 10).

### `generate_scary_terms.py` (extended — issues #2/#3/#4)

One corpus scan now feeds seven bundles: the original four
(`metadata` / `temporal` / `countries` / `global` + `cooccurrence`)
plus `scary-terms-trends.json` (aligned per-year series, global +
per-country), `scary-terms-wordcloud.json` (document-frequency
vocabulary of matching articles: global / by family / by country /
5-year buckets — family variants excluded), and
`scary-terms-places.json` (geocoded `Lieux` joins via
`articles.spatial`). The hand-curated `scary-terms-events.json`
annotation sidecar is **committed**, not generated (gitignore
exception, like `sentiment-arbiter.json`). Extra flags: `--max-words`
(200), `--min-frequency` (5), `--min-place-articles` (3).

### `generate_org_cooccurrence.py`

Writes `asset/data/org-cooccurrence.json` (~22 KB) for the Islamic
Organisations Co-occurrence block (issue #1): a ±`--window-size` (50)
token window around each organisation's curated surface forms over the
articles OCR; matrix cell (a, b) counts articles where both context
words share the window. Organisations + aliases live in the editable
sidecar `scripts/org_cooccurrence_targets.json` (o_ids cross-checked
against the index at build time). Extra flags: `--top-n-terms` (30),
`--min-cooccurrence` (2), `--targets`.

### `generate_term_trends.py`

The Term Trends ("Ngram viewer") data: `term-trends-index.json`
(frequency-sorted search index + per-year article totals) plus lazy
per-letter shards `term-trends/{a..z,0}.json` with per-year document
frequency over `lemma_nostop` via the shared `tokenize` vocabulary.
The ASCII-folded `shard_key` logic is mirrored client-side in
`asset/js/charts/term-trends.js`. Extra flags: `--max-terms` (5000),
`--min-total` (25).

### `generate_reprints.py`

Writes `asset/data/press-reprints.json` (~24 KB) for the Press Reprints
block: batched upper-triangle cosine scan over `embedding_OCR`
(via `iwac_embeddings.py`), logging a similarity histogram from
`--scan-threshold` (0.90) on every build and publishing cross-newspaper
pairs ≥ `--threshold` (0.97), capped at `--max-pairs` (500). The
histogram ships in the bundle so the threshold stays tunable with
evidence.

### `generate_corpus_health.py`

Writes `asset/data/corpus-health.json` (~2 KB) — curator-facing
coverage meters (OCR / transcription / lemmas / embeddings / sentiment /
LDA + top-k / bylines / spatial tags / ToC / abstracts / DOI / geocoding /
date precision per subset) rendered server-side on the admin Sync Data
page. Labels are English-only by design (internal tooling).

`references` and `audiovisual` have their own branches since the 2026-07
pipeline gave them full text: the bibliography now runs the same
enrichment ladder as articles (text → lemmas → embeddings → LDA), and
audiovisual `OCR` is a *transcription*, which the meter says rather than
calling it OCR.

One meter is not pipeline progress: **"Text public on islam.zmo.de"**
(`OCR_is_public`) tracks how much of each subset's text the *public*
Hugging Face projection carries. The generators here read the private full
mirror, so the module's own visualisations cover all of it either way —
this meter is about what an outside researcher can reproduce from the
citable dataset, and it moves when rights are cleared on Omeka rather than
when a script is re-run.

### `generate_keyness.py`

Writes `asset/data/keyness.json` — the Distinctive Vocabulary block. Two
views over `articles`: **keyness** (which words a country or decade uses more
than the rest of the collection) and **subject bursts** (when coverage of a
subject spiked above its own base rate).

Flags beyond the standard set: `--top-n` (terms per slice, 25),
`--min-count` (in-slice occurrences required to test a token, 10),
`--alpha` (BH false-discovery rate, 0.05), `--min-log-ratio` (effect-size
floor, 0.585 = 1.5×; pass 0 to report everything significant),
`--min-subject-total` (articles a subject needs before burst detection, 30),
`--max-subjects` (burst subjects kept, 40), `--burst-s` / `--burst-gamma`
(Kleinberg burst-rate multiplier and transition cost).

Only five columns are materialised (`o:id`, `pub_date`, `country`, `subject`,
`lemma_nostop`) — the subset also carries OCR and a 768-dim embedding per
row, and pulling those into pandas is where the memory goes.

## Shared statistics helpers — `iwac_stats.py`

BH q-values, Dunning G², Hardie's log ratio, the per-slice keyness pass, and
Kleinberg burst detection. Ported from the sibling IWAC-Hugging-Face
pipeline's `analyses/_stats.py` + `analyses/keyness_bursts.py` rather than
imported: that repo is the data pipeline, not a dependency of this module,
and its outputs reach us only through the Hub. Where the two must agree —
same measures, same corpus — the formulas are kept literally identical, so
**a change to one should be made in both**.

No SciPy: the χ² upper tail for df = 1 is `erfc(sqrt(x/2))`, an identity
rather than an approximation, which also stays accurate deep in the tail
where `1 - cdf` cancels to zero.

## Shared embedding helpers — `iwac_embeddings.py`

The coerce → normalize → batched-cosine stack (REFACTORING.md Tier 4):
`coerce_embedding`, `build_normalized_matrix`, `top_k_cosine`,
`pairs_above_threshold`. First consumer: `generate_reprints.py`; the
four older embedding generators (`article_dashboards`,
`publication_dashboards`, `semantic_landscape`,
`periodicals_landscape`) still carry local copies and should migrate
one at a time with output-diff checks.

## Shared helpers — `iwac_utils.py`

Functions to use instead of rewriting. The **v0.9.0 refactor** promoted
`clean_str`, `clean_float`, `extract_month_num`, `canonical_country`,
and `canonicalize_country_field` out of individual generators into
this shared module, and upgraded `parse_coordinates` to accept
tuples/lists and whitespace-separated strings in addition to the
classic `"lat, lng"` form.

| Function | What it does |
|---|---|
| `load_dataset_safe(config_name, repo_id, token)` | Fetch a HF subset as a pandas DataFrame. The heavyweight `datasets` client is imported only when this function is called; errors are logged and return `None`. |
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
| `sentiment_columns(model, field)` | Candidate HF column names for one canonical model id × field, current naming first. |
| `resolve_sentiment_columns(df, models, fields)` | `{model: {field: column_or_None}}` for the sentiment columns actually present. **Use this instead of building `f"{model}_polarite"` by hand** — HF renamed the prefixes to model-specific names on 2026-07-31 and hand-built names now silently resolve to nothing. Warns once per process when a model resolves to nothing. |
| `save_json(data, path, minify, log)` | Write JSON with auto-mkdir, size-logged. |
| `create_metadata_block(total_records, data_source, **extra)` | Standard metadata dict for output files. |
| `generate_timestamp()` | ISO UTC timestamp with `Z` suffix. |
| `configure_logging(level)` | Standard `%(asctime)s [%(levelname)s] %(message)s` format. Pass `logging.DEBUG` when `--verbose` is set. |

Constants: `DATASET_ID = "fmadore/islam-west-africa-collection-full"` (the
private full mirror; `--repo` on every generator overrides it) and
`SUBSETS = ["articles", "audiovisual", "documents", "images", "publications", "references", "index"]`.

Sentiment constants: `SENTIMENT_MODELS = ("gemini", "chatgpt", "mistral")` —
the canonical ids every generated payload, block JS file, i18n catalog,
Omeka property (`iwac:gemini*`) and arbiter file keys on — plus
`SENTIMENT_HF_PREFIXES` mapping each onto the model-specific HF column
prefix (`gemini_3_flash_preview`, `gpt_5_mini`, `ministral_14b_2512`) with
the pre-2026-07-31 vendor name kept as a fallback for stale parquet
caches. See [DATA_NOTES.md](../DATA_NOTES.md) for the full table.

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
| `--max-words`, `--min-frequency`, `--min-place-articles` | `scary-terms` | Word-cloud slice cap (200) / document-frequency floor (5) / map place floor (3) for the issue #2–#4 bundles. |
| `--window-size`, `--top-n-terms`, `--min-cooccurrence`, `--targets` | `org-cooccurrence` | Sliding-window half-width (50), matrix vocabulary (30), weak-pair floor (2), sidecar path. |
| `--max-terms`, `--min-total` | `term-trends` | Ngram vocabulary cap (5000) and total-document-frequency floor (25). |
| `--threshold`, `--scan-threshold`, `--max-pairs` | `reprints` | Publication cosine cut-off (0.97), histogram scan floor (0.90), published-pair cap (500). |

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

- **"Error loading subset 'articles'"** — first check `HF_TOKEN`: the
  default dataset is a **private** mirror, so a missing or unscoped token
  surfaces as a generic 401/403 load error. The dataset is also large
  (~185 MB download for `articles`), so check network and disk too.
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
