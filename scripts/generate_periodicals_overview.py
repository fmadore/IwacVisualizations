#!/usr/bin/env python3
"""
generate_periodicals_overview.py
================================

Generate ``asset/data/periodicals-overview.json`` for the IwacVisualizations
module's Periodicals Overview page block — the corpus-level view of the IWAC
``publications`` subset (Islamic-periodical issues, ``bibo:Issue``).

The block JS (``asset/js/charts/periodicals-overview.js``) loads this single
precomputed JSON and renders all panels from it; no runtime calls to the
Hugging Face datasets-server are made.

Payload shape (top-level keys):

    metadata          — standard provenance block (generatedAt timestamp)
    summary           — issue / periodical / country / language counts,
                        year span, total pages + words
    runs              — per-periodical publication run, shaped for the
                        C.gantt builder: { name, country, year_min,
                        year_max, total }, sorted by first year
    issues_per_year   — per-year × country matrix shaped for C.timeline:
                        { years, countries, series }
    languages         — language histogram (raw French keys so the JS can
                        call P.t('lang_<x>') at render time)
    top_subjects      — top-N subject histogram
    countries         — country histogram

Usage
-----
    python scripts/generate_periodicals_overview.py
    python scripts/generate_periodicals_overview.py --output asset/data/periodicals-overview.json
    python scripts/generate_periodicals_overview.py --top-n-subjects 20 --no-minify

Environment
-----------
    HF_TOKEN   Optional Hugging Face access token (public dataset).
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
    canonicalize_country_field,
    configure_logging,
    create_metadata_block,
    extract_year,
    is_unknown,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

SUBSET = "publications"

# Top-N cap for the subjects ranking panel. Languages and countries are tiny
# closed sets for this subset (a handful of values each) so they ship in full.
TOP_N_SUBJECTS = 20


def _str_or_none(value: Any) -> Optional[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    return s or None


# Local alias for the shared iwac_utils.is_unknown (call sites keep the short name).
_is_unknown = is_unknown


def _clean_list(values: List[str]) -> List[str]:
    return [v for v in (s.strip() for s in values) if v and not _is_unknown(v)]


def _column_sum(df: pd.DataFrame, column: str) -> int:
    """Robust integer sum over a numeric column (NaN-safe)."""
    if column not in df.columns:
        return 0
    return int(pd.to_numeric(df[column], errors="coerce").fillna(0).sum())


# ---------------------------------------------------------------------------
#  Aggregations
# ---------------------------------------------------------------------------

def compute_summary(rows: pd.DataFrame) -> Dict[str, Any]:
    periodicals: set = set()
    countries: set = set()
    languages: set = set()
    year_min: Optional[int] = None
    year_max: Optional[int] = None

    for _, row in rows.iterrows():
        name = _str_or_none(row.get("newspaper"))
        if name and not _is_unknown(name):
            periodicals.add(name)
        for c in _clean_list(parse_pipe_separated(row.get("country"))):
            countries.add(c)
        for l in _clean_list(parse_pipe_separated(row.get("language"))):
            languages.add(l)
        year = extract_year(row.get("pub_date"))
        if year is not None:
            year_min = year if year_min is None else min(year_min, year)
            year_max = year if year_max is None else max(year_max, year)

    return {
        "total":       int(len(rows)),
        "periodicals": len(periodicals),
        "countries":   len(countries),
        "languages":   len(languages),
        "year_min":    year_min,
        "year_max":    year_max,
        "total_pages": _column_sum(rows, "nb_pages"),
        "total_words": _column_sum(rows, "nb_mots"),
    }


def compute_runs(rows: pd.DataFrame) -> List[Dict[str, Any]]:
    """Per-periodical publication runs, shaped to feed C.gantt directly.

    Each entry: ``{ name, country, year_min, year_max, total }``. The
    builder draws a horizontal bar from year_min to year_max per row and
    colors it by ``country`` (C._countryColor); ``total`` lands in the
    tooltip. The ``type`` field is intentionally omitted — every row here
    is a periodical, and the tooltip skips the line when absent.
    """
    logger = logging.getLogger(__name__)
    per: Dict[str, Dict[str, Any]] = {}

    for _, row in rows.iterrows():
        name = _str_or_none(row.get("newspaper"))
        if name is None or _is_unknown(name):
            continue
        rec = per.setdefault(name, {
            "total": 0,
            "countries": Counter(),
            "year_min": None,
            "year_max": None,
        })
        rec["total"] += 1
        for c in _clean_list(parse_pipe_separated(row.get("country"))):
            rec["countries"][c] += 1
        year = extract_year(row.get("pub_date"))
        if year is not None:
            rec["year_min"] = year if rec["year_min"] is None else min(rec["year_min"], year)
            rec["year_max"] = year if rec["year_max"] is None else max(rec["year_max"], year)

    runs: List[Dict[str, Any]] = []
    for name, rec in per.items():
        if rec["year_min"] is None:
            # A run without a single parseable date can't be drawn on a
            # year axis — log it instead of shipping a broken bar.
            logger.warning("  periodical %r has no parseable pub_date; skipped from runs", name)
            continue
        country = rec["countries"].most_common(1)[0][0] if rec["countries"] else ""
        runs.append({
            "name":     name,
            "country":  country,
            "year_min": int(rec["year_min"]),
            "year_max": int(rec["year_max"]),
            "total":    int(rec["total"]),
        })

    runs.sort(key=lambda e: (e["year_min"], e["name"]))
    return runs


def compute_issues_per_year(rows: pd.DataFrame) -> Dict[str, Any]:
    """Per-year × country matrix shaped to feed C.timeline directly.

    Countries are ordered by total issue count (descending) so the stack
    order is stable and the biggest contributor sits at the bottom.
    Issues without a resolvable country or year are skipped, matching the
    collection-overview timeline convention.
    """
    by_year_country: Dict[int, Counter] = defaultdict(Counter)
    country_totals: Counter = Counter()
    seen_years: set = set()

    for _, row in rows.iterrows():
        year = extract_year(row.get("pub_date"))
        if year is None:
            continue
        for country in _clean_list(parse_pipe_separated(row.get("country"))):
            by_year_country[year][country] += 1
            country_totals[country] += 1
            seen_years.add(year)

    if not seen_years:
        return {"years": [], "countries": [], "series": {}}

    years = sorted(seen_years)
    countries_sorted = [c for c, _ in country_totals.most_common()]
    series: Dict[str, List[int]] = {}
    for country in countries_sorted:
        series[country] = [int(by_year_country[y].get(country, 0)) for y in years]

    return {
        "years":     years,
        "countries": countries_sorted,
        "series":    series,
    }


def _top_n_pipe(rows: pd.DataFrame, field: str, n: Optional[int]) -> List[Dict[str, Any]]:
    """Histogram over a pipe-separated column; ``n=None`` keeps all values."""
    counter: Counter = Counter()
    for value in rows.get(field, []):
        for v in _clean_list(parse_pipe_separated(value)):
            counter[v] += 1
    return [
        {"name": name, "count": int(count)}
        for name, count in counter.most_common(n)
    ]


# ---------------------------------------------------------------------------
#  Top-level builder
# ---------------------------------------------------------------------------

def build_periodicals_overview(
    repo_id: str,
    token: Optional[str],
    top_n_subjects: int,
) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Loading IWAC publications subset from %s", repo_id)

    df = load_dataset_safe(SUBSET, repo_id=repo_id, token=token)
    if df is None or df.empty:
        raise RuntimeError("Failed to load publications subset — aborting")

    if "country" in df.columns:
        df["country"] = df["country"].apply(canonicalize_country_field)

    logger.info("  %d periodical issue rows loaded", len(df))

    summary = compute_summary(df)
    runs = compute_runs(df)
    issues_per_year = compute_issues_per_year(df)
    languages = _top_n_pipe(df, "language", None)
    top_subjects = _top_n_pipe(df, "subject", top_n_subjects)
    countries = _top_n_pipe(df, "country", None)

    logger.info(
        "  %d periodical runs, %d timeline years, %d languages, %d countries",
        len(runs),
        len(issues_per_year["years"]),
        len(languages),
        len(countries),
    )

    metadata = create_metadata_block(
        total_records=summary["total"],
        data_source=repo_id,
        script="generate_periodicals_overview.py",
        script_version="0.1.0",
    )

    return {
        "metadata":        metadata,
        "summary":         summary,
        "runs":            runs,
        "issues_per_year": issues_per_year,
        "languages":       languages,
        "top_subjects":    top_subjects,
        "countries":       countries,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repository ID",
    )
    parser.add_argument(
        "--output",
        default="asset/data/periodicals-overview.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument(
        "--top-n-subjects", type=int, default=TOP_N_SUBJECTS,
        help="Number of subjects to keep in the ranking (default: %(default)s)",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Minify the JSON output (default: %(default)s)",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    configure_logging(level=logging.DEBUG if args.verbose else logging.INFO)

    payload = build_periodicals_overview(
        repo_id=args.repo,
        token=os.getenv("HF_TOKEN"),
        top_n_subjects=args.top_n_subjects,
    )

    output_path = Path(args.output)
    save_json(payload, output_path, minify=args.minify)
    logging.getLogger(__name__).info("Wrote %s", output_path)


if __name__ == "__main__":
    main()
