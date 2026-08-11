#!/usr/bin/env python3
"""
generate_topic_explorer.py
==========================

Generate a single ``asset/data/topic-explorer.json`` bundle that drives
the IwacVisualizations ``topicExplorer`` page block.

The IWAC ``articles`` subset carries a precomputed LDA-30 topic
assignment per article in three columns (see ``DATA_NOTES.md``):

    * ``lda_topic_id``    — float64; the most-likely topic index, or
                             ``-1`` for "outlier" articles that didn't
                             attach to any topic strongly.
    * ``lda_topic_prob``  — float64; the model's confidence in that
                             assignment (0..1).
    * ``lda_topic_label`` — string; the top words for the topic
                             (consistent per topic_id).
    * ``lda_topic_topk``  — string; ``"id:prob|id:prob|…"``, the top-k
                             topics per article (k=3) in descending
                             probability. Added by the 2026-07 LDA re-run
                             and optional here: absent it, the bundle
                             simply carries no ``prevalence`` key.

Two different questions get two different aggregations, and the block
offers both rather than picking one:

    dominant topic       per-topic article counts — "how many articles is
                         this topic the single best label for"
    probability-weighted per-year mean probability mass from
    prevalence       ``lda_topic_topk`` — "how much of the corpus's
                         attention went to this topic". Truncated to the
                         top k, so masses sum to < 1; see
                         ``aggregate_prevalence``.

This generator aggregates per-topic statistics into a JSON shape the
front-end can consume without any further joins:

.. code-block:: json

    {
      "version": "1.0",
      "generated_at": "2026-05-09T...",
      "metadata": {
        "total_topics":  30,
        "total_articles_with_topic": 11_945,
        "outliers":      287,
        "year_min":      1955,
        "year_max":      2024,
        "newspapers":     87
      },
      "topics": [
        {
          "id":               0,
          "label":            "religion - islam - musulman - allah - dieu",
          "top_words":        ["religion", "islam", "musulman", ...],
          "article_count":    1234,
          "year_min":         1995,
          "year_max":         2024,
          "year_distribution":  [{"name": "1995", "value": 12}, ...],
          "day_cells":          [["2020-01-15", 5], ["2020-01-23", 3], ...],
          "hijri_cells":        [[1441, 5, 8], [1441, 6, 3], ...],
          "country_distribution": [{"name": "Bénin", "value": 45}, ...],
          "newspaper_distribution": [{"name": "Le Soleil", "value": 23}, ...],
          "top_articles": [
            {
              "o_id":    12345,
              "title":   "...",
              "newspaper": "...",
              "country": "...",
              "date":    "2018-03-15",
              "topic_prob": 0.92,
              "thumbnail":  "..."
            },
            ...10 most-representative articles by topic_prob
          ]
        },
        ...30 topic objects
      ]
    }

Usage::

    python scripts/generate_topic_explorer.py
    python scripts/generate_topic_explorer.py --minify
    python scripts/generate_topic_explorer.py --top-articles 15
"""
from __future__ import annotations

import argparse
import logging
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    HIJRI_COLUMNS,
    canonical_country,
    clean_float,
    clean_str,
    configure_logging,
    create_metadata_block,
    extract_year,
    find_column,
    load_dataset_safe,
    read_hijri_month,
    save_json,
)


# Default: 10 most-representative articles per topic (highest topic_prob).
# 10 fits a comfortable card grid; >15 would crowd the panel without
# adding much information past the first dozen.
DEFAULT_TOP_ARTICLES = 10

# Truncate the country / newspaper distributions to keep the JSON
# trim. Past 15 the horizontal bar chart becomes a wall of labels.
MAX_DISTRIBUTION_BARS = 15

# Outlier articles (lda_topic_id == -1) are excluded from per-topic
# aggregations but counted in the metadata so the user can see the
# size of the un-classified residual.
OUTLIER_TOPIC_ID = -1


logger: Optional[logging.Logger] = None


def parse_top_words(label: str, max_words: int = 10) -> List[str]:
    """Split a ``lda_topic_label`` string into individual top words.

    The labels are written as space- or hyphen-separated chains
    (``"religion - islam - musulman - ..."``) — splitting on either
    one produces a clean word list. Trims surrounding whitespace and
    drops empty fragments.
    """
    if not label:
        return []
    # Replace en-dash / em-dash variants with a hyphen so the split
    # below catches them regardless of source.
    s = (label
         .replace('–', '-')   # en-dash
         .replace('—', '-'))  # em-dash
    # Split on either ' - ' (space-dash-space) or ',' to be defensive
    # about whatever separator the upstream model emitted.
    parts: List[str] = []
    for chunk in s.split(','):
        parts.extend(p.strip() for p in chunk.split(' - ') if p.strip())
    return parts[:max_words] if parts else [s.strip()]


def first_country(value: Any) -> str:
    """Return the canonical first country from a multi-value cell, or ''."""
    s = clean_str(value)
    if not s or s.lower() == 'unknown':
        return ''
    head = s.split('|', 1)[0].strip()
    if not head or head.lower() == 'unknown':
        return ''
    return canonical_country(head)


def extract_iso_day(value: Any) -> Optional[str]:
    """Return ``YYYY-MM-DD`` from an ISO date, or None if the source
    isn't precise enough.

    Bare-year dates (``"1995"``) and missing-day dates (``"1995-06"``)
    return None: the calendar heatmap places cells on a specific day,
    so partial dates would either be silently shifted onto the 1st of
    January / 1st of the month (visually misleading) or thrown off
    altogether. Better to skip them than to fake a position.
    """
    s = clean_str(value)
    if len(s) < 10 or s[4] != '-' or s[7] != '-':
        return None
    if not (s[5:7].isdigit() and s[8:10].isdigit()):
        return None
    return s[:10]


# HIJRI_COLUMNS / read_hijri_month moved to iwac_utils in v1.39.0, when
# the person + entity dashboards became a second consumer. Re-exported
# here so this module's own name keeps working for existing callers and
# tests.


def aggregate_per_topic(
    df: pd.DataFrame,
    columns: Dict[str, Optional[str]],
    top_articles: int,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Walk every article row once, accumulate per-topic stats, return
    a sorted topics list + a corpus-level metadata block.
    """
    topic_id_col   = columns['topic_id']
    topic_prob_col = columns['topic_prob']
    topic_label_col = columns['topic_label']
    article_id_col = columns['article_id']
    title_col      = columns['title']
    date_col       = columns['date']
    country_col    = columns['country']
    newspaper_col  = columns['newspaper']
    thumbnail_col  = columns['thumbnail']
    hijri_cols     = {c: columns.get(c) for c in HIJRI_COLUMNS}
    if not all(hijri_cols.values()):
        logger.warning(
            "articles carries no %s — the calendar's Hijri facet will be "
            "absent. Re-pull the dataset; these are written upstream for "
            "every complete YYYY-MM-DD.",
            ', '.join(c for c in HIJRI_COLUMNS if not hijri_cols.get(c)))

    stats = {'hijri_dated': 0, 'hijri_missing': 0}

    # Per-topic accumulators
    counts:    Dict[int, int]                = {}
    labels:    Dict[int, str]                = {}
    years_min: Dict[int, int]                = {}
    years_max: Dict[int, int]                = {}
    year_hist: Dict[int, Counter]            = {}
    day_hist:  Dict[int, Counter]            = {}
    # Keyed by (hijri_year, hijri_month) — the Hijri facet's grid is a
    # year x month matrix, so aggregating here rather than shipping a
    # day->Hijri lookup keeps the payload smaller than `day_cells` and
    # takes the conversion off the client entirely.
    hijri_hist: Dict[int, Counter]           = {}
    country_hist: Dict[int, Counter]         = {}
    newspaper_hist: Dict[int, Counter]       = {}
    candidates: Dict[int, List[Dict[str, Any]]] = {}

    # Corpus-level metadata
    outlier_count = 0
    corpus_year_min: Optional[int] = None
    corpus_year_max: Optional[int] = None
    all_newspapers = set()

    for _, row in df.iterrows():
        raw_topic = clean_float(row.get(topic_id_col))
        if raw_topic is None:
            continue
        topic_id = int(raw_topic)
        if topic_id == OUTLIER_TOPIC_ID:
            outlier_count += 1
            continue

        prob = clean_float(row.get(topic_prob_col)) or 0.0
        year = extract_year(row.get(date_col)) if date_col else None
        day_key = extract_iso_day(row.get(date_col)) if date_col else None
        country = first_country(row.get(country_col)) if country_col else ''
        newspaper = clean_str(row.get(newspaper_col)) if newspaper_col else ''
        if newspaper:
            all_newspapers.add(newspaper)

        # Update per-topic state
        counts[topic_id] = counts.get(topic_id, 0) + 1
        if topic_id not in labels and topic_label_col:
            labels[topic_id] = clean_str(row.get(topic_label_col))
        if year is not None:
            if topic_id not in years_min or year < years_min[topic_id]:
                years_min[topic_id] = year
            if topic_id not in years_max or year > years_max[topic_id]:
                years_max[topic_id] = year
            year_hist.setdefault(topic_id, Counter())[year] += 1
            if corpus_year_min is None or year < corpus_year_min:
                corpus_year_min = year
            if corpus_year_max is None or year > corpus_year_max:
                corpus_year_max = year
        if day_key:
            day_hist.setdefault(topic_id, Counter())[day_key] += 1
        hijri_key = read_hijri_month(row, hijri_cols)
        if hijri_key:
            hijri_hist.setdefault(topic_id, Counter())[hijri_key] += 1
            stats['hijri_dated'] += 1
        elif day_key:
            # A fully-dated article the dataset has no Hijri date for.
            # Counted so the run says how much the Hijri facet is missing
            # rather than quietly drawing a thinner grid.
            stats['hijri_missing'] += 1
        if country:
            country_hist.setdefault(topic_id, Counter())[country] += 1
        if newspaper:
            newspaper_hist.setdefault(topic_id, Counter())[newspaper] += 1

        # Top-articles candidate buffer — every row, sort + truncate
        # at the end so we don't pay an O(n log n) sort per insert.
        article_id = clean_float(row.get(article_id_col))
        if article_id is None:
            continue
        candidates.setdefault(topic_id, []).append({
            'o_id':       int(article_id),
            'title':      clean_str(row.get(title_col)) if title_col else '',
            'newspaper':  newspaper,
            'country':    country,
            'date':       clean_str(row.get(date_col))[:10] if date_col else '',
            'topic_prob': round(prob, 4),
            'thumbnail':  clean_str(row.get(thumbnail_col)) if thumbnail_col else '',
        })

    # Build sorted topic objects
    topics: List[Dict[str, Any]] = []
    for topic_id in sorted(counts.keys()):
        label = labels.get(topic_id, f'Topic {topic_id}')
        top_words = parse_top_words(label, max_words=10)

        # Year distribution as sorted [{name: '1999', value: N}] —
        # plays straight into ECharts category axes and the sparkline
        # renderer's {years, values} shape (caller can map both).
        year_pairs = sorted(year_hist.get(topic_id, Counter()).items())
        year_distribution = [
            {'name': str(y), 'value': v} for y, v in year_pairs
        ]

        # Calendar-heatmap cells — one entry per day with at least one
        # article. Articles whose pub_date is bare-year or year-month
        # only are excluded from the heatmap (see ``extract_iso_day``)
        # so cells never get fake-positioned at January 1.
        day_pairs = sorted(day_hist.get(topic_id, Counter()).items())
        day_cells = [[d, v] for d, v in day_pairs]

        # Hijri counterpart, already aggregated to the year x month grid
        # the facet draws: [[hijri_year, hijri_month, count], ...]. The
        # client does no calendar conversion — see HIJRI_COLUMNS.
        hijri_pairs = sorted(hijri_hist.get(topic_id, Counter()).items())
        hijri_cells = [[y, m, v] for (y, m), v in hijri_pairs]

        country_dist = [
            {'name': name, 'value': v}
            for name, v in country_hist.get(topic_id, Counter()).most_common(MAX_DISTRIBUTION_BARS)
        ]
        newspaper_dist = [
            {'name': name, 'value': v}
            for name, v in newspaper_hist.get(topic_id, Counter()).most_common(MAX_DISTRIBUTION_BARS)
        ]

        # Most representative articles — sort by topic_prob desc.
        cands = candidates.get(topic_id, [])
        cands.sort(key=lambda c: c['topic_prob'], reverse=True)
        top_arts = cands[:top_articles]

        topics.append({
            'id':                     topic_id,
            'label':                  label,
            'top_words':              top_words,
            'article_count':          counts[topic_id],
            'year_min':               years_min.get(topic_id),
            'year_max':               years_max.get(topic_id),
            'year_distribution':      year_distribution,
            'day_cells':              day_cells,
            'hijri_cells':            hijri_cells,
            'country_distribution':   country_dist,
            'newspaper_distribution': newspaper_dist,
            'top_articles':           top_arts,
        })

    logger.info("Hijri-dated articles: %d%s", stats['hijri_dated'],
                f" · fully dated but missing a stored Hijri date: "
                f"{stats['hijri_missing']}" if stats['hijri_missing'] else "")
    if stats['hijri_missing']:
        logger.warning(
            "%d fully-dated articles carry no Hijri date and are absent from "
            "the calendar's Hijri facet. The dataset populates hijri_* for "
            "every complete YYYY-MM-DD, so this means the snapshot predates a "
            "pipeline run rather than the dates being unconvertible.",
            stats['hijri_missing'])

    metadata = {
        'total_topics':              len(topics),
        'total_articles_with_topic': sum(counts.values()),
        'outliers':                  outlier_count,
        'year_min':                  corpus_year_min,
        'year_max':                  corpus_year_max,
        'newspapers':                len(all_newspapers),
        'hijri_dated':               stats['hijri_dated'],
    }

    return topics, metadata


def parse_topk(value: Any) -> List[Tuple[int, float]]:
    """Parse an ``lda_topic_topk`` cell into ``[(topic_id, prob), …]``.

    Format is ``"id:prob|id:prob|…"``, descending by probability, written
    by the upstream LDA pass. Entries below the model's
    ``minimum_probability`` are already dropped upstream, so a cell can
    hold fewer than k pairs — never assume exactly three. Malformed
    fragments are skipped rather than guessed at.
    """
    text = clean_str(value)
    if not text:
        return []
    pairs: List[Tuple[int, float]] = []
    for fragment in text.split('|'):
        head, _, tail = fragment.partition(':')
        if not tail:
            continue
        try:
            topic_id = int(head)
            prob = float(tail)
        except (TypeError, ValueError):
            continue
        if topic_id < 0 or not (0.0 <= prob <= 1.0):
            continue
        pairs.append((topic_id, prob))
    return pairs


def aggregate_prevalence(
    df: pd.DataFrame,
    columns: Dict[str, Optional[str]],
    labels: Dict[int, str],
) -> Optional[Dict[str, Any]]:
    """Probability-weighted topic prevalence per year, from ``lda_topic_topk``.

    Counting dominant topics answers "how many articles is this topic the
    single best label for". That is a coarse question: an article the model
    splits 0.34 / 0.33 / 0.33 counts fully for one topic and not at all for
    two near-equal others, which makes a genuinely mixed corpus look
    sharper than it is. Weighting by probability mass instead asks "how
    much of the corpus's attention went to this topic", which is the
    quantity a prevalence-over-time claim actually needs.

    **The mass is truncated, and the payload says so rather than hiding
    it.** Only the top *k* topics per article are on the Hub (k=3 by
    default; the full theta matrix is dropped before the push), so the
    per-year masses sum to ``captured_mass`` — typically well under 1.0 —
    not to 1.0. The obvious "fix" of renormalising each article to sum to
    1 would inflate every number by the missing tail and quietly convert a
    known partial measurement into a fake complete one, so it is not done.
    The front end plots the un-normalised stack, which makes the shortfall
    visible as headroom instead of a footnote.

    Returns None when the column is absent (a dataset predating the
    2026-07 LDA re-run), so the block simply keeps its dominant-topic view.
    """
    topk_col = columns.get('topic_topk')
    date_col = columns.get('date')
    if not topk_col or topk_col not in df.columns:
        return None

    year_docs: Counter = Counter()                    # year → contributing docs
    year_mass: Dict[int, float] = {}                  # year → captured mass
    year_topic: Dict[int, Dict[int, float]] = {}      # year → topic → mass
    topic_mass: Dict[int, float] = {}                 # topic → total mass
    docs = 0
    total_mass = 0.0
    max_k = 0

    for _, row in df.iterrows():
        pairs = parse_topk(row.get(topk_col))
        if not pairs:
            continue
        year = extract_year(row.get(date_col)) if date_col else None
        if year is None:
            continue

        docs += 1
        max_k = max(max_k, len(pairs))
        year_docs[year] += 1
        per_topic = year_topic.setdefault(year, {})
        for topic_id, prob in pairs:
            per_topic[topic_id] = per_topic.get(topic_id, 0.0) + prob
            topic_mass[topic_id] = topic_mass.get(topic_id, 0.0) + prob
            year_mass[year] = year_mass.get(year, 0.0) + prob
            total_mass += prob

    if not docs:
        return None

    years = sorted(year_docs)

    # Every topic gets a series: the front end folds its own long tail into
    # an "Other topics" band, and that band is only exact if it is summing
    # real numbers rather than a pre-truncated remainder.
    series: List[Dict[str, Any]] = []
    for topic_id in sorted(topic_mass, key=lambda t: -topic_mass[t]):
        values = []
        for year in years:
            mass = year_topic.get(year, {}).get(topic_id, 0.0)
            values.append(round(mass / year_docs[year], 4) if year_docs[year] else 0.0)
        series.append({
            'id':    topic_id,
            'label': labels.get(topic_id, f'Topic {topic_id}'),
            'mean':  round(topic_mass[topic_id] / docs, 4),
            'values': values,
        })

    return {
        'years':   years,
        'n_docs':  [int(year_docs[y]) for y in years],
        # Mean total probability mass the top-k pairs account for, per
        # year. The gap to 1.0 is the tail the Hub does not carry.
        'captured_mass': [
            round(year_mass.get(y, 0.0) / year_docs[y], 4) if year_docs[y] else 0.0
            for y in years
        ],
        'series':  series,
        'k_max':   max_k,
        'docs':    docs,
        'mean_captured_mass': round(total_mass / docs, 4),
    }


def build_bundle(df: pd.DataFrame, top_articles: int) -> Dict[str, Any]:
    columns = {
        'topic_id':    find_column(df, ['lda_topic_id'],    required=True),
        'topic_prob':  find_column(df, ['lda_topic_prob'],  required=True),
        'topic_label': find_column(df, ['lda_topic_label', 'lda_topic']),
        'topic_topk':  find_column(df, ['lda_topic_topk']),
        'article_id':  find_column(df, ['o:id', 'id'], required=True),
        'title':       find_column(df, ['title', 'Titre', 'dcterms:title']),
        'date':        find_column(df, ['pub_date', 'dcterms:date']),
        'country':     find_column(df, ['country', 'countries']),
        'newspaper':   find_column(df, ['newspaper', 'dcterms:publisher', 'source']),
        'thumbnail':   find_column(df, ['thumbnail']),
        'hijri_year':  find_column(df, ['hijri_year']),
        'hijri_month': find_column(df, ['hijri_month']),
        'hijri_day':   find_column(df, ['hijri_day']),
    }

    topics, meta = aggregate_per_topic(df, columns, top_articles)

    prevalence = aggregate_prevalence(
        df, columns,
        labels={t['id']: t['label'] for t in topics},
    )
    if prevalence is not None:
        meta['prevalence_docs'] = prevalence['docs']
        meta['prevalence_k'] = prevalence['k_max']
        meta['prevalence_mean_captured_mass'] = prevalence['mean_captured_mass']

    bundle = create_metadata_block(
        total_records=meta['total_articles_with_topic'],
        data_source=DATASET_ID,
    )
    bundle.update({
        'metadata': meta,
        'topics':   topics,
    })
    if prevalence is not None:
        bundle['prevalence'] = prevalence
    return bundle


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo', default=DATASET_ID, help='Hugging Face dataset repo id')
    parser.add_argument('--output', type=Path,
                        default=Path('asset/data/topic-explorer.json'),
                        help='Output JSON path')
    parser.add_argument('--top-articles', type=int, default=DEFAULT_TOP_ARTICLES,
                        help='Most-representative articles per topic')
    parser.add_argument('--minify', action=argparse.BooleanOptionalAction,
                        default=False,
                        help='Strip whitespace from output JSON (default: %(default)s)')
    parser.add_argument('-v', '--verbose', action='store_true')
    args = parser.parse_args()

    global logger
    logger = configure_logging(level=logging.DEBUG if args.verbose else logging.INFO)

    logger.info('Loading articles subset (LDA columns)…')
    df = load_dataset_safe('articles', repo_id=args.repo)
    if df is None or df.empty:
        logger.error('articles subset returned empty — aborting')
        return 2
    logger.info('  %d articles', len(df))

    bundle = build_bundle(df, top_articles=args.top_articles)

    logger.info(
        'Aggregated %d topics from %d articles (%d outliers)',
        bundle['metadata']['total_topics'],
        bundle['metadata']['total_articles_with_topic'],
        bundle['metadata']['outliers'],
    )
    prevalence = bundle.get('prevalence')
    if prevalence is None:
        logger.warning(
            'No lda_topic_topk column — probability-weighted prevalence '
            'skipped; the block keeps its dominant-topic view only'
        )
    else:
        logger.info(
            'Probability-weighted prevalence: %d articles, k<=%d, '
            'mean captured mass %.3f (the rest is the tail the Hub does not carry)',
            prevalence['docs'], prevalence['k_max'],
            prevalence['mean_captured_mass'],
        )

    save_json(bundle, args.output, minify=args.minify)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
