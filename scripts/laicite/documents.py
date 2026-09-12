"""The archival dossier — ``laicite-documents.json``.
"""
from __future__ import annotations

from typing import Any, Dict, List

from iwac_utils import generate_timestamp



class DocumentsMixin:
    """``LaiciteGenerator``'s documents half. Mixed in by ``laicite.generator``."""


    def build_documents(self) -> Dict[str, Any]:
        """The primary-source dossier — every matching `documents` item.

        Small by row count, large by research value: these are statutes,
        minutes, ministerial reports and petitions rather than coverage, and
        25 of 26 carry public text. They are emitted whole and never
        averaged into the press counts anywhere.
        """
        scans = [s for s in self.scan_all() if s.subset == "documents"]
        docs: List[Dict[str, Any]] = []
        for s in sorted(scans, key=lambda r: (r.year or 0, r.title)):
            texts = self.texts.get((s.subset, s.o_id), {})
            docs.append({
                "o_id": s.o_id,
                "title": s.title,
                "url": s.iwac_url,
                "year": s.year,
                "date": s.extra.get("pub_date", ""),
                "author": s.extra.get("author", ""),
                "type": s.extra.get("type", ""),
                "nb_pages": s.extra.get("nb_pages", 0),
                "nb_mots": s.nb_mots,
                "description": s.extra.get("description", ""),
                "countries": s.countries,
                "subjects": s.subjects,
                "spatial": s.spatial,
                "is_tagged": s.is_tagged,
                "ocr_public": s.ocr_public,
                "frame_counts": s.frame_counts,
                "occurrences": len(s.occurrences),
                "has_text": bool(texts.get("OCR")),
            })
        self.logger.info(f"Documents dossier: {len(docs)} primary sources")
        return {
            "generated_at": generate_timestamp(),
            "note": (
                "Primary sources — statutes, minutes, ministerial reports, "
                "petitions. Never summed with press coverage."
            ),
            "documents": docs,
            "concentration": {"items": len(docs),
                "occurrences": sum(len(s.occurrences) for s in self.scans if s.subset == "documents"),
                "largest_document_occurrences": max((len(s.occurrences) for s in self.scans
                                                      if s.subset == "documents"), default=0)},
        }
