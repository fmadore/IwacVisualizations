"""KPIs, the tag-vs-text split, and the per-country aggregates.

``laicite-metadata.json`` and ``laicite-countries.json``. The metadata bundle
is where the two denominators live — items scanned vs items quotable, per
subset — because the rights split is wildly uneven and one global percentage
would imply an evenness that does not exist.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, List

from iwac_utils import generate_timestamp

from laicite.scan import SUBSET_FIELDS


class OverviewMixin:
    """``LaiciteGenerator``'s overview half. Mixed in by ``laicite.generator``."""


    def build_metadata(self) -> Dict[str, Any]:
        """KPIs, the tag-vs-text Venn, and the rights split — per subset."""
        scans = self.scan_all()
        per_subset: Dict[str, Any] = {}

        for subset in SUBSET_FIELDS:
            sub = [s for s in scans if s.subset == subset]
            tagged = sum(1 for s in sub if s.is_tagged)
            said = sum(1 for s in sub if s.said)
            both = sum(1 for s in sub if s.is_tagged and s.said)
            occ = sum(len(s.occurrences) for s in sub)
            quotable = sum(
                1 for s in sub for o in s.occurrences if o.quotable
            )
            years = [s.year for s in sub if s.year]
            per_subset[subset] = {
                "corpus_size": self.subset_totals.get(subset, 0),
                "members": len(sub),
                "tagged": tagged,
                "said": said,
                "tagged_and_said": both,
                "tagged_only": tagged - both,
                "said_only": said - both,
                "occurrences": occ,
                "quotable_occurrences": quotable,
                # The rights split, reported per subset — never as one
                # global percentage, which would imply an evenness that
                # does not exist (documents 25/26, references 7/867).
                "corpus_ocr_public": self.subset_public.get(subset, 0),
                "members_ocr_public": sum(1 for s in sub if s.ocr_public),
                "laity_demoted": sum(s.laity_demoted for s in sub),
                "year_range": [min(years), max(years)] if years else [],
            }

        countries = sorted({c for s in scans for c in s.countries})
        years = [s.year for s in scans if s.year]

        # Frame counts are reported PER SUBSET and never as one cross-subset
        # total. A single 300-page monograph in `references` contributes
        # hundreds of occurrences where a news item contributes three, so a
        # summed frame ranking would be a ranking of book lengths. The
        # per-item medians below are what makes the subsets comparable.
        frame_by_subset: Dict[str, Dict[str, Any]] = {}
        for subset in SUBSET_FIELDS:
            sub = [s for s in scans if s.subset == subset]
            totals: Dict[str, int] = defaultdict(int)
            items: Dict[str, int] = defaultdict(int)
            for s in sub:
                for frame, count in s.frame_counts.items():
                    totals[frame] += count
                    items[frame] += 1
            frame_by_subset[subset] = {
                "occurrences": dict(totals),
                "items": dict(items),
                # Share of this subset's members touching each frame — the
                # cross-subset-comparable figure.
                "item_share": {
                    f: round(n / len(sub), 4) for f, n in items.items()
                } if sub else {},
            }

        return {
            "generated_at": generate_timestamp(),
            "data_source": self.repo_id,
            "authority": self.lex.authority,
            "membership_rule": {
                "frames": self.lex.membership_frames,
                "note": self.lex.raw.get("_membership", ""),
            },
            "frames": self.lex.frame_labels(),
            "frame_order": list(self.lex.frames.keys()),
            "frame_by_subset": frame_by_subset,
            "frame_definitions": {
                name: list(spec["forms"]) for name, spec in self.lex.frames.items()
            },
            "subsets": per_subset,
            "totals": {
                "members": len(scans),
                "tagged": sum(1 for s in scans if s.is_tagged),
                "said": sum(1 for s in scans if s.said),
                "occurrences": sum(len(s.occurrences) for s in scans),
                "laity_demoted": sum(s.laity_demoted for s in scans),
                "countries": len(countries),
                "newspapers": len({s.newspaper for s in scans if s.newspaper}),
            },
            "countries": countries,
            "year_range": [min(years), max(years)] if years else [],
            # The full range runs to ~105 years because a handful of
            # `references` predate the press corpus by decades (earliest
            # 1922). Plotting that raw leaves four fifths of the axis empty,
            # so the client opens on the window where the evidence actually
            # sits and lets the reader zoom back out to the full range.
            "focus_range": self._focus_range(years),
            # Which text layer each subset was matched against, so the panel
            # can state what was actually searched rather than implying a
            # uniform full-text scan (references are mostly title+abstract:
            # only 423/867 carry OCR at all, and 7 are public).
            "matched_fields": {
                subset: [c for c, _ in fields]
                for subset, fields in SUBSET_FIELDS.items()
            },
            "rights_note": (
                "Counts are computed over all text; only readable snippets are "
                "gated on OCR_is_public, per source field."
            ),
        }

    @staticmethod
    def _focus_range(years: List[int], min_items: int = 3) -> List[int]:
        """The window holding the bulk of the evidence.

        Starts at the first year carrying ``min_items`` dossier items — the
        long thin tail of early scholarship is real data, not noise, but it
        should not set the default axis for a press-coverage timeline.
        """
        if not years:
            return []
        counts = Counter(years)
        dense = sorted(y for y, n in counts.items() if n >= min_items)
        if not dense:
            return [min(years), max(years)]
        return [dense[0], max(years)]

    def build_countries(self) -> Dict[str, Any]:
        """Per-country aggregates, split by subset and by frame."""
        scans = self.scan_all()
        out: Dict[str, Any] = {}
        for s in scans:
            for country in s.countries:
                bucket = out.setdefault(country, {
                    "items": 0,
                    "tagged": 0,
                    "occurrences": 0,
                    "by_subset": defaultdict(int),
                    "by_frame": defaultdict(int),
                    "newspapers": Counter(),
                    "years": Counter(),
                })
                bucket["items"] += 1
                bucket["tagged"] += 1 if s.is_tagged else 0
                bucket["occurrences"] += len(s.occurrences)
                bucket["by_subset"][s.subset] += 1
                for frame, count in s.frame_counts.items():
                    bucket["by_frame"][frame] += count
                if s.newspaper:
                    bucket["newspapers"][s.newspaper] += 1
                if s.year:
                    bucket["years"][str(s.year)] += 1

        result: Dict[str, Any] = {}
        for country, bucket in sorted(out.items()):
            if bucket["items"] < self.min_country_items:
                continue
            result[country] = {
                "items": bucket["items"],
                "tagged": bucket["tagged"],
                "occurrences": bucket["occurrences"],
                "by_subset": dict(bucket["by_subset"]),
                "by_frame": dict(sorted(
                    bucket["by_frame"].items(), key=lambda kv: -kv[1])),
                "top_newspapers": bucket["newspapers"].most_common(12),
                "by_year": dict(sorted(bucket["years"].items())),
            }
        return {
            "generated_at": generate_timestamp(),
            "min_country_items": self.min_country_items,
            "countries": result,
        }
