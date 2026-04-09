#!/usr/bin/env python3
"""
generate_collection_overview.py
================================

Generate ``asset/data/collection-overview.json`` for the IwacVisualizations
module's Collection Overview page block. One JSON file, intentionally
compact, covering:

    * summary counts per subset (articles, publications, documents,
      audiovisual, references, index_entries)
    * total counts for countries / languages / words
    * timeline of content items per year, stacked by country
      (articles + publications + documents + audiovisual)
    * content counts per country
    * content counts per language
    * top N entities per ``index`` type, sorted by ``frequency``

Follows the patterns from ``iwac-dashboard/scripts/generate_overview_stats.py``
and shares its ``iwac_utils`` helpers.

Usage
-----
    python scripts/generate_collection_overview.py
    python scripts/generate_collection_overview.py --output asset/data/collection-overview.json
    python scripts/generate_collection_overview.py --top-n 15 --year-min 1980

Environment
-----------
    HF_TOKEN   Optional Hugging Face access token (public dataset, so
               typically unnecessary).
"""
from __future__ import annotations

import argparse
import logging
import os
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    create_metadata_block,
    extract_year,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

# Subsets that carry dated content items. The ``index`` subset is handled
# separately (authority records, no ``pub_date``); ``references`` are
# bibliographic metadata and are excluded from the timeline.
CONTENT_SUBSETS = ["articles", "publications", "documents", "audiovisual"]

# Entity types in the ``index`` subset — keyed by the French label used in
# the dataset. Order controls the tab order in the block.
INDEX_TYPES = [
    "Personnes",
    "Organisations",
    "Lieux",
    "Sujets",
    "\u00c9v\u00e9nements",  # Événements
]


def _int_or_none(value: Any) -> Optional[int]:
    """Return an int or None if the value isn't usable."""
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def compute_subset_summary(df: Optional[pd.DataFrame]) -> Dict[str, int]:
    """Row count + word count for a subset DataFrame."""
    if df is None or df.empty:
        return {"total_records": 0, "total_words": 0}
    total_records = int(len(df))
    total_words = 0
    if "nb_mots" in df.columns:
        total_words = int(pd.to_numeric(df["nb_mots"], errors="coerce").fillna(0).sum())
    return {"total_records": total_records, "total_words": total_words}


def compute_timeline(
    dataframes: Dict[str, pd.DataFrame],
    year_min: int,
    year_max: int,
) -> Dict[str, Any]:
    """
    Aggregate content items per year, stacked by country.

    Returns a structure suitable for a stacked ECharts bar chart:
        {
          "years": [1990, 1991, ...],
          "countries": ["B\u00e9nin", "Burkina Faso", ...],
          "series": { country: [count_per_year, ...] },
          "totals": [count_per_year, ...],
        }
    """
    per_year_country: Dict[int, Counter] = defaultdict(Counter)
    seen_years: set = set()
    seen_countries: set = set()

    for subset in CONTENT_SUBSETS:
        df = dataframes.get(subset)
        if df is None or df.empty:
            continue
        if "pub_date" not in df.columns or "country" not in df.columns:
            continue
        for pub_date, country in zip(df["pub_date"], df["country"]):
            year = extract_year(pub_date, min_year=year_min, max_year=year_max)
            if year is None:
                continue
            country_value = (str(country).strip() if country is not None else "") or "Unknown"
            per_year_country[year][country_value] += 1
            seen_years.add(year)
            seen_countries.add(country_value)

    if not seen_years:
        return {"years": [], "countries": [], "series": {}, "totals": []}

    years = sorted(seen_years)
    # Order countries by total count desc, stable alphabetical tie-break
    country_totals = Counter()
    for counts in per_year_country.values():
        country_totals.update(counts)
    countries = sorted(
        seen_countries,
        key=lambda c: (-country_totals[c], c),
    )

    series: Dict[str, List[int]] = {c: [0] * len(years) for c in countries}
    totals: List[int] = [0] * len(years)
    for i, year in enumerate(years):
        year_counts = per_year_country[year]
        for country in countries:
            count = int(year_counts.get(country, 0))
            series[country][i] = count
            totals[i] += count

    return {
        "years": years,
        "countries": countries,
        "series": series,
        "totals": totals,
    }


def compute_country_distribution(
    dataframes: Dict[str, pd.DataFrame],
) -> List[Dict[str, Any]]:
    """Content counts per country, broken down by subset."""
    totals: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for subset in CONTENT_SUBSETS:
        df = dataframes.get(subset)
        if df is None or df.empty or "country" not in df.columns:
            continue
        # ``country`` is usually single-value but can contain pipe-separated
        # values. Handle both uniformly.
        for value in df["country"]:
            countries = parse_pipe_separated(value) or ["Unknown"]
            for country in countries:
                totals[country][subset] += 1
                totals[country]["total"] += 1

    out = []
    for country, breakdown in sorted(
        totals.items(), key=lambda kv: (-kv[1]["total"], kv[0])
    ):
        entry = {"name": country, "total": breakdown["total"]}
        for subset in CONTENT_SUBSETS:
            entry[subset] = breakdown.get(subset, 0)
        out.append(entry)
    return out


def compute_language_distribution(
    dataframes: Dict[str, pd.DataFrame],
    top_n: int,
) -> List[Dict[str, int]]:
    """Content counts per language, top N."""
    counter: Counter = Counter()
    for subset in CONTENT_SUBSETS + ["publications"]:
        # publications already in CONTENT_SUBSETS; this is a no-op guard
        # in case the list changes.
        df = dataframes.get(subset)
        if df is None or df.empty or "language" not in df.columns:
            continue
        for value in df["language"]:
            for lang in parse_pipe_separated(value):
                if lang:
                    counter[lang] += 1
    return [
        {"name": name, "count": int(count)}
        for name, count in counter.most_common(top_n)
    ]


def compute_top_entities(
    index_df: Optional[pd.DataFrame],
    top_n: int,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    For each entity type in ``INDEX_TYPES``, return the top N entities by
    ``frequency``. Each entry carries ``o_id``, ``title``, ``frequency``,
    and ``countries`` so the block can link back to the authority page.
    """
    result: Dict[str, List[Dict[str, Any]]] = {t: [] for t in INDEX_TYPES}
    if index_df is None or index_df.empty:
        return result
    if "Type" not in index_df.columns or "frequency" not in index_df.columns:
        return result

    for entity_type in INDEX_TYPES:
        subset = index_df[index_df["Type"] == entity_type].copy()
        if subset.empty:
            continue
        subset["_freq"] = pd.to_numeric(subset["frequency"], errors="coerce").fillna(0)
        subset = subset[subset["_freq"] > 0]
        subset = subset.sort_values("_freq", ascending=False).head(top_n)
        entries: List[Dict[str, Any]] = []
        for _, row in subset.iterrows():
            entry = {
                "o_id": _int_or_none(row.get("o:id")),
                "title": str(row.get("Titre") or "").strip(),
                "frequency": int(row.get("_freq") or 0),
            }
            countries = parse_pipe_separated(row.get("countries"))
            if countries:
                entry["countries"] = countries
            # Light provenance for the tooltip: first/last occurrence if present
            first = row.get("first_occurrence")
            last = row.get("last_occurrence")
            if isinstance(first, str) and first.strip():
                entry["first_occurrence"] = first.strip()
            if isinstance(last, str) and last.strip():
                entry["last_occurrence"] = last.strip()
            if entry["title"]:
                entries.append(entry)
        result[entity_type] = entries
    return result


def compute_summary(
    subset_summaries: Dict[str, Dict[str, int]],
    timeline: Dict[str, Any],
    country_distribution: List[Dict[str, Any]],
    language_distribution: List[Dict[str, int]],
) -> Dict[str, Any]:
    """Top-level counters rendered in the summary cards row."""
    counts = {subset: subset_summaries.get(subset, {}).get("total_records", 0) for subset in subset_summaries}
    total_content = sum(
        counts.get(s, 0) for s in CONTENT_SUBSETS
    )
    total_words = sum(s.get("total_words", 0) for s in subset_summaries.values())
    years = timeline.get("years") or []
    return {
        "articles": counts.get("articles", 0),
        "publications": counts.get("publications", 0),
        "documents": counts.get("documents", 0),
        "audiovisual": counts.get("audiovisual", 0),
        "references": counts.get("references", 0),
        "index_entries": counts.get("index", 0),
        "total_content": total_content,
        "total_words": int(total_words),
        "countries": len(country_distribution),
        "languages": len(language_distribution),
        "year_min": years[0] if years else None,
        "year_max": years[-1] if years else None,
    }


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
    language_distribution = compute_language_distribution(dataframes, top_n=top_n)
    top_entities = compute_top_entities(dataframes.get("index"), top_n=top_n)
    summary = compute_summary(
        subset_summaries, timeline, country_distribution, language_distribution
    )

    metadata = create_metadata_block(
        total_records=summary["total_content"] + summary["index_entries"],
        data_source=repo_id,
        script="generate_collection_overview.py",
        script_version="0.1.0",
        top_n=top_n,
    )

    return {
        "metadata": metadata,
        "summary": summary,
        "timeline": timeline,
        "countries": country_distribution,
        "languages": language_distribution,
        "top_entities": top_entities,
    }


def main() -> None:
    configure_logging()
    logger = logging.getLogger(__name__)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repository ID",
    )
    parser.add_argument(
        "--output",
        default="asset/data/collection-overview.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=10,
        help="Top-N cutoff for entity lists and languages",
    )
    parser.add_argument("--year-min", type=int, default=1900)
    parser.add_argument("--year-max", type=int, default=2100)
    parser.add_argument(
        "--minify",
        action="store_true",
        help="Produce compact JSON (no indentation)",
    )
    args = parser.parse_args()

    token = os.getenv("HF_TOKEN") or None
    if token is None:
        logger.info("No HF_TOKEN set; using anonymous access (public dataset).")

    overview = build_overview(
        repo_id=args.repo,
        token=token,
        top_n=args.top_n,
        year_min=args.year_min,
        year_max=args.year_max,
    )

    output_path = Path(args.output)
    if not output_path.is_absolute():
        # Resolve relative to the module root (one level up from scripts/)
        module_root = Path(__file__).resolve().parent.parent
        output_path = module_root / output_path

    save_json(overview, output_path)
    logger.info("Collection overview written to %s", output_path)


if __name__ == "__main__":
    main()
