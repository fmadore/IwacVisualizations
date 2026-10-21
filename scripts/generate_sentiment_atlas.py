#!/usr/bin/env python3
"""
generate_sentiment_atlas.py
===========================

Generate ``asset/data/sentiment-atlas.json`` for the IwacVisualizations
module's Sentiment Atlas page block — the corpus-level view of the AI
sentiment ratings on the IWAC ``articles`` subset.

Several language models rated each article's *polarité*, *centralité de
l'islam et des musulmans*, and *subjectivité* (1 = très objectif … 5 =
très subjectif). The roster is ``iwac_utils.SENTIMENT_MODELS``, narrowed
to whichever ids the loaded snapshot has columns for — named there and
nowhere else, because this docstring spent two annotation generations
advertising the retired January 2026 models. Not every article is rated;
the per-model ``rated`` counts make that explicit. These are AI-generated
assessments, not human-curated archival metadata — the block JS surfaces
that caveat on every panel.

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
    topics            — [{id, label}] LDA topics ordered by article
                        count (outliers excluded); per-model
                        polarity_by_topic aligns to this list
    newspapers        — newspapers with ≥ newspaper_min articles,
                        ordered by article count; per-model
                        polarity_by_newspaper aligns to this list
    newspaper_min     — the article threshold used for `newspapers`
    models            — per model: rated / not_applicable counts,
                        polarity_by_year, centrality_by_year,
                        polarity_by_country (label → aligned counts),
                        polarity_by_topic, polarity_by_newspaper,
                        subjectivity_by_year {mean, n}, correlation
                        (polarity label → counts at subjectivité 1..5),
                        centrality_heatmap (sparse [countryIdx, yearIdx,
                        mean, n] cells of mean centralité intensity), and
                        extremes (category → {n, subject, spatial} top-N
                        keyword lists)
                        Each model also carries `distribution`: its own
                        label counts per dimension (polarity in
                        polarity_order, centrality in centrality_order,
                        subjectivité at 1..5) for the calibration panel.
    agreement         — per model pair: co-rated article count, % with
                        the identical polarity label, and the 6×6
                        polarity cross-tab (rows = first model, cols =
                        second model, both in polarity_order). Kept for
                        block code older than `reliability`, which
                        supersedes it.
    reliability       — per dimension (polarity / centrality /
                        subjectivity): `labels`, then per model pair n,
                        exact %, Cohen's kappa, within-one-step % and
                        quadratic-weighted kappa (polarity: over the five
                        graded labels, "Non applicable" excluded, with
                        its own `n_ordinal`) and the cross-tab; and a
                        `panel` block — Fleiss' kappa and the unanimous
                        share over the articles EVERY model rated
    consensus         — per dimension, over the articles every model
                        rated on the scale: n, unanimous, split (no lone
                        dissenter), mean spread, and per model how often
                        it alone graded above (`up`) or below (`down`)
                        all the others
    trends            — share of negative (polarity Négatif or below),
                        central (centralité Central or above) and
                        subjective (subjectivité ≥ 4) ratings by year:
                        `common` counts only articles every model rated
                        on that dimension (one `n` per year), `available`
                        each model's own ratings (`n` per model); `k` is
                        the target count, aligned to `years`
    ranking           — newspapers with ≥ `min` rated articles, and per
                        model and dimension sparse [newspaperIdx, n,
                        mean, 95% half-width] rows; polarity is the net
                        index −2..+2 ("Non applicable" excluded),
                        centralité and subjectivité 1..5; `omitted`
                        counts the titles under the threshold
    places_file       — the name of the places sidecar below, in the data
                        directory; the block draws its map only when the
                        bundle names one

A second file, ``sentiment-atlas-places.json`` (``--places-output``),
carries the bubble map: geocoded places tagged on the articles (a mention,
not what the article is about) with per model and dimension the rated
count and mean, on the same scales as `ranking`.

Usage
-----
    python scripts/generate_sentiment_atlas.py
    python scripts/generate_sentiment_atlas.py --output asset/data/sentiment-atlas.json
    python scripts/generate_sentiment_atlas.py --no-minify -v

Environment
-----------
    HF_TOKEN   Hugging Face access token — required, the default dataset
               is the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import logging
import os
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from iwac_stats import (
    classify_dissent,
    fleiss_kappa,
    kappa_from_matrix,
    matrix_agreement,
    mean_interval,
)
from iwac_utils import (
    add_standard_args,
    parse_standard_args,
    CENTRALITE_ORDER,
    POLARITE_ORDER,
    SENTIMENT_MODELS,
    build_entity_index,
    canonicalize_country_field,
    clean_str,
    create_metadata_block,
    extract_year,
    is_unknown,
    iter_records,
    lda_topic_id,
    load_dataset_safe,
    normalize_location_name,
    parse_pipe_separated,
    present_sentiment_models,
    resolve_sentiment_columns,
    save_json,
    subjectivite_ordinal,
)

SUBSET = "articles"

# Canonical model ids — the keys the block JS and i18n catalogs use. The
# matching HF column names are resolved at read time (see iwac_utils), and
# only the ids that resolve reach the payload: this constant is the roster
# the project is annotating with, which runs ahead of what the Hub carries.
MODELS: Tuple[str, ...] = SENTIMENT_MODELS

# Canonical scale orders — the JS renders stacks / matrix axes in this
# exact order (most positive / most central first). One definition in
# iwac_utils; these are this generator's English-spelled aliases.
POLARITY_ORDER: Tuple[str, ...] = POLARITE_ORDER
CENTRALITY_ORDER: Tuple[str, ...] = CENTRALITE_ORDER

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

# Newspapers below this article count are dropped from the per-newspaper
# polarity panel (same threshold Press Language uses). If you change it,
# update the block copy in sentiment-atlas/i18n.js (the description
# interpolates the payload's `newspaper_min`).
MIN_NEWSPAPER_ARTICLES = 50

# Drop keyword tokens shorter than this (matches the sibling's len > 2).
_MIN_KEYWORD_LEN = 3

# -- Model comparison (v0.4.0) ------------------------------------------------
# The three rated dimensions, in the order every comparison section lists
# them. Each has a category list (the cross-tab axes, Cohen's and Fleiss'
# kappa) and an ordinal value (consensus, weighted kappa, means):
#   polarity     — polarity_order; ordinal on the net index −2..+2, with
#                  "Non applicable" a category but never a grade (a model
#                  that found no stance has not graded the article neutral)
#   centrality   — centrality_order; ordinal 1..5, "Non abordé" the floor,
#                  as in the country × year heatmap
#   subjectivity — 1..5
DIMENSIONS: Tuple[str, ...] = ("polarity", "centrality", "subjectivity")

POLARITY_INDEX: Dict[str, int] = {
    "Très positif": 2,
    "Positif": 1,
    "Neutre": 0,
    "Négatif": -1,
    "Très négatif": -2,
}

_CENTRALITY_IDX = {label: i for i, label in enumerate(CENTRALITY_ORDER)}

# Polarity's graded labels are every category but the last: the ordinal
# statistics slice the cross-tab to them.
assert POLARITY_ORDER[-1] == NOT_APPLICABLE

# Newspapers below this many rated articles on a measure are left out of the
# ranking (and counted in `omitted`): the most extreme means come from the
# fewest articles, and a whisker cannot make three articles say much. Same
# threshold as the sibling dashboard's ranking.
RANKING_MIN_ARTICLES = 30

# The trend panel's default minimum per point (the reader can lower it to 5
# or raise it); a point under it is drawn as a gap, never as a share of a
# handful. 20 rather than the sibling dashboard's 5, because the panel
# opens on years, not decades: at 5 the thinnest years swung to 20%.
TREND_MIN_COUNT = 20

# (target, dimension, test on the ordinal value). The thresholds are the
# sibling dashboard's: negative = Négatif or Très négatif, central = Central
# or Très central, subjective = Plutôt or Très subjectif.
TREND_TARGETS: Tuple[Tuple[str, str, Any], ...] = (
    ("negative", "polarity", lambda v: v <= -1),
    ("central", "centrality", lambda v: v >= 4),
    ("subjective", "subjectivity", lambda v: v >= 4),
)

# A place's mean is coloured only from this many rated articles up; below
# it the bubble is drawn neutral. One mention's rating is not a place's tone.
PLACE_MIN_RATED = 5

# The places sidecar's name, relative to the data directory. main() writes
# it there unless --places-output says otherwise.
PLACES_FILE = "sentiment-atlas-places.json"


def _label(value: Any) -> Optional[str]:
    """Clean a rating cell; None for empty / NaN / literal 'nan'."""
    s = clean_str(value)
    if not s or s.lower() in {"nan", "none", "null"}:
        return None
    return s


# Local alias for the shared iwac_utils.is_unknown (call sites keep the short name).
_is_unknown = is_unknown


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


def _dimension_labels(dim: str) -> List[str]:
    """A dimension's categories, in the order its cross-tab axes run."""
    if dim == "polarity":
        return list(POLARITY_ORDER)
    if dim == "centrality":
        return list(CENTRALITY_ORDER)
    return [str(level) for level in SUBJECTIVITY_LEVELS]


def _rating(
    pol: Optional[str], cen: Optional[str], subj_int: Optional[int]
) -> Dict[str, Tuple[Optional[int], Optional[int]]]:
    """One model's rating of one article as (category index, ordinal value)
    per dimension; None where it gave none, or none on the scale."""
    return {
        "polarity": (_POLARITY_IDX.get(pol), POLARITY_INDEX.get(pol)),
        "centrality": (_CENTRALITY_IDX.get(cen), CENTRALITY_SCORES.get(cen)),
        "subjectivity": (subj_int - 1 if subj_int is not None else None, subj_int),
    }


def _pct(share: Optional[float]) -> Optional[float]:
    return round(100.0 * share, 1) if share is not None else None


def _round(value: Optional[float], digits: int = 3) -> Optional[float]:
    return round(float(value), digits) if value is not None else None


def _reliability(
    dim: str,
    pairs: List[Tuple[str, str]],
    matrices: Dict[Tuple[str, str], List[List[int]]],
    panel_items: List[List[int]],
) -> Dict[str, Any]:
    """One dimension's agreement block: every pair's statistics + the panel's.

    Exact agreement and Cohen's kappa are categorical, so polarity's
    "Non applicable" stays in them (a model calling an article stance-less
    while another grades it IS a disagreement). Within-one and the
    quadratic-weighted kappa need a scale, so for polarity they run on the
    five graded labels only, with their own n.
    """
    labels = _dimension_labels(dim)
    graded = len(labels) - 1 if dim == "polarity" else len(labels)
    out_pairs: List[Dict[str, Any]] = []
    for a, b in pairs:
        matrix = matrices[(a, b)]
        full = matrix_agreement(matrix)
        scale = [row[:graded] for row in matrix[:graded]]
        ordinal = matrix_agreement(scale)
        out_pairs.append({
            "models": [a, b],
            "n": full["n"],
            "exact": _pct(full["exact"]),
            "kappa": _round(kappa_from_matrix(matrix)),
            "n_ordinal": ordinal["n"],
            "within_one": _pct(ordinal["within_one"]),
            "weighted_kappa": _round(kappa_from_matrix(scale, "quadratic")),
            "matrix": matrix,
        })
    panel = fleiss_kappa(panel_items)
    return {
        "labels": labels,
        "pairs": out_pairs,
        "panel": {
            "n": panel["n"],
            "fleiss_kappa": _round(panel["kappa"]),
            "unanimous": _pct(panel["unanimous"]),
        },
    }


def _place_index(index_df: Any) -> Dict[str, Dict[str, Any]]:
    """Normalised place name → geocoded ``Lieux`` record (titles before
    aliases, through the shared join), so a spatial tag resolves the way it
    does on every other map in the module."""
    lookup, _, coords = build_entity_index(index_df, types=["Lieux"])
    out: Dict[str, Dict[str, Any]] = {}
    for key, info in lookup.items():
        o_id = info["o_id"]
        if o_id in coords:
            out[key] = {
                "o_id": int(o_id),
                "name": info["title"],
                "lat": coords[o_id][0],
                "lng": coords[o_id][1],
            }
    return out


# ---------------------------------------------------------------------------
#  Top-level builder
# ---------------------------------------------------------------------------

def build_sentiment_atlas(
    repo_id: str, token: Optional[str]
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """The atlas payload and its places sidecar, from one pass over the
    articles."""
    logger = logging.getLogger(__name__)
    logger.info("Loading IWAC articles subset from %s", repo_id)

    df = load_dataset_safe(SUBSET, repo_id=repo_id, token=token)
    if df is None or df.empty:
        raise RuntimeError("Failed to load articles subset — aborting")

    # The map's geocoding. A failed index load costs the map, not the atlas.
    index_df = load_dataset_safe("index", repo_id=repo_id, token=token)
    place_by_name: Dict[str, Dict[str, Any]] = {}
    if index_df is not None and not index_df.empty:
        place_by_name = _place_index(index_df)
        logger.info("  %d geocoded place names", len(place_by_name))
    else:
        logger.warning("  index subset unavailable — the places map will be empty")

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

    # Canonical model ids are the HF column prefixes; resolving against the
    # full wish list is what produces the "no columns for model X" warning,
    # and `models` then narrows it to what this snapshot can actually
    # populate. Everything below — accumulators, the pairwise agreement
    # grid, the payload — is sized from `models`, so a model annotated on
    # Omeka but not yet uploaded to the Hub costs an empty facet button
    # rather than appearing as a picker entry over an empty chart.
    resolved = resolve_sentiment_columns(df, models=MODELS)
    models: List[str] = present_sentiment_models(resolved, models=MODELS)
    if not models:
        logger.warning(
            "  no sentiment columns for any of %s — the atlas will have "
            "no model panels", ", ".join(MODELS))
    pol_cols = {m: resolved[m]["polarite"] for m in models}
    cen_cols = {m: resolved[m]["centralite"] for m in models}
    subj_cols = {m: resolved[m]["subjectivite"] for m in models}

    # -- Accumulators -------------------------------------------------------
    # model → label → Counter(year)
    pol_year: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in models}
    cen_year: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in models}
    # model → label → Counter(country)
    pol_country: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in models}
    country_totals: Counter = Counter()
    # model → label → Counter(topic_id) / Counter(newspaper)  (ROADMAP 9.2/9.3)
    pol_topic: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in models}
    pol_newspaper: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in models}
    topic_articles: Counter = Counter()
    topic_labels: Dict[int, str] = {}
    newspaper_articles: Counter = Counter()
    # model → year → [sum, n]
    subj_year: Dict[str, Dict[int, List[float]]] = {
        m: defaultdict(lambda: [0.0, 0]) for m in models
    }
    rated: Counter = Counter()
    not_applicable: Counter = Counter()
    stray_labels: Counter = Counter()

    # model → polarity label → Counter(subjectivity 1..5)
    corr: Dict[str, Dict[str, Counter]] = {m: defaultdict(Counter) for m in models}
    # model → (country, year) → [sum_centrality_score, n]
    cen_heat: Dict[str, Dict[Tuple[str, int], List[int]]] = {
        m: defaultdict(lambda: [0, 0]) for m in models
    }
    # model → category → kind ('subject'/'spatial') → Counter(keyword)
    ex_kw: Dict[str, Dict[str, Dict[str, Counter]]] = {
        m: {cat: {"subject": Counter(), "spatial": Counter()} for cat in EXTREME_CATEGORIES}
        for m in models
    }
    # model → category → article count
    ex_n: Dict[str, Counter] = {m: Counter() for m in models}

    # Every unordered pair, so the count grows quadratically: 3 models give
    # 3 comparison cards, 4 give 6. The JS drives the cross-tab matrix off a
    # facet button per pair and reads the roster from the payload, so this
    # needs no ceiling here — but it is why the comparison section gets
    # visibly denser with each rater added.
    pairs: List[Tuple[str, str]] = list(combinations(models, 2))
    co_rated: Counter = Counter()
    agree: Counter = Counter()
    n_labels = len(POLARITY_ORDER)
    matrices: Dict[Tuple[str, str], List[List[int]]] = {
        pair: [[0] * n_labels for _ in range(n_labels)] for pair in pairs
    }

    # -- Model comparison accumulators (v0.4.0) ----------------------------
    n_cats = {dim: len(_dimension_labels(dim)) for dim in DIMENSIONS}
    # model → dimension → Counter(category index): each model's own shares
    dist: Dict[str, Dict[str, Counter]] = {
        m: {dim: Counter() for dim in DIMENSIONS} for m in models
    }
    # dimension → pair → cross-tab in _dimension_labels order
    dim_matrices: Dict[str, Dict[Tuple[str, str], List[List[int]]]] = {
        dim: {pair: [[0] * n_cats[dim] for _ in range(n_cats[dim])] for pair in pairs}
        for dim in DIMENSIONS
    }
    # dimension → per-category counts of each article every model rated
    panel_items: Dict[str, List[List[int]]] = {dim: [] for dim in DIMENSIONS}
    consensus_acc: Dict[str, Dict[str, Any]] = {
        dim: {"n": 0, "unanimous": 0, "split": 0, "spread": 0,
              "up": Counter(), "down": Counter()}
        for dim in DIMENSIONS
    }
    # target → Counter(year) (common cohort) / model → Counter(year)
    trend_common_n: Dict[str, Counter] = {t: Counter() for t, _, _ in TREND_TARGETS}
    trend_common_k: Dict[str, Dict[str, Counter]] = {
        t: {m: Counter() for m in models} for t, _, _ in TREND_TARGETS
    }
    trend_avail_n: Dict[str, Dict[str, Counter]] = {
        t: {m: Counter() for m in models} for t, _, _ in TREND_TARGETS
    }
    trend_avail_k: Dict[str, Dict[str, Counter]] = {
        t: {m: Counter() for m in models} for t, _, _ in TREND_TARGETS
    }
    # model → dimension → newspaper → [n, sum, sum of squares]
    rank_acc: Dict[str, Dict[str, Dict[str, List[float]]]] = {
        m: {dim: defaultdict(lambda: [0, 0.0, 0.0]) for dim in DIMENSIONS} for m in models
    }
    # place o_id → articles tagged with it; place o_id → model → dim → [n, sum]
    place_n: Counter = Counter()
    place_records: Dict[int, Dict[str, Any]] = {}
    place_acc: Dict[int, Dict[str, Dict[str, List[float]]]] = defaultdict(
        lambda: {m: {dim: [0, 0.0] for dim in DIMENSIONS} for m in models}
    )
    unresolved_places: Counter = Counter()

    for row in iter_records(df):
        year = int(row["_year"])
        countries = _clean_countries(row.get("country"))
        subject_kw = _clean_keywords(row.get("subject"))
        spatial_kw = _clean_keywords(row.get("spatial"))

        topic_id = lda_topic_id(row.get("lda_topic_id"))
        if topic_id is not None:
            topic_articles[topic_id] += 1
            if topic_id not in topic_labels:
                topic_labels[topic_id] = clean_str(row.get("lda_topic_label"))

        newspaper = clean_str(row.get("newspaper"))
        if newspaper and not _is_unknown(newspaper):
            newspaper_articles[newspaper] += 1
        else:
            newspaper = ""

        # Places tagged on the article, each counted once however often it
        # is tagged (pipe-split membership, never a substring).
        place_ids: set = set()
        if place_by_name:
            for raw in parse_pipe_separated(row.get("spatial")):
                place = place_by_name.get(normalize_location_name(raw))
                if place is None:
                    unresolved_places[raw] += 1
                    continue
                place_ids.add(place["o_id"])
                place_records.setdefault(place["o_id"], place)
        for o_id in place_ids:
            place_n[o_id] += 1

        row_pol: Dict[str, Optional[str]] = {}
        # model → dimension → (category index, ordinal value)
        row_rating: Dict[str, Dict[str, Tuple[Optional[int], Optional[int]]]] = {}
        for m in models:
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
                    if topic_id is not None:
                        pol_topic[m][pol][topic_id] += 1
                    if newspaper:
                        pol_newspaper[m][pol][newspaper] += 1
                else:
                    stray_labels[f"{m}:{pol}"] += 1

            cen = _label(row.get(cen_cols[m]))
            if cen is not None:
                if cen in CENTRALITY_ORDER:
                    cen_year[m][cen][year] += 1
                elif cen != NOT_APPLICABLE:
                    stray_labels[f"{m}:{cen}"] += 1

            # Subjectivité is a French label since generation 2, so it
            # goes through the ordinal map rather than clean_float.
            subj_int = subjectivite_ordinal(row.get(subj_cols[m]))
            if subj_int is not None:
                acc = subj_year[m][year]
                acc[0] += subj_int
                acc[1] += 1

            # -- Derived per-model aggregates ---------------------------

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

            # One model's rating on all three dimensions, for the
            # comparison sections, the ranking and the map.
            rating = _rating(pol, cen, subj_int)
            row_rating[m] = rating
            for dim, (cat_idx, value) in rating.items():
                if cat_idx is not None:
                    dist[m][dim][cat_idx] += 1
                if value is None:
                    continue
                if newspaper:
                    acc = rank_acc[m][dim][newspaper]
                    acc[0] += 1
                    acc[1] += value
                    acc[2] += value * value
                for o_id in place_ids:
                    cell = place_acc[o_id][m][dim]
                    cell[0] += 1
                    cell[1] += value

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

        # -- Cross-model accumulators, per dimension --------------------
        for dim in DIMENSIONS:
            cats = {m: row_rating[m][dim][0] for m in models}
            for a, b in pairs:
                ia, ib = cats[a], cats[b]
                if ia is not None and ib is not None:
                    dim_matrices[dim][(a, b)][ia][ib] += 1
            if models and all(cats[m] is not None for m in models):
                counts = [0] * n_cats[dim]
                for m in models:
                    counts[cats[m]] += 1
                panel_items[dim].append(counts)

            values = [row_rating[m][dim][1] for m in models]
            if len(models) >= 2 and all(v is not None for v in values):
                outcome = classify_dissent(values)
                acc = consensus_acc[dim]
                acc["n"] += 1
                acc["spread"] += outcome["spread"]
                if outcome["kind"] == "unanimous":
                    acc["unanimous"] += 1
                elif outcome["kind"] == "split":
                    acc["split"] += 1
                else:
                    lone = models[outcome["dissenter"]]
                    acc["up" if outcome["direction"] > 0 else "down"][lone] += 1

        for target, dim, test in TREND_TARGETS:
            flags = {}
            for m in models:
                value = row_rating[m][dim][1]
                flags[m] = None if value is None else bool(test(value))
                if flags[m] is not None:
                    trend_avail_n[target][m][year] += 1
                    if flags[m]:
                        trend_avail_k[target][m][year] += 1
            if models and all(flags[m] is not None for m in models):
                trend_common_n[target][year] += 1
                for m in models:
                    if flags[m]:
                        trend_common_k[target][m][year] += 1

    for stray, count in stray_labels.most_common():
        logging.getLogger(__name__).warning(
            "  unexpected rating label %r (%d rows) — excluded from series", stray, count
        )

    # -- Shape the payload ---------------------------------------------------
    countries_sorted = [c for c, _ in country_totals.most_common()]
    topics_sorted = [t for t, _ in topic_articles.most_common()]
    newspapers_sorted = [
        n for n, c in newspaper_articles.most_common()
        if c >= MIN_NEWSPAPER_ARTICLES
    ]

    models_payload: Dict[str, Any] = {}
    for m in models:
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
            "polarity_by_topic": {
                label: [int(pol_topic[m][label].get(t, 0)) for t in topics_sorted]
                for label in POLARITY_ORDER
            },
            "polarity_by_newspaper": {
                label: [int(pol_newspaper[m][label].get(n, 0)) for n in newspapers_sorted]
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
            "distribution": {
                dim: [int(dist[m][dim].get(i, 0)) for i in range(n_cats[dim])]
                for dim in DIMENSIONS
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

    reliability = {
        dim: _reliability(dim, pairs, dim_matrices[dim], panel_items[dim])
        for dim in DIMENSIONS
    }

    consensus: Dict[str, Any] = {}
    for dim in DIMENSIONS:
        acc = consensus_acc[dim]
        n = int(acc["n"])
        consensus[dim] = {
            "n": n,
            "unanimous": int(acc["unanimous"]),
            "split": int(acc["split"]),
            "spread_mean": round(acc["spread"] / n, 2) if n else None,
            "dissent": {
                m: {"up": int(acc["up"][m]), "down": int(acc["down"][m])}
                for m in models
            },
        }

    def _by_year(counter: Counter) -> List[int]:
        return [int(counter.get(y, 0)) for y in years]

    trends = {
        "min_count": TREND_MIN_COUNT,
        "targets": [t for t, _, _ in TREND_TARGETS],
        "common": {
            t: {
                "n": _by_year(trend_common_n[t]),
                "k": {m: _by_year(trend_common_k[t][m]) for m in models},
            }
            for t, _, _ in TREND_TARGETS
        },
        "available": {
            t: {
                "n": {m: _by_year(trend_avail_n[t][m]) for m in models},
                "k": {m: _by_year(trend_avail_k[t][m]) for m in models},
            }
            for t, _, _ in TREND_TARGETS
        },
    }

    # A title ranks on a measure once it clears the threshold there for one
    # model; each model's rows still carry only the measures it cleared.
    ranked_papers = {
        paper
        for m in models for dim in DIMENSIONS
        for paper, acc in rank_acc[m][dim].items()
        if acc[0] >= RANKING_MIN_ARTICLES
    }
    ranking_papers = sorted(ranked_papers, key=lambda p: (-newspaper_articles[p], p))
    paper_idx = {p: i for i, p in enumerate(ranking_papers)}
    ranking_models: Dict[str, Any] = {}
    ranking_omitted: Dict[str, Any] = {}
    for m in models:
        ranking_models[m] = {}
        ranking_omitted[m] = {}
        for dim in DIMENSIONS:
            rows: List[List[Any]] = []
            omitted = 0
            for paper, (n, total, total_sq) in rank_acc[m][dim].items():
                if n < RANKING_MIN_ARTICLES:
                    omitted += 1
                    continue
                stats = mean_interval(total, total_sq, int(n))
                rows.append([paper_idx[paper], int(n),
                             round(stats["mean"], 3), round(stats["half"], 3)])
            rows.sort(key=lambda r: r[0])
            ranking_models[m][dim] = rows
            ranking_omitted[m][dim] = omitted
    ranking = {
        "min": RANKING_MIN_ARTICLES,
        "newspapers": ranking_papers,
        "models": ranking_models,
        "omitted": ranking_omitted,
    }

    summary = {
        "total": int(len(df)),
        "year_min": years[0] if years else None,
        "year_max": years[-1] if years else None,
        "models": {
            m: {"rated": int(rated[m]), "not_applicable": int(not_applicable[m])}
            for m in models
        },
    }

    for m in models:
        logging.getLogger(__name__).info(
            "  %s: %d rated, %d 'Non applicable'", m, rated[m], not_applicable[m]
        )
    for entry in agreement:
        logging.getLogger(__name__).info(
            "  %s ↔ %s: %d co-rated, %.1f%% identical polarity",
            entry["models"][0], entry["models"][1],
            entry["co_rated"], entry["agreement_pct"] or 0.0,
        )

    for dim in DIMENSIONS:
        panel = reliability[dim]["panel"]
        logging.getLogger(__name__).info(
            "  %s: Fleiss' kappa %s over %d articles every model rated",
            dim, panel["fleiss_kappa"], panel["n"],
        )

    metadata = create_metadata_block(
        total_records=total_loaded,
        data_source=repo_id,
        script="generate_sentiment_atlas.py",
        script_version="0.4.0",
        excludedNoYear=excluded_no_year,
    )

    # -- Places sidecar -------------------------------------------------------
    place_list = sorted(
        place_records.values(), key=lambda p: (-place_n[p["o_id"]], p["name"])
    )
    places_payload = {
        "metadata": create_metadata_block(
            total_records=len(place_list),
            data_source=repo_id,
            script="generate_sentiment_atlas.py",
            script_version="0.4.0",
            unresolvedSpatial=len(unresolved_places),
        ),
        "min_rated": PLACE_MIN_RATED,
        "places": [
            {
                "o_id": p["o_id"],
                "name": p["name"],
                "lat": round(float(p["lat"]), 5),
                "lng": round(float(p["lng"]), 5),
                "n": int(place_n[p["o_id"]]),
            }
            for p in place_list
        ],
        "models": {
            m: {
                dim: {
                    "n": [int(place_acc[p["o_id"]][m][dim][0]) for p in place_list],
                    "mean": [
                        round(place_acc[p["o_id"]][m][dim][1] / place_acc[p["o_id"]][m][dim][0], 2)
                        if place_acc[p["o_id"]][m][dim][0] else None
                        for p in place_list
                    ],
                }
                for dim in DIMENSIONS
            }
            for m in models
        },
    }
    logging.getLogger(__name__).info(
        "  places: %d geocoded places tagged (%d spatial strings unresolved)",
        len(place_list), len(unresolved_places),
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
        "topics": [
            {"id": t, "label": topic_labels.get(t, "")} for t in topics_sorted
        ],
        "newspapers": newspapers_sorted,
        "newspaper_min": MIN_NEWSPAPER_ARTICLES,
        "models": models_payload,
        "agreement": agreement,
        "reliability": reliability,
        "consensus": consensus,
        "trends": trends,
        "ranking": ranking,
        # The sidecar this payload's map panel fetches; a bundle without the
        # key predates the map, and the block leaves the panel out.
        "places_file": PLACES_FILE,
    }, places_payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    add_standard_args(parser, minify_default=True)
    parser.add_argument(
        "--output",
        default="asset/data/sentiment-atlas.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument(
        "--places-output",
        default="asset/data/" + PLACES_FILE,
        help="Places sidecar path, relative to the module root",
    )
    args = parse_standard_args(parser)

    payload, places = build_sentiment_atlas(
        repo_id=args.repo,
        token=os.getenv("HF_TOKEN"),
    )

    output_path = Path(args.output)
    save_json(payload, output_path, minify=args.minify)
    logging.getLogger(__name__).info("Wrote %s", output_path)
    places_path = Path(args.places_output)
    save_json(places, places_path, minify=True)
    logging.getLogger(__name__).info("Wrote %s", places_path)


if __name__ == "__main__":
    main()
