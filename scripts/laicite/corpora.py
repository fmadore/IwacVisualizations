"""Press vs periodicals, token-normalised — ``laicite-corpora.json``.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict

from iwac_utils import generate_timestamp

from laicite.scan import SUBSET_FIELDS


class CorporaMixin:
    """``LaiciteGenerator``'s corpora half. Mixed in by ``laicite.generator``."""


    def build_corpora(self) -> Dict[str, Any]:
        """Press vs periodicals, normalised by tokens (issue #14, view 6).

        The headline contrast is that Muslim periodicals write about laïcité
        continuously while the mainstream press writes about it in crises.
        Item counts cannot show that: a 100-page periodical issue and a
        400-word news item are not commensurable, so every rate here is per
        10,000 words of the matched items, using ``nb_mots``.

        Also carries the per-newspaper frame fingerprints (review idea E) —
        the same contrast one level down, at outlet rather than corpus level.
        """
        scans = self.scan_all()
        frames = list(self.lex.frames.keys())

        per_subset: Dict[str, Any] = {}
        for subset in SUBSET_FIELDS:
            sub = [s for s in scans if s.subset == subset]
            if not sub:
                continue
            words = sum(s.nb_mots for s in sub)
            occ = sum(len(s.occurrences) for s in sub)
            frame_occ = {f: sum(s.frame_counts.get(f, 0) for s in sub) for f in frames}
            by_year: Dict[str, Dict[str, float]] = {}
            year_words: Counter = Counter()
            year_occ: Counter = Counter()
            for s in sub:
                if not s.year:
                    continue
                year_words[s.year] += s.nb_mots
                year_occ[s.year] += len(s.occurrences)
            for year in sorted(year_words):
                w = year_words[year]
                by_year[str(year)] = {
                    "items": sum(1 for s in sub if s.year == year),
                    "occurrences": year_occ[year],
                    "words": w,
                    "per_10k": round(year_occ[year] / w * 10000, 2) if w else None,
                }
            per_subset[subset] = {
                "items": len(sub),
                "words": words,
                "occurrences": occ,
                "per_10k": round(occ / words * 10000, 2) if words else None,
                "frame_per_10k": {
                    f: (round(n / words * 10000, 2) if words else None)
                    for f, n in frame_occ.items()
                },
                "frame_item_share": {
                    f: round(sum(1 for s in sub if s.frame_counts.get(f))
                             / len(sub), 4)
                    for f in frames
                },
                "by_year": by_year,
            }

        # Per-newspaper frame fingerprints, row-normalised so outlets of very
        # different sizes can be read on one scale.
        paper_items: Counter = Counter()
        paper_frames: Dict[str, Counter] = defaultdict(Counter)
        paper_subset: Dict[str, str] = {}
        paper_country: Dict[str, str] = {}
        for s in scans:
            if not s.newspaper:
                continue
            paper_items[s.newspaper] += 1
            paper_subset[s.newspaper] = s.subset
            if s.countries:
                paper_country[s.newspaper] = s.countries[0]
            for f in frames:
                if s.frame_counts.get(f):
                    paper_frames[s.newspaper][f] += 1

        newspapers = []
        for paper, n in paper_items.most_common():
            if n < self.min_newspaper_items:
                continue
            newspapers.append({
                "name": paper,
                "items": n,
                "subset": paper_subset.get(paper, ""),
                "country": paper_country.get(paper, ""),
                "frame_share": {
                    f: round(paper_frames[paper].get(f, 0) / n, 4) for f in frames
                },
            })
        self.logger.info(
            f"  corpora: {len(per_subset)} corpora, "
            f"{len(newspapers)} newspapers ≥ {self.min_newspaper_items} items")
        return {
            "generated_at": generate_timestamp(),
            "note": (
                "Rates are per 10,000 words of the matched items, not per "
                "item: a periodical issue and a news article are not "
                "commensurable units."
            ),
            "frames": frames,
            "by_subset": per_subset,
            "min_newspaper_items": self.min_newspaper_items,
            "newspapers": newspapers,
        }
