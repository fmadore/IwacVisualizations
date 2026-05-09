#!/usr/bin/env python3
"""
generate_template_summary.py
============================

Light-weight precompute for the per-item "minimal" Visualizations
block (drives Audio / Video / Photograph resource pages, dispatched
through ``Visualizations::TEMPLATE_PARTIALS``).

The audiovisual subset (45 items) splits cleanly by ``medium`` into
audio (template 9) and video (template 19). The documents subset (26
items) is heterogeneous — official letters, communiqués, sermons,
photographs, posters, etc. — and uses free-text ``type`` as the
discriminator. Photograph (template 15) reads from
``documents.by_type[<photograph slug>]``.

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
            "photographie": { ... },
            "communique":   { ... },
            ...
          }
        }
      }
    }

The front-end orchestrator (``minimal-item-dashboard.js``) takes the
container's ``data-subset`` + ``data-subtype-facet`` + ``data-subtype``
attributes and reads the matching slice. ``top_items`` is filtered on
the client to drop the current item and show the rest as
"more items in this collection" cards via the existing
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
# corpus level. The audiovisual + documents subsets are the
# under-covered ones — small, heterogeneous, worth surfacing as
# "context" panels on per-item Visualizations blocks.
SUBSETS = ["audiovisual", "documents"]

# Top-N items kept per slice. The minimal-item orchestrator picks ~6
# to show as "other items in this collection" cards; 30 leaves
# headroom for client-side filtering (e.g. dropping the current
# item, prioritising same-country neighbours).
TOP_ITEMS = 30


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


def slice_summary(df: pd.DataFrame, columns: Dict[str, Optional[str]]) -> Dict[str, Any]:
    """Compact summary of a single dataframe slice — total, year
    range, year histogram, top-N items (most-recent first)."""
    id_col        = columns["id"]
    title_col     = columns["title"]
    date_col      = columns["date"]
    country_col   = columns["country"]
    creator_col   = columns["creator"]
    publisher_col = columns["publisher"]
    language_col  = columns["language"]
    thumb_col     = columns["thumbnail"]
    medium_col    = columns["medium"]
    type_col      = columns["type"]
    extent_col    = columns["extent"]

    total = len(df)
    year_counter: Counter = Counter()
    items: List[Dict[str, Any]] = []

    for _, row in df.iterrows():
        date_raw = clean_str(row.get(date_col)) if date_col else ""
        year = extract_year(date_raw) if date_raw else None
        if year:
            year_counter[year] += 1

        if not id_col:
            continue
        try:
            o_id = int(row.get(id_col))
        except (TypeError, ValueError):
            continue

        item: Dict[str, Any] = {
            "o_id":      o_id,
            "title":     clean_str(row.get(title_col)) if title_col else "",
            "date":      date_raw[:10] if date_raw else "",
            "country":   first_country(row.get(country_col)) if country_col else "",
            "language":  clean_str(row.get(language_col)) if language_col else "",
            "thumbnail": clean_str(row.get(thumb_col)) if thumb_col else "",
        }
        # Optional fields — kept only when present so the JSON stays
        # narrow per-item and the client doesn't have to filter empty
        # strings out of the meta line.
        if creator_col:
            creator = clean_str(row.get(creator_col))
            if creator:
                item["creator"] = creator
        if publisher_col:
            publisher = clean_str(row.get(publisher_col))
            if publisher:
                item["publisher"] = publisher
        if medium_col:
            medium = clean_str(row.get(medium_col))
            if medium:
                item["medium"] = medium
        if type_col:
            t = clean_str(row.get(type_col))
            if t:
                item["type"] = t
        if extent_col:
            ext = clean_str(row.get(extent_col))
            if ext:
                item["extent"] = ext

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
        # Free-text — drives template 15 (Photograph) plus any future
        # per-document-type partials. The keys carried in the JSON are
        # NFC-normalised lowercase forms of whatever the source data
        # contains.
        summary["by_type"] = split_by_facet(df, columns["type"], columns)

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
    parser.add_argument("--minify", action="store_true",
                        help="Strip whitespace from output JSON")
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
