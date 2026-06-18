#!/usr/bin/env python3
"""
generate_lexical_metrics.py
===========================

Generate ``asset/data/lexical-metrics.json`` for the IwacVisualizations
module's Press Language page block — corpus-level lexical metrics of the
IWAC ``articles`` subset, computed from the OCR text by the dataset
pipeline:

    Lisibilite_OCR          Flesch reading-ease score (French
                            adaptation) — higher = easier to read
    Richesse_Lexicale_OCR   type-token ratio — higher = more varied
                            vocabulary
    nb_mots                 word count per article

NaNs are excluded per metric: an article missing one score still
contributes to the others. Means are rounded (readability 1 dp,
richness 3 dp, words to the nearest integer) so the JSON stays small.

Payload shape (top-level keys):

    metadata     — standard provenance block
    summary      — article count, year span, corpus-wide mean (+ n)
                   per metric
    by_year      — aligned arrays {years, count, readability,
                   richness, words}; null where a year has no values
                   for that metric (articles without a parseable year
                   are skipped here but still count in summary /
                   newspapers / countries)
    newspapers   — per newspaper with >= --min-articles articles:
                   {name, country, count, readability, richness,
                   words}, sorted by article count
    countries    — same shape per country (no minimum)

Usage
-----
    python scripts/generate_lexical_metrics.py
    python scripts/generate_lexical_metrics.py --output asset/data/lexical-metrics.json
    python scripts/generate_lexical_metrics.py --min-articles 50 --no-minify -v

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

from iwac_utils import (
    DATASET_ID,
    canonicalize_country_field,
    clean_float,
    clean_str,
    configure_logging,
    create_metadata_block,
    extract_year,
    is_unknown,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

SUBSET = "articles"

# A newspaper needs a minimum corpus before its mean readability /
# richness is meaningful enough to rank.
MIN_ARTICLES_PER_NEWSPAPER = 50

# metric key → (source column, rounding decimals; None = round to int)
METRICS: Dict[str, Any] = {
    "readability": ("Lisibilite_OCR", 1),
    "richness":    ("Richesse_Lexicale_OCR", 3),
    "words":       ("nb_mots", None),
}


def _round_metric(value: float, decimals: Optional[int]) -> Any:
    if decimals is None:
        return int(round(value))
    return round(value, decimals)


# Local alias for the shared iwac_utils.is_unknown (call sites keep the short name).
_is_unknown = is_unknown


class _MeanAcc:
    """Streaming mean accumulator per metric key (NaN-safe via clean_float)."""

    __slots__ = ("count", "sums", "ns")

    def __init__(self) -> None:
        self.count = 0
        self.sums = {k: 0.0 for k in METRICS}
        self.ns = {k: 0 for k in METRICS}

    def add(self, values: Dict[str, Optional[float]]) -> None:
        self.count += 1
        for key, value in values.items():
            if value is not None:
                self.sums[key] += value
                self.ns[key] += 1

    def mean(self, key: str) -> Optional[Any]:
        n = self.ns[key]
        if not n:
            return None
        return _round_metric(self.sums[key] / n, METRICS[key][1])


# ---------------------------------------------------------------------------
#  Top-level builder
# ---------------------------------------------------------------------------

def build_lexical_metrics(
    repo_id: str,
    token: Optional[str],
    min_articles: int,
) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Loading IWAC articles subset from %s", repo_id)

    df = load_dataset_safe(SUBSET, repo_id=repo_id, token=token)
    if df is None or df.empty:
        raise RuntimeError("Failed to load articles subset — aborting")

    if "country" in df.columns:
        df["country"] = df["country"].apply(canonicalize_country_field)

    logger.info("  %d article rows loaded", len(df))

    overall = _MeanAcc()
    by_year: Dict[int, _MeanAcc] = defaultdict(_MeanAcc)
    by_newspaper: Dict[str, _MeanAcc] = defaultdict(_MeanAcc)
    newspaper_countries: Dict[str, Counter] = defaultdict(Counter)
    by_country: Dict[str, _MeanAcc] = defaultdict(_MeanAcc)
    no_year = 0

    for _, row in df.iterrows():
        values = {
            key: clean_float(row.get(column))
            for key, (column, _decimals) in METRICS.items()
        }
        overall.add(values)

        year = extract_year(row.get("pub_date"))
        if year is not None:
            by_year[year].add(values)
        else:
            no_year += 1

        countries = [
            c for c in parse_pipe_separated(row.get("country"))
            if c and not _is_unknown(c)
        ]
        for country in countries:
            by_country[country].add(values)

        newspaper = clean_str(row.get("newspaper"))
        if newspaper and not _is_unknown(newspaper):
            by_newspaper[newspaper].add(values)
            for country in countries:
                newspaper_countries[newspaper][country] += 1

    if no_year:
        logger.info("  %d articles without a parseable year (kept out of by_year only)", no_year)

    # -- by_year: aligned arrays over the sorted year axis -------------------
    years = sorted(by_year.keys())
    by_year_payload: Dict[str, List[Any]] = {
        "years": years,
        "count": [by_year[y].count for y in years],
    }
    for key in METRICS:
        by_year_payload[key] = [by_year[y].mean(key) for y in years]

    # -- newspapers: minimum corpus filter, sorted by article count ----------
    newspapers: List[Dict[str, Any]] = []
    for name, acc in by_newspaper.items():
        if acc.count < min_articles:
            continue
        countries_counter = newspaper_countries.get(name)
        entry: Dict[str, Any] = {
            "name": name,
            "country": countries_counter.most_common(1)[0][0] if countries_counter else "",
            "count": acc.count,
        }
        for key in METRICS:
            entry[key] = acc.mean(key)
        newspapers.append(entry)
    newspapers.sort(key=lambda e: (-e["count"], e["name"]))

    countries_payload: List[Dict[str, Any]] = []
    for name in sorted(by_country, key=lambda c: -by_country[c].count):
        acc = by_country[name]
        entry = {"name": name, "count": acc.count}
        for key in METRICS:
            entry[key] = acc.mean(key)
        countries_payload.append(entry)

    summary: Dict[str, Any] = {
        "articles": int(len(df)),
        "year_min": years[0] if years else None,
        "year_max": years[-1] if years else None,
    }
    for key in METRICS:
        summary[f"{key}_mean"] = overall.mean(key)
        summary[f"{key}_n"] = overall.ns[key]

    logger.info(
        "  %d timeline years, %d newspapers with >= %d articles, %d countries",
        len(years), len(newspapers), min_articles, len(countries_payload),
    )
    logger.info(
        "  corpus means — readability %s (n=%d), richness %s (n=%d), words %s (n=%d)",
        summary["readability_mean"], summary["readability_n"],
        summary["richness_mean"], summary["richness_n"],
        summary["words_mean"], summary["words_n"],
    )

    metadata = create_metadata_block(
        total_records=summary["articles"],
        data_source=repo_id,
        script="generate_lexical_metrics.py",
        script_version="0.1.0",
        minArticlesPerNewspaper=min_articles,
    )

    return {
        "metadata":   metadata,
        "summary":    summary,
        "by_year":    by_year_payload,
        "newspapers": newspapers,
        "countries":  countries_payload,
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
        default="asset/data/lexical-metrics.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument(
        "--min-articles", type=int, default=MIN_ARTICLES_PER_NEWSPAPER,
        help="Minimum article count for a newspaper to be ranked (default: %(default)s)",
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

    payload = build_lexical_metrics(
        repo_id=args.repo,
        token=os.getenv("HF_TOKEN"),
        min_articles=args.min_articles,
    )

    output_path = Path(args.output)
    save_json(payload, output_path, minify=args.minify)
    logging.getLogger(__name__).info("Wrote %s", output_path)


if __name__ == "__main__":
    main()
