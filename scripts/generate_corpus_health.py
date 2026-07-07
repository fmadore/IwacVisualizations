#!/usr/bin/env python3
"""
generate_corpus_health.py
=========================

Generate ``asset/data/corpus-health.json`` — curator-facing coverage
meters for the admin Sync Data page (ROADMAP 9.10). Answers "how far
along are the upstream enrichment pipelines?" so the curator can steer
priorities: ToC transcription for periodicals, geocoding for places,
sentiment / embedding coverage, date precision per subset.

Consumed server-side by the admin DataController (no public block, no
JS): the page reads the synced copy from
``files/iwac-visualizations/corpus-health.json`` after each data pull.
Metric labels are English-only by design — this is internal curator
tooling, and keeping labels in the data spares the PHP template a
translation catalog round-trip.

Usage
-----
    python scripts/generate_corpus_health.py
"""
from __future__ import annotations

import argparse
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from iwac_embeddings import coerce_embedding
from iwac_utils import (
    DATASET_ID,
    configure_logging,
    generate_timestamp,
    load_dataset_safe,
    parse_coordinates,
    save_json,
)

FULL_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _nonempty(series: pd.Series) -> int:
    return int(series.fillna("").astype(str).str.strip().ne("").sum())


def _full_dates(series: pd.Series) -> int:
    return int(series.fillna("").astype(str).str.match(FULL_DATE_RE).sum())


def _embeddings(series: pd.Series) -> int:
    count = 0
    for i in range(len(series)):
        if coerce_embedding(series.iat[i]) is not None:
            count += 1
    return count


def metric(label: str, covered: int, total: int) -> Dict[str, Any]:
    return {"label": label, "covered": int(covered), "total": int(total)}


def subset_health(name: str, repo_id: str) -> Optional[Dict[str, Any]]:
    logger = logging.getLogger(__name__)
    df = load_dataset_safe(name, repo_id=repo_id)
    if df is None:
        logger.warning(f"Skipping '{name}' — failed to load")
        return None
    n = len(df)
    metrics: List[Dict[str, Any]] = []

    def col(c: str) -> Optional[pd.Series]:
        return df[c] if c in df.columns else None

    if name == "articles":
        if col("OCR") is not None:
            metrics.append(metric("OCR text", _nonempty(df["OCR"]), n))
        if col("embedding_OCR") is not None:
            metrics.append(metric("Text embeddings", _embeddings(df["embedding_OCR"]), n))
        for prefix, label in (("gemini", "Sentiment — Gemini"),
                              ("chatgpt", "Sentiment — ChatGPT"),
                              ("mistral", "Sentiment — Mistral")):
            c = f"{prefix}_polarite"
            if col(c) is not None:
                metrics.append(metric(label, _nonempty(df[c]), n))
        if col("lda_topic_id") is not None:
            assigned = int(((df["lda_topic_id"].notna())
                            & (df["lda_topic_id"] != -1)).sum())
            metrics.append(metric("LDA topic assigned", assigned, n))
        if col("author") is not None:
            metrics.append(metric("Byline (author)", _nonempty(df["author"]), n))
        if col("spatial") is not None:
            metrics.append(metric("Spatial tags", _nonempty(df["spatial"]), n))
        if col("pub_date") is not None:
            metrics.append(metric("Full dates (YYYY-MM-DD)", _full_dates(df["pub_date"]), n))
    elif name == "publications":
        if col("OCR") is not None:
            metrics.append(metric("OCR text", _nonempty(df["OCR"]), n))
        if col("tableOfContents") is not None:
            metrics.append(metric("Table of contents", _nonempty(df["tableOfContents"]), n))
        if col("embedding_tableOfContents") is not None:
            metrics.append(metric("ToC embeddings",
                                  _embeddings(df["embedding_tableOfContents"]), n))
        if col("pub_date") is not None:
            metrics.append(metric("Full dates (YYYY-MM-DD)", _full_dates(df["pub_date"]), n))
    elif name == "index":
        types = df["Type"].fillna("").value_counts() if "Type" in df.columns else {}
        for t, c in types.items():
            if t:
                metrics.append(metric(f"Type: {t}", int(c), n))
        if "Type" in df.columns and "Coordonnées" in df.columns:
            lieux = df[df["Type"] == "Lieux"]
            geocoded = sum(
                1 for i in range(len(lieux))
                if parse_coordinates(lieux["Coordonnées"].iat[i]) is not None
            )
            metrics.append(metric("Lieux geocoded", geocoded, len(lieux)))
    elif name == "images":
        if col("embedding_image") is not None:
            metrics.append(metric("Multimodal embeddings", _embeddings(df["embedding_image"]), n))
        if col("coordinates") is not None:
            geocoded = sum(
                1 for i in range(n)
                if parse_coordinates(df["coordinates"].iat[i]) is not None
            )
            metrics.append(metric("Geocoded (coordinates)", geocoded, n))
        if col("subject") is not None:
            metrics.append(metric("Subject tags", _nonempty(df["subject"]), n))
        if col("pub_date") is not None:
            metrics.append(metric("Full dates (YYYY-MM-DD)", _full_dates(df["pub_date"]), n))
    else:
        if col("OCR") is not None:
            metrics.append(metric("OCR text", _nonempty(df["OCR"]), n))
        if col("doi") is not None:
            metrics.append(metric("DOI", _nonempty(df["doi"]), n))
        if col("pub_date") is not None:
            metrics.append(metric("Full dates (YYYY-MM-DD)", _full_dates(df["pub_date"]), n))

    logger.info(f"  {name}: {n} rows, {len(metrics)} metrics")
    return {"total": n, "metrics": metrics}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate curator-facing corpus coverage meters for the admin page."
    )
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repository ID (default: %(default)s)",
    )
    parser.add_argument(
        "--output-dir",
        default="asset/data",
        help="Where to write corpus-health.json (default: asset/data).",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Produce compact JSON (no indentation) (default: %(default)s)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    logger = logging.getLogger(__name__)

    subsets: Dict[str, Any] = {}
    for name in ("articles", "publications", "index", "documents",
                 "audiovisual", "references", "images"):
        health = subset_health(name, args.repo)
        if health is not None:
            subsets[name] = health

    bundle = {
        "generated_at": generate_timestamp(),
        "dataset": args.repo,
        "subsets": subsets,
    }
    save_json(bundle, Path(args.output_dir) / "corpus-health.json", minify=args.minify)
    logger.info("Corpus health generation complete")


if __name__ == "__main__":
    main()
