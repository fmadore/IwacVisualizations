#!/usr/bin/env python3
"""
generate_person_dashboards.py
=============================

Generate one JSON file per Person in the IWAC ``index`` subset under
``asset/data/person-dashboards/{o_id}.json``. Each file contains the
data for the IwacVisualizations ``personDashboard`` resource-page
block: summary counts, mentions timeline (year x country), top
newspapers, countries breakdown, TF-IDF ranked neighbor network, and
locations map — each faceted by role (all / subject / creator).

Follows the patterns from ``iwac-dashboard/scripts/generate_entity_spatial.py``
(entity name normalization + join) and the existing
``scripts/generate_collection_overview.py`` (CLI, logging, HF loader,
save_json).

Usage
-----
    python scripts/generate_person_dashboards.py
    python scripts/generate_person_dashboards.py --limit 5
    python scripts/generate_person_dashboards.py --output-dir asset/data/person-dashboards
"""
from __future__ import annotations

import argparse
import logging
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    extract_year,
    find_column,
    load_dataset_safe,
    normalize_country,
    normalize_location_name,
    parse_coordinates,
    parse_pipe_separated,
    save_json,
)

# Content subsets that can reference a Person. ``index`` is loaded
# separately (authority). ``documents`` and ``audiovisual`` are too
# small to justify the join cost and are intentionally excluded.
CONTENT_SUBSETS = ["articles", "publications", "references"]

# Role assigned to each (subset, field) pair when resolving an entity.
# Subsets where a field is missing or blank are silently skipped.
SUBJECT_FIELDS = {
    "articles":     "subject",
    "publications": "subject",
    "references":   "subject",
}
CREATOR_FIELDS = {
    "articles":     "author",
    "publications": "author",
    "references":   "author",
}

# Minimum co-occurrence before a neighbor qualifies for the network.
# Singletons produce noisy TF-IDF scores.
MIN_COOCCURRENCE = 2

# Top cap per person, per role slice.
TOP_N_NEIGHBORS = 50

# Omeka resource template id for ``Personnes`` on islam.zmo.de.
PERSON_TEMPLATE_TYPE = "Personnes"

# Module-level logger. Populated by ``main()`` via ``global logger``.
logger: Optional[logging.Logger] = None


class PersonDashboardGenerator:
    """Builds one JSON per Person in the index subset."""

    def __init__(self, output_dir: Path, limit: Optional[int] = None) -> None:
        self.output_dir = output_dir
        self.limit = limit

        self.index_df: Optional[pd.DataFrame] = None
        self.content_dfs: Dict[str, pd.DataFrame] = {}

        # Built in later tasks
        self.entity_lookup: Dict[str, Dict[str, Any]] = {}
        self.id_to_entity: Dict[int, Dict[str, Any]] = {}  # o_id -> entity info (reverse index)
        self.lieux_rows: Dict[int, Tuple[float, float, str]] = {}  # o_id -> (lat, lng, country)
        self.persons: Dict[int, Dict[str, Any]] = {}
        self.item_entities: Dict[str, Dict[str, List[int]]] = {}  # item_key -> {'subject': [o_id, ...], 'creator': [...]}
        self.items_meta: Dict[str, Dict[str, Any]] = {}           # item_key -> {o_id, pub_date, newspaper, country, subset}
        self.persons_items: Dict[int, Dict[str, Set[str]]] = defaultdict(
            lambda: {"subject": set(), "creator": set()}
        )
        self.df: Dict[int, int] = {}  # document frequency for TF-IDF
        self.n_persons: int = 0

    # ------------------------------------------------------------------
    # Loaders
    # ------------------------------------------------------------------

    def load_index(self) -> None:
        logger.info("Loading index subset...")
        self.index_df = load_dataset_safe("index", repo_id=DATASET_ID)
        if self.index_df is None or self.index_df.empty:
            raise RuntimeError("index subset returned empty — aborting")
        logger.info(f"  {len(self.index_df)} index entries")

    def load_content(self) -> None:
        for subset in CONTENT_SUBSETS:
            logger.info(f"Loading content subset: {subset}")
            df = load_dataset_safe(subset, repo_id=DATASET_ID)
            if df is None or df.empty:
                logger.warning(f"  {subset} returned empty — continuing")
                continue
            self.content_dfs[subset] = df
            logger.info(f"  {len(df)} rows")

    # ------------------------------------------------------------------
    # Entity lookup + person filter
    # ------------------------------------------------------------------

    def build_entity_lookup(self) -> None:
        """Normalized-name → index row, o_id → index row, and Lieux coord table.

        Built once so per-person compute loops can do O(1) lookups
        instead of walking self.index_df again on every call.
        """
        df = self.index_df

        id_col = find_column(df, ["o:id", "id"])
        title_col = find_column(df, ["Titre", "dcterms:title"])
        type_col = find_column(df, ["Type"])
        if not (id_col and title_col and type_col):
            raise RuntimeError(
                f"index subset missing required columns: id={id_col}, title={title_col}, type={type_col}"
            )
        alt_col = find_column(df, ["Titre alternatif", "dcterms:alternative"])
        coord_col = find_column(df, ["Coordonnées", "coordinates"])
        countries_col = find_column(df, ["countries", "country"])

        for _, row in df.iterrows():
            o_id = row.get(id_col)
            try:
                o_id = int(o_id)
            except (TypeError, ValueError):
                continue

            entity_type = str(row.get(type_col) or "").strip()
            if not entity_type or entity_type == "Notices d'autorité":
                continue

            title = str(row.get(title_col) or "").strip()
            if not title:
                continue

            info = {
                "o_id": o_id,
                "title": title,
                "type": entity_type,
                "row": row,
            }
            key = normalize_location_name(title)
            if key:
                self.entity_lookup.setdefault(key, info)

            if alt_col:
                for alt in parse_pipe_separated(row.get(alt_col)):
                    alt_key = normalize_location_name(alt)
                    if alt_key and alt_key not in self.entity_lookup:
                        self.entity_lookup[alt_key] = info

            self.id_to_entity[o_id] = info

            if entity_type == PERSON_TEMPLATE_TYPE:
                self.persons[o_id] = info

            if entity_type == "Lieux" and coord_col:
                coords = parse_coordinates(row.get(coord_col))
                if coords is not None:
                    country_list = parse_pipe_separated(row.get(countries_col)) if countries_col else []
                    country = country_list[0] if country_list else ""
                    self.lieux_rows[o_id] = (coords[0], coords[1], country)

        self.n_persons = len(self.persons)
        logger.info(
            f"Entity lookup built: {len(self.entity_lookup)} name keys, "
            f"{self.n_persons} persons, {len(self.lieux_rows)} geocoded places"
        )

    # ------------------------------------------------------------------
    # Per-item entity resolution
    # ------------------------------------------------------------------

    def resolve_items(self) -> None:
        """Walk each content row and extract entity o_ids by role.

        Populates:
          - self.item_entities[item_key] = {"subject": [o_id...], "creator": [o_id...]}
          - self.items_meta[item_key]    = {o_id, pub_date, newspaper, country, subset}
          - self.persons_items[person_o_id] = {"subject": {item_key,...}, "creator": {...}}
        """
        for subset, df in self.content_dfs.items():
            id_col = find_column(df, ["o:id", "id"])
            if not id_col:
                logger.warning(f"{subset}: no o:id column, skipping")
                continue

            subject_col = SUBJECT_FIELDS.get(subset)
            if subject_col and subject_col not in df.columns:
                subject_col = None
            creator_col = CREATOR_FIELDS.get(subset)
            if creator_col and creator_col not in df.columns:
                creator_col = None

            date_col = find_column(df, ["pub_date", "dcterms:date"])
            country_col = find_column(df, ["country", "countries"])
            newspaper_col = find_column(df, ["newspaper", "dcterms:publisher", "source"])

            for _, row in df.iterrows():
                raw_id = row.get(id_col)
                try:
                    item_o_id = int(raw_id)
                except (TypeError, ValueError):
                    continue
                item_key = f"{subset}:{item_o_id}"

                self.items_meta[item_key] = {
                    "o_id": item_o_id,
                    "subset": subset,
                    "pub_date": str(row.get(date_col) or "").strip() if date_col else "",
                    "country": self._first_country(row.get(country_col)) if country_col else "",
                    "newspaper": str(row.get(newspaper_col) or "").strip() if newspaper_col else "",
                }

                roles: Dict[str, List[int]] = {"subject": [], "creator": []}

                if subject_col:
                    for name in parse_pipe_separated(row.get(subject_col)):
                        entity = self.entity_lookup.get(normalize_location_name(name))
                        if entity:
                            roles["subject"].append(entity["o_id"])

                if creator_col:
                    for name in parse_pipe_separated(row.get(creator_col)):
                        entity = self.entity_lookup.get(normalize_location_name(name))
                        if entity:
                            roles["creator"].append(entity["o_id"])

                self.item_entities[item_key] = roles

                for role_name, o_ids in roles.items():
                    for o_id in o_ids:
                        if o_id in self.persons:
                            self.persons_items[o_id][role_name].add(item_key)

        logger.info(
            f"Resolved {len(self.item_entities)} items; "
            f"{sum(1 for p in self.persons_items if self.persons_items[p]['subject'] or self.persons_items[p]['creator'])} "
            f"persons have at least one mention"
        )

    @staticmethod
    def _first_country(value: Any) -> str:
        countries = normalize_country(value, return_list=True)
        if isinstance(countries, list) and countries:
            first = countries[0].strip()
            return first if first and first.lower() != "unknown" else ""
        return ""

    # ------------------------------------------------------------------
    # Per-person aggregates
    # ------------------------------------------------------------------

    EMPTY_SUMMARY = {
        "total_mentions": 0,
        "year_min": None,
        "year_max": None,
        "newspapers_count": 0,
        "countries_count": 0,
        "neighbors_count": 0,
    }

    def _items_for_role(
        self, person_o_id: int, role: str
    ) -> List[str]:
        """Return item_keys for this person + role. 'all' = union."""
        if role == "all":
            return sorted(
                self.persons_items[person_o_id]["subject"]
                | self.persons_items[person_o_id]["creator"]
            )
        return sorted(self.persons_items[person_o_id][role])

    def compute_summary(self, person_o_id: int) -> Dict[str, Any]:
        by_role: Dict[str, Dict[str, Any]] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            if not item_keys:
                by_role[role] = dict(self.EMPTY_SUMMARY)
                continue
            years: List[int] = []
            newspapers: Set[str] = set()
            countries: Set[str] = set()
            for key in item_keys:
                meta = self.items_meta.get(key, {})
                y = extract_year(meta.get("pub_date"))
                if y is not None:
                    years.append(y)
                if meta.get("newspaper"):
                    newspapers.add(meta["newspaper"])
                if meta.get("country"):
                    countries.add(meta["country"])
            by_role[role] = {
                "total_mentions": len(item_keys),
                "year_min": min(years) if years else None,
                "year_max": max(years) if years else None,
                "newspapers_count": len(newspapers),
                "countries_count": len(countries),
                "neighbors_count": 0,  # filled in after network is built
            }
        return {"by_role": by_role}

    def compute_timeline(self, person_o_id: int) -> Dict[str, Any]:
        """Year × country stacked series, mirrors C.timeline shape."""
        by_role: Dict[str, Any] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            year_country: Dict[Tuple[int, str], int] = Counter()
            countries: Set[str] = set()
            years_seen: Set[int] = set()
            for key in item_keys:
                meta = self.items_meta.get(key, {})
                y = extract_year(meta.get("pub_date"))
                c = meta.get("country") or ""
                if y is None or not c:
                    continue
                year_country[(y, c)] += 1
                countries.add(c)
                years_seen.add(y)
            if not years_seen:
                by_role[role] = {"years": [], "countries": [], "series": {}}
                continue
            years = sorted(years_seen)
            countries_sorted = sorted(countries)
            series = {
                c: [year_country.get((y, c), 0) for y in years]
                for c in countries_sorted
            }
            by_role[role] = {
                "years": years,
                "countries": countries_sorted,
                "series": series,
            }
        return {"by_role": by_role}

    def compute_newspapers(self, person_o_id: int, top_n: int = 15) -> Dict[str, Any]:
        by_role: Dict[str, Any] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            stats: Dict[str, Dict[str, Any]] = {}
            for key in item_keys:
                meta = self.items_meta.get(key, {})
                name = meta.get("newspaper")
                if not name:
                    continue
                s = stats.setdefault(name, {
                    "name": name,
                    "total": 0,
                    "articles": 0,
                    "publications": 0,
                    "country": meta.get("country") or "",
                    "year_min": None,
                    "year_max": None,
                })
                s["total"] += 1
                if meta.get("subset") == "articles":
                    s["articles"] += 1
                elif meta.get("subset") == "publications":
                    s["publications"] += 1
                y = extract_year(meta.get("pub_date"))
                if y is not None:
                    s["year_min"] = y if s["year_min"] is None else min(s["year_min"], y)
                    s["year_max"] = y if s["year_max"] is None else max(s["year_max"], y)
            entries = sorted(stats.values(), key=lambda e: e["total"], reverse=True)[:top_n]
            by_role[role] = entries
        return {"by_role": by_role}

    def compute_countries(self, person_o_id: int) -> Dict[str, Any]:
        by_role: Dict[str, Any] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            counter: Counter = Counter()
            for key in item_keys:
                c = self.items_meta.get(key, {}).get("country") or ""
                if c:
                    counter[c] += 1
            entries = [{"name": name, "count": count} for name, count in counter.most_common()]
            by_role[role] = entries
        return {"by_role": by_role}

    def compute_locations(self, person_o_id: int) -> Dict[str, Any]:
        """Join mentioned Lieux entities to their Coordonnées.

        ``self.lieux_rows`` is precomputed in ``build_entity_lookup``
        (o_id → (lat, lng, country)). ``self.id_to_entity`` gives the
        O(1) title lookup.
        """
        by_role: Dict[str, Any] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            loc_counter: Counter = Counter()
            for key in item_keys:
                roles = self.item_entities.get(key, {})
                seen_here: Set[int] = set()
                for entity_o_id in roles.get("subject", []) + roles.get("creator", []):
                    if entity_o_id not in self.lieux_rows:
                        continue
                    if entity_o_id in seen_here:
                        continue
                    seen_here.add(entity_o_id)
                    loc_counter[entity_o_id] += 1
            entries = []
            for entity_o_id, count in loc_counter.most_common():
                lat, lng, country = self.lieux_rows[entity_o_id]
                info = self.id_to_entity.get(entity_o_id, {})
                entries.append({
                    "o_id": entity_o_id,
                    "name": info.get("title", f"#{entity_o_id}"),
                    "lat": lat,
                    "lng": lng,
                    "country": country,
                    "count": count,
                })
            by_role[role] = entries
        return {"by_role": by_role}


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "asset" / "data" / "person-dashboards",
        help="Where to write per-person JSON files (default: %(default)s)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N persons (smoke test). 0 or unset = all.",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    return parser


def main() -> int:
    args = build_arg_parser().parse_args()
    global logger
    logger = configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    gen = PersonDashboardGenerator(
        output_dir=args.output_dir,
        limit=args.limit if args.limit and args.limit > 0 else None,
    )

    gen.load_index()
    gen.load_content()
    gen.build_entity_lookup()
    gen.resolve_items()

    logger.info("Skeleton run complete — aggregation stages will be added in later tasks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
