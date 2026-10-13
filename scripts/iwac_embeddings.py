#!/usr/bin/env python3
"""
IWAC Shared Embedding Utilities
================================

Shared kNN / similarity helpers over the dataset's 768-dim
``google/embeddinggemma-2`` vectors (float32, run upstream from a pinned
ONNX export and averaged over chunks). They replaced the
``gemini-embedding-2`` vectors in place on 2026-10-13: the two are
different spaces, so nothing computed on one may be mixed with the other,
and every projection and threshold here was re-derived for the new one.

What each subset embeds (``EMBEDDING_COLUMNS``):

- ``articles`` / ``documents`` — ``embedding_OCR``, title + full text
- ``references``               — ``embedding_abstract``, title + abstract
                                 (only the works that have an abstract;
                                 the old ``embedding_OCR`` is gone)
- ``publications``             — ``embedding_tableOfContents``
- ``images``                   — ``embedding_image``, the photograph

All five live in the one space, so a cross-subset dot product is
meaningful. Cosines run high in it — the median nearest-neighbour score on
articles is about 0.91 — so a raw score reads as "very similar" almost
everywhere; rank within a list, never the percentage, is what a reader
can use.

Extracted per REFACTORING.md Tier 4 —
the coerce → normalize → batched-cosine stack was copy-pasted across
``generate_article_dashboards.py``, ``generate_publication_dashboards.py``,
``generate_semantic_landscape.py`` and ``generate_periodicals_landscape.py``;
new embedding consumers (first: ``generate_reprints.py``) should import
from here, and the four existing generators can migrate opportunistically
(their outputs are verified byte-stable, so migrate one at a time with a
diff check).

Functions
---------
- coerce_embedding:        raw cell → float32 vector or None
- build_normalized_matrix: DataFrame column → (unit-L2 float32 matrix,
                           list of source row positions)
- top_k_cosine:            batched top-k neighbour indices + scores
- pairs_above_threshold:   batched (i, j, sim) pairs with sim ≥ threshold
- word_shingles / shingle_jaccard: lexical overlap of two texts, the
                           confirmation step for near-duplicates
"""
from __future__ import annotations

import logging
import re
import zlib
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd


EMBEDDING_MODEL = "google/embeddinggemma-2"

# Subset → the column holding its vector. References embed their abstract,
# not their full text: a generator that reads `embedding_OCR` there finds no
# column and silently degrades, which is how this map came to exist.
EMBEDDING_COLUMNS: Dict[str, str] = {
    "articles":     "embedding_OCR",
    "documents":    "embedding_OCR",
    "references":   "embedding_abstract",
    "publications": "embedding_tableOfContents",
    "images":       "embedding_image",
}


def coerce_embedding(value: Any) -> Optional[np.ndarray]:
    """Raw embedding cell → float32 vector, or None when unusable.

    Same rules as the article / publication dashboard generators: empty,
    non-numeric, or non-finite cells are rejected rather than patched.
    """
    if value is None:
        return None
    if isinstance(value, np.ndarray):
        if value.ndim != 1 or value.size == 0 or not np.isfinite(value).all():
            return None
        return value.astype(np.float32, copy=False)
    if isinstance(value, (list, tuple)):
        if not value:
            return None
        try:
            arr = np.asarray(value, dtype=np.float32)
        except (TypeError, ValueError):
            return None
        if arr.ndim != 1 or arr.size == 0 or not np.isfinite(arr).all():
            return None
        return arr
    return None


def build_normalized_matrix(
    df: pd.DataFrame,
    embed_col: str,
) -> Tuple[np.ndarray, List[int]]:
    """Collect the usable embeddings of ``df[embed_col]`` into one
    unit-L2-normalized float32 matrix.

    Returns ``(X, valid)`` where ``X[k]`` is the normalized vector of
    DataFrame *positional* row ``valid[k]``. Rows with missing / broken
    embeddings, or a dimensionality differing from the first usable
    vector, are skipped.
    """
    logger = logging.getLogger(__name__)
    vectors: List[np.ndarray] = []
    valid: List[int] = []
    dim: Optional[int] = None
    dropped = 0

    col = df[embed_col]
    for pos in range(len(df)):
        vec = coerce_embedding(col.iat[pos])
        if vec is None or (dim is not None and len(vec) != dim):
            dropped += 1
            continue
        if dim is None:
            dim = len(vec)
        vectors.append(vec)
        valid.append(pos)

    if not vectors:
        return np.zeros((0, 0), dtype=np.float32), []

    X = np.vstack(vectors)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X = X / norms
    if dropped:
        logger.info(f"Embeddings: kept {len(valid)}, dropped {dropped} rows")
    return X, valid


def top_k_cosine(
    X: np.ndarray,
    valid: Sequence[int],
    k: int,
    batch_size: Optional[int] = None,
) -> List[List[Tuple[int, float]]]:
    """For every row of the normalized matrix ``X``, its top-k cosine
    neighbours (excluding itself).

    Returns a list parallel to ``valid``: entry ``i`` is
    ``[(neighbour_matrix_index, similarity), …]`` sorted descending.
    ``batch_size`` bounds the similarity block held in memory
    (default: whole matrix when n ≤ 4096, else 1024-row batches).
    """
    n = X.shape[0]
    if n == 0 or k <= 0:
        return []
    if n == 1:
        return [[]]
    if batch_size is not None and batch_size <= 0:
        raise ValueError("batch_size must be a positive integer")
    if batch_size is None:
        batch_size = n if n <= 4096 else 1024

    out: List[List[Tuple[int, float]]] = []
    for start in range(0, n, batch_size):
        stop = min(n, start + batch_size)
        sims = X[start:stop] @ X.T                      # (batch, n)
        for local in range(stop - start):
            row = sims[local]
            row[start + local] = -np.inf                # exclude self
            kk = min(k, n - 1)
            idx = np.argpartition(row, -kk)[-kk:]
            idx = idx[np.argsort(row[idx])[::-1]]
            out.append([(int(j), float(row[j])) for j in idx])
    return out


def rank_cosine_matrix(similarities: np.ndarray, k: int) -> Tuple[np.ndarray, np.ndarray]:
    """Rank a pre-masked similarity matrix, preserving the publication tie policy.

    The caller owns eligibility and self-exclusion. This helper does not change
    zero-vector handling, score thresholds or domain-specific hub corrections.
    """
    count = min(k, similarities.shape[1] - 1)
    if count <= 0:
        return (np.empty((len(similarities), 0), dtype=np.int64),
                np.empty((len(similarities), 0), dtype=similarities.dtype))
    indices = np.argpartition(-similarities, count, axis=1)[:, :count]
    scores = np.take_along_axis(similarities, indices, axis=1)
    order = np.argsort(-scores, axis=1)
    return (np.take_along_axis(indices, order, axis=1),
            np.take_along_axis(scores, order, axis=1))


def pairs_above_threshold(
    X: np.ndarray,
    threshold: float,
    batch_size: int = 1024,
) -> Iterator[Tuple[int, int, float]]:
    """Yield every unordered pair ``(i, j, similarity)`` with ``i < j``
    and cosine similarity ≥ ``threshold``, in batched matrix products so
    the full n × n similarity matrix never materializes.
    """
    if batch_size <= 0:
        raise ValueError("batch_size must be a positive integer")
    n = X.shape[0]
    for start in range(0, n, batch_size):
        stop = min(n, start + batch_size)
        sims = X[start:stop] @ X.T                      # (batch, n)
        for local in range(stop - start):
            i = start + local
            row = sims[local]
            # Upper triangle only: j > i.
            js = np.nonzero(row[i + 1:] >= threshold)[0]
            for off in js:
                j = i + 1 + int(off)
                yield i, j, float(row[j])


_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)


def word_shingles(text: Any, size: int = 3) -> np.ndarray:
    """Sorted unique 32-bit hashes of the text's word ``size``-grams.

    Tokenised as upstream's ``analyses/reprint_candidates.py`` does —
    casefolded runs of letters and digits — so a Jaccard computed here
    means what the dataset's own calibration measured. Hashes rather than
    tuples because the reprint scan may hold shingles for thousands of
    articles at once; CRC32 rather than ``hash()`` so the result does not
    change between runs. A collision can only inflate overlap by one
    shingle in billions, which no threshold here can see.
    """
    if not isinstance(text, str) or not text:
        return np.empty(0, dtype=np.uint32)
    tokens = _WORD_RE.findall(text.casefold())
    if len(tokens) < size:
        return np.empty(0, dtype=np.uint32)
    grams = {
        zlib.crc32(" ".join(tokens[i:i + size]).encode("utf-8"))
        for i in range(len(tokens) - size + 1)
    }
    return np.fromiter(sorted(grams), dtype=np.uint32, count=len(grams))


def shingle_jaccard(a: np.ndarray, b: np.ndarray) -> float:
    """Jaccard overlap of two ``word_shingles`` arrays (0.0 if either is empty)."""
    if a.size == 0 or b.size == 0:
        return 0.0
    inter = np.intersect1d(a, b, assume_unique=True).size
    return inter / (a.size + b.size - inter)
