#!/usr/bin/env python3
"""
generate_periodicals_overview.py
================================

Generate ``asset/data/periodicals-overview.json`` for the IwacVisualizations
module's Periodicals Overview page block — the corpus-level view of the IWAC
``publications`` subset (Islamic-periodical issues, ``bibo:Issue``).

The block JS (``asset/js/charts/periodicals-overview.js``) loads this single
precomputed JSON and renders all panels from it; no runtime calls to the
Hugging Face datasets-server are made.

Payload shape (top-level keys):

    metadata          — standard provenance block (generatedAt timestamp)
    summary           — issue / periodical / country / language counts,
                        year span, total pages + words
    runs              — per-periodical publication run, shaped for the
                        C.gantt builder: { name, country, year_min,
                        year_max, total }, sorted by first year
    holdings          — periodical × year issue counts for the holdings
                        matrix (C.heatmapMatrix): { years, periodicals,
                        cells: [[yearIdx, periodicalIdx, count], …] };
                        rows keep the runs ordering
    issues_per_year   — per-year × country matrix shaped for C.timeline:
                        { years, countries, series }
    languages         — language histogram (raw French keys so the JS can
                        call P.t('lang_<x>') at render time)
    top_subjects      — top-N subject histogram
    countries         — country histogram
    wordcloud         — top-N [word, count] pairs from the issues'
                        lemmatized full text (lemma_nostop), shaped for
                        the C.wordcloud builder
    topics            — LDA topic **mixtures** over lda_topic_topk, never
                        dominant labels: per-topic probability mass,
                        representative issues ranked by that topic's own
                        share, a probability-weighted per-year prevalence
                        series, and the coverage / captured-mass
                        denominators the panel needs to state its limits.
                        See compute_topics.

Usage
-----
    python scripts/generate_periodicals_overview.py
    python scripts/generate_periodicals_overview.py --output asset/data/periodicals-overview.json
    python scripts/generate_periodicals_overview.py --top-n-subjects 20 --no-minify

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
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    aggregate_prevalence,
    canonicalize_country_field,
    clean_values,
    configure_logging,
    create_metadata_block,
    extract_year,
    find_column,
    is_unknown,
    load_dataset_safe,
    parse_pipe_separated,
    parse_top_words,
    parse_topk,
    save_json,
    tokenize,
    top_n_pipe,
)

SUBSET = "publications"

# Top-N cap for the subjects ranking panel. Languages and countries are tiny
# closed sets for this subset (a handful of values each) so they ship in full.
TOP_N_SUBJECTS = 20

# Word-cloud panel: top-N most frequent lemmas across every issue's full text.
# Matches generate_wordcloud.py's article defaults so the two clouds read at a
# comparable density.
WORDCLOUD_MAX_WORDS = 150
WORDCLOUD_MIN_FREQUENCY = 5

# Representative issues kept per topic. Matches the articles Topic
# Explorer's card grid; past a dozen the panel crowds without adding
# information.
TOPIC_ITEMS = 10

# Cap on how many of those may come from any one periodical.
#
# Without it the strip is a monoculture: measured on the live data, 8 of
# 20 topics returned ten issues of a single title, and a theme carried by
# 588 issues across a dozen periodicals rendered as if it belonged to one
# magazine. The cause is real rather than a ranking bug — a devotional
# weekly's issues genuinely are more topically pure than a general
# newsmagazine's — but "most representative issues" that silently exclude
# every other title misdescribe the theme's reach.
#
# The cap is a floor, not a ceiling: if the capped pass cannot fill the
# grid, the remainder is topped up in pure share order, so a theme that
# really is carried by one periodical still shows ten of its issues.
TOPIC_ITEMS_PER_PERIODICAL = 3


def _str_or_none(value: Any) -> Optional[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    return s or None


# Local alias for the shared iwac_utils.is_unknown (call sites keep the short name).


def _column_sum(df: pd.DataFrame, column: str) -> int:
    """Robust integer sum over a numeric column (NaN-safe)."""
    if column not in df.columns:
        return 0
    return int(pd.to_numeric(df[column], errors="coerce").fillna(0).sum())


# ---------------------------------------------------------------------------
#  Aggregations
# ---------------------------------------------------------------------------

def compute_summary(rows: pd.DataFrame) -> Dict[str, Any]:
    periodicals: set = set()
    countries: set = set()
    languages: set = set()
    year_min: Optional[int] = None
    year_max: Optional[int] = None

    for _, row in rows.iterrows():
        name = _str_or_none(row.get("newspaper"))
        if name and not is_unknown(name):
            periodicals.add(name)
        for c in clean_values(parse_pipe_separated(row.get("country"))):
            countries.add(c)
        for l in clean_values(parse_pipe_separated(row.get("language"))):
            languages.add(l)
        year = extract_year(row.get("pub_date"))
        if year is not None:
            year_min = year if year_min is None else min(year_min, year)
            year_max = year if year_max is None else max(year_max, year)

    return {
        "total":       int(len(rows)),
        "periodicals": len(periodicals),
        "countries":   len(countries),
        "languages":   len(languages),
        "year_min":    year_min,
        "year_max":    year_max,
        "total_pages": _column_sum(rows, "nb_pages"),
        "total_words": _column_sum(rows, "nb_mots"),
    }


def compute_runs(rows: pd.DataFrame) -> List[Dict[str, Any]]:
    """Per-periodical publication runs, shaped to feed C.gantt directly.

    Each entry: ``{ name, country, year_min, year_max, total }``. The
    builder draws a horizontal bar from year_min to year_max per row and
    colors it by ``country`` (C._countryColor); ``total`` lands in the
    tooltip. The ``type`` field is intentionally omitted — every row here
    is a periodical, and the tooltip skips the line when absent.
    """
    logger = logging.getLogger(__name__)
    per: Dict[str, Dict[str, Any]] = {}

    for _, row in rows.iterrows():
        name = _str_or_none(row.get("newspaper"))
        if name is None or is_unknown(name):
            continue
        rec = per.setdefault(name, {
            "total": 0,
            "countries": Counter(),
            "year_min": None,
            "year_max": None,
        })
        rec["total"] += 1
        for c in clean_values(parse_pipe_separated(row.get("country"))):
            rec["countries"][c] += 1
        year = extract_year(row.get("pub_date"))
        if year is not None:
            rec["year_min"] = year if rec["year_min"] is None else min(rec["year_min"], year)
            rec["year_max"] = year if rec["year_max"] is None else max(rec["year_max"], year)

    runs: List[Dict[str, Any]] = []
    for name, rec in per.items():
        if rec["year_min"] is None:
            # A run without a single parseable date can't be drawn on a
            # year axis — log it instead of shipping a broken bar.
            logger.warning("  periodical %r has no parseable pub_date; skipped from runs", name)
            continue
        country = rec["countries"].most_common(1)[0][0] if rec["countries"] else ""
        runs.append({
            "name":     name,
            "country":  country,
            "year_min": int(rec["year_min"]),
            "year_max": int(rec["year_max"]),
            "total":    int(rec["total"]),
        })

    runs.sort(key=lambda e: (e["year_min"], e["name"]))
    return runs


def compute_holdings(rows: pd.DataFrame, runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Periodical × year issue counts, shaped to feed C.heatmapMatrix.

    Rows reuse the runs list's ordering (first year, then name) so the
    matrix reads in visual correspondence with the Gantt above it. The
    year axis is the contiguous corpus span — the gaps ARE the point: a
    blank cell inside a run is a year with no held issue (a collection
    gap, not necessarily a publication gap). Cells are sparse
    ``[yearIdx, periodicalIdx, count]`` rows.
    """
    counts: Counter = Counter()
    for _, row in rows.iterrows():
        name = _str_or_none(row.get("newspaper"))
        if name is None or is_unknown(name):
            continue
        year = extract_year(row.get("pub_date"))
        if year is None:
            continue
        counts[(name, int(year))] += 1

    if not runs or not counts:
        return {"years": [], "periodicals": [], "cells": []}

    year_min = min(r["year_min"] for r in runs)
    year_max = max(r["year_max"] for r in runs)
    years = list(range(int(year_min), int(year_max) + 1))
    periodicals = [r["name"] for r in runs]
    p_idx = {n: i for i, n in enumerate(periodicals)}
    y_idx = {y: i for i, y in enumerate(years)}
    cells = [
        [y_idx[y], p_idx[n], int(c)]
        for (n, y), c in sorted(counts.items())
        if n in p_idx and y in y_idx
    ]
    return {"years": years, "periodicals": periodicals, "cells": cells}


def compute_issues_per_year(rows: pd.DataFrame) -> Dict[str, Any]:
    """Per-year × country matrix shaped to feed C.timeline directly.

    Countries are ordered by total issue count (descending) so the stack
    order is stable and the biggest contributor sits at the bottom.
    Issues without a resolvable country or year are skipped, matching the
    collection-overview timeline convention.
    """
    by_year_country: Dict[int, Counter] = defaultdict(Counter)
    country_totals: Counter = Counter()
    seen_years: set = set()

    for _, row in rows.iterrows():
        year = extract_year(row.get("pub_date"))
        if year is None:
            continue
        for country in clean_values(parse_pipe_separated(row.get("country"))):
            by_year_country[year][country] += 1
            country_totals[country] += 1
            seen_years.add(year)

    if not seen_years:
        return {"years": [], "countries": [], "series": {}}

    years = sorted(seen_years)
    countries_sorted = [c for c, _ in country_totals.most_common()]
    series: Dict[str, List[int]] = {}
    for country in countries_sorted:
        series[country] = [int(by_year_country[y].get(country, 0)) for y in years]

    return {
        "years":     years,
        "countries": countries_sorted,
        "series":    series,
    }


def compute_wordcloud(
    rows: pd.DataFrame, max_words: int, min_frequency: int,
) -> List[List[Any]]:
    """Top-N ``[word, count]`` pairs from the issues' lemmatized full text.

    Prefers ``lemma_nostop`` — the HF dataset's spaCy lemmas of ``OCR``,
    already stop-filtered — then falls back to ``lemma_text`` and raw
    ``OCR`` for the ~48 issues whose ``OCR`` (hence lemmas) is blank. The
    shared ``tokenize`` lowercases, length-filters (< 4 chars), and drops
    the generic French/editorial stopword set; it does **not** touch
    Islamic-domain research terms, which are core vocabulary here.

    Emits the ECharts word-cloud shape (``[[word, count], ...]``) that the
    ``C.wordcloud`` builder consumes directly.
    """
    text_col = find_column(rows, ["lemma_nostop", "lemma_text", "OCR"])
    if text_col is None:
        logging.getLogger(__name__).warning(
            "  no lemma/OCR column found — word cloud will be empty"
        )
        return []

    counter: Counter = Counter()
    for value in rows[text_col]:
        counter.update(tokenize(value))

    return [
        [word, int(count)]
        for word, count in counter.most_common(max_words)
        if count >= min_frequency
    ]


# ---------------------------------------------------------------------------
#  LDA topics
# ---------------------------------------------------------------------------

def _topic_id(value: Any) -> Optional[int]:
    """Dominant topic id as an int, or None when the issue is unmodelled.

    ``lda_topic_id`` is float64 on every modelled subset (nulls force the
    widening). On ``publications`` an unmodelled issue is **null**, not
    ``-1`` — the ``references`` convention rather than the ``articles``
    one — but ``-1`` is rejected here too, so a change of upstream
    convention degrades to "uncovered" instead of inventing topic -1.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        topic_id = int(float(value))
    except (TypeError, ValueError):
        return None
    return topic_id if topic_id >= 0 else None


def _issue_record(row: pd.Series) -> Dict[str, Any]:
    """The fields a representative-issue card needs, and nothing more."""
    return {
        "o_id":      _str_or_none(row.get("o:id")),
        "title":     _str_or_none(row.get("title")),
        "newspaper": _str_or_none(row.get("newspaper")),
        "issue":     _str_or_none(row.get("issue")),
        "date":      (_str_or_none(row.get("pub_date")) or "")[:10],
        "year":      extract_year(row.get("pub_date")),
        "thumbnail": _str_or_none(row.get("thumbnail")),
    }


def _select_items(
    candidates: List[Any], limit: int, per_periodical: int,
) -> List[Any]:
    """Top issues by share, without letting one periodical fill the grid.

    Two passes over the same share-ordered list: the first takes at most
    ``per_periodical`` from each title, the second tops up from whatever
    the cap skipped. So a theme spread over many periodicals shows that
    spread, and a theme genuinely carried by one still fills its grid
    with that one — the cap never shrinks the result, only reorders it.
    """
    ranked = sorted(candidates, key=lambda entry: -entry[0])
    if per_periodical <= 0:
        return ranked[:limit]

    seen: Counter = Counter()
    picked: List[Any] = []
    deferred: List[Any] = []
    for entry in ranked:
        name = entry[2].get("newspaper") or ""
        if seen[name] < per_periodical:
            seen[name] += 1
            picked.append(entry)
            if len(picked) == limit:
                return picked
        else:
            deferred.append(entry)

    picked.extend(deferred[:limit - len(picked)])
    return picked


def _empty_topics(reason: str, total: int) -> Dict[str, Any]:
    """Empty-state contract, same shape as a populated section.

    Follows ``generate_references_overview._empty_landscape``: the topic
    panels are optional — an older dataset snapshot predates the
    2026-08-11 LDA fit entirely — so their absence must render as a stated
    reason, not a crashed build or a silently missing panel.
    """
    return {
        "models":             [],
        "n_topics":           0,
        "topics":             [],
        "prevalence":         None,
        "mean_dominant_prob": None,
        "captured_mass":      None,
        "coverage": {
            "modelled": 0,
            "total":    int(total),
            "share":    0.0,
            "reason":   reason,
        },
        "source_field": "OCR",
    }


def compute_topics(
    rows: pd.DataFrame,
    items_per_topic: int,
    items_per_periodical: int = TOPIC_ITEMS_PER_PERIODICAL,
) -> Dict[str, Any]:
    """Topic *mixtures* over the issues, never dominant labels.

    **This reads ``lda_topic_topk``, and the choice is load-bearing.**
    Mean dominant-topic probability on ``publications`` is 0.345 — a
    typical row is ``"14:0.2749|16:0.1160|11:0.0890"``, where the top
    three topics carry under half the mass. A whole periodical issue is a
    miscellany, so the dominant-label treatment the articles Topic
    Explorer uses (correct there — whole-document LDA on single news
    stories is far peakier) would be wrong about two thirds of the time
    here. Every topic in an issue's mixture scores its own share.

    Three quantities, deliberately kept apart rather than blended:

    ``mass`` / ``mean_mass``   summed probability mass — "how much of the
                              corpus's attention went to this topic".
                              The ranking key.
    ``issues``                 issues carrying the topic anywhere in their
                              top-k.
    ``dominant_count``         issues where it is the single best label.
                              Carried *so the panel can show the gap*
                              against ``issues``: the divergence is the
                              evidence for reading mixtures, and hiding it
                              would make the argument unfalsifiable.
    ``periodicals``            distinct titles carrying it. A theme in 588
                              issues of one magazine and a theme in 588
                              issues of twelve are different findings, and
                              the representative-issue grid alone cannot
                              tell them apart — see ``_select_items``.

    Masses are truncated — only the top k=3 are on the Hub — so they sum
    to ``captured_mass``, well under 1.0. They are not renormalised; see
    ``iwac_utils.aggregate_prevalence`` for why.

    Topics come from the issues' **OCR text**. The subset's embedding
    column is ``embedding_tableOfContents``, a different object built from
    the contents page — ``source_field`` records which one this is so the
    panel can say so rather than leaving a reader to assume they match.
    """
    logger = logging.getLogger(__name__)
    total = int(len(rows))

    if "lda_topic_topk" not in rows.columns:
        logger.warning(
            "  publications carries no lda_topic_topk — topic panels will "
            "render their empty state. The chunked LDA fit landed 2026-08-11; "
            "an older snapshot predates it."
        )
        return _empty_topics("no lda_topic_topk column", total)

    labels: Dict[int, str] = {}
    model_names: Counter = Counter()
    mass: Dict[int, float] = defaultdict(float)
    in_mixture: Counter = Counter()
    dominant: Counter = Counter()
    periodicals: Dict[int, set] = defaultdict(set)
    candidates: Dict[int, List[Any]] = defaultdict(list)
    dominant_probs: List[float] = []
    modelled = 0
    total_mass = 0.0

    for _, row in rows.iterrows():
        pairs = parse_topk(row.get("lda_topic_topk"))
        if not pairs:
            # Null, not -1: the 2 Arabic issues and those without usable
            # OCR are simply outside the model.
            continue

        modelled += 1
        name = _str_or_none(row.get("lda_model_name"))
        if name:
            model_names[name] += 1

        dominant_id = _topic_id(row.get("lda_topic_id"))
        if dominant_id is not None:
            dominant[dominant_id] += 1
            label = _str_or_none(row.get("lda_topic_label"))
            if label and dominant_id not in labels:
                labels[dominant_id] = label
        prob = row.get("lda_topic_prob")
        if prob is not None and not (isinstance(prob, float) and pd.isna(prob)):
            try:
                dominant_probs.append(float(prob))
            except (TypeError, ValueError):
                pass

        # One record per row, shared across the topics it contributes to;
        # only the survivors of the top-N cut get copied below.
        record = _issue_record(row)
        for topic_id, topic_prob in pairs:
            mass[topic_id] += topic_prob
            total_mass += topic_prob
            in_mixture[topic_id] += 1
            if record["newspaper"]:
                periodicals[topic_id].add(record["newspaper"])
            candidates[topic_id].append((topic_prob, dominant_id == topic_id, record))

    if not modelled:
        logger.warning("  no issue carries a parseable lda_topic_topk")
        return _empty_topics("no parseable topic mixtures", total)

    # Ids are comparable only within one model. publications is fitted
    # once (lda_model_publications, k=20), unlike references' FR+EN pair —
    # but say so loudly rather than silently merging two numbering schemes
    # into one nonsense bucket if that ever changes upstream.
    if len(model_names) > 1:
        logger.error(
            "  %d LDA models present on publications (%s) — topic ids are "
            "NOT comparable across models and this section aggregates them "
            "as if they were. Split by lda_model_name before shipping.",
            len(model_names), ", ".join(sorted(model_names)),
        )

    topics: List[Dict[str, Any]] = []
    for topic_id in sorted(mass, key=lambda t: -mass[t]):
        # Ranked by *this* topic's share, so an issue where the topic runs
        # a strong second can surface. Ranking on lda_topic_prob would only
        # ever return issues the topic already won, which is the
        # dominant-label view wearing a different hat.
        items = _select_items(candidates[topic_id], items_per_topic, items_per_periodical)
        label = labels.get(topic_id, "")
        topics.append({
            "id":              topic_id,
            "label":           label,
            "words":           parse_top_words(label),
            "mass":            round(mass[topic_id], 4),
            "mean_mass":       round(mass[topic_id] / modelled, 4),
            "issues":          int(in_mixture[topic_id]),
            "dominant_count":  int(dominant.get(topic_id, 0)),
            "periodicals":     len(periodicals[topic_id]),
            "items": [
                {**record, "share": round(share, 4), "is_dominant": is_dom}
                for share, is_dom, record in items
            ],
        })

    unlabelled = [t["id"] for t in topics if not t["label"]]
    if unlabelled:
        # lda_topic_label rides on the dominant assignment, so a topic
        # that never wins an issue arrives without one.
        logger.warning(
            "  %d topic(s) carry no label (never any issue's dominant "
            "topic): %s", len(unlabelled), unlabelled,
        )

    prevalence = aggregate_prevalence(
        rows,
        {"topic_topk": "lda_topic_topk", "date": "pub_date"},
        labels=labels,
    )
    if prevalence is not None and prevalence["docs"] < modelled:
        # The per-year series can only carry dated issues; the topic
        # rankings above use every modelled issue. Two denominators, so
        # both travel in the payload rather than one being assumed.
        logger.info(
            "  %d of %d modelled issues carry a parseable year and reach "
            "the prevalence series", prevalence["docs"], modelled,
        )

    return {
        "models":             [name for name, _ in model_names.most_common()],
        "n_topics":           len(topics),
        "topics":             topics,
        "prevalence":         prevalence,
        # Surfaced from the data rather than hardcoded: this is the number
        # that makes the mixture reading necessary, and the panel states it.
        "mean_dominant_prob": (
            round(sum(dominant_probs) / len(dominant_probs), 4)
            if dominant_probs else None
        ),
        "captured_mass":      round(total_mass / modelled, 4),
        "coverage": {
            "modelled": int(modelled),
            "total":    total,
            "share":    round(modelled / total, 4) if total else 0.0,
            "reason":   "",
        },
        "source_field": "OCR",
    }


# ---------------------------------------------------------------------------
#  Top-level builder
# ---------------------------------------------------------------------------

def build_periodicals_overview(
    repo_id: str,
    token: Optional[str],
    top_n_subjects: int,
    wordcloud_max_words: int,
    wordcloud_min_frequency: int,
    topic_items: int,
    topic_items_per_periodical: int,
) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Loading IWAC publications subset from %s", repo_id)

    df = load_dataset_safe(SUBSET, repo_id=repo_id, token=token)
    if df is None or df.empty:
        raise RuntimeError("Failed to load publications subset — aborting")

    if "country" in df.columns:
        df["country"] = df["country"].apply(canonicalize_country_field)

    logger.info("  %d periodical issue rows loaded", len(df))

    summary = compute_summary(df)
    runs = compute_runs(df)
    issues_per_year = compute_issues_per_year(df)
    languages = top_n_pipe(df, "language", None)
    top_subjects = top_n_pipe(df, "subject", top_n_subjects)
    countries = top_n_pipe(df, "country", None)
    wordcloud = compute_wordcloud(df, wordcloud_max_words, wordcloud_min_frequency)
    topics = compute_topics(
        df,
        items_per_topic=topic_items,
        items_per_periodical=topic_items_per_periodical,
    )

    holdings = compute_holdings(df, runs)

    logger.info(
        "  %d periodical runs, %d timeline years, %d languages, %d countries, %d cloud terms, %d holdings cells",
        len(runs),
        len(issues_per_year["years"]),
        len(languages),
        len(countries),
        len(wordcloud),
        len(holdings["cells"]),
    )

    coverage = topics["coverage"]
    if topics["n_topics"]:
        logger.info(
            "  %d LDA topics over %d/%d issues (%.1f%% modelled); mean "
            "dominant-topic prob %.3f, mean captured mass %.3f",
            topics["n_topics"], coverage["modelled"], coverage["total"],
            100 * coverage["share"], topics["mean_dominant_prob"] or 0.0,
            topics["captured_mass"] or 0.0,
        )
        # The reason the panels read mixtures. Log it every run so a
        # future re-fit that peaks the model shows up in CI output
        # rather than quietly invalidating the panel's framing.
        if (topics["mean_dominant_prob"] or 0.0) >= 0.5:
            logger.warning(
                "  mean dominant-topic probability is %.3f — at or above "
                "0.5 the mixture framing is worth revisiting; it was 0.345 "
                "when these panels were designed",
                topics["mean_dominant_prob"],
            )
    else:
        logger.warning("  no topic section: %s", coverage["reason"])

    metadata = create_metadata_block(
        total_records=summary["total"],
        data_source=repo_id,
        script="generate_periodicals_overview.py",
        script_version="0.4.0",
    )

    return {
        "metadata":        metadata,
        "summary":         summary,
        "runs":            runs,
        "holdings":        holdings,
        "issues_per_year": issues_per_year,
        "languages":       languages,
        "top_subjects":    top_subjects,
        "countries":       countries,
        "wordcloud":       wordcloud,
        "topics":          topics,
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
        default="asset/data/periodicals-overview.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument(
        "--top-n-subjects", type=int, default=TOP_N_SUBJECTS,
        help="Number of subjects to keep in the ranking (default: %(default)s)",
    )
    parser.add_argument(
        "--wordcloud-max-words", type=int, default=WORDCLOUD_MAX_WORDS,
        help="Max terms in the word cloud (default: %(default)s)",
    )
    parser.add_argument(
        "--wordcloud-min-frequency", type=int, default=WORDCLOUD_MIN_FREQUENCY,
        help="Drop word-cloud terms below this count (default: %(default)s)",
    )
    parser.add_argument(
        "--topic-items", type=int, default=TOPIC_ITEMS,
        help="Representative issues kept per LDA topic (default: %(default)s)",
    )
    parser.add_argument(
        "--topic-items-per-periodical", type=int, default=TOPIC_ITEMS_PER_PERIODICAL,
        help="Max representative issues from any one periodical per topic; "
             "0 disables the cap (default: %(default)s)",
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

    payload = build_periodicals_overview(
        repo_id=args.repo,
        token=os.getenv("HF_TOKEN"),
        top_n_subjects=args.top_n_subjects,
        wordcloud_max_words=args.wordcloud_max_words,
        wordcloud_min_frequency=args.wordcloud_min_frequency,
        topic_items=args.topic_items,
        topic_items_per_periodical=args.topic_items_per_periodical,
    )

    output_path = Path(args.output)
    save_json(payload, output_path, minify=args.minify)
    logging.getLogger(__name__).info("Wrote %s", output_path)


if __name__ == "__main__":
    main()
