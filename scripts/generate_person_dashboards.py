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

    logger.info("Skeleton run complete — aggregation stages will be added in later tasks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
