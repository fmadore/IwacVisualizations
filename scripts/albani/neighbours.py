"""Distributional neighbours for the review sheet — PPMI + truncated SVD.

Issue #31 asks for the nearest neighbours of the seed words "in a word2vec /
fastText model trained on the corpus itself". At ~800,000 words that is a
small corpus for word2vec, and the classic count-based equivalent (Levy,
Goldberg & Dagan 2015: shifted PPMI, context-distribution smoothing,
truncated SVD) performs as well at this size while needing nothing beyond
numpy — so the generator gains no dependency for a candidate list that a
person reviews anyway. The neighbours are suggestions, never lexicon
entries: they reach the lexicon only through an ``accept`` in the sheet.
"""
from __future__ import annotations

from collections import Counter
from typing import Dict, List, Sequence, Tuple

import numpy as np


def nearest_neighbours(
    docs: Sequence[Sequence[str]],
    queries: Sequence[str],
    k: int = 8,
    window: int = 5,
    min_count: int = 10,
    max_vocab: int = 6000,
    dims: int = 100,
    alpha: float = 0.75,
    seed: int = 31,
) -> Dict[str, List[Tuple[str, float]]]:
    """``{query: [(neighbour, cosine), …]}`` for every query in the vocabulary.

    ``docs`` are token lists that windows must not cross (speaker turns).
    """
    freq = Counter(tok for doc in docs for tok in doc)
    vocab = [w for w, n in freq.most_common(max_vocab) if n >= min_count]
    index = {w: i for i, w in enumerate(vocab)}
    n = len(vocab)
    if n < 3:
        return {}
    pairs: Counter = Counter()
    for doc in docs:
        ids = [index.get(tok, -1) for tok in doc]
        for i, a in enumerate(ids):
            if a < 0:
                continue
            for j in range(i + 1, min(len(ids), i + window + 1)):
                b = ids[j]
                if b >= 0 and b != a:
                    pairs[(a, b)] += 1
                    pairs[(b, a)] += 1
    if not pairs:
        return {}
    m = np.zeros((n, n), dtype=np.float64)
    for (a, b), c in pairs.items():
        m[a, b] = c
    total = m.sum()
    row = m.sum(axis=1, keepdims=True)
    col = m.sum(axis=0, keepdims=True) ** alpha
    col = col / col.sum()
    with np.errstate(divide="ignore", invalid="ignore"):
        pmi = np.log((m / total) / ((row / total) * col))
    pmi[~np.isfinite(pmi)] = 0.0
    ppmi = np.maximum(pmi, 0.0)

    rank = min(dims, n - 1)
    rng = np.random.default_rng(seed)
    # Randomised range finder (Halko et al. 2011) — a full SVD of a
    # 6,000-square matrix is minutes; this is seconds and plenty for ranking.
    probe = rng.standard_normal((n, rank + 10))
    q, _ = np.linalg.qr(ppmi @ probe)
    q, _ = np.linalg.qr(ppmi @ (ppmi.T @ q))
    u_small, s, _ = np.linalg.svd(q.T @ ppmi, full_matrices=False)
    vectors = (q @ u_small[:, :rank]) * np.sqrt(s[:rank])
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    unit = vectors / norms

    out: Dict[str, List[Tuple[str, float]]] = {}
    for query in queries:
        i = index.get(query)
        if i is None:
            continue
        sims = unit @ unit[i]
        sims[i] = -1.0
        best = np.argsort(-sims)[:k]
        out[query] = [(vocab[j], float(sims[j])) for j in best if sims[j] > 0]
    return out
