#!/usr/bin/env python3
"""Offline helper for Tier 2 rhetorical annotation (specialist review & LLM triage).

Why a separate helper:
``generate_albani_sermons.py`` is strictly deterministic and makes no model
calls. Detecting subtle figures of thought in Hausa sermons — irony, sarcasm,
humour, proverbs (*karin magana*), extended metaphors, and historical exempla
(*qissa*) — requires human judgement, optionally assisted by an offline LLM
triage pass over the ~433 twenty-minute segments.

This helper supports two round-trip steps:

1. ``import-csv``: fold a specialist-reviewed CSV (exported via
   ``generate_albani_sermons.py --style-review-sheet``) back into
   ``scripts/albani/rhetoric_annotations.json`` for every row whose ``verdict``
   column is ``accept`` (or ``yes`` / ``ok`` / ``1``).
2. ``format-prompt``: build a structured JSONL batch of segment prompts from
   an exported ``rhetoric.json`` or local transcripts directory for offline
   LLM triage; LLM outputs are NEVER published directly — they go into the
   same review CSV for human validation first.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any, Dict, List

DEFAULT_ANNOTATIONS = Path(__file__).with_name("rhetoric_annotations.json")

SYSTEM_PROMPT = (
    "You are assisting a Hausa Islamic studies specialist analysing oral sermons "
    "by Shaykh Muhammad Auwal Albani Zaria. Identify candidate rhetorical tropes "
    "in the supplied Hausa/Arabic transcript segment: proverb_idiom (karin magana), "
    "metaphor (extended metaphor or vivid simile), polemic_irony (irony, sarcasm, "
    "humour, or pointed polemic), or simile_exemplum (parable or historical exemplum). "
    "Return JSON: {\"candidates\": [{\"device\": ..., \"quote\": \"exact substring\", "
    "\"note_en\": \"one sentence\", \"note_fr\": \"une phrase\"}]}. "
    "Only flag genuine figures of speech; return an empty list when none are present."
)

ACCEPT_VALUES = frozenset({"accept", "accepted", "yes", "y", "ok", "1", "true", "oui"})


def _parse_window_start(window: str) -> int:
    """Turn ``MM:SS–MM:SS`` or ``HH:MM:SS–…`` into start seconds."""
    head = (window or "").split("–")[0].split("-")[0].strip()
    parts = [int(p) for p in head.split(":") if p.isdigit()]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return 0


def import_review_csv(csv_path: Path, out_path: Path = DEFAULT_ANNOTATIONS) -> int:
    """Fold accepted rows from a specialist review CSV into ``rhetoric_annotations.json``."""
    accepted: List[Dict[str, Any]] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            verdict = (row.get("verdict") or "").strip().lower()
            if verdict not in ACCEPT_VALUES:
                continue
            device = (row.get("revised_device") or row.get("device") or "").strip()
            quote = (row.get("matched_text") or "").strip()
            note = (row.get("analyst_note") or "").strip()
            accepted.append({
                "o": str(row.get("recording_id") or "").strip(),
                "part": int(row.get("part") or 1),
                "start_s": _parse_window_start(row.get("window") or ""),
                "device": device,
                "quote": quote,
                "note_en": note,
                "note_fr": note,
            })

    payload = {
        "_comment": (
            "Specialist-validated rhetorical annotations imported from review CSV. "
            "Quotes are rights-gated by generate_albani_sermons.py."
        ),
        "status": "validated" if accepted else "draft",
        "annotations": accepted,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(accepted)


def export_triage_prompts(transcripts_dir: Path, out_jsonl: Path) -> int:
    """Write one JSONL prompt record per public ``<o:id>.txt`` transcript file."""
    count = 0
    out_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with out_jsonl.open("w", encoding="utf-8") as handle:
        for path in sorted(transcripts_dir.glob("*.txt")):
            text = path.read_text(encoding="utf-8").strip()
            if not text:
                continue
            record = {
                "custom_id": path.stem,
                "system": SYSTEM_PROMPT,
                "user": text[:16000],
            }
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    imp = sub.add_parser("import-csv", help="Import accepted rows from a specialist review CSV.")
    imp.add_argument("csv", type=Path)
    imp.add_argument("--out", type=Path, default=DEFAULT_ANNOTATIONS)

    prm = sub.add_parser("export-prompts", help="Export JSONL prompts for offline LLM trope triage.")
    prm.add_argument("transcripts_dir", type=Path)
    prm.add_argument("--out", type=Path, required=True)

    args = parser.parse_args()
    if args.cmd == "import-csv":
        n = import_review_csv(args.csv, args.out)
        print(f"Wrote {n} validated annotation(s) to {args.out}")
    elif args.cmd == "export-prompts":
        n = export_triage_prompts(args.transcripts_dir, args.out)
        print(f"Wrote {n} prompt record(s) to {args.out}")


if __name__ == "__main__":
    main()
