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
    python scripts/generate_compare_newspapers.py --top-n 80 --min-cooccurrence 25

Environment
-----------
    HF_TOKEN   Hugging Face access token — required, the default dataset
               is the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from iwac_utils import (
    add_standard_args,
    parse_standard_args,
    CENTRALITE_ORDER,
    ENTITY_TYPE_ORDER,
    POLARITE_ORDER,
    STOPWORDS,
    build_entity_index,
    canonicalize_country_field,
    create_metadata_block,
    dominant,
    extract_year,
    find_column,
    is_unknown,
    load_dataset_safe,
    normalize_location_name,
    parse_pipe_separated,
    place_country_resolver,
    present_sentiment_models,
    resolve_sentiment_columns,
    save_json,
    subjectivite_ordinal,
    tokenize,
)

SUBSETS = ("articles", "publications")

# Tokenisation + stopwords come from iwac_utils (one vocabulary for every
# word cloud); this file used to carry a byte-identical copy "to avoid
# cross-script imports" it was already making.

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
                c for c in parse_pipe_separated(df["country"].iat[idx])
                if not is_unknown(c)
            ]
        for c in country_list:
            countries[c] += 1

        if has_paper:
            for name in parse_pipe_separated(df["newspaper"].iat[idx]):
                if is_unknown(name):
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
        newspaper_list.append({
            "name": name,
            "slug": slugify(name),
            "count": int(entry["count"]),
            "country": dominant(entry["countries"]),
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


def _count_pipe_field(series: pd.Series) -> Counter:
    """Return a full Counter of every non-empty, known pipe-separated value."""
    counter: Counter = Counter()
    for value in series:
        for item in parse_pipe_separated(value):
            if is_unknown(item):
                continue
            counter[item] += 1
    return counter


def build_index_lookups(
    index_df: Optional[pd.DataFrame],
) -> Dict[str, Any]:
    """From the ``index`` authority subset, build lookups used by the
    compare-newspapers generator:

      * ``subject_oid``   — person / organisation / subject / event name → o:id
      * ``place_oid``     — place name → o:id
      * ``place_coords``  — place name → (lat, lng) for geocoded places
      * ``place_country`` — place name → the IWAC country it lies in

    Every key is ``normalize_location_name`` of a title or alias, through
    ``iwac_utils.build_entity_index`` — the same join every other block
    uses — so look a tag up with ``normalize_location_name(tag)``. (This
    used to be a raw, case-sensitive map that also admitted authority
    placeholders, so a tag could link here and not on the dashboards.)

    ``place_country`` is the ``Partie de`` walk
    (``iwac_utils.place_country_resolver``): places outside the six
    countries have no entry. It used to be ``index.countries[0]`` — the
    first country whose press MENTIONS the place — which put most of the
    map's choropleth weight on Bénin whatever the place was.
    """
    out: Dict[str, Dict[str, Any]] = {
        "subject_oid": {}, "place_oid": {}, "place_coords": {}, "place_country": {},
    }
    if index_df is None or index_df.empty:
        return out
    try:
        subjects, _, _ = build_entity_index(
            index_df, types=[t for t in ENTITY_TYPE_ORDER if t != "Lieux"],
        )
        places, _, coords = build_entity_index(index_df, types=["Lieux"])
    except RuntimeError:
        return out
    country_of = place_country_resolver(index_df)

    out["subject_oid"] = {key: info["o_id"] for key, info in subjects.items()}
    for key, info in places.items():
        out["place_oid"][key] = info["o_id"]
        if info["o_id"] in coords:
            out["place_coords"][key] = coords[info["o_id"]]
        country = country_of(info["title"])
        if country:
            out["place_country"][key] = country
    return out


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
    lemma_col = find_column(df, ["lemma_nostop"])
    ocr_col = None
    if lemma_col is None:
        ocr_col = find_column(df, ["OCR", "ocr_text", "text", "content"])
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
    lookups: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Produce the complete per-corpus data payload, or None if empty."""
    sub = _filter_corpus(df, scope, name)
    if sub.empty:
        return None
    lookups = lookups or {}

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

    subject_counter = _count_pipe_field(sub["subject"]) if "subject" in sub.columns else Counter()
    spatial_counter = _count_pipe_field(sub["spatial"]) if "spatial" in sub.columns else Counter()
    language_counter = _count_pipe_field(sub["language"]) if "language" in sub.columns else Counter()

    subject_oids = lookups.get("subject_oid") or {}
    place_oids    = lookups.get("place_oid")     or {}
    place_coords  = lookups.get("place_coords")  or {}
    place_country = lookups.get("place_country") or {}

    def top_list(counter: Counter, limit: int,
                 name_to_oid: Optional[Dict[str, int]] = None) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        for n, c in counter.most_common(limit):
            entry: Dict[str, Any] = {"name": n, "count": int(c)}
            if name_to_oid is not None:
                oid = name_to_oid.get(normalize_location_name(n))
                if oid is not None:
                    entry["o_id"] = int(oid)
            result.append(entry)
        return result

    subjects = top_list(subject_counter, top_n, subject_oids)
    spatial = top_list(spatial_counter, top_n, place_oids)
    languages = top_list(language_counter, 10)

    # Geo points — every spatial tag that joins to a geocoded Lieux
    # authority record contributes a (lat, lng, count, o_id, country)
    # feature. ``country`` powers the front-end's MapLibre choropleth
    # toggle (see asset/js/charts/shared/choropleth.js); points whose
    # place isn't an IWAC country drop out of the choropleth aggregation
    # but still appear as bubbles.
    geo_points: List[Dict[str, Any]] = []
    for place_name, count in spatial_counter.most_common():
        place_key = normalize_location_name(place_name)
        coords = place_coords.get(place_key)
        if coords is None:
            continue
        lat, lng = coords
        entry = {
            "name": place_name,
            "count": int(count),
            "lat": float(lat),
            "lng": float(lng),
        }
        oid = place_oids.get(place_key)
        if oid is not None:
            entry["o_id"] = int(oid)
        # The country the place lies in, or no key at all outside the six.
        country = place_country.get(place_key)
        if country:
            entry["country"] = country
        geo_points.append(entry)

    newspapers: List[Dict[str, Any]] = []
    if scope == "country" and "newspaper" in sub.columns:
        # Break down contents by newspaper for a country-scope corpus.
        paper_counts = _count_pipe_field(sub["newspaper"])
        newspapers = [
            {"name": nm, "count": int(count)}
            for nm, count in paper_counts.most_common(top_n)
        ]

    top_country = None
    country_count = 0
    if scope == "newspaper" and "country" in sub.columns:
        country_counter = _count_pipe_field(sub["country"])
        top_country = dominant(country_counter)
        if top_country is not None:
            country_count = int(country_counter[top_country])

    wordcloud = _top_wordcloud(sub, top_words, min_wordcloud_freq)

    sentiment = _compute_sentiment(sub) if subset == "articles" else None

    summary = {
        "total_items": total_items,
        "total_words": total_words,
        "total_pages": total_pages,
        "year_min": years_sorted[0] if years_sorted else None,
        "year_max": years_sorted[-1] if years_sorted else None,
        # ``unique_*`` is the true distinct count across the whole
        # corpus, not the top-N slice. The top lists below cap at
        # ``top_n`` for UI reasons; this field lets the metric card
        # show the underlying total (e.g., 237 distinct subjects,
        # with a top-60 displayed).
        "unique_subjects": len(subject_counter),
        "unique_spatial": len(spatial_counter),
        "unique_languages": len(language_counter),
        "unique_newspapers": len(newspapers) if scope == "country" else 1,
        "unique_geocoded_places": len(geo_points),
    }
    if top_country is not None:
        summary["top_country"] = top_country
        summary["top_country_count"] = country_count

    payload = {
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
        "geo_points": geo_points,
    }
    if sentiment is not None:
        payload["sentiment"] = sentiment
    return payload


# ---------------------------------------------------------------------------
# Sentiment aggregation (articles only)
# ---------------------------------------------------------------------------

# Ordered so the JSON renders each model's buckets in the canonical
# "very positive → very negative" / "very central → not addressed"
# progression rather than dataset-insertion order.
# (POLARITE_ORDER / CENTRALITE_ORDER are imported from iwac_utils.)


def _labels(sub: pd.DataFrame, column: Optional[str]) -> pd.Series:
    """A sentiment label column as stripped strings, ``""`` where unrated.

    Unannotated and declined rows are ``""`` on the Hub, not null — but a
    snapshot can still carry a real NaN, and ``astype(str)`` turns NaN into
    the truthy string ``"nan"``, which counted every unrated article as
    rated. Fill first, then cast.
    """
    if column is None:
        return pd.Series("", index=sub.index, dtype=object)
    return sub[column].fillna("").astype(str).str.strip()


def _compute_sentiment(sub: pd.DataFrame) -> Dict[str, Any]:
    """Per-model sentiment breakdown for the articles in ``sub``.

    Returns::

        {
          "rated": 1234,
          "models": {
            "gpt_5_6_luna": {
              "polarite":   [ {label, count}, ... ],
              "centralite": [ {label, count}, ... ],
              "subjectivite_avg": 2.31,
              "subjectivite_n": 1220
            },
            "mistral_small_2603": {...},
            "deepseek_v4_flash_0731": {...}
          }
        }

    ``models`` holds only the raters the snapshot actually carries columns
    for (``present_sentiment_models``), in roster order. ``rated`` counts
    the articles at least one of them rated on ANY axis — polarité,
    centralité or subjectivité — the same rule as the dashboards'
    sentiment panel; it used to read polarité alone.
    """
    result: Dict[str, Any] = {"rated": 0, "models": {}}
    rated_mask = pd.Series(False, index=sub.index)

    # Canonical model ids double as the HF column prefixes and as the keys
    # the emitted JSON and the block JS read.
    resolved = resolve_sentiment_columns(sub)

    for model in present_sentiment_models(resolved):
        pol = _labels(sub, resolved[model]["polarite"])
        cen = _labels(sub, resolved[model]["centralite"])
        subj_col = resolved[model]["subjectivite"]

        pol_counter: Counter = Counter(pol[pol.ne("")])
        cen_counter: Counter = Counter(cen[cen.ne("")])

        # Subjectivité is a French label since generation 2, so
        # pd.to_numeric would coerce the whole axis to NaN. Map each value
        # onto its 1..5 ordinal instead. The bucket labels are the English
        # source keys used in iwac-i18n.js (1="Very objective" … 5="Very
        # subjective") so the JS can translate them the same way the
        # person dashboard's sentiment panel does.
        ordinals = (
            [subjectivite_ordinal(value) for value in sub[subj_col]]
            if subj_col is not None else [None] * len(sub)
        )
        levels = [level for level in ordinals if level is not None]
        subj_n = len(levels)
        subj_avg: Optional[float] = None
        subj_buckets: List[Dict[str, Any]] = []
        if subj_n:
            subj_avg = sum(levels) / subj_n
            bucket_counter = Counter(levels)
            for score in range(1, 6):
                count = bucket_counter.get(score, 0)
                if count:
                    subj_buckets.append({
                        "label": str(score),
                        "count": int(count),
                    })

        def ordered(counter: Counter, order: Tuple[str, ...]) -> List[Dict[str, Any]]:
            seen = set()
            out: List[Dict[str, Any]] = []
            for label in order:
                if label in counter:
                    out.append({"label": label, "count": int(counter[label])})
                    seen.add(label)
            # Any stray label the dataset produced that we didn't hard-code
            for label, count in counter.most_common():
                if label not in seen:
                    out.append({"label": label, "count": int(count)})
            return out

        result["models"][model] = {
            "polarite": ordered(pol_counter, POLARITE_ORDER),
            "centralite": ordered(cen_counter, CENTRALITE_ORDER),
            "subjectivite": subj_buckets,
            "subjectivite_avg": subj_avg,
            "subjectivite_n": subj_n,
        }

        # Rated by this model on any axis.
        rated_subj = pd.Series([level is not None for level in ordinals], index=sub.index)
        rated_mask = rated_mask | pol.ne("") | cen.ne("") | rated_subj

    result["rated"] = int(rated_mask.sum())
    return result


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

    # Authority-record join: load the ``index`` subset once so every
    # (corpus, subset) pass can resolve subject / spatial tags to the
    # underlying Lieux / Sujets / Personnes / Organisations record.
    index_df = load_dataset_safe("index", repo_id=repo_id, token=token)
    lookups = build_index_lookups(index_df)
    logger.info(
        "Index lookups: %d subjects, %d places (%d with coords)",
        len(lookups["subject_oid"]),
        len(lookups["place_oid"]),
        len(lookups["place_coords"]),
    )

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
                lookups=lookups,
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

        # Newspaper corpora. Same lookups as the country corpora: without
        # them a newspaper's tags carried no o_id and its map had no points.
        for entry in discovered["newspapers"]:
            payload = compute_corpus(
                df, subset, "newspaper", entry["name"],
                top_n=top_n,
                top_words=top_words,
                min_wordcloud_freq=min_wordcloud_freq,
                year_min=year_min, year_max=year_max,
                lookups=lookups,
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
    add_standard_args(parser, minify_default=True)
    parser.add_argument(
        "--output-dir",
        default="asset/data/compare-newspapers",
        help="Output directory, relative to the module root",
    )
    parser.add_argument("--top-n", type=int, default=60,
                        help="Top-N cutoff for subjects / spatial / languages")
    parser.add_argument("--top-words", type=int, default=120,
                        help="Top-N cutoff for the wordcloud")
    parser.add_argument("--min-cooccurrence", "--min-count",
                        dest="min_cooccurrence", type=int, default=15,
                        help="Skip a country / newspaper corpus with fewer items "
                             "(default: %(default)s). --min-count is a deprecated alias.")
    parser.add_argument("--min-wordcloud-freq", type=int, default=3,
                        help="Drop wordcloud tokens below this frequency")
    parser.add_argument("--year-min", type=int, default=1900)
    parser.add_argument("--year-max", type=int, default=2100)
    args = parse_standard_args(parser)
    logger = logging.getLogger(__name__)

    if any(a == "--min-count" or a.startswith("--min-count=") for a in sys.argv[1:]):
        logger.warning("--min-count is deprecated; use --min-cooccurrence instead.")

    token = os.getenv("HF_TOKEN") or None
    if token is None:
        logger.warning("No HF_TOKEN set — the default dataset is a private mirror; anonymous access will 401 unless --repo points at a public repo.")

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
        min_count=args.min_cooccurrence,
        min_wordcloud_freq=args.min_wordcloud_freq,
        year_min=args.year_min,
        year_max=args.year_max,
        minify=args.minify,
    )


if __name__ == "__main__":
    main()
