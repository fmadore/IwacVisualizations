#!/usr/bin/env python3
"""
generate_world_map.py
======================

Generate ``asset/data/collection-map.json`` — unified sidecar with place
markers (lat/lng from index subset where Type == 'Lieux') plus per-country
totals faceted by item type.

Usage
-----
    python3 scripts/generate_world_map.py
"""
from __future__ import annotations

import argparse
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    load_dataset_safe,
    parse_pipe_separated,
    save_json,
)

COORD_RE = re.compile(r"(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)")


def parse_coordinates(raw: Any) -> Optional[Tuple[float, float]]:
    """Parse a "lat,lng" or "lat lng" string into (lat, lng). Returns
    None if the value is missing or malformed."""
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    if isinstance(raw, (tuple, list)) and len(raw) == 2:
        try:
            return float(raw[0]), float(raw[1])
        except (TypeError, ValueError):
            return None
    s = str(raw).strip()
    if not s:
        return None
    m = COORD_RE.search(s)
    if not m:
        return None
    try:
        lat = float(m.group(1))
        lng = float(m.group(2))
    except ValueError:
        return None
    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return None
    return lat, lng


def build_map(repo_id: str) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)

    # Locations from the index subset, filtered to Type == "Lieux"
    index_df = load_dataset_safe("index", repo_id=repo_id)
    locations: List[Dict[str, Any]] = []
    if index_df is not None and not index_df.empty and "Type" in index_df.columns:
        lieux = index_df[index_df["Type"] == "Lieux"]
        for idx in range(len(lieux)):
            title = str(lieux["Titre"].iat[idx] or "").strip() if "Titre" in lieux.columns else ""
            if not title:
                continue
            coord_raw = None
            if "Coordonn\u00e9es" in lieux.columns:
                coord_raw = lieux["Coordonn\u00e9es"].iat[idx]
            elif "Coordonnees" in lieux.columns:
                coord_raw = lieux["Coordonnees"].iat[idx]
            coords = parse_coordinates(coord_raw)
            if coords is None:
                continue
            count_raw = lieux["frequency"].iat[idx] if "frequency" in lieux.columns else 0
            try:
                count = int(float(count_raw)) if count_raw is not None else 0
            except (TypeError, ValueError):
                count = 0
            if count <= 0:
                continue
            countries_list = parse_pipe_separated(
                lieux["countries"].iat[idx] if "countries" in lieux.columns else ""
            )
            country = countries_list[0] if countries_list else None
            locations.append({
                "name": title,
                "country": country,
                "lat": coords[0],
                "lng": coords[1],
                "count": count,
            })

    # Country totals from content subsets, broken down by type
    subset_to_type = {
        "articles":     "article",
        "publications": "publication",
        "documents":    "document",
        "audiovisual":  "audiovisual",
        "references":   "reference",
    }
    country_totals: Dict[str, Counter] = defaultdict(Counter)
    for subset, type_key in subset_to_type.items():
        df = load_dataset_safe(subset, repo_id=repo_id)
        if df is None or df.empty or "country" not in df.columns:
            continue
        for value in df["country"]:
            for country in parse_pipe_separated(value):
                country = country.strip()
                if country and country.lower() != "unknown":
                    country_totals[country][type_key] += 1
                    country_totals[country]["total"] += 1

    country_counts = {
        country: {
            "total": int(counter["total"]),
            "by_type": {k: int(v) for k, v in counter.items() if k != "total"},
        }
        for country, counter in sorted(country_totals.items())
    }

    logger.info("Built map with %d locations across %d countries",
                len(locations), len(country_counts))

    return {
        "locations": locations,
        "country_counts": country_counts,
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": "index subset where Type == 'Lieux', filtered to valid coordinates",
            "total_locations": len(locations),
            "total_countries": len(country_counts),
        },
    }


def main() -> None:
    configure_logging()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DATASET_ID)
    parser.add_argument("--output", default="asset/data/collection-map.json")
    args = parser.parse_args()

    result = build_map(repo_id=args.repo)
    save_json(result, Path(args.output), minify=False)
    logging.getLogger(__name__).info("Wrote %s", args.output)


if __name__ == "__main__":
    main()
