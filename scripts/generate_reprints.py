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
The vectors are ``google/embeddinggemma-2`` (since 2026-10-13). Both
thresholds below come from upstream's calibration of that space against
lexical overlap on held-out article pairs (IWAC-Hugging-Face
``docs/research-validation.md``), not from the Gemini-era build logs the
first version of this block was tuned on.

1. L2-normalize all usable ``embedding_OCR`` vectors (float32).
2. Batched upper-triangle scan for pairs ≥ ``--scan-threshold`` (0.91,
   the recall-oriented prefilter: it passes 97.6 % of held-out lexical
   duplicates). The run logs a similarity histogram from the same pass,
   so the cut-offs stay checkable on every data refresh.
3. Keep the cross-newspaper pairs that pass **either** test:

   * ``semantic`` — cosine ≥ ``--threshold`` (0.97; 94 % lexically
     confirmed on held-out pairs, recall 68 %), or
   * ``lexical`` — cosine ≥ the prefilter **and** word-trigram Jaccard ≥
     ``--min-jaccard`` (0.45) over the two OCR texts, mirroring upstream's
     ``analyses/reprint_candidates.py``. This recovers the reprints the
     cosine cut-off alone misses — typically a dispatch one paper
     shortened or retitled.

   Every published pair carries its ``lexical_jaccard`` (null when either
   text is missing), so a reader can tell shared wording from shared
   subject matter. Cap at ``--max-pairs`` by similarity.
4. Aggregate the published pairs into a newspaper × newspaper link list
   for the block's circulation network panel.

The private mirror is read, so the lexical check sees every article's OCR,
including the ones whose text islam.zmo.de does not publish; the pair table
shows only titles and scores, never the text.

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

import numpy as np

from iwac_embeddings import (
    EMBEDDING_MODEL,
    build_normalized_matrix,
    pairs_above_threshold,
    shingle_jaccard,
    word_shingles,
)
from iwac_utils import (
    canonicalize_country_field,
    add_standard_args,
    clean_str,
    dominant,
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
    min_jaccard: float,
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

    # Newspaper names up front: the scan visits every pair above the
    # prefilter, and in this space that is far more than it publishes, so
    # a DataFrame lookup per pair would dominate the run.
    if "newspaper" in df.columns:
        papers = [clean_str(v) for v in df["newspaper"]]
    else:
        papers = [""] * len(df)
    ocr = df["OCR"] if "OCR" in df.columns else None
    if ocr is None:
        logger.warning("articles subset has no OCR — lexical confirmation "
                       "skipped, publishing on cosine alone")
    shingle_cache: Dict[int, np.ndarray] = {}

    def shingles(pos: int) -> np.ndarray:
        if pos not in shingle_cache:
            shingle_cache[pos] = (word_shingles(ocr.iat[pos]) if ocr is not None
                                  else np.empty(0, dtype=np.uint32))
        return shingle_cache[pos]

    def row_meta(pos: int) -> Dict[str, Any]:
        r = df.iloc[pos]
        return {
            "o_id": clean_str(r.get("o:id")),
            "title": clean_str(r.get("title")),
            "newspaper": clean_str(r.get("newspaper")),
            # Canonicalised so the dominant-country tiebreak below cannot
            # split one paper's country across two spellings (P16).
            "country": canonicalize_country_field(clean_str(r.get("country"))),
            "date": clean_str(r.get("pub_date")),
        }

    # ------------------------------------------------------------------
    # Scan once at the LOWER threshold; histogram + publishable pairs
    # fall out of the same pass.
    # ------------------------------------------------------------------
    # Bins start at the scan floor, whatever it is, so nothing scanned
    # falls below the first edge.
    hist_edges = sorted({scan_threshold, *(
        e for e in (0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99)
        if e > scan_threshold)})
    hist_all: Counter = Counter()
    hist_cross: Counter = Counter()
    hist_lexical: Counter = Counter()
    candidates: List[Dict[str, Any]] = []
    by_test: Counter = Counter()

    scanned = 0
    for i, j, sim in pairs_above_threshold(X, scan_threshold):
        scanned += 1
        bucket = max(e for e in hist_edges if sim >= e)
        hist_all[bucket] += 1
        pa, pb = papers[valid[i]], papers[valid[j]]
        if not (pa and pb and pa != pb):
            continue
        hist_cross[bucket] += 1

        sa, sb = shingles(valid[i]), shingles(valid[j])
        jaccard = shingle_jaccard(sa, sb) if sa.size and sb.size else None
        lexical = jaccard is not None and jaccard >= min_jaccard
        if lexical:
            hist_lexical[bucket] += 1
        if sim < threshold and not lexical:
            continue
        test = "semantic" if sim >= threshold else "lexical"
        by_test[test] += 1
        a = row_meta(valid[i])
        b = row_meta(valid[j])
        candidates.append({
            "similarity": round(sim, 4),
            "lexical_jaccard": round(jaccard, 4) if jaccard is not None else None,
            "test": test,
            "day_gap": _day_gap(a["date"], b["date"]),
            "a": a,
            "b": b,
        })

    logger.info(f"Scan ≥ {scan_threshold}: {scanned} pairs total")
    logger.info("Similarity histogram (all / cross-newspaper / "
                f"cross with trigram Jaccard ≥ {min_jaccard}):")
    for e in hist_edges:
        logger.info(f"  ≥ {e:.2f}: {hist_all[e]:7d} / {hist_cross[e]:7d} / "
                    f"{hist_lexical[e]:6d}")
    logger.info(f"Kept {len(candidates)} cross-newspaper pairs: "
                f"{by_test['semantic']} by cosine ≥ {threshold}, "
                f"{by_test['lexical']} more by shared wording")
    checked = [p for p in candidates
               if p["test"] == "semantic" and p["lexical_jaccard"] is not None]
    if checked:
        confirmed = sum(1 for p in checked if p["lexical_jaccard"] >= min_jaccard)
        logger.info(f"  of the cosine-only pairs with both texts, {confirmed}/"
                    f"{len(checked)} also share wording (Jaccard ≥ {min_jaccard})")

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
        "embedding_model": EMBEDDING_MODEL,
        "threshold": threshold,
        "scan_threshold": scan_threshold,
        "min_jaccard": min_jaccard if ocr is not None else None,
        "max_pairs": max_pairs,
        "truncated": truncated,
        "stats": {
            "articles_with_embeddings": int(X.shape[0]),
            "cross_newspaper_pairs": len(candidates),
            "semantic_pairs": int(by_test["semantic"]),
            "lexical_pairs": int(by_test["lexical"]),
            "published_pairs": len(published),
            "newspapers_involved": len(paper_counts),
            "median_day_gap": median_gap,
        },
        "histogram": {
            str(e): {"all": int(hist_all[e]), "cross": int(hist_cross[e]),
                     "cross_lexical": int(hist_lexical[e])}
            for e in hist_edges
        },
        # (-count, name) ordering + name tiebreak on the dominant country
        # so regenerated output stays order-stable under count ties.
        "newspapers": [
            {
                "name": n,
                "pairs": int(c),
                "country": dominant(paper_country[n]),
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
        default=0.91,
        help="Cosine prefilter and histogram floor — must be ≤ --threshold "
             "(default: %(default)s).",
    )
    parser.add_argument(
        "--min-jaccard",
        type=float,
        default=0.45,
        help="Word-trigram Jaccard that publishes a pair below --threshold "
             "(default: %(default)s).",
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
        min_jaccard=args.min_jaccard,
        max_pairs=args.max_pairs,
        minify=args.minify,
    )


if __name__ == "__main__":
    main()
