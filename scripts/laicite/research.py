"""Coverage and extraction sensitivity on every input row, including negatives.

The cells ship inside ``laicite-trends.json`` under ``research`` — the
timeline's shared filters are computed over them — and nowhere else.
"""
from collections import Counter, defaultdict

from iwac_utils import generate_timestamp
from laicite.lexicon import fold_preserving
from laicite.scan import METHOD_VERSION, MINIMUM_CELL

# Descriptive fields that older versions of the instrument searched. They no
# longer select or annotate anything; a core match found ONLY here is
# reported as a sensitivity figure, never counted.
LEGACY_DESCRIPTION_FIELDS = ("descriptionAI", "abstract", "tableOfContents")


class ResearchMixin:
    def _observe_source(self, row, subset, scanned):
        """Keep metadata and counts only; never export unavailable source text.

        ``scanned`` is the row's ``RowScan``: its metadata was parsed once,
        and its title/OCR already folded and matched, by ``_scan_row`` — so
        this record and the dossier's ``ItemScan`` read one row one way.
        """
        rec, meta = scanned.rec, scanned.meta
        core = set(self.lex.membership_frames)
        title, ocr = row.get("title"), row.get("OCR")
        title_available = isinstance(title, str) and bool(title.strip())
        fulltext_available = isinstance(ocr, str) and bool(ocr.strip())
        hits = Counter(o.field for o in rec.occurrences
                       if o.frame in core) if rec else Counter()
        record = {
            "id": meta.o_id, "subset": subset, "url": meta.iwac_url,
            "year": meta.year,
            "countries": meta.countries,
            "outlet": meta.newspaper,
            "languages": meta.languages,
            "title_available": title_available,
            "fulltext_available": fulltext_available,
            "public_fulltext": fulltext_available and meta.ocr_public,
            "title_hits": hits["title"], "fulltext_hits": hits["OCR"],
            "broad_title_hits": scanned.broad_hits["title"],
            "broad_fulltext_hits": scanned.broad_hits["OCR"],
            "selected": rec is not None, "tagged": bool(rec and rec.is_tagged),
            # Membership strength, so the worklist can be coded route by
            # route. Empty for a row the dossier did not select.
            "route": rec.membership_route if rec else "",
            "legacy_description_match": self._legacy_description_match(row),
            "month": meta.month,
            "hijri_month": meta.hijri_month,
            "authors": meta.authors,
        }
        self.source_records.append(record)
        if subset == "articles":
            self._sentiment_source_rows.append((record, {
                c: row.get(c) for cols in self._sentiment_cols.values()
                for c in cols.values() if c
            }))

    def _legacy_description_match(self, row):
        """Would a retired descriptive field have matched the core vocabulary?"""
        patterns = [self.lex.patterns[k] for k in self.lex.membership_frames]
        for f in LEGACY_DESCRIPTION_FIELDS:
            value = row.get(f)
            if not isinstance(value, str) or not value.strip():
                continue
            folded = fold_preserving(value)
            if any(p.search(folded) for p in patterns):
                return True
        return False

    def build_research(self):
        """The coverage cells, built once per run.

        Cached: ``build_trends`` embeds them, and they are a pass over every
        source row of every subset — no reason to make it twice.
        """
        if self._research is not None:
            return self._research
        self.scan_all()
        groups = defaultdict(Counter)
        for r in self.source_records:
            # Explicit all-country row: multi-country items count once here.
            # A row naming no country appears only in that row.
            for country in [""] + sorted(set(c for c in r["countries"] if c)):
                key = (r["subset"], r["year"], country, r["outlet"])
                c = groups[key]
                c["records"] += 1
                c["union_available"] += int(r["title_available"] or r["fulltext_available"])
                for f in ("title_available", "fulltext_available", "public_fulltext",
                          "selected", "tagged"):
                    c[f] += int(r[f])
                for prefix in ("", "broad_"):
                    for field in ("title", "fulltext"):
                        c[prefix + field + "_matches"] += int(r[prefix + field + "_hits"] > 0)
                        c[prefix + field + "_hits"] += r[prefix + field + "_hits"]
                    c[prefix + "union_matches"] += int(bool(
                        r[prefix + "title_hits"] or r[prefix + "fulltext_hits"]))
                c["legacy_only"] += int(r["legacy_description_match"] and not (
                    r["broad_title_hits"] or r["broad_fulltext_hits"] or r["tagged"]))
        self._research = {
            "generated_at": generate_timestamp(),
            "method_version": METHOD_VERSION, "minimum_cell": MINIMUM_CELL,
            "note": "Counts use every source row; no descriptions contribute to observed vocabulary. Broad matches are unvalidated candidates. Country totals overlap; all-country rows deduplicate items.",
            "cells": [dict(subset=k[0], year=k[1], country=k[2], outlet=k[3], **v)
                      for k, v in sorted(groups.items(), key=lambda kv: str(kv[0]))],
        }
        return self._research

    def validation_sample(self, per_stratum=10):
        """Reproducible metadata-only worklist. Human judgements stay blank."""
        import random
        groups = defaultdict(list)
        for r in self.source_records:
            strict = r["title_hits"] + r["fulltext_hits"]
            broad = r["broad_title_hits"] + r["broad_fulltext_hits"]
            stratum = ("core_positive" if strict else "ambiguous_candidate" if broad
                       else "tag_only" if r["tagged"] else "apparent_negative")
            decade = (r["year"] // 10) * 10 if r["year"] else None
            # One label per record, whatever order or spacing the catalogue
            # wrote the languages in, so a multilingual record sits in one
            # stratum rather than in whichever spelling it happened to carry.
            language = " | ".join(sorted(set(r["languages"])))
            groups[(r["subset"], language, decade, stratum)].append(r)
        rng = random.Random(20260912)
        result = []
        for key, rows in sorted(groups.items(), key=lambda kv: str(kv[0])):
            for r in rng.sample(rows, min(per_stratum, len(rows))):
                result.append({
                    "id": r["id"], "url": r["url"],
                    "subset": key[0], "language": key[1], "decade": key[2],
                    "stratum": key[3], "route": r["route"],
                    "population": len(rows),
                    "sampled": min(per_stratum, len(rows)),
                    "fulltext_available": r["fulltext_available"],
                    "public_fulltext": r["public_fulltext"],
                    "relevant": None, "claimant": "", "addressee": "",
                    "issue": "", "proposed_state_action": "", "stance": "",
                    "coder": "", "evidence_locator": "", "notes": "",
                })
        return result
