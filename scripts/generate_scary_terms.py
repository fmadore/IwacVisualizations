#!/usr/bin/env python3
"""
generate_scary_terms.py
========================

Generate the four JSON files consumed by the IwacVisualizations "Scary Terms"
page block:

    asset/data/scary-terms-metadata.json
    asset/data/scary-terms-temporal.json
    asset/data/scary-terms-countries.json
    asset/data/scary-terms-global.json

The block visualizes the frequency of radical / extremism-related French
term families (terrorisme, djihadisme, extrémisme, ...) across the IWAC
``articles`` subset, with three view modes: bar chart race by year, by
country, and a global aggregate.

Derived from ``iwac-dashboard/scripts/generate_scary_terms.py`` and ported
to the shared ``iwac_utils`` helpers. The ``fondamentalisme`` family
deliberately **excludes** ``fondamental`` / ``fondamentale`` — those are the
ordinary adjectives ("basic / essential"), which produce thousands of false
positives unrelated to religious fundamentalism.

Usage
-----
    python scripts/generate_scary_terms.py
    python scripts/generate_scary_terms.py --output-dir asset/data
    python scripts/generate_scary_terms.py --min-country-articles 10

Environment
-----------
    HF_TOKEN    Optional Hugging Face access token (the dataset is public,
                so this is usually unnecessary).
"""
from __future__ import annotations

import argparse
import logging
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    extract_year,
    generate_timestamp,
    load_dataset_safe,
    normalize_country,
    save_json,
)


# =============================================================================
# Term families
# =============================================================================

# Each family maps to the list of French word forms whose occurrences are
# summed into that family's count. Matching is whole-word, case-insensitive.
#
# Note on ``fondamentalisme``: we deliberately do not include ``fondamental``
# or ``fondamentale`` here. They are the ordinary adjectives ("basic /
# essential") and produce thousands of false positives unrelated to the
# religious fundamentalism sense the block is meant to surface.
SCARY_TERMS: Dict[str, List[str]] = {
    "radicalisation": [
        "radical", "radicaliser", "radicalisation", "radicalisme",
        "radicalisé", "radicalisée", "radicalisant", "radicalité",
    ],
    "extrémisme": [
        "extrême", "extrémisme", "extrémiste", "extrémistes",
    ],
    "intégrisme": [
        "intégrisme", "intégriste", "intégristes",
    ],
    "fondamentalisme": [
        "fondamentalisme", "fondamentaliste", "fondamentalistes",
    ],
    "islamisme": [
        "islamisme", "islamiste", "islamistes",
    ],
    "obscurantisme": [
        "obscurantisme", "obscurantiste", "obscurantistes",
    ],
    "terrorisme": [
        "terrorisme", "terroriste", "terroristes",
    ],
    "djihadisme": [
        "djihad", "djihadisme", "djihadiste", "djihadistes",
        "jihad", "jihadisme", "jihadiste", "jihadistes",
    ],
    "salafisme": [
        "salaf", "salafisme", "salafiste", "salafistes",
    ],
    "fanatisme": [
        "fanatique", "fanatisme", "fanatiser", "fanatisé", "fanatisée",
    ],
    "endoctrinement": [
        "endoctriner", "endoctrinement",
        "endoctriné", "endoctrinée", "endoctrinés", "endoctrinées",
    ],
    "wahhabisme": [
        "wahhabisme", "wahhabite", "wahhabites",
        "wahabia", "wahabite", "wahhâbisme",
    ],
}


# =============================================================================
# Text analysis
# =============================================================================

def _compile_patterns(families: Dict[str, List[str]]) -> Dict[str, re.Pattern]:
    """Pre-compile one case-insensitive whole-word regex per family.

    Compiling once and re-using across ~12 000 articles is ~20× faster than
    building a fresh ``re.findall`` pattern per (article, family) pair.
    """
    patterns = {}
    for family, variants in families.items():
        alternation = "|".join(re.escape(v.lower()) for v in variants)
        patterns[family] = re.compile(r"\b(?:" + alternation + r")\b", re.IGNORECASE)
    return patterns


def count_family_occurrences(text: str, pattern: re.Pattern) -> int:
    """Return the number of (overlapping-free) matches of ``pattern`` in ``text``."""
    if not text or not isinstance(text, str):
        return 0
    return len(pattern.findall(text))


# =============================================================================
# Generator
# =============================================================================

class ScaryTermsGenerator:
    """Build the four scary-terms JSON files from the IWAC articles subset."""

    def __init__(
        self,
        output_dir: Path,
        min_country_articles: int = 5,
        repo_id: str = DATASET_ID,
        minify: bool = False,
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.min_country_articles = min_country_articles
        self.repo_id = repo_id
        self.minify = minify
        self.patterns = _compile_patterns(SCARY_TERMS)
        self.df: pd.DataFrame | None = None
        self.logger = logging.getLogger(__name__)

    # ---------------------------------------------------------------------
    #  Data loading / cleaning
    # ---------------------------------------------------------------------

    def load(self) -> None:
        self.logger.info(f"Loading 'articles' subset from {self.repo_id}…")
        df = load_dataset_safe("articles", repo_id=self.repo_id)
        if df is None:
            raise RuntimeError("Failed to load 'articles' subset")

        # Must have lemmatized text to count terms against.
        if "lemma_text" not in df.columns:
            raise RuntimeError("'articles' subset is missing 'lemma_text' column")

        initial = len(df)
        df = df.dropna(subset=["lemma_text"])
        df = df[df["lemma_text"].astype(str).str.strip() != ""]
        self.logger.info(f"Dropped {initial - len(df)} articles with no text")

        # Canonicalize country names (handles "Benin"/"Bénin", "Cote d'Ivoire" etc.)
        if "country" in df.columns:
            df["country"] = df["country"].apply(
                lambda v: normalize_country(v, return_list=False, unknown_value="Unknown")
            )
        else:
            df["country"] = "Unknown"

        # Year from pub_date
        if "pub_date" in df.columns:
            df["year"] = df["pub_date"].apply(extract_year)
            df = df.dropna(subset=["year"])
            df["year"] = df["year"].astype(int)
        else:
            raise RuntimeError("'articles' subset is missing 'pub_date' column")

        self.logger.info(f"Cleaned dataset: {len(df)} articles")
        self.df = df

    # ---------------------------------------------------------------------
    #  Aggregations
    # ---------------------------------------------------------------------

    def _count_row(self, text: str) -> Dict[str, int]:
        """Return ``{family: count}`` for a single article body."""
        out: Dict[str, int] = {}
        for family, pattern in self.patterns.items():
            c = count_family_occurrences(text, pattern)
            if c > 0:
                out[family] = c
        return out

    def build_temporal(self) -> Dict[str, Any]:
        """``{year: {"year": int, "data": [[term, count], ...]}}`` sorted desc."""
        self.logger.info("Aggregating temporal counts…")
        bucket: Dict[int, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

        assert self.df is not None
        for _, row in self.df.iterrows():
            counts = self._count_row(row["lemma_text"])
            if not counts:
                continue
            year_bucket = bucket[int(row["year"])]
            for family, c in counts.items():
                year_bucket[family] += c

        out: Dict[str, Any] = {}
        for year in sorted(bucket.keys()):
            ordered = sorted(bucket[year].items(), key=lambda kv: kv[1], reverse=True)
            out[str(year)] = {
                "year": year,
                "data": [[family, count] for family, count in ordered],
            }
        self.logger.info(f"Temporal data covers {len(out)} years")
        return out

    def build_countries(self) -> Dict[str, Any]:
        """``{country: {"country", "total_articles", "data": [[term, count], ...]}}``"""
        self.logger.info("Aggregating country counts…")
        out: Dict[str, Any] = {}

        assert self.df is not None
        for country, group in self.df.groupby("country"):
            if country in (None, "", "Unknown"):
                continue
            if len(group) < self.min_country_articles:
                continue

            per_family: Dict[str, int] = defaultdict(int)
            for _, row in group.iterrows():
                for family, c in self._count_row(row["lemma_text"]).items():
                    per_family[family] += c

            if not per_family:
                continue

            ordered = sorted(per_family.items(), key=lambda kv: kv[1], reverse=True)
            out[country] = {
                "country": country,
                "total_articles": int(len(group)),
                "data": [[family, count] for family, count in ordered],
            }

        self.logger.info(f"Country data covers {len(out)} countries")
        return out

    def build_global(self) -> Dict[str, Any]:
        """``{"total_articles", "total_occurrences", "data": [[term, count], ...]}``"""
        self.logger.info("Aggregating global counts…")
        per_family: Dict[str, int] = defaultdict(int)

        assert self.df is not None
        for _, row in self.df.iterrows():
            for family, c in self._count_row(row["lemma_text"]).items():
                per_family[family] += c

        ordered = sorted(per_family.items(), key=lambda kv: kv[1], reverse=True)
        return {
            "total_articles": int(len(self.df)),
            "total_occurrences": int(sum(per_family.values())),
            "data": [[family, count] for family, count in ordered],
        }

    # ---------------------------------------------------------------------
    #  Co-occurrence matrix — article-level
    # ---------------------------------------------------------------------

    def build_cooccurrence(self) -> Dict[str, Any]:
        """Build the term × term co-occurrence matrix.

        Definition: two term families co-occur if both appear in the
        same article body, regardless of how many times each variant
        surfaces. Each article contributes +1 to every pair formed by
        the set of families it matches (including the pair {f, f}
        which is tracked separately as ``term_counts``).

        Returns a dict with a ``global`` slice and a ``countries``
        map so the front-end can flip between "All countries" and a
        per-country view without refetching:

            {
              "terms":      [family, ...],                     # canonical order
              "global":     { matrix, term_counts, max_cooccurrence,
                              total_articles },
              "countries":  { country: { matrix, term_counts,
                                         max_cooccurrence, total_articles } }
            }

        ``matrix`` is a 2-D list indexed ``matrix[i][j]`` where
        ``i`` and ``j`` index into ``terms``. The diagonal is zeroed
        (self-co-occurrence is meaningless) — use ``term_counts`` for
        the per-family totals. ``max_cooccurrence`` excludes the
        diagonal so the heatmap's color ramp can be scaled to actual
        pair counts.
        """
        self.logger.info("Building co-occurrence matrix…")
        terms = list(SCARY_TERMS.keys())
        n = len(terms)
        term_idx = {t: i for i, t in enumerate(terms)}

        def blank_slice() -> Dict[str, Any]:
            return {
                "matrix": [[0] * n for _ in range(n)],
                "term_counts": {t: 0 for t in terms},
                "articles": 0,
            }

        global_slice = blank_slice()
        country_slices: Dict[str, Dict[str, Any]] = {}

        assert self.df is not None
        for _, row in self.df.iterrows():
            text = row.get("lemma_text")
            if not isinstance(text, str) or not text:
                continue

            # Which families appear in this article?
            families_present: List[str] = []
            for family, pattern in self.patterns.items():
                if pattern.search(text) is not None:
                    families_present.append(family)
            if not families_present:
                continue

            country = row.get("country")
            country_key = None
            if isinstance(country, str) and country and country != "Unknown":
                country_key = country
                if country_key not in country_slices:
                    country_slices[country_key] = blank_slice()

            def accumulate(slice_: Dict[str, Any]) -> None:
                slice_["articles"] += 1
                # Diagonal: one article containing the family
                # contributes +1 to its own count.
                for f in families_present:
                    slice_["term_counts"][f] += 1
                # Off-diagonal: symmetric pair increments.
                for a_idx in range(len(families_present)):
                    for b_idx in range(a_idx + 1, len(families_present)):
                        fa = term_idx[families_present[a_idx]]
                        fb = term_idx[families_present[b_idx]]
                        slice_["matrix"][fa][fb] += 1
                        slice_["matrix"][fb][fa] += 1

            accumulate(global_slice)
            if country_key is not None:
                accumulate(country_slices[country_key])

        def finalize(slice_: Dict[str, Any]) -> Dict[str, Any]:
            mat = slice_["matrix"]
            max_val = 0
            for i in range(n):
                for j in range(n):
                    if i == j:
                        continue
                    if mat[i][j] > max_val:
                        max_val = mat[i][j]
            return {
                "matrix": mat,
                "term_counts": slice_["term_counts"],
                "max_cooccurrence": max_val,
                "total_articles": slice_["articles"],
            }

        # Drop countries under the min_country_articles threshold so
        # the per-country view only ever lists slices with enough data
        # to be meaningful — matches the behaviour of build_countries.
        finalized_countries: Dict[str, Any] = {}
        for country, slice_ in country_slices.items():
            if slice_["articles"] < self.min_country_articles:
                continue
            finalized_countries[country] = finalize(slice_)

        return {
            "terms": terms,
            "global": finalize(global_slice),
            "countries": finalized_countries,
        }

    # ---------------------------------------------------------------------
    #  Output
    # ---------------------------------------------------------------------

    def write_all(self) -> None:
        assert self.df is not None

        temporal = self.build_temporal()
        save_json(temporal, self.output_dir / "scary-terms-temporal.json", minify=self.minify)

        countries = self.build_countries()
        save_json(countries, self.output_dir / "scary-terms-countries.json", minify=self.minify)

        global_data = self.build_global()
        save_json(global_data, self.output_dir / "scary-terms-global.json", minify=self.minify)

        cooccurrence = self.build_cooccurrence()
        save_json(cooccurrence, self.output_dir / "scary-terms-cooccurrence.json", minify=self.minify)

        years = [int(y) for y in temporal.keys()] if temporal else []
        metadata = {
            "generated_at": generate_timestamp(),
            "total_articles": int(len(self.df)),
            "term_families": list(SCARY_TERMS.keys()),
            "term_families_count": len(SCARY_TERMS),
            "total_variants": sum(len(v) for v in SCARY_TERMS.values()),
            "countries": sorted(countries.keys()),
            "year_range": [min(years), max(years)] if years else [],
            "data_structure": {
                "temporal":     "Scary term occurrences by year for bar chart race",
                "countries":    "Scary term occurrences grouped by country",
                "global":       "Overall scary term occurrences across all articles",
                "cooccurrence": "Term \u00d7 term co-occurrence matrix (global + per-country)",
            },
            "term_definitions": {k: list(v) for k, v in SCARY_TERMS.items()},
        }
        save_json(metadata, self.output_dir / "scary-terms-metadata.json", minify=self.minify)

    # ---------------------------------------------------------------------
    #  Entry point
    # ---------------------------------------------------------------------

    def run(self) -> None:
        self.load()
        self.write_all()
        self.logger.info("Scary terms data generation complete")


# =============================================================================
# CLI
# =============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate scary terms JSON data for the IwacVisualizations block."
    )
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repository ID (default: %(default)s)",
    )
    parser.add_argument(
        "--output-dir",
        default="asset/data",
        help="Where to write the four JSON files (default: asset/data).",
    )
    parser.add_argument(
        "--min-country-articles",
        type=int,
        default=5,
        help="Drop countries with fewer than this many articles (default: 5).",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Produce compact JSON (no indentation) (default: %(default)s)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    ScaryTermsGenerator(
        output_dir=Path(args.output_dir),
        min_country_articles=args.min_country_articles,
        repo_id=args.repo,
        minify=args.minify,
    ).run()


if __name__ == "__main__":
    main()
