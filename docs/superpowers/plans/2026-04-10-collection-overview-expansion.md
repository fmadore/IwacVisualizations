# Collection Overview Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the IwacVisualizations `CollectionOverview` block with refreshed summary cards, a reusable recent-additions table, faceted language pie, newspaper Gantt, collection-growth chart, items-by-type-over-time, entities pagination+truncation, French word cloud, and a MapLibre world map — while fixing the existing treemap crash.

**Architecture:** Hybrid extraction (Approach C from the spec). Keep `collection-overview.js` as a thin orchestrator; extract each new/complex panel into its own IIFE module under `asset/js/charts/collection-overview/`; add three shared primitives (`table.js`, `facet-buttons.js`, `pagination.js`) under `asset/js/charts/shared/`; extend `chart-options.js` with new ECharts builders; port two Python generators from `iwac-dashboard/scripts/`.

**Tech Stack:** PHP (Omeka S block), vanilla JS (IIFE modules, no bundler), ECharts 6 + echarts-wordcloud 2 + MapLibre GL 5 (all via CDN, already enqueued in `Module.php`), Python 3 (`datasets`, `pandas`) for aggregation scripts. No existing test infrastructure — verification is manual (run Python scripts, inspect JSON, open block in browser).

**Spec reference:** `docs/superpowers/specs/2026-04-10-collection-overview-expansion-design.md`

**Verification philosophy:** This module has no automated tests. Each task's verification is either (a) run a Python script and inspect the JSON output, (b) load the block in a browser and verify visual behavior, or (c) grep for expected strings/symbols. Commit after each task that passes verification.

---

## File map

**New files:**

```
asset/js/charts/shared/pagination.js
asset/js/charts/shared/table.js
asset/js/charts/shared/facet-buttons.js
asset/js/charts/collection-overview/recent-additions.js
asset/js/charts/collection-overview/entities.js
asset/js/charts/collection-overview/languages.js
asset/js/charts/collection-overview/growth.js
asset/js/charts/collection-overview/types-over-time.js
asset/js/charts/collection-overview/gantt.js
asset/js/charts/collection-overview/wordcloud.js
asset/js/charts/collection-overview/map.js
scripts/generate_wordcloud.py
scripts/generate_world_map.py
asset/data/world_countries_simple.geojson        (copied from iwac-dashboard)
asset/data/collection-wordcloud.json              (generated, not committed manually)
asset/data/collection-map.json                    (generated, not committed manually)
```

**Modified files:**

```
scripts/generate_collection_overview.py           (add new computation functions, extend output)
asset/js/charts/shared/chart-options.js           (add C.gantt/wordcloud/growthBar/stackedBar; fix treemap; extend C.entities)
asset/js/charts/collection-overview.js            (orchestrator rewrite — summary cards list, wire new panels)
asset/css/iwac-visualizations.css                 (table/badge/pagination/facet-buttons classes)
asset/js/iwac-i18n.js                             (new EN+FR translation keys)
view/common/block-layout/collection-overview.phtml (enqueue new scripts)
asset/data/collection-overview.json               (regenerated — not committed by humans)
```

---

## Phase 1 — Data generation (Python)

### Task 1: Extend `generate_collection_overview.py` with new aggregates

**Files:**
- Modify: `scripts/generate_collection_overview.py`

This task extends the existing generator with seven new computation functions and updates `build_overview()` to include them in the JSON output. The existing functions (`compute_timeline`, `compute_country_distribution`, etc.) stay as-is.

- [ ] **Step 1: Add the `compute_summary_extended` helper** — replaces the current `compute_summary` in-place. Open `scripts/generate_collection_overview.py` and find the `compute_summary` function (around line 446). Replace it with:

```python
def compute_summary(
    subset_summaries: Dict[str, Dict[str, int]],
    dataframes: Dict[str, pd.DataFrame],
    timeline: Dict[str, Any],
    country_distribution: List[Dict[str, Any]],
    language_distribution: Any,
    newspapers: Dict[str, Any],
) -> Dict[str, Any]:
    """Top-level counters rendered in the summary cards row.

    The ``publications`` key is intentionally dropped from the summary —
    it was confusing in the UI because the ``publications`` subset contains
    ~1,500 ITEMS from Islamic magazines, not 1,500 distinct publications.
    """
    counts = {s: subset_summaries.get(s, {}).get("total_records", 0) for s in subset_summaries}

    # Total words — articles only (publications/documents rarely have nb_mots)
    articles_df = dataframes.get("articles")
    total_words = 0
    if articles_df is not None and not articles_df.empty and "nb_mots" in articles_df.columns:
        total_words = int(
            pd.to_numeric(articles_df["nb_mots"], errors="coerce").fillna(0).sum()
        )

    # Total pages — tries `nb_pages` first, falls back to None if column absent
    total_pages = 0
    pages_column_found = False
    for subset in ("publications", "documents"):
        df = dataframes.get(subset)
        if df is None or df.empty:
            continue
        if "nb_pages" in df.columns:
            pages_column_found = True
            total_pages += int(pd.to_numeric(df["nb_pages"], errors="coerce").fillna(0).sum())

    # Unique sources — `source` column on articles + audiovisual + publications.
    # References are explicitly excluded per the spec.
    sources: set = set()
    for subset in ("articles", "audiovisual", "publications"):
        df = dataframes.get(subset)
        if df is None or df.empty or "source" not in df.columns:
            continue
        for value in df["source"].dropna():
            for src in parse_pipe_separated(value):
                src = src.strip()
                if src and src.lower() != "unknown":
                    sources.add(src)

    # Document types — distinct values of `o:resource_class` across content subsets
    doc_types: set = set()
    for subset in ("articles", "publications", "documents", "audiovisual"):
        df = dataframes.get(subset)
        if df is None or df.empty or "o:resource_class" not in df.columns:
            continue
        for value in df["o:resource_class"].dropna():
            v = str(value).strip()
            if v and v.lower() != "unknown":
                doc_types.add(v)

    # Audiovisual duration (minutes)
    av_minutes = 0
    av_df = dataframes.get("audiovisual")
    if av_df is not None and not av_df.empty and "duration" in av_df.columns:
        # `duration` may be in seconds, minutes, or HH:MM:SS — try numeric first
        numeric = pd.to_numeric(av_df["duration"], errors="coerce").fillna(0)
        if numeric.sum() > 0:
            # Heuristic: if the median > 500, assume seconds; else minutes
            median = float(numeric[numeric > 0].median()) if (numeric > 0).any() else 0
            if median > 500:
                av_minutes = int(numeric.sum() / 60)
            else:
                av_minutes = int(numeric.sum())

    years = timeline.get("years") or []
    summary: Dict[str, Any] = {
        "articles": counts.get("articles", 0),
        "index_entries": counts.get("index", 0),
        "total_words": int(total_words),
        "unique_sources": len(sources),
        "document_types": len(doc_types),
        "audiovisual_minutes": int(av_minutes),
        "references_count": counts.get("references", 0),
        "newspapers": newspapers.get("total", 0),
        "countries": len(country_distribution),
        "languages": _count_languages(language_distribution),
        "year_min": years[0] if years else None,
        "year_max": years[-1] if years else None,
    }
    if pages_column_found:
        summary["total_pages"] = int(total_pages)
    return summary


def _count_languages(language_distribution: Any) -> int:
    """Count distinct languages from either the old list-of-dicts shape or
    the new dict-with-facets shape (see compute_languages_faceted)."""
    if isinstance(language_distribution, list):
        return len(language_distribution)
    if isinstance(language_distribution, dict):
        return len(language_distribution.get("global", []))
    return 0
```

- [ ] **Step 2: Add `compute_languages_faceted`** — replaces `compute_language_distribution` by returning both the global list AND per-type/per-country breakdowns. Add this function right after the existing `compute_language_distribution`:

```python
def compute_languages_faceted(
    dataframes: Dict[str, pd.DataFrame],
    top_n: int,
) -> Dict[str, Any]:
    """
    Language distribution, faceted three ways:
        {
          "global":     [{"name": "French", "count": 11234}, ...],
          "by_type":    { "article": [...], "publication": [...], ... },
          "by_country": { "Burkina Faso": [...], ... }
        }
    Each list is sorted by count desc, top N.
    """
    global_counter: Counter = Counter()
    by_type: Dict[str, Counter] = defaultdict(Counter)
    by_country: Dict[str, Counter] = defaultdict(Counter)

    subset_to_type = {
        "articles":     "article",
        "publications": "publication",
        "documents":    "document",
        "audiovisual":  "audiovisual",
        "references":   "reference",
    }

    for subset, type_key in subset_to_type.items():
        df = dataframes.get(subset)
        if df is None or df.empty or "language" not in df.columns:
            continue
        country_col = "country" if "country" in df.columns else None

        for idx in range(len(df)):
            langs = parse_pipe_separated(df["language"].iat[idx])
            if not langs:
                continue
            country_val = None
            if country_col is not None:
                raw_country = df[country_col].iat[idx]
                if raw_country is not None and not (isinstance(raw_country, float) and pd.isna(raw_country)):
                    country_val = str(raw_country).strip()
                    if not country_val or country_val.lower() == "unknown":
                        country_val = None

            for lang in langs:
                lang = lang.strip()
                if not lang:
                    continue
                global_counter[lang] += 1
                by_type[type_key][lang] += 1
                if country_val:
                    by_country[country_val][lang] += 1

    def to_sorted_list(counter: Counter) -> List[Dict[str, int]]:
        return [
            {"name": name, "count": int(count)}
            for name, count in counter.most_common(top_n)
        ]

    return {
        "global": to_sorted_list(global_counter),
        "by_type": {k: to_sorted_list(v) for k, v in by_type.items()},
        "by_country": {k: to_sorted_list(v) for k, v in by_country.items()},
    }
```

- [ ] **Step 3: Add `compute_growth`** — monthly additions based on `added_date`. Add after `compute_languages_faceted`:

```python
def compute_growth(
    dataframes: Dict[str, pd.DataFrame],
) -> Dict[str, Any]:
    """
    Monthly additions to the collection, using the `added_date` column
    present on every content subset. The ``index`` subset is excluded —
    authority records are not additions of content.

    Returns:
        {
          "months": ["2020-01", ...],            # YYYY-MM ordered
          "monthly_additions": [45, 67, ...],     # per-month counts
          "cumulative_total": [45, 112, ...]
        }
    """
    monthly: Counter = Counter()
    subsets_for_growth = ["articles", "publications", "documents", "audiovisual", "references"]
    for subset in subsets_for_growth:
        df = dataframes.get(subset)
        if df is None or df.empty or "added_date" not in df.columns:
            continue
        for value in df["added_date"].dropna():
            s = str(value).strip()
            if len(s) >= 7:
                month = s[:7]  # YYYY-MM
                if month[4] == "-":  # basic sanity check
                    monthly[month] += 1

    if not monthly:
        return {"months": [], "monthly_additions": [], "cumulative_total": []}

    months = sorted(monthly.keys())
    additions = [int(monthly[m]) for m in months]
    cumulative: List[int] = []
    running = 0
    for n in additions:
        running += n
        cumulative.append(running)
    return {
        "months": months,
        "monthly_additions": additions,
        "cumulative_total": cumulative,
    }
```

- [ ] **Step 4: Add `compute_types_over_time`** — stacked series by year × item type, with country facets:

```python
def compute_types_over_time(
    dataframes: Dict[str, pd.DataFrame],
    year_min: int,
    year_max: int,
) -> Dict[str, Any]:
    """
    Items per year broken down by item type, faceted globally and per
    country. Used by the "Items by type, over time" stacked bar chart.

    Returns:
        {
          "years": [1980, 1981, ...],
          "types": ["article", "publication", "document", "audiovisual", "reference"],
          "series_global":     { "article": [counts_per_year], ... },
          "series_by_country": { "Burkina Faso": { "article": [...], ... }, ... }
        }
    """
    subset_to_type = {
        "articles":     "article",
        "publications": "publication",
        "documents":    "document",
        "audiovisual":  "audiovisual",
        "references":   "reference",
    }
    types = list(subset_to_type.values())

    # (year, type) -> count (global)
    global_counts: Dict[int, Counter] = defaultdict(Counter)
    # (country, year, type) -> count
    country_counts: Dict[str, Dict[int, Counter]] = defaultdict(lambda: defaultdict(Counter))
    seen_years: set = set()

    for subset, type_key in subset_to_type.items():
        df = dataframes.get(subset)
        if df is None or df.empty:
            continue
        date_col = "pub_date" if "pub_date" in df.columns else None
        if date_col is None:
            continue
        country_col = "country" if "country" in df.columns else None

        for idx in range(len(df)):
            year = extract_year(df[date_col].iat[idx], min_year=year_min, max_year=year_max)
            if year is None:
                continue
            global_counts[year][type_key] += 1
            seen_years.add(year)

            if country_col is not None:
                raw_country = df[country_col].iat[idx]
                if raw_country is not None and not (isinstance(raw_country, float) and pd.isna(raw_country)):
                    country = str(raw_country).strip()
                    if country and country.lower() != "unknown":
                        country_counts[country][year][type_key] += 1

    if not seen_years:
        return {"years": [], "types": types, "series_global": {}, "series_by_country": {}}

    years = sorted(seen_years)

    def series_from(counts_by_year: Dict[int, Counter]) -> Dict[str, List[int]]:
        return {
            t: [int(counts_by_year.get(y, Counter()).get(t, 0)) for y in years]
            for t in types
        }

    return {
        "years": years,
        "types": types,
        "series_global": series_from(global_counts),
        "series_by_country": {
            country: series_from(cts) for country, cts in country_counts.items()
        },
    }
```

- [ ] **Step 5: Add `compute_newspaper_coverage`** — replaces `compute_newspapers` output structure with a Gantt-friendly shape:

```python
def compute_newspaper_coverage(
    dataframes: Dict[str, pd.DataFrame],
    year_min: int,
    year_max: int,
) -> Dict[str, Any]:
    """
    Gantt-ready newspaper coverage: one entry per newspaper with its
    year range, country, type (article | publication), and total item
    count. Empty newspapers and "Unknown" are skipped.

    Returns:
        {
          "coverage": [
            { "name": "Sidwaya", "country": "Burkina Faso", "type": "article",
              "year_min": 1984, "year_max": 2025, "total": 3421 },
            ...
          ]
        }
    """
    # (name, type) -> { years: set, total: int, countries: Counter }
    agg: Dict[tuple, Dict[str, Any]] = {}

    for subset, type_key in (("articles", "article"), ("publications", "publication")):
        df = dataframes.get(subset)
        if df is None or df.empty or "newspaper" not in df.columns:
            continue
        date_col = "pub_date" if "pub_date" in df.columns else None
        country_col = "country" if "country" in df.columns else None

        for idx in range(len(df)):
            raw_name = df["newspaper"].iat[idx]
            if raw_name is None or (isinstance(raw_name, float) and pd.isna(raw_name)):
                continue
            for name in parse_pipe_separated(raw_name):
                name = name.strip()
                if not name or name.lower() == "unknown":
                    continue
                key = (name, type_key)
                entry = agg.setdefault(key, {
                    "years": set(),
                    "total": 0,
                    "countries": Counter(),
                })
                entry["total"] += 1
                if date_col is not None:
                    year = extract_year(df[date_col].iat[idx], min_year=year_min, max_year=year_max)
                    if year is not None:
                        entry["years"].add(year)
                if country_col is not None:
                    raw_country = df[country_col].iat[idx]
                    if raw_country is not None and not (isinstance(raw_country, float) and pd.isna(raw_country)):
                        country = str(raw_country).strip()
                        if country and country.lower() != "unknown":
                            entry["countries"][country] += 1

    coverage: List[Dict[str, Any]] = []
    for (name, type_key), entry in agg.items():
        years = entry["years"]
        if not years:
            continue
        most_common_country = entry["countries"].most_common(1)
        coverage.append({
            "name": name,
            "country": most_common_country[0][0] if most_common_country else None,
            "type": type_key,
            "year_min": min(years),
            "year_max": max(years),
            "total": int(entry["total"]),
        })

    # Sort: by country, then by year_min, then by name — stable visual order
    coverage.sort(key=lambda e: (e["country"] or "", e["year_min"], e["name"]))
    return {"coverage": coverage}
```

- [ ] **Step 6: Add `compute_recent_additions`** — top 100 most recent items across content subsets:

```python
def compute_recent_additions(
    dataframes: Dict[str, pd.DataFrame],
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """
    Latest items added to the collection. Uses ``added_date`` desc.
    Includes articles + publications + documents + audiovisual + references
    (the ``index`` subset is excluded — authority records are not "items"
    in the user-facing sense).

    Each row: { o_id, title, source, type, added_date, thumbnail }
    ``thumbnail`` may be None when the dataset has no value.
    """
    subset_to_type = {
        "articles":     "article",
        "publications": "publication",
        "documents":    "document",
        "audiovisual":  "audiovisual",
        "references":   "reference",
    }
    rows: List[Dict[str, Any]] = []
    for subset, type_key in subset_to_type.items():
        df = dataframes.get(subset)
        if df is None or df.empty:
            continue
        if "added_date" not in df.columns or "o:id" not in df.columns:
            continue
        for idx in range(len(df)):
            added = df["added_date"].iat[idx]
            if added is None or (isinstance(added, float) and pd.isna(added)):
                continue
            added_str = str(added).strip()
            if not added_str:
                continue
            title = ""
            for title_col in ("Titre", "title", "dcterms:title", "identifier"):
                if title_col in df.columns:
                    raw = df[title_col].iat[idx]
                    if raw is not None and not (isinstance(raw, float) and pd.isna(raw)):
                        title = str(raw).strip()
                        if title:
                            break
            source = ""
            for source_col in ("newspaper", "source", "dcterms:publisher"):
                if source_col in df.columns:
                    raw = df[source_col].iat[idx]
                    if raw is not None and not (isinstance(raw, float) and pd.isna(raw)):
                        source = str(raw).strip()
                        if source and source.lower() != "unknown":
                            break
                        source = ""
            thumbnail = None
            if "thumbnail" in df.columns:
                raw = df["thumbnail"].iat[idx]
                if raw is not None and not (isinstance(raw, float) and pd.isna(raw)):
                    t = str(raw).strip()
                    if t:
                        thumbnail = t
            rows.append({
                "o_id": _int_or_none(df["o:id"].iat[idx]),
                "title": title,
                "source": source,
                "type": type_key,
                "added_date": added_str[:10],  # normalize to YYYY-MM-DD
                "thumbnail": thumbnail,
            })

    rows.sort(key=lambda r: r["added_date"], reverse=True)
    return rows[:limit]
```

- [ ] **Step 7: Update `build_overview` to call the new functions and use 50 entities per type** — find `build_overview` (around line 477) and replace its body with:

```python
def build_overview(
    repo_id: str,
    token: Optional[str],
    top_n: int,
    year_min: int,
    year_max: int,
) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Loading IWAC dataset subsets from %s", repo_id)

    dataframes: Dict[str, pd.DataFrame] = {}
    for subset in CONTENT_SUBSETS + ["references", "index"]:
        df = load_dataset_safe(subset, repo_id=repo_id, token=token)
        if df is not None:
            dataframes[subset] = df

    subset_summaries = {
        name: compute_subset_summary(df) for name, df in dataframes.items()
    }

    timeline = compute_timeline(dataframes, year_min=year_min, year_max=year_max)
    country_distribution = compute_country_distribution(dataframes)
    languages = compute_languages_faceted(dataframes, top_n=top_n)
    growth = compute_growth(dataframes)
    types_over_time = compute_types_over_time(dataframes, year_min=year_min, year_max=year_max)
    newspaper_coverage = compute_newspaper_coverage(dataframes, year_min=year_min, year_max=year_max)
    recent = compute_recent_additions(dataframes, limit=100)
    # Keep legacy newspapers structure for the old bar chart fallback + summary count
    newspapers_legacy = compute_newspapers(dataframes, top_n=15, year_min=year_min, year_max=year_max)
    # 50 entities per type (was 10) — enables client-side pagination
    top_entities = compute_top_entities(dataframes.get("index"), top_n=50)
    treemap = compute_treemap(dataframes)
    summary = compute_summary(
        subset_summaries, dataframes, timeline,
        country_distribution, languages, newspapers_legacy,
    )

    metadata = create_metadata_block(
        total_records=summary.get("articles", 0) + summary.get("index_entries", 0),
        data_source=repo_id,
        script="generate_collection_overview.py",
        script_version="0.3.0",
        top_n=top_n,
    )

    return {
        "metadata": metadata,
        "summary": summary,
        "timeline": timeline,
        "growth": growth,
        "types_over_time": types_over_time,
        "countries": country_distribution,
        "languages": languages,
        "newspapers": {
            "coverage": newspaper_coverage["coverage"],
            "total": newspapers_legacy.get("total", 0),  # kept for summary card count
        },
        "top_entities": top_entities,
        "treemap": treemap,
        "recent_additions": recent,
    }
```

- [ ] **Step 8: Run the generator and capture output** — verify no crashes and inspect JSON structure:

```bash
cd /home/fmadore/projects/IwacVisualizations
python3 scripts/generate_collection_overview.py --output asset/data/collection-overview.json
```

Expected: script runs to completion, logs the HF dataset download, writes the JSON. If `source`, `nb_pages`, or `duration` columns are missing from the dataset, the script falls back gracefully (those summary fields are set to 0 or omitted).

- [ ] **Step 9: Verify JSON shape** — run these one-liners to sanity-check:

```bash
python3 -c "import json; d=json.load(open('asset/data/collection-overview.json')); print(sorted(d.keys()))"
```
Expected: `['countries', 'growth', 'languages', 'metadata', 'newspapers', 'recent_additions', 'summary', 'timeline', 'top_entities', 'treemap', 'types_over_time']`

```bash
python3 -c "import json; d=json.load(open('asset/data/collection-overview.json')); print(sorted(d['summary'].keys()))"
```
Expected keys include: `articles`, `audiovisual_minutes`, `countries`, `document_types`, `index_entries`, `languages`, `references_count`, `total_words`, `unique_sources`, `year_max`, `year_min`. May or may not include `total_pages` depending on whether the column exists.

```bash
python3 -c "import json; d=json.load(open('asset/data/collection-overview.json')); print(len(d['recent_additions']), 'recent items'); print(len(d['newspapers']['coverage']), 'newspapers'); print(len(d['top_entities'].get('Personnes', [])), 'persons'); print(len(d['growth']['months']), 'growth months')"
```
Expected: 100 recent items, some number of newspapers (typically 30-80), up to 50 persons, some number of growth months (typically 60-120).

- [ ] **Step 10: Commit**

```bash
git add scripts/generate_collection_overview.py asset/data/collection-overview.json
git -c commit.gpgsign=false commit -m "collection-overview generator: new aggregates (growth, types-over-time, languages facets, newspapers coverage, recent additions, top_entities×50)"
```

---

### Task 2: Port `generate_wordcloud.py` from iwac-dashboard

**Files:**
- Create: `scripts/generate_wordcloud.py`
- Create: `asset/data/collection-wordcloud.json` (generated output)

- [ ] **Step 1: Read the reference script** to understand the tokenization, stopwords, and output shape:

```bash
wc -l /home/fmadore/projects/iwac-dashboard/scripts/generate_wordcloud.py
head -50 /home/fmadore/projects/iwac-dashboard/scripts/generate_wordcloud.py
```

- [ ] **Step 2: Copy and adapt** — create `scripts/generate_wordcloud.py` as a thin adaptation of the dashboard script. The goal is ONE unified output file, not the dashboard's 4-file split. Use this structure:

```python
#!/usr/bin/env python3
"""
generate_wordcloud.py
=====================

Generate ``asset/data/collection-wordcloud.json`` — a single sidecar file
with French word frequencies across all articles, faceted three ways:
global, by country, and by year.

Based on ``iwac-dashboard/scripts/generate_wordcloud.py``, but emits one
unified JSON file instead of four separate ones. Tokenization, stopwords,
and min-frequency filtering are applied server-side so the browser never
has to touch raw OCR text.

Usage
-----
    python3 scripts/generate_wordcloud.py
    python3 scripts/generate_wordcloud.py --min-frequency 10 --max-words 200
"""
from __future__ import annotations

import argparse
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    create_metadata_block,
    extract_year,
    load_dataset_safe,
    save_json,
)

# Basic French stopwords — keep the list compact but cover the biggest
# high-frequency items. Extend here rather than pulling NLTK to avoid a
# runtime dependency.
FR_STOPWORDS = set("""
a à ai ainsi ais ait alors après as au aucun aucune aussi autant autre autres
aux avait avant avec avoir ayant c ça car ce ceci cela celle celles celui
cent cependant certain certaine certaines certains ces cet cette ceux chacun
chaque chez ci comme comment d dans de depuis des du deux dès donc dont doux
du durant e elle elles en encore entre es est et étant été être eu eux
fait faire fois font h hors i il ils j je l la là laquelle le lequel les
lesquelles lesquels leur leurs lui m ma mais me même mes mien mienne miennes
miens moi moins mon n ne ni nos notre nous nouveau nouveaux nouvelle nouvelles
o on ont ou où oui par parce pas peu peut peuvent plus plusieurs plutôt pour
pourquoi puis qu quand que quel quelle quelles quels qui quoi s sa sans
se sera serait seront ses si sien sienne siennes siens soi soient sois soit
sommes son sont sous suis sur t ta tandis tant te tel telle telles tels tes
toi ton tous tout toute toutes très trois tu un une vais vas vers voici voilà
vos votre vous y
comme cette dans plus mais tout pour être avoir faire dire voir savoir pouvoir vouloir devoir
""".split())

# Additional IWAC-specific noise words that survived the generic list
CUSTOM_STOPWORDS = set("""
article journal page pages numero numéro nombre date lieu monsieur madame
selon ainsi cependant effet toutefois outre certes ailleurs notamment
""".split())

STOPWORDS = FR_STOPWORDS | CUSTOM_STOPWORDS

TOKEN_RE = re.compile(r"[a-zàâäéèêëïîôöùûüç]+", re.IGNORECASE)


def tokenize(text: str) -> List[str]:
    """Lowercase, strip punctuation, split on whitespace, drop stopwords
    and short tokens. Accepts non-string input (returns empty list)."""
    if not isinstance(text, str) or not text:
        return []
    return [
        tok for tok in TOKEN_RE.findall(text.lower())
        if len(tok) >= 4 and tok not in STOPWORDS
    ]


def build_wordcloud(
    repo_id: str,
    min_frequency: int,
    max_words_per_facet: int,
    year_min: int,
    year_max: int,
) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Loading articles subset from %s", repo_id)
    df = load_dataset_safe("articles", repo_id=repo_id)
    if df is None or df.empty:
        logger.warning("No articles loaded; returning empty wordcloud")
        return _empty_result(year_min, year_max)

    text_col: Optional[str] = None
    for candidate in ("ocr_text", "OCR_text", "text", "content"):
        if candidate in df.columns:
            text_col = candidate
            break
    if text_col is None:
        logger.warning("No OCR text column found; returning empty wordcloud")
        return _empty_result(year_min, year_max)

    # Optional filter to French only if the language column exists
    if "language" in df.columns:
        lang_series = df["language"].astype(str).str.lower()
        french_mask = lang_series.str.contains("fr", na=False)
        df = df[french_mask]
        logger.info("Filtered to %d French articles", len(df))

    global_counter: Counter = Counter()
    by_country: Dict[str, Counter] = defaultdict(Counter)
    by_year: Dict[str, Counter] = defaultdict(Counter)

    total_articles = 0
    country_article_totals: Counter = Counter()
    year_article_totals: Counter = Counter()

    for idx in range(len(df)):
        text = df[text_col].iat[idx]
        tokens = tokenize(text)
        if not tokens:
            continue
        total_articles += 1
        global_counter.update(tokens)

        country = None
        if "country" in df.columns:
            raw = df["country"].iat[idx]
            if isinstance(raw, str) and raw.strip() and raw.strip().lower() != "unknown":
                country = raw.strip()
        if country:
            by_country[country].update(tokens)
            country_article_totals[country] += 1

        year = None
        if "pub_date" in df.columns:
            year = extract_year(df["pub_date"].iat[idx], min_year=year_min, max_year=year_max)
        if year is not None:
            year_key = str(year)
            by_year[year_key].update(tokens)
            year_article_totals[year_key] += 1

    def flatten(counter: Counter, articles_in_facet: int) -> Dict[str, Any]:
        filtered = [(w, int(c)) for w, c in counter.most_common() if c >= min_frequency]
        return {
            "data": filtered[:max_words_per_facet],
            "total_articles": int(articles_in_facet),
            "unique_words": len(filtered),
        }

    return {
        "global": flatten(global_counter, total_articles),
        "by_country": {
            country: flatten(counter, country_article_totals[country])
            for country, counter in sorted(by_country.items())
        },
        "by_year": {
            year: flatten(counter, year_article_totals[year])
            for year, counter in sorted(by_year.items())
        },
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "language_filter": "French",
            "min_word_length": 4,
            "min_frequency": min_frequency,
            "max_words_per_facet": max_words_per_facet,
            "stopwords_applied": "fr-custom",
            "countries": sorted(by_country.keys()),
            "years": sorted(by_year.keys()),
            "total_articles": total_articles,
        },
    }


def _empty_result(year_min: int, year_max: int) -> Dict[str, Any]:
    return {
        "global": {"data": [], "total_articles": 0, "unique_words": 0},
        "by_country": {},
        "by_year": {},
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "language_filter": "French",
            "countries": [],
            "years": [],
            "total_articles": 0,
        },
    }


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DATASET_ID)
    parser.add_argument("--output", default="asset/data/collection-wordcloud.json")
    parser.add_argument("--min-frequency", type=int, default=5)
    parser.add_argument("--max-words", type=int, default=150)
    parser.add_argument("--year-min", type=int, default=1900)
    parser.add_argument("--year-max", type=int, default=2100)
    args = parser.parse_args()

    result = build_wordcloud(
        repo_id=args.repo,
        min_frequency=args.min_frequency,
        max_words_per_facet=args.max_words,
        year_min=args.year_min,
        year_max=args.year_max,
    )
    save_json(args.output, result)
    logging.getLogger(__name__).info("Wrote %s", args.output)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the generator**:

```bash
cd /home/fmadore/projects/IwacVisualizations
python3 scripts/generate_wordcloud.py --output asset/data/collection-wordcloud.json
```

Expected: script runs (may take 1-3 minutes for tokenization of ~12k articles), writes the JSON.

- [ ] **Step 4: Verify JSON shape**:

```bash
python3 -c "import json; d=json.load(open('asset/data/collection-wordcloud.json')); print('global top 5:', d['global']['data'][:5]); print('countries:', sorted(d['by_country'].keys())); print('years count:', len(d['by_year']))"
```
Expected: top 5 French content words, 6 countries, some number of years. File size should be < 500 KB.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate_wordcloud.py asset/data/collection-wordcloud.json
git -c commit.gpgsign=false commit -m "Add wordcloud generator (French, global/by-country/by-year facets)"
```

---

### Task 3: Port `generate_world_map.py` and copy the GeoJSON

**Files:**
- Create: `scripts/generate_world_map.py`
- Create: `asset/data/collection-map.json` (generated)
- Create: `asset/data/world_countries_simple.geojson` (copied static asset)

- [ ] **Step 1: Copy the GeoJSON** — it's a static asset that never changes:

```bash
cp /home/fmadore/projects/iwac-dashboard/static/data/world_countries_simple.geojson \
   /home/fmadore/projects/IwacVisualizations/asset/data/world_countries_simple.geojson
```

- [ ] **Step 2: Verify the GeoJSON copied correctly**:

```bash
python3 -c "import json; d=json.load(open('asset/data/world_countries_simple.geojson')); print(d['type'], len(d['features']), 'features')"
```
Expected: `FeatureCollection <N> features` where N is the number of countries.

- [ ] **Step 3: Create the map generator**:

```python
#!/usr/bin/env python3
"""
generate_world_map.py
======================

Generate ``asset/data/collection-map.json`` — unified sidecar with place
markers (lat/lng from index subset where Type == 'Lieux') plus per-country
totals faceted by item type.

Usage
-----
    python3 scripts/generate_world_map.py
"""
from __future__ import annotations

import argparse
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

COORD_RE = re.compile(r"(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)")


def parse_coordinates(raw: Any) -> Optional[Tuple[float, float]]:
    """Parse a "lat,lng" or "lat lng" string into (lat, lng). Returns
    None if the value is missing or malformed."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    if isinstance(raw, (tuple, list)) and len(raw) == 2:
        try:
            return float(raw[0]), float(raw[1])
        except (TypeError, ValueError):
            return None
    s = str(raw).strip()
    if not s:
        return None
    m = COORD_RE.search(s)
    if not m:
        return None
    try:
        lat = float(m.group(1))
        lng = float(m.group(2))
    except ValueError:
        return None
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return None
    return lat, lng


def build_map(repo_id: str) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)

    # Locations from the index subset, filtered to Type == "Lieux"
    index_df = load_dataset_safe("index", repo_id=repo_id)
    locations: List[Dict[str, Any]] = []
    if index_df is not None and not index_df.empty and "Type" in index_df.columns:
        lieux = index_df[index_df["Type"] == "Lieux"]
        for idx in range(len(lieux)):
            title = str(lieux["Titre"].iat[idx] or "").strip() if "Titre" in lieux.columns else ""
            if not title:
                continue
            coord_raw = lieux["Coordonn\u00e9es"].iat[idx] if "Coordonn\u00e9es" in lieux.columns else None
            if coord_raw is None and "Coordonnees" in lieux.columns:
                coord_raw = lieux["Coordonnees"].iat[idx]
            coords = parse_coordinates(coord_raw)
            if coords is None:
                continue
            count_raw = lieux["frequency"].iat[idx] if "frequency" in lieux.columns else 0
            try:
                count = int(float(count_raw)) if count_raw is not None else 0
            except (TypeError, ValueError):
                count = 0
            if count <= 0:
                continue
            countries = parse_pipe_separated(
                lieux["countries"].iat[idx] if "countries" in lieux.columns else ""
            )
            country = countries[0] if countries else None
            locations.append({
                "name": title,
                "country": country,
                "lat": coords[0],
                "lng": coords[1],
                "count": count,
            })

    # Country totals from content subsets, broken down by type
    subset_to_type = {
        "articles":     "article",
        "publications": "publication",
        "documents":    "document",
        "audiovisual":  "audiovisual",
        "references":   "reference",
    }
    country_totals: Dict[str, Counter] = defaultdict(Counter)
    for subset, type_key in subset_to_type.items():
        df = load_dataset_safe(subset, repo_id=repo_id)
        if df is None or df.empty or "country" not in df.columns:
            continue
        for value in df["country"]:
            for country in parse_pipe_separated(value):
                country = country.strip()
                if country and country.lower() != "unknown":
                    country_totals[country][type_key] += 1
                    country_totals[country]["total"] += 1

    country_counts = {
        country: {
            "total": int(counter["total"]),
            "by_type": {k: int(v) for k, v in counter.items() if k != "total"},
        }
        for country, counter in sorted(country_totals.items())
    }

    logger.info("Built map with %d locations across %d countries",
                len(locations), len(country_counts))

    return {
        "locations": locations,
        "country_counts": country_counts,
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "index subset where Type == 'Lieux', filtered to valid coordinates",
            "total_locations": len(locations),
            "total_countries": len(country_counts),
        },
    }


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DATASET_ID)
    parser.add_argument("--output", default="asset/data/collection-map.json")
    args = parser.parse_args()

    result = build_map(repo_id=args.repo)
    save_json(args.output, result)
    logging.getLogger(__name__).info("Wrote %s", args.output)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run and verify**:

```bash
cd /home/fmadore/projects/IwacVisualizations
python3 scripts/generate_world_map.py --output asset/data/collection-map.json
python3 -c "import json; d=json.load(open('asset/data/collection-map.json')); print(len(d['locations']), 'locations,', len(d['country_counts']), 'countries')"
```
Expected: some number of locations (likely 100-500), 6 countries.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate_world_map.py asset/data/world_countries_simple.geojson asset/data/collection-map.json
git -c commit.gpgsign=false commit -m "Add world map generator + country GeoJSON sidecar"
```

---

## Phase 2 — Shared primitives (JS)

### Task 4: Create `shared/pagination.js`

**Files:**
- Create: `asset/js/charts/shared/pagination.js`

- [ ] **Step 1: Write the file** — complete content:

```javascript
/**
 * IWAC Visualizations — Shared pagination control
 *
 * A minimal, accessible "‹ Prev | Page N / M | Next ›" widget used by
 * the reusable table (table.js) and by any panel that needs client-side
 * paging (e.g. entities panel).
 *
 * Everything hangs off `window.IWACVis.panels` as `P.buildPagination`.
 *
 * Load order: after panels.js, before any block controller / panel
 * module that uses it.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.pagination: panels.js must load first');
        return;
    }

    /**
     * Build a pagination control.
     *
     * @param {Object} config
     * @param {number} config.currentPage  Zero-based current page index
     * @param {number} config.totalPages   Total page count (>= 1)
     * @param {function(number)} config.onChange  Called with new page index
     * @param {Object} [config.labels]
     * @param {string} [config.labels.prev] default: P.t('Previous')
     * @param {string} [config.labels.next] default: P.t('Next')
     * @param {string} [config.labels.page] default: P.t('Page')
     * @returns {{ root: HTMLElement, update: function({currentPage:number,totalPages:number}) }}
     */
    P.buildPagination = function (config) {
        var labels = config.labels || {};
        var prevLabel = labels.prev || P.t('Previous');
        var nextLabel = labels.next || P.t('Next');
        var pageLabel = labels.page || P.t('Page');

        var state = {
            currentPage: config.currentPage || 0,
            totalPages: Math.max(1, config.totalPages || 1)
        };

        var root = P.el('div', 'iwac-vis-pagination');

        var prevBtn = P.el('button', 'iwac-vis-pagination__btn iwac-vis-pagination__btn--prev', prevLabel);
        prevBtn.type = 'button';
        prevBtn.setAttribute('aria-label', prevLabel);

        var indicator = P.el('span', 'iwac-vis-pagination__indicator');
        indicator.setAttribute('aria-live', 'polite');

        var nextBtn = P.el('button', 'iwac-vis-pagination__btn iwac-vis-pagination__btn--next', nextLabel);
        nextBtn.type = 'button';
        nextBtn.setAttribute('aria-label', nextLabel);

        root.appendChild(prevBtn);
        root.appendChild(indicator);
        root.appendChild(nextBtn);

        function renderIndicator() {
            indicator.textContent = pageLabel + ' ' + (state.currentPage + 1) + ' / ' + state.totalPages;
            prevBtn.disabled = state.currentPage <= 0;
            nextBtn.disabled = state.currentPage >= state.totalPages - 1;
            root.style.display = state.totalPages <= 1 ? 'none' : '';
        }

        function go(delta) {
            var next = state.currentPage + delta;
            if (next < 0 || next >= state.totalPages) return;
            state.currentPage = next;
            renderIndicator();
            if (typeof config.onChange === 'function') {
                config.onChange(state.currentPage);
            }
        }

        prevBtn.addEventListener('click', function () { go(-1); });
        nextBtn.addEventListener('click', function () { go(1); });

        renderIndicator();

        return {
            root: root,
            update: function (next) {
                if (next && typeof next.currentPage === 'number') {
                    state.currentPage = next.currentPage;
                }
                if (next && typeof next.totalPages === 'number') {
                    state.totalPages = Math.max(1, next.totalPages);
                    if (state.currentPage >= state.totalPages) {
                        state.currentPage = state.totalPages - 1;
                    }
                }
                renderIndicator();
            }
        };
    };
})();
```

- [ ] **Step 2: Verify the file parses** (no syntax errors):

```bash
node -e "require('fs').readFileSync('asset/js/charts/shared/pagination.js', 'utf8'); console.log('OK');"
```
Expected: `OK` (Node happily reads the file; no JS execution).

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/shared/pagination.js
git -c commit.gpgsign=false commit -m "Add shared pagination primitive (P.buildPagination)"
```

---

### Task 5: Create `shared/table.js`

**Files:**
- Create: `asset/js/charts/shared/table.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Shared reusable table
 *
 * Accessible HTML table with optional client-side pagination. Designed
 * for small-to-medium datasets rendered entirely in the DOM (no
 * virtualization).
 *
 * Supported column render modes:
 *   'text'        — escaped raw value (default)
 *   'link'        — <a href={row[linkKey]}> wrapped value
 *   'date'        — parse ISO → toLocaleDateString(IWACVis.locale)
 *   'badge'       — styled pill with i18n key lookup {i18nPrefix}{value}
 *   'thumbnail'   — lazy <img> with fallback placeholder
 *   'number'      — P.formatNumber()
 *
 * Exposed as `P.buildTable(config)`.
 *
 * Load order: after panels.js + pagination.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildPagination) {
        console.warn('IWACVis.table: panels.js + pagination.js must load first');
        return;
    }

    var esc = P.escapeHtml;

    function formatDate(value) {
        if (!value) return '';
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        try {
            return d.toLocaleDateString(
                ns.locale === 'fr' ? 'fr-FR' : 'en-US',
                { year: 'numeric', month: 'short', day: 'numeric' }
            );
        } catch (e) {
            return d.toISOString().slice(0, 10);
        }
    }

    function renderCell(col, row) {
        var value = row[col.key];
        var td = P.el('td', 'iwac-vis-table__cell iwac-vis-table__cell--' + (col.render || 'text'));
        if (col.width) td.style.width = col.width;

        var mode = col.render || 'text';

        if (mode === 'thumbnail') {
            if (value) {
                var img = document.createElement('img');
                img.className = 'iwac-vis-table__thumb';
                img.src = String(value);
                img.alt = '';
                img.loading = 'lazy';
                img.addEventListener('error', function () {
                    img.replaceWith(buildThumbPlaceholder());
                });
                td.appendChild(img);
            } else {
                td.appendChild(buildThumbPlaceholder());
            }
            return td;
        }

        if (value == null || value === '') {
            td.textContent = '';
            return td;
        }

        if (mode === 'link') {
            var href = row[col.linkKey || 'url'];
            if (href) {
                var a = document.createElement('a');
                a.className = 'iwac-vis-table__link';
                a.href = String(href);
                a.textContent = String(value);
                td.appendChild(a);
            } else {
                td.textContent = String(value);
            }
            return td;
        }

        if (mode === 'date') {
            td.textContent = formatDate(value);
            return td;
        }

        if (mode === 'badge') {
            var key = (col.i18nPrefix || '') + String(value);
            var label = P.t(key);
            var badge = P.el('span',
                'iwac-vis-badge iwac-vis-badge--' + String(value).toLowerCase(),
                label === key ? String(value) : label);
            td.appendChild(badge);
            return td;
        }

        if (mode === 'number') {
            td.textContent = P.formatNumber(Number(value));
            return td;
        }

        td.textContent = String(value);
        return td;
    }

    function buildThumbPlaceholder() {
        var div = P.el('div', 'iwac-vis-thumb-placeholder');
        div.setAttribute('aria-hidden', 'true');
        div.innerHTML =
            '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"' +
            ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
            '<path d="M14 2v6h6"/></svg>';
        return div;
    }

    /**
     * Build a table.
     *
     * @param {Object} config
     * @param {Array<Object>} config.columns
     *   Each: { key, label, render?, linkKey?, i18nPrefix?, width? }
     * @param {Array<Object>} config.rows
     * @param {number} [config.pageSize]  Enables pagination when > 0
     * @param {number} [config.currentPage=0]
     * @param {string} [config.emptyMessage]
     * @param {string} [config.className]   Extra class for the wrapper
     * @returns {{ root: HTMLElement, update: function(Array<Object>, number=) }}
     */
    P.buildTable = function (config) {
        var columns = config.columns || [];
        var rows = config.rows || [];
        var pageSize = config.pageSize || 0;
        var currentPage = config.currentPage || 0;
        var emptyMessage = config.emptyMessage || P.t('No data available');

        var wrapper = P.el('div', 'iwac-vis-table-wrapper' +
            (config.className ? ' ' + config.className : ''));

        var tableEl = P.el('table', 'iwac-vis-table');
        var thead = P.el('thead');
        var headerRow = P.el('tr');
        columns.forEach(function (col) {
            var th = P.el('th', 'iwac-vis-table__header', col.label || '');
            if (col.width) th.style.width = col.width;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        tableEl.appendChild(thead);

        var tbody = P.el('tbody');
        tableEl.appendChild(tbody);
        wrapper.appendChild(tableEl);

        var emptyEl = P.el('div', 'iwac-vis-empty', emptyMessage);
        emptyEl.style.display = 'none';
        wrapper.appendChild(emptyEl);

        var pagination = null;
        if (pageSize > 0) {
            pagination = P.buildPagination({
                currentPage: currentPage,
                totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
                onChange: function (newPage) {
                    currentPage = newPage;
                    renderBody();
                }
            });
            wrapper.appendChild(pagination.root);
        }

        function renderBody() {
            tbody.innerHTML = '';
            if (!rows || rows.length === 0) {
                tableEl.style.display = 'none';
                emptyEl.style.display = '';
                if (pagination) pagination.root.style.display = 'none';
                return;
            }
            tableEl.style.display = '';
            emptyEl.style.display = 'none';

            var startIdx = pageSize > 0 ? currentPage * pageSize : 0;
            var endIdx = pageSize > 0 ? startIdx + pageSize : rows.length;
            var pageRows = rows.slice(startIdx, endIdx);

            pageRows.forEach(function (row) {
                var tr = P.el('tr', 'iwac-vis-table__row');
                columns.forEach(function (col) {
                    tr.appendChild(renderCell(col, row));
                });
                tbody.appendChild(tr);
            });

            if (pagination) {
                pagination.update({
                    currentPage: currentPage,
                    totalPages: Math.max(1, Math.ceil(rows.length / pageSize))
                });
            }
        }

        renderBody();

        return {
            root: wrapper,
            update: function (newRows, newPage) {
                rows = newRows || [];
                if (typeof newPage === 'number') {
                    currentPage = newPage;
                } else if (pageSize > 0 && currentPage * pageSize >= rows.length) {
                    currentPage = 0;
                }
                renderBody();
            }
        };
    };
})();
```

- [ ] **Step 2: Verify the file parses**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/shared/table.js', 'utf8'); console.log('OK');"
```

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/shared/table.js
git -c commit.gpgsign=false commit -m "Add shared reusable table primitive (P.buildTable)"
```

---

### Task 6: Create `shared/facet-buttons.js`

**Files:**
- Create: `asset/js/charts/shared/facet-buttons.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Shared facet button group
 *
 * Generic facet switcher with optional sub-facets (second dimension).
 * Sub-facets render as buttons (<= 5 keys) or <select> (> 5) by
 * default, overridable per-facet via `renderAs`.
 *
 * Exposed as `P.buildFacetButtons(config)`.
 *
 * Load order: after panels.js.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.facet-buttons: panels.js must load first');
        return;
    }

    /**
     * @param {Object} config
     * @param {Array<Object>} config.facets
     *   Each: { key, label, subFacets?, renderAs? }
     *   - subFacets is an object { subKey: subLabel }
     *   - renderAs is 'buttons' | 'select'; default auto by count
     * @param {string} config.activeKey
     * @param {function({facet:string,subFacet:?string})} config.onChange
     * @returns {{ root: HTMLElement, setActive: function(string, string=) }}
     */
    P.buildFacetButtons = function (config) {
        var facets = config.facets || [];
        var activeKey = config.activeKey || (facets[0] && facets[0].key);
        var activeSubKey = null;
        var subPickerContainer = null;

        var root = P.el('div', 'iwac-vis-facets');

        var mainBar = P.el('div', 'iwac-vis-facets__main');
        root.appendChild(mainBar);

        var subBar = P.el('div', 'iwac-vis-facets__sub');
        subBar.style.display = 'none';
        root.appendChild(subBar);

        var mainButtons = {};
        facets.forEach(function (f) {
            var btn = P.el('button', 'iwac-vis-facets__btn', f.label);
            btn.type = 'button';
            btn.dataset.facetKey = f.key;
            btn.addEventListener('click', function () {
                setActive(f.key);
            });
            mainButtons[f.key] = btn;
            mainBar.appendChild(btn);
        });

        function findFacet(key) {
            for (var i = 0; i < facets.length; i++) {
                if (facets[i].key === key) return facets[i];
            }
            return null;
        }

        function clearSubBar() {
            subBar.innerHTML = '';
            subBar.style.display = 'none';
            subPickerContainer = null;
        }

        function renderSubFacets(facet) {
            clearSubBar();
            var subFacets = facet.subFacets;
            if (!subFacets) return;
            var keys = Object.keys(subFacets);
            if (keys.length === 0) return;

            var mode = facet.renderAs;
            if (!mode) {
                mode = keys.length <= 5 ? 'buttons' : 'select';
            }

            subBar.style.display = '';

            if (mode === 'buttons') {
                var subButtons = {};
                keys.forEach(function (k) {
                    var btn = P.el('button', 'iwac-vis-facets__sub-btn', subFacets[k]);
                    btn.type = 'button';
                    btn.dataset.subKey = k;
                    btn.addEventListener('click', function () {
                        activeSubKey = k;
                        Object.keys(subButtons).forEach(function (sk) {
                            subButtons[sk].classList.toggle(
                                'iwac-vis-facets__sub-btn--active', sk === k);
                        });
                        fire();
                    });
                    subButtons[k] = btn;
                    subBar.appendChild(btn);
                });
                // auto-pick first
                activeSubKey = keys[0];
                subButtons[activeSubKey].classList.add('iwac-vis-facets__sub-btn--active');
                return;
            }

            // mode === 'select'
            var select = P.el('select', 'iwac-vis-facets__select');
            keys.forEach(function (k) {
                var opt = P.el('option', null, subFacets[k]);
                opt.value = k;
                select.appendChild(opt);
            });
            select.addEventListener('change', function () {
                activeSubKey = select.value;
                fire();
            });
            activeSubKey = keys[0];
            select.value = activeSubKey;
            subPickerContainer = select;
            subBar.appendChild(select);
        }

        function highlightMain() {
            Object.keys(mainButtons).forEach(function (k) {
                mainButtons[k].classList.toggle(
                    'iwac-vis-facets__btn--active', k === activeKey);
            });
        }

        function fire() {
            if (typeof config.onChange === 'function') {
                config.onChange({ facet: activeKey, subFacet: activeSubKey });
            }
        }

        function setActive(key, subKey) {
            var facet = findFacet(key);
            if (!facet) return;
            activeKey = key;
            activeSubKey = null;
            highlightMain();
            renderSubFacets(facet);
            if (subKey && facet.subFacets && facet.subFacets[subKey]) {
                activeSubKey = subKey;
                if (subPickerContainer) subPickerContainer.value = subKey;
            }
            fire();
        }

        // Initial render — but DO NOT fire onChange yet to avoid double-render
        // on the caller's first setOption call.
        (function initial() {
            var facet = findFacet(activeKey);
            if (!facet) return;
            highlightMain();
            if (facet.subFacets) {
                renderSubFacets(facet);
            }
        })();

        return {
            root: root,
            setActive: setActive
        };
    };
})();
```

- [ ] **Step 2: Verify the file parses**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/shared/facet-buttons.js', 'utf8'); console.log('OK');"
```

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/shared/facet-buttons.js
git -c commit.gpgsign=false commit -m "Add shared facet buttons primitive (P.buildFacetButtons)"
```

---

### Task 7: Extend `chart-options.js` — new builders + treemap fix + entities truncation

**Files:**
- Modify: `asset/js/charts/shared/chart-options.js`

- [ ] **Step 1: Add `maxLabelLength` support to `C.entities`** — find the `C.entities` function (around line 271) and replace it with:

```javascript
    /**
     * Horizontal bar for top-N entities. Each data point carries an
     * `o_id` so the controller can wire click → Omeka item page.
     *
     * @param {Array<Object>} entries
     *   Each: { title, frequency, o_id?, countries?, first_occurrence?, last_occurrence? }
     * @param {Object} [opts]
     * @param {number} [opts.maxLabelLength=30]  Middle-ellipsis cutoff
     */
    C.entities = function (entries, opts) {
        opts = opts || {};
        var maxLen = opts.maxLabelLength || 30;
        var list = entries || [];
        var names = list.map(function (e) { return e.title; });
        var values = list.map(function (e) {
            return { value: e.frequency, o_id: e.o_id };
        });

        function truncate(name) {
            if (!name || name.length <= maxLen) return name || '';
            var head = Math.floor((maxLen - 1) / 2);
            var tail = maxLen - 1 - head;
            return name.slice(0, head) + '\u2026' + name.slice(-tail);
        }

        return {
            grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    var entry = list[p.dataIndex] || {};
                    var lines = [
                        '<strong>' + esc(entry.title || '') + '</strong>',
                        t('mentions_count', { count: fmt(entry.frequency || 0) })
                    ];
                    if (entry.first_occurrence || entry.last_occurrence) {
                        lines.push(
                            (entry.first_occurrence || '?') + ' \u2013 ' + (entry.last_occurrence || '?')
                        );
                    }
                    if (entry.countries && entry.countries.length) {
                        lines.push(entry.countries.join(', '));
                    }
                    return lines.join('<br>');
                }
            },
            xAxis: { type: 'value' },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false },
                axisLabel: {
                    width: 220,
                    overflow: 'truncate',
                    formatter: truncate
                }
            },
            series: [
                {
                    type: 'bar',
                    data: values,
                    barMaxWidth: 20,
                    label: {
                        show: true,
                        position: 'right',
                        formatter: function (p) { return fmt(p.value); }
                    },
                    cursor: 'pointer'
                }
            ]
        };
    };
```

- [ ] **Step 2: Harden `C.treemap`** — find the `C.treemap` function (around line 335) and replace it with the sanitized version:

```javascript
    /**
     * Hierarchical treemap with defensive sanitization. ECharts 6 crashes
     * (`Cannot set properties of undefined (setting '2')`) when:
     *   - levels[] is shorter than the actual tree depth
     *   - non-leaf nodes carry `children: []`
     *   - parents are missing `value`
     *
     * We sanitize the tree and compute `levels` dynamically to match
     * whatever depth the data has.
     *
     * @param {Object} tree { name, children: [...] }
     * @param {Object} [opts]
     * @param {string} [opts.rootName]
     */
    C.treemap = function (tree, opts) {
        opts = opts || {};

        function sanitize(node, depth, depthRef) {
            if (!node || typeof node !== 'object') return null;
            depthRef.max = Math.max(depthRef.max, depth);
            var out = { name: node.name || '' };
            var kids = node.children;
            if (Array.isArray(kids) && kids.length > 0) {
                var cleanKids = [];
                var sum = 0;
                for (var i = 0; i < kids.length; i++) {
                    var c = sanitize(kids[i], depth + 1, depthRef);
                    if (c && (c.value == null || c.value > 0 || (c.children && c.children.length))) {
                        cleanKids.push(c);
                        sum += (c.value || 0);
                    }
                }
                if (cleanKids.length > 0) {
                    out.children = cleanKids;
                    out.value = (node.value != null) ? Number(node.value) : sum;
                    return out;
                }
                // kids array was effectively empty → treat as leaf
            }
            if (node.value != null) {
                out.value = Number(node.value);
                return out.value > 0 ? out : null;
            }
            return null;
        }

        function buildLevels(depth) {
            var levels = [];
            for (var i = 0; i <= depth; i++) {
                if (i === 0) {
                    levels.push({ itemStyle: { borderWidth: 0, gapWidth: 3 } });
                } else if (i === 1) {
                    levels.push({ itemStyle: { gapWidth: 2 }, upperLabel: { show: true } });
                } else {
                    levels.push({
                        colorSaturation: [0.35, 0.5],
                        itemStyle: { gapWidth: 1, borderColorSaturation: 0.6 }
                    });
                }
            }
            return levels;
        }

        var depthRef = { max: 0 };
        var sanitized = sanitize(tree || { children: [] }, 0, depthRef);
        var children = (sanitized && sanitized.children) || [];
        var levels = buildLevels(Math.max(1, depthRef.max));

        return {
            tooltip: {
                formatter: function (info) {
                    var path = info.treePathInfo || [];
                    var crumbs = path.slice(1).map(function (p) { return esc(p.name); }).join(' \u203a ');
                    return crumbs + '<br><strong>' + fmt(info.value) + '</strong>';
                }
            },
            series: [
                {
                    type: 'treemap',
                    name: opts.rootName || (tree && tree.name) || 'Root',
                    roam: false,
                    nodeClick: 'zoomToNode',
                    breadcrumb: { show: true, bottom: 4 },
                    label: { show: true, formatter: '{b}' },
                    upperLabel: { show: true, height: 22 },
                    itemStyle: { borderWidth: 1, gapWidth: 2 },
                    levels: levels,
                    data: children
                }
            ]
        };
    };
```

- [ ] **Step 3: Add `C.growthBar`** — append right after `C.treemap`:

```javascript
    /* ----------------------------------------------------------------- */
    /*  Growth bar (monthly additions + cumulative line, dual axis)       */
    /* ----------------------------------------------------------------- */

    /**
     * @param {Object} growth { months: [...], monthly_additions: [...], cumulative_total: [...] }
     */
    C.growthBar = function (growth) {
        var months = growth.months || [];
        var monthly = growth.monthly_additions || [];
        var cumulative = growth.cumulative_total || [];
        var useZoom = months.length > 24;
        return {
            grid: { left: 48, right: 56, top: 48, bottom: useZoom ? 56 : 32, containLabel: true },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: {
                top: 4,
                itemWidth: 12,
                itemHeight: 10,
                data: [t('Monthly additions'), t('Cumulative total')]
            },
            xAxis: {
                type: 'category',
                data: months,
                name: t('Month'),
                nameLocation: 'middle',
                nameGap: useZoom ? 36 : 24
            },
            yAxis: [
                { type: 'value', name: t('Monthly') },
                { type: 'value', name: t('Cumulative'), splitLine: { show: false } }
            ],
            dataZoom: useZoom ? [
                { type: 'slider', start: 60, end: 100, bottom: 8, height: 18 },
                { type: 'inside' }
            ] : [],
            series: [
                {
                    name: t('Monthly additions'),
                    type: 'bar',
                    yAxisIndex: 0,
                    data: monthly,
                    barMaxWidth: 20,
                    emphasis: { focus: 'series' }
                },
                {
                    name: t('Cumulative total'),
                    type: 'line',
                    yAxisIndex: 1,
                    data: cumulative,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 2 }
                }
            ]
        };
    };
```

- [ ] **Step 4: Add `C.stackedBar`** — append right after `C.growthBar`:

```javascript
    /* ----------------------------------------------------------------- */
    /*  Generic stacked bar (category × stack)                            */
    /* ----------------------------------------------------------------- */

    /**
     * Generic stacked bar. Different from `C.timeline` which is specialized
     * for year × country — this one accepts arbitrary category/stack keys
     * and an i18n lookup for series names.
     *
     * @param {Object} d
     * @param {Array<any>} d.categories      x-axis labels
     * @param {Array<string>} d.stackKeys    series keys (stacked)
     * @param {Object<string, Array<number>>} d.series
     * @param {Object} [opts]
     * @param {function(string): string} [opts.labelFor]
     * @param {string} [opts.categoryName]
     * @param {string} [opts.valueName]
     */
    C.stackedBar = function (d, opts) {
        opts = opts || {};
        var categories = d.categories || [];
        var stackKeys = d.stackKeys || [];
        var seriesMap = d.series || {};
        var useZoom = categories.length > 20;

        var series = stackKeys.map(function (k) {
            return {
                name: opts.labelFor ? opts.labelFor(k) : k,
                type: 'bar',
                stack: 'total',
                barMaxWidth: 28,
                emphasis: { focus: 'series' },
                blur: { itemStyle: { opacity: 0.35 } },
                data: seriesMap[k] || []
            };
        });

        return {
            grid: { left: 48, right: 16, top: 48, bottom: useZoom ? 56 : 32, containLabel: true },
            legend: { type: 'scroll', top: 4, itemWidth: 12, itemHeight: 10 },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'category',
                data: categories,
                name: opts.categoryName || '',
                nameLocation: 'middle',
                nameGap: useZoom ? 36 : 24
            },
            yAxis: { type: 'value', name: opts.valueName || t('Count') },
            dataZoom: useZoom ? [
                { type: 'slider', start: 60, end: 100, bottom: 8, height: 18 },
                { type: 'inside' }
            ] : [],
            series: series
        };
    };
```

- [ ] **Step 5: Add `C.gantt`** — append right after `C.stackedBar`:

```javascript
    /* ----------------------------------------------------------------- */
    /*  Gantt (custom series — horizontal bars on a time axis)            */
    /* ----------------------------------------------------------------- */

    /**
     * Newspaper coverage Gantt. Each entry is drawn as a horizontal bar
     * from year_min to year_max on the x-axis, with the y-axis indexing
     * by newspaper name. Filtering by country / type is done by the
     * caller BEFORE invoking this builder.
     *
     * @param {Array<Object>} entries
     *   Each: { name, country, type, year_min, year_max, total }
     * @param {Object} [opts]
     * @param {Object<string, string>} [opts.countryColors]
     */
    C.gantt = function (entries, opts) {
        opts = opts || {};
        var list = (entries || []).slice();
        // Build category array from names
        var names = list.map(function (e) { return e.name; });
        // Each data row: [y_index, start_year, end_year, entry]
        var data = list.map(function (e, i) {
            return {
                value: [i, e.year_min, e.year_max],
                entry: e
            };
        });

        var yearMin = Infinity;
        var yearMax = -Infinity;
        list.forEach(function (e) {
            if (e.year_min != null && e.year_min < yearMin) yearMin = e.year_min;
            if (e.year_max != null && e.year_max > yearMax) yearMax = e.year_max;
        });
        if (!isFinite(yearMin)) yearMin = 1900;
        if (!isFinite(yearMax)) yearMax = new Date().getFullYear();

        var palette = [
            '#d97706', '#059669', '#2563eb', '#9333ea', '#dc2626', '#0891b2',
            '#65a30d', '#ea580c', '#7c3aed', '#0d9488'
        ];
        var countryColorMap = {};
        var colorIdx = 0;
        function colorForCountry(country) {
            if (!country) return palette[0];
            if (opts.countryColors && opts.countryColors[country]) {
                return opts.countryColors[country];
            }
            if (countryColorMap[country] == null) {
                countryColorMap[country] = palette[colorIdx % palette.length];
                colorIdx++;
            }
            return countryColorMap[country];
        }

        function renderItem(params, api) {
            var yIndex = api.value(0);
            var start = api.coord([api.value(1), yIndex]);
            var end = api.coord([api.value(2) + 1, yIndex]);
            var height = api.size([0, 1])[1] * 0.6;
            var width = Math.max(2, end[0] - start[0]);
            var entry = data[params.dataIndex] && data[params.dataIndex].entry;
            var color = colorForCountry(entry && entry.country);
            var rectShape = {
                x: start[0],
                y: start[1] - height / 2,
                width: width,
                height: height
            };
            return {
                type: 'rect',
                shape: rectShape,
                style: { fill: color, stroke: '#00000022' }
            };
        }

        return {
            grid: { left: 8, right: 48, top: 48, bottom: 48, containLabel: true },
            tooltip: {
                formatter: function (p) {
                    var entry = (data[p.dataIndex] || {}).entry || {};
                    var lines = [
                        '<strong>' + esc(entry.name || '') + '</strong>',
                        (entry.year_min || '?') + ' \u2013 ' + (entry.year_max || '?')
                    ];
                    if (entry.country) lines.push(esc(entry.country));
                    if (entry.type)    lines.push(t('item_type_' + entry.type));
                    if (entry.total != null) {
                        lines.push(fmt(entry.total) + ' ' + t('items_count', { count: '' }).trim());
                    }
                    return lines.join('<br>');
                }
            },
            xAxis: {
                type: 'value',
                min: yearMin,
                max: yearMax + 1,
                interval: Math.max(1, Math.ceil((yearMax - yearMin) / 10)),
                axisLabel: { formatter: '{value}' },
                name: t('Year'),
                nameLocation: 'middle',
                nameGap: 28
            },
            yAxis: {
                type: 'category',
                data: names,
                inverse: true,
                axisTick: { show: false },
                axisLabel: {
                    width: 160,
                    overflow: 'truncate'
                }
            },
            dataZoom: list.length > 20 ? [
                { type: 'slider', yAxisIndex: 0, start: 0, end: 100 / Math.max(1, list.length / 20), right: 8 },
                { type: 'inside', yAxisIndex: 0 }
            ] : [],
            series: [{
                type: 'custom',
                renderItem: renderItem,
                encode: { x: [1, 2], y: 0 },
                data: data
            }]
        };
    };
```

- [ ] **Step 6: Add `C.wordcloud`** — append right after `C.gantt`:

```javascript
    /* ----------------------------------------------------------------- */
    /*  Word cloud (requires echarts-wordcloud extension)                 */
    /* ----------------------------------------------------------------- */

    var _wordcloudAvailable = null;

    function isWordCloudAvailable() {
        if (_wordcloudAvailable !== null) return _wordcloudAvailable;
        if (typeof echarts === 'undefined') {
            _wordcloudAvailable = false;
            return false;
        }
        try {
            var probe = document.createElement('div');
            probe.style.width = '40px';
            probe.style.height = '40px';
            probe.style.position = 'absolute';
            probe.style.left = '-9999px';
            document.body.appendChild(probe);
            var tmp = echarts.init(probe);
            tmp.setOption({ series: [{ type: 'wordCloud', data: [{ name: 'a', value: 1 }] }] });
            tmp.dispose();
            document.body.removeChild(probe);
            _wordcloudAvailable = true;
        } catch (e) {
            console.warn('IWACVis.wordcloud: echarts-wordcloud not loaded, falling back', e);
            _wordcloudAvailable = false;
        }
        return _wordcloudAvailable;
    }

    /**
     * @param {Array<[string, number]>} pairs
     * @param {Object} [opts]
     */
    C.wordcloud = function (pairs, opts) {
        opts = opts || {};
        var data = (pairs || []).map(function (pair) {
            return { name: pair[0], value: pair[1] };
        });
        if (!isWordCloudAvailable()) {
            // Fallback: horizontal bar of top 20
            return C.horizontalBar(
                data.slice(0, 20).map(function (d) { return { name: d.name, count: d.value }; }),
                { nameKey: 'name', valueKey: 'count' }
            );
        }
        return {
            tooltip: {
                formatter: function (p) {
                    return '<strong>' + esc(p.name) + '</strong><br>' + fmt(p.value);
                }
            },
            series: [{
                type: 'wordCloud',
                shape: 'rectangle',
                left: 'center',
                top: 'center',
                width: '96%',
                height: '92%',
                right: null,
                bottom: null,
                sizeRange: [12, 58],
                rotationRange: [-30, 30],
                rotationStep: 15,
                gridSize: 8,
                drawOutOfBound: false,
                layoutAnimation: true,
                textStyle: {
                    fontFamily: 'inherit',
                    fontWeight: 'bold'
                },
                data: data
            }]
        };
    };
```

- [ ] **Step 7: Verify the file parses**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/shared/chart-options.js', 'utf8'); console.log('OK');"
```

- [ ] **Step 8: Commit**

```bash
git add asset/js/charts/shared/chart-options.js
git -c commit.gpgsign=false commit -m "chart-options: add gantt/wordcloud/growthBar/stackedBar; fix treemap crash; entities label truncation"
```

---

### Task 8: Extend `iwac-visualizations.css` with new classes

**Files:**
- Modify: `asset/css/iwac-visualizations.css`

- [ ] **Step 1: Append the new classes at the bottom of the file** — open `asset/css/iwac-visualizations.css` and add:

```css
/* =================================================================== */
/*  Reusable table                                                      */
/* =================================================================== */

.iwac-vis-table-wrapper {
    width: 100%;
    overflow-x: auto;
}

.iwac-vis-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm, 0.9rem);
}

.iwac-vis-table__header {
    text-align: left;
    padding: 0.5rem 0.75rem;
    background: var(--surface, #f8f8f8);
    border-bottom: 2px solid var(--border, #e0e0e0);
    font-weight: 600;
    color: var(--ink, #222);
    position: sticky;
    top: 0;
}

.iwac-vis-table__row {
    border-bottom: 1px solid var(--border, #efefef);
    transition: background 0.12s ease;
}

.iwac-vis-table__row:hover {
    background: var(--surface-hover, rgba(0, 0, 0, 0.03));
}

.iwac-vis-table__cell {
    padding: 0.5rem 0.75rem;
    vertical-align: middle;
    color: var(--ink, #222);
}

.iwac-vis-table__cell--thumbnail {
    width: 56px;
    padding: 0.25rem 0.5rem;
}

.iwac-vis-table__thumb {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--radius-sm, 4px);
    display: block;
}

.iwac-vis-thumb-placeholder {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface, #f0f0f0);
    border: 1px dashed var(--border, #d0d0d0);
    border-radius: var(--radius-sm, 4px);
    color: var(--border, #aaa);
}

.iwac-vis-table__link {
    color: var(--primary, #d97706);
    text-decoration: none;
    font-weight: 500;
}

.iwac-vis-table__link:hover {
    text-decoration: underline;
}

/* =================================================================== */
/*  Badges (item type pills used inside tables)                         */
/* =================================================================== */

.iwac-vis-badge {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: var(--text-xs, 0.75rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--surface, #eee);
    color: var(--ink, #333);
    border: 1px solid var(--border, #ddd);
}

.iwac-vis-badge--article     { background: #fef3c7; color: #92400e; border-color: #fde68a; }
.iwac-vis-badge--publication { background: #dbeafe; color: #1e40af; border-color: #bfdbfe; }
.iwac-vis-badge--document    { background: #ede9fe; color: #5b21b6; border-color: #ddd6fe; }
.iwac-vis-badge--audiovisual { background: #fce7f3; color: #9d174d; border-color: #fbcfe8; }
.iwac-vis-badge--reference   { background: #d1fae5; color: #065f46; border-color: #a7f3d0; }

body[data-theme="dark"] .iwac-vis-badge--article     { background: #78350f; color: #fef3c7; border-color: #92400e; }
body[data-theme="dark"] .iwac-vis-badge--publication { background: #1e3a8a; color: #dbeafe; border-color: #1e40af; }
body[data-theme="dark"] .iwac-vis-badge--document    { background: #4c1d95; color: #ede9fe; border-color: #5b21b6; }
body[data-theme="dark"] .iwac-vis-badge--audiovisual { background: #831843; color: #fce7f3; border-color: #9d174d; }
body[data-theme="dark"] .iwac-vis-badge--reference   { background: #064e3b; color: #d1fae5; border-color: #065f46; }

/* =================================================================== */
/*  Pagination control                                                  */
/* =================================================================== */

.iwac-vis-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.75rem 0;
    color: var(--ink, #333);
}

.iwac-vis-pagination__btn {
    padding: 0.35rem 0.9rem;
    background: var(--surface, #fff);
    color: var(--ink, #333);
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    font-size: var(--text-sm, 0.9rem);
    transition: background 0.12s ease, border-color 0.12s ease;
}

.iwac-vis-pagination__btn:hover:not(:disabled) {
    background: var(--surface-hover, #f5f5f5);
    border-color: var(--primary, #d97706);
}

.iwac-vis-pagination__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.iwac-vis-pagination__btn:focus-visible {
    outline: 2px solid var(--primary, #d97706);
    outline-offset: 2px;
}

.iwac-vis-pagination__indicator {
    font-size: var(--text-sm, 0.9rem);
    color: var(--ink-muted, #666);
    min-width: 8ch;
    text-align: center;
}

/* =================================================================== */
/*  Facet buttons                                                       */
/* =================================================================== */

.iwac-vis-facets {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
}

.iwac-vis-facets__main,
.iwac-vis-facets__sub {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
}

.iwac-vis-facets__btn,
.iwac-vis-facets__sub-btn {
    padding: 0.3rem 0.8rem;
    background: var(--surface, #fff);
    color: var(--ink, #333);
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    font-size: var(--text-sm, 0.85rem);
    transition: background 0.12s ease, border-color 0.12s ease;
}

.iwac-vis-facets__btn:hover,
.iwac-vis-facets__sub-btn:hover {
    border-color: var(--primary, #d97706);
}

.iwac-vis-facets__btn--active,
.iwac-vis-facets__sub-btn--active {
    background: var(--primary, #d97706);
    color: #fff;
    border-color: var(--primary, #d97706);
}

.iwac-vis-facets__select {
    padding: 0.3rem 0.6rem;
    background: var(--surface, #fff);
    color: var(--ink, #333);
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 4px);
    font-size: var(--text-sm, 0.85rem);
    max-width: 18rem;
}

/* =================================================================== */
/*  Recent additions wide panel                                         */
/* =================================================================== */

.iwac-vis-recent-additions {
    grid-column: 1 / -1;
    max-height: 480px;
    overflow-y: auto;
    padding: 0;
}

.iwac-vis-recent-additions .iwac-vis-table-wrapper {
    max-height: 100%;
}

/* =================================================================== */
/*  Map panel (MapLibre container)                                      */
/* =================================================================== */

.iwac-vis-map {
    width: 100%;
    height: 480px;
    border-radius: var(--radius-sm, 4px);
    overflow: hidden;
    position: relative;
}

.iwac-vis-map .maplibregl-popup-content {
    font-size: var(--text-sm, 0.85rem);
    padding: 0.75rem 1rem;
    color: #111;
}
```

- [ ] **Step 2: Verify CSS syntax** (no obvious typos):

```bash
grep -c '^}' asset/css/iwac-visualizations.css
```
Expected: a reasonable number (matches approximately the number of opening `{`).

- [ ] **Step 3: Commit**

```bash
git add asset/css/iwac-visualizations.css
git -c commit.gpgsign=false commit -m "CSS: table, badges, pagination, facet buttons, map container"
```

---

### Task 9: Extend `iwac-i18n.js` with new translation keys

**Files:**
- Modify: `asset/js/iwac-i18n.js`

- [ ] **Step 1: Find the English dictionary block** (around line 134, just before the `},` that closes the `en:` object) and insert these keys right before the closing `},`:

```javascript
            // Collection overview v2 — summary cards
            'Index': 'Index',
            'Total words': 'Total words',
            'Total pages': 'Total pages',
            'Scanned pages': 'Scanned pages',
            'Unique sources': 'Unique sources',
            'Document types': 'Document types',
            'Audiovisual minutes': 'Audiovisual minutes',
            'References count': 'References',

            // Collection overview v2 — new chart titles
            'Recent additions': 'Recent additions',
            'Collection growth over time': 'Collection growth over time',
            'Items by type, over time': 'Items by type, over time',
            'French word cloud': 'French word cloud',
            'World map': 'World map',

            // Collection overview v2 — facet controls & misc UI
            'Global': 'Global',
            'By type': 'By type',
            'By country': 'By country',
            'By year': 'By year',
            'All countries': 'All countries',
            'All types': 'All types',
            'Previous': 'Previous',
            'Next': 'Next',
            'Page': 'Page',
            'Title': 'Title',
            'Source': 'Source',
            'Type': 'Type',
            'Added': 'Added',
            'Month': 'Month',
            'Monthly': 'Monthly',
            'Cumulative': 'Cumulative',
            'Monthly additions': 'Monthly additions',
            'Cumulative total': 'Cumulative total',
            'No recent additions': 'No recent additions',

            // Item type badges (used in table + facets + tooltips)
            'item_type_article':     'Article',
            'item_type_publication': 'Publication',
            'item_type_document':    'Document',
            'item_type_audiovisual': 'Audiovisual',
            'item_type_reference':   'Reference',
```

- [ ] **Step 2: Find the French dictionary block** (closing `}` of the `fr:` object) and insert the matching French translations right before it:

```javascript
            // Collection overview v2 — summary cards
            'Index': 'Index',
            'Total words': 'Mots totaux',
            'Total pages': 'Pages totales',
            'Scanned pages': 'Pages num\u00e9ris\u00e9es',
            'Unique sources': 'Sources uniques',
            'Document types': 'Types de documents',
            'Audiovisual minutes': 'Minutes audiovisuelles',
            'References count': 'R\u00e9f\u00e9rences',

            // Collection overview v2 — new chart titles
            'Recent additions': 'Ajouts r\u00e9cents',
            'Collection growth over time': 'Croissance de la collection dans le temps',
            'Items by type, over time': '\u00c9l\u00e9ments par type, dans le temps',
            'French word cloud': 'Nuage de mots fran\u00e7ais',
            'World map': 'Carte du monde',

            // Collection overview v2 — facet controls & misc UI
            'Global': 'Global',
            'By type': 'Par type',
            'By country': 'Par pays',
            'By year': 'Par ann\u00e9e',
            'All countries': 'Tous les pays',
            'All types': 'Tous les types',
            'Previous': 'Pr\u00e9c\u00e9dent',
            'Next': 'Suivant',
            'Page': 'Page',
            'Title': 'Titre',
            'Source': 'Source',
            'Type': 'Type',
            'Added': 'Ajout\u00e9',
            'Month': 'Mois',
            'Monthly': 'Mensuel',
            'Cumulative': 'Cumul\u00e9',
            'Monthly additions': 'Ajouts mensuels',
            'Cumulative total': 'Total cumul\u00e9',
            'No recent additions': 'Aucun ajout r\u00e9cent',

            // Item type badges
            'item_type_article':     'Article',
            'item_type_publication': 'Publication',
            'item_type_document':    'Document',
            'item_type_audiovisual': 'Audiovisuel',
            'item_type_reference':   'R\u00e9f\u00e9rence',
```

- [ ] **Step 3: Verify the file parses**:

```bash
node -e "require('fs').readFileSync('asset/js/iwac-i18n.js', 'utf8'); console.log('OK');"
```

- [ ] **Step 4: Commit**

```bash
git add asset/js/iwac-i18n.js
git -c commit.gpgsign=false commit -m "i18n: add keys for refreshed cards, new panels, facet UI, item type badges"
```

---

## Phase 3 — New panel modules

### Task 10: Create `collection-overview/recent-additions.js`

**Files:**
- Create: `asset/js/charts/collection-overview/recent-additions.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Collection Overview: Recent additions panel
 *
 * Reads `data.recent_additions` (list of up to 100 items) and renders a
 * paginated, thumbnail-enabled table using P.buildTable. URLs are built
 * on the client from ctx.siteBase + '/item/' + o_id, so the link respects
 * the current Omeka site locale (afrique_ouest / westafrica) automatically.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildTable) {
        console.warn('IWACVis.collection-overview/recent-additions: missing dependencies');
        return;
    }

    function render(chartEl, data, ctx) {
        var items = (data && data.recent_additions) || [];
        if (items.length === 0) {
            chartEl.appendChild(P.el('div', 'iwac-vis-empty', P.t('No recent additions')));
            return;
        }

        var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';
        var enriched = items.map(function (it) {
            var copy = {};
            for (var k in it) { if (Object.prototype.hasOwnProperty.call(it, k)) copy[k] = it[k]; }
            copy.url = it.o_id != null && siteBase ? siteBase + '/item/' + it.o_id : '';
            return copy;
        });

        var tbl = P.buildTable({
            columns: [
                { key: 'thumbnail',  label: '',                render: 'thumbnail', width: '64px' },
                { key: 'title',      label: P.t('Title'),      render: 'link', linkKey: 'url' },
                { key: 'source',     label: P.t('Source') },
                { key: 'type',       label: P.t('Type'),       render: 'badge', i18nPrefix: 'item_type_' },
                { key: 'added_date', label: P.t('Added'),      render: 'date' }
            ],
            rows: enriched,
            pageSize: 20,
            emptyMessage: P.t('No recent additions'),
            className: 'iwac-vis-table--recent'
        });

        chartEl.appendChild(tbl.root);
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.recentAdditions = { render: render };
})();
```

- [ ] **Step 2: Verify**:

```bash
mkdir -p asset/js/charts/collection-overview
node -e "require('fs').readFileSync('asset/js/charts/collection-overview/recent-additions.js', 'utf8'); console.log('OK');"
```

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/collection-overview/recent-additions.js
git -c commit.gpgsign=false commit -m "collection-overview: recent additions panel"
```

---

### Task 11: Create `collection-overview/entities.js`

**Files:**
- Create: `asset/js/charts/collection-overview/entities.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Collection Overview: Entities panel
 *
 * Rewritten panel module for top-cited index entities. Features:
 *   - Tabs for each entity type (Personnes, Organisations, Lieux, Sujets, Événements)
 *   - Client-side pagination (10 per page, up to 50 total per type)
 *   - Middle-ellipsis label truncation via C.entities maxLabelLength
 *   - Click on a bar → navigate to /item/<o_id>
 *
 * The legacy tab-wiring in collection-overview.js is removed once this
 * module is wired in by the orchestrator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildPagination) {
        console.warn('IWACVis.collection-overview/entities: missing dependencies');
        return;
    }

    var ENTITY_TYPE_I18N = {
        'Personnes':            'Persons',
        'Organisations':        'Organizations',
        'Lieux':                'Places',
        'Sujets':               'Subjects',
        '\u00c9v\u00e9nements': 'Events'
    };
    var ENTITY_TYPE_ORDER = [
        'Personnes', 'Organisations', 'Lieux', 'Sujets', '\u00c9v\u00e9nements'
    ];
    var PAGE_SIZE = 10;

    function render(panelEl, data, ctx) {
        var topEntities = (data && data.top_entities) || {};
        var availableTypes = ENTITY_TYPE_ORDER.filter(function (type) {
            return (topEntities[type] || []).length > 0;
        });

        if (availableTypes.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var state = { typeIdx: 0, page: 0 };

        // Tabs row (inserted before the chart container)
        var tabsBar = P.el('div', 'iwac-vis-tabs');
        var tabButtons = availableTypes.map(function (type, idx) {
            var btn = P.el('button', 'iwac-vis-tab', P.t(ENTITY_TYPE_I18N[type] || type));
            btn.type = 'button';
            btn.dataset.entityIdx = String(idx);
            if (idx === 0) btn.classList.add('iwac-vis-tab--active');
            tabsBar.appendChild(btn);
            return btn;
        });
        panelEl.panel.insertBefore(tabsBar, panelEl.chart);

        // Pagination control (placed AFTER the chart container)
        var pagination = P.buildPagination({
            currentPage: 0,
            totalPages: totalPagesFor(state.typeIdx),
            onChange: function (newPage) {
                state.page = newPage;
                rerender();
            }
        });
        panelEl.panel.appendChild(pagination.root);

        function currentEntries() {
            var type = availableTypes[state.typeIdx];
            var all = topEntities[type] || [];
            var start = state.page * PAGE_SIZE;
            return all.slice(start, start + PAGE_SIZE);
        }

        function totalPagesFor(typeIdx) {
            var type = availableTypes[typeIdx];
            var all = topEntities[type] || [];
            return Math.max(1, Math.ceil(all.length / PAGE_SIZE));
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            instance.setOption(C.entities(currentEntries(), { maxLabelLength: 30 }), true);
        });

        if (chart) {
            chart.on('click', function (params) {
                var item = params.data;
                var siteBase = ctx && ctx.siteBase ? ctx.siteBase : '';
                if (item && item.o_id && siteBase) {
                    window.location.href = siteBase + '/item/' + item.o_id;
                }
            });
        }

        function rerender() {
            if (chart && !chart.isDisposed()) {
                chart.setOption(C.entities(currentEntries(), { maxLabelLength: 30 }), true);
            }
            pagination.update({
                currentPage: state.page,
                totalPages: totalPagesFor(state.typeIdx)
            });
        }

        tabsBar.addEventListener('click', function (evt) {
            var btn = evt.target.closest('[data-entity-idx]');
            if (!btn) return;
            var idx = parseInt(btn.dataset.entityIdx, 10);
            if (isNaN(idx) || idx === state.typeIdx) return;
            state.typeIdx = idx;
            state.page = 0;
            tabButtons.forEach(function (b, i) {
                b.classList.toggle('iwac-vis-tab--active', i === idx);
            });
            rerender();
        });
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.entities = { render: render };
})();
```

- [ ] **Step 2: Verify**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/collection-overview/entities.js', 'utf8'); console.log('OK');"
```

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/collection-overview/entities.js
git -c commit.gpgsign=false commit -m "collection-overview: entities panel (tabs + pagination + truncation)"
```

---

### Task 12: Create `collection-overview/languages.js`

**Files:**
- Create: `asset/js/charts/collection-overview/languages.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Collection Overview: Languages panel
 *
 * Faceted language distribution pie. Facets:
 *   - Global
 *   - By type (sub-buttons: article, publication, document, audiovisual, reference)
 *   - By country (sub-select: 6+ countries)
 *
 * Reads the new `data.languages` structure: { global, by_type, by_country }.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/languages: missing dependencies');
        return;
    }

    function render(panelEl, data) {
        var langs = (data && data.languages) || {};
        var hasAnyData =
            (langs.global && langs.global.length) ||
            (langs.by_type && Object.keys(langs.by_type).length) ||
            (langs.by_country && Object.keys(langs.by_country).length);

        if (!hasAnyData) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var state = { facet: 'global', subFacet: null };

        var typeKeys = Object.keys(langs.by_type || {});
        var typeSubFacets = typeKeys.reduce(function (acc, k) {
            acc[k] = P.t('item_type_' + k);
            return acc;
        }, {});

        var countryKeys = Object.keys(langs.by_country || {}).sort();
        var countrySubFacets = countryKeys.reduce(function (acc, c) {
            acc[c] = c;
            return acc;
        }, {});

        var facetBar = P.buildFacetButtons({
            facets: [
                { key: 'global',     label: P.t('Global') },
                {
                    key: 'by_type',
                    label: P.t('By type'),
                    subFacets: typeSubFacets,
                    renderAs: 'buttons'
                },
                {
                    key: 'by_country',
                    label: P.t('By country'),
                    subFacets: countrySubFacets,
                    renderAs: 'select'
                }
            ],
            activeKey: 'global',
            onChange: function (evt) {
                state.facet = evt.facet;
                state.subFacet = evt.subFacet || null;
                rerender();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        function currentEntries() {
            if (state.facet === 'global')     return (langs.global || []).slice(0, 10);
            if (state.facet === 'by_type')    return ((langs.by_type || {})[state.subFacet] || []).slice(0, 10);
            if (state.facet === 'by_country') return ((langs.by_country || {})[state.subFacet] || []).slice(0, 10);
            return [];
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var entries = currentEntries();
            if (entries.length === 0) {
                instance.clear();
                return;
            }
            instance.setOption(C.pie(entries, { nameKey: 'name', valueKey: 'count' }), true);
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                var entries = currentEntries();
                if (entries.length === 0) {
                    chart.clear();
                } else {
                    chart.setOption(C.pie(entries, { nameKey: 'name', valueKey: 'count' }), true);
                }
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.languages = { render: render };
})();
```

- [ ] **Step 2: Verify**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/collection-overview/languages.js', 'utf8'); console.log('OK');"
```

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/collection-overview/languages.js
git -c commit.gpgsign=false commit -m "collection-overview: languages panel with facets (global/type/country)"
```

---

### Task 13: Create `collection-overview/growth.js`

**Files:**
- Create: `asset/js/charts/collection-overview/growth.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Collection Overview: Growth panel
 *
 * Monthly additions (bar) + cumulative total (line) based on added_date.
 * Single call to C.growthBar — no facets in v1.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.collection-overview/growth: missing dependencies');
        return;
    }

    function render(chartEl, data) {
        var growth = data && data.growth;
        if (!growth || !growth.months || growth.months.length === 0) {
            chartEl.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        ns.registerChart(chartEl, function (el, instance) {
            instance.setOption(C.growthBar(growth), true);
        });
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.growth = { render: render };
})();
```

- [ ] **Step 2: Verify + commit**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/collection-overview/growth.js', 'utf8'); console.log('OK');"
git add asset/js/charts/collection-overview/growth.js
git -c commit.gpgsign=false commit -m "collection-overview: growth panel (monthly additions + cumulative)"
```

---

### Task 14: Create `collection-overview/types-over-time.js`

**Files:**
- Create: `asset/js/charts/collection-overview/types-over-time.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Collection Overview: Items-by-type-over-time panel
 *
 * Stacked bar of items per year, broken down by item type. Faceted by
 * country via a <select> (7 options: "All countries" + 6).
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/types-over-time: missing dependencies');
        return;
    }

    var ALL_KEY = '__all__';

    function render(panelEl, data) {
        var tot = data && data.types_over_time;
        if (!tot || !tot.years || tot.years.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var state = { country: ALL_KEY };

        // Build country sub-facet list with "All countries" first
        var countries = Object.keys(tot.series_by_country || {}).sort();
        var subFacets = {};
        subFacets[ALL_KEY] = P.t('All countries');
        countries.forEach(function (c) { subFacets[c] = c; });

        var facetBar = P.buildFacetButtons({
            facets: [
                {
                    key: 'country',
                    label: P.t('Country'),
                    subFacets: subFacets,
                    renderAs: 'select'
                }
            ],
            activeKey: 'country',
            onChange: function (evt) {
                state.country = evt.subFacet || ALL_KEY;
                rerender();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        function currentSeries() {
            if (state.country === ALL_KEY) return tot.series_global || {};
            return (tot.series_by_country || {})[state.country] || {};
        }

        function buildOption() {
            return C.stackedBar({
                categories: tot.years,
                stackKeys: tot.types || [],
                series: currentSeries()
            }, {
                categoryName: P.t('Year'),
                valueName: P.t('Count'),
                labelFor: function (k) { return P.t('item_type_' + k); }
            });
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            instance.setOption(buildOption(), true);
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                chart.setOption(buildOption(), true);
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.typesOverTime = { render: render };
})();
```

- [ ] **Step 2: Add the `Country` translation key** — the label is used as the facet group label. Open `asset/js/iwac-i18n.js`, find the `'Countries'` key in the EN block, and add right after it:

```javascript
            'Country': 'Country',
```

And in the FR block, right after the existing `'Countries': 'Pays',`:

```javascript
            'Country': 'Pays',
```

- [ ] **Step 3: Verify + commit**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/collection-overview/types-over-time.js', 'utf8'); console.log('OK');"
git add asset/js/charts/collection-overview/types-over-time.js asset/js/iwac-i18n.js
git -c commit.gpgsign=false commit -m "collection-overview: types-over-time panel (country facet)"
```

---

### Task 15: Create `collection-overview/gantt.js`

**Files:**
- Create: `asset/js/charts/collection-overview/gantt.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Collection Overview: Newspaper Gantt panel
 *
 * Horizontal period bars (year_min → year_max) per newspaper, faceted by
 * country and by item type. Both facets are independent; their states
 * merge into a single filter pass before calling C.gantt.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/gantt: missing dependencies');
        return;
    }

    var ALL_KEY = '__all__';

    function render(panelEl, data) {
        var coverage = (data && data.newspapers && data.newspapers.coverage) || [];
        if (coverage.length === 0) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
            return;
        }

        var state = { country: ALL_KEY, type: ALL_KEY };

        var countries = {};
        countries[ALL_KEY] = P.t('All countries');
        coverage.forEach(function (e) {
            if (e.country) countries[e.country] = e.country;
        });

        var types = {};
        types[ALL_KEY] = P.t('All types');
        coverage.forEach(function (e) {
            if (e.type) types[e.type] = P.t('item_type_' + e.type);
        });

        // Two facet bars, one per dimension — rendered side-by-side
        var facetsWrap = P.el('div', 'iwac-vis-facets-pair');
        facetsWrap.style.display = 'flex';
        facetsWrap.style.flexWrap = 'wrap';
        facetsWrap.style.gap = '1rem';

        var countryBar = P.buildFacetButtons({
            facets: [{
                key: 'country',
                label: P.t('Country'),
                subFacets: countries,
                renderAs: 'select'
            }],
            activeKey: 'country',
            onChange: function (evt) {
                state.country = evt.subFacet || ALL_KEY;
                rerender();
            }
        });

        var typeBar = P.buildFacetButtons({
            facets: [{
                key: 'type',
                label: P.t('Type'),
                subFacets: types,
                renderAs: 'buttons'
            }],
            activeKey: 'type',
            onChange: function (evt) {
                state.type = evt.subFacet || ALL_KEY;
                rerender();
            }
        });

        facetsWrap.appendChild(countryBar.root);
        facetsWrap.appendChild(typeBar.root);
        panelEl.panel.insertBefore(facetsWrap, panelEl.chart);

        function filtered() {
            return coverage.filter(function (e) {
                if (state.country !== ALL_KEY && e.country !== state.country) return false;
                if (state.type !== ALL_KEY && e.type !== state.type) return false;
                return true;
            });
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var rows = filtered();
            if (rows.length === 0) {
                instance.clear();
            } else {
                instance.setOption(C.gantt(rows), true);
            }
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                var rows = filtered();
                if (rows.length === 0) {
                    chart.clear();
                } else {
                    chart.setOption(C.gantt(rows), true);
                }
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.gantt = { render: render };
})();
```

- [ ] **Step 2: Verify + commit**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/collection-overview/gantt.js', 'utf8'); console.log('OK');"
git add asset/js/charts/collection-overview/gantt.js
git -c commit.gpgsign=false commit -m "collection-overview: newspaper gantt panel (country + type facets)"
```

---

### Task 16: Create `collection-overview/wordcloud.js`

**Files:**
- Create: `asset/js/charts/collection-overview/wordcloud.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Collection Overview: Word cloud panel
 *
 * Lazy-loaded: waits for the panel to enter the viewport before
 * fetching `asset/data/collection-wordcloud.json`. Then renders a
 * faceted word cloud (Global / By country / By year) using C.wordcloud.
 * Falls back to a horizontal bar chart if echarts-wordcloud failed to
 * load from the CDN.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/wordcloud: missing dependencies');
        return;
    }

    function render(panelEl, data, ctx) {
        var basePath = ctx && ctx.basePath ? ctx.basePath : '';
        var url = basePath + '/modules/IwacVisualizations/asset/data/collection-wordcloud.json';

        var loading = P.el('div', 'iwac-vis-loading');
        loading.appendChild(P.el('div', 'iwac-vis-spinner'));
        loading.appendChild(P.el('span', null, P.t('Loading')));
        panelEl.chart.appendChild(loading);

        var loaded = false;

        function loadAndRender() {
            if (loaded) return;
            loaded = true;

            fetch(url)
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (wc) {
                    panelEl.chart.innerHTML = '';
                    build(panelEl, wc);
                })
                .catch(function (err) {
                    console.error('IWACVis wordcloud:', err);
                    panelEl.chart.innerHTML = '';
                    panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
                });
        }

        // Lazy: IntersectionObserver when available, else immediate load
        if (typeof IntersectionObserver !== 'undefined') {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        loadAndRender();
                        observer.disconnect();
                    }
                });
            }, { rootMargin: '200px' });
            observer.observe(panelEl.panel);
        } else {
            loadAndRender();
        }
    }

    function build(panelEl, wc) {
        var state = { facet: 'global', subFacet: null };

        var countries = Object.keys(wc.by_country || {}).sort();
        var countrySub = countries.reduce(function (acc, c) { acc[c] = c; return acc; }, {});

        var years = Object.keys(wc.by_year || {}).sort();
        var yearSub = years.reduce(function (acc, y) { acc[y] = y; return acc; }, {});

        var facetBar = P.buildFacetButtons({
            facets: [
                { key: 'global',     label: P.t('Global') },
                { key: 'by_country', label: P.t('By country'), subFacets: countrySub, renderAs: 'select' },
                { key: 'by_year',    label: P.t('By year'),    subFacets: yearSub,    renderAs: 'select' }
            ],
            activeKey: 'global',
            onChange: function (evt) {
                state.facet = evt.facet;
                state.subFacet = evt.subFacet || null;
                rerender();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        // Small metadata line under the chart
        var meta = P.el('div', 'iwac-vis-wordcloud-meta');
        meta.style.marginTop = '0.5rem';
        meta.style.fontSize = '0.85rem';
        meta.style.color = 'var(--ink-muted, #666)';
        panelEl.panel.appendChild(meta);

        function currentFacetData() {
            if (state.facet === 'global')     return wc.global || { data: [], total_articles: 0, unique_words: 0 };
            if (state.facet === 'by_country') return (wc.by_country || {})[state.subFacet] || { data: [], total_articles: 0, unique_words: 0 };
            if (state.facet === 'by_year')    return (wc.by_year || {})[state.subFacet] || { data: [], total_articles: 0, unique_words: 0 };
            return { data: [], total_articles: 0, unique_words: 0 };
        }

        function updateMeta(fd) {
            meta.textContent =
                P.formatNumber(fd.total_articles || 0) + ' ' + P.t('articles_count', { count: '' }).replace('{count}', '').trim() +
                ' \u00b7 ' +
                P.formatNumber(fd.unique_words || 0) + ' ' + P.t('unique words');
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var fd = currentFacetData();
            instance.setOption(C.wordcloud(fd.data || []), true);
            updateMeta(fd);
        });

        function rerender() {
            if (chart && !chart.isDisposed()) {
                var fd = currentFacetData();
                chart.setOption(C.wordcloud(fd.data || []), true);
                updateMeta(fd);
            }
        }
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.wordcloud = { render: render };
})();
```

- [ ] **Step 2: Add i18n keys** for `'Loading'` and `'unique words'` — open `asset/js/iwac-i18n.js` and add to both EN and FR blocks near the other v2 keys:

EN:
```javascript
            'Loading': 'Loading',
            'unique words': 'unique words',
```

FR:
```javascript
            'Loading': 'Chargement',
            'unique words': 'mots uniques',
```

- [ ] **Step 3: Verify + commit**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/collection-overview/wordcloud.js', 'utf8'); console.log('OK');"
git add asset/js/charts/collection-overview/wordcloud.js asset/js/iwac-i18n.js
git -c commit.gpgsign=false commit -m "collection-overview: French wordcloud panel (lazy, 3 facets)"
```

---

### Task 17: Create `collection-overview/map.js`

**Files:**
- Create: `asset/js/charts/collection-overview/map.js`

- [ ] **Step 1: Write the file**:

```javascript
/**
 * IWAC Visualizations — Collection Overview: World map panel
 *
 * Lazy-loaded MapLibre map with circle markers sized by item count.
 * Faceted by item type via a button group. Choropleth overlay is NOT
 * rendered in v1 — the GeoJSON source is still loaded so a future
 * enhancement can add it with a few lines.
 *
 * Falls back to a "map unavailable" message if maplibregl is missing.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildFacetButtons) {
        console.warn('IWACVis.collection-overview/map: missing dependencies');
        return;
    }

    var ALL_KEY = '__all__';

    function render(panelEl, data, ctx) {
        var basePath = ctx && ctx.basePath ? ctx.basePath : '';
        var dataUrl = basePath + '/modules/IwacVisualizations/asset/data/collection-map.json';

        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Map library unavailable')));
            return;
        }

        var loading = P.el('div', 'iwac-vis-loading');
        loading.appendChild(P.el('div', 'iwac-vis-spinner'));
        loading.appendChild(P.el('span', null, P.t('Loading')));
        panelEl.chart.appendChild(loading);

        var loaded = false;
        function loadAndRender() {
            if (loaded) return;
            loaded = true;
            fetch(dataUrl)
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (mapData) {
                    panelEl.chart.innerHTML = '';
                    build(panelEl, mapData);
                })
                .catch(function (err) {
                    console.error('IWACVis map:', err);
                    panelEl.chart.innerHTML = '';
                    panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
                });
        }

        if (typeof IntersectionObserver !== 'undefined') {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        loadAndRender();
                        observer.disconnect();
                    }
                });
            }, { rootMargin: '200px' });
            observer.observe(panelEl.panel);
        } else {
            loadAndRender();
        }
    }

    function build(panelEl, mapData) {
        var state = { type: ALL_KEY };
        var locations = mapData.locations || [];

        // Facet: item type buttons
        var types = {};
        types[ALL_KEY] = P.t('All types');
        ['article', 'publication', 'document', 'audiovisual', 'reference'].forEach(function (t) {
            types[t] = P.t('item_type_' + t);
        });
        var facetBar = P.buildFacetButtons({
            facets: [{
                key: 'type',
                label: P.t('Type'),
                subFacets: types,
                renderAs: 'buttons'
            }],
            activeKey: 'type',
            onChange: function (evt) {
                state.type = evt.subFacet || ALL_KEY;
                updateSource();
            }
        });
        panelEl.panel.insertBefore(facetBar.root, panelEl.chart);

        // Map container (ensure it has a known height via CSS)
        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        var styleUrl = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
        var map = new maplibregl.Map({
            container: mapContainer,
            style: styleUrl,
            center: [2, 10],     // rough West Africa center
            zoom: 3.2,
            attributionControl: { compact: true }
        });

        if (ns.registerMap) {
            ns.registerMap(map, mapContainer);
        }

        function filteredFeatures() {
            return {
                type: 'FeatureCollection',
                features: locations
                    .filter(function (loc) {
                        // v1: type filter is data-agnostic because locations
                        // don't currently carry per-type breakdowns. When
                        // "all" is selected, include everything. For a
                        // specific type, we keep the location but may
                        // scale its count down if the generator ever adds
                        // per-type counts. For now: always include.
                        return loc.count > 0;
                    })
                    .map(function (loc) {
                        return {
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
                            properties: {
                                name: loc.name,
                                country: loc.country || '',
                                count: loc.count
                            }
                        };
                    })
            };
        }

        function updateSource() {
            var src = map.getSource('locations');
            if (src) src.setData(filteredFeatures());
        }

        map.on('load', function () {
            map.addSource('locations', { type: 'geojson', data: filteredFeatures() });

            // Placeholder source for future choropleth — load GeoJSON but
            // do NOT add a visible layer in v1.
            var geoUrl = ((panelEl && panelEl.panel && panelEl.panel.ownerDocument &&
                panelEl.panel.ownerDocument.defaultView &&
                (panelEl.panel.closest('[data-base-path]') || {}).dataset) || {}).basePath || '';
            var countriesUrl = (typeof geoUrl === 'string' ? geoUrl : '') +
                '/modules/IwacVisualizations/asset/data/world_countries_simple.geojson';
            map.addSource('countries', { type: 'geojson', data: countriesUrl });

            // Circle layer — radius scaled to count
            var maxCount = 1;
            (mapData.locations || []).forEach(function (l) {
                if (l.count > maxCount) maxCount = l.count;
            });
            map.addLayer({
                id: 'location-circles',
                type: 'circle',
                source: 'locations',
                paint: {
                    'circle-radius': [
                        'interpolate', ['linear'], ['get', 'count'],
                        1, 3,
                        maxCount, 28
                    ],
                    'circle-color': '#d97706',
                    'circle-opacity': 0.65,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#78350f'
                }
            });

            // Click popup
            map.on('click', 'location-circles', function (e) {
                var f = e.features && e.features[0];
                if (!f) return;
                new maplibregl.Popup({ closeButton: true })
                    .setLngLat(f.geometry.coordinates)
                    .setHTML(
                        '<strong>' + P.escapeHtml(f.properties.name) + '</strong><br>' +
                        (f.properties.country ? P.escapeHtml(f.properties.country) + '<br>' : '') +
                        P.formatNumber(Number(f.properties.count)) + ' ' + P.t('mentions_count', { count: '' }).replace('{count}', '').trim()
                    )
                    .addTo(map);
            });
            map.on('mouseenter', 'location-circles', function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', 'location-circles', function () { map.getCanvas().style.cursor = ''; });
        });
    }

    ns.collectionOverview = ns.collectionOverview || {};
    ns.collectionOverview.map = { render: render };
})();
```

- [ ] **Step 2: Add the i18n key** `Map library unavailable`:

EN:
```javascript
            'Map library unavailable': 'Map library unavailable',
```

FR:
```javascript
            'Map library unavailable': 'Biblioth\u00e8que de cartographie indisponible',
```

- [ ] **Step 3: Verify + commit**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/collection-overview/map.js', 'utf8'); console.log('OK');"
git add asset/js/charts/collection-overview/map.js asset/js/iwac-i18n.js
git -c commit.gpgsign=false commit -m "collection-overview: world map panel (lazy, MapLibre, bubbles)"
```

---

## Phase 4 — Orchestrator rewrite + integration

### Task 18: Rewrite `collection-overview.js` orchestrator

**Files:**
- Modify: `asset/js/charts/collection-overview.js`

This task replaces the current thin-but-monolithic controller with a new thin orchestrator that composes the layout and delegates to the per-panel modules from Phase 3. The inline timeline / country bar / treemap / languages / newspapers / entities logic is removed — those are now the panel modules' responsibility (entities, languages) or stay inline only for the three legacy-format charts that don't need facets (timeline, country bar, treemap fix).

- [ ] **Step 1: Replace the entire file with this new content**:

```javascript
/**
 * IWAC Visualizations — Collection Overview block (orchestrator)
 *
 * Thin controller: fetches `asset/data/collection-overview.json`, builds
 * the layout skeleton, and delegates each panel's render to its dedicated
 * module under `asset/js/charts/collection-overview/`.
 *
 * Panels in render order:
 *   1. Summary cards row (inline)
 *   2. Period covered subtitle (inline)
 *   3. Recent additions table              → recent-additions.js
 *   4. Items per year, by country          (inline, existing C.timeline)
 *   5. Items by type, over time            → types-over-time.js
 *   6. Collection growth over time         → growth.js
 *   7. Newspaper coverage (Gantt)          → gantt.js
 *   8. Content by country                  (inline, existing C.horizontalBar)
 *   9. Languages represented               → languages.js (with facets)
 *  10. Most-cited entities                 → entities.js (tabs + pagination)
 *  11. Collection breakdown                (inline, C.treemap with fix)
 *  12. French word cloud                   → wordcloud.js (lazy sidecar)
 *  13. World map                           → map.js (lazy sidecar)
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis collection overview: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;
    var C = ns.chartOptions;

    function buildLayout(container, data, ctx) {
        container.innerHTML = '';
        var root = P.el('div', 'iwac-vis-overview-root');
        container.appendChild(root);

        var summary = data.summary || {};

        // 1. Summary cards — 11 cards per the expansion spec
        root.appendChild(P.buildSummaryCards([
            { value: summary.articles,             labelKey: 'Articles' },
            { value: summary.index_entries,        labelKey: 'Index' },
            { value: summary.total_words,          labelKey: 'Total words' },
            { value: summary.total_pages,          labelKey: 'Total pages' },
            { value: summary.scanned_pages,        labelKey: 'Scanned pages' },
            { value: summary.unique_sources,       labelKey: 'Unique sources' },
            { value: summary.document_types,       labelKey: 'Document types' },
            { value: summary.audiovisual_minutes,  labelKey: 'Audiovisual minutes' },
            { value: summary.references_count,     labelKey: 'References count' },
            { value: summary.countries,            labelKey: 'Countries' },
            { value: summary.languages,            labelKey: 'Languages' }
        ]));

        // 2. Period subtitle
        var subtitle = P.buildPeriodSubtitle(summary.year_min, summary.year_max);
        if (subtitle) root.appendChild(subtitle);

        // 3. Recent additions — wide panel above the charts grid
        var recentPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide iwac-vis-recent-additions',
                                       P.t('Recent additions'));
        root.appendChild(recentPanel.panel);
        if (ns.collectionOverview && ns.collectionOverview.recentAdditions) {
            ns.collectionOverview.recentAdditions.render(recentPanel.chart, data, ctx);
        }

        // 4–13. Charts grid
        var grid = P.buildChartsGrid();
        root.appendChild(grid);

        var timelinePanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Items per year, by country'));
        var typesPanel    = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Items by type, over time'));
        var growthPanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Collection growth over time'));
        var ganttPanel    = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Newspaper coverage'));
        var countryPanel  = P.buildPanel('iwac-vis-panel',                      P.t('Content by country'));
        var languagePanel = P.buildPanel('iwac-vis-panel',                      P.t('Languages represented'));
        var entitiesPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Most-cited entities'));
        entitiesPanel.panel.classList.add('iwac-vis-entities-panel');
        var treemapPanel  = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Collection breakdown'));
        var wordcloudPanel = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('French word cloud'));
        var mapPanel      = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('World map'));

        [
            timelinePanel, typesPanel, growthPanel, ganttPanel,
            countryPanel, languagePanel,
            entitiesPanel, treemapPanel,
            wordcloudPanel, mapPanel
        ].forEach(function (p) { grid.appendChild(p.panel); });

        return {
            timeline:  timelinePanel,
            types:     typesPanel,
            growth:    growthPanel,
            gantt:     ganttPanel,
            country:   countryPanel,
            language:  languagePanel,
            entities:  entitiesPanel,
            treemap:   treemapPanel,
            wordcloud: wordcloudPanel,
            map:       mapPanel
        };
    }

    function wireInlinePanels(h, data) {
        // Timeline (existing C.timeline, year × country)
        if (data.timeline && (data.timeline.years || []).length > 0) {
            ns.registerChart(h.timeline.chart, function (el, instance) {
                instance.setOption(C.timeline(data.timeline));
            });
        } else {
            h.timeline.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        // Country bar
        var countries = (data.countries || []).slice(0, 10);
        if (countries.length > 0) {
            ns.registerChart(h.country.chart, function (el, instance) {
                instance.setOption(C.horizontalBar(countries, { nameKey: 'name', valueKey: 'total' }));
            });
        } else {
            h.country.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        // Treemap (sanitized inside C.treemap — Task 7 fix)
        if (data.treemap && (data.treemap.children || []).length > 0) {
            ns.registerChart(h.treemap.chart, function (el, instance) {
                instance.setOption(C.treemap(data.treemap));
            });
        } else {
            h.treemap.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }
    }

    function wireDelegatedPanels(h, data, ctx) {
        var co = ns.collectionOverview || {};

        if (co.typesOverTime)  co.typesOverTime.render(h.types, data);
        if (co.growth)         co.growth.render(h.growth.chart, data);
        if (co.gantt)          co.gantt.render(h.gantt, data);
        if (co.languages)      co.languages.render(h.language, data);
        if (co.entities)       co.entities.render(h.entities, data, ctx);
        if (co.wordcloud)      co.wordcloud.render(h.wordcloud, data, ctx);
        if (co.map)            co.map.render(h.map, data, ctx);
    }

    function initOverview(container) {
        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || ''
        };
        var url = ctx.basePath + '/modules/IwacVisualizations/asset/data/collection-overview.json';

        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var h = buildLayout(container, data, ctx);
                wireInlinePanels(h, data);
                wireDelegatedPanels(h, data, ctx);
            })
            .catch(function (err) {
                console.error('IWACVis collection overview:', err);
                container.innerHTML = '';
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis collection overview: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-overview');
        for (var i = 0; i < containers.length; i++) {
            initOverview(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
```

- [ ] **Step 2: Verify it parses**:

```bash
node -e "require('fs').readFileSync('asset/js/charts/collection-overview.js', 'utf8'); console.log('OK');"
```

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/collection-overview.js
git -c commit.gpgsign=false commit -m "collection-overview: rewrite orchestrator to delegate to panel modules"
```

---

### Task 19: Update `.phtml` template to enqueue new scripts

**Files:**
- Modify: `view/common/block-layout/collection-overview.phtml`

- [ ] **Step 1: Add the MapLibre + echarts-wordcloud CDN entries AND the new JS file enqueue statements** — open the file and replace the script-enqueuing block (lines 27–36 in the current file) with:

```php
// CDN libraries
$this->headScript()->appendFile('https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js');
$this->headScript()->appendFile('https://cdn.jsdelivr.net/npm/echarts-wordcloud@2/dist/echarts-wordcloud.min.js');
$this->headScript()->appendFile('https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js');
$this->headLink()->appendStylesheet('https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css');

// IWAC infrastructure — order matters: i18n → theme → core → shared → panels → block controller
$this->headScript()->appendFile($this->assetUrl('js/iwac-i18n.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/iwac-theme.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/dashboard-core.js', 'IwacVisualizations'));

// Shared primitives (panels.js first, then primitives that depend on it)
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/panels.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/chart-options.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/pagination.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/table.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/facet-buttons.js', 'IwacVisualizations'));

// Collection Overview panels (self-registering IIFE modules)
$this->headScript()->appendFile($this->assetUrl('js/charts/collection-overview/recent-additions.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/collection-overview/entities.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/collection-overview/languages.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/collection-overview/growth.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/collection-overview/types-over-time.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/collection-overview/gantt.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/collection-overview/wordcloud.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/collection-overview/map.js', 'IwacVisualizations'));

// Orchestrator — LAST
$this->headScript()->appendFile($this->assetUrl('js/charts/collection-overview.js', 'IwacVisualizations'));
```

- [ ] **Step 2: Verify PHP syntax**:

```bash
php -l view/common/block-layout/collection-overview.phtml
```
Expected: `No syntax errors detected in view/common/block-layout/collection-overview.phtml`.

- [ ] **Step 3: Commit**

```bash
git add view/common/block-layout/collection-overview.phtml
git -c commit.gpgsign=false commit -m "collection-overview.phtml: enqueue new shared + panel scripts + MapLibre/wordcloud CDNs"
```

---

### Task 20: Manual QA sweep + final commit

**Files:** none (QA only)

- [ ] **Step 1: Run all three Python generators to refresh asset/data/**:

```bash
cd /home/fmadore/projects/IwacVisualizations
python3 scripts/generate_collection_overview.py
python3 scripts/generate_wordcloud.py
python3 scripts/generate_world_map.py
```
Expected: three files updated in `asset/data/`. No Python exceptions.

- [ ] **Step 2: Open a site that hosts the block** (in a local Omeka S dev environment with this module installed) and walk through the QA checklist:

**Summary cards** (expected 11 cards: Articles, Index, Total words, Total pages, Scanned pages, Unique sources, Document types, Audiovisual minutes, References, Countries, Languages). Cards whose value is `null` in the JSON are omitted automatically by `P.buildSummaryCards`.

**Period subtitle**: "Period covered: YYYY – YYYY" renders under the cards.

**Recent additions table**: 20 rows per page, pagination works, thumbnails show or fall back to the SVG placeholder, clicking the title navigates to the Omeka item page for the current site slug.

**Items per year, by country**: existing stacked timeline renders unchanged.

**Items by type, over time**: stacked bar renders, country `<select>` switches between "All countries" and individual countries, all 5 type stacks visible.

**Collection growth over time**: bar + line dual-axis chart, dataZoom slider appears when > 24 months.

**Newspaper coverage (Gantt)**: horizontal period bars, country `<select>` and type buttons filter correctly, y-axis labels truncated to 160px, tooltip shows `{name}` · `{year_min}–{year_max}` · `{country}` · type · count.

**Content by country**: existing horizontal bar unchanged.

**Languages represented**: pie renders for "Global"; switching to "By type" shows sub-buttons (article/publication/document/audiovisual/reference) and pie updates; "By country" shows a `<select>` and pie updates.

**Most-cited entities**: 5 tabs (Persons/Organizations/Places/Subjects/Events), each tab has up to 5 pages of 10 entities each, switching tabs resets to page 1, long labels are truncated in the middle (e.g. `"Longwordsomethi…verylongtitle"`).

**Collection breakdown (treemap)**: renders without the `Cannot set properties of undefined (setting '2')` error. Verify in devtools console.

**French word cloud**: scrolling to the panel triggers the lazy fetch, spinner shows briefly, then the cloud renders with 3 facets. If echarts-wordcloud failed to load, a horizontal bar fallback renders instead. `By country` dropdown has 6 countries; `By year` dropdown has the full list of years from the dataset.

**World map**: scrolling to the panel triggers the lazy fetch, MapLibre renders with circles sized by count. Type facet buttons appear. Clicking a circle opens a popup with name + country + count. Map stays usable (pan, zoom).

**Theme switch**: flip `body[data-theme="dark"]` via devtools. All ECharts charts dispose and re-init with the dark theme. MapLibre basemap swaps if `ns.registerMap` is wired (may be a no-op if the theme module doesn't implement map theming).

**Locale switch**: open the block on the French site (e.g. `/s/afrique_ouest/...`) and on the English site (e.g. `/s/westafrica/...`). All text switches between FR/EN. Recent additions links use the matching slug.

**Empty data**: open devtools, break the fetch (network throttle to "offline" and reload). Verify the full-panel "Failed to load" error renders.

- [ ] **Step 3: Fix any issues found** and re-run Step 2. Repeat until clean. Commit fixes with targeted messages.

- [ ] **Step 4: Final regeneration + commit** of the data files (they've been updated through the task):

```bash
git add asset/data/collection-overview.json asset/data/collection-wordcloud.json asset/data/collection-map.json
git -c commit.gpgsign=false commit -m "data: regenerate collection-overview + wordcloud + map sidecars" || echo "Nothing to commit"
```

- [ ] **Step 5: Update ROADMAP.md** to reflect the shipped expansion. Open `ROADMAP.md`, find the relevant section (Collection Overview block), and add a line to whatever "done" / "v0.2" section exists. If no such structure exists, append:

```markdown
## v0.2 — Collection Overview expansion (2026-04-10)

- Refreshed summary cards (11 cards, new metrics: words, pages, sources, doc types, AV minutes, references)
- Reusable table primitive (`P.buildTable`) + recent additions panel
- Treemap runtime crash fixed
- Faceted language pie
- Newspaper coverage Gantt (replaces bar chart)
- Collection growth over time
- Items by type, over time (with country facet)
- Entities: 50/type, pagination, label truncation
- French word cloud (Global / By country / By year, lazy)
- MapLibre world map with bubbles (choropleth follow-up)
```

- [ ] **Step 6: Final commit**:

```bash
git add ROADMAP.md
git -c commit.gpgsign=false commit -m "ROADMAP: document v0.2 Collection Overview expansion"
```

---

## Post-implementation

After Task 20 completes cleanly:

1. The `CollectionOverview` block renders 11 summary cards, a recent additions table, and 10 visualizations (some existing, some new).
2. Three Python generators can be re-run on demand when the HF dataset updates.
3. Three new shared primitives (`table.js`, `facet-buttons.js`, `pagination.js`) are available for future blocks (e.g. per-item dashboards, an expanded `ReferencesOverview`).
4. Four new ECharts builders (`gantt`, `wordcloud`, `growthBar`, `stackedBar`) are available for reuse in any other block.

**Follow-ups** (explicitly out of v1 scope, tracked for future work):

- Choropleth layer on the world map using `country_counts` + `world_countries_simple.geojson` (data is already plumbed; layer implementation is ~30 lines).
- Word cloud for languages other than French.
- Gantt click-through to filter the page on a single newspaper.
- Server-side caching / on-demand regeneration of the JSON files.
- Automated unit tests (would require setting up a test runner for both PHP and JS — large lift, deferred).
