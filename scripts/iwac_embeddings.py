#!/usr/bin/env python3
"""
IWAC Shared Embedding Utilities
================================

Shared kNN / similarity helpers over the dataset's 768-dim
``gemini-embedding-2`` vectors. Extracted per REFACTORING.md Tier 4 —
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
"""
from __future__ import annotations

import logging
from typing import Any, Iterator, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd


def coerce_embedding(value: Any) -> Optional[np.ndarray]:
    """Raw embedding cell → float32 vector, or None when unusable.

    Same rules as the article / publication dashboard generators: empty,
    non-numeric, or non-finite cells are rejected rather than patched.
    """
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


def pairs_above_threshold(
    X: np.ndarray,
    threshold: float,
    batch_size: int = 1024,
) -> Iterator[Tuple[int, int, float]]:
    """Yield every unordered pair ``(i, j, similarity)`` with ``i < j``
    and cosine similarity ≥ ``threshold``, in batched matrix products so
    the full n × n similarity matrix never materializes.
    """
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
