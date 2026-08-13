#!/usr/bin/env python3
"""
generate_template_summary.py
============================

Light-weight precompute for the per-item "minimal" Visualizations
block (drives Audio / Video recording / YouTube video / Document /
Photograph resource pages, dispatched through
``Visualizations::TEMPLATE_PARTIALS``).

Three HF subsets feed it:

* ``audiovisual`` — class 38, **two populations on two templates**.
  Template 19 (*Video recording*) holds recordings deposited with the
  project on physical media; template 23 (*YouTube video*, added
  2026-08-12) holds videos ingested from public channels. The dataset
  distinguishes them with ``source_type`` (``deposited`` / ``youtube``),
  which is the only reliable key: raw ``medium`` mixes carrier labels
  (``DVD``, ``CD``, ``Vidéo sur le web``) that answer "what was it
  stored on", not "where does it come from", and an ``audio`` / ``video``
  split cannot be recovered from them at all.
* ``documents`` — heterogeneous (official letters, communiqués,
  sermons, posters), split on free-text ``type``; Document is template 22.
* ``images`` — photographs (class 58 ``bibo:Image``), template 15. The
  only subset here carrying an embedding (``embedding_image``, a
  multimodal ``gemini-embedding-2`` vector of the photograph *itself*),
  so photograph pages get real similarity neighbours in
  ``similar_by_id`` instead of the recency list the others fall back to.

Every count below is generated, never asserted in prose: the corpus
grew from 47 to four figures in a single afternoon when the YouTube
backfill ran, and any number frozen into a docstring or a test was
wrong within hours.

Output bundle: ``asset/data/template-summary.json`` keyed by subset:

.. code-block:: json

    {
      "metadata": { "totalRecords": 1202, "subset_totals": {...}, ... },
      "subsets": {
        "audiovisual": {
          "total": 1146,
          "year_min": 1999, "year_max": 2026,
          "years": [{"year": 1999, "count": 30}, ...],
          "duration": {"count": 1146, "total_seconds": 984752,
                       "median_seconds": 183},
          "top_items": [
            {"o_id": 12345, "title": "...", "date": "2026-08-11",
             "country": "Burkina Faso", "publisher": "RTB",
             "language": "Français", "thumbnail": "...",
             "duration": 154, "url": "https://www.youtube.com/watch?v=…",
             "source_type": "youtube"},
            ...30 most recent
          ],
          "by_source_type": {
            "youtube":   { ...same shape... },
            "deposited": { ...same shape... }
          },
          "by_publisher": {
            "rtb - radiodiffusion télévision du burkina": {
              "label": "RTB - Radiodiffusion Télévision du Burkina",
              "source_type": "youtube",
              ...same shape...
            },
            ...
          }
        },
        "documents": { "total": 26, ..., "by_type": {...} },
        "images":    { "total": 30, ..., "similar_by_id": {...} }
      }
    }

The front-end orchestrator (``minimal-item-dashboard.js``) reads the
container's ``data-subset`` and, for audiovisual pages, ``data-channel``
(the item's own publisher) — scoping the panels to that channel's
uploads when a matching ``by_publisher`` slice exists and falling back
to the whole subset when it doesn't. That fallback is what keeps the
block working on a dataset generated before this split existed, and on
any item whose publisher is missing.

Slice keys are normalised to NFC + lowercased so the front-end can look
them up case-insensitively even when the source field mixes
capitalisation or accents; each slice carries the most common raw form
as ``label`` for display. The client normalises its own lookup key the
same way (``String.prototype.normalize('NFC').toLowerCase()``), so the
PHP side never has to reproduce this normalisation.

Usage::

    python scripts/generate_template_summary.py
    python scripts/generate_template_summary.py --minify -v
"""
from __future__ import annotations

import argparse
import logging
import statistics
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from iwac_embeddings import build_normalized_matrix, top_k_cosine
from iwac_utils import (
    DATASET_ID,
    canonical_country,
    clean_str,
    configure_logging,
    create_metadata_block,
    extract_year,
    find_column,
    load_dataset_safe,
    parse_duration_seconds,
    save_json,
)


# Subsets covered by this precompute. Articles + publications are
# already covered by their own dedicated dashboards (article + person
# / entity dashboards); references-overview covers references at
# corpus level. The audiovisual, documents and images subsets are the
# under-covered ones — small, heterogeneous, worth surfacing as
# "context" panels on per-item Visualizations blocks.
SUBSETS = ["audiovisual", "documents", "images"]

# Top-N items kept per slice. The minimal-item orchestrator picks ~6
# to show as "other items in this collection" cards; 30 leaves
# headroom for client-side filtering (e.g. dropping the current
# item, prioritising same-country neighbours).
TOP_ITEMS = 30

# subset → embedding column, for subsets where we can do better than a
# recency list. Only ``images`` qualifies today: ``embedding_image`` is
# multimodal (the photograph itself is embedded), so cosine neighbours
# are genuinely "looks / reads like this one". The text subsets here
# carry no embedding at all — audiovisual has transcriptions but no
# vectors, documents neither.
EMBEDDING_COLUMNS: Dict[str, str] = {"images": "embedding_image"}

# Neighbours kept per item. The strip renders up to 8 cards; 6 keeps
# the payload small while leaving the client room to drop any card
# whose target has since been unpublished.
SIMILAR_TOP_K = 6

# Facet columns per subset, in the order the front-end should try them.
# ``audiovisual`` gets two: the population split (deposited recordings vs
# YouTube uploads) and the channel/publisher split the per-item block
# scopes itself to. ``medium`` is deliberately absent — see the module
# docstring; it names the carrier, not the source, and grouping ``DVD``,
# ``CD`` and ``Vidéo sur le web`` as if they were one dimension produced
# the uneven 43/1 slices no partial could use.
FACET_COLUMNS: Dict[str, Dict[str, str]] = {
    "audiovisual": {"by_source_type": "source_type", "by_publisher": "publisher"},
    "documents":   {"by_type": "type"},
}

# Card `type` token per subset. These are i18n keys (``item_type_*`` in
# iwac-i18n.js), not data: the raw column would put "Enregistrement
# vidéo" on the cards of an English page, since the dataset's `type` is
# French free text. The facet split still reads the raw column — only
# the card label is normalised.
SUBSET_ITEM_TYPE: Dict[str, str] = {
    "audiovisual": "audiovisual",
    "documents":   "document",
    "images":      "image",
}


logger: Optional[logging.Logger] = None


def first_country(value: Any) -> str:
    """Canonical first IWAC country from a multi-value cell, or ''."""
    s = clean_str(value)
    if not s or s.lower() == "unknown":
        return ""
    head = s.split("|", 1)[0].strip()
    if not head or head.lower() == "unknown":
        return ""
    return canonical_country(head)


def slice_key(value: str) -> str:
    """Lowercase NFC-normalised slice key. Lets the front-end look up
    a slice case-insensitively even when the source field carries
    minor capitalisation / accent variations."""
    s = unicodedata.normalize("NFC", clean_str(value)).lower().strip()
    return s


def find_columns(df: pd.DataFrame, subset_name: str = "") -> Dict[str, Optional[str]]:
    """Resolve column names defensively across subsets — some carry
    `creator` (audiovisual), others `author` (documents); some have
    `publisher` only on audiovisual; etc.

    ``_item_type`` is the one entry that is not a column name: it is the
    i18n token every card in this subset carries (see
    ``SUBSET_ITEM_TYPE``). It rides along here so ``build_item`` keeps a
    single resolution argument.
    """
    return {
        "_item_type":  SUBSET_ITEM_TYPE.get(subset_name) or None,
        "id":          find_column(df, ["o:id", "id"]),
        "title":       find_column(df, ["title", "Titre", "dcterms:title"]),
        "date":        find_column(df, ["pub_date", "dcterms:date", "date"]),
        "country":     find_column(df, ["country", "countries"]),
        "creator":     find_column(df, ["creator", "author", "publisher"]),
        # `publisher` and `source` are NOT interchangeable and must not be
        # collapsed: on audiovisual `publisher` is the depositing body or
        # the YouTube channel (populated for effectively the whole subset)
        # while `source` is dcterms:source, which only the deposited
        # recordings carry. Resolve them separately and let the card show
        # both when they differ.
        "publisher":   find_column(df, ["publisher"]),
        "source":      find_column(df, ["source", "dcterms:source", "newspaper"]),
        "language":    find_column(df, ["language", "dcterms:language"]),
        "thumbnail":   find_column(df, ["thumbnail"]),
        "type":        find_column(df, ["type", "dcterms:type"]),
        # Where the item lives outside IWAC — the canonical watch URL for
        # the YouTube cohort.
        "url":         find_column(df, ["URL", "url"]),
        "source_type": find_column(df, ["source_type"]),
        # Duration, preferring the explicit seconds column the 2026-08
        # mapper added; `extent` (ISO 8601) is the fallback for rows and
        # snapshots that predate it.
        "duration":    find_column(df, ["duration_seconds"]),
        "extent":      find_column(df, ["extent"]),
    }


def row_duration_seconds(row: Any, columns: Dict[str, Optional[str]]) -> Optional[int]:
    """Runtime of one row in seconds, or None when it has no usable value.

    Reads the explicit ``duration_seconds`` column first and falls back to
    parsing ISO 8601 ``extent``. Both are checked per row rather than
    per subset because the two audiovisual populations were mapped at
    different times — a snapshot can carry the column for the YouTube
    cohort and nothing but ``extent`` for the deposited one.
    """
    if columns.get("duration"):
        seconds = parse_duration_seconds(row.get(columns["duration"]))
        if seconds:
            return seconds
    if columns.get("extent"):
        seconds = parse_duration_seconds(row.get(columns["extent"]))
        if seconds:
            return seconds
    return None


def duration_summary(values: List[int]) -> Optional[Dict[str, int]]:
    """Total + median runtime over a slice, or None when nothing has one.

    The median is reported alongside the total because the two answer
    different questions on a corpus this uneven: a channel of ~3-minute
    news clips and a handful of multi-hour deposited sermons produce the
    same total from wildly different material.
    """
    usable = [v for v in values if v and v > 0]
    if not usable:
        return None
    return {
        "count":          len(usable),
        "total_seconds":  int(sum(usable)),
        "median_seconds": int(round(statistics.median(usable))),
    }


def build_item(row: Any, columns: Dict[str, Optional[str]]) -> Optional[Dict[str, Any]]:
    """Card record for one row, or None when it has no usable ``o:id``.

    The single definition of the card shape consumed by the
    ``similar-items`` renderer — shared by the ``top_items`` recency
    list and the ``similar_by_id`` neighbour lists so the two can never
    drift apart.
    """
    id_col = columns["id"]
    if not id_col:
        return None
    try:
        o_id = int(row.get(id_col))
    except (TypeError, ValueError):
        return None

    date_raw = clean_str(row.get(columns["date"])) if columns["date"] else ""
    item: Dict[str, Any] = {
        "o_id":      o_id,
        "title":     clean_str(row.get(columns["title"])) if columns["title"] else "",
        "date":      date_raw[:10] if date_raw else "",
        "country":   first_country(row.get(columns["country"])) if columns["country"] else "",
        "language":  clean_str(row.get(columns["language"])) if columns["language"] else "",
        "thumbnail": clean_str(row.get(columns["thumbnail"])) if columns["thumbnail"] else "",
    }
    # Optional fields — kept only when present so the JSON stays
    # narrow per-item and the client doesn't have to filter empty
    # strings out of the meta line.
    #
    # Three fields the row carries are deliberately NOT on the card:
    # `medium` and `extent` (the carrier label and the raw ISO string —
    # superseded by the normalised `duration` the client formats) and
    # `source_type` (constant within a slice, which records it once).
    #
    # `url` IS carried, though today's strip does not render it: the
    # card is a single anchor to the IWAC record, and a second link
    # nested inside it would be invalid markup. Landing a reader on the
    # record — which carries the canonical watch URL itself — is also
    # the better default than scattering eight cards' worth of traffic
    # to a third-party site. The current video's watch link is rendered
    # server-side by the partial instead.
    if columns.get("_item_type"):
        item["type"] = columns["_item_type"]
    for key in ("creator", "publisher", "source", "url"):
        col = columns[key]
        if not col:
            continue
        value = clean_str(row.get(col))
        if value:
            item[key] = value

    seconds = row_duration_seconds(row, columns)
    if seconds:
        item["duration"] = seconds
    return item


def slice_summary(df: pd.DataFrame, columns: Dict[str, Optional[str]]) -> Dict[str, Any]:
    """Compact summary of a single dataframe slice — total, year
    range, year histogram, top-N items (most-recent first)."""
    date_col = columns["date"]

    total = len(df)
    year_counter: Counter = Counter()
    items: List[Dict[str, Any]] = []
    durations: List[int] = []

    for _, row in df.iterrows():
        date_raw = clean_str(row.get(date_col)) if date_col else ""
        year = extract_year(date_raw) if date_raw else None
        if year:
            year_counter[year] += 1

        seconds = row_duration_seconds(row, columns)
        if seconds:
            durations.append(seconds)

        item = build_item(row, columns)
        if item is not None:
            items.append(item)

    # Most-recent first by date string (ISO sorts lexically).
    items.sort(key=lambda i: i.get("date") or "", reverse=True)

    years_sorted = sorted(year_counter.items())
    summary: Dict[str, Any] = {
        "total":     total,
        "year_min":  years_sorted[0][0]  if years_sorted else None,
        "year_max":  years_sorted[-1][0] if years_sorted else None,
        "years":     [{"year": y, "count": c} for y, c in years_sorted],
        "top_items": items[:TOP_ITEMS],
    }
    duration = duration_summary(durations)
    if duration:
        summary["duration"] = duration
    return summary


def split_by_facet(
    df: pd.DataFrame,
    facet_col: str,
    columns: Dict[str, Optional[str]],
) -> Dict[str, Any]:
    """Group ``df`` rows by their value in ``facet_col``, run
    ``slice_summary`` on each group, return ``{slice_key: summary}``.
    The slice key is the NFC-normalised lowercase form so the
    front-end can look up subsets case-insensitively. Each summary
    inherits an additional ``label`` field carrying the most common
    raw display form for the group, so the UI can render the original
    capitalisation / accents.

    When the frame carries ``source_type``, each slice also records the
    population it belongs to, so a channel panel can say whether it is
    describing YouTube uploads or deposited recordings without the
    client having to infer it from the cards.
    """
    groups: Dict[str, List[int]] = defaultdict(list)
    raw_label_counters: Dict[str, Counter] = defaultdict(Counter)

    for idx in df.index:
        raw = clean_str(df.at[idx, facet_col])
        if not raw:
            continue
        key = slice_key(raw)
        if not key:
            continue
        groups[key].append(idx)
        raw_label_counters[key][raw] += 1

    source_type_col = columns.get("source_type")

    out: Dict[str, Any] = {}
    for key, rows in groups.items():
        sub = df.loc[rows]
        summary = slice_summary(sub, columns)
        # Use the most-common raw label as the display form.
        label = raw_label_counters[key].most_common(1)[0][0]
        summary["label"] = label
        if source_type_col and source_type_col != facet_col:
            kinds = Counter(
                clean_str(value) for value in sub[source_type_col] if clean_str(value)
            )
            if kinds:
                summary["source_type"] = kinds.most_common(1)[0][0]
        out[key] = summary
    return out


def build_similar_by_id(
    df: pd.DataFrame,
    columns: Dict[str, Optional[str]],
    embed_col: str,
    top_k: int = SIMILAR_TOP_K,
) -> Dict[str, List[Dict[str, Any]]]:
    """``{o_id: [neighbour card, …]}`` by cosine similarity over
    ``embed_col``, for subsets that carry an embedding.

    Rows without a usable vector are simply absent from the map — the
    client falls back to the recency list for those, so partial
    embedding coverage degrades gracefully instead of emptying the
    panel.
    """
    if embed_col not in df.columns:
        return {}

    X, valid = build_normalized_matrix(df, embed_col)
    if X.shape[0] < 2:
        return {}

    neighbours = top_k_cosine(X, valid, top_k)
    out: Dict[str, List[Dict[str, Any]]] = {}

    for i, row_pos in enumerate(valid):
        source = build_item(df.iloc[row_pos], columns)
        if source is None:
            continue
        cards: List[Dict[str, Any]] = []
        for matrix_idx, score in neighbours[i]:
            card = build_item(df.iloc[valid[matrix_idx]], columns)
            if card is None:
                continue
            card["score"] = round(score, 4)
            cards.append(card)
        if cards:
            out[str(source["o_id"])] = cards

    return out


def build_subset_summary(
    subset_name: str,
    df: pd.DataFrame,
) -> Dict[str, Any]:
    """Top-level summary + appropriate facet splits per subset.

    The whole-subset summary is always emitted and is what the block
    falls back to, so a subset whose facet columns are missing (an older
    snapshot, a source without a publisher) still renders.
    """
    columns = find_columns(df, subset_name)
    summary = slice_summary(df, columns)

    # `by_source_type` separates deposited recordings from YouTube
    # uploads; `by_publisher` is the channel scope the per-item block
    # reads. On `documents` the single facet is free-text `type` —
    # photographs left that subset in 2026-07 (they are class 58 with
    # their own `images` subset now), so no partial reads a `by_type`
    # slice today; it stays for the granular splits the block can grow
    # into.
    for facet_key, column_key in FACET_COLUMNS.get(subset_name, {}).items():
        column = columns.get(column_key)
        if not column:
            continue
        slices = split_by_facet(df, column, columns)
        if slices:
            summary[facet_key] = slices

    embed_col = EMBEDDING_COLUMNS.get(subset_name)
    if embed_col:
        similar = build_similar_by_id(df, columns, embed_col)
        if similar:
            summary["similar_by_id"] = similar

    return summary


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--repo", default=DATASET_ID,
                        help="Hugging Face dataset repo id")
    parser.add_argument("--output", type=Path,
                        default=Path("asset/data/template-summary.json"),
                        help="Output JSON path")
    parser.add_argument("--minify", action=argparse.BooleanOptionalAction,
                        default=False,
                        help="Strip whitespace from output JSON (default: %(default)s)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    global logger
    logger = configure_logging(level=logging.DEBUG if args.verbose else logging.INFO)

    subsets_out: Dict[str, Any] = {}
    subset_totals: Dict[str, int] = {}
    total_records = 0

    for subset_name in SUBSETS:
        logger.info(f"Loading subset '{subset_name}'…")
        df = load_dataset_safe(subset_name, repo_id=args.repo)
        if df is None or df.empty:
            logger.warning(f"  {subset_name}: empty subset, skipping")
            continue

        summary = build_subset_summary(subset_name, df)
        subsets_out[subset_name] = summary
        subset_totals[subset_name] = int(summary.get("total", 0))
        total_records += summary.get("total", 0)
        logger.info(
            "  %s: %d items (%s–%s)",
            subset_name,
            summary["total"],
            summary.get("year_min") or "?",
            summary.get("year_max") or "?",
        )
        duration = summary.get("duration")
        if duration:
            logger.info(
                "    runtime: %.1f h over %d items (median %d s)",
                duration["total_seconds"] / 3600.0,
                duration["count"],
                duration["median_seconds"],
            )
        for facet_key in FACET_COLUMNS.get(subset_name, {}):
            for key, slice_ in (summary.get(facet_key) or {}).items():
                logger.info(
                    "    %s['%s'] (%s): %d items",
                    facet_key, key, slice_.get("label", "?"), slice_["total"],
                )
        if "similar_by_id" in summary:
            logger.info(
                "    semantic neighbours for %d/%d items (%s)",
                len(summary["similar_by_id"]),
                summary["total"],
                EMBEDDING_COLUMNS[subset_name],
            )

    bundle = create_metadata_block(
        total_records=total_records,
        data_source=DATASET_ID,
        subsets=list(subsets_out.keys()),
        # Per-subset totals so consumers (docs, tests, the block's own
        # copy) read a generated number instead of one frozen in prose.
        subset_totals=subset_totals,
    )
    bundle["subsets"] = subsets_out

    save_json(bundle, args.output, minify=args.minify)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
