#!/usr/bin/env python3
"""
IWAC Shared Statistics Utilities
================================

Pure-Python/NumPy statistics for the corpus-linguistics generators, in the
same spirit as ``iwac_embeddings.py``: side-effect-free functions with no
dataset knowledge, so they can be reasoned about and tested in isolation.

These are ports of the reference implementations in the sibling
IWAC-Hugging-Face pipeline (``analyses/_stats.py`` and
``analyses/keyness_bursts.py``), which computes the same measures for
CSV reporting. The port is deliberate rather than an import: that repo is
the data pipeline and is not a dependency of this module (its outputs reach
us only through the Hugging Face Hub). Keeping the maths here means a
generator can be run against the Hub alone. Where the two must agree —
they are the same measures over the same corpus — the formulas below are
kept literally identical, and any change should be made in both.

Functions
---------
- chi2_sf_1df:      upper-tail p-value of a chi-square statistic, df=1
- bh_adjust:        Benjamini–Hochberg step-up q-values
- dunning_g2:       signed log-likelihood ratio (keyness test statistic)
- log_ratio:        Hardie's Log Ratio (keyness effect size)
- keyness_for_slices: significant overrepresented tokens per slice
- kleinberg_bursts: burst intervals from a 2-state automaton
- contiguous_years: zero-filled calendar range over observed years
"""
from __future__ import annotations

import math
from collections import Counter
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

# Default false-discovery-rate threshold for keyness reporting.
ALPHA = 0.05


# =============================================================================
# Multiple comparisons
# =============================================================================

def chi2_sf_1df(x: float) -> float:
    """Upper-tail probability P(X > x) for X ~ chi-square with 1 df.

    Closed form rather than a SciPy call, which keeps the generators'
    dependency list at numpy/pandas: for one degree of freedom
    ``P(X > x) = 2(1 - Phi(sqrt(x))) = erfc(sqrt(x / 2))``, and
    ``math.erfc`` is stdlib. This is an identity, not an approximation —
    it agrees with ``scipy.stats.chi2.sf(x, df=1)`` to floating-point
    precision, including deep in the tail where erfc keeps its accuracy
    and ``1 - cdf`` would cancel to zero.
    """
    if not math.isfinite(x) or x <= 0.0:
        return 1.0
    return math.erfc(math.sqrt(x / 2.0))


def bh_adjust(pvals: Sequence[float]) -> np.ndarray:
    """Benjamini–Hochberg step-up adjusted p-values (q-values).

    Returns an array aligned with the input. Non-finite p-values are
    ignored: they come back as NaN and do not count toward the number of
    tests m, so a token that could not be tested cannot loosen the
    threshold for the ones that could.
    """
    p = np.asarray(pvals, dtype=float)
    q = np.full(p.shape, np.nan)
    finite = np.isfinite(p)
    m = int(finite.sum())
    if m == 0:
        return q
    pf = p[finite]
    order = np.argsort(pf, kind="mergesort")
    ranked = pf[order] * m / np.arange(1, m + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(m)
    out[order] = np.clip(ranked, 0.0, 1.0)
    q[finite] = out
    return q


# =============================================================================
# Keyness — Dunning log-likelihood + log-ratio effect size
# =============================================================================

def dunning_g2(a: int, b: int, total_a: int, total_b: int) -> float:
    """Signed G² for token overrepresentation in corpus A vs corpus B.

    Positive when the token's *rate* is higher in A. The sign carries the
    direction; the test statistic is the absolute value.
    """
    if a == 0 or total_a == 0:
        return 0.0
    e1 = total_a * (a + b) / (total_a + total_b)
    e2 = total_b * (a + b) / (total_a + total_b)
    g2 = 0.0
    if a > 0 and e1 > 0:
        g2 += a * math.log(a / e1)
    if b > 0 and e2 > 0:
        g2 += b * math.log(b / e2)
    g2 *= 2.0
    return g2 if (a / total_a) > ((b / total_b) if total_b else 0) else -g2


def log_ratio(a: int, b: int, total_a: int, total_b: int) -> float:
    """Log2 ratio of relative rates, Haldane–Anscombe +0.5 smoothed.

    Hardie's Log Ratio, the effect size that goes with a G² test: +1 means
    the token is twice as frequent per token in A as in B. Antisymmetric in
    (A, B). The +0.5 on both counts keeps a zero count finite instead of
    producing an infinity that would sort to the top of every ranking.
    """
    if total_a <= 0 or total_b <= 0:
        return float("nan")
    return math.log2(((a + 0.5) / total_a) / ((b + 0.5) / total_b))


def keyness_for_slices(
    slice_tokens: Dict[str, Counter],
    top_n: int,
    min_count: int,
    alpha: float = ALPHA,
    min_log_ratio: float = 0.0,
) -> Dict[str, List[Dict[str, Any]]]:
    """Significantly overrepresented tokens per slice, vs. all others pooled.

    G² conflates effect size with sample size — a negligible rate
    difference over a large corpus still yields a large G² — so it is used
    **only as the significance test**: p = chi2_sf_1df(|G²|), then
    Benjamini–Hochberg correction within each slice's tested token family.
    Surviving tokens (q < alpha) are ranked by the **log-ratio effect
    size** and capped at *top_n*. Ranking by G² instead is the classic
    keyness mistake: it returns the corpus's most frequent words in
    slice-size order.

    ``min_log_ratio`` additionally drops significant-but-trivial results.
    On a corpus this size, significance is cheap: a token used 1.1× as
    often reaches q < 0.001 on tens of thousands of occurrences, and a
    slice with no real signature vocabulary will otherwise fill its whole
    top-N with such terms — which a reader reasonably takes as "these words
    characterise this slice" when they do not. 0.585 (= log2 1.5, a 1.5×
    rate) is a defensible floor. Set 0.0 to report everything significant,
    which is what the sibling pipeline's CSV export does, since an analyst
    reading a CSV can filter and a panel reader cannot.

    The BH denominator covers every token meeting ``min_count``, including
    the underrepresented ones, because those tests were still performed —
    and it is applied *before* the effect-size floor, so filtering for
    substance does not retroactively loosen the correction.

    Returns ``{slice_name: [token dict, …]}``, ordered by log_ratio
    descending. Slices with nothing left are absent.
    """
    totals = {name: sum(counter.values()) for name, counter in slice_tokens.items()}
    grand: Counter = Counter()
    for counter in slice_tokens.values():
        grand.update(counter)
    grand_total = sum(totals.values())

    out: Dict[str, List[Dict[str, Any]]] = {}
    for name, counter in slice_tokens.items():
        total_a = totals[name]
        total_b = grand_total - total_a
        if total_a == 0 or total_b == 0:
            continue

        tested = []
        for token, a in counter.items():
            if a < min_count:
                continue
            b = grand[token] - a
            tested.append((token, a, b, dunning_g2(a, b, total_a, total_b)))
        if not tested:
            continue

        pvals = [chi2_sf_1df(abs(g2)) for _, _, _, g2 in tested]
        qvals = bh_adjust(pvals)

        scored: List[Dict[str, Any]] = []
        for (token, a, b, g2), p, q in zip(tested, pvals, qvals):
            if g2 <= 0 or not math.isfinite(q) or q >= alpha:
                continue  # report only significant OVERrepresentation
            lr = log_ratio(a, b, total_a, total_b)
            if not math.isfinite(lr) or lr < min_log_ratio:
                continue  # significant but too small an effect to be worth a claim
            rate_a = a / total_a
            rate_b = (b / total_b) if total_b else 0.0
            ratio = rate_a / rate_b if rate_b else float("inf")
            scored.append({
                "token":      token,
                "log_ratio":  round(lr, 3),
                "g2":         round(g2, 2),
                "q":          float(q),
                "count":      int(a),
                "rate_ratio": round(ratio, 2) if math.isfinite(ratio) else None,
            })
        if not scored:
            continue
        scored.sort(key=lambda entry: (-entry["log_ratio"], entry["token"]))
        out[name] = scored[:top_n]
    return out


# =============================================================================
# Bursts — Kleinberg's 2-state automaton (batch document-stream variant)
# =============================================================================

def contiguous_years(observed: Sequence[int]) -> List[int]:
    """Contiguous calendar range min..max over the observed years.

    Calendar gaps become explicit zero-document years rather than
    collapsing, so the burst automaton's log(T) horizon reflects the real
    span and two non-consecutive years are never treated as adjacent.
    """
    years = [int(y) for y in observed if y is not None]
    if not years:
        return []
    return list(range(min(years), max(years) + 1))


def kleinberg_bursts(
    r: Sequence[float],
    d: Sequence[float],
    years: Sequence[int],
    s: float = 2.0,
    gamma: float = 1.0,
) -> List[Dict[str, Any]]:
    """Burst intervals for one term's per-year document counts.

    ``r[t]`` = documents mentioning the term in year t; ``d[t]`` = all
    documents in year t; ``years`` must be the contiguous range from
    :func:`contiguous_years`. Two states: the base rate ``p0 = R/D`` and a
    burst rate ``p1 = s * p0``. Entering the burst state costs
    ``gamma * ln(T)``; staying or leaving is free. Viterbi over the two
    states, then the maximal state-1 intervals are returned with the cost
    they saved over staying in state 0 (their "weight").

    Years with no documents emit zero cost in either state, so a burst may
    legitimately span a gap in the corpus rather than being split by it.
    """
    r_arr = np.asarray(r, dtype=float)
    d_arr = np.asarray(d, dtype=float)
    T = len(r_arr)
    R, D = float(r_arr.sum()), float(d_arr.sum())
    if T < 2 or R == 0 or D == 0:
        return []
    p0 = R / D
    p1 = min(s * p0, 0.9999)
    if p1 <= p0:
        return []

    def sigma(p: float, rt: float, dt: float) -> float:
        if dt == 0:
            return 0.0
        return -(rt * math.log(p) + (dt - rt) * math.log(1.0 - p))

    trans = gamma * math.log(T)
    cost = np.full((T, 2), float("inf"))
    back = np.zeros((T, 2), dtype=int)
    cost[0, 0] = sigma(p0, r_arr[0], d_arr[0])
    cost[0, 1] = trans + sigma(p1, r_arr[0], d_arr[0])
    for t in range(1, T):
        for q in (0, 1):
            emit = sigma(p1 if q else p0, r_arr[t], d_arr[t])
            stay = cost[t - 1, q]
            move = cost[t - 1, 1 - q] + (trans if q == 1 else 0.0)
            if stay <= move:
                cost[t, q] = stay + emit
                back[t, q] = q
            else:
                cost[t, q] = move + emit
                back[t, q] = 1 - q

    q = int(np.argmin(cost[T - 1]))
    path = [q]
    for t in range(T - 1, 0, -1):
        q = int(back[t, q])
        path.append(q)
    path.reverse()

    bursts: List[Dict[str, Any]] = []
    t = 0
    while t < T:
        if path[t] != 1:
            t += 1
            continue
        start = t
        weight = 0.0
        mentions = 0
        while t < T and path[t] == 1:
            weight += sigma(p0, r_arr[t], d_arr[t]) - sigma(p1, r_arr[t], d_arr[t])
            mentions += int(r_arr[t])
            t += 1
        bursts.append({
            "start":    int(years[start]),
            "end":      int(years[t - 1]),
            # Plain float, not np.float64: the latter only serializes today
            # because it subclasses float, which is not a guarantee to lean on.
            "weight":   round(float(weight), 2),
            "mentions": mentions,
        })
    return bursts


def parse_multi_values(raw: Any, separator: str = "|") -> set:
    """Deduplicated value set for one row's multi-value field.

    Burst counts are over *documents*, so a row listing the same subject
    twice must contribute once. Missing / NaN fields yield an empty set.
    """
    if raw is None:
        return set()
    if isinstance(raw, float) and math.isnan(raw):
        return set()
    return {part.strip() for part in str(raw).split(separator) if part.strip()}


def normalize_optional(value: Optional[float]) -> Optional[float]:
    """Round a float for JSON, passing None through unchanged."""
    return None if value is None else round(float(value), 4)
