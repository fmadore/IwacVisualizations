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
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    canonicalize_country_field,
    configure_logging,
    create_metadata_block,
    extract_year,
    load_dataset_safe,
    parse_coordinates,
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


def _count_pipe_field(series: pd.Series) -> Counter:
    """Return a full Counter of every non-empty pipe-separated value."""
    counter: Counter = Counter()
    for value in series:
        for item in parse_pipe_separated(value):
            item = item.strip()
            if not item or item.lower() == "unknown":
                continue
            counter[item] += 1
    return counter


def _top_pipe_field(
    series: pd.Series, top_n: int,
    name_to_oid: Optional[Dict[str, int]] = None,
) -> List[Dict[str, Any]]:
    """Count pipe-separated values across a Series and return the top N.

    When ``name_to_oid`` is supplied, enriches each entry with the
    authority-record ``o_id`` so the client can link back to the
    entity's page on the Omeka site.
    """
    counter = _count_pipe_field(series)
    out: List[Dict[str, Any]] = []
    for name, count in counter.most_common(top_n):
        entry: Dict[str, Any] = {"name": name, "count": int(count)}
        if name_to_oid is not None:
            oid = name_to_oid.get(name)
            if oid is not None:
                entry["o_id"] = int(oid)
        out.append(entry)
    return out


def build_index_lookups(
    index_df: Optional[pd.DataFrame],
) -> Dict[str, Any]:
    """From the ``index`` authority subset, build lookups used by the
    compare-newspapers generator:

      * ``subject_oid``  — subject/event/person/org name → o:id
      * ``place_oid``    — place name → o:id
      * ``place_coords`` — place name → (lat, lng) for places that carry
        coordinates in the ``Coordonn\u00e9es`` column

    Title and alternative titles are both indexed, so aliases like
    "Cote d'Ivoire" still join to the canonical record.
    """
    out = {"subject_oid": {}, "place_oid": {}, "place_coords": {}}
    if index_df is None or index_df.empty:
        return out
    if "Titre" not in index_df.columns or "Type" not in index_df.columns:
        return out

    oid_col = "o:id" if "o:id" in index_df.columns else None
    alt_col = "Titre alternatif" if "Titre alternatif" in index_df.columns else None
    coord_col = "Coordonn\u00e9es" if "Coordonn\u00e9es" in index_df.columns else None

    PLACE_TYPES = {"Lieux"}

    for idx in range(len(index_df)):
        title = str(index_df["Titre"].iat[idx] or "").strip()
        if not title:
            continue
        entity_type = str(index_df["Type"].iat[idx] or "").strip()
        oid: Optional[int] = None
        if oid_col is not None:
            raw_oid = index_df[oid_col].iat[idx]
            if raw_oid is not None and not (isinstance(raw_oid, float) and pd.isna(raw_oid)):
                try:
                    oid = int(raw_oid)
                except (TypeError, ValueError):
                    oid = None

        is_place = entity_type in PLACE_TYPES
        aliases = [title]
        if alt_col is not None:
            alt_value = index_df[alt_col].iat[idx]
            for alt in parse_pipe_separated(alt_value):
                alt = alt.strip()
                if alt:
                    aliases.append(alt)

        if is_place:
            # Prefer the first occurrence for a given alias.
            for alias in aliases:
                out["place_oid"].setdefault(alias, oid)
            if coord_col is not None:
                coords = parse_coordinates(index_df[coord_col].iat[idx])
                if coords is not None:
                    for alias in aliases:
                        out["place_coords"].setdefault(alias, coords)
        else:
            for alias in aliases:
                out["subject_oid"].setdefault(alias, oid)

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
    place_oids = lookups.get("place_oid") or {}
    place_coords = lookups.get("place_coords") or {}

    def top_list(counter: Counter, limit: int,
                 name_to_oid: Optional[Dict[str, int]] = None) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        for n, c in counter.most_common(limit):
            entry: Dict[str, Any] = {"name": n, "count": int(c)}
            if name_to_oid is not None:
                oid = name_to_oid.get(n)
                if oid is not None:
                    entry["o_id"] = int(oid)
            result.append(entry)
        return result

    subjects = top_list(subject_counter, top_n, subject_oids)
    spatial = top_list(spatial_counter, top_n, place_oids)
    languages = top_list(language_counter, 10)

    # Geo points — every spatial tag that joins to a geocoded Lieux
    # authority record contributes a (lat, lng, count, o_id) feature.
    geo_points: List[Dict[str, Any]] = []
    for place_name, count in spatial_counter.most_common():
        coords = place_coords.get(place_name)
        if coords is None:
            continue
        lat, lng = coords
        entry = {
            "name": place_name,
            "count": int(count),
            "lat": float(lat),
            "lng": float(lng),
        }
        oid = place_oids.get(place_name)
        if oid is not None:
            entry["o_id"] = int(oid)
        geo_points.append(entry)

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
            {"name": nm, "count": int(count)}
            for nm, count in paper_counts.most_common(top_n)
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

SENTIMENT_MODELS = ("gemini", "chatgpt", "mistral")

# Ordered so the JSON renders each model's buckets in the canonical
# "very positive → very negative" / "very central → not addressed"
# progression rather than dataset-insertion order.
POLARITE_ORDER = (
    "Tr\u00e8s positif",
    "Positif",
    "Neutre",
    "N\u00e9gatif",
    "Tr\u00e8s n\u00e9gatif",
    "Non applicable",
)
CENTRALITE_ORDER = (
    "Tr\u00e8s central",
    "Central",
    "Secondaire",
    "Marginal",
    "Non abord\u00e9",
)


def _compute_sentiment(sub: pd.DataFrame) -> Dict[str, Any]:
    """Per-model sentiment breakdown for the articles in ``sub``.

    Returns::

        {
          "rated": 1234,
          "models": {
            "gemini": {
              "polarite":   [ {label, count}, ... ],
              "centralite": [ {label, count}, ... ],
              "subjectivite_avg": 2.31,
              "subjectivite_n": 1220
            },
            "chatgpt": {...},
            "mistral": {...}
          }
        }
    """
    result: Dict[str, Any] = {"rated": 0, "models": {}}
    rated_mask: Optional[pd.Series] = None

    for model in SENTIMENT_MODELS:
        pol_col = "{}_polarite".format(model)
        cen_col = "{}_centralite_islam_musulmans".format(model)
        subj_col = "{}_subjectivite_score".format(model)

        has_pol = pol_col in sub.columns
        has_cen = cen_col in sub.columns
        has_subj = subj_col in sub.columns
        if not (has_pol or has_cen or has_subj):
            continue

        pol_counter: Counter = Counter()
        if has_pol:
            for value in sub[pol_col]:
                s = str(value).strip() if value is not None else ""
                if not s or s.lower() == "nan":
                    continue
                pol_counter[s] += 1

        cen_counter: Counter = Counter()
        if has_cen:
            for value in sub[cen_col]:
                s = str(value).strip() if value is not None else ""
                if not s or s.lower() == "nan":
                    continue
                cen_counter[s] += 1

        subj_avg: Optional[float] = None
        subj_n = 0
        subj_buckets: List[Dict[str, Any]] = []
        if has_subj:
            numeric = pd.to_numeric(sub[subj_col], errors="coerce").dropna()
            subj_n = int(len(numeric))
            if subj_n:
                subj_avg = float(numeric.mean())
                # Bucket each score into the nearest 1..5 integer so it
                # renders as a distribution bar alongside polarite /
                # centralite. Each label is the English source key used
                # in iwac-i18n.js (1="Very objective" ... 5="Very subjective")
                # so the JS can translate it the same way the sentiment
                # panel in the person dashboard does.
                rounded = numeric.round().clip(1, 5).astype(int)
                bucket_counter = Counter(rounded.tolist())
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

        # Any item rated by at least one model counts as "rated".
        if has_pol:
            m = sub[pol_col].astype(str).str.strip().replace("nan", "")
            m = m.astype(bool)
            rated_mask = m if rated_mask is None else (rated_mask | m)

    if rated_mask is not None:
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
