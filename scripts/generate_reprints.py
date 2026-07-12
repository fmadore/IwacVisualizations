#!/usr/bin/env python3
"""
generate_reprints.py
====================

Generate ``asset/data/press-reprints.json`` for the IwacVisualizations
"Press Reprints" page block (ROADMAP 9.9): near-duplicate article pairs
across DIFFERENT newspapers, surfaced via cosine similarity over the
articles' ``embedding_OCR`` vectors. High-similarity cross-outlet pairs
are syndicated wire copy (PANA / AFP dispatches), communiqués printed
verbatim by several papers, or straight reprints — a circulation signal
press historians cannot see one article at a time.

Method
------
1. L2-normalize all usable ``embedding_OCR`` vectors (float32).
2. Batched upper-triangle scan for pairs ≥ ``--scan-threshold`` (0.90) —
   kept deliberately below the publication threshold so the run logs a
   similarity histogram; the OCR is noisy and the right cut-off is an
   empirical question (the ROADMAP asked for prototyped thresholds, and
   the histogram in the build log is that prototype, re-run on every
   data refresh).
3. Publish pairs ≥ ``--threshold`` (default 0.97) whose two articles
   carry different newspaper names; cap at ``--max-pairs`` by
   similarity.
4. Aggregate the published pairs into a newspaper × newspaper link list
   for the block's circulation network panel.

Usage
-----
    python scripts/generate_reprints.py
    python scripts/generate_reprints.py --threshold 0.96 --max-pairs 800
"""
from __future__ import annotations

import argparse
import logging
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from iwac_embeddings import build_normalized_matrix, pairs_above_threshold
from iwac_utils import (
    add_standard_args,
    clean_str,
    generate_timestamp,
    load_dataset_safe,
    parse_standard_args,
    save_json,
)


def _day_gap(a: Optional[str], b: Optional[str]) -> Optional[int]:
    da = pd.to_datetime(a, errors="coerce")
    db = pd.to_datetime(b, errors="coerce")
    if pd.isna(da) or pd.isna(db):
        return None
    return abs(int((da - db).days))


def generate(
    repo_id: str,
    output_dir: Path,
    threshold: float,
    scan_threshold: float,
    max_pairs: int,
    minify: bool,
) -> None:
    logger = logging.getLogger(__name__)
    df = load_dataset_safe("articles", repo_id=repo_id)
    if df is None:
        raise RuntimeError("Failed to load 'articles' subset")
    if "embedding_OCR" not in df.columns:
        raise RuntimeError("'articles' subset is missing 'embedding_OCR'")

    X, valid = build_normalized_matrix(df, "embedding_OCR")
    logger.info(f"Normalized matrix: {X.shape[0]} × {X.shape[1] if X.ndim > 1 else 0}")
    if X.shape[0] == 0:
        raise RuntimeError("No usable embeddings")

    def row_meta(pos: int) -> Dict[str, Any]:
        r = df.iloc[pos]
        return {
            "o_id": clean_str(r.get("o:id")),
            "title": clean_str(r.get("title")),
            "newspaper": clean_str(r.get("newspaper")),
            "country": clean_str(r.get("country")),
            "date": clean_str(r.get("pub_date")),
        }

    # ------------------------------------------------------------------
    # Scan once at the LOWER threshold; histogram + publishable pairs
    # fall out of the same pass.
    # ------------------------------------------------------------------
    hist_edges = [0.90, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99]
    hist_all: Counter = Counter()
    hist_cross: Counter = Counter()
    candidates: List[Dict[str, Any]] = []

    scanned = 0
    for i, j, sim in pairs_above_threshold(X, scan_threshold):
        scanned += 1
        bucket = max(e for e in hist_edges if sim >= e)
        hist_all[bucket] += 1
        a = row_meta(valid[i])
        b = row_meta(valid[j])
        cross = bool(a["newspaper"] and b["newspaper"]
                     and a["newspaper"] != b["newspaper"])
        if cross:
            hist_cross[bucket] += 1
        if cross and sim >= threshold:
            candidates.append({
                "similarity": round(sim, 4),
                "day_gap": _day_gap(a["date"], b["date"]),
                "a": a,
                "b": b,
            })

    logger.info(f"Scan ≥ {scan_threshold}: {scanned} pairs total")
    logger.info("Similarity histogram (all / cross-newspaper):")
    for e in hist_edges:
        logger.info(f"  ≥ {e:.2f}: {hist_all[e]:6d} / {hist_cross[e]:6d}")

    candidates.sort(key=lambda p: -p["similarity"])
    truncated = len(candidates) > max_pairs
    published = candidates[:max_pairs]
    if truncated:
        logger.warning(
            f"{len(candidates)} cross-newspaper pairs ≥ {threshold} — "
            f"publishing the top {max_pairs} by similarity")

    # ------------------------------------------------------------------
    # Newspaper circulation network from the published pairs.
    # ------------------------------------------------------------------
    link_counts: Dict[frozenset, int] = defaultdict(int)
    paper_counts: Counter = Counter()
    paper_country: Dict[str, Counter] = defaultdict(Counter)
    for p in published:
        pa, pb = p["a"]["newspaper"], p["b"]["newspaper"]
        link_counts[frozenset((pa, pb))] += 1
        paper_counts[pa] += 1
        paper_counts[pb] += 1
        if p["a"]["country"]:
            paper_country[pa][p["a"]["country"]] += 1
        if p["b"]["country"]:
            paper_country[pb][p["b"]["country"]] += 1

    links = []
    for pair, count in sorted(link_counts.items(),
                              key=lambda kv: (-kv[1], sorted(kv[0]))):
        a, b = sorted(pair)
        links.append([a, b, count])

    gaps = [p["day_gap"] for p in published if p["day_gap"] is not None]
    gaps.sort()
    median_gap = gaps[len(gaps) // 2] if gaps else None

    bundle = {
        "generated_at": generate_timestamp(),
        "threshold": threshold,
        "scan_threshold": scan_threshold,
        "max_pairs": max_pairs,
        "truncated": truncated,
        "stats": {
            "articles_with_embeddings": int(X.shape[0]),
            "cross_newspaper_pairs": len(candidates),
            "published_pairs": len(published),
            "newspapers_involved": len(paper_counts),
            "median_day_gap": median_gap,
        },
        "histogram": {
            str(e): {"all": int(hist_all[e]), "cross": int(hist_cross[e])}
            for e in hist_edges
        },
        # (-count, name) ordering + name tiebreak on the dominant country
        # so regenerated output stays order-stable under count ties.
        "newspapers": [
            {
                "name": n,
                "pairs": int(c),
                "country": (min(paper_country[n].items(),
                                key=lambda kv: (-kv[1], kv[0]))[0]
                            if paper_country[n] else None),
            }
            for n, c in sorted(paper_counts.items(),
                               key=lambda kv: (-kv[1], kv[0]))
        ],
        "links": links,
        "pairs": published,
    }
    save_json(bundle, output_dir / "press-reprints.json", minify=minify)
    logger.info("Press reprints data generation complete")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Detect near-duplicate cross-newspaper article pairs (wire copy / reprints)."
    )
    parser.add_argument(
        "--output-dir",
        default="asset/data",
        help="Where to write press-reprints.json (default: asset/data).",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.97,
        help="Publication cosine threshold (default: %(default)s).",
    )
    parser.add_argument(
        "--scan-threshold",
        type=float,
        default=0.90,
        help="Histogram scan floor — must be ≤ --threshold (default: %(default)s).",
    )
    parser.add_argument(
        "--max-pairs",
        type=int,
        default=500,
        help="Cap on published pairs, by similarity (default: %(default)s).",
    )
    add_standard_args(parser)
    args = parse_standard_args(parser)
    if args.scan_threshold > args.threshold:
        parser.error("--scan-threshold must be ≤ --threshold")
    generate(
        repo_id=args.repo,
        output_dir=Path(args.output_dir),
        threshold=args.threshold,
        scan_threshold=args.scan_threshold,
        max_pairs=args.max_pairs,
        minify=args.minify,
    )


if __name__ == "__main__":
    main()
