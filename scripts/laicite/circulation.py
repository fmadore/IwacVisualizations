"""Near-duplicate cross-outlet pairs — ``laicite-circulation.json``.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional, Set

from iwac_embeddings import pairs_above_threshold
from iwac_utils import generate_timestamp

from laicite.scan import ItemScan


# -----------------------------------------------------------------------
# Circulation (issue #19 D)
# -----------------------------------------------------------------------
# 0.97 is generate_reprints.py's publication threshold, kept identical so
# "reprint" means the same thing in both blocks. That script re-derives
# the cut-off empirically on every data refresh (it logs a similarity
# histogram from 0.90 up); if it ever moves, move this with it.
CIRCULATION_THRESHOLD = 0.97
# Cap on the pair list the bundle ships as browsable rows. Every
# aggregate — the outlet network, the per-decade counts, the reprinted-item
# total — is computed over ALL detected pairs before this cut, so the cap
# shortens a list without ever shrinking a number.
CIRCULATION_MAX_LISTED = 300


class CirculationMixin:
    """``LaiciteGenerator``'s circulation half. Mixed in by ``laicite.generator``."""


    def build_circulation(self) -> Dict[str, Any]:
        """Near-duplicate laïcité articles across different outlets.

        The question none of the other views can answer: does this
        coverage **circulate**? A communiqué reprinted verbatim by eleven
        papers, a PANA dispatch picked up across a border, and eleven
        newsrooms independently covering the same controversy are
        indistinguishable on a per-year item count — and they are not the
        same finding. It matters directly for the argument the dossier
        backs: a claim about the volume of debate is weaker if the volume
        is one press release printed eleven times.

        Method is ``generate_reprints.py``'s, scoped to the dossier:
        cosine similarity over L2-normalised ``embedding_OCR``, publish
        pairs above a high threshold whose two articles carry different
        newspaper names. Scoped rather than joined because that block's
        published bundle is capped at its top-N pairs by similarity and
        would silently under-report a small slice; and because ~1,300
        members is a cheap all-pairs scan where the full corpus is not.

        **A within-dossier scan can only see reprints where BOTH copies
        are members.** In practice a verbatim reprint of a laïcité
        article matches the same lexicon and joins the dossier too, so
        the pairs are near-complete — but a copy whose OCR is too poor to
        match would be missed, and the panel says the count is a floor
        rather than a census.
        """
        X, scans = self._member_embeddings()
        if len(scans) < 2:
            return {
                "generated_at": generate_timestamp(),
                "threshold": CIRCULATION_THRESHOLD,
                "scanned": len(scans),
                "listed": 0,
                "total_pairs": 0,
                "pairs": [],
                "links": [],
                "newspapers": [],
                "reprinted_items": 0,
                "median_year_gap": None,
                "by_decade": {},
            }

        pairs: List[Dict[str, Any]] = []
        for i, j, sim in pairs_above_threshold(X, CIRCULATION_THRESHOLD):
            a, b = scans[i], scans[j]
            # Same outlet is not circulation — it is a correction, a
            # second edition, or the same piece indexed twice.
            if not a.newspaper or not b.newspaper or a.newspaper == b.newspaper:
                continue
            pairs.append({
                "similarity": round(sim, 4),
                "a": self._circulation_side(a),
                "b": self._circulation_side(b),
                "year_gap": self._year_gap(a, b),
            })

        pairs.sort(key=lambda p: -p["similarity"])

        # Aggregates run over EVERY detected pair, before the display cap
        # below: a "12% of the dossier is reprinted copy" figure computed
        # from a truncated list would be wrong in the one direction a
        # reader cannot detect.
        link_counts: Dict[frozenset, int] = defaultdict(int)
        paper_counts: Counter = Counter()
        reprinted: Set[str] = set()
        by_decade: Counter = Counter()
        for p in pairs:
            pa, pb = p["a"]["newspaper"], p["b"]["newspaper"]
            link_counts[frozenset((pa, pb))] += 1
            paper_counts[pa] += 1
            paper_counts[pb] += 1
            reprinted.add(p["a"]["o_id"])
            reprinted.add(p["b"]["o_id"])
            for side in ("a", "b"):
                decade = self._decade(p[side]["year"])
                if decade:
                    by_decade[decade] += 1

        links = []
        for pair, count in sorted(link_counts.items(),
                                  key=lambda kv: (-kv[1], sorted(kv[0]))):
            left, right = sorted(pair)
            links.append([left, right, count])

        gaps = sorted(p["year_gap"] for p in pairs if p["year_gap"] is not None)
        median_gap = gaps[len(gaps) // 2] if gaps else None

        self.logger.info(
            "  circulation: %d cross-outlet pairs ≥ %.2f over %d embedded "
            "articles, touching %d items",
            len(pairs), CIRCULATION_THRESHOLD, len(scans), len(reprinted))

        return {
            "generated_at": generate_timestamp(),
            "threshold": CIRCULATION_THRESHOLD,
            # The denominator every share on the panel is taken against.
            "scanned": len(scans),
            "listed": min(len(pairs), CIRCULATION_MAX_LISTED),
            "total_pairs": len(pairs),
            "reprinted_items": len(reprinted),
            "median_year_gap": median_gap,
            "by_decade": dict(sorted(by_decade.items())),
            "newspapers": [
                {"name": name, "pairs": int(count)}
                for name, count in sorted(paper_counts.items(),
                                          key=lambda kv: (-kv[1], kv[0]))
            ],
            "links": links,
            "pairs": pairs[:CIRCULATION_MAX_LISTED],
        }

    @staticmethod
    def _circulation_side(scan: ItemScan) -> Dict[str, Any]:
        return {
            "o_id": scan.o_id,
            "title": scan.title,
            "newspaper": scan.newspaper,
            "country": scan.countries[0] if scan.countries else "",
            "year": scan.year,
        }

    @staticmethod
    def _year_gap(a: ItemScan, b: ItemScan) -> Optional[int]:
        """Years between two items, or None when either is undated.

        Years rather than days: the scan works off ``ItemScan``, which
        keeps the parsed year and not the raw date, and a great many of
        these items are ``YYYY``-only anyway. A day-level gap would be
        precision the dossier's dates do not support.
        """
        if a.year is None or b.year is None:
            return None
        return abs(a.year - b.year)

    def _dominant_annotation_frame(self, scan: ItemScan) -> str:
        """The frame that best characterises this item, or "".

        Membership frames are excluded: an item is in the dossier
        *because* it says laïcité, so colouring by `laicite` would paint
        almost every point one colour and encode the selection criterion
        instead of anything about the item. The arenas view excludes them
        from its small multiples for the same reason.
        """
        membership = set(self.lex.membership_frames)
        counts = {f: n for f, n in scan.frame_counts.items()
                  if f not in membership and n > 0}
        if not counts:
            return ""
        return max(sorted(counts), key=lambda f: counts[f])
