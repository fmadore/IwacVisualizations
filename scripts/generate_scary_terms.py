#!/usr/bin/env python3
"""
generate_scary_terms.py
========================

Generate the eight JSON files consumed by the IwacVisualizations "Scary Terms"
page block:

    asset/data/scary-terms-metadata.json
    asset/data/scary-terms-temporal.json
    asset/data/scary-terms-countries.json
    asset/data/scary-terms-global.json
    asset/data/scary-terms-cooccurrence.json
    asset/data/scary-terms-trends.json       (issue #2 — per-country time series)
    asset/data/scary-terms-wordcloud.json    (issue #4 — vocabulary slices)
    asset/data/scary-terms-places.json       (issue #3 — geocoded place mentions)

The block visualizes the frequency of radical / extremism-related French
term families (terrorisme, djihadisme, extrémisme, ...) across the IWAC
``articles`` subset, with view modes: bar chart race by year, by country,
global aggregate, co-occurrence matrix, time-series trends, word cloud,
and a place-mentions map.

The hand-curated historical-event annotations for the trends view live in
``asset/data/scary-terms-events.json`` — a committed file (gitignore
exception, like sentiment-arbiter.json) that this generator does NOT
write; it rides into the CI data archive from the checkout.

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
    python scripts/generate_scary_terms.py --max-words 200 --min-frequency 5

Environment
-----------
    HF_TOKEN    Hugging Face access token — required, the default dataset is
                the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    add_standard_args,
    extract_year,
    generate_timestamp,
    load_dataset_safe,
    normalize_country,
    normalize_location_name,
    parse_coordinates,
    parse_pipe_separated,
    parse_standard_args,
    save_json,
    tokenize,
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

# 5-year buckets for the word-cloud "by period" facet. Floor-based:
# 1960–1964, 1965–1969, … keeps the arithmetic trivial on both sides.
YEAR_BUCKET_SIZE = 5


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


@dataclass
class ArticleScan:
    """Per-article intermediate produced by the single corpus scan.

    This is the "per-article hit matrix" the wordcloud / places passes
    consume (issues #3 / #4) — computed once, reused by every builder.
    ``tokens`` / ``spatial`` are only populated for articles with at
    least one family hit (the only ones the derived views care about).
    """
    year: int
    country: str
    counts: Dict[str, int] = field(default_factory=dict)
    tokens: Optional[Set[str]] = None
    spatial: Optional[List[str]] = None


# =============================================================================
# Generator
# =============================================================================

class ScaryTermsGenerator:
    """Build the scary-terms JSON files from the IWAC articles subset."""

    def __init__(
        self,
        output_dir: Path,
        min_country_articles: int = 5,
        repo_id: str = DATASET_ID,
        minify: bool = False,
        max_words: int = 200,
        min_frequency: int = 5,
        min_place_articles: int = 3,
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.min_country_articles = min_country_articles
        self.repo_id = repo_id
        self.minify = minify
        self.max_words = max_words
        self.min_frequency = min_frequency
        self.min_place_articles = min_place_articles
        self.patterns = _compile_patterns(SCARY_TERMS)
        # Family variants (lowercased) — excluded from the word-cloud
        # vocabulary: they are the selection criterion, so every slice
        # would otherwise just echo the selectors back.
        self.variant_tokens: Set[str] = {
            v.lower() for variants in SCARY_TERMS.values() for v in variants
        } | set(SCARY_TERMS.keys())
        self.df: pd.DataFrame | None = None
        self.scans: List[ArticleScan] | None = None
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
    #  Single corpus scan
    # ---------------------------------------------------------------------

    def _count_row(self, text: str) -> Dict[str, int]:
        """Return ``{family: count}`` for a single article body."""
        out: Dict[str, int] = {}
        for family, pattern in self.patterns.items():
            c = count_family_occurrences(text, pattern)
            if c > 0:
                out[family] = c
        return out

    def scan(self) -> List[ArticleScan]:
        """Scan every article exactly once.

        All builders below consume this list instead of re-running the
        regex pass per aggregation (the pre-issue-#2/#3/#4 version ran
        four full scans; adding three more views would have made seven).
        Token / spatial extraction only happens for hit articles.
        """
        if self.scans is not None:
            return self.scans

        assert self.df is not None
        self.logger.info("Scanning articles (single pass)…")
        has_nostop = "lemma_nostop" in self.df.columns
        has_spatial = "spatial" in self.df.columns
        if not has_nostop:
            self.logger.warning(
                "'lemma_nostop' column missing — word cloud falls back to lemma_text")

        scans: List[ArticleScan] = []
        for _, row in self.df.iterrows():
            counts = self._count_row(row["lemma_text"])
            rec = ArticleScan(
                year=int(row["year"]),
                country=row["country"],
                counts=counts,
            )
            if counts:
                token_src = row["lemma_nostop"] if has_nostop else row["lemma_text"]
                rec.tokens = {
                    tok for tok in tokenize(token_src)
                    if tok not in self.variant_tokens
                }
                if has_spatial:
                    rec.spatial = parse_pipe_separated(row.get("spatial"))
            scans.append(rec)

        hits = sum(1 for s in scans if s.counts)
        self.logger.info(f"Scan complete: {hits} / {len(scans)} articles carry ≥ 1 family hit")
        self.scans = scans
        return scans

    # ---------------------------------------------------------------------
    #  Aggregations (original four bundles)
    # ---------------------------------------------------------------------

    def build_temporal(self) -> Dict[str, Any]:
        """``{year: {"year": int, "data": [[term, count], ...]}}`` sorted desc."""
        self.logger.info("Aggregating temporal counts…")
        bucket: Dict[int, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for rec in self.scan():
            if not rec.counts:
                continue
            year_bucket = bucket[rec.year]
            for family, c in rec.counts.items():
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
        totals: Dict[str, int] = defaultdict(int)
        per_family: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for rec in self.scan():
            if rec.country in (None, "", "Unknown"):
                continue
            totals[rec.country] += 1
            for family, c in rec.counts.items():
                per_family[rec.country][family] += c

        out: Dict[str, Any] = {}
        for country in sorted(totals.keys()):
            if totals[country] < self.min_country_articles:
                continue
            fam = per_family.get(country)
            if not fam:
                continue
            ordered = sorted(fam.items(), key=lambda kv: kv[1], reverse=True)
            out[country] = {
                "country": country,
                "total_articles": int(totals[country]),
                "data": [[family, count] for family, count in ordered],
            }

        self.logger.info(f"Country data covers {len(out)} countries")
        return out

    def build_global(self) -> Dict[str, Any]:
        """``{"total_articles", "total_occurrences", "data": [[term, count], ...]}``"""
        self.logger.info("Aggregating global counts…")
        per_family: Dict[str, int] = defaultdict(int)

        for rec in self.scan():
            for family, c in rec.counts.items():
                per_family[family] += c

        ordered = sorted(per_family.items(), key=lambda kv: kv[1], reverse=True)
        assert self.df is not None
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

        for rec in self.scan():
            families_present = [f for f in terms if f in rec.counts]
            if not families_present:
                continue

            country_key = None
            if rec.country and rec.country != "Unknown":
                country_key = rec.country
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
        # Alphabetical key order so regenerated output is byte-stable
        # regardless of corpus scan order.
        finalized_countries: Dict[str, Any] = {}
        for country in sorted(country_slices):
            slice_ = country_slices[country]
            if slice_["articles"] < self.min_country_articles:
                continue
            finalized_countries[country] = finalize(slice_)

        return {
            "terms": terms,
            "global": finalize(global_slice),
            "countries": finalized_countries,
        }

    # ---------------------------------------------------------------------
    #  Trends — per-year time series, global + per-country (issue #2)
    # ---------------------------------------------------------------------

    def build_trends(self) -> Dict[str, Any]:
        """Aligned per-year occurrence series for the line-chart view.

            {
              "years":      [1961, …, 2025],
              "families":   [family, …],               # canonical order
              "global":     { family: [count/year, …] },
              "by_country": { country: { family: [count/year, …] } }
            }

        Counts are occurrence totals (same semantics as the temporal
        bundle that drives the race). Countries below the
        min_country_articles threshold are dropped, matching the other
        per-country slices.
        """
        self.logger.info("Building trends time series…")
        families = list(SCARY_TERMS.keys())

        years_present = sorted({rec.year for rec in self.scan() if rec.counts})
        if not years_present:
            return {"years": [], "families": families, "global": {}, "by_country": {}}
        years = list(range(years_present[0], years_present[-1] + 1))
        year_idx = {y: i for i, y in enumerate(years)}

        def blank_series() -> Dict[str, List[int]]:
            return {f: [0] * len(years) for f in families}

        global_series = blank_series()
        country_series: Dict[str, Dict[str, List[int]]] = {}
        country_totals: Dict[str, int] = defaultdict(int)

        for rec in self.scan():
            if rec.country and rec.country != "Unknown":
                country_totals[rec.country] += 1
            if not rec.counts or rec.year not in year_idx:
                continue
            yi = year_idx[rec.year]
            for family, c in rec.counts.items():
                global_series[family][yi] += c
            if rec.country and rec.country != "Unknown":
                if rec.country not in country_series:
                    country_series[rec.country] = blank_series()
                for family, c in rec.counts.items():
                    country_series[rec.country][family][yi] += c

        by_country = {
            country: series
            for country, series in sorted(country_series.items())
            if country_totals[country] >= self.min_country_articles
        }
        self.logger.info(
            f"Trends cover {len(years)} years, {len(by_country)} countries")
        return {
            "years": years,
            "families": families,
            "global": global_series,
            "by_country": by_country,
        }

    # ---------------------------------------------------------------------
    #  Word cloud — vocabulary of matching articles (issue #4)
    # ---------------------------------------------------------------------

    def build_wordcloud(self) -> Dict[str, Any]:
        """Document-frequency vocabulary slices for the word-cloud view.

        A content word is credited once per article it appears in, among
        articles containing at least one scary-term variant. The family
        variants themselves are excluded (they are the selection
        criterion). Slices: global, per family, per country, per 5-year
        bucket. Each slice: ``{"data": [[word, count], …],
        "total_articles": int}`` capped at ``max_words`` after the
        ``min_frequency`` floor.
        """
        self.logger.info("Building word-cloud slices…")
        global_counter: Counter = Counter()
        by_family: Dict[str, Counter] = defaultdict(Counter)
        by_country: Dict[str, Counter] = defaultdict(Counter)
        by_bucket: Dict[str, Counter] = defaultdict(Counter)

        totals = Counter()
        family_totals: Counter = Counter()
        country_totals: Counter = Counter()
        bucket_totals: Counter = Counter()

        def bucket_label(year: int) -> str:
            start = (year // YEAR_BUCKET_SIZE) * YEAR_BUCKET_SIZE
            return f"{start}-{start + YEAR_BUCKET_SIZE - 1}"

        for rec in self.scan():
            if not rec.counts or not rec.tokens:
                continue
            totals["articles"] += 1
            global_counter.update(rec.tokens)
            for family in rec.counts:
                by_family[family].update(rec.tokens)
                family_totals[family] += 1
            if rec.country and rec.country != "Unknown":
                by_country[rec.country].update(rec.tokens)
                country_totals[rec.country] += 1
            label = bucket_label(rec.year)
            by_bucket[label].update(rec.tokens)
            bucket_totals[label] += 1

        def flatten(counter: Counter, article_count: int) -> Dict[str, Any]:
            filtered = [
                (w, int(c)) for w, c in counter.most_common()
                if c >= self.min_frequency
            ]
            return {
                "data": filtered[: self.max_words],
                "total_articles": int(article_count),
            }

        result = {
            "generated_at": generate_timestamp(),
            "total_articles": int(totals["articles"]),
            "max_words": self.max_words,
            "min_frequency": self.min_frequency,
            "global": flatten(global_counter, totals["articles"]),
            "by_family": {
                f: flatten(c, family_totals[f])
                for f, c in sorted(by_family.items())
            },
            "by_country": {
                c: flatten(cnt, country_totals[c])
                for c, cnt in sorted(by_country.items())
                if country_totals[c] >= self.min_country_articles
            },
            "by_year_bucket": {
                b: flatten(cnt, bucket_totals[b])
                for b, cnt in sorted(by_bucket.items())
            },
        }
        self.logger.info(
            f"Word cloud: {totals['articles']} articles, "
            f"{len(result['by_family'])} families, "
            f"{len(result['by_country'])} countries, "
            f"{len(result['by_year_bucket'])} periods")
        return result

    # ---------------------------------------------------------------------
    #  Places — geocoded mentions of matching articles (issue #3)
    # ---------------------------------------------------------------------

    def build_places(self) -> Dict[str, Any]:
        """Bubble-map aggregation: which geocoded places are tagged on
        articles containing scary terms.

        Joins ``articles.spatial`` (pipe list of ``index.Titre`` values)
        against the ``index`` subset's ``Lieux`` authority records with
        parseable ``Coordonnées``. Alternative titles resolve to the same
        record. Per place: articles (once per article), per-family and
        per-article-country splits, plus a family-summed per-year map so
        a year filter can land later without a data change.
        """
        self.logger.info(f"Loading 'index' subset from {self.repo_id} for places…")
        index_df = load_dataset_safe("index", repo_id=self.repo_id)
        if index_df is None:
            self.logger.warning("Failed to load 'index' subset — skipping places bundle")
            return {"generated_at": generate_timestamp(), "families": list(SCARY_TERMS.keys()),
                    "min_place_articles": self.min_place_articles, "places": []}

        lieux = index_df[index_df["Type"] == "Lieux"]
        name_to_place: Dict[str, Dict[str, Any]] = {}
        places: Dict[int, Dict[str, Any]] = {}
        for _, row in lieux.iterrows():
            coords = parse_coordinates(row.get("Coordonnées"))
            if coords is None:
                continue
            o_id = int(row["o:id"])
            place = {
                "o_id": o_id,
                "name": str(row.get("Titre") or "").strip(),
                "lat": coords[0],
                "lng": coords[1],
            }
            if not place["name"]:
                continue
            places[o_id] = place
            name_to_place[normalize_location_name(place["name"])] = place
            for alt in parse_pipe_separated(row.get("Titre alternatif")):
                key = normalize_location_name(alt)
                # Never let an alias shadow another place's canonical title.
                if key and key not in name_to_place:
                    name_to_place[key] = place

        self.logger.info(f"Geocoded {len(places)} Lieux authority records")

        stats: Dict[int, Dict[str, Any]] = {}
        unresolved: Counter = Counter()

        for rec in self.scan():
            if not rec.counts or not rec.spatial:
                continue
            # Resolve once per article; a place tagged twice still counts once.
            matched: Set[int] = set()
            for raw in rec.spatial:
                place = name_to_place.get(normalize_location_name(raw))
                if place is None:
                    unresolved[raw] += 1
                    continue
                matched.add(place["o_id"])
            for o_id in matched:
                st = stats.get(o_id)
                if st is None:
                    st = stats[o_id] = {
                        "total": 0,
                        "by_family": defaultdict(int),
                        "by_country": defaultdict(int),
                        "by_year": defaultdict(int),
                        "first_year": rec.year,
                        "last_year": rec.year,
                    }
                st["total"] += 1
                for family in rec.counts:
                    st["by_family"][family] += 1
                if rec.country and rec.country != "Unknown":
                    st["by_country"][rec.country] += 1
                st["by_year"][rec.year] += 1
                st["first_year"] = min(st["first_year"], rec.year)
                st["last_year"] = max(st["last_year"], rec.year)

        if unresolved:
            top_unresolved = ", ".join(
                f"{name} ({n})" for name, n in unresolved.most_common(10))
            self.logger.info(
                f"{len(unresolved)} spatial names had no geocoded Lieux record "
                f"(top: {top_unresolved})")

        out_places: List[Dict[str, Any]] = []
        for o_id, st in stats.items():
            if st["total"] < self.min_place_articles:
                continue
            place = places[o_id]
            out_places.append({
                "o_id": o_id,
                "name": place["name"],
                "lat": place["lat"],
                "lng": place["lng"],
                "total": int(st["total"]),
                "first_year": st["first_year"],
                "last_year": st["last_year"],
                "by_family": dict(sorted(st["by_family"].items(),
                                         key=lambda kv: kv[1], reverse=True)),
                "by_country": dict(sorted(st["by_country"].items(),
                                          key=lambda kv: kv[1], reverse=True)),
                "by_year": {str(y): c for y, c in sorted(st["by_year"].items())},
            })
        out_places.sort(key=lambda p: (-p["total"], p["name"]))

        self.logger.info(
            f"Places bundle: {len(out_places)} places ≥ {self.min_place_articles} articles")
        return {
            "generated_at": generate_timestamp(),
            "families": list(SCARY_TERMS.keys()),
            "min_place_articles": self.min_place_articles,
            "places": out_places,
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

        # The three view bundles added for issues #2/#3/#4 are always
        # minified regardless of --minify: they are data-heavy, never
        # human-diffed (not committed), and lazy-loaded client-side.
        trends = self.build_trends()
        save_json(trends, self.output_dir / "scary-terms-trends.json", minify=True)

        wordcloud = self.build_wordcloud()
        save_json(wordcloud, self.output_dir / "scary-terms-wordcloud.json", minify=True)

        places = self.build_places()
        save_json(places, self.output_dir / "scary-terms-places.json", minify=True)

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
                "cooccurrence": "Term × term co-occurrence matrix (global + per-country)",
                "trends":       "Aligned per-year occurrence series, global + per-country",
                "wordcloud":    "Document-frequency vocabulary of matching articles",
                "places":       "Geocoded place mentions of matching articles",
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
        "--output-dir",
        default="asset/data",
        help="Where to write the JSON files (default: asset/data).",
    )
    parser.add_argument(
        "--min-country-articles",
        type=int,
        default=5,
        help="Drop countries with fewer than this many articles (default: 5).",
    )
    parser.add_argument(
        "--max-words",
        type=int,
        default=200,
        help="Word-cloud slice cap (default: %(default)s).",
    )
    parser.add_argument(
        "--min-frequency",
        type=int,
        default=5,
        help="Word-cloud minimum document frequency (default: %(default)s).",
    )
    parser.add_argument(
        "--min-place-articles",
        type=int,
        default=3,
        help="Drop map places with fewer matching articles (default: %(default)s).",
    )
    add_standard_args(parser, minify_default=False)
    args = parse_standard_args(parser)
    ScaryTermsGenerator(
        output_dir=Path(args.output_dir),
        min_country_articles=args.min_country_articles,
        repo_id=args.repo,
        minify=args.minify,
        max_words=args.max_words,
        min_frequency=args.min_frequency,
        min_place_articles=args.min_place_articles,
    ).run()


if __name__ == "__main__":
    main()
