"""Who signs the beat, with denominators — ``laicite-bylines.json``.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict

from iwac_utils import generate_timestamp



# -----------------------------------------------------------------------
# Bylines (issue #19 F)
# -----------------------------------------------------------------------
# Enough to show the shape of a beat without turning the panel into a
# directory; the per-name floor (--min-byline-items) does the real
# filtering, and this only bounds the payload.
BYLINE_TOP_N = 40


class BylinesMixin:
    """``LaiciteGenerator``'s bylines half. Mixed in by ``laicite.generator``."""


    def build_bylines(self) -> Dict[str, Any]:
        """Who writes the laïcité beat, per outlet and per decade.

        The complement to the actors view, which answers who the coverage
        *names*. Together they are the actor picture the dossier needs:
        one is the subject of the writing, this is its source.

        **The denominator is the whole panel.** Byline coverage in the
        corpus is uneven — it varies by outlet and, sharply, by decade,
        because older material is more often unsigned and because OCR of
        a signature line is less reliable than OCR of body text. A ranked
        list of names on its own would read as "these journalists owned
        the beat" when part of the answer is "we do not know who wrote
        the rest". So every figure ships beside the count it is drawn
        from: ``signed`` against ``articles`` globally, and the same pair
        per decade and per outlet, so a reader can see where the record
        is thin before reading anything into a ranking over it.

        ``articles`` only: an issue of a periodical has no single byline,
        an archival document's author is a different kind of claim, and a
        reference's author is its scholar rather than a journalist.

        Bylines are NOT people. Press agencies (Agence Togolaise de
        Presse, PANA) sign alongside journalists and are left in, labelled
        as bylines, because an agency signature is exactly the circulation
        signal the neighbouring view measures another way.
        """
        articles = [s for s in self.scan_all() if s.subset == "articles"]
        total = len(articles)

        counts: Counter = Counter()
        first_year: Dict[str, int] = {}
        last_year: Dict[str, int] = {}
        by_paper: Dict[str, Counter] = defaultdict(Counter)
        by_decade_name: Dict[str, Counter] = defaultdict(Counter)
        # Coverage denominators, which are the point of the view.
        decade_signed: Counter = Counter()
        decade_total: Counter = Counter()
        paper_signed: Counter = Counter()
        paper_total: Counter = Counter()
        signed = 0

        for s in articles:
            decade = self._decade(s.year)
            if decade:
                decade_total[decade] += 1
            if s.newspaper:
                paper_total[s.newspaper] += 1
            if not s.authors:
                continue
            signed += 1
            if decade:
                decade_signed[decade] += 1
            if s.newspaper:
                paper_signed[s.newspaper] += 1
            for name in s.authors:
                counts[name] += 1
                if s.year is not None:
                    if name not in first_year or s.year < first_year[name]:
                        first_year[name] = s.year
                    if name not in last_year or s.year > last_year[name]:
                        last_year[name] = s.year
                if s.newspaper:
                    by_paper[name][s.newspaper] += 1
                if decade:
                    by_decade_name[name][decade] += 1

        top = [
            {
                "name": name,
                "count": int(count),
                "first": first_year.get(name),
                "last": last_year.get(name),
                "newspapers": [
                    {"name": paper, "count": int(n)}
                    for paper, n in by_paper[name].most_common(3)
                ],
                "by_decade": dict(sorted(by_decade_name[name].items())),
            }
            for name, count in counts.most_common(BYLINE_TOP_N)
            if count >= self.min_byline_items
        ]

        self.logger.info(
            "  bylines: %d of %d dossier articles signed (%d distinct names, "
            "%d at or above the %d-item floor)",
            signed, total, len(counts), len(top), self.min_byline_items)

        return {
            "generated_at": generate_timestamp(),
            "articles": total,
            "signed": signed,
            "unique": len(counts),
            "min_items": self.min_byline_items,
            "by_decade": [
                {
                    "decade": decade,
                    "articles": int(decade_total[decade]),
                    "signed": int(decade_signed[decade]),
                }
                for decade in sorted(decade_total)
            ],
            "by_newspaper": [
                {
                    "name": paper,
                    "articles": int(paper_total[paper]),
                    "signed": int(paper_signed[paper]),
                }
                for paper, _ in paper_total.most_common()
                if paper_total[paper] >= self.min_newspaper_items
            ],
            "top": top,
        }
