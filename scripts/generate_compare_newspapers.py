#!/usr/bin/env python3
"""
generate_compare_newspapers.py
==============================

Generate data for the "Compare newspapers" page block.

For each *corpus* — a (type, scope) pair where ``type`` is ``articles`` or
``publications`` and ``scope`` is either a whole country ("Burkina Faso")
or a single newspaper ("Sidwaya") — produce a JSON file with:

    * summary counters (total items, words, pages, year range, uniques)
    * timeline (items per year)
    * top subjects + top spatial tags
    * language breakdown
    * per-newspaper breakdown (country-scope only)
    * wordcloud pairs ([word, count]) from the ``lemma_nostop`` column if
      available, falling back to a quick OCR tokenization

Also emit an ``index.json`` that the browser uses to populate the two
corpus-picker dropdowns. The index is tiny; the per-corpus bundles are
minified because the wordcloud + subject lists add up.

Layout::

    asset/data/compare-newspapers/
        index.json
        articles/
            country-<slug>.json
            newspaper-<slug>.json
        publications/
            country-<slug>.json
            newspaper-<slug>.json

Usage
-----
    python scripts/generate_compare_newspapers.py
    python scripts/generate_compare_newspapers.py --top-n 80 --min-count 25

Environment
-----------
    HF_TOKEN   Optional Hugging Face access token (public dataset).
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import unicodedata
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
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

SUBSETS = ("articles", "publications")

# French stopwords + IWAC-specific noise terms. Kept in sync with
# generate_wordcloud.py — duplicated here to avoid cross-script imports.
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

CUSTOM_STOPWORDS = set("""
article journal page pages numero numéro nombre date lieu monsieur madame
selon ainsi cependant effet toutefois outre certes ailleurs notamment
""".split())

STOPWORDS = FR_STOPWORDS | CUSTOM_STOPWORDS

TOKEN_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


def tokenize(text: Any) -> List[str]:
    if not isinstance(text, str) or not text:
        return []
    return [
        tok for tok in TOKEN_RE.findall(text.lower())
        if len(tok) >= 4 and tok not in STOPWORDS
    ]


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    """Produce a filesystem-safe ASCII slug from a country / newspaper name.

    Diacritics are stripped (NFKD + ASCII filter), case is lowered, and
    any run of non-alphanumeric characters collapses to a single hyphen.
    Leading/trailing hyphens are trimmed.
    """
    if not value:
        return "unknown"
    norm = unicodedata.normalize("NFKD", str(value))
    ascii_only = norm.encode("ascii", "ignore").decode("ascii")
    slug = _SLUG_RE.sub("-", ascii_only.lower()).strip("-")
    return slug or "unknown"


def _int_or_none(value: Any) -> Optional[int]:
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Corpus enumeration
# ---------------------------------------------------------------------------

def discover_corpora(
    df: pd.DataFrame, min_count: int,
) -> Dict[str, List[Dict[str, Any]]]:
    """Walk the subset and return lists of countries and newspapers that
    meet the ``min_count`` threshold. Each entry carries display name,
    slug, and item count so the orchestrator can show counts in the
    dropdown and sort without a second pass.
    """
    countries: Counter = Counter()
    newspapers: Dict[str, Dict[str, Any]] = {}

    has_country = "country" in df.columns
    has_paper = "newspaper" in df.columns

    for idx in range(len(df)):
        country_list: List[str] = []
        if has_country:
            country_list = [
                c.strip() for c in parse_pipe_separated(df["country"].iat[idx])
                if c and c.strip() and c.strip().lower() != "unknown"
            ]
        for c in country_list:
            countries[c] += 1

        if has_paper:
            for name in parse_pipe_separated(df["newspaper"].iat[idx]):
                name = name.strip()
                if not name or name.lower() == "unknown":
                    continue
                entry = newspapers.setdefault(name, {
                    "count": 0,
                    "countries": Counter(),
                })
                entry["count"] += 1
                for c in country_list:
                    entry["countries"][c] += 1

    country_list = [
        {"name": name, "slug": slugify(name), "count": int(count)}
        for name, count in countries.most_common()
        if count >= min_count
    ]

    newspaper_list: List[Dict[str, Any]] = []
    for name, entry in newspapers.items():
        if entry["count"] < min_count:
            continue
        most_common = entry["countries"].most_common(1)
        newspaper_list.append({
            "name": name,
            "slug": slugify(name),
            "count": int(entry["count"]),
            "country": most_common[0][0] if most_common else None,
        })
    newspaper_list.sort(key=lambda e: (-e["count"], e["name"]))

    return {"countries": country_list, "newspapers": newspaper_list}


# ---------------------------------------------------------------------------
# Per-corpus aggregation
# ---------------------------------------------------------------------------

def _filter_corpus(
    df: pd.DataFrame, scope: str, name: str,
) -> pd.DataFrame:
    """Return the subset of ``df`` that belongs to the given scope."""
    if scope == "country":
        if "country" not in df.columns:
            return df.iloc[0:0]
        def contains_country(value: Any) -> bool:
            return any(
                c.strip() == name
                for c in parse_pipe_separated(value)
            )
        mask = df["country"].apply(contains_country)
        return df[mask]
    # scope == "newspaper"
    if "newspaper" not in df.columns:
        return df.iloc[0:0]
    def contains_paper(value: Any) -> bool:
        return any(
            p.strip() == name
            for p in parse_pipe_separated(value)
        )
    mask = df["newspaper"].apply(contains_paper)
    return df[mask]


def _top_pipe_field(
    series: pd.Series, top_n: int,
) -> List[Dict[str, Any]]:
    """Count pipe-separated values across a Series and return the top N."""
    counter: Counter = Counter()
    for value in series:
        for item in parse_pipe_separated(value):
            item = item.strip()
            if not item or item.lower() == "unknown":
                continue
            counter[item] += 1
    return [
        {"name": name, "count": int(count)}
        for name, count in counter.most_common(top_n)
    ]


def _top_wordcloud(
    df: pd.DataFrame, top_n: int, min_frequency: int,
) -> List[List[Any]]:
    """Build a top-N (word, count) list for the corpus.

    Prefers the pre-lemmatized ``lemma_nostop`` column when present (the
    HF dataset's spaCy-processed text, already stop-filtered). Falls back
    to a quick regex tokenization on ``OCR`` for subsets where the lemma
    column is missing.

    Returns a list of [word, count] pairs (ECharts wordcloud shape).
    """
    counter: Counter = Counter()
    lemma_col = "lemma_nostop" if "lemma_nostop" in df.columns else None
    ocr_col = None
    if lemma_col is None:
        for candidate in ("OCR", "ocr_text", "text", "content"):
            if candidate in df.columns:
                ocr_col = candidate
                break
    if lemma_col is None and ocr_col is None:
        return []

    def take(tokens: List[str]) -> None:
        counter.update(tokens)

    if lemma_col is not None:
        for idx in range(len(df)):
            value = df[lemma_col].iat[idx]
            if not isinstance(value, str) or not value:
                continue
            # lemma_nostop is a whitespace-separated lemma stream.
            # Apply the stopword filter again as a safety net for any
            # high-frequency lemmas that slipped through spaCy.
            toks = [
                t for t in value.lower().split()
                if len(t) >= 4 and t not in STOPWORDS and t.isalpha()
            ]
            take(toks)
    else:
        for idx in range(len(df)):
            take(tokenize(df[ocr_col].iat[idx]))

    return [
        [word, int(count)]
        for word, count in counter.most_common(top_n)
        if count >= min_frequency
    ]


def compute_corpus(
    df: pd.DataFrame,
    subset: str,
    scope: str,
    name: str,
    top_n: int,
    top_words: int,
    min_wordcloud_freq: int,
    year_min: int,
    year_max: int,
) -> Optional[Dict[str, Any]]:
    """Produce the complete per-corpus data payload, or None if empty."""
    sub = _filter_corpus(df, scope, name)
    if sub.empty:
        return None

    total_items = int(len(sub))
    total_words = 0
    if "nb_mots" in sub.columns:
        total_words = int(
            pd.to_numeric(sub["nb_mots"], errors="coerce").fillna(0).sum()
        )
    total_pages = 0
    if "nb_pages" in sub.columns:
        total_pages = int(
            pd.to_numeric(sub["nb_pages"], errors="coerce").fillna(0).sum()
        )

    # Timeline — one count per year
    year_counts: Counter = Counter()
    if "pub_date" in sub.columns:
        for value in sub["pub_date"]:
            y = extract_year(value, min_year=year_min, max_year=year_max)
            if y is not None:
                year_counts[y] += 1

    years_sorted = sorted(year_counts.keys())
    timeline = {
        "years": years_sorted,
        "counts": [int(year_counts[y]) for y in years_sorted],
    }

    subjects = (
        _top_pipe_field(sub["subject"], top_n)
        if "subject" in sub.columns else []
    )
    spatial = (
        _top_pipe_field(sub["spatial"], top_n)
        if "spatial" in sub.columns else []
    )
    languages = (
        _top_pipe_field(sub["language"], 10)
        if "language" in sub.columns else []
    )

    newspapers: List[Dict[str, Any]] = []
    if scope == "country" and "newspaper" in sub.columns:
        # Break down contents by newspaper for a country-scope corpus.
        paper_counts: Counter = Counter()
        for value in sub["newspaper"]:
            for p in parse_pipe_separated(value):
                p = p.strip()
                if not p or p.lower() == "unknown":
                    continue
                paper_counts[p] += 1
        newspapers = [
            {"name": name, "count": int(count)}
            for name, count in paper_counts.most_common(top_n)
        ]

    top_country = None
    country_count = 0
    if scope == "newspaper" and "country" in sub.columns:
        country_counter: Counter = Counter()
        for value in sub["country"]:
            for c in parse_pipe_separated(value):
                c = c.strip()
                if c and c.lower() != "unknown":
                    country_counter[c] += 1
        most = country_counter.most_common(1)
        if most:
            top_country, country_count = most[0][0], int(most[0][1])

    wordcloud = _top_wordcloud(sub, top_words, min_wordcloud_freq)

    summary = {
        "total_items": total_items,
        "total_words": total_words,
        "total_pages": total_pages,
        "year_min": years_sorted[0] if years_sorted else None,
        "year_max": years_sorted[-1] if years_sorted else None,
        "unique_subjects": len(subjects),
        "unique_spatial": len(spatial),
        "unique_languages": len(languages),
        "unique_newspapers": len(newspapers) if scope == "country" else 1,
    }
    if top_country is not None:
        summary["top_country"] = top_country
        summary["top_country_count"] = country_count

    return {
        "id": "{}::{}::{}".format(subset, scope, slugify(name)),
        "type": subset,
        "scope": scope,
        "name": name,
        "summary": summary,
        "timeline": timeline,
        "subjects": subjects,
        "spatial": spatial,
        "languages": languages,
        "newspapers": newspapers,
        "wordcloud": wordcloud,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def build_all(
    repo_id: str,
    token: Optional[str],
    output_root: Path,
    top_n: int,
    top_words: int,
    min_count: int,
    min_wordcloud_freq: int,
    year_min: int,
    year_max: int,
    minify: bool,
) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    index: Dict[str, Any] = {"subsets": {}}
    corpus_count = 0

    for subset in SUBSETS:
        df = load_dataset_safe(subset, repo_id=repo_id, token=token)
        if df is None or df.empty:
            logger.warning("Subset %s is empty; skipping", subset)
            index["subsets"][subset] = {"countries": [], "newspapers": []}
            continue

        if "country" in df.columns:
            df["country"] = df["country"].apply(canonicalize_country_field)

        discovered = discover_corpora(df, min_count=min_count)
        logger.info(
            "%s: %d countries, %d newspapers (>= %d items)",
            subset, len(discovered["countries"]), len(discovered["newspapers"]), min_count,
        )

        subset_dir = output_root / subset
        subset_dir.mkdir(parents=True, exist_ok=True)

        # Country corpora
        for entry in discovered["countries"]:
            payload = compute_corpus(
                df, subset, "country", entry["name"],
                top_n=top_n,
                top_words=top_words,
                min_wordcloud_freq=min_wordcloud_freq,
                year_min=year_min, year_max=year_max,
            )
            if payload is None:
                continue
            save_json(
                payload,
                subset_dir / "country-{}.json".format(entry["slug"]),
                minify=minify,
                log=False,
            )
            corpus_count += 1

        # Newspaper corpora
        for entry in discovered["newspapers"]:
            payload = compute_corpus(
                df, subset, "newspaper", entry["name"],
                top_n=top_n,
                top_words=top_words,
                min_wordcloud_freq=min_wordcloud_freq,
                year_min=year_min, year_max=year_max,
            )
            if payload is None:
                continue
            save_json(
                payload,
                subset_dir / "newspaper-{}.json".format(entry["slug"]),
                minify=minify,
                log=False,
            )
            corpus_count += 1

        index["subsets"][subset] = discovered

    index["metadata"] = create_metadata_block(
        total_records=corpus_count,
        data_source=repo_id,
        script="generate_compare_newspapers.py",
        script_version="0.1.0",
        min_count=min_count,
        top_n=top_n,
        top_words=top_words,
    )

    save_json(index, output_root / "index.json", minify=False)
    logger.info("Wrote %d per-corpus JSON files + index.json to %s",
                corpus_count, output_root)
    return index


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DATASET_ID)
    parser.add_argument(
        "--output-dir",
        default="asset/data/compare-newspapers",
        help="Output directory, relative to the module root",
    )
    parser.add_argument("--top-n", type=int, default=60,
                        help="Top-N cutoff for subjects / spatial / languages")
    parser.add_argument("--top-words", type=int, default=120,
                        help="Top-N cutoff for the wordcloud")
    parser.add_argument("--min-count", type=int, default=15,
                        help="Skip a country / newspaper corpus with fewer items")
    parser.add_argument("--min-wordcloud-freq", type=int, default=3,
                        help="Drop wordcloud tokens below this frequency")
    parser.add_argument("--year-min", type=int, default=1900)
    parser.add_argument("--year-max", type=int, default=2100)
    parser.add_argument("--minify", action="store_true", default=True,
                        help="Minify per-corpus JSON (default: True)")
    parser.add_argument("--no-minify", dest="minify", action="store_false")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    logger = logging.getLogger(__name__)

    token = os.getenv("HF_TOKEN") or None
    if token is None:
        logger.info("No HF_TOKEN set; using anonymous access (public dataset).")

    output_root = Path(args.output_dir)
    if not output_root.is_absolute():
        module_root = Path(__file__).resolve().parent.parent
        output_root = module_root / output_root
    output_root.mkdir(parents=True, exist_ok=True)

    build_all(
        repo_id=args.repo,
        token=token,
        output_root=output_root,
        top_n=args.top_n,
        top_words=args.top_words,
        min_count=args.min_count,
        min_wordcloud_freq=args.min_wordcloud_freq,
        year_min=args.year_min,
        year_max=args.year_max,
        minify=args.minify,
    )


if __name__ == "__main__":
    main()
