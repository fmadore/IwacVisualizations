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
import re
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

# Subsets with a `newspaper` field (dcterms:publisher) — used for the
# "newspaper coverage" panel.
NEWSPAPER_SUBSETS = ["articles", "publications"]

# Mapping from HF subset names to human-readable document type labels used
# in the treemap hierarchy (matches the convention from iwac-dashboard).
SUBSET_TO_DOC_TYPE = {
    "articles":     "Article de presse",
    "publications": "P\u00e9riodique islamique",
    "documents":    "Document",
    "audiovisual":  "Enregistrement audio-visuel",
}

# Candidate column names for "document type" / "resource class" on content
# subsets. The HF dataset currently exposes a per-record type column only on
# ``documents`` (``type``); the other subsets have no per-record type field.
# The candidate list is kept in priority order so future dataset updates that
# introduce ``o:resource_class`` (or its HF-safe variants) Just Work.
DOC_TYPE_COLUMN_CANDIDATES = (
    "o:resource_class",
    "o__resource_class",
    "resource_class",
    "dcterms:type",
    "dcterms__type",
    "type",
)

# Candidate column names for audiovisual "duration". The HF dataset exposes
# ``extent`` with ISO 8601 values like ``PT571M`` — but we also fall back to
# more conventional names for robustness.
DURATION_COLUMN_CANDIDATES = (
    "duration",
    "dcterms:extent",
    "dcterms__extent",
    "extent",
    "runtime",
)

# Matches ISO 8601 duration strings like ``PT1H30M15S``, ``PT571M``, ``PT45S``.
_ISO8601_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+(?:\.\d+)?)D)?"
    r"(?:T"
    r"(?:(?P<hours>\d+(?:\.\d+)?)H)?"
    r"(?:(?P<minutes>\d+(?:\.\d+)?)M)?"
    r"(?:(?P<seconds>\d+(?:\.\d+)?)S)?"
    r")?$"
)

# Matches ``HH:MM:SS`` or ``MM:SS``.
_HMS_RE = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2})$")


def _parse_duration_to_minutes(value: Any) -> float:
    """Parse a duration value into minutes.

    Handles:

    * Numeric values — returns them as-is (caller applies seconds/minutes
      heuristic on the aggregate).
    * ISO 8601 durations such as ``PT1H30M``, ``PT571M``, ``PT45S``.
    * ``HH:MM:SS`` / ``MM:SS`` strings.

    Returns ``0.0`` for anything unparseable.
    """
    if value is None:
        return 0.0
    if isinstance(value, float) and pd.isna(value):
        return 0.0
    # Numeric path — return as-is; aggregate heuristic decides units.
    if isinstance(value, (int, float)):
        return float(value)

    s = str(value).strip()
    if not s:
        return 0.0

    # Pure numeric string
    try:
        return float(s)
    except ValueError:
        pass

    # ISO 8601 duration (PnDTnHnMnS, with any combination)
    m = _ISO8601_DURATION_RE.match(s)
    if m and any(m.group(g) for g in ("days", "hours", "minutes", "seconds")):
        days = float(m.group("days") or 0)
        hours = float(m.group("hours") or 0)
        minutes = float(m.group("minutes") or 0)
        seconds = float(m.group("seconds") or 0)
        return days * 24 * 60 + hours * 60 + minutes + seconds / 60.0

    # HH:MM:SS or MM:SS
    m = _HMS_RE.match(s)
    if m:
        hours = float(m.group(1) or 0)
        minutes = float(m.group(2) or 0)
        seconds = float(m.group(3) or 0)
        return hours * 60 + minutes + seconds / 60.0

    return 0.0


def _first_present_column(
    df: pd.DataFrame, candidates: tuple,
) -> Optional[str]:
    """Return the first candidate column that exists in ``df``, or None."""
    for col in candidates:
        if col in df.columns:
            return col
    return None


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
            country_value = str(country).strip() if country is not None else ""
            if not country_value or country_value.lower() == "unknown":
                continue  # skip items without a resolvable country
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
    """
    Content counts per country, broken down by subset. Items without a
    resolvable country are skipped entirely — the overview block is a
    geographic distribution and an "Unknown" bucket is not meaningful
    there.
    """
    totals: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for subset in CONTENT_SUBSETS:
        df = dataframes.get(subset)
        if df is None or df.empty or "country" not in df.columns:
            continue
        # ``country`` is usually single-value but can contain pipe-separated
        # values. Handle both uniformly.
        for value in df["country"]:
            countries = parse_pipe_separated(value)
            for country in countries:
                country = country.strip()
                if not country or country.lower() == "unknown":
                    continue
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


def compute_newspapers(
    dataframes: Dict[str, pd.DataFrame],
    top_n: int,
    year_min: int,
    year_max: int,
) -> Dict[str, Any]:
    """
    Aggregate the `newspaper` field (dcterms:publisher) across articles
    and publications. For each newspaper returns total count, per-subset
    counts, year range, and the most common country it's published from.

    Returns a dict with two keys:
        {
          "total": N,          # total unique newspapers (all, not truncated)
          "top": [              # top N entries sorted by total desc
            {
              "name": "...",
              "total": 12,
              "articles": 10,
              "publications": 2,
              "year_min": 2005,
              "year_max": 2024,
              "country": "Burkina Faso"
            },
            ...
          ]
        }

    Empty newspaper values and "Unknown" are skipped.
    """
    # name -> { total, articles, publications, years: set, countries: Counter }
    agg: Dict[str, Dict[str, Any]] = {}

    for subset in NEWSPAPER_SUBSETS:
        df = dataframes.get(subset)
        if df is None or df.empty:
            continue
        if "newspaper" not in df.columns:
            continue
        pub_date_col = "pub_date" if "pub_date" in df.columns else None
        country_col = "country" if "country" in df.columns else None

        for idx in range(len(df)):
            raw_name = df["newspaper"].iat[idx]
            if raw_name is None or (isinstance(raw_name, float) and pd.isna(raw_name)):
                continue
            # `newspaper` is usually single-valued but allow pipe-separated
            for name in parse_pipe_separated(raw_name):
                name = name.strip()
                if not name or name.lower() == "unknown":
                    continue
                entry = agg.setdefault(name, {
                    "total": 0,
                    "articles": 0,
                    "publications": 0,
                    "years": set(),
                    "countries": Counter(),
                })
                entry["total"] += 1
                entry[subset] = entry.get(subset, 0) + 1

                if pub_date_col is not None:
                    year = extract_year(df[pub_date_col].iat[idx], min_year=year_min, max_year=year_max)
                    if year is not None:
                        entry["years"].add(year)

                if country_col is not None:
                    raw_country = df[country_col].iat[idx]
                    if raw_country is not None and not (isinstance(raw_country, float) and pd.isna(raw_country)):
                        country_str = str(raw_country).strip()
                        if country_str and country_str.lower() != "unknown":
                            entry["countries"][country_str] += 1

    # Flatten into sorted list
    sorted_names = sorted(
        agg.items(), key=lambda kv: (-kv[1]["total"], kv[0])
    )
    top_entries: List[Dict[str, Any]] = []
    for name, entry in sorted_names[:top_n]:
        years = entry["years"]
        most_common_country = entry["countries"].most_common(1)
        top_entries.append({
            "name": name,
            "total": int(entry["total"]),
            "articles": int(entry.get("articles", 0)),
            "publications": int(entry.get("publications", 0)),
            "year_min": min(years) if years else None,
            "year_max": max(years) if years else None,
            "country": most_common_country[0][0] if most_common_country else None,
        })

    return {
        "total": len(agg),
        "top": top_entries,
    }


def compute_treemap(
    dataframes: Dict[str, pd.DataFrame],
) -> Dict[str, Any]:
    """
    Build a hierarchical treemap of the collection:

        Countries
        └── country
            └── document type
                └── newspaper (only for articles + publications)

    Mirrors the shape used by iwac-dashboard's treemap-countries.json so
    the same visualization patterns can be reused. Items without a
    country are skipped.
    """
    # country -> type -> { value, newspapers: Counter }
    hierarchy: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for subset, doc_type in SUBSET_TO_DOC_TYPE.items():
        df = dataframes.get(subset)
        if df is None or df.empty:
            continue
        if "country" not in df.columns:
            continue
        has_newspaper = "newspaper" in df.columns

        for idx in range(len(df)):
            raw_country = df["country"].iat[idx]
            if raw_country is None or (isinstance(raw_country, float) and pd.isna(raw_country)):
                continue
            country = str(raw_country).strip()
            if not country or country.lower() == "unknown":
                continue

            country_bucket = hierarchy.setdefault(country, {})
            type_bucket = country_bucket.setdefault(doc_type, {"value": 0, "newspapers": Counter()})
            type_bucket["value"] += 1

            if has_newspaper:
                raw_paper = df["newspaper"].iat[idx]
                if raw_paper is not None and not (isinstance(raw_paper, float) and pd.isna(raw_paper)):
                    paper = str(raw_paper).strip()
                    if paper and paper.lower() != "unknown":
                        type_bucket["newspapers"][paper] += 1

    # Build the tree, sorted by value desc at each level
    children: List[Dict[str, Any]] = []
    for country in sorted(hierarchy.keys(), key=lambda c: -sum(t["value"] for t in hierarchy[c].values())):
        type_children: List[Dict[str, Any]] = []
        for doc_type in sorted(hierarchy[country].keys(), key=lambda dt: -hierarchy[country][dt]["value"]):
            type_bucket = hierarchy[country][doc_type]
            type_node: Dict[str, Any] = {
                "name": doc_type,
                "value": type_bucket["value"],
            }
            newspapers = type_bucket["newspapers"]
            if newspapers:
                type_node["children"] = [
                    {"name": name, "value": int(count)}
                    for name, count in newspapers.most_common()
                ]
            type_children.append(type_node)
        country_total = sum(t["value"] for t in hierarchy[country].values())
        children.append({
            "name": country,
            "value": country_total,
            "children": type_children,
        })

    return {
        "name": "Collection",
        "children": children,
    }


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

    # Document types — content subsets contribute one type each via the
    # hardcoded ``SUBSET_TO_DOC_TYPE`` labels (articles/publications/documents/
    # audiovisual → 4 types). References contribute their own per-record types
    # from the ``type`` column (bibliographic types: Livre, Article de revue,
    # Th\u00e8se, etc.), so the final count reflects both the content catalog
    # and the bibliography.
    doc_types: set = set()
    for subset in ("articles", "publications", "documents", "audiovisual"):
        df = dataframes.get(subset)
        if df is None or df.empty:
            continue
        label = SUBSET_TO_DOC_TYPE.get(subset)
        if label:
            doc_types.add(label)

    references_df = dataframes.get("references")
    if references_df is not None and not references_df.empty:
        ref_type_col = _first_present_column(references_df, DOC_TYPE_COLUMN_CANDIDATES)
        if ref_type_col is not None:
            for value in references_df[ref_type_col].dropna():
                v = str(value).strip()
                if v and v.lower() != "unknown":
                    doc_types.add(v)

    # Audiovisual duration (minutes)
    av_minutes = 0.0
    av_df = dataframes.get("audiovisual")
    if av_df is not None and not av_df.empty:
        duration_col = _first_present_column(av_df, DURATION_COLUMN_CANDIDATES)
        if duration_col is not None:
            # First try purely numeric (legacy datasets may store seconds or
            # minutes directly).
            numeric = pd.to_numeric(av_df[duration_col], errors="coerce")
            numeric_sum = float(numeric.fillna(0).sum())
            if numeric_sum > 0 and numeric.notna().any():
                positive = numeric[numeric > 0]
                median = float(positive.median()) if not positive.empty else 0.0
                # Heuristic: if the median > 500, assume seconds; else minutes
                if median > 500:
                    av_minutes = numeric_sum / 60.0
                else:
                    av_minutes = numeric_sum
            else:
                # String path — ISO 8601 (``PT571M``), ``HH:MM:SS``, etc.
                parsed = av_df[duration_col].map(_parse_duration_to_minutes)
                av_minutes = float(parsed.fillna(0).sum())

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
