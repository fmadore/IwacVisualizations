#!/usr/bin/env python3
"""
generate_index_overview.py
==========================

Generate ``asset/data/index-overview.json`` for the IwacVisualizations
module's Index Overview page block.

The block explores the IWAC authority index — the ~4,700 entities of
type Personnes / Lieux / Organisations / Sujets / Événements — and the
output JSON bundles everything the JS orchestrator needs so the block
only fetches a single file for Section A (entity overview).

Section B (the keyword explorer for Dublin Core Subject + Spatial
Coverage prevalence over time) is produced by a separate script,
``generate_keyword_explorer.py``, so both halves stay independently
regenerable.

Payload shape (top-level keys):

    metadata              — standard provenance block
    summary               — counts + time span + coverage stats
    top_entities          — top N per type (C.entities-ready)
    lifespan              — frequency × span scatter (per type)
    gender                — persons gender histogram
    places                — [{o_id, title, lat, lng, frequency, country}, ...]
    place_mentions        — [{name, lat, lng, count}, ...]  (from dct:spatial on content items)
    activity              — per-type gantt rows (top 30 each)
    recent_additions      — newest authority records
    index_table           — slim list of ALL entities for the searchable table

Usage
-----
    python scripts/generate_index_overview.py
    python scripts/generate_index_overview.py --output asset/data/index-overview.json
    python scripts/generate_index_overview.py --top-n 50 --gantt-n 30

Environment
-----------
    HF_TOKEN   Optional Hugging Face access token (public dataset).
"""
from __future__ import annotations

import argparse
import logging
import os
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
    normalize_location_name,
    parse_coordinates,
    parse_pipe_separated,
    save_json,
)

# Entity types in the ``index`` subset, keyed by the French label used
# in the dataset. Order controls tab order in the block.
INDEX_TYPES = [
    "Personnes",
    "Lieux",
    "Organisations",
    "Sujets",
    "\u00c9v\u00e9nements",  # Événements
]

# Subsets that carry content items with dct:spatial mentions. Used to
# build the "real" place-mentions bubble layer on the map, alongside
# authority pins from the index.
CONTENT_SUBSETS = ["articles", "publications", "documents", "audiovisual", "references"]


def _int_or_none(value: Any) -> Optional[int]:
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _str_or_none(value: Any) -> Optional[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    return s or None


def _entity_type_label(raw: Any) -> Optional[str]:
    """Return the canonical INDEX_TYPES label for a row's Type value, or
    None if the row is not one of the five explorer types (e.g. it's a
    ``Notices d'autorité`` row, which we intentionally skip)."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s in INDEX_TYPES:
        return s
    # Defensive: some rows may have trailing whitespace, diacritics NFC vs NFD
    nfc = unicodedata.normalize("NFC", s)
    if nfc in INDEX_TYPES:
        return nfc
    return None


def compute_summary(
    index_df: pd.DataFrame,
    places_count: int,
    place_mentions_count: int,
) -> Dict[str, Any]:
    """Top-level counters rendered as summary cards.

    ``total_entities`` counts only rows whose Type is one of the five
    explorer types (Personnes / Lieux / Organisations / Sujets /
    Événements). Rows with Type = "Notices d'autorité" or missing
    title are excluded to keep the summary card consistent with the
    by_type breakdown and the index_table row count.
    """
    by_type: Dict[str, int] = {t: 0 for t in INDEX_TYPES}
    year_min = None
    year_max = None
    mentions = 0
    with_dates = 0

    for _, row in index_df.iterrows():
        t = _entity_type_label(row.get("Type"))
        if t is None:
            continue
        by_type[t] += 1
        freq = pd.to_numeric(row.get("frequency"), errors="coerce")
        if pd.notna(freq) and freq > 0:
            mentions += int(freq)
        first_s = _str_or_none(row.get("first_occurrence"))
        last_s = _str_or_none(row.get("last_occurrence"))
        first_y = extract_year(first_s) if first_s else None
        last_y = extract_year(last_s) if last_s else None
        if first_y is not None:
            year_min = first_y if year_min is None else min(year_min, first_y)
            with_dates += 1
        if last_y is not None:
            year_max = last_y if year_max is None else max(year_max, last_y)

    return {
        "total_entities": sum(by_type.values()),
        "by_type": by_type,
        "total_mentions": mentions,
        "year_min": year_min,
        "year_max": year_max,
        "with_coordinates": places_count,
        "with_mentioned_places": place_mentions_count,
        "with_dates": with_dates,
    }


def compute_top_entities(
    index_df: pd.DataFrame,
    top_n: int,
) -> Dict[str, List[Dict[str, Any]]]:
    """Top N entities per type, sorted by frequency desc."""
    result: Dict[str, List[Dict[str, Any]]] = {t: [] for t in INDEX_TYPES}
    if index_df.empty:
        return result

    for entity_type in INDEX_TYPES:
        subset = index_df[index_df["Type"].apply(_entity_type_label) == entity_type].copy()
        if subset.empty:
            continue
        subset["_freq"] = pd.to_numeric(subset["frequency"], errors="coerce").fillna(0)
        subset = subset[subset["_freq"] > 0]
        subset = subset.sort_values("_freq", ascending=False).head(top_n)

        entries: List[Dict[str, Any]] = []
        for _, row in subset.iterrows():
            title = _str_or_none(row.get("Titre"))
            if not title:
                continue
            entry: Dict[str, Any] = {
                "o_id": _int_or_none(row.get("o:id")),
                "title": title,
                "frequency": int(row.get("_freq") or 0),
            }
            countries = parse_pipe_separated(row.get("countries"))
            if countries:
                entry["countries"] = countries
            first = _str_or_none(row.get("first_occurrence"))
            last = _str_or_none(row.get("last_occurrence"))
            if first:
                entry["first_occurrence"] = first
            if last:
                entry["last_occurrence"] = last
            thumb = _str_or_none(row.get("thumbnail"))
            if thumb:
                entry["thumbnail"] = thumb
            entries.append(entry)
        result[entity_type] = entries
    return result


def compute_lifespan(
    index_df: pd.DataFrame,
    top_n: int,
) -> Dict[str, List[Dict[str, Any]]]:
    """Per-type scatter rows for "frequency × temporal span" plot.

    Each entry carries first_year, last_year, span_years (last - first),
    and frequency, so the chart can encode span on x, frequency on y,
    and color by type.
    """
    result: Dict[str, List[Dict[str, Any]]] = {t: [] for t in INDEX_TYPES}
    if index_df.empty:
        return result

    for entity_type in INDEX_TYPES:
        subset = index_df[index_df["Type"].apply(_entity_type_label) == entity_type].copy()
        if subset.empty:
            continue

        rows: List[Dict[str, Any]] = []
        for _, row in subset.iterrows():
            freq = pd.to_numeric(row.get("frequency"), errors="coerce")
            if not pd.notna(freq) or freq <= 0:
                continue
            first_y = extract_year(_str_or_none(row.get("first_occurrence")))
            last_y = extract_year(_str_or_none(row.get("last_occurrence")))
            if first_y is None or last_y is None:
                continue
            title = _str_or_none(row.get("Titre"))
            if not title:
                continue
            rows.append({
                "o_id": _int_or_none(row.get("o:id")),
                "title": title,
                "frequency": int(freq),
                "first_year": int(first_y),
                "last_year": int(last_y),
                "span_years": int(last_y) - int(first_y),
            })
        # Keep top by frequency to bound chart size
        rows.sort(key=lambda r: -r["frequency"])
        result[entity_type] = rows[:top_n]
    return result


def compute_gender(index_df: pd.DataFrame) -> Dict[str, int]:
    """Gender breakdown over ``Personnes`` rows.

    The dataset uses ``Genre`` with values like "M", "F", "Masculin",
    "F\u00e9minin". Everything else goes into "Unknown".
    """
    persons = index_df[index_df["Type"].apply(_entity_type_label) == "Personnes"]
    if persons.empty or "Genre" not in persons.columns:
        return {}
    counts: Counter = Counter()
    for raw in persons["Genre"]:
        s = _str_or_none(raw)
        if not s:
            counts["Unknown"] += 1
            continue
        lo = s.lower()
        if lo in ("m", "masculin", "male", "homme", "h"):
            counts["M"] += 1
        elif lo in ("f", "f\u00e9minin", "feminin", "female", "femme"):
            counts["F"] += 1
        else:
            counts["Unknown"] += 1
    return {k: int(v) for k, v in counts.items()}


def compute_places(
    index_df: pd.DataFrame,
) -> List[Dict[str, Any]]:
    """Extract places (Lieux) with parseable coordinates from ``Coordonnées``."""
    places = index_df[index_df["Type"].apply(_entity_type_label) == "Lieux"]
    if places.empty:
        return []
    rows: List[Dict[str, Any]] = []
    coord_col = None
    for candidate in ("Coordonn\u00e9es", "Coordonnees", "coordinates", "lat_lng"):
        if candidate in places.columns:
            coord_col = candidate
            break
    if coord_col is None:
        return []
    for _, row in places.iterrows():
        coord = parse_coordinates(row.get(coord_col))
        if coord is None:
            continue
        lat, lng = coord
        title = _str_or_none(row.get("Titre"))
        if not title:
            continue
        freq_val = pd.to_numeric(row.get("frequency"), errors="coerce")
        entry: Dict[str, Any] = {
            "o_id": _int_or_none(row.get("o:id")),
            "title": title,
            "lat": lat,
            "lng": lng,
            "frequency": int(freq_val) if pd.notna(freq_val) else 0,
        }
        # Deliberately no `country` field: the `countries` column on a
        # Lieu authority lists the IWAC newspaper countries that mention
        # it, not where the place is located. Picking countries[0] made
        # every popup read "Bénin" because Beninese papers are the most
        # numerous source. The popup builder shows place name + mention
        # count instead.
        rows.append(entry)
    # Sort by frequency desc so the map builds largest-on-top
    rows.sort(key=lambda r: -r["frequency"])
    return rows


def compute_place_mentions(
    dataframes: Dict[str, pd.DataFrame],
    places: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Aggregate dct:spatial mentions across content subsets and
    resolve each mention back to a place in ``places`` by normalized
    title. Mentions that don't resolve to a known place authority are
    dropped (no coordinates available for them).

    Returns a sorted list of ``{ name, lat, lng, count }`` entries,
    usable as the per-mention bubble layer on the map.
    """
    if not places:
        return []

    # Build a lookup from normalized title → (lat, lng, canonical title)
    lookup: Dict[str, Tuple[float, float, str]] = {}
    for p in places:
        key = normalize_location_name(p["title"])
        if key and key not in lookup:
            lookup[key] = (p["lat"], p["lng"], p["title"])

    counts: Counter = Counter()
    for subset in CONTENT_SUBSETS:
        df = dataframes.get(subset)
        if df is None or df.empty or "spatial" not in df.columns:
            continue
        for raw in df["spatial"]:
            for name in parse_pipe_separated(raw):
                key = normalize_location_name(name)
                if key and key in lookup:
                    counts[key] += 1

    rows: List[Dict[str, Any]] = []
    for key, n in counts.most_common():
        lat, lng, title = lookup[key]
        rows.append({
            "name": title,
            "lat": lat,
            "lng": lng,
            "count": int(n),
        })
    return rows


def compute_activity(
    index_df: pd.DataFrame,
    top_n: int,
) -> Dict[str, List[Dict[str, Any]]]:
    """Gantt rows per type: one entry per entity with a first/last
    occurrence and frequency, top ``top_n`` by frequency.
    """
    result: Dict[str, List[Dict[str, Any]]] = {t: [] for t in INDEX_TYPES}
    if index_df.empty:
        return result

    for entity_type in INDEX_TYPES:
        subset = index_df[index_df["Type"].apply(_entity_type_label) == entity_type].copy()
        if subset.empty:
            continue

        rows: List[Dict[str, Any]] = []
        for _, row in subset.iterrows():
            freq = pd.to_numeric(row.get("frequency"), errors="coerce")
            if not pd.notna(freq) or freq <= 0:
                continue
            first_y = extract_year(_str_or_none(row.get("first_occurrence")))
            last_y = extract_year(_str_or_none(row.get("last_occurrence")))
            if first_y is None or last_y is None:
                continue
            title = _str_or_none(row.get("Titre"))
            if not title:
                continue
            countries = parse_pipe_separated(row.get("countries"))
            rows.append({
                "o_id": _int_or_none(row.get("o:id")),
                "name": title,
                "country": countries[0] if countries else None,
                "type": entity_type,
                "year_min": int(first_y),
                "year_max": int(last_y),
                "total": int(freq),
            })

        rows.sort(key=lambda r: -r["total"])
        result[entity_type] = rows[:top_n]
    return result


def compute_recent_additions(
    index_df: pd.DataFrame,
    limit: int,
) -> List[Dict[str, Any]]:
    """Newest authority records by ``added_date``."""
    if index_df.empty or "added_date" not in index_df.columns:
        return []
    rows: List[Dict[str, Any]] = []
    for _, row in index_df.iterrows():
        added = _str_or_none(row.get("added_date"))
        if not added:
            continue
        etype = _entity_type_label(row.get("Type"))
        if etype is None:
            continue
        title = _str_or_none(row.get("Titre"))
        if not title:
            continue
        rows.append({
            "o_id": _int_or_none(row.get("o:id")),
            "title": title,
            "type": etype,
            "added_date": added[:10],
            "thumbnail": _str_or_none(row.get("thumbnail")),
        })
    rows.sort(key=lambda r: (r["added_date"], r.get("o_id") or 0), reverse=True)
    return rows[:limit]


def compute_index_table(index_df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Slim row per entity for the searchable/sortable/paginated table.

    Dropping aliases + descriptions + graph edges keeps the payload
    around a few hundred KB, which comfortably fits into one
    ``index-overview.json`` file.
    """
    if index_df.empty:
        return []
    rows: List[Dict[str, Any]] = []
    for _, row in index_df.iterrows():
        etype = _entity_type_label(row.get("Type"))
        if etype is None:
            continue
        title = _str_or_none(row.get("Titre"))
        if not title:
            continue
        freq = pd.to_numeric(row.get("frequency"), errors="coerce")
        countries = parse_pipe_separated(row.get("countries"))
        first_y = extract_year(_str_or_none(row.get("first_occurrence")))
        last_y = extract_year(_str_or_none(row.get("last_occurrence")))
        rows.append({
            "o_id": _int_or_none(row.get("o:id")),
            "title": title,
            "type": etype,
            "frequency": int(freq) if pd.notna(freq) else 0,
            "first": int(first_y) if first_y is not None else None,
            "last": int(last_y) if last_y is not None else None,
            "countries": countries if countries else [],
        })
    rows.sort(key=lambda r: (-r["frequency"], r["title"]))
    return rows


def build_index_overview(
    repo_id: str,
    token: Optional[str],
    top_n: int,
    lifespan_n: int,
    gantt_n: int,
    recent_n: int,
) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Loading IWAC index subset from %s", repo_id)

    index_df = load_dataset_safe("index", repo_id=repo_id, token=token)
    if index_df is None or index_df.empty:
        raise RuntimeError("Failed to load index subset — aborting")

    # Normalize country columns once
    if "country" in index_df.columns:
        index_df["country"] = index_df["country"].apply(canonicalize_country_field)
    if "countries" in index_df.columns:
        index_df["countries"] = index_df["countries"].apply(canonicalize_country_field)

    # Only need content subsets for the place-mentions layer
    dataframes: Dict[str, pd.DataFrame] = {"index": index_df}
    logger.info("Loading content subsets for dct:spatial mention counts")
    for subset in CONTENT_SUBSETS:
        df = load_dataset_safe(subset, repo_id=repo_id, token=token)
        if df is not None:
            dataframes[subset] = df

    logger.info("Computing top entities (top %d per type)", top_n)
    top_entities = compute_top_entities(index_df, top_n=top_n)

    logger.info("Computing lifespan scatter (top %d per type)", lifespan_n)
    lifespan = compute_lifespan(index_df, top_n=lifespan_n)

    logger.info("Computing gender breakdown")
    gender = compute_gender(index_df)

    logger.info("Extracting place coordinates")
    places = compute_places(index_df)
    logger.info("  %d places with coordinates", len(places))

    logger.info("Aggregating dct:spatial mentions against place authority")
    place_mentions = compute_place_mentions(dataframes, places)
    logger.info("  %d places resolved to mentions", len(place_mentions))

    logger.info("Computing activity gantt (top %d per type)", gantt_n)
    activity = compute_activity(index_df, top_n=gantt_n)

    logger.info("Computing recent additions (top %d)", recent_n)
    recent_additions = compute_recent_additions(index_df, limit=recent_n)

    logger.info("Building slim index table")
    index_table = compute_index_table(index_df)
    logger.info("  %d index rows", len(index_table))

    summary = compute_summary(
        index_df,
        places_count=len(places),
        place_mentions_count=len(place_mentions),
    )

    metadata = create_metadata_block(
        total_records=summary["total_entities"],
        data_source=repo_id,
        script="generate_index_overview.py",
        script_version="0.1.0",
        top_n=top_n,
    )

    return {
        "metadata": metadata,
        "summary": summary,
        "top_entities": top_entities,
        "lifespan": lifespan,
        "gender": gender,
        "places": places,
        "place_mentions": place_mentions,
        "activity": activity,
        "recent_additions": recent_additions,
        "index_table": index_table,
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
        default="asset/data/index-overview.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument(
        "--top-n", type=int, default=50,
        help="Top-N cutoff for per-type entity bars (default: 50)",
    )
    parser.add_argument(
        "--lifespan-n", type=int, default=120,
        help="Max scatter points per type (default: 120)",
    )
    parser.add_argument(
        "--gantt-n", type=int, default=30,
        help="Gantt rows per type (default: 30)",
    )
    parser.add_argument(
        "--recent-n", type=int, default=20,
        help="Recent additions to include (default: 20)",
    )
    parser.add_argument(
        "--minify", action=argparse.BooleanOptionalAction, default=False,
        help="Produce compact JSON (no indentation) (default: %(default)s)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    logger = logging.getLogger(__name__)

    token = os.getenv("HF_TOKEN") or None
    if token is None:
        logger.info("No HF_TOKEN set; using anonymous access (public dataset).")

    payload = build_index_overview(
        repo_id=args.repo,
        token=token,
        top_n=args.top_n,
        lifespan_n=args.lifespan_n,
        gantt_n=args.gantt_n,
        recent_n=args.recent_n,
    )

    output_path = Path(args.output)
    if not output_path.is_absolute():
        module_root = Path(__file__).resolve().parent.parent
        output_path = module_root / output_path

    save_json(payload, output_path, minify=args.minify)
    logger.info("Index overview written to %s", output_path)


if __name__ == "__main__":
    main()
