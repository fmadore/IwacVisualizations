# IWAC Hugging Face Dataset — Notes

Source: https://huggingface.co/datasets/fmadore/islam-west-africa-collection
License: CC-BY-NC-SA-4.0 · Languages: fr, en · Total rows: ~19,420

```python
from datasets import load_dataset
ds = load_dataset("fmadore/islam-west-africa-collection", name="articles")
```

## Subsets at a glance

| Subset | Rows | Has OCR | Has embeddings | Has AI sentiment | Purpose |
|---|---:|:---:|:---:|:---:|---|
| `articles` | **12,287** | ✓ | ✓ `embedding_OCR` (768) | ✓ (Gemini / ChatGPT / Mistral) | Digitized newspaper articles — richest subset |
| `publications` | **1,501** | ✓ | ✓ `embedding_tableOfContents` (768) | — | Books, pamphlets, periodicals (Islamic publications) |
| `index` | **4,697** | — | — | — | Authority records (persons/places/orgs/events/subjects) with pre-computed frequency stats |
| `references` | **864** | — | — | — | Bibliographic citations |
| `audiovisual` | 45 | — | — | — | Audio/video, Nigeria-only |
| `documents` | 26 | ✓ | — | — | Archival materials, non-periodical |

## Shared column conventions

- **Pipe separator** `|` for multi-value fields (`author`, `subject`, `spatial`, `language`, `Titre alternatif`, `countries`)
- **Missing** → empty string for text, null/NaN for numeric
- **Dates**: ISO `YYYY-MM-DD`
- **Embeddings**: 768-dim `gemini-embedding-2-preview`, averaged over overlapping chunks for long texts
- **Common across all subsets**: `o:id`, `identifier`, `added_date`, `iwac_url`, `thumbnail`

## Key dimensions (what we can visualize)

### Time
- `pub_date` on every content subset → timelines (articles dominate with 12k points)
- `added_date` on every subset → "how the collection grew" timeline
- `index.first_occurrence` / `index.last_occurrence` → entity lifespan bars

### Geography
- `country` single-value (6 countries: Burkina Faso, Bénin, Niger, Nigeria, Togo, Côte d'Ivoire)
- `spatial` multi-value (pipe-separated, geographic focus)
- `index` entries where `Type == "Lieux"` carry `Coordonnées` (lat/long) → MapLibre markers
- `index.countries` already aggregated per entity

### Entities (authority file)
The `index` subset is **pre-aggregated** — each row already has:
- `frequency` — total mentions across articles + publications + references
- `first_occurrence` / `last_occurrence` — date range
- `countries` — pipe-separated list where it appears
- `Type` ∈ `{"Personnes", "Organisations", "Lieux", "Événements", "Sujets", "Notices d'autorité"}`
- Person-specific: `Prénom`, `Nom`, `Genre`, `Naissance`
- Place-specific: `Coordonnées`

**Big win**: top-N charts, timelines of entity lifetimes, and geographic maps can be rendered straight from `index` without joining back into `articles`.

### Articles — unique angles

- **LDA topics** (30): `lda_topic_id`, `lda_topic_prob`, `lda_topic_label` → topic-over-time stacked area, topic co-occurrence
- **Lexical metrics**: `Richesse_Lexicale_OCR` (TTR), `Lisibilite_OCR` (Flesch FR), `nb_mots` → scatter/distribution charts
- **AI sentiment from 3 models** (Gemini / ChatGPT / Mistral), each with:
  - `*_centralite_islam_musulmans` ∈ {Très central, Central, Secondaire, Marginal, Non abordé}
  - `*_polarite` ∈ {Très positif, Positif, Neutre, Négatif, Très négatif, Non applicable}
  - `*_subjectivite_score` 1–5
  - `*_justification` free text
  - → model-comparison charts, sentiment-over-time, sentiment-by-newspaper/country
- **Semantic embeddings** `embedding_OCR` → 2D projection (UMAP/t-SNE precomputed offline) for "article landscape" scatter

### Subject tags (all content types)
`subject` field is pipe-separated. **These strings are likely references to `index.Titre`** — the index acts as a controlled vocabulary. Needs confirmation but if true, we can build entity-to-article join by string match.

## Visualization candidates (rough brainstorm)

### Collection-level (site-wide page block)
- Article count timeline by year, stacked by country
- Top 20 persons / orgs / places / subjects (from `index`, sorted by `frequency`)
- Choropleth of the 6 countries + optional marker map from `Lieux` entries
- Language distribution donut
- Sentiment distribution (articles) — 3 models side by side
- LDA topic proportions over time (stacked area)
- Collection growth curve (by `added_date`)

### Entity-level (per-index-item page block)
For an authority record, show its "life in the collection":
- Timeline of mentions (articles by year where subject contains this entity's title)
- Countries bar chart (from `index.countries`)
- Co-mentioned entities (requires join: parse `subject` field in articles, find co-occurrences)
- Top newspapers that covered this entity
- Related entities (from `Relation` / `Partie de` / `A une partie` fields)

### Article-level (per-article page block)
- Sentiment panel: 3-model comparison (centrality, polarity, subjectivity bars)
- LDA topic badge
- Readability/word-count mini-stats
- Entities mentioned (parse `subject`, link to authority pages)
- Semantic neighbors (top-N closest articles by embedding cosine — needs precomputed kNN)

### Publication-level (per-publication page block)
- Table of contents preview + TOC semantic search (embeddings)
- Per-issue timeline if part of a series

## Pre-aggregation strategy (proposed)

Rather than having JS parse parquet at runtime (bad: size, browser can't read parquet directly), use a **Python precompute script** that:

1. Calls `load_dataset()` for each subset
2. Builds aggregated JSON files under `asset/data/`:
   - `asset/data/collection-overview.json` — site-wide aggregates (maybe 50KB)
   - `asset/data/entity-dashboards/{o_id}.json` — per-`index` item, ~5,000 files
   - `asset/data/article-dashboards/{o_id}.json` — per-`article` item, ~12,000 files (only if worth it — might not be)
   - `asset/data/sentiment-timeseries.json` — pre-aggregated sentiment by year × country × model
3. Script is idempotent — skips unchanged rows via hash / mtime
4. Runs on demand (`python3 scripts/precompute.py`), not at page-load
5. Output committed to git OR generated in deploy step (tbd — 5000 JSONs might be too much for git)

Alternative: write a **single sharded JSON** (e.g., `entities.json` keyed by `o:id`) that JS fetches once and indexes client-side. Good if total size < ~5 MB.

## Confirmed facts

- **HF `o:id` = Omeka item ID on https://islam.zmo.de** → precomputed per-item JSON can be keyed directly by `o:id`, and the existing PHTMLs' `data-item-id="<?= $resource->id() ?>"` wiring needs no translation layer.
- **HF dataset update cadence**: roughly monthly, manual → precompute is a developer-run script, not a scheduled/CI job.
- **Precompute reference**: model new generators on the existing `scripts/generate_*.py` here. (The `iwac-dashboard` project that originally seeded them is deprecated — see below.)

## Provenance: iwac-dashboard (deprecated)

`iwac-dashboard` was a sibling SvelteKit dashboard (static prerender) that read the same HF dataset; the generators and `iwac_utils.py` here were originally ported from it. **It is now deprecated** — this module's `scripts/` is self-contained and the source of truth, with no cross-repo sync constraint. The table below is retained only as historical context for where reusable aggregation patterns came from, not as a live dependency.

Relevant files in that project:

| File | Lines | What it gives us |
|---|---:|---|
| `scripts/iwac_utils.py` | 598 | Original seed for `normalize_country`, `extract_year`, `parse_pipe_separated`, `parse_coordinates`, `load_dataset_safe`, `save_json`, `configure_logging`, `DATASET_ID`, `SUBSETS`; the module's current `scripts/iwac_utils.py` is now canonical. |
| `scripts/generate_overview_stats.py` | 531 | Top-level collection aggregates — direct model for `collection-overview.json` |
| `scripts/generate_index_entities.py` | 278 | Per-entity aggregation from the `index` subset — direct model for per-entity dashboards |
| `scripts/generate_timeline.py` | 377 | Year bucketing for articles, stacked by country |
| `scripts/generate_cooccurrence.py` | 569 | Subject/entity co-occurrence (parses pipe-separated `subject` field) |
| `scripts/generate_treemap.py`, `generate_wordcloud.py`, `generate_world_map.py`, etc. | | Chart-specific generators — mine for focused aggregation patterns only |

`KnowledgeGraph` and `TopicNetwork` are intentionally not ported into `IwacVisualizations`: do not add their generators, routes, UI, data contracts, i18n strings, or Svelte/Sigma/Graphology dependency chain.

The output shape differs: iwac-dashboard wrote **global** JSON files consumed by SvelteKit routes, while this module uses a mix of collection-level page-block bundles and per-item JSON keyed by `o:id` for resource-page blocks. The loading, cleaning, and aggregation primitives are reusable, but the module-side contracts are authoritative.

Dependencies (from iwac-dashboard/scripts/requirements.txt): `datasets`, `pandas`, `pyarrow`, `huggingface-hub`, etc.

## Historical open questions

These are retained only as early-design provenance; they are no longer active roadmap items.

1. **Resource templates**: Resolved in the module block/resource-page wiring and README status table.
2. **Subject → index join**: Resolved by the current generator-specific exact-match and normalization patterns.
3. **v1 priority**: Superseded — collection overview, per-entity, per-person, per-article, publication, and item-set dashboards are live.
4. **Hosting**: Resolved — committed `asset/data/` bundles and fan-outs are the deployed contract.
5. **audiovisual (45) / documents (26)**: Resolved — lightweight minimal-item dashboards plus collection-level stats.
