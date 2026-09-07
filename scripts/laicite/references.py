"""The scholarship, on its own axis — ``laicite-references.json``.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List

from iwac_utils import generate_timestamp



class ReferencesMixin:
    """``LaiciteGenerator``'s references half. Mixed in by ``laicite.generator``."""


    def build_references(self) -> Dict[str, Any]:
        """The scholarship on laïcité in the collection (view 11).

        Closes the loop between what the sources said and what has been
        written about them. Reported on its own axis throughout, because a
        reference's date is the date of the analysis, not of the events.
        """
        scans = self.scan_all()
        refs = [s for s in scans if s.subset == "references"]

        by_year: Counter = Counter()
        by_type: Counter = Counter()
        by_language: Counter = Counter()
        by_country: Counter = Counter()
        items: List[Dict[str, Any]] = []

        for s in refs:
            extra = s.extra or {}
            languages = [lang for lang in extra.get("languages", []) if lang]
            kind = extra.get("resource_class") or ""
            if s.year:
                by_year[s.year] += 1
            if kind:
                by_type[kind] += 1
            for lang in languages:
                by_language[lang] += 1
            for country in s.countries:
                by_country[country] += 1
            items.append({
                "o_id": s.o_id,
                "title": s.title,
                "author": extra.get("author", ""),
                "year": s.year,
                "type": kind,
                "languages": languages,
                "countries": s.countries,
                "occurrences": sum(s.frame_counts.values()),
                "tagged": s.is_tagged,
            })

        items.sort(key=lambda r: (-(r["year"] or 0), r["title"]))
        years = sorted(by_year)
        self.logger.info(
            f"  references: {len(items)} works, {len(by_type)} types, "
            f"{len(by_language)} languages")
        return {
            "generated_at": generate_timestamp(),
            "count": len(items),
            "tagged": sum(1 for r in items if r["tagged"]),
            "years": years,
            "by_year": [by_year[y] for y in years],
            "by_type": dict(by_type.most_common()),
            "by_language": dict(by_language.most_common()),
            "by_country": dict(by_country.most_common()),
            "items": items,
            "note": (
                "Dated by publication of the analysis, never by the period "
                "analysed — this axis is not comparable with the timeline."
            ),
        }
