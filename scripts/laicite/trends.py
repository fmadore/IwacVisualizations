"""The timeline's coverage cells and the Gregorian-vs-lunar month profile.

``laicite-trends.json`` and ``laicite-seasonality.json``. The seasonality
profile excludes ``references``: scholarship is dated by when the analysis
was published, not by the period analysed. The timeline's cells keep every
subset and let the reader pick one source type at a time.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict

from iwac_utils import generate_timestamp

from laicite.scan import MINIMUM_CELL, SUBSET_FIELDS


class TrendsMixin:
    """``LaiciteGenerator``'s trends half. Mixed in by ``laicite.generator``."""


    def build_trends(self) -> Dict[str, Any]:
        """The timeline's bundle: the whole-collection coverage cells.

        The timeline is drawn from ``research`` alone — matching records
        over eligible records, per subset × year × country × outlet — and
        nothing else. The per-year frame series this bundle used to carry
        (``years`` / ``families`` / ``global`` / ``by_country`` /
        ``by_subset`` / ``items``) were the shape of the frame-count chart
        the research series replaced; no reader was left, so they are no
        longer computed.
        """
        research = self.build_research()
        self.logger.info(f"Trends: {len(research['cells'])} coverage cells")
        return {
            # Every bundle says when it was made (P10).
            "generated_at": generate_timestamp(),
            "research": research,
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
            # Months with fewer eligible records than this carry no rate.
            "minimum_cell": MINIMUM_CELL,
            "note": (
                "Lunar months are read from the dataset's precomputed "
                "hijri_month (Umm al-Qura), never re-derived in the browser: "
                "ICU disagrees with it on most pre-2000 dates."
            ),
            "by_subset": out,
        }
