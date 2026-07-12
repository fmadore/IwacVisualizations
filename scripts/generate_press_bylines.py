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
    HF_TOKEN   Hugging Face access token — required, the default dataset is
               the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import logging
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Optional, Set

from iwac_utils import (
    add_standard_args,
    clean_str,
    create_metadata_block,
    extract_year,
    load_dataset_safe,
    normalize_location_name,
    parse_pipe_separated,
    parse_standard_args,
    save_json,
)

logger = logging.getLogger(__name__)


def build_personnes_lookup(repo_id: str) -> Dict[str, int]:
    """Normalized Personnes name (Titre + alternatives) -> authority o:id."""
    df = load_dataset_safe("index", repo_id=repo_id,
                           columns=["Type", "o:id", "Titre", "Titre alternatif"])
    if df is None or df.empty:
        raise RuntimeError("Could not load the index subset")
    lookup: Dict[str, int] = {}

    def col(name):
        return df[name] if name in df.columns else [None] * len(df)

    for type_raw, oid_raw, titre, alt_raw in zip(
            col("Type"), col("o:id"), col("Titre"), col("Titre alternatif")):
        if clean_str(type_raw) != "Personnes":
            continue
        try:
            o_id = int(oid_raw)
        except (TypeError, ValueError):
            continue
        names = [clean_str(titre)]
        names.extend(parse_pipe_separated(alt_raw))
        for name in names:
            key = normalize_location_name(name)
            if key:
                lookup.setdefault(key, o_id)
    logger.info("Personnes lookup: %d normalized names", len(lookup))
    return lookup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[2])
    parser.add_argument("--output", default="asset/data/press-bylines.json",
                        help="Output path (default: asset/data/press-bylines.json)")
    parser.add_argument("--top-n", type=int, default=25,
                        help="Bylines in the ranked list (default: 25)")
    parser.add_argument("--prolific-min", type=int, default=10,
                        help="Article threshold for the 'prolific' summary count (default: 10)")
    add_standard_args(parser)
    args = parse_standard_args(parser)

    logger.info("Loading articles subset...")
    df = load_dataset_safe("articles", repo_id=args.repo,
                           columns=["pub_date", "author", "newspaper", "subject"])
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

    def col(name):
        return df[name] if name in df.columns else [None] * len(df)

    for pub_date, author, newspaper_raw, subject in zip(
            col("pub_date"), col("author"), col("newspaper"), col("subject")):
        year = extract_year(pub_date)
        if year:
            year_total[year] += 1

        names = [" ".join(part.split())
                 for part in parse_pipe_separated(author)]
        names = [n for n in names if n]
        if not names:
            continue
        signed_rows += 1
        if year:
            year_signed[year] += 1

        newspaper = clean_str(newspaper_raw)
        subjects = parse_pipe_separated(subject)
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
            # Name tiebreaks so regenerated output stays order-stable.
            "newspapers": [n for n, _ in sorted(newspapers_by_name[name].items(),
                                                key=lambda kv: (-kv[1], kv[0]))[:3]],
            "subjects": [s for s, _ in sorted(subjects_by_name[name].items(),
                                              key=lambda kv: (-kv[1], kv[0]))[:5]],
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
