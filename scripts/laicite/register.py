"""Readability and lexical-richness accumulators.

Filled during the corpus scan (``laicite.scan``) and read by the sentiment
builder (``laicite.sentiment``), so neither of those two owns them.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


# -----------------------------------------------------------------------
# Register accumulators (view 9's second half)
# -----------------------------------------------------------------------
#
# Two upstream columns, and the caveats attached to each are the reason
# this is a running sum rather than a list of values:
#
#   Lisibilite_OCR        Flesch reading-ease, French adaptation.
#   Richesse_Lexicale_OCR MATTR over a sliding 50-token window.
#
# MATTR is ALREADY length-robust — that is the entire reason upstream uses
# it instead of raw TTR — so nothing here may length-normalise it or bin
# it by `nb_mots` before comparing. It is also None below the 50-token
# window, which is a legitimate "unscored", not a zero.
#
# Both are lexicon-fitted to French, so they mis-score the collection's
# ~45 Ewé / Kabiyè / Dendi items. Those rows are unscored upstream and
# stay unscored here; a missing metric is never read as a low one. Since
# the generation-2 sentiment only annotates French and English articles
# anyway, and register is only computed within a subjectivity level, the
# non-French items drop out of this view twice over.
#
# Each metric counts its OWN n: an article scored for readability but not
# for richness contributes to the first mean and not the second.


def _register_bucket() -> Dict[str, float]:
    return {"n": 0, "read_sum": 0.0, "read_n": 0, "rich_sum": 0.0, "rich_n": 0}


def _register_add(
    bucket: Dict[str, float],
    readability: Optional[float],
    richness: Optional[float],
) -> None:
    bucket["n"] += 1
    if readability is not None:
        bucket["read_sum"] += readability
        bucket["read_n"] += 1
    if richness is not None:
        bucket["rich_sum"] += richness
        bucket["rich_n"] += 1


def _register_means(bucket: Dict[str, float]) -> Dict[str, Any]:
    """Bucket → the shape the panel reads, with n beside every mean.

    The n travels with the mean because these buckets get thin fast: a
    dossier of ~1,300 items split five ways leaves levels 1 and 5 with
    few dozen articles each, and a mean over 30 items rendered the same
    way as a mean over 400 invites a reading the data will not support.
    """
    return {
        "items": int(bucket["n"]),
        "readability": (round(bucket["read_sum"] / bucket["read_n"], 1)
                        if bucket["read_n"] else None),
        "readability_n": int(bucket["read_n"]),
        "richness": (round(bucket["rich_sum"] / bucket["rich_n"], 4)
                     if bucket["rich_n"] else None),
        "richness_n": int(bucket["rich_n"]),
    }
