"""Coverage and extraction sensitivity on every input row, including negatives."""
from collections import Counter, defaultdict

from iwac_utils import extract_month_num, extract_year, normalize_country, parse_pipe_separated, generate_timestamp
from laicite.lexicon import fold_preserving


class ResearchMixin:
    def _observe_source(self, row, subset, rec):
        """Keep metadata and counts only; never export unavailable source text."""
        texts = {f: row.get(f) if isinstance(row.get(f), str) else ""
                 for f in ("title", "OCR")}
        hits = Counter(o.field for o in rec.occurrences
                       if o.frame in self.lex.membership_frames) if rec else Counter()
        broad = {f: sum(len(list(self.lex.patterns[k].finditer(fold_preserving(t))))
                        for k in self.lex.membership_frames) for f, t in texts.items()}
        legacy = any(
            p.search(fold_preserving(row.get(f)))
            for f in ("descriptionAI", "abstract", "tableOfContents")
            if isinstance(row.get(f), str)
            for k, p in self.lex.patterns.items() if k in self.lex.membership_frames
        )
        year = extract_year(row.get("pub_date"))
        hm = row.get("hijri_month")
        try:
            hm = int(hm)
        except (ValueError, TypeError, OverflowError):
            hm = None
        record = {
            "id": str(row.get("o:id") or ""), "subset": subset,
            "year": int(year) if year else None,
            "countries": normalize_country(row.get("country"), return_list=True),
            "outlet": str(row.get("newspaper") or ""),
            "language": str(row.get("language") or ""),
            "title_available": bool(texts["title"].strip()),
            "fulltext_available": bool(texts["OCR"].strip()),
            "public_fulltext": bool(texts["OCR"].strip()) and row.get("OCR_is_public") is True,
            "title_hits": hits["title"], "fulltext_hits": hits["OCR"],
            "broad_title_hits": broad["title"], "broad_fulltext_hits": broad["OCR"],
            "selected": rec is not None, "tagged": bool(rec and rec.is_tagged),
            "legacy_description_match": legacy,
            "month": extract_month_num(row.get("pub_date")),
            "hijri_month": hm if hm and 1 <= hm <= 12 else None,
            "authors": sorted(set(parse_pipe_separated(row.get("author")))),
        }
        self.source_records.append(record)
        if subset == "articles":
            self._sentiment_source_rows.append((record, {
                c: row.get(c) for cols in self._sentiment_cols.values()
                for c in cols.values() if c
            }))

    def build_research(self):
        self.scan_all()
        groups = defaultdict(Counter)
        for r in self.source_records:
            # Explicit all-country row: multi-country items count once here.
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
        return {
            "generated_at": generate_timestamp(),
            "method_version": "source-text-v3", "minimum_cell": 5,
            "note": "Counts use every source row; no descriptions contribute to observed vocabulary. Broad matches are unvalidated candidates. Country totals overlap; all-country rows deduplicate items.",
            "cells": [dict(subset=k[0], year=k[1], country=k[2], outlet=k[3], **v)
                      for k, v in sorted(groups.items(), key=lambda kv: str(kv[0]))],
        }

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
            groups[(r["subset"], r["language"], decade, stratum)].append(r)
        rng = random.Random(20260912)
        result = []
        for key, rows in sorted(groups.items(), key=lambda kv: str(kv[0])):
            for r in rng.sample(rows, min(per_stratum, len(rows))):
                result.append({
                    "id": r["id"], "url": "https://islam.zmo.de/s/westafrica/item/" + r["id"],
                    "subset": key[0], "language": key[1], "decade": key[2],
                    "stratum": key[3], "population": len(rows),
                    "sampled": min(per_stratum, len(rows)),
                    "fulltext_available": r["fulltext_available"],
                    "public_fulltext": r["public_fulltext"],
                    "relevant": None, "claimant": "", "addressee": "",
                    "issue": "", "proposed_state_action": "", "stance": "",
                    "coder": "", "evidence_locator": "", "notes": "",
                })
        return result
