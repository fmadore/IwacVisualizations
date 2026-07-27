#!/usr/bin/env python3
"""
generate_template_summary.py
============================

Light-weight precompute for the per-item "minimal" Visualizations
block (drives Audio / Video / Document / Photograph resource pages,
dispatched through ``Visualizations::TEMPLATE_PARTIALS``).

The audiovisual subset (47 items) splits by ``medium`` into audio
(template 9) and video (template 19). The documents subset (26 items)
is heterogeneous — official letters, communiqués, sermons, posters —
and uses free-text ``type`` as the discriminator; Document is template
22. Photographs (template 15) read the ``images`` subset: they are
class 58 ``bibo:Image`` and were exported to Hugging Face in 2026-07,
which is what retires the pre-v1.3.0 hack of serving them the
unrelated ``documents.by_type[photographie]`` slice.

``images`` is also the first subset here to carry an embedding
(``embedding_image`` — a multimodal ``gemini-embedding-2`` vector of the
photograph *itself*, not of its metadata), so photograph pages get real
similarity neighbours in ``similar_by_id`` instead of the recency list
the other subsets fall back to.

Output bundle: ``asset/data/template-summary.json`` keyed by subset:

.. code-block:: json

    {
      "version": "1.0",
      "generated_at": "...",
      "metadata": { "total_records": 71, ... },
      "subsets": {
        "audiovisual": {
          "total": 45,
          "year_min": 1990, "year_max": 2024,
          "years": [{"year": 1990, "count": 1}, ...],
          "top_items": [
            {"o_id": 12345, "title": "...", "date": "2018-03",
             "country": "Nigeria", "source": "BBC Hausa",
             "language": "ha", "thumbnail": "...", "medium": "audio"},
            ...30 most recent
          ],
          "by_medium": {
            "audio": { ...same shape... },
            "video": { ...same shape... }
          }
        },
        "documents": {
          "total": 26,
          ...,
          "by_type": {
            "communique":   { ... },
            ...
          }
        },
        "images": {
          "total": 30,
          ...,
          "similar_by_id": {
            "12345": [
              {"o_id": 23456, "title": "...", "score": 0.8123, ...},
              ...top 6 by cosine similarity
            ]
          }
        }
      }
    }

The front-end orchestrator (``minimal-item-dashboard.js``) takes the
container's ``data-subset`` + ``data-subtype-facet`` + ``data-subtype``
attributes and reads the matching slice. It prefers
``similar_by_id[<item o:id>]`` when the subset has one; otherwise
``top_items`` is filtered on the client to drop the current item and
show the rest as "more items in this collection" cards via the existing
``similar-items`` renderer (sans similarity score).

Slice keys are normalised to NFC + lowercased so the front-end can
look them up case-insensitively even when the source ``type`` field
mixes "Photographie" / "photographie" / "photo" — the generator
emits the canonical lowercase key alongside the original display
label.

Usage::

    python scripts/generate_template_summary.py
    python scripts/generate_template_summary.py --minify -v
"""
from __future__ import annotations

import argparse
import logging
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


def find_columns(df: pd.DataFrame) -> Dict[str, Optional[str]]:
    """Resolve column names defensively across subsets — some carry
    `creator` (audiovisual), others `author` (documents); some have
    `publisher` only on audiovisual; etc."""
    return {
        "id":        find_column(df, ["o:id", "id"]),
        "title":     find_column(df, ["title", "Titre", "dcterms:title"]),
        "date":      find_column(df, ["pub_date", "dcterms:date", "date"]),
        "country":   find_column(df, ["country", "countries"]),
        "creator":   find_column(df, ["creator", "author", "publisher"]),
        "publisher": find_column(df, ["publisher", "source", "newspaper"]),
        "language":  find_column(df, ["language", "dcterms:language"]),
        "thumbnail": find_column(df, ["thumbnail"]),
        "medium":    find_column(df, ["medium"]),
        "type":      find_column(df, ["type", "dcterms:type"]),
        "extent":    find_column(df, ["extent"]),
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
    for key in ("creator", "publisher", "medium", "type", "extent"):
        col = columns[key]
        if not col:
            continue
        value = clean_str(row.get(col))
        if value:
            item[key] = value
    return item


def slice_summary(df: pd.DataFrame, columns: Dict[str, Optional[str]]) -> Dict[str, Any]:
    """Compact summary of a single dataframe slice — total, year
    range, year histogram, top-N items (most-recent first)."""
    date_col = columns["date"]

    total = len(df)
    year_counter: Counter = Counter()
    items: List[Dict[str, Any]] = []

    for _, row in df.iterrows():
        date_raw = clean_str(row.get(date_col)) if date_col else ""
        year = extract_year(date_raw) if date_raw else None
        if year:
            year_counter[year] += 1

        item = build_item(row, columns)
        if item is not None:
            items.append(item)

    # Most-recent first by date string (ISO sorts lexically).
    items.sort(key=lambda i: i.get("date") or "", reverse=True)

    years_sorted = sorted(year_counter.items())
    return {
        "total":     total,
        "year_min":  years_sorted[0][0]  if years_sorted else None,
        "year_max":  years_sorted[-1][0] if years_sorted else None,
        "years":     [{"year": y, "count": c} for y, c in years_sorted],
        "top_items": items[:TOP_ITEMS],
    }


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

    out: Dict[str, Any] = {}
    for key, rows in groups.items():
        sub = df.loc[rows]
        summary = slice_summary(sub, columns)
        # Use the most-common raw label as the display form.
        label = raw_label_counters[key].most_common(1)[0][0]
        summary["label"] = label
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
    """Top-level summary + appropriate facet split per subset."""
    columns = find_columns(df)
    summary = slice_summary(df, columns)

    if subset_name == "audiovisual" and columns["medium"]:
        # audio | video — drives templates 9 and 19 respectively.
        summary["by_medium"] = split_by_facet(df, columns["medium"], columns)

    if subset_name == "documents" and columns["type"]:
        # Free-text. Photographs left this subset in 2026-07 (they are
        # class 58 with their own `images` subset now), so no partial
        # reads a `by_type` slice today — it stays for the granular
        # per-document-type splits the block can grow into. The keys
        # carried in the JSON are NFC-normalised lowercase forms of
        # whatever the source data contains.
        summary["by_type"] = split_by_facet(df, columns["type"], columns)

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
    total_records = 0

    for subset_name in SUBSETS:
        logger.info(f"Loading subset '{subset_name}'…")
        df = load_dataset_safe(subset_name, repo_id=args.repo)
        if df is None or df.empty:
            logger.warning(f"  {subset_name}: empty subset, skipping")
            continue

        summary = build_subset_summary(subset_name, df)
        subsets_out[subset_name] = summary
        total_records += summary.get("total", 0)
        logger.info(
            "  %s: %d items (%s–%s)",
            subset_name,
            summary["total"],
            summary.get("year_min") or "?",
            summary.get("year_max") or "?",
        )
        if "by_medium" in summary:
            for k, v in summary["by_medium"].items():
                logger.info(f"    medium='{k}' ({v.get('label','?')}): {v['total']} items")
        if "by_type" in summary:
            for k, v in summary["by_type"].items():
                logger.info(f"    type='{k}' ({v.get('label','?')}): {v['total']} items")
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
    )
    bundle["subsets"] = subsets_out

    save_json(bundle, args.output, minify=args.minify)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
