"""Frame × decade × country shares — ``laicite-arenas.json``.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List

from iwac_utils import generate_timestamp



class ArenasMixin:
    """``LaiciteGenerator``'s arenas half. Mixed in by ``laicite.generator``."""


    def build_arenas(self) -> Dict[str, Any]:
        """What is actually being contested under the word (view 8).

        Frame x decade x country, as the SHARE of that slice's dossier items
        touching each frame. Shares, not counts, because the slices differ by
        an order of magnitude in size and the question is about composition:
        "in Burkina Faso in the 2010s, what proportion of the laïcité dossier
        argues about schooling" is comparable across slices; the raw count is
        not.

        ``references`` are excluded for the same reason they are excluded
        from the collocate decade slices: a reference is dated by when the
        analysis was published, not by the period it analyses.
        """
        scans = self.scan_all()
        usable = [s for s in scans if s.year and s.said and s.subset != "references"]
        decades = sorted({self._decade(s.year) for s in usable if s.year})
        # Membership frames are excluded: an item is in the dossier BECAUSE
        # it says laïcité, so that panel reads ~95% in every decade — it is
        # the selection criterion, not an arena. Keeping it also forced the
        # shared y-axis to 100% and flattened the nine panels that are
        # actually contested into a row of stubs.
        excluded = list(self.lex.membership_frames)
        frames = [f for f in self.lex.frames if f not in excluded]

        def blank() -> Dict[str, List[int]]:
            return {f: [0] * len(decades) for f in frames}

        idx = {d: i for i, d in enumerate(decades)}
        global_counts = blank()
        global_totals = [0] * len(decades)
        by_country: Dict[str, Dict[str, List[int]]] = {}
        country_totals: Dict[str, List[int]] = {}
        country_items: Counter = Counter()

        for s in usable:
            i = idx[self._decade(s.year)]
            global_totals[i] += 1
            touched = [f for f in frames if s.nearby_frame_counts.get(f)]
            for frame in touched:
                global_counts[frame][i] += 1
            for country in s.countries:
                country_items[country] += 1
                if country not in by_country:
                    by_country[country] = blank()
                    country_totals[country] = [0] * len(decades)
                country_totals[country][i] += 1
                for frame in touched:
                    by_country[country][frame][i] += 1

        keep = {c for c, n in country_items.items() if n >= self.min_country_items}
        dropped = sorted(set(country_items) - keep)
        if dropped:
            self.logger.info(
                f"  arenas: dropped thin countries {dropped} "
                f"(< {self.min_country_items} items)")

        self.logger.info(
            f"  arenas: {len(frames)} frames x {len(decades)} decades x "
            f"{len(keep)} countries")
        return {
            "generated_at": generate_timestamp(),
            "context_window": 80,
            "minimum_cell": 5,
            "excluded_without_anchor": sum(1 for s in scans if s.subset != "references" and not s.said),
            "frames": frames,
            "decades": decades,
            "countries": sorted(keep),
            "global": global_counts,
            "global_totals": global_totals,
            "by_country": {c: by_country[c] for c in sorted(keep)},
            "country_totals": {c: country_totals[c] for c in sorted(keep)},
            "dropped_countries": dropped,
            "membership_excluded": excluded,
            "scope": (
                "Primary sources with a core match, including YouTube. "
                "Categories must occur within 80 tokens of a core match "
                "in the same field. Scholarship and unanchored tag-only "
                "records are excluded. This is lexical context, not argument coding."
            ),
        }
