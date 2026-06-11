"""Generate the Semantic Landscape bundle — a 2-D UMAP projection of
every article's ``embedding_OCR`` (768-dim Gemini vectors), the "map of
everything" for the IWAC press corpus.

Output: ``asset/data/semantic-landscape.json`` (one bundle, columnar to
keep 12k points compact):

    {
      "metadata":  {...},
      "countries": ["Bénin", ...],            # palette/legend order
      "topics":    [{"id": 4, "label": "..."}, ...],  # top-N + Other
      "points": {
        "o_id":    [...],                     # Omeka item ids (ints)
        "x":       [...], "y": [...],         # UMAP coords, 2 decimals
        "title":   [...],                     # truncated for tooltips
        "country": [...],                     # index into `countries`
        "year":    [...],                     # int or null
        "topic":   [...]                      # index into `topics`,
                                              #   -1 = outlier/other
      }
    }

The projection is computed with UMAP (cosine metric — the vectors are
semantic embeddings, so angular distance is the meaningful one) with a
fixed ``random_state`` so regenerations are reproducible. CPU-only is
fine: ~12k × 768 takes a couple of minutes.

Articles without a usable embedding are dropped (they have no position
in the landscape); the count is logged and recorded in metadata.

Usage
-----
    python scripts/generate_semantic_landscape.py --minify
    python scripts/generate_semantic_landscape.py --n-neighbors 30 -v
"""
from __future__ import annotations

import argparse
import logging
from collections import Counter
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

logger = logging.getLogger("generate_semantic_landscape")

# Top-N LDA topics get their own legend entry / colour; the long tail
# plus the -1 outliers fold into "Other" so the topic facet stays
# readable (30 topic colours is a legend nobody can use).
DEFAULT_TOP_TOPICS = 12
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
        default="asset/data/semantic-landscape.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument("--repo", default=DATASET_ID,
                        help="Hugging Face dataset repo id (default: %(default)s)")
    parser.add_argument("--n-neighbors", type=int, default=15,
                        help="UMAP n_neighbors (default: %(default)s)")
    parser.add_argument("--min-dist", type=float, default=0.1,
                        help="UMAP min_dist (default: %(default)s)")
    parser.add_argument("--top-topics", type=int, default=DEFAULT_TOP_TOPICS,
                        help="Topics with their own legend entry (default: %(default)s)")
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

    logger.info("Loading articles subset (includes embedding_OCR)...")
    df = load_dataset_safe("articles", repo_id=args.repo)
    if df is None or df.empty:
        raise RuntimeError("articles subset returned empty — aborting")
    logger.info(f"  {len(df)} articles")

    id_col      = find_column(df, ["o:id", "id"])
    title_col   = find_column(df, ["title", "dcterms:title"])
    country_col = find_column(df, ["country", "countries"])
    date_col    = find_column(df, ["pub_date", "dcterms:date"])
    embed_col   = find_column(df, ["embedding_OCR", "embedding"])
    topic_id_col    = find_column(df, ["lda_topic_id"])
    topic_label_col = find_column(df, ["lda_topic_label"])
    if not (id_col and embed_col):
        raise RuntimeError("articles subset missing o:id or embedding_OCR")

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

        topic_id = None
        if topic_id_col is not None:
            raw_topic = row.get(topic_id_col)
            try:
                topic_id = int(raw_topic)
            except (TypeError, ValueError):
                topic_id = None
            if topic_id is not None and topic_id < 0:
                topic_id = None  # -1 = LDA outlier

        vectors.append(vec)
        rows.append({
            "o_id":        o_id,
            "title":       title,
            "country":     canonicalize_country_field(row.get(country_col)) if country_col else "",
            "year":        extract_year(clean_str(row.get(date_col))) if date_col else None,
            "topic_id":    topic_id,
            "topic_label": clean_str(row.get(topic_label_col)) if topic_label_col else "",
        })

    if not vectors:
        raise RuntimeError("no usable embeddings found")
    logger.info(f"  {len(vectors)} articles with embeddings ({dropped} dropped)")

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
    # Categorical index tables (columnar output)
    # ------------------------------------------------------------------
    country_names = sorted(
        {r["country"] for r in rows if r["country"]},
        key=lambda c: c.lower(),
    )
    country_index = {name: i for i, name in enumerate(country_names)}

    topic_counts = Counter(
        r["topic_id"] for r in rows if r["topic_id"] is not None
    )
    top_topic_ids = [t for t, _ in topic_counts.most_common(args.top_topics)]
    topic_label_by_id = {}
    for r in rows:
        if r["topic_id"] in top_topic_ids and r["topic_id"] not in topic_label_by_id:
            topic_label_by_id[r["topic_id"]] = r["topic_label"] or f"Topic {r['topic_id']}"
    topics = [{"id": t, "label": topic_label_by_id.get(t, f"Topic {t}")}
              for t in top_topic_ids]
    topic_index = {t: i for i, t in enumerate(top_topic_ids)}

    points: Dict[str, List[Any]] = {
        "o_id": [], "x": [], "y": [], "title": [],
        "country": [], "year": [], "topic": [],
    }
    for i, r in enumerate(rows):
        points["o_id"].append(r["o_id"])
        points["x"].append(round(float(coords[i, 0]), 2))
        points["y"].append(round(float(coords[i, 1]), 2))
        points["title"].append(r["title"])
        points["country"].append(country_index.get(r["country"], -1))
        points["year"].append(r["year"])
        points["topic"].append(topic_index.get(r["topic_id"], -1))

    payload = {
        "metadata": create_metadata_block(
            total_records=len(rows),
            dropped_no_embedding=dropped,
            umap={
                "n_neighbors": args.n_neighbors,
                "min_dist": args.min_dist,
                "metric": "cosine",
                "random_state": 42,
            },
        ),
        "countries": country_names,
        "topics": topics,
        "points": points,
    }

    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = Path(__file__).resolve().parent.parent / output_path
    save_json(payload, output_path, minify=args.minify)
    logger.info("Semantic landscape written to %s", output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
