"""Generate the Periodicals Semantic Landscape bundle — a 2-D UMAP
projection of every Islamic-periodical issue's
``embedding_tableOfContents`` (768-dim Gemini vectors). This is the
``publications``-subset counterpart to the article ``semantic-landscape``:
nearby points are issues whose table of contents is semantically similar,
so clusters read as thematic neighbourhoods of the periodical corpus.

Output: ``asset/data/periodicals-landscape.json`` (one columnar bundle):

    {
      "metadata":  {...},
      "countries": ["Bénin", ...],            # palette/legend order
      "points": {
        "o_id":    [...],                     # Omeka item ids (ints)
        "x":       [...], "y": [...],         # UMAP coords, 2 decimals
        "title":   [...],                     # truncated for tooltips
        "country": [...],                     # index into `countries`
        "year":    [...]                      # int or null
      }
    }

Unlike the article landscape there is **no** topic facet: the
``publications`` subset carries no LDA topics, so points are coloured by
country or decade only. The bundle deliberately omits a ``topics`` key;
the shared ``semantic-landscape.js`` orchestrator degrades to the
country/decade facets when it is absent.

The projection uses UMAP with a cosine metric (semantic embeddings →
angular distance) and a fixed ``random_state`` so regenerations are
reproducible. ~1.5k × 768 projects in well under a minute on CPU.

Issues without a usable embedding are dropped (they have no position in
the landscape); the count is logged and recorded in metadata.

Usage
-----
    python scripts/generate_periodicals_landscape.py --minify
    python scripts/generate_periodicals_landscape.py --n-neighbors 30 -v
"""
from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from iwac_utils import (
    DATASET_ID,
    canonicalize_country_field,
    clean_str,
    configure_logging,
    create_metadata_block,
    extract_year,
    find_column,
    load_dataset_safe,
    save_json,
)

logger = logging.getLogger("generate_periodicals_landscape")

SUBSET = "publications"
DEFAULT_TITLE_LEN = 60


def coerce_embedding(value: Any) -> Optional[np.ndarray]:
    """Raw embedding cell → float32 vector, or None when unusable.
    Same rules as the article/publication dashboard generators."""
    if value is None:
        return None
    if isinstance(value, np.ndarray):
        if value.size == 0 or not np.isfinite(value).all():
            return None
        return value.astype(np.float32, copy=False)
    if isinstance(value, (list, tuple)):
        if not value:
            return None
        try:
            arr = np.asarray(value, dtype=np.float32)
        except (TypeError, ValueError):
            return None
        if arr.size == 0 or not np.isfinite(arr).all():
            return None
        return arr
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default="asset/data/periodicals-landscape.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument("--repo", default=DATASET_ID,
                        help="Hugging Face dataset repo id (default: %(default)s)")
    parser.add_argument("--n-neighbors", type=int, default=15,
                        help="UMAP n_neighbors (default: %(default)s)")
    parser.add_argument("--min-dist", type=float, default=0.1,
                        help="UMAP min_dist (default: %(default)s)")
    parser.add_argument("--max-title-len", type=int, default=DEFAULT_TITLE_LEN,
                        help="Tooltip title truncation (default: %(default)s)")
    parser.add_argument("--minify", action=argparse.BooleanOptionalAction, default=True,
                        help="Minify the JSON output (default: %(default)s)")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Set log level to DEBUG")
    args = parser.parse_args()

    global logger
    logger = configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    # Import here so `--help` works without the dependency installed.
    try:
        import umap  # type: ignore
    except ImportError:
        logger.error("umap-learn is not installed — pip install umap-learn")
        return 2

    logger.info("Loading publications subset (includes embedding_tableOfContents)...")
    df = load_dataset_safe(SUBSET, repo_id=args.repo)
    if df is None or df.empty:
        raise RuntimeError("publications subset returned empty — aborting")
    logger.info(f"  {len(df)} issues")

    id_col      = find_column(df, ["o:id", "id"])
    title_col   = find_column(df, ["title", "dcterms:title"])
    country_col = find_column(df, ["country", "countries"])
    date_col    = find_column(df, ["pub_date", "dcterms:date"])
    embed_col   = find_column(df, ["embedding_tableOfContents", "embedding"])
    if not (id_col and embed_col):
        raise RuntimeError("publications subset missing o:id or embedding_tableOfContents")

    # ------------------------------------------------------------------
    # Collect usable rows
    # ------------------------------------------------------------------
    vectors: List[np.ndarray] = []
    rows: List[Dict[str, Any]] = []
    dim: Optional[int] = None
    dropped = 0

    for _, row in df.iterrows():
        vec = coerce_embedding(row.get(embed_col))
        if vec is None or (dim is not None and len(vec) != dim):
            dropped += 1
            continue
        if dim is None:
            dim = len(vec)
        try:
            o_id = int(row.get(id_col))
        except (TypeError, ValueError):
            dropped += 1
            continue

        title = clean_str(row.get(title_col)) if title_col else ""
        if len(title) > args.max_title_len:
            title = title[: args.max_title_len - 1].rstrip() + "…"

        vectors.append(vec)
        rows.append({
            "o_id":    o_id,
            "title":   title,
            "country": canonicalize_country_field(row.get(country_col)) if country_col else "",
            "year":    extract_year(clean_str(row.get(date_col))) if date_col else None,
        })

    if not vectors:
        raise RuntimeError("no usable embeddings found")
    logger.info(f"  {len(vectors)} issues with embeddings ({dropped} dropped)")

    X = np.vstack(vectors)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    X = X / np.where(norms == 0.0, 1.0, norms)

    # ------------------------------------------------------------------
    # UMAP
    # ------------------------------------------------------------------
    logger.info(
        f"Running UMAP (n_neighbors={args.n_neighbors}, "
        f"min_dist={args.min_dist}, metric=cosine)..."
    )
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=args.n_neighbors,
        min_dist=args.min_dist,
        metric="cosine",
        random_state=42,
        verbose=args.verbose,
    )
    coords = reducer.fit_transform(X)
    logger.info("  projection done")

    # ------------------------------------------------------------------
    # Categorical index table (columnar output) + points
    # ------------------------------------------------------------------
    country_names = sorted(
        {r["country"] for r in rows if r["country"]},
        key=lambda c: c.lower(),
    )
    country_index = {name: i for i, name in enumerate(country_names)}

    points: Dict[str, List[Any]] = {
        "o_id": [], "x": [], "y": [], "title": [], "country": [], "year": [],
    }
    for i, r in enumerate(rows):
        points["o_id"].append(r["o_id"])
        points["x"].append(round(float(coords[i, 0]), 2))
        points["y"].append(round(float(coords[i, 1]), 2))
        points["title"].append(r["title"])
        points["country"].append(country_index.get(r["country"], -1))
        points["year"].append(r["year"])

    payload = {
        "metadata": create_metadata_block(
            total_records=len(rows),
            dropped_no_embedding=dropped,
            embedding="embedding_tableOfContents",
            umap={
                "n_neighbors": args.n_neighbors,
                "min_dist": args.min_dist,
                "metric": "cosine",
                "random_state": 42,
            },
        ),
        "countries": country_names,
        "points": points,
    }

    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = Path(__file__).resolve().parent.parent / output_path
    save_json(payload, output_path, minify=args.minify)
    logger.info("Periodicals landscape written to %s", output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
