#!/usr/bin/env python3
"""
generate_sentiment_atlas.py
===========================

Generate ``asset/data/sentiment-atlas.json`` for the IwacVisualizations
module's Sentiment Atlas page block — the corpus-level view of the AI
sentiment ratings on the IWAC ``articles`` subset.

Three language models (gemini = Gemini 3 Flash, chatgpt = GPT-5 mini,
mistral = Ministral 14B) rated each article's *polarité*, *centralité de
l'islam et des musulmans*, and *subjectivité* (1 = très objectif … 5 =
très subjectif). Not every article is rated; the per-model ``rated``
counts make that explicit. These are AI-generated assessments, not
human-curated archival metadata — the block JS surfaces that caveat on
every panel.

Articles whose ``pub_date`` yields no parseable year are excluded from
all aggregates (their count is recorded in ``metadata.excludedNoYear``).

Payload shape (top-level keys):

    metadata          — standard provenance block (+ excludedNoYear)
    summary           — total articles with a year, year span, and per
                        model {rated, not_applicable} counts
    polarity_order    — canonical polarity labels, most positive first:
                        Très positif, Positif, Neutre, Négatif,
                        Très négatif, Non applicable
    centrality_order  — canonical centralité labels: Très central,
                        Central, Secondaire, Marginal, Non abordé
    subjectivity_levels — the 1–5 subjectivité scale used by the
                        correlation matrix
    extreme_categories — ids of the extreme-sentiment keyword buckets
    years             — sorted list of years; every per-year series
                        below is aligned to this axis
    countries         — country list ordered by total rated mentions;
                        every per-country series is aligned to it
    models            — per model: rated / not_applicable counts,
                        polarity_by_year, centrality_by_year,
                        polarity_by_country (label → aligned counts),
                        subjectivity_by_year {mean, n}, correlation
                        (polarity label → counts at subjectivité 1..5),
                        centrality_heatmap (sparse [countryIdx, yearIdx,
                        mean, n] cells of mean centralité intensity), and
                        extremes (category → {n, subject, spatial} top-N
                        keyword lists)
    agreement         — per model pair: co-rated article count, % with
                        the identical polarity label, and the 6×6
                        polarity cross-tab (rows = first model, cols =
                        second model, both in polarity_order)

Usage
-----
    python scripts/generate_sentiment_atlas.py
    python scripts/generate_sentiment_atlas.py --output asset/data/sentiment-atlas.json
    python scripts/generate_sentiment_atlas.py --no-minify -v

Environment
-----------
    HF_TOKEN   Optional Hugging Face access token (public dataset).
"""
from __future__ import annotations

import argparse
import logging
import os
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from iwac_utils import (
    DATASET_ID,
    canonicalize_country_field,
    clean_float,
    clean_str,
    configure_logging,
    create_metadata_block,
    extract_year,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

SUBSET = "articles"

MODELS: Tuple[str, ...] = ("gemini", "chatgpt", "mistral")

# Canonical scale orders — the JS renders stacks / matrix axes in this
# exact order (most positive / most central first).
POLARITY_ORDER: Tuple[str, ...] = (
    "Très positif",
    "Positif",
    "Neutre",
    "Négatif",
    "Très négatif",
    "Non applicable",
)
CENTRALITY_ORDER: Tuple[str, ...] = (
    "Très central",
    "Central",
    "Secondaire",
    "Marginal",
    "Non abordé",
)

NOT_APPLICABLE = "Non applicable"

_POLARITY_IDX = {label: i for i, label in enumerate(POLARITY_ORDER)}

# Centralité label → ordinal intensity (5 = most central). "Non abordé"
# floors the scale; "Non applicable" / missing are excluded from the
# country × year intensity heatmap entirely.
CENTRALITY_SCORES: Dict[str, int] = {
    "Très central": 5,
    "Central": 4,
    "Secondaire": 3,
    "Marginal": 2,
    "Non abordé": 1,
}

# Subjectivité is a 1–5 integer scale (1 = very objective … 5 = very
# subjective); the polarity × subjectivity correlation matrix keys on it.
SUBJECTIVITY_LEVELS: Tuple[int, ...] = (1, 2, 3, 4, 5)

# Extreme-sentiment buckets for the keyword panel. Thresholds mirror the
# sibling IWAC-sentiment-analysis study (subjectivité ≥ 4 / ≤ 2; the most
# extreme polarity and centrality labels).
EXTREME_CATEGORIES: Tuple[str, ...] = (
    "subjectivity_high",
    "subjectivity_low",
    "polarity_very_negative",
    "polarity_very_positive",
    "centrality_very_central",
    "centrality_marginal",
)

# Keep the top-N keywords per (model, category, kind); enough for a bar
# panel while keeping the payload small.
EXTREME_TOP_N = 25

# Drop keyword tokens shorter than this (matches the sibling's len > 2).
_MIN_KEYWORD_LEN = 3


def _label(value: Any) -> Optional[str]:
    """Clean a rating cell; None for empty / NaN / literal 'nan'."""
    s = clean_str(value)
    if not s or s.lower() in {"nan", "none", "null"}:
        return None
    return s


def _is_unknown(value: str) -> bool:
    if not value:
        return True
    return value.lower() in {"unknown", "inconnu", "n/a", "na", "none", "null", "—"}


def _clean_countries(value: Any) -> List[str]:
    return [c for c in parse_pipe_separated(value) if c and not _is_unknown(c)]


def _clean_keywords(value: Any) -> List[str]:
    """Pipe-split a subject/spatial cell, dropping very short tokens."""
    return [k for k in parse_pipe_separated(value) if len(k) >= _MIN_KEYWORD_LEN]


def _extreme_categories(
    pol: Optional[str], cen: Optional[str], subj_int: Optional[int]
) -> List[str]:
    """Which extreme-sentiment buckets a single (model) rating falls into."""
    cats: List[str] = []
    if subj_int is not None:
        if subj_int >= 4:
            cats.append("subjectivity_high")
        if subj_int <= 2:
            cats.append("subjectivity_low")
    if pol == "Très négatif":
        cats.append("polarity_very_negative")
    elif pol == "Très positif":
        cats.append("polarity_very_positive")
    if cen == "Très central":
        cats.append("centrality_very_central")
    elif cen == "Marginal":
        cats.append("centrality_marginal")
    return cats


def _heatmap_cells(
    cells: Dict[Tuple[str, int], List[int]],
    countries: List[str],
    years: List[int],
) -> List[List[Any]]:
    """Flatten a {(country, year): [sum, n]} accumulator into sparse
    ``[countryIdx, yearIdx, mean, n]`` rows aligned to the payload's
    ``countries`` / ``years`` axes. Empty cells are omitted."""
    c_idx = {c: i for i, c in enumerate(countries)}
    y_idx = {y: i for i, y in enumerate(years)}
    out: List[List[Any]] = []
    for (country, year), (total, n) in cells.items():
        if n <= 0:
            continue
        ci = c_idx.get(country)
        yi = y_idx.get(year)
        if ci is None or yi is None:
            continue
        out.append([ci, yi, round(total / n, 2), int(n)])
    out.sort(key=lambda r: (r[0], r[1]))
    return out


# ---------------------------------------------------------------------------
#  Top-level builder
# ---------------------------------------------------------------------------

def build_sentiment_atlas(repo_id: str, token: Optional[str]) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Loading IWAC articles subset from %s", repo_id)

    df = load_dataset_safe(SUBSET, repo_id=repo_id, token=token)
    if df is None or df.empty:
        raise RuntimeError("Failed to load articles subset — aborting")

    total_loaded = int(len(df))

    if "country" in df.columns:
        df["country"] = df["country"].apply(canonicalize_country_field)

    df["_year"] = df["pub_date"].apply(extract_year) if "pub_date" in df.columns else None
    excluded_no_year = int(df["_year"].isna().sum())
    df = df[df["_year"].notna()].copy()
    df["_year"] = df["_year"].astype(int)
    logger.info(
        "  %d article rows loaded, %d kept (%d without a parseable year excluded)",
        total_loaded, len(df), excluded_no_year,
    )

    years: List[int] = sorted(int(y) for y in df["_year"].unique())

    # -- Accumulators -------------------------------------------------------
    # model → label → Counter(year)
    pol_year: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in MODELS}
    cen_year: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in MODELS}
    # model → label → Counter(country)
    pol_country: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in MODELS}
    country_totals: Counter = Counter()
    # model → year → [sum, n]
    subj_year: Dict[str, Dict[int, List[float]]] = {
        m: defaultdict(lambda: [0.0, 0]) for m in MODELS
    }
    rated: Counter = Counter()
    not_applicable: Counter = Counter()
    stray_labels: Counter = Counter()

    # model → polarity label → Counter(subjectivity 1..5)
    corr: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in MODELS}
    # model → (country, year) → [sum_centrality_score, n]
    cen_heat: Dict[str, Dict[Tuple[str, int], List[int]]] = {
        m: defaultdict(lambda: [0, 0]) for m in MODELS
    }
    # model → category → kind ('subject'/'spatial') → Counter(keyword)
    ex_kw: Dict[str, Dict[str, Dict[str, Counter]]] = {
        m: {cat: {"subject": Counter(), "spatial": Counter()} for cat in EXTREME_CATEGORIES}
        for m in MODELS
    }
    # model → category → article count
    ex_n: Dict[str, Counter] = {m: Counter() for m in MODELS}

    pairs: List[Tuple[str, str]] = list(combinations(MODELS, 2))
    co_rated: Counter = Counter()
    agree: Counter = Counter()
    n_labels = len(POLARITY_ORDER)
    matrices: Dict[Tuple[str, str], List[List[int]]] = {
        pair: [[0] * n_labels for _ in range(n_labels)] for pair in pairs
    }

    pol_cols = {m: f"{m}_polarite" for m in MODELS}
    cen_cols = {m: f"{m}_centralite_islam_musulmans" for m in MODELS}
    subj_cols = {m: f"{m}_subjectivite_score" for m in MODELS}

    for _, row in df.iterrows():
        year = int(row["_year"])
        countries = _clean_countries(row.get("country"))
        subject_kw = _clean_keywords(row.get("subject"))
        spatial_kw = _clean_keywords(row.get("spatial"))

        row_pol: Dict[str, Optional[str]] = {}
        for m in MODELS:
            pol = _label(row.get(pol_cols[m]))
            row_pol[m] = pol
            if pol is not None:
                rated[m] += 1
                if pol == NOT_APPLICABLE:
                    not_applicable[m] += 1
                if pol in _POLARITY_IDX:
                    pol_year[m][pol][year] += 1
                    for c in countries:
                        pol_country[m][pol][c] += 1
                        country_totals[c] += 1
                else:
                    stray_labels[f"{m}:{pol}"] += 1

            cen = _label(row.get(cen_cols[m]))
            if cen is not None:
                if cen in CENTRALITY_ORDER:
                    cen_year[m][cen][year] += 1
                elif cen != NOT_APPLICABLE:
                    stray_labels[f"{m}:{cen}"] += 1

            score = clean_float(row.get(subj_cols[m]))
            if score is not None:
                acc = subj_year[m][year]
                acc[0] += score
                acc[1] += 1

            # -- Derived per-model aggregates ---------------------------
            subj_int = int(round(score)) if score is not None and 1 <= score <= 5 else None

            # Polarity × subjectivity correlation (NA excluded).
            if pol in _POLARITY_IDX and pol != NOT_APPLICABLE and subj_int is not None:
                corr[m][pol][subj_int] += 1

            # Centrality intensity by country × year ("Non abordé" floors
            # the scale; "Non applicable" / missing excluded).
            cen_score = CENTRALITY_SCORES.get(cen) if cen is not None else None
            if cen_score is not None:
                for c in countries:
                    cell = cen_heat[m][(c, year)]
                    cell[0] += cen_score
                    cell[1] += 1

            # Extreme-sentiment keyword buckets.
            for cat in _extreme_categories(pol, cen, subj_int):
                ex_n[m][cat] += 1
                ex_kw[m][cat]["subject"].update(subject_kw)
                ex_kw[m][cat]["spatial"].update(spatial_kw)

        for a, b in pairs:
            la, lb = row_pol[a], row_pol[b]
            if la is None or lb is None:
                continue
            if la not in _POLARITY_IDX or lb not in _POLARITY_IDX:
                continue
            co_rated[(a, b)] += 1
            if la == lb:
                agree[(a, b)] += 1
            matrices[(a, b)][_POLARITY_IDX[la]][_POLARITY_IDX[lb]] += 1

    for stray, count in stray_labels.most_common():
        logging.getLogger(__name__).warning(
            "  unexpected rating label %r (%d rows) — excluded from series", stray, count
        )

    # -- Shape the payload ---------------------------------------------------
    countries_sorted = [c for c, _ in country_totals.most_common()]

    models_payload: Dict[str, Any] = {}
    for m in MODELS:
        models_payload[m] = {
            "rated": int(rated[m]),
            "not_applicable": int(not_applicable[m]),
            "polarity_by_year": {
                label: [int(pol_year[m][label].get(y, 0)) for y in years]
                for label in POLARITY_ORDER
            },
            "centrality_by_year": {
                label: [int(cen_year[m][label].get(y, 0)) for y in years]
                for label in CENTRALITY_ORDER
            },
            "polarity_by_country": {
                label: [int(pol_country[m][label].get(c, 0)) for c in countries_sorted]
                for label in POLARITY_ORDER
            },
            "subjectivity_by_year": {
                "mean": [
                    round(subj_year[m][y][0] / subj_year[m][y][1], 2)
                    if subj_year[m][y][1] else None
                    for y in years
                ],
                "n": [int(subj_year[m][y][1]) for y in years],
            },
            "correlation": {
                label: [int(corr[m][label].get(s, 0)) for s in SUBJECTIVITY_LEVELS]
                for label in POLARITY_ORDER if label != NOT_APPLICABLE
            },
            "centrality_heatmap": _heatmap_cells(cen_heat[m], countries_sorted, years),
            "extremes": {
                cat: {
                    "n": int(ex_n[m][cat]),
                    "subject": ex_kw[m][cat]["subject"].most_common(EXTREME_TOP_N),
                    "spatial": ex_kw[m][cat]["spatial"].most_common(EXTREME_TOP_N),
                }
                for cat in EXTREME_CATEGORIES
            },
        }

    agreement: List[Dict[str, Any]] = []
    for a, b in pairs:
        n = int(co_rated[(a, b)])
        agreement.append({
            "models": [a, b],
            "co_rated": n,
            "agreement_pct": round(100.0 * agree[(a, b)] / n, 1) if n else None,
            "matrix": matrices[(a, b)],
        })

    summary = {
        "total": int(len(df)),
        "year_min": years[0] if years else None,
        "year_max": years[-1] if years else None,
        "models": {
            m: {"rated": int(rated[m]), "not_applicable": int(not_applicable[m])}
            for m in MODELS
        },
    }

    for m in MODELS:
        logging.getLogger(__name__).info(
            "  %s: %d rated, %d 'Non applicable'", m, rated[m], not_applicable[m]
        )
    for entry in agreement:
        logging.getLogger(__name__).info(
            "  %s ↔ %s: %d co-rated, %.1f%% identical polarity",
            entry["models"][0], entry["models"][1],
            entry["co_rated"], entry["agreement_pct"] or 0.0,
        )

    metadata = create_metadata_block(
        total_records=total_loaded,
        data_source=repo_id,
        script="generate_sentiment_atlas.py",
        script_version="0.2.0",
        excludedNoYear=excluded_no_year,
    )

    return {
        "metadata": metadata,
        "summary": summary,
        "polarity_order": list(POLARITY_ORDER),
        "centrality_order": list(CENTRALITY_ORDER),
        "subjectivity_levels": list(SUBJECTIVITY_LEVELS),
        "extreme_categories": list(EXTREME_CATEGORIES),
        "years": years,
        "countries": countries_sorted,
        "models": models_payload,
        "agreement": agreement,
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
        default="asset/data/sentiment-atlas.json",
        help="Output JSON path, relative to the module root",
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

    payload = build_sentiment_atlas(
        repo_id=args.repo,
        token=os.getenv("HF_TOKEN"),
    )

    output_path = Path(args.output)
    save_json(payload, output_path, minify=args.minify)
    logging.getLogger(__name__).info("Wrote %s", output_path)


if __name__ == "__main__":
    main()
