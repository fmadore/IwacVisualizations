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
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    extract_year,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
    tokenize,
)

# Tokenization + stopwords now live in ``iwac_utils.tokenize`` so the
# collection word cloud and the per-issue publication word clouds share
# one vocabulary. Extend the stopword sets there, not here.


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
    for candidate in ("OCR", "ocr_text", "OCR_text", "text", "content"):
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

        # country may be pipe-separated — split so each country gets its own
        # bucket and composite "Benin|Burkina Faso" keys don't leak out.
        countries: List[str] = []
        if "country" in df.columns:
            raw = df["country"].iat[idx]
            for c in parse_pipe_separated(raw):
                c = c.strip()
                if c and c.lower() != "unknown":
                    countries.append(c)
        for country in countries:
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DATASET_ID)
    parser.add_argument("--output", default="asset/data/collection-wordcloud.json")
    parser.add_argument("--min-frequency", type=int, default=5)
    parser.add_argument("--max-words", type=int, default=150)
    parser.add_argument("--year-min", type=int, default=1900)
    parser.add_argument("--year-max", type=int, default=2100)
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Produce compact JSON (no indentation) (default: %(default)s)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    result = build_wordcloud(
        repo_id=args.repo,
        min_frequency=args.min_frequency,
        max_words_per_facet=args.max_words,
        year_min=args.year_min,
        year_max=args.year_max,
    )
    save_json(result, Path(args.output), minify=args.minify)
    logging.getLogger(__name__).info("Wrote %s", args.output)


if __name__ == "__main__":
    main()
