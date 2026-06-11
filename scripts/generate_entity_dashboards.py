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
verbatim with a no-op facet. The shared aggregation pipeline lives in
``dashboard_aggregator.DashboardAggregator``; this script only
implements the entity-specific parts: the target-type filter, the
collapsed subject+spatial reference set per item, and the single
``all`` role slice.

Usage
-----
    python scripts/generate_entity_dashboards.py
    python scripts/generate_entity_dashboards.py --limit 5
    python scripts/generate_entity_dashboards.py --type Lieux
    python scripts/generate_entity_dashboards.py --no-minify
"""
from __future__ import annotations

import argparse
import logging
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple

from dashboard_aggregator import (
    DEFAULT_MIN_COOCCURRENCE,
    DashboardAggregator,
)
from iwac_utils import DATASET_ID, configure_logging, save_json

# Index Type values that we treat as "non-person entities" for this
# generator. Keys are the Type values from the IWAC index; values are
# Omeka resource template ids on islam.zmo.de.
ENTITY_TYPES: Dict[str, int] = {
    "Lieux":         6,
    "Organisations": 7,
    "Sujets":        3,
    "Événements": 2,  # Événements
}

logger = logging.getLogger(__name__)


class EntityDashboardGenerator(DashboardAggregator):
    """Builds one JSON per non-person entity in the index subset.

    Uses the base subject-only ``ROLE_FIELDS`` — creator/author is a
    person-only field, so the only role columns walked here are the
    per-subset ``subject`` columns (plus ``dcterms:spatial``, which the
    base resolves separately and ``_register_item`` folds in).
    """

    def __init__(
        self,
        output_dir: Path,
        limit: Optional[int] = None,
        only_type: Optional[str] = None,
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
        self.only_type = only_type  # If set, restrict to one entity type

        # entity_o_id -> set of item_keys
        self.entity_items: Dict[int, Set[str]] = defaultdict(set)

    # ------------------------------------------------------------------
    # DashboardAggregator hooks
    # ------------------------------------------------------------------

    def _is_target(self, entity_type: str) -> bool:
        return entity_type in ENTITY_TYPES and (
            self.only_type is None or entity_type == self.only_type
        )

    def _target_label(self) -> str:
        return "target entities"

    def _register_item(
        self,
        item_key: str,
        roles: Dict[str, List[int]],
        spatial_pairs: List[Tuple[str, Optional[Dict[str, Any]]]],
    ) -> None:
        """Collapse subject + spatial into a single set of entity ids per
        item — there is no role distinction to preserve. A name found in
        ``dcterms:spatial`` that matches an index entry is treated as a
        mention of that entity, even if it doesn't appear in subject."""
        refs: Set[int] = set()
        for o_ids in roles.values():
            refs.update(o_ids)
        for _name, entity in spatial_pairs:
            if entity:
                refs.add(entity["o_id"])

        if refs:
            self.item_entities[item_key] = refs
            for o_id in refs:
                if o_id in self.targets:
                    self.entity_items[o_id].add(item_key)

    def _log_resolve_summary(self) -> None:
        with_mentions = sum(1 for keys in self.entity_items.values() if keys)
        logger.info(
            f"Resolved {len(self.item_entities)} items; "
            f"{with_mentions}/{self.n_targets} target entities have at least one mention"
        )

    def _role_slices(self, target_id: int) -> Iterator[Tuple[str, Set[str]]]:
        # Single no-op facet — every section lands in by_role.all.
        yield "all", self.entity_items.get(target_id, set())

    def _item_neighbor_ids(self, item_key: str, exclude: int) -> List[int]:
        return [
            o_id for o_id in self.item_entities.get(item_key, set())
            if o_id != exclude
        ]

    def _item_location_ids(self, item_key: str) -> List[int]:
        # For a Lieu entity this includes the Lieu itself when it appears
        # in subject or spatial fields. We do NOT exclude the center
        # entity — readers typically expect "where this place is
        # mentioned" to include the place itself when the dataset uses
        # both subject and spatial columns inconsistently.
        return [
            o_id for o_id in self.item_entities.get(item_key, set())
            if o_id in self.lieux_rows
        ]

    def _iter_target_items(self) -> Iterator[Tuple[int, Set[str]]]:
        for entity_o_id, item_keys in self.entity_items.items():
            if entity_o_id not in self.targets:
                continue
            yield entity_o_id, item_keys

    # ------------------------------------------------------------------
    # Per-entity JSON assembly + fan-out
    # ------------------------------------------------------------------

    def build_entity_json(self, entity_o_id: int) -> Dict[str, Any]:
        info = self.targets[entity_o_id]
        data: Dict[str, Any] = {
            "version": 2,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "entity": {
                "o_id": entity_o_id,
                "title": info["title"],
                "type": info["type"],
            },
        }
        data.update(self.compute_sections(entity_o_id))
        return data

    def generate_all(self) -> int:
        """Write one JSON per target entity, including zero-mention ones.

        Entities with no content references still get a placeholder
        JSON so the resource page block doesn't 404 — the JS panels
        will render their "no data available" empty states from the
        empty arrays the placeholder carries.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)
        targets = list(self.targets.keys())
        if self.limit:
            targets = targets[: self.limit]

        written = 0
        empty = 0
        for entity_o_id in targets:
            if not self.entity_items.get(entity_o_id):
                empty += 1
            data = self.build_entity_json(entity_o_id)
            out_path = self.output_dir / f"{entity_o_id}.json"
            save_json(data, out_path, minify=self.minify, log=False)
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
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repo id (default: %(default)s)",
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
        "--min-cooccurrence",
        type=int,
        default=DEFAULT_MIN_COOCCURRENCE,
        help="Minimum co-occurrence count for a neighbor to qualify for the network panel (default: %(default)s)",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Minify the per-entity JSON files (default: %(default)s)",
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

    gen = EntityDashboardGenerator(
        output_dir=args.output_dir,
        limit=args.limit if args.limit and args.limit > 0 else None,
        only_type=args.type,
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
    logger.info(f"Finished: {written} entity dashboards emitted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
