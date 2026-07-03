#!/usr/bin/env python3
"""
generate_term_trends.py
=======================

Generate the data for the IwacVisualizations "Term Trends" page block
(ROADMAP 9.6 — the "IWAC Ngram viewer"): per-year document frequency for
the most frequent lemmas in the ``articles`` subset, so readers can plot
*any* term over time — a generalization of the Scary Terms block's fixed
vocabulary (Scary Terms counts a curated list; Keyword Explorer counts
item *tagging*; this counts full-text lemmas).

Outputs
-------
    asset/data/term-trends-index.json
        { years: [...], totals: [articles/year], terms: [[term, total_df], ...] }
        Search index + per-year article totals (drives the "% of articles"
        normalization). Sorted by total document frequency, descending.

    asset/data/term-trends/{a..z,0}.json
        { term: [doc-frequency per year, aligned to index.years] }
        One shard per (ASCII-folded) first letter, fetched lazily when the
        reader selects a term. '0' collects the rare non a-z initials.

Counting is document frequency (a term counts once per article per year),
over ``lemma_nostop`` via the shared ``iwac_utils.tokenize`` vocabulary
(≥ 4 chars, grammar stop-list) — the same token space as the collection
word cloud, so numbers agree across blocks.

Usage
-----
    python scripts/generate_term_trends.py
    python scripts/generate_term_trends.py --max-terms 5000 --min-total 25
"""
from __future__ import annotations

import argparse
import logging
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    extract_year,
    generate_timestamp,
    load_dataset_safe,
    save_json,
    tokenize,
)


def shard_key(term: str) -> str:
    """First ASCII-folded letter of the term, or '0' for anything else.

    MUST stay in sync with the client-side counterpart in
    asset/js/charts/term-trends.js (shardKey) — both fold diacritics via
    Unicode decomposition so 'école' lands in the 'e' shard on each side.
    """
    if not term:
        return "0"
    folded = unicodedata.normalize("NFD", term[0]).encode("ascii", "ignore").decode("ascii").lower()
    return folded if folded and "a" <= folded <= "z" else "0"


def generate(
    repo_id: str,
    output_dir: Path,
    max_terms: int,
    min_total: int,
    minify: bool,
) -> None:
    logger = logging.getLogger(__name__)
    df = load_dataset_safe("articles", repo_id=repo_id)
    if df is None:
        raise RuntimeError("Failed to load 'articles' subset")

    text_col = "lemma_nostop" if "lemma_nostop" in df.columns else "lemma_text"
    if text_col not in df.columns:
        raise RuntimeError("'articles' subset is missing lemma columns")
    if "pub_date" not in df.columns:
        raise RuntimeError("'articles' subset is missing 'pub_date'")
    logger.info(f"Tokenizing {len(df)} articles from '{text_col}'…")

    # Per-year article totals + per-(term, year) document frequency.
    totals_by_year: Counter = Counter()
    term_year_df: Dict[str, Counter] = defaultdict(Counter)
    term_total: Counter = Counter()

    for i in range(len(df)):
        year = extract_year(df["pub_date"].iat[i])
        if year is None:
            continue
        tokens = set(tokenize(df[text_col].iat[i]))
        if not tokens:
            continue
        totals_by_year[year] += 1
        for tok in tokens:
            term_year_df[tok][year] += 1
            term_total[tok] += 1

    if not totals_by_year:
        raise RuntimeError("No dated articles with tokens found")

    years = list(range(min(totals_by_year), max(totals_by_year) + 1))
    year_idx = {y: i for i, y in enumerate(years)}
    logger.info(
        f"{len(term_total)} distinct terms across {len(years)} years "
        f"({years[0]}–{years[-1]})")

    # Vocabulary cut: top max_terms by total document frequency, with a
    # floor so the tail stays meaningful. Ties break alphabetically for
    # reproducible output.
    kept = [
        (t, int(c)) for t, c in
        sorted(term_total.items(), key=lambda kv: (-kv[1], kv[0]))
        if c >= min_total
    ][:max_terms]
    logger.info(
        f"Keeping {len(kept)} terms (max {max_terms}, min total {min_total})")

    shards: Dict[str, Dict[str, List[int]]] = defaultdict(dict)
    for term, _total in kept:
        counts = [0] * len(years)
        for y, c in term_year_df[term].items():
            counts[year_idx[y]] = int(c)
        shards[shard_key(term)][term] = counts

    shard_dir = output_dir / "term-trends"
    for key, terms in sorted(shards.items()):
        save_json(terms, shard_dir / f"{key}.json", minify=True)
    logger.info(f"Wrote {len(shards)} shards to {shard_dir}")

    index = {
        "generated_at": generate_timestamp(),
        "total_articles": int(sum(totals_by_year.values())),
        "min_total": min_total,
        "years": years,
        "totals": [int(totals_by_year.get(y, 0)) for y in years],
        "terms": [[t, c] for t, c in kept],
    }
    save_json(index, output_dir / "term-trends-index.json", minify=minify)
    logger.info("Term trends data generation complete")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate the Term Trends (Ngram viewer) data bundles."
    )
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repository ID (default: %(default)s)",
    )
    parser.add_argument(
        "--output-dir",
        default="asset/data",
        help="Where to write the bundles (default: asset/data).",
    )
    parser.add_argument(
        "--max-terms",
        type=int,
        default=5000,
        help="Vocabulary cap by total document frequency (default: %(default)s).",
    )
    parser.add_argument(
        "--min-total",
        type=int,
        default=25,
        help="Drop terms appearing in fewer articles overall (default: %(default)s).",
    )
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
    generate(
        repo_id=args.repo,
        output_dir=Path(args.output_dir),
        max_terms=args.max_terms,
        min_total=args.min_total,
        minify=args.minify,
    )


if __name__ == "__main__":
    main()
