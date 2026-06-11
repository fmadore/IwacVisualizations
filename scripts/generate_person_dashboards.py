#!/usr/bin/env python3
"""
generate_person_dashboards.py
=============================

Generate one JSON file per Person in the IWAC ``index`` subset under
``asset/data/person-dashboards/{o_id}.json``. Each file contains the
data for the IwacVisualizations ``personDashboard`` resource-page
block: summary counts, mentions timeline (year x country), top
newspapers, countries breakdown, TF-IDF ranked neighbor network, and
locations map — each faceted by role (all / subject / creator /
editor).

The aggregation pipeline (loading, entity lookup, item resolution,
document frequency, the ``compute_*`` family) lives in
``dashboard_aggregator.DashboardAggregator``; this script only
implements the person-specific parts: role buckets
(subject / creator / editor), the spatial-coverage hit/miss tally,
and the header card fields (prénom / nom / genre / countries).

Usage
-----
    python scripts/generate_person_dashboards.py
    python scripts/generate_person_dashboards.py --limit 5
    python scripts/generate_person_dashboards.py --output-dir asset/data/person-dashboards
    python scripts/generate_person_dashboards.py --no-minify
"""
from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple

import pandas as pd

from dashboard_aggregator import (
    DEFAULT_MIN_COOCCURRENCE,
    SUBJECT_FIELDS,
    DashboardAggregator,
)
from iwac_utils import (
    DATASET_ID,
    configure_logging,
    find_column,
    parse_pipe_separated,
    save_json,
)

# Role assigned to each (subset, field) pair when resolving an entity.
# ``SUBJECT_FIELDS`` is shared with the entity generator; creator and
# editor are person-only roles.
CREATOR_FIELDS = {
    "articles":     "author",
    "publications": "author",
    "references":   "author",
}
# Editor is a separate role from creator (author). Only the references
# subset distinguishes editors — bibliographic entries for edited volumes
# list the editor in ``editor`` and the chapter/book author in ``author``.
EDITOR_FIELDS = {
    "references": "editor",
}

# Canonical role ordering. Every per-role aggregator iterates this tuple
# so adding a role is a one-line change here plus a persons_items init
# update. ``"all"`` is the union across subject/creator/editor item sets.
ROLES: Tuple[str, ...] = ("all", "subject", "creator", "editor")

# Omeka resource template id for ``Personnes`` on islam.zmo.de.
PERSON_TEMPLATE_TYPE = "Personnes"

logger = logging.getLogger(__name__)


class PersonDashboardGenerator(DashboardAggregator):
    """Builds one JSON per Person in the index subset."""

    # Per-item resolution walks subject, then creator, then editor —
    # the dict order here defines the encounter order everywhere.
    ROLE_FIELDS = {
        "subject": SUBJECT_FIELDS,
        "creator": CREATOR_FIELDS,
        "editor":  EDITOR_FIELDS,
    }

    def __init__(
        self,
        output_dir: Path,
        limit: Optional[int] = None,
        repo_id: str = DATASET_ID,
        min_cooccurrence: int = DEFAULT_MIN_COOCCURRENCE,
        minify: bool = True,
    ) -> None:
        super().__init__(
            output_dir,
            limit=limit,
            repo_id=repo_id,
            min_cooccurrence=min_cooccurrence,
            minify=minify,
        )
        # item_key -> set of Lieux o_ids parsed from the dcterms:spatial
        # field. Kept separate from item_entities because spatial
        # coverage isn't a "role" of the entity, it's a property of the
        # item.
        self.item_spatial: Dict[str, Set[int]] = {}
        # person_o_id -> {"subject": {item_key,...}, "creator": {...}, "editor": {...}}
        self.persons_items: Dict[int, Dict[str, Set[str]]] = defaultdict(
            lambda: {"subject": set(), "creator": set(), "editor": set()}
        )
        self._spatial_hits = 0
        self._spatial_misses = 0

        # Cached column names for _build_person_header — populated in
        # build_entity_lookup via _cache_header_columns.
        self.prenom_col: Optional[str] = None
        self.nom_col: Optional[str] = None
        self.genre_col: Optional[str] = None

    # ------------------------------------------------------------------
    # DashboardAggregator hooks
    # ------------------------------------------------------------------

    def _is_target(self, entity_type: str) -> bool:
        return entity_type == PERSON_TEMPLATE_TYPE

    def _target_label(self) -> str:
        return "persons"

    def _cache_header_columns(self, df: pd.DataFrame) -> None:
        self.prenom_col = find_column(df, ["Prénom", "foaf:firstName"])
        self.nom_col = find_column(df, ["Nom", "foaf:lastName"])
        self.genre_col = find_column(df, ["Genre", "foaf:gender"])

    def _register_item(
        self,
        item_key: str,
        roles: Dict[str, List[int]],
        spatial_pairs: List[Tuple[str, Optional[Dict[str, Any]]]],
    ) -> None:
        self.item_entities[item_key] = roles

        # Spatial coverage: keep only names that resolve to a geocoded
        # Lieux entry; tally free-form misses for the summary log line.
        seen_spatial: Set[int] = set()
        for name, entity in spatial_pairs:
            if entity and entity["o_id"] in self.lieux_rows:
                seen_spatial.add(entity["o_id"])
                self._spatial_hits += 1
            elif name.strip():
                self._spatial_misses += 1
        if seen_spatial:
            self.item_spatial[item_key] = seen_spatial

        for role_name, o_ids in roles.items():
            for o_id in o_ids:
                if o_id in self.targets:
                    self.persons_items[o_id][role_name].add(item_key)

    def _log_resolve_summary(self) -> None:
        logger.info(
            f"Resolved {len(self.item_entities)} items; "
            f"{sum(1 for p in self.persons_items if self.persons_items[p]['subject'] or self.persons_items[p]['creator'] or self.persons_items[p]['editor'])} "
            f"persons have at least one mention"
        )
        logger.info(
            f"Spatial coverage: {self._spatial_hits} matched to Lieux entries, "
            f"{self._spatial_misses} unmatched (free-form place names not in IWAC index)"
        )

    def _items_for_role(self, person_o_id: int, role: str) -> List[str]:
        """Return item_keys for this person + role. 'all' = union."""
        if role == "all":
            return sorted(
                self.persons_items[person_o_id]["subject"]
                | self.persons_items[person_o_id]["creator"]
                | self.persons_items[person_o_id]["editor"]
            )
        return sorted(self.persons_items[person_o_id][role])

    def _role_slices(self, target_id: int) -> Iterator[Tuple[str, List[str]]]:
        for role in ROLES:
            yield role, self._items_for_role(target_id, role)

    def _item_neighbor_ids(self, item_key: str, exclude: int) -> List[int]:
        """Entity ids across all role buckets, deduped, encounter order."""
        roles = self.item_entities.get(item_key, {})
        seen: Set[int] = set()
        out: List[int] = []
        for o_id in roles.get("subject", []) + roles.get("creator", []) + roles.get("editor", []):
            if o_id == exclude or o_id in seen:
                continue
            seen.add(o_id)
            out.append(o_id)
        return out

    def _item_location_ids(self, item_key: str) -> Set[int]:
        """Lieux for one item: dcterms:spatial (primary source) plus any
        subject/creator/editor entity that happens to be a Lieux record."""
        seen: Set[int] = set(self.item_spatial.get(item_key, set()))
        roles = self.item_entities.get(item_key, {})
        for o_id in roles.get("subject", []) + roles.get("creator", []) + roles.get("editor", []):
            if o_id in self.lieux_rows:
                seen.add(o_id)
        return seen

    def _iter_target_items(self) -> Iterator[Tuple[int, Set[str]]]:
        for person_o_id, role_items in self.persons_items.items():
            yield person_o_id, (
                role_items["subject"] | role_items["creator"] | role_items["editor"]
            )

    # ------------------------------------------------------------------
    # Per-person JSON assembly + fan-out
    # ------------------------------------------------------------------

    def _build_person_header(self, person_info: Dict[str, Any]) -> Dict[str, Any]:
        """Extract the handful of person-scoped fields that the header
        card needs (the block PHTML reads most fields from the Omeka
        representation directly; this is for JS-side labels only)."""
        row = person_info["row"]
        prenom_col = self.prenom_col
        nom_col = self.nom_col
        genre_col = self.genre_col

        countries = parse_pipe_separated(row.get("countries"))
        first = str(row.get("first_occurrence") or "").strip() or None
        last = str(row.get("last_occurrence") or "").strip() or None

        return {
            "o_id": person_info["o_id"],
            "title": person_info["title"],
            "prenom": str(row.get(prenom_col) or "").strip() if prenom_col else "",
            "nom": str(row.get(nom_col) or "").strip() if nom_col else "",
            "genre": str(row.get(genre_col) or "").strip() if genre_col else "",
            "countries": countries,
            "first_occurrence": first,
            "last_occurrence": last,
        }

    def build_person_json(self, person_o_id: int) -> Dict[str, Any]:
        person_info = self.targets[person_o_id]

        data: Dict[str, Any] = {
            "version": 2,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "person": self._build_person_header(person_info),
        }
        data.update(self.compute_sections(person_o_id))
        return data

    def generate_all(self) -> int:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        targets = list(self.persons_items.keys())
        if self.limit:
            targets = targets[: self.limit]

        written = 0
        for person_o_id in targets:
            if person_o_id not in self.targets:
                continue
            data = self.build_person_json(person_o_id)
            out_path = self.output_dir / f"{person_o_id}.json"
            save_json(data, out_path, minify=self.minify, log=False)
            written += 1
            if written % 100 == 0:
                logger.info(f"  {written} person JSONs written")
        logger.info(f"Done — {written} person JSONs written to {self.output_dir}")
        return written


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "asset" / "data" / "person-dashboards",
        help="Where to write per-person JSON files (default: %(default)s)",
    )
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repo id (default: %(default)s)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N persons (smoke test). 0 or unset = all.",
    )
    parser.add_argument(
        "--min-cooccurrence",
        type=int,
        default=DEFAULT_MIN_COOCCURRENCE,
        help="Minimum co-occurrence count for a neighbor to qualify for the network panel (default: %(default)s)",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Minify the per-person JSON files (default: %(default)s)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    return parser


def main() -> int:
    args = build_arg_parser().parse_args()
    configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    gen = PersonDashboardGenerator(
        output_dir=args.output_dir,
        limit=args.limit if args.limit and args.limit > 0 else None,
        repo_id=args.repo,
        min_cooccurrence=args.min_cooccurrence,
        minify=args.minify,
    )

    gen.load_index()
    gen.load_content()
    gen.build_entity_lookup()
    gen.resolve_items()

    gen.build_document_frequency()
    written = gen.generate_all()
    logger.info(f"Finished: {written} person dashboards emitted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
