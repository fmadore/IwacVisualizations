"""Per-year series and the Gregorian-vs-lunar month profile.

``laicite-trends.json`` and ``laicite-seasonality.json``. Both are temporal
facets, so both exclude ``references``: scholarship is dated by when the
analysis was published, not by the period analysed.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List

from iwac_utils import generate_timestamp

from laicite.scan import SUBSET_FIELDS


class TrendsMixin:
    """``LaiciteGenerator``'s trends half. Mixed in by ``laicite.generator``."""


    def build_trends(self) -> Dict[str, Any]:
        """Aligned per-year series: global, per country, per frame, per subset.

        Shaped to match ``scary-terms-trends.json`` so ``scary-terms/trends.js``
        renders it unchanged (``years`` / ``families`` / ``global`` /
        ``by_country``), with two additions this block needs: ``by_subset``
        (press coverage and primary sources must never share a total without
        saying so) and item counts alongside occurrence counts.
        """
        scans = [s for s in self.scan_all() if s.subset != "references"]
        frames = list(self.lex.frames.keys())
        years_present = sorted({s.year for s in scans if s.year})
        if not years_present:
            return {"generated_at": generate_timestamp(), "years": [],
                    "families": frames, "global": {}, "by_country": {}}
        years = list(range(years_present[0], years_present[-1] + 1))
        year_idx = {y: i for i, y in enumerate(years)}

        def blank() -> Dict[str, List[int]]:
            return {f: [0] * len(years) for f in frames}

        global_series = blank()
        by_country: Dict[str, Dict[str, List[int]]] = {}
        by_subset: Dict[str, Dict[str, List[int]]] = {}
        items_global = [0] * len(years)
        items_by_country: Dict[str, List[int]] = {}
        country_totals: Counter = Counter()

        for s in scans:
            if s.year is None or s.year not in year_idx:
                continue
            yi = year_idx[s.year]
            items_global[yi] += 1
            for frame, count in s.frame_counts.items():
                global_series[frame][yi] += count
            by_subset.setdefault(s.subset, blank())
            for frame, count in s.frame_counts.items():
                by_subset[s.subset][frame][yi] += count
            for country in s.countries:
                country_totals[country] += 1
                by_country.setdefault(country, blank())
                items_by_country.setdefault(country, [0] * len(years))
                items_by_country[country][yi] += 1
                for frame, count in s.frame_counts.items():
                    by_country[country][frame][yi] += count

        keep = {c for c, n in country_totals.items() if n >= self.min_country_items}
        by_country = {c: v for c, v in sorted(by_country.items()) if c in keep}
        items_by_country = {c: v for c, v in items_by_country.items() if c in keep}

        self.logger.info(
            f"Trends: {len(years)} years, {len(by_country)} countries, "
            f"{len(by_subset)} subsets")
        return {
            # Every bundle says when it was made; this one and the scary
            # temporal map were the two with no provenance at all (P10).
            "generated_at": generate_timestamp(),
            "research": self.build_research(),
            "years": years,
            "families": frames,
            "global": global_series,
            "by_country": by_country,
            "by_subset": by_subset,
            "items": {"global": items_global, "by_country": items_by_country},
        }

    def build_seasonality(self) -> Dict[str, Any]:
        """Gregorian vs lunar month profile (review idea B).

        Laïcité flashpoints are partly calendar-bound — hajj organisation,
        jours fériés, Ramadan school and workplace friction — but a lunar
        observance drifts ~11 days a year, so over sixty years it smears
        across all twelve Gregorian months and a Gregorian axis structurally
        cannot see it. The dataset ships ``hijri_month`` precomputed from the
        Umm al-Qura tables, so both profiles are emitted side by side.

        ``hijri_month`` is null wherever ``pub_date`` is not a complete
        YYYY-MM-DD, and ``references`` do not carry it at all, so the
        coverage denominator is reported per corpus rather than assumed.
        """
        scans = self.scan_all()
        out: Dict[str, Any] = {}
        for subset in SUBSET_FIELDS:
            if subset == "references":
                continue
            sub = [s for s in scans if s.subset == subset]
            greg: Counter = Counter()
            hijri: Counter = Counter()
            for s in sub:
                if s.month and s.hijri_month:
                    greg[s.month] += 1
                    hijri[s.hijri_month] += 1
            if not greg and not hijri:
                continue
            out[subset] = {
                "items": len(sub),
                "gregorian": [greg.get(m, 0) for m in range(1, 13)],
                "hijri": [hijri.get(m, 0) for m in range(1, 13)],
                "gregorian_coverage": sum(greg.values()),
                "hijri_coverage": sum(hijri.values()),
                "gregorian_exposure": [sum(1 for r in self.source_records
                    if r["subset"] == subset and r["month"] == m and r["hijri_month"])
                    for m in range(1, 13)],
                "hijri_exposure": [sum(1 for r in self.source_records
                    if r["subset"] == subset and r["hijri_month"] == m and r["month"])
                    for m in range(1, 13)],
            }
        self.logger.info(f"  seasonality: {len(out)} corpora with dated items")
        return {
            "generated_at": generate_timestamp(),
            "note": (
                "Lunar months are read from the dataset's precomputed "
                "hijri_month (Umm al-Qura), never re-derived in the browser: "
                "ICU disagrees with it on most pre-2000 dates."
            ),
            "by_subset": out,
        }
