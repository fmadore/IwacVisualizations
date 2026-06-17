#!/usr/bin/env python3
"""
generate_keyword_explorer.py
============================

Generate the three precomputed JSON files that back the Keyword Explorer
half of the "Index Overview" page block:

    asset/data/keyword-explorer-subjects.json
    asset/data/keyword-explorer-spatial.json
    asset/data/keyword-explorer-metadata.json

Section B of the block explores the prevalence of Dublin Core
``subject`` and ``spatial`` terms over time, per country, per
newspaper — modeled on ``iwac-dashboard/src/routes/keywords`` but
generalized to scan every content subset (articles, publications,
documents, audiovisual, references) instead of just articles, so the
keyword coverage reflects the whole IWAC corpus.

The output shape intentionally mirrors iwac-dashboard's generator so
the front-end port is mechanical:

    {
      "field": "subject",
      "years": [1961, ..., 2025],
      "top_keywords": [...],               # top 20
      "global_series": { keyword: { years, counts, total, articles } },
      "by_country":   { country: { top_keywords, series, total_keywords } },
      "by_newspaper": { newspaper: { ... } },
      "all_keywords": [ { keyword, total, articles } ],
      "stats": { total_keywords, total_occurrences, year_range, ... }
    }

Usage
-----
    python scripts/generate_keyword_explorer.py
    python scripts/generate_keyword_explorer.py --output-dir asset/data --minify
"""
from __future__ import annotations

import argparse
import logging
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    canonical_country,
    canonicalize_country_field,
    configure_logging,
    extract_year,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

# Every content subset we scan for dct:subject + dct:spatial mentions.
# ``index`` is excluded — it's the authority file, not content.
CONTENT_SUBSETS = ["articles", "publications", "documents", "audiovisual", "references"]

# Size caps — the full matrix (every keyword × every year × every facet)
# is a few MB, so we trim per-facet to what a human actually interacts
# with. These mirror iwac-dashboard's defaults closely enough for the
# port while keeping the JSON payload around 2–3 MB even for the
# broader multi-subset corpus.
GLOBAL_TOP_POOL = 100      # global_series size (chart uses top 20 by default)
DEFAULT_TOP_DISPLAY = 20   # surfaced as `top_keywords`
PER_FACET_TOP = 30         # per-country / per-newspaper top keywords
# Emit per-newspaper series for every newspaper that has any keyword
# data. Previously capped at 40 for payload size, but the UI listed
# all ~79 newspapers in the filter dropdown and picking one outside
# the top 40 showed "No data available" — confusing. The extra
# ~40 series × 30 keywords × 67 years ≈ a few hundred KB, which the
# minified payload absorbs fine.
NEWSPAPER_FACET_LIMIT = None


def _str_or_none(value: Any) -> Optional[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    return s or None


def _pick_countries(value: Any) -> List[str]:
    """Return a list of canonical country names for a row, splitting
    multi-country cells so each country bucket gets its own count.
    Empty / unknown values are dropped."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return []
    parts = parse_pipe_separated(value)
    out: List[str] = []
    for p in parts:
        s = p.strip()
        if not s or s.lower() == "unknown":
            continue
        out.append(canonical_country(s))
    return out


def _pick_newspaper(value: Any) -> Optional[str]:
    s = _str_or_none(value)
    if not s:
        return None
    if s.lower() == "unknown":
        return None
    # Newspaper is usually single-valued but guard against pipe lists
    parts = parse_pipe_separated(s)
    if parts:
        first = parts[0].strip()
        return first or None
    return s


def process_keywords(
    dataframes: Dict[str, pd.DataFrame],
    field: str,
) -> Dict[str, Any]:
    """Aggregate ``field`` (``subject`` or ``spatial``) across every
    content subset and emit the iwac-dashboard-shaped payload."""
    logger = logging.getLogger(__name__)
    logger.info("Processing field %r across %d subsets", field, len(dataframes))

    # year -> keyword -> count
    global_year_keyword: Dict[int, Counter] = defaultdict(Counter)
    # country -> year -> keyword -> count
    country_year_keyword: Dict[str, Dict[int, Counter]] = defaultdict(
        lambda: defaultdict(Counter)
    )
    # newspaper -> year -> keyword -> count
    newspaper_year_keyword: Dict[str, Dict[int, Counter]] = defaultdict(
        lambda: defaultdict(Counter)
    )

    keyword_total: Counter = Counter()
    # Distinct items per keyword — ``item_id`` is ``subset::index`` so
    # items from different subsets never collide. Matches the
    # "distinct articles" semantics of iwac-dashboard.
    keyword_items: Dict[str, Set[str]] = defaultdict(set)

    countries_set: Set[str] = set()
    newspapers_set: Set[str] = set()
    years_set: Set[int] = set()

    for subset_name, df in dataframes.items():
        if df is None or df.empty or field not in df.columns:
            continue
        has_date = "pub_date" in df.columns
        has_country = "country" in df.columns
        has_newspaper = "newspaper" in df.columns

        for idx in range(len(df)):
            keywords = parse_pipe_separated(df[field].iat[idx])
            if not keywords:
                continue

            year = None
            if has_date:
                year = extract_year(df["pub_date"].iat[idx])
            if year is None:
                continue  # ignore anything undated — timeline needs years

            countries = _pick_countries(df["country"].iat[idx]) if has_country else []
            newspaper = _pick_newspaper(df["newspaper"].iat[idx]) if has_newspaper else None

            if countries:
                countries_set.update(countries)
            if newspaper:
                newspapers_set.add(newspaper)
            years_set.add(year)

            item_id = "%s::%d" % (subset_name, idx)
            for kw in keywords:
                keyword_total[kw] += 1
                keyword_items[kw].add(item_id)
                global_year_keyword[year][kw] += 1
                for c in countries:
                    country_year_keyword[c][year][kw] += 1
                if newspaper:
                    newspaper_year_keyword[newspaper][year][kw] += 1

    if not years_set:
        logger.warning("No dated items found for field %r — output will be empty", field)
        return {
            "field": field,
            "years": [],
            "top_keywords": [],
            "global_series": {},
            "by_country": {},
            "by_newspaper": {},
            "all_keywords": [],
            "stats": {
                "total_keywords": 0,
                "total_occurrences": 0,
                "year_range": None,
                "countries_count": 0,
                "newspapers_count": 0,
            },
        }

    sorted_years = sorted(years_set)

    # Per-series objects intentionally omit a `years` field — the chart
    # reads year labels from the top-level `years` array and aligns all
    # series to it. Repeating the years array inside every series
    # inflates the payload by ~40% across 4,000+ series.

    # Top pool used to build the global per-year series; a shorter
    # slice is surfaced as `top_keywords` for the default display.
    top_pool = [kw for kw, _ in keyword_total.most_common(GLOBAL_TOP_POOL)]

    global_series: Dict[str, Dict[str, Any]] = {}
    for kw in top_pool:
        global_series[kw] = {
            "counts": [int(global_year_keyword[y].get(kw, 0)) for y in sorted_years],
            "total": int(keyword_total[kw]),
            "articles": len(keyword_items[kw]),
        }

    # Country facet — per-country top keywords + series
    by_country: Dict[str, Dict[str, Any]] = {}
    for country in sorted(countries_set):
        country_totals: Counter = Counter()
        for y_map in country_year_keyword[country].values():
            for kw, cnt in y_map.items():
                country_totals[kw] += cnt
        country_top = [kw for kw, _ in country_totals.most_common(PER_FACET_TOP)]
        by_country[country] = {
            "top_keywords": country_top,
            "series": {
                kw: {
                    "counts": [int(country_year_keyword[country][y].get(kw, 0)) for y in sorted_years],
                }
                for kw in country_top
            },
            "total_keywords": len(country_totals),
        }

    # Newspaper facet — emitted for every newspaper that has any
    # keyword data. If ``NEWSPAPER_FACET_LIMIT`` is set, only the
    # top-N by total mention volume are kept (legacy cap); current
    # default is None which means "all newspapers" so the filter
    # dropdown in the UI never lists a newspaper without data.
    top_newspapers: Optional[Set[str]] = None
    if NEWSPAPER_FACET_LIMIT is not None:
        newspaper_volume: Counter = Counter()
        for newspaper, y_map in newspaper_year_keyword.items():
            total = 0
            for kw_map in y_map.values():
                total += sum(kw_map.values())
            newspaper_volume[newspaper] = total
        top_newspapers = set(
            n for n, _ in newspaper_volume.most_common(NEWSPAPER_FACET_LIMIT)
        )

    by_newspaper: Dict[str, Dict[str, Any]] = {}
    for newspaper in sorted(newspapers_set):
        if top_newspapers is not None and newspaper not in top_newspapers:
            continue
        n_totals: Counter = Counter()
        for y_map in newspaper_year_keyword[newspaper].values():
            for kw, cnt in y_map.items():
                n_totals[kw] += cnt
        n_top = [kw for kw, _ in n_totals.most_common(PER_FACET_TOP)]
        by_newspaper[newspaper] = {
            "top_keywords": n_top,
            "series": {
                kw: {
                    "counts": [int(newspaper_year_keyword[newspaper][y].get(kw, 0)) for y in sorted_years],
                }
                for kw in n_top
            },
            "total_keywords": len(n_totals),
        }

    all_keywords = [
        {
            "keyword": kw,
            "total": int(cnt),
            "articles": len(keyword_items[kw]),
        }
        for kw, cnt in keyword_total.most_common()
    ]

    return {
        "field": field,
        "years": sorted_years,
        "top_keywords": top_pool[:DEFAULT_TOP_DISPLAY],
        "global_series": global_series,
        "by_country": by_country,
        "by_newspaper": by_newspaper,
        "all_keywords": all_keywords,
        "stats": {
            "total_keywords": len(keyword_total),
            "total_occurrences": int(sum(keyword_total.values())),
            "year_range": [sorted_years[0], sorted_years[-1]],
            "countries_count": len(countries_set),
            "newspapers_count": len(newspapers_set),
        },
    }


def build_metadata(
    dataframes: Dict[str, pd.DataFrame],
    subjects: Dict[str, Any],
    spatial: Dict[str, Any],
) -> Dict[str, Any]:
    """Collection-level metadata for the filter sidebar and dataset
    info card. Countries and newspapers are deduplicated across all
    content subsets."""
    countries: Set[str] = set()
    newspapers: Set[str] = set()
    total_items = 0

    for df in dataframes.values():
        if df is None or df.empty:
            continue
        total_items += int(len(df))
        if "country" in df.columns:
            for raw in df["country"]:
                countries.update(_pick_countries(raw))
        if "newspaper" in df.columns:
            for raw in df["newspaper"]:
                n = _pick_newspaper(raw)
                if n:
                    newspapers.add(n)

    year_range = subjects.get("stats", {}).get("year_range") or spatial.get("stats", {}).get("year_range")

    return {
        "total_articles": total_items,
        "countries": sorted(countries),
        "newspapers": sorted(newspapers),
        "subjects": {
            "total_keywords": subjects["stats"]["total_keywords"],
            "total_occurrences": subjects["stats"]["total_occurrences"],
            "top_5": subjects["top_keywords"][:5],
        },
        "spatial": {
            "total_keywords": spatial["stats"]["total_keywords"],
            "total_occurrences": spatial["stats"]["total_occurrences"],
            "top_5": spatial["top_keywords"][:5],
        },
        "year_range": year_range,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repository ID",
    )
    parser.add_argument(
        "--output-dir",
        default="asset/data",
        help="Directory to write the three JSON files, relative to the module root",
    )
    parser.add_argument(
        "--minify", action=argparse.BooleanOptionalAction, default=False,
        help="Produce compact JSON (no indentation) (default: %(default)s)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    logger = logging.getLogger(__name__)

    token = os.getenv("HF_TOKEN") or None
    if token is None:
        logger.info("No HF_TOKEN set; using anonymous access (public dataset).")

    logger.info("Loading content subsets from %s", args.repo)
    dataframes: Dict[str, pd.DataFrame] = {}
    for subset in CONTENT_SUBSETS:
        df = load_dataset_safe(subset, repo_id=args.repo, token=token)
        if df is None:
            continue
        if "country" in df.columns:
            df["country"] = df["country"].apply(canonicalize_country_field)
        dataframes[subset] = df

    if not dataframes:
        raise RuntimeError("No content subsets loaded — aborting")

    subjects_payload = process_keywords(dataframes, "subject")
    spatial_payload = process_keywords(dataframes, "spatial")
    metadata = build_metadata(dataframes, subjects_payload, spatial_payload)

    output_dir = Path(args.output_dir)
    if not output_dir.is_absolute():
        module_root = Path(__file__).resolve().parent.parent
        output_dir = module_root / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    save_json(subjects_payload, output_dir / "keyword-explorer-subjects.json", minify=args.minify)
    save_json(spatial_payload,  output_dir / "keyword-explorer-spatial.json",  minify=args.minify)
    save_json(metadata,         output_dir / "keyword-explorer-metadata.json", minify=args.minify)

    logger.info("")
    logger.info("Keyword explorer data written to %s", output_dir)
    logger.info("  subjects: %d keywords, %d occurrences",
                subjects_payload["stats"]["total_keywords"],
                subjects_payload["stats"]["total_occurrences"])
    logger.info("  spatial:  %d keywords, %d occurrences",
                spatial_payload["stats"]["total_keywords"],
                spatial_payload["stats"]["total_occurrences"])
    logger.info("  countries: %d, newspapers: %d",
                len(metadata["countries"]), len(metadata["newspapers"]))


if __name__ == "__main__":
    main()
