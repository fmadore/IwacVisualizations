#!/usr/bin/env python3
"""
generate_press_bylines.py
=========================

Generate ``asset/data/press-bylines.json`` for the IwacVisualizations
module's Press Bylines page block — who signed the West African press in
the IWAC ``articles`` subset.

Coverage (verified 2026-07-02): ~79 % of articles carry an ``author``
byline; 2,463 distinct names, 225 of them with ≥ 10 articles. Bylines
include press agencies (e.g. Agence Togolaise de Presse) alongside
journalists — the block labels them plainly as bylines, not people.

Authority join: byline names are matched against the IWAC index's
``Personnes`` records (``Titre`` + ``Titre alternatif``, both sides
normalized through ``normalize_location_name``) so the front-end can link
a byline to its authority page — 184 of the top 200 bylines resolve.

Payload shape (top-level keys)
------------------------------
    metadata   — standard provenance block (+ match statistics)
    summary    — {articles, signed, pct_signed, unique, prolific}
                 (`prolific` = names with >= --prolific-min articles)
    by_year    — aligned arrays {years, total, signed}; the front-end
                 derives the share-of-signed trend from the two counts
    top        — top --top-n bylines by article count:
                 {name, count, first, last, o_id|null,
                  newspapers: [top 3], subjects: [top 5]}

Usage
-----
    python scripts/generate_press_bylines.py
    python scripts/generate_press_bylines.py --top-n 25 --no-minify -v

Environment
-----------
    HF_TOKEN   Optional Hugging Face access token (public dataset).
"""
from __future__ import annotations

import argparse
import logging
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Optional, Set

from iwac_utils import (
    DATASET_ID,
    clean_str,
    configure_logging,
    create_metadata_block,
    extract_year,
    load_dataset_safe,
    normalize_location_name,
    parse_pipe_separated,
    save_json,
)

logger = logging.getLogger(__name__)


def build_personnes_lookup(repo_id: str) -> Dict[str, int]:
    """Normalized Personnes name (Titre + alternatives) -> authority o:id."""
    df = load_dataset_safe("index", repo_id=repo_id)
    if df is None or df.empty:
        raise RuntimeError("Could not load the index subset")
    alt_col = "Titre alternatif" if "Titre alternatif" in df.columns else None
    lookup: Dict[str, int] = {}
    for _, row in df.iterrows():
        if clean_str(row.get("Type")) != "Personnes":
            continue
        o_id = row.get("o:id")
        try:
            o_id = int(o_id)
        except (TypeError, ValueError):
            continue
        names = [clean_str(row.get("Titre"))]
        if alt_col:
            names.extend(parse_pipe_separated(row.get(alt_col)))
        for name in names:
            key = normalize_location_name(name)
            if key:
                lookup.setdefault(key, o_id)
    logger.info("Personnes lookup: %d normalized names", len(lookup))
    return lookup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[2])
    parser.add_argument("--repo", default=DATASET_ID,
                        help="Hugging Face dataset repo id")
    parser.add_argument("--output", default="asset/data/press-bylines.json",
                        help="Output path (default: asset/data/press-bylines.json)")
    parser.add_argument("--top-n", type=int, default=25,
                        help="Bylines in the ranked list (default: 25)")
    parser.add_argument("--prolific-min", type=int, default=10,
                        help="Article threshold for the 'prolific' summary count (default: 10)")
    parser.add_argument("--minify", action=argparse.BooleanOptionalAction,
                        default=True, help="Compact JSON output (default: on)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Debug logging")
    args = parser.parse_args()
    configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    logger.info("Loading articles subset...")
    df = load_dataset_safe("articles", repo_id=args.repo)
    if df is None or df.empty:
        raise RuntimeError("Could not load the articles subset")
    logger.info("  %d rows", len(df))

    counts: Counter = Counter()
    years_by_name: Dict[str, Set[int]] = defaultdict(set)
    newspapers_by_name: Dict[str, Counter] = defaultdict(Counter)
    subjects_by_name: Dict[str, Counter] = defaultdict(Counter)
    year_total: Counter = Counter()
    year_signed: Counter = Counter()
    signed_rows = 0

    for _, row in df.iterrows():
        year = extract_year(row.get("pub_date"))
        if year:
            year_total[year] += 1

        names = [" ".join(part.split())
                 for part in parse_pipe_separated(row.get("author"))]
        names = [n for n in names if n]
        if not names:
            continue
        signed_rows += 1
        if year:
            year_signed[year] += 1

        newspaper = clean_str(row.get("newspaper"))
        subjects = parse_pipe_separated(row.get("subject"))
        for name in names:
            counts[name] += 1
            if year:
                years_by_name[name].add(year)
            if newspaper:
                newspapers_by_name[name][newspaper] += 1
            for s in subjects:
                subjects_by_name[name][s] += 1

    lookup = build_personnes_lookup(args.repo)

    def resolve(name: str) -> Optional[int]:
        return lookup.get(normalize_location_name(name))

    top = []
    matched = 0
    # Ties broken by name so regenerated output stays order-stable.
    for name, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:args.top_n]:
        years = years_by_name.get(name) or set()
        o_id = resolve(name)
        if o_id is not None:
            matched += 1
        top.append({
            "name": name,
            "count": count,
            "first": min(years) if years else None,
            "last": max(years) if years else None,
            "o_id": o_id,
            "newspapers": [n for n, _ in newspapers_by_name[name].most_common(3)],
            "subjects": [s for s, _ in subjects_by_name[name].most_common(5)],
        })

    years_axis = sorted(year_total)
    prolific = sum(1 for c in counts.values() if c >= args.prolific_min)
    payload: Dict[str, Any] = {
        "metadata": create_metadata_block(
            total_records=len(df),
            signed_articles=signed_rows,
            unique_bylines=len(counts),
            top_n=args.top_n,
            top_matched_to_personnes=matched,
            prolific_min=args.prolific_min,
        ),
        "summary": {
            "articles": len(df),
            "signed": signed_rows,
            "pct_signed": round(100 * signed_rows / len(df), 1),
            "unique": len(counts),
            "prolific": prolific,
        },
        "by_year": {
            "years": years_axis,
            "total": [year_total[y] for y in years_axis],
            "signed": [year_signed.get(y, 0) for y in years_axis],
        },
        "top": top,
    }
    save_json(payload, Path(args.output), minify=args.minify)
    logger.info("Top %d bylines: %d matched to Personnes authorities",
                len(top), matched)


if __name__ == "__main__":
    main()
