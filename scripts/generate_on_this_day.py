#!/usr/bin/env python3
"""
generate_on_this_day.py
=======================

Generate the ``asset/data/on-this-day/`` fan-out for the IwacVisualizations
module's On This Day page block: for every calendar day (``MM-DD``), the
items published on that day across the collection's decades.

Sources: the ``articles`` (newspaper articles) and ``publications``
(Islamic-periodical issues) subsets. Only rows whose ``pub_date`` carries a
full, valid ``YYYY-MM-DD`` date participate — ~99 % of articles do; bare
years and month precision are skipped. Every one of the 366 calendar days
is covered by the current dataset (3–70 items each), so the client block
practically never renders empty.

Output
------
    on-this-day/{MM-DD}.json    one file per calendar day::

        {
          "day": "07-02",
          "items": [[year, o_id, title, source, type], ...]   # year asc
        }

      ``type`` is ``"a"`` (article) or ``"p"`` (periodical issue);
      ``source`` is the newspaper / periodical title. Items are compact
      arrays — the whole fan-out stays ~1 KB per file.

    on-this-day/metadata.json   dir-level provenance (per-file ``_meta``
                                blocks would cost more than the payloads).

Stale-file note: regeneration overwrites the 366 day files in place; CI
builds from a clean checkout so orphans cannot ship. If you regenerate
locally after a dataset shrink, clear the directory first.

Usage
-----
    python scripts/generate_on_this_day.py
    python scripts/generate_on_this_day.py --output-dir asset/data/on-this-day --no-minify -v

Environment
-----------
    HF_TOKEN   Hugging Face access token — required, the default dataset is
               the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import logging
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List

from iwac_utils import (
    DATASET_ID,
    clean_str,
    configure_logging,
    create_metadata_block,
    load_dataset_safe,
    save_json,
)

logger = logging.getLogger(__name__)

FULL_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

# Subset name -> (single-char type flag, source column). Both subsets carry
# a clean `newspaper` column (for publications it is the periodical title).
SOURCES = [
    ("articles", "a"),
    ("publications", "p"),
]


def valid_day(year: int, month: int, day: int) -> bool:
    """Cheap calendar sanity: rejects month 00/13+, day 00/32+, absurd years."""
    if not (1800 <= year <= 2100):
        return False
    if not (1 <= month <= 12):
        return False
    days_in_month = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return 1 <= day <= days_in_month[month - 1]


def collect_days(repo_id: str) -> Dict[str, List[List[Any]]]:
    """Bucket every fully-dated article / issue by its MM-DD."""
    days: Dict[str, List[List[Any]]] = defaultdict(list)
    for subset, type_flag in SOURCES:
        logger.info("Loading %s subset...", subset)
        df = load_dataset_safe(subset, repo_id=repo_id,
                               columns=["pub_date", "o:id", "title", "newspaper"])
        if df is None or df.empty:
            raise RuntimeError(f"Could not load the {subset} subset")
        logger.info("  %d rows", len(df))

        kept = 0
        for _, row in df.iterrows():
            m = FULL_DATE_RE.match(clean_str(row.get("pub_date")))
            if not m:
                continue
            year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if not valid_day(year, month, day):
                continue
            o_id = clean_str(row.get("o:id"))
            title = clean_str(row.get("title"))
            if not o_id or not title:
                continue
            days[f"{month:02d}-{day:02d}"].append([
                year,
                int(o_id) if o_id.isdigit() else o_id,
                title,
                clean_str(row.get("newspaper")),
                type_flag,
            ])
            kept += 1
        logger.info("  %d fully-dated items kept", kept)
    return days


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[2])
    parser.add_argument("--repo", default=DATASET_ID,
                        help="Hugging Face dataset repo id")
    parser.add_argument("--output-dir", default="asset/data/on-this-day",
                        help="Fan-out directory (default: asset/data/on-this-day)")
    parser.add_argument("--minify", action=argparse.BooleanOptionalAction,
                        default=True, help="Compact JSON output (default: on)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Debug logging")
    args = parser.parse_args()
    configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    days = collect_days(args.repo)
    out_dir = Path(args.output_dir)
    total = 0
    for day_key in sorted(days):
        items = sorted(days[day_key], key=lambda r: (r[0], str(r[1])))
        total += len(items)
        save_json({"day": day_key, "items": items},
                  out_dir / f"{day_key}.json", minify=args.minify, log=False)

    counts = [len(v) for v in days.values()]
    save_json(
        {"_meta": create_metadata_block(
            total_records=total,
            days=len(days),
            min_per_day=min(counts) if counts else 0,
            max_per_day=max(counts) if counts else 0,
            columns=["year", "o_id", "title", "source", "type(a|p)"],
        )},
        out_dir / "metadata.json", minify=args.minify,
    )
    logger.info("Wrote %d day files (%d items) to %s", len(days), total, out_dir)


if __name__ == "__main__":
    main()
