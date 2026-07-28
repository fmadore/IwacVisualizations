#!/usr/bin/env python3
"""
generate_keyness.py
===================

Generate ``asset/data/keyness.json`` for the Distinctive Vocabulary page
block — two classic corpus-linguistics views over the IWAC ``articles``
subset that the module's other blocks cannot express:

1. **Keyness** — the vocabulary that is *distinctive* of each country
   subcorpus and each decade, rather than merely frequent in it. Term
   Trends already answers "how often is this word used"; keyness answers
   "which words does this slice of the press use more than the rest of the
   press does", which is a different and usually more interesting question.

   Method: Dunning log-likelihood (G²) as the significance test only —
   p = chi2(|G²|, df=1), Benjamini–Hochberg corrected within each slice's
   tested token family — with surviving tokens ranked by Hardie's **log
   ratio** effect size. Ranking by G² itself is the classic keyness
   mistake, since G² grows with corpus size and would return the biggest
   slice's most frequent words. See ``iwac_stats.keyness_for_slices``.

2. **Subject bursts** — when coverage of a controlled-vocabulary subject
   spiked above its own base rate, via Kleinberg's 2-state automaton. This
   is event detection: it finds the years the press suddenly cared about
   something, without being told what to look for.

Both are computed from columns the dataset already carries — keyness from
``lemma_nostop`` (spaCy lemmas, stopwords already removed upstream) and
bursts from the ``subject`` authority tags — so no new enrichment is
needed.

Payload shape::

    {
      "metadata": {...},
      "params":   {"alpha": 0.05, "min_count": 10, "top_n": 25,
                   "burst_s": 2.0, "burst_gamma": 1.0,
                   "min_subject_total": 30},
      "keyness": {
        "country": [{"name": "Burkina Faso", "docs": 3200, "tokens": 1200000,
                     "terms": [{"token": "faib", "log_ratio": 3.1, "g2": 812.4,
                                "q": 1.2e-40, "count": 412, "rate_ratio": 8.6}]}],
        "decade":  [ ...same shape, name = "1990s" ... ]
      },
      "bursts": {
        "years":    [1980, ..., 2024],
        "subjects": [{"subject": "...", "total": 312, "peak": 2003,
                      "counts": [...], "bursts": [{"start": ..., "end": ...,
                      "weight": ..., "mentions": ...}]}]
      }
    }

Usage
-----
    python scripts/generate_keyness.py --minify
    python scripts/generate_keyness.py --top-n 30 --min-count 15 -v

Environment
-----------
    HF_TOKEN   Hugging Face access token — required, the default dataset
               is the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import logging
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from iwac_stats import (
    ALPHA,
    contiguous_years,
    keyness_for_slices,
    kleinberg_bursts,
    parse_multi_values,
)
from iwac_utils import (
    add_standard_args,
    canonical_country,
    clean_str,
    configure_logging,
    create_metadata_block,
    extract_year,
    is_unknown,
    load_dataset_safe,
    parse_pipe_separated,
    parse_standard_args,
    save_json,
    tokenize,
)

SUBSET = "articles"

# Only these columns are materialised — the subset also carries OCR and a
# 768-dim embedding per row, and pulling those into pandas is where the
# memory goes (see load_dataset_safe's `columns` docstring).
COLUMNS = ["o:id", "pub_date", "country", "subject", "lemma_nostop"]

# Tokens rarer than this inside a slice are not tested at all. A floor is
# needed for two reasons: single-occurrence tokens produce unstable rate
# ratios, and every token tested widens the BH correction, so testing the
# long tail costs statistical power for the terms that matter.
DEFAULT_MIN_COUNT = 10

# Distinctive terms reported per slice.
DEFAULT_TOP_N = 25

# Minimum log-ratio (effect size) to report: log2(1.5), i.e. the token must
# be used at least 1.5x as often in this slice as in the rest of the press.
# On a corpus of this size statistical significance alone is nearly free —
# a 1.1x difference clears q < 0.001 on enough occurrences — and a slice
# with no real signature vocabulary would otherwise fill its top-N with
# such terms, which a reader fairly takes to mean "these words characterise
# this slice". The sibling pipeline's CSV export applies no such floor
# because an analyst can filter a CSV; a panel reader cannot.
DEFAULT_MIN_LOG_RATIO = 0.585

# Kleinberg parameters. s = how many times the base rate counts as a burst;
# gamma = the cost of entering the burst state (higher = fewer, stronger
# bursts). Both keep the reference implementation's values so the two agree.
#
# gamma is deliberately NOT the lever for the over-detection the first real
# run showed (a burst in 325 of 341 subjects). It is a one-off entry cost of
# gamma*ln(T) ~ 4.25 over a 70-year span, while a multi-year burst saves 40+
# — so tripling gamma suppressed none of the false positives in testing and
# would have started eating real ones before it touched them. The cause was
# the comparison window, fixed in build_bursts; see MIN_ACTIVE_SPAN_YEARS.
DEFAULT_BURST_S = 2.0
DEFAULT_BURST_GAMMA = 1.0

# Vocabulary-onset artefacts. Subjects enter the controlled vocabulary
# partway through the corpus, so one introduced in 2010 and used steadily
# since carries decades of structural zeroes that the automaton reads as a
# single burst running from its first appearance to the present. That is the
# subject's lifetime, not a spike in coverage, and it was the bulk of the
# 325-of-341 over-detection the first real run showed.
#
# The signature is exact: the burst starts at the subject's FIRST occurrence
# and ends at the LAST year of the corpus — it appears and never comes back
# down. Testing that rule against the four patterns that matter, it rejects
# only the artefact:
#
#   introduced 2010 then steady   2010-2024  onset  -> dropped
#   tagged only in 2003-2004      2003-2004         -> kept
#   spike that returns to base    2000-2002         -> kept
#   late surge, still rising      2015-2024         -> kept (starts long
#                                                     after first occurrence)
#
# An earlier attempt restricted the automaton to each subject's active span
# instead. That also removed the artefact, but it discarded the sharpest
# signals in the corpus: a subject tagged only in 2003-2004 has a two-year
# span, which is flat within itself and so bursts nowhere — exactly the
# event a reader most wants to see.
DROP_ONSET_ARTEFACTS = True

# A subject needs this many tagged articles before burst detection is run
# on it. Below that the base rate is too noisy for "above base rate" to
# mean anything.
DEFAULT_MIN_SUBJECT_TOTAL = 30

# Subjects kept in the payload, ranked by their strongest burst weight.
DEFAULT_MAX_SUBJECTS = 40


def _first_country(value: Any) -> str:
    """Canonical first country of a possibly pipe-separated cell, or ''."""
    for raw in parse_pipe_separated(value):
        raw = raw.strip()
        if raw and not is_unknown(raw):
            return canonical_country(raw)
    return ""


def _decade_label(year: int) -> str:
    return f"{(year // 10) * 10}s"


def build_keyness(
    df: Any,
    top_n: int,
    min_count: int,
    alpha: float,
    min_log_ratio: float = DEFAULT_MIN_LOG_RATIO,
) -> Dict[str, List[Dict[str, Any]]]:
    """Country and decade keyness over ``lemma_nostop``.

    Each slice is scored against every *other* slice pooled, so "distinctive
    of Bénin" means distinctive relative to the rest of the IWAC press, not
    relative to French at large — the comparison a reader of this collection
    is actually making.
    """
    logger = logging.getLogger(__name__)

    country_tokens: Dict[str, Counter] = defaultdict(Counter)
    decade_tokens: Dict[str, Counter] = defaultdict(Counter)
    country_docs: Counter = Counter()
    decade_docs: Counter = Counter()

    text_col = "lemma_nostop" if "lemma_nostop" in df.columns else "lemma_text"
    if text_col not in df.columns:
        raise RuntimeError("articles subset carries neither lemma_nostop nor lemma_text")

    for position in range(len(df)):
        tokens = tokenize(df[text_col].iat[position])
        if not tokens:
            continue
        country = _first_country(df["country"].iat[position]) if "country" in df.columns else ""
        year = extract_year(df["pub_date"].iat[position]) if "pub_date" in df.columns else None

        if country:
            country_tokens[country].update(tokens)
            country_docs[country] += 1
        if year is not None:
            label = _decade_label(year)
            decade_tokens[label].update(tokens)
            decade_docs[label] += 1

    out: Dict[str, List[Dict[str, Any]]] = {}
    for facet, slice_tokens, docs in (
        ("country", country_tokens, country_docs),
        ("decade", decade_tokens, decade_docs),
    ):
        scored = keyness_for_slices(
            slice_tokens, top_n=top_n, min_count=min_count, alpha=alpha,
            min_log_ratio=min_log_ratio,
        )
        entries: List[Dict[str, Any]] = []
        for name in sorted(slice_tokens):
            terms = scored.get(name, [])
            if not terms:
                # A slice with nothing significant is reported with an empty
                # term list rather than dropped: "no distinctive vocabulary"
                # is a finding, and silently omitting the slice would read as
                # missing data.
                logger.info("  %s '%s': no significant distinctive terms", facet, name)
            entries.append({
                "name":   name,
                "docs":   int(docs[name]),
                "tokens": int(sum(slice_tokens[name].values())),
                "terms":  terms,
            })
        out[facet] = entries
        logger.info(
            "  %s keyness: %d slices, %d distinctive terms total",
            facet, len(entries), sum(len(e["terms"]) for e in entries),
        )
    return out


def build_bursts(
    df: Any,
    min_subject_total: int,
    max_subjects: int,
    burst_s: float,
    burst_gamma: float,
) -> Optional[Dict[str, Any]]:
    """Kleinberg burst intervals per controlled-vocabulary subject."""
    logger = logging.getLogger(__name__)
    if "subject" not in df.columns or "pub_date" not in df.columns:
        logger.warning("No subject / pub_date column — burst detection skipped")
        return None

    docs_by_year: Counter = Counter()
    subject_year: Dict[str, Counter] = defaultdict(Counter)
    subject_total: Counter = Counter()

    for position in range(len(df)):
        year = extract_year(df["pub_date"].iat[position])
        if year is None:
            continue
        docs_by_year[year] += 1
        # Deduplicated per document: r[t] counts documents, not repetitions.
        for subject in parse_multi_values(df["subject"].iat[position]):
            if is_unknown(subject):
                continue
            subject_year[subject][year] += 1
            subject_total[subject] += 1

    if not docs_by_year:
        logger.warning("No dated articles — burst detection skipped")
        return None

    years = contiguous_years(list(docs_by_year))
    year_index = {year: i for i, year in enumerate(years)}
    totals = [float(docs_by_year.get(year, 0)) for year in years]

    detected: List[Dict[str, Any]] = []
    onset_dropped = 0
    for subject, total in subject_total.items():
        if total < min_subject_total:
            continue
        counts = [0.0] * len(years)
        for year, count in subject_year[subject].items():
            counts[year_index[year]] = float(count)

        bursts = kleinberg_bursts(
            counts, totals, years, s=burst_s, gamma=burst_gamma,
        )

        # Drop the "appeared and never came down" shape — the subject's
        # arrival in the vocabulary, not a spike in how much it was covered.
        if bursts and DROP_ONSET_ARTEFACTS:
            first_year = min(subject_year[subject])
            kept_bursts = [
                b for b in bursts
                if not (b["start"] == first_year and b["end"] == years[-1])
            ]
            if len(kept_bursts) != len(bursts):
                onset_dropped += 1
            bursts = kept_bursts

        if not bursts:
            continue
        peak_year = max(subject_year[subject].items(), key=lambda kv: (kv[1], kv[0]))[0]
        detected.append({
            "subject": subject,
            "total":   int(total),
            "peak":    int(peak_year),
            "counts":  [int(c) for c in counts],
            "bursts":  bursts,
        })

    # Rank by the strongest single burst: the question the panel answers is
    # "what erupted", so a brief violent spike should outrank a subject with
    # many mild ones.
    detected.sort(
        key=lambda entry: (-max(b["weight"] for b in entry["bursts"]), entry["subject"]),
    )
    kept = detected[:max_subjects]
    tested = sum(1 for t in subject_total.values() if t >= min_subject_total)
    logger.info(
        "  bursts: %d subjects tested, %d with bursts, %d kept "
        "(%d had a vocabulary-onset burst discarded)",
        tested, len(detected), len(kept), onset_dropped,
    )
    if tested:
        logger.info(
            "  burst rate: %.0f%% of tested subjects burst at all "
            "(a rate near 100%% means the detector is not discriminating)",
            (len(detected) / tested) * 100,
        )
    if len(detected) > len(kept):
        logger.info(
            "  (%d burst subjects dropped by --max-subjects=%d)",
            len(detected) - len(kept), max_subjects,
        )

    return {
        "years":       years,
        "docs_total":  [int(t) for t in totals],
        "subjects":    kept,
        "tested":      tested,
        "onset_dropped": onset_dropped,
        "with_bursts": len(detected),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--output", type=Path,
                        default=Path("asset/data/keyness.json"),
                        help="Output JSON path")
    parser.add_argument("--top-n", type=int, default=DEFAULT_TOP_N,
                        help="Distinctive terms per slice (default: %(default)s)")
    parser.add_argument("--min-count", type=int, default=DEFAULT_MIN_COUNT,
                        help="Minimum in-slice token count to test (default: %(default)s)")
    parser.add_argument("--alpha", type=float, default=ALPHA,
                        help="BH false-discovery rate (default: %(default)s)")
    parser.add_argument("--min-log-ratio", type=float, default=DEFAULT_MIN_LOG_RATIO,
                        help="Minimum log2 rate ratio to report; 0.585 = 1.5x "
                             "(default: %(default)s). Pass 0 to report every "
                             "statistically significant term.")
    parser.add_argument("--min-subject-total", type=int,
                        default=DEFAULT_MIN_SUBJECT_TOTAL,
                        help="Minimum articles per subject for burst detection "
                             "(default: %(default)s)")
    parser.add_argument("--max-subjects", type=int, default=DEFAULT_MAX_SUBJECTS,
                        help="Burst subjects kept, by strongest burst "
                             "(default: %(default)s)")
    parser.add_argument("--burst-s", type=float, default=DEFAULT_BURST_S,
                        help="Kleinberg burst-rate multiplier (default: %(default)s)")
    parser.add_argument("--burst-gamma", type=float, default=DEFAULT_BURST_GAMMA,
                        help="Kleinberg state-transition cost (default: %(default)s)")
    add_standard_args(parser, minify_default=True)
    args = parse_standard_args(parser)
    logger = logging.getLogger(__name__)

    logger.info("Loading articles subset (%s)…", ", ".join(COLUMNS))
    df = load_dataset_safe(SUBSET, repo_id=args.repo, columns=COLUMNS)
    if df is None or df.empty:
        logger.error("articles subset returned empty — aborting")
        return 2
    logger.info("  %d articles", len(df))

    keyness = build_keyness(
        df, top_n=args.top_n, min_count=args.min_count, alpha=args.alpha,
        min_log_ratio=args.min_log_ratio,
    )
    bursts = build_bursts(
        df,
        min_subject_total=args.min_subject_total,
        max_subjects=args.max_subjects,
        burst_s=args.burst_s,
        burst_gamma=args.burst_gamma,
    )

    payload = create_metadata_block(
        total_records=len(df),
        data_source=args.repo,
        script="generate_keyness.py",
        script_version="0.1.0",
    )
    payload["params"] = {
        "alpha":             args.alpha,
        "min_count":         args.min_count,
        "min_log_ratio":     args.min_log_ratio,
        "top_n":             args.top_n,
        "min_subject_total": args.min_subject_total,
        "max_subjects":      args.max_subjects,
        "burst_s":           args.burst_s,
        "burst_gamma":       args.burst_gamma,
    }
    payload["keyness"] = keyness
    if bursts is not None:
        payload["bursts"] = bursts

    save_json(payload, args.output, minify=args.minify)
    logger.info("Keyness bundle written to %s", args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
