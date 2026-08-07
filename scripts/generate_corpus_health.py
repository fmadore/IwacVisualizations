#!/usr/bin/env python3
"""
generate_corpus_health.py
=========================

Generate ``asset/data/corpus-health.json`` — curator-facing coverage
meters for the admin Sync Data page (ROADMAP 9.10). Answers "how far
along are the upstream enrichment pipelines?" so the curator can steer
priorities: ToC transcription for periodicals, geocoding for places,
sentiment / embedding coverage, date precision per subset.

One meter answers a different question and is labelled accordingly:
**"Text public on islam.zmo.de"** (from ``OCR_is_public``) is not pipeline
progress. The text exists regardless, and these generators read the
private full mirror, so the module's visualisations already cover all of
it — what this meter tracks is how much of the same text the *public*
Hugging Face projection carries, i.e. what an outside researcher can
reproduce from the citable dataset. It moves when rights are cleared on
Omeka, not when a script is re-run.

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
    add_standard_args,
    generate_timestamp,
    load_dataset_safe,
    parse_coordinates,
    parse_standard_args,
    resolve_sentiment_columns,
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


def _lemmas(series: pd.Series) -> int:
    return _nonempty(series)


def metric(label: str, covered: int, total: int) -> Dict[str, Any]:
    return {"label": label, "covered": int(covered), "total": int(total)}


def _enrichment_metrics(df: pd.DataFrame, n: int, text_label: str) -> List[Dict[str, Any]]:
    """Text-pipeline meters shared by every full-text subset.

    ``text_label`` names what the ``OCR`` column actually holds for this
    subset — page OCR for the print material, transcription for
    audiovisual. Calling both "OCR text" on a curator-facing page would
    misdescribe the audiovisual pipeline, which is a different (and
    differently expensive) job to chase.
    """
    metrics: List[Dict[str, Any]] = []
    if "OCR" in df.columns:
        metrics.append(metric(text_label, _nonempty(df["OCR"]), n))
    if "lemma_nostop" in df.columns:
        metrics.append(metric("Lemmatised", _lemmas(df["lemma_nostop"]), n))
    return metrics


def _publication_metric(df: pd.DataFrame, n: int) -> List[Dict[str, Any]]:
    """`OCR_is_public` — how much of this subset's text islam.zmo.de shows.

    Unlike every other meter here this is NOT pipeline progress: the text
    exists either way, and these generators read the private full mirror,
    so every visualisation in the module already covers all of it. What
    this measures is how much of the same text the public Hugging Face
    projection carries, i.e. what an outside researcher can reproduce from
    the citable dataset. Worth a meter precisely because it is invisible
    from inside the admin — and because it moves when rights are cleared
    on Omeka, not when a script is re-run.
    """
    if "OCR_is_public" not in df.columns:
        return []
    public = int(df["OCR_is_public"].fillna(False).astype(bool).sum())
    return [metric("Text public on islam.zmo.de", public, n)]


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
        metrics.extend(_enrichment_metrics(df, n, "OCR text"))
        if col("embedding_OCR") is not None:
            metrics.append(metric("Text embeddings", _embeddings(df["embedding_OCR"]), n))
        # Labels name the exact model that produced the annotation, which
        # is also what the HF columns and the model ids key on.
        sentiment_cols = resolve_sentiment_columns(df)
        for model, label in (("gpt_5_6_luna", "Sentiment — GPT-5.6 Luna"),
                             ("mistral_small_2603", "Sentiment — Mistral Small 4"),
                             ("deepseek_v4_flash_0731", "Sentiment — DeepSeek V4 Flash")):
            c = sentiment_cols[model]["polarite"]
            if c is not None:
                metrics.append(metric(label, _nonempty(df[c]), n))
        if col("lda_topic_id") is not None:
            assigned = int(((df["lda_topic_id"].notna())
                            & (df["lda_topic_id"] != -1)).sum())
            metrics.append(metric("LDA topic assigned", assigned, n))
        if col("lda_topic_topk") is not None:
            # The top-k distribution is what the probability-weighted
            # prevalence view needs; it can lag the dominant-topic columns
            # if only part of the LDA re-run has been pushed.
            metrics.append(metric("LDA top-k distribution",
                                  _nonempty(df["lda_topic_topk"]), n))
        if col("author") is not None:
            metrics.append(metric("Byline (author)", _nonempty(df["author"]), n))
        if col("spatial") is not None:
            metrics.append(metric("Spatial tags", _nonempty(df["spatial"]), n))
        if col("pub_date") is not None:
            metrics.append(metric("Full dates (YYYY-MM-DD)", _full_dates(df["pub_date"]), n))
        metrics.extend(_publication_metric(df, n))
    elif name == "references":
        # Since 2026-07 the bibliography carries full text, its own
        # embeddings and its own (two-model) LDA run — the same enrichment
        # ladder as articles, and worth steering with the same meters.
        metrics.extend(_enrichment_metrics(df, n, "Full text"))
        if col("embedding_OCR") is not None:
            metrics.append(metric("Text embeddings", _embeddings(df["embedding_OCR"]), n))
        if col("lda_topic_id") is not None:
            assigned = int(((df["lda_topic_id"].notna())
                            & (df["lda_topic_id"] != -1)).sum())
            metrics.append(metric("LDA topic assigned", assigned, n))
        if col("abstract") is not None:
            metrics.append(metric("Abstract", _nonempty(df["abstract"]), n))
        if col("doi") is not None:
            metrics.append(metric("DOI", _nonempty(df["doi"]), n))
        if col("pub_date") is not None:
            metrics.append(metric("Full dates (YYYY-MM-DD)", _full_dates(df["pub_date"]), n))
        metrics.extend(_publication_metric(df, n))
    elif name == "audiovisual":
        # `OCR` here is a transcription, not page OCR — a different
        # pipeline with different costs, so it gets its own label.
        metrics.extend(_enrichment_metrics(df, n, "Transcription"))
        if col("medium") is not None:
            metrics.append(metric("Medium", _nonempty(df["medium"]), n))
        if col("spatial") is not None:
            metrics.append(metric("Spatial tags", _nonempty(df["spatial"]), n))
        if col("pub_date") is not None:
            metrics.append(metric("Full dates (YYYY-MM-DD)", _full_dates(df["pub_date"]), n))
        metrics.extend(_publication_metric(df, n))
    elif name == "publications":
        metrics.extend(_enrichment_metrics(df, n, "OCR text"))
        if col("tableOfContents") is not None:
            metrics.append(metric("Table of contents", _nonempty(df["tableOfContents"]), n))
        if col("embedding_tableOfContents") is not None:
            metrics.append(metric("ToC embeddings",
                                  _embeddings(df["embedding_tableOfContents"]), n))
        if col("pub_date") is not None:
            metrics.append(metric("Full dates (YYYY-MM-DD)", _full_dates(df["pub_date"]), n))
        metrics.extend(_publication_metric(df, n))
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
        # documents, and any subset added upstream before it gets a branch
        # here — keep the generic ladder so a new subset still reports.
        metrics.extend(_enrichment_metrics(df, n, "OCR text"))
        if col("doi") is not None:
            metrics.append(metric("DOI", _nonempty(df["doi"]), n))
        if col("pub_date") is not None:
            metrics.append(metric("Full dates (YYYY-MM-DD)", _full_dates(df["pub_date"]), n))
        metrics.extend(_publication_metric(df, n))

    logger.info(f"  {name}: {n} rows, {len(metrics)} metrics")
    return {"total": n, "metrics": metrics}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate curator-facing corpus coverage meters for the admin page."
    )
    parser.add_argument(
        "--output-dir",
        default="asset/data",
        help="Where to write corpus-health.json (default: asset/data).",
    )
    add_standard_args(parser)
    args = parse_standard_args(parser)
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
