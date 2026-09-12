"""KWIC rows — ``laicite-concordance*.json``. RIGHTS-GATED.

A snippet cut from ``OCR`` is emitted only when the row's ``OCR_is_public``
flag is true. The gate is per source field, not per item: a title match is
quotable even when the same item's ``OCR`` is not. Descriptive fields are
never searched or quoted in this concordance. Never relax the OCR gate.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Dict, List, Tuple

from iwac_utils import generate_timestamp

from laicite.scan import PER_ITEM_SNIPPET_CAP, SUBSET_FIELDS


SNIPPET_CONTEXT = 120   # characters either side of the match


class ConcordanceMixin:
    """``LaiciteGenerator``'s concordance half. Mixed in by ``laicite.generator``."""


    def build_concordance(self) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]]]:
        """KWIC rows with ±%d characters of context, rights-gated per field.

        Returns ``(index, per_subset_files)``. The rows fan out into one file
        per subset and are **normalized** — item identity (title, URL, year,
        country, newspaper) lives once in an ``items`` table and each row
        carries an index into it. A flat denormalized bundle measured 3.3 MB
        for 6,000 rows; this shape plus the fan-out puts the largest single
        file under a megabyte, and the reader only ever loads the corpus they
        are actually browsing.

        Sampling preserves the decade × country distribution rather than
        truncating by sort order, so capping does not silently turn the
        concordance into "the first N years of Côte d'Ivoire".
        """ % SNIPPET_CONTEXT
        scans = self.scan_all()
        per_subset_rows: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

        for s in scans:
            texts = self.texts.get((s.subset, s.o_id), {})
            cap = PER_ITEM_SNIPPET_CAP.get(s.subset)
            quotable = [o for o in s.occurrences if o.quotable and o.field in texts]
            if cap is not None and len(quotable) > cap:
                # Spread the per-item sample across frames so a long item
                # does not spend its whole budget on one repeated word.
                quotable = self._sample_across(quotable, cap, key=lambda o: o.frame)
            for occ in quotable:
                raw = texts[occ.field]
                per_subset_rows[s.subset].append({
                    "_scan": s,
                    "decade": (s.year // 10 * 10) if s.year else None,
                    "f": occ.frame,
                    "d": occ.field,
                    "l": self._clean_snippet(
                        raw[max(0, occ.start - SNIPPET_CONTEXT):occ.start], "left"),
                    "m": raw[occ.start:occ.end].strip(),
                    "r": self._clean_snippet(
                        raw[occ.end:occ.end + SNIPPET_CONTEXT], "right"),
                })

        files: Dict[str, Dict[str, Any]] = {}
        by_subset_counts: Dict[str, Dict[str, int]] = {}
        for subset in SUBSET_FIELDS:
            sub = [s for s in scans if s.subset == subset]
            occ_total = sum(len(s.occurrences) for s in sub)
            quotable_total = sum(1 for s in sub for o in s.occurrences if o.quotable)

            rows = per_subset_rows.get(subset, [])
            if len(rows) > self.max_snippets:
                rows = self._sample_across(
                    rows, self.max_snippets,
                    key=lambda r: (r["decade"],
                                   r["_scan"].countries[0] if r["_scan"].countries else ""),
                )
            rows.sort(key=lambda r: (r["_scan"].year or 0, r["_scan"].o_id))

            # Normalize: one entry per distinct item, rows point at it.
            items: List[Dict[str, Any]] = []
            index_of: Dict[str, int] = {}
            out_rows: List[Dict[str, Any]] = []
            for r in rows:
                s = r.pop("_scan")
                if s.o_id not in index_of:
                    index_of[s.o_id] = len(items)
                    entry = {
                        "o": s.o_id, "t": s.title, "u": s.iwac_url,
                        "y": s.year, "c": s.countries,
                    }
                    if s.newspaper:
                        entry["n"] = s.newspaper
                    if s.is_tagged:
                        entry["g"] = 1
                    items.append(entry)
                r.pop("decade", None)
                r["i"] = index_of[s.o_id]
                out_rows.append(r)

            files[subset] = {
                "generated_at": generate_timestamp(),
                "subset": subset,
                "context_chars": SNIPPET_CONTEXT,
                "items": items,
                "rows": out_rows,
            }
            by_subset_counts[subset] = {
                "occurrences": occ_total,
                "quotable": quotable_total,
                "withheld": occ_total - quotable_total,
                "emitted": len(out_rows),
                "items": len(items),
                "file": f"laicite-concordance-{subset}.json",
            }
            self.logger.info(
                f"  concordance/{subset}: {len(out_rows)} snippets over "
                f"{len(items)} items ({quotable_total} quotable of {occ_total} "
                f"occurrences; {occ_total - quotable_total} withheld by rights)")

        total_occ = sum(v["occurrences"] for v in by_subset_counts.values())
        total_quotable = sum(v["quotable"] for v in by_subset_counts.values())
        total_emitted = sum(v["emitted"] for v in by_subset_counts.values())
        self.logger.info(
            f"Concordance: {total_emitted} snippets emitted "
            f"({total_quotable} quotable of {total_occ} occurrences; "
            f"{total_occ - total_quotable} withheld by the rights gate)")

        index = {
            "generated_at": generate_timestamp(),
            "context_chars": SNIPPET_CONTEXT,
            "max_snippets_per_subset": self.max_snippets,
            "per_item_cap": dict(PER_ITEM_SNIPPET_CAP),
            "totals": {
                "occurrences": total_occ,
                "quotable": total_quotable,
                "withheld": total_occ - total_quotable,
                "emitted": total_emitted,
            },
            "by_subset": by_subset_counts,
            "row_keys": {
                "i": "index into items[]", "f": "frame", "d": "source field",
                "l": "left context", "m": "match", "r": "right context",
            },
        }
        return index, files

    def _sample_across(self, items: List[Any], cap: int, key) -> List[Any]:
        """Proportional stratified sample using largest-remainder quotas."""
        if len(items) <= cap:
            return items
        strata: Dict[Any, List[Any]] = defaultdict(list)
        for it in items:
            strata[key(it)].append(it)
        for bucket in strata.values():
            self.rng.shuffle(bucket)
        out: List[Any] = []
        order = sorted(strata.keys(), key=lambda k: str(k))
        quotas = {k: cap * len(strata[k]) // len(items) for k in order}
        remainder = sorted(order, key=lambda k: -(cap * len(strata[k]) % len(items)))
        for k in remainder[:cap - sum(quotas.values())]:
            quotas[k] += 1
        for k in order:
            out.extend(strata[k][:quotas[k]])
        return out

    @staticmethod
    def _clean_snippet(text: str, side: str) -> str:
        """Collapse OCR whitespace so a KWIC line stays one line.

        Only the OUTER edge is trimmed. Stripping both would delete the
        space that separates the context from the highlighted match, and
        the rendered line would read "respect de lalaïcitépar le
        gouvernement" — the match is a separate element, so nothing else
        puts that boundary back.
        """
        collapsed = re.sub(r"\s+", " ", text)
        return collapsed.lstrip() if side == "left" else collapsed.rstrip()
