#!/usr/bin/env python3
"""
generate_spatial_exploration.py
================================

Generate ``asset/data/spatial-exploration.json`` — the single sidecar
behind the "Spatial Exploration" page block:

    * ``locations`` — every geocoded index Lieu (o:id, name, lat, lng,
      mention frequency, focus-country index) as compact arrays. The
      focus country is resolved by walking the ``Partie de`` chain in
      the index up to one of the six IWAC countries, so the block can
      filter bubbles when the user zooms into a country.
    * ``pickers`` — per entity type (Personnes, Organisations,
      Événements, Sujets, Lieux) the full list of index entities with
      at least one mention, as ``[o:id, label, frequency]`` rows. The
      block's entity picker searches these client-side; selecting one
      fetches the existing ``person-dashboards/{id}.json`` /
      ``entity-dashboards/{id}.json`` fan-out for its locations +
      per-location article lists (no data duplication here).
    * ``country_counts`` — items per canonical country across all five
      content subsets, for the choropleth fill in collection mode.
    * ``country_bounds`` — [w, s, e, n] per IWAC country, read from the
      committed ``asset/data/iwac-countries.geojson``, for the
      country-focus zoom control.
    * ``country_focus`` — administrative choropleth metadata for Bénin,
      Burkina Faso, Côte d'Ivoire and Togo. Counts are derived from the
      same geocoded ``locations`` rows, while the polygons remain in
      separate lazy-loaded GeoJSON files.

Usage
-----
    python scripts/generate_spatial_exploration.py
    python scripts/generate_spatial_exploration.py --no-minify -v
"""
from __future__ import annotations

import argparse
import json
import logging
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from iwac_utils import (
    DATASET_ID,
    canonical_country,
    configure_logging,
    create_metadata_block,
    find_column,
    load_dataset_safe,
    normalize_location_name,
    parse_coordinates,
    parse_pipe_separated,
    save_json,
)

logger = logging.getLogger(__name__)

# Picker order mirrors the index Type vocabulary; "Notices d'autorité"
# is excluded (meta-records, not explorable entities).
ENTITY_TYPES = ["Personnes", "Organisations", "Événements", "Sujets", "Lieux"]

# The six countries covered by iwac-countries.geojson — same canonical
# spellings the choropleth helper keys on.
FOCUS_COUNTRIES = ["Bénin", "Burkina Faso", "Côte d'Ivoire", "Niger", "Nigeria", "Togo"]

# All content subsets contribute to the per-country item counts.
CONTENT_SUBSETS = ["articles", "publications", "documents", "audiovisual", "references"]

# Administrative boundaries ported from IWAC-spatial-overview. Côte
# d'Ivoire has no prefecture file in the retained dashboard contract.
COUNTRY_FOCUS_ADMIN = {
    "Bénin": {"slug": "benin", "levels": ["regions", "prefectures"]},
    "Burkina Faso": {"slug": "burkina_faso", "levels": ["regions", "prefectures"]},
    "Côte d'Ivoire": {"slug": "cote_divoire", "levels": ["regions"]},
    "Togo": {"slug": "togo", "levels": ["regions", "prefectures"]},
}

# ``Partie de`` chains are shallow (place → region → country) but guard
# against cycles / malformed data anyway.
MAX_PARTIE_DE_DEPTH = 6


def _safe_int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def resolve_focus_country(
    title: str,
    partie_de_by_key: Dict[str, str],
    focus_set: Dict[str, str],
) -> Optional[str]:
    """Walk the ``Partie de`` chain until a focus country is reached.

    ``partie_de_by_key`` maps a normalized index title to that entry's
    raw ``Partie de`` value; ``focus_set`` maps normalized country
    names to their canonical spelling. The location's own title counts
    too (the six countries are themselves Lieux entries).
    """
    seen = set()
    current = title
    for _ in range(MAX_PARTIE_DE_DEPTH):
        key = normalize_location_name(current)
        if not key or key in seen:
            return None
        seen.add(key)
        canon = focus_set.get(normalize_location_name(canonical_country(current)))
        if canon:
            return canon
        parents = parse_pipe_separated(partie_de_by_key.get(key, ""))
        if not parents:
            return None
        current = parents[0]
    return None


def build_locations_and_pickers(index_df) -> Dict[str, Any]:
    id_col = find_column(index_df, ["o:id", "id"], required=True)
    title_col = find_column(index_df, ["Titre", "dcterms:title"], required=True)
    type_col = find_column(index_df, ["Type"], required=True)
    coord_col = find_column(index_df, ["Coordonnées", "Coordonnees"])
    freq_col = find_column(index_df, ["frequency"])
    partie_col = find_column(index_df, ["Partie de"])

    focus_set = {normalize_location_name(c): c for c in FOCUS_COUNTRIES}
    partie_de_by_key: Dict[str, str] = {}
    if partie_col:
        for _, row in index_df.iterrows():
            title = str(row.get(title_col) or "").strip()
            if not title:
                continue
            partie_de_by_key.setdefault(
                normalize_location_name(title), str(row.get(partie_col) or "")
            )

    pickers: Dict[str, List[List[Any]]] = {t: [] for t in ENTITY_TYPES}
    locations: List[List[Any]] = []
    geocoded = 0

    for _, row in index_df.iterrows():
        o_id = _safe_int(row.get(id_col))
        if o_id <= 0:
            continue
        entity_type = str(row.get(type_col) or "").strip()
        if entity_type not in pickers:
            continue
        title = str(row.get(title_col) or "").strip()
        if not title:
            continue
        freq = _safe_int(row.get(freq_col)) if freq_col else 0
        if freq > 0:
            pickers[entity_type].append([o_id, title, freq])

        if entity_type == "Lieux" and coord_col is not None:
            coords = parse_coordinates(row.get(coord_col))
            if coords is None or freq <= 0:
                continue
            geocoded += 1
            country = resolve_focus_country(title, partie_de_by_key, focus_set)
            locations.append([
                o_id,
                title,
                round(coords[0], 5),
                round(coords[1], 5),
                freq,
                FOCUS_COUNTRIES.index(country) if country else -1,
            ])

    for entries in pickers.values():
        entries.sort(key=lambda e: (-e[2], e[1]))
    locations.sort(key=lambda e: -e[4])

    in_focus = sum(1 for loc in locations if loc[5] >= 0)
    logger.info(
        "Locations: %d geocoded (%d resolved to a focus country); pickers: %s",
        geocoded, in_focus,
        ", ".join(f"{t}={len(pickers[t])}" for t in ENTITY_TYPES),
    )
    return {"locations": locations, "pickers": pickers}


def build_country_counts(repo_id: str) -> Dict[str, int]:
    """Items per canonical country across every content subset."""
    totals: Counter = Counter()
    for subset in CONTENT_SUBSETS:
        df = load_dataset_safe(subset, repo_id=repo_id)
        if df is None or df.empty or "country" not in df.columns:
            continue
        for value in df["country"]:
            for raw in parse_pipe_separated(value):
                name = raw.strip()
                if not name or name.lower() == "unknown":
                    continue
                totals[canonical_country(name)] += 1
    return {country: int(count) for country, count in sorted(totals.items())}


def build_country_bounds(geojson_path: Path) -> Dict[str, List[float]]:
    """[w, s, e, n] per focus country from the committed 6-country GeoJSON."""
    if not geojson_path.is_file():
        logger.warning("GeoJSON not found at %s — country bounds omitted", geojson_path)
        return {}
    with geojson_path.open(encoding="utf-8") as f:
        geo = json.load(f)

    bounds: Dict[str, List[float]] = {}
    for feature in geo.get("features", []):
        name = (feature.get("properties") or {}).get("name")
        if name not in FOCUS_COUNTRIES:
            continue
        w, s, e, n = 180.0, 90.0, -180.0, -90.0
        geom = feature.get("geometry") or {}
        polys = geom.get("coordinates") or []
        if geom.get("type") == "Polygon":
            polys = [polys]
        for poly in polys:
            for ring in poly:
                for lng, lat in ring:
                    w, e = min(w, lng), max(e, lng)
                    s, n = min(s, lat), max(n, lat)
        bounds[name] = [round(w, 3), round(s, 3), round(e, 3), round(n, 3)]
    return bounds


def _iter_points(coords: Any) -> Iterable[Tuple[float, float]]:
    """Yield ``(lng, lat)`` pairs from a nested GeoJSON coordinate array."""
    if not isinstance(coords, list) or not coords:
        return
    first = coords[0]
    if isinstance(first, (int, float)) and len(coords) >= 2:
        yield float(coords[0]), float(coords[1])
        return
    for child in coords:
        yield from _iter_points(child)


def _feature_bounds(feature: Dict[str, Any]) -> Optional[List[float]]:
    points = list(_iter_points((feature.get("geometry") or {}).get("coordinates")))
    if not points:
        return None
    lngs = [p[0] for p in points]
    lats = [p[1] for p in points]
    return [min(lngs), min(lats), max(lngs), max(lats)]


def _combine_bounds(bounds: Iterable[Optional[List[float]]]) -> Optional[List[float]]:
    valid = [b for b in bounds if b]
    if not valid:
        return None
    return [
        round(min(b[0] for b in valid), 4),
        round(min(b[1] for b in valid), 4),
        round(max(b[2] for b in valid), 4),
        round(max(b[3] for b in valid), 4),
    ]


def _point_on_segment(
    lng: float,
    lat: float,
    lng1: float,
    lat1: float,
    lng2: float,
    lat2: float,
    eps: float = 1e-9,
) -> bool:
    cross = (lat - lat1) * (lng2 - lng1) - (lng - lng1) * (lat2 - lat1)
    if abs(cross) > eps:
        return False
    dot = (lng - lng1) * (lng2 - lng1) + (lat - lat1) * (lat2 - lat1)
    if dot < -eps:
        return False
    squared = (lng2 - lng1) ** 2 + (lat2 - lat1) ** 2
    return dot <= squared + eps


def _point_in_ring(lng: float, lat: float, ring: List[List[float]]) -> bool:
    inside = False
    if not ring:
        return False
    j = len(ring) - 1
    for i, point in enumerate(ring):
        lng_i, lat_i = float(point[0]), float(point[1])
        lng_j, lat_j = float(ring[j][0]), float(ring[j][1])
        if _point_on_segment(lng, lat, lng_i, lat_i, lng_j, lat_j):
            return True
        intersects = ((lat_i > lat) != (lat_j > lat)) and (
            lng < (lng_j - lng_i) * (lat - lat_i) / ((lat_j - lat_i) or 1e-12) + lng_i
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _point_in_polygon(lng: float, lat: float, polygon: List[Any]) -> bool:
    if not polygon or not _point_in_ring(lng, lat, polygon[0]):
        return False
    # Holes exclude the point.
    return not any(_point_in_ring(lng, lat, hole) for hole in polygon[1:])


def _feature_contains_point(feature: Dict[str, Any], lng: float, lat: float) -> bool:
    bounds = feature.get("_bounds")
    if bounds and not (bounds[0] <= lng <= bounds[2] and bounds[1] <= lat <= bounds[3]):
        return False
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []
    if geom.get("type") == "Polygon":
        return _point_in_polygon(lng, lat, coords)
    if geom.get("type") == "MultiPolygon":
        return any(_point_in_polygon(lng, lat, polygon) for polygon in coords)
    return False


def _load_admin_features(path: Path) -> List[Dict[str, Any]]:
    with path.open(encoding="utf-8") as f:
        geo = json.load(f)
    features: List[Dict[str, Any]] = []
    for feature in geo.get("features", []):
        props = feature.get("properties") or {}
        name = str(props.get("name") or "").strip()
        if not name:
            continue
        entry = {
            "name": name,
            "geometry": feature.get("geometry"),
            "_bounds": _feature_bounds(feature),
        }
        features.append(entry)
    return features


def _find_admin_unit(
    lat: float,
    lng: float,
    features: List[Dict[str, Any]],
) -> Optional[str]:
    for feature in features:
        if _feature_contains_point(feature, lng, lat):
            return feature["name"]
    return None


def build_country_focus(
    locations: List[List[Any]],
    geojson_dir: Path,
) -> Dict[str, Any]:
    """Build compact administrative choropleth counts from geocoded places."""
    countries: List[Dict[str, Any]] = []
    counts: Dict[str, Dict[str, Any]] = {}
    maps: Dict[str, Dict[str, str]] = {}
    bounds: Dict[str, Dict[str, List[float]]] = {}

    by_country_index: Dict[int, List[List[Any]]] = {}
    for row in locations:
        if len(row) < 6 or row[5] < 0:
            continue
        by_country_index.setdefault(int(row[5]), []).append(row)

    for country, cfg in COUNTRY_FOCUS_ADMIN.items():
        country_index = FOCUS_COUNTRIES.index(country)
        slug = str(cfg["slug"])
        levels = list(cfg["levels"])
        countries.append({"name": country, "slug": slug, "levels": levels})
        counts[country] = {}
        maps[country] = {}
        bounds[country] = {}

        country_locations = by_country_index.get(country_index, [])
        for level in levels:
            rel_path = f"admin-boundaries/{slug}_{level}.geojson"
            path = geojson_dir / f"{slug}_{level}.geojson"
            if not path.is_file():
                logger.warning("Admin GeoJSON not found at %s — skipping %s %s", path, country, level)
                continue

            features = _load_admin_features(path)
            unit_counts: Counter = Counter()
            matched_locations = 0
            for row in country_locations:
                lat, lng = float(row[2]), float(row[3])
                unit = _find_admin_unit(lat, lng, features)
                if not unit:
                    continue
                unit_counts[unit] += _safe_int(row[4])
                matched_locations += 1

            ordered = {k: int(v) for k, v in sorted(unit_counts.items())}
            level_bounds = _combine_bounds(feature.get("_bounds") for feature in features)
            counts[country][level] = {
                "countsMentions": ordered,
                "countsArticles": ordered,
                "matchedLocations": matched_locations,
                "total": int(sum(ordered.values())),
                "units": len(features),
            }
            maps[country][level] = rel_path
            if level_bounds:
                bounds[country][level] = level_bounds
            logger.info(
                "Country focus: %s %s -> %d/%d locations, %d units",
                country, level, matched_locations, len(country_locations), len(ordered),
            )

    return {"countries": countries, "counts": counts, "maps": maps, "bounds": bounds}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DATASET_ID, help="Hugging Face dataset repository ID")
    parser.add_argument("--output", default="asset/data/spatial-exploration.json")
    parser.add_argument(
        "--minify", action=argparse.BooleanOptionalAction, default=True,
        help="Produce compact JSON (default: %(default)s)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Set log level to DEBUG")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    module_root = Path(__file__).resolve().parent.parent

    index_df = load_dataset_safe("index", repo_id=args.repo)
    if index_df is None or index_df.empty:
        raise RuntimeError("index subset returned empty — aborting")

    payload = build_locations_and_pickers(index_df)
    country_counts = build_country_counts(args.repo)
    country_bounds = build_country_bounds(module_root / "asset/data/iwac-countries.geojson")
    country_focus = build_country_focus(
        payload["locations"],
        module_root / "asset/data/admin-boundaries",
    )

    result = {
        "_meta": create_metadata_block(
            total_records=int(len(index_df)),
            columns={
                "locations": ["o_id", "name", "lat", "lng", "count", "focus_country_index"],
                "pickers": ["o_id", "label", "count"],
            },
        ),
        "types": ENTITY_TYPES,
        "focus_countries": FOCUS_COUNTRIES,
        "locations": payload["locations"],
        "pickers": payload["pickers"],
        "country_counts": country_counts,
        "country_bounds": country_bounds,
        "country_focus": country_focus,
    }

    output = Path(args.output)
    if not output.is_absolute():
        output = module_root / output
    save_json(result, output, minify=args.minify)


if __name__ == "__main__":
    main()
