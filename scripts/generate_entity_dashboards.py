#!/usr/bin/env python3
"""
generate_entity_dashboards.py
==============================

Generate one JSON file per non-person entity in the IWAC ``index``
subset under ``asset/data/entity-dashboards/{o_id}.json``. Entity types
covered:

    * Lieux         (Omeka resource template id 6)
    * Organisations (Omeka resource template id 7)
    * Sujets        (Omeka resource template id 3)
    * Événements    (Omeka resource template id 2)

Persons (template id 5) are intentionally excluded — they have their
own ``generate_person_dashboards.py`` because the role facet
(subject vs creator) is meaningful only for persons.

The output JSON shape mirrors person dashboards exactly, but every
section is wrapped in a single ``by_role.all`` key. That redundant
wrapper exists so the existing IWACVis person panel JS modules
(stats/timeline/newspapers/countries/network/map) can be reused
verbatim with a no-op facet.

Usage
-----
    python scripts/generate_entity_dashboards.py
    python scripts/generate_entity_dashboards.py --limit 5
    python scripts/generate_entity_dashboards.py --type Lieux
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

# Content subsets that can mention an entity. The references subset is
# intentionally included even though it's small, because bibliographic
# records do reference places/orgs/topics.
CONTENT_SUBSETS = ["articles", "publications", "references"]

# Subject field per subset — these are the columns containing
# pipe-separated lists of entity names that the item is "about". For
# non-person entities we only walk the subject column (creator/author
# is a person-only field).
SUBJECT_FIELDS = {
    "articles":     "subject",
    "publications": "subject",
    "references":   "subject",
}

# Spatial coverage field per subset — primary source for places named
# in an item. A name found here that matches a Lieu in the index will
# be treated as a mention of that Lieu, even if the Lieu doesn't
# appear in the subject field.
SPATIAL_FIELDS = {
    "articles":     "spatial",
    "publications": "spatial",
    "references":   "spatial",
}

# Index Type values that we treat as "non-person entities" for this
# generator. Keys are the Type values from the IWAC index; values are
# Omeka resource template ids on islam.zmo.de.
ENTITY_TYPES: Dict[str, int] = {
    "Lieux":         6,
    "Organisations": 7,
    "Sujets":        3,
    "\u00c9v\u00e9nements": 2,  # Événements
}

PERSON_TYPE = "Personnes"

# Minimum co-occurrence before a neighbor qualifies for the network.
MIN_COOCCURRENCE = 2

# Top cap per entity for the neighbor network panel.
TOP_N_NEIGHBORS = 50

logger: Optional[logging.Logger] = None


class EntityDashboardGenerator:
    """Builds one JSON per non-person entity in the index subset."""

    def __init__(
        self,
        output_dir: Path,
        limit: Optional[int] = None,
        only_type: Optional[str] = None,
    ) -> None:
        self.output_dir = output_dir
        self.limit = limit
        self.only_type = only_type  # If set, restrict to one entity type

        self.index_df: Optional[pd.DataFrame] = None
        self.content_dfs: Dict[str, pd.DataFrame] = {}

        # Built in later steps
        self.entity_lookup: Dict[str, Dict[str, Any]] = {}      # name_key -> entity info
        self.id_to_entity: Dict[int, Dict[str, Any]] = {}        # o_id -> entity info
        self.lieux_rows: Dict[int, Tuple[float, float]] = {}     # lieu o_id -> (lat, lng)
        self.entities: Dict[int, Dict[str, Any]] = {}            # o_id -> info, only target types
        # item_key -> set of all entity o_ids referenced by this item via subject/spatial
        self.item_entities: Dict[str, Set[int]] = {}
        self.items_meta: Dict[str, Dict[str, Any]] = {}
        # entity_o_id -> set of item_keys
        self.entity_items: Dict[int, Set[str]] = defaultdict(set)
        self.df: Dict[int, int] = {}  # document frequency for TF-IDF
        self.n_entities: int = 0      # number of target entities (denominator for IDF)

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
    # Entity lookup + target filter
    # ------------------------------------------------------------------

    def build_entity_lookup(self) -> None:
        """Populate name → entity index, plus the target entity table.

        Also caches Lieu coordinates so the locations panel can geocode
        place names without re-walking the index.
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

            # Cache Lieu coordinates for the locations map panel.
            if entity_type == "Lieux" and coord_col:
                coords = parse_coordinates(row.get(coord_col))
                if coords is not None:
                    self.lieux_rows[o_id] = (coords[0], coords[1])

            # Restrict the target set to non-person entity types we care about.
            if entity_type in ENTITY_TYPES and (
                self.only_type is None or entity_type == self.only_type
            ):
                self.entities[o_id] = info

        self.n_entities = len(self.entities)
        logger.info(
            f"Entity lookup built: {len(self.entity_lookup)} name keys, "
            f"{self.n_entities} target entities, {len(self.lieux_rows)} geocoded places"
        )

    # ------------------------------------------------------------------
    # Per-item entity resolution
    # ------------------------------------------------------------------

    def resolve_items(self) -> None:
        """Walk each content row and build item → entities mappings.

        For non-person entities we collapse subject + spatial into a
        single set of entity ids per item — there is no role distinction
        to preserve.
        """
        for subset, df in self.content_dfs.items():
            id_col = find_column(df, ["o:id", "id"])
            if not id_col:
                logger.warning(f"{subset}: no o:id column, skipping")
                continue

            subject_col = SUBJECT_FIELDS.get(subset)
            if subject_col and subject_col not in df.columns:
                subject_col = None
            spatial_col = find_column(df, [
                SPATIAL_FIELDS.get(subset, "spatial"),
                "spatial",
                "dcterms:spatial",
                "Couverture spatiale",
            ])

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

                refs: Set[int] = set()

                if subject_col:
                    for name in parse_pipe_separated(row.get(subject_col)):
                        entity = self.entity_lookup.get(normalize_location_name(name))
                        if entity:
                            refs.add(entity["o_id"])

                if spatial_col:
                    for name in parse_pipe_separated(row.get(spatial_col)):
                        entity = self.entity_lookup.get(normalize_location_name(name))
                        if entity:
                            refs.add(entity["o_id"])

                if refs:
                    self.item_entities[item_key] = refs
                    for o_id in refs:
                        if o_id in self.entities:
                            self.entity_items[o_id].add(item_key)

        with_mentions = sum(1 for keys in self.entity_items.values() if keys)
        logger.info(
            f"Resolved {len(self.item_entities)} items; "
            f"{with_mentions}/{self.n_entities} target entities have at least one mention"
        )

    @staticmethod
    def _first_country(value: Any) -> str:
        countries = normalize_country(value, return_list=True)
        if isinstance(countries, list) and countries:
            first = countries[0].strip()
            return first if first and first.lower() != "unknown" else ""
        return ""

    # ------------------------------------------------------------------
    # Per-entity aggregates — same shape as person dashboards but
    # wrapped in by_role.all so the JS panels can be reused as-is.
    # ------------------------------------------------------------------

    EMPTY_SUMMARY = {
        "total_mentions": 0,
        "year_min": None,
        "year_max": None,
        "newspapers_count": 0,
        "countries_count": 0,
    }

    def _wrap(self, value: Any) -> Dict[str, Any]:
        """Wrap a flat result in the by_role.all envelope."""
        return {"by_role": {"all": value}}

    def compute_summary(self, entity_o_id: int) -> Dict[str, Any]:
        item_keys = self.entity_items.get(entity_o_id, set())
        if not item_keys:
            return self._wrap(dict(self.EMPTY_SUMMARY))
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
        return self._wrap({
            "total_mentions": len(item_keys),
            "year_min": min(years) if years else None,
            "year_max": max(years) if years else None,
            "newspapers_count": len(newspapers),
            "countries_count": len(countries),
        })

    def compute_timeline(self, entity_o_id: int) -> Dict[str, Any]:
        item_keys = self.entity_items.get(entity_o_id, set())
        year_country: Counter = Counter()
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
            return self._wrap({"years": [], "countries": [], "series": {}})
        years = sorted(years_seen)
        countries_sorted = sorted(countries)
        series = {
            c: [year_country.get((y, c), 0) for y in years]
            for c in countries_sorted
        }
        return self._wrap({
            "years": years,
            "countries": countries_sorted,
            "series": series,
        })

    def compute_newspapers(self, entity_o_id: int, top_n: int = 15) -> Dict[str, Any]:
        item_keys = self.entity_items.get(entity_o_id, set())
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
        return self._wrap(entries)

    def compute_countries(self, entity_o_id: int) -> Dict[str, Any]:
        item_keys = self.entity_items.get(entity_o_id, set())
        counter: Counter = Counter()
        for key in item_keys:
            c = self.items_meta.get(key, {}).get("country") or ""
            if c:
                counter[c] += 1
        entries = [{"name": name, "count": count} for name, count in counter.most_common()]
        return self._wrap(entries)

    def compute_locations(self, entity_o_id: int) -> Dict[str, Any]:
        """Geographic places mentioned alongside this entity.

        For a Lieu entity, this includes the Lieu itself when it appears
        in subject or spatial fields. We do NOT exclude the center
        entity — readers typically expect "where this place is mentioned"
        to include the place itself when the dataset uses both subject
        and spatial columns inconsistently.
        """
        item_keys = self.entity_items.get(entity_o_id, set())
        loc_counter: Counter = Counter()
        for key in item_keys:
            for o_id in self.item_entities.get(key, set()):
                if o_id in self.lieux_rows:
                    loc_counter[o_id] += 1
        entries = []
        for o_id, count in loc_counter.most_common():
            lat, lng = self.lieux_rows[o_id]
            info = self.id_to_entity.get(o_id, {})
            entries.append({
                "o_id": o_id,
                "name": info.get("title", f"#{o_id}"),
                "lat": lat,
                "lng": lng,
                "count": count,
            })
        return self._wrap(entries)

    # ------------------------------------------------------------------
    # TF-IDF document frequency — computed once across all target
    # entities, used for the neighbor network ranking.
    # ------------------------------------------------------------------

    def build_document_frequency(self) -> None:
        """df[o_id] = number of TARGET entities whose item set touches it.

        Mirrors the person script: IDF reflects how broadly each
        co-occurring entity is shared across the entities of interest,
        so very common neighbors (e.g. "Islam") get penalized.
        """
        for entity_o_id, item_keys in self.entity_items.items():
            if entity_o_id not in self.entities:
                continue
            touched: Set[int] = set()
            for item_key in item_keys:
                for o_id in self.item_entities.get(item_key, set()):
                    if o_id != entity_o_id:
                        touched.add(o_id)
            for o_id in touched:
                self.df[o_id] = self.df.get(o_id, 0) + 1
        logger.info(f"Document frequency: {len(self.df)} distinct entities")

    def compute_network(self, entity_o_id: int) -> Dict[str, Any]:
        """TF-IDF ranked neighbor graph for this entity.

        Nodes[0] is the entity itself (type='center'). Neighbors are
        scored as cooc * log(N / df_x) and capped at TOP_N_NEIGHBORS.
        """
        entity_info = self.entities[entity_o_id]
        item_keys = self.entity_items.get(entity_o_id, set())

        cooc: Counter = Counter()
        for key in item_keys:
            for o_id in self.item_entities.get(key, set()):
                if o_id != entity_o_id:
                    cooc[o_id] += 1

        scored: List[Dict[str, Any]] = []
        for o_id, count in cooc.items():
            if count < MIN_COOCCURRENCE:
                continue
            df_x = max(self.df.get(o_id, 1), 1)
            if df_x >= self.n_entities:
                continue  # everyone has it, it's noise
            idf = math.log(self.n_entities / df_x)
            score = count * idf
            if score <= 0:
                continue
            other = self.id_to_entity.get(o_id)
            if not other:
                continue
            scored.append({
                "o_id": o_id,
                "title": other["title"],
                "type": other["type"],
                "cooc": count,
                "score": round(score, 4),
            })

        scored.sort(key=lambda e: e["score"], reverse=True)
        scored = scored[:TOP_N_NEIGHBORS]

        nodes: List[Dict[str, Any]] = [{
            "o_id": entity_o_id,
            "title": entity_info["title"],
            "type": "center",
            "cooc": None,
            "score": None,
        }]
        nodes.extend(scored)

        edges: List[Dict[str, Any]] = [{
            "source": entity_o_id,
            "target": n["o_id"],
            "weight": n["score"],
            "cooc": n["cooc"],
        } for n in scored]

        return self._wrap({"nodes": nodes, "edges": edges})

    # ------------------------------------------------------------------
    # Per-entity JSON assembly + fan-out
    # ------------------------------------------------------------------

    def build_entity_json(self, entity_o_id: int) -> Dict[str, Any]:
        info = self.entities[entity_o_id]
        return {
            "version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "entity": {
                "o_id": entity_o_id,
                "title": info["title"],
                "type": info["type"],
            },
            "summary":    self.compute_summary(entity_o_id),
            "timeline":   self.compute_timeline(entity_o_id),
            "newspapers": self.compute_newspapers(entity_o_id),
            "countries":  self.compute_countries(entity_o_id),
            "network":    self.compute_network(entity_o_id),
            "locations":  self.compute_locations(entity_o_id),
        }

    def generate_all(self) -> int:
        """Write one JSON per target entity, including zero-mention ones.

        Entities with no content references still get a placeholder
        JSON so the resource page block doesn't 404 — the JS panels
        will render their "no data available" empty states from the
        empty arrays the placeholder carries.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)
        targets = list(self.entities.keys())
        if self.limit:
            targets = targets[: self.limit]

        written = 0
        empty = 0
        for entity_o_id in targets:
            if not self.entity_items.get(entity_o_id):
                empty += 1
            data = self.build_entity_json(entity_o_id)
            out_path = self.output_dir / f"{entity_o_id}.json"
            save_json(data, out_path)
            written += 1
            if written % 200 == 0:
                logger.info(f"  {written} entity JSONs written")
        logger.info(
            f"Done — {written} entity JSONs written to {self.output_dir} "
            f"({empty} of them are zero-mention placeholders)"
        )
        return written


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "asset" / "data" / "entity-dashboards",
        help="Where to write per-entity JSON files (default: %(default)s)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N entities (smoke test). 0 or unset = all.",
    )
    parser.add_argument(
        "--type",
        choices=list(ENTITY_TYPES.keys()),
        default=None,
        help="Restrict generation to a single entity type (Lieux/Organisations/Sujets/Événements).",
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

    gen = EntityDashboardGenerator(
        output_dir=args.output_dir,
        limit=args.limit if args.limit and args.limit > 0 else None,
        only_type=args.type,
    )

    gen.load_index()
    gen.load_content()
    gen.build_entity_lookup()
    gen.resolve_items()
    gen.build_document_frequency()
    written = gen.generate_all()
    logger.info(f"Finished: {written} entity dashboards emitted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
