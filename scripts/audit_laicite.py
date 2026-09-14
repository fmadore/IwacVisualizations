#!/usr/bin/env python3
"""
audit_laicite.py — incremental model-assisted screen of the Laïcité dossier.

The dossier is selected by a curated tag and a lexicon; both admit records
that a reader would not call relevant (an incidental "école laïque", a job
title, a cited book title). A screen by a language model reading the full
text, under a written rule, is a cheap triage of that noise — but only if
its verdicts are kept, so that a re-run after new articles are ingested
judges the new records and not the 1,244 already read.

That memory is ``scripts/laicite/audit_ledger.json``, committed to the
repository. It stores identifiers, verdicts, the date, the model and a hash
of the rule text — never any source text and never the readers' free-text
notes, which can quote private OCR and stay under ``.test-tmp``.

Subcommands
-----------
    extract   scan the corpus, write batch files for every member (tier 2)
              and every judgeable annotation occurrence (tier 1) that the
              ledger does not already cover, plus a manifest
    merge     fold the verdict files a reader wrote into the ledger
    status    what the ledger covers, what is stale, what is unjudged

Workflow
--------
    python scripts/audit_laicite.py extract --work-dir .test-tmp/laicite-audit
    # one reader per batch file: reads scripts/laicite/audit/INSTRUCTIONS-tier*.md,
    # writes <work-dir>/verdicts/<same name>.json
    python scripts/audit_laicite.py merge --work-dir .test-tmp/laicite-audit
    python scripts/audit_laicite.py status

The generator reads the ledger at build time and publishes only aggregates
(``laicite-metadata.json`` → ``audit_screen``). Batches and verdicts contain
private full text and must never leave ``.test-tmp`` (gitignored).

Tier 1 rows are keyed by a fingerprint of the folded text ±60 characters
around the match, so a verdict survives a re-scan that shifts offsets and is
invalidated only when the passage itself changes. Tier 2 records carry a
fingerprint of their core-hit forms; a member whose hits changed since it was
judged is reported as *stale* and re-extracted only with ``--include-stale``.

Environment
-----------
    HF_TOKEN    required (private full mirror, see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent))

from laicite import LaiciteGenerator  # noqa: E402
from laicite.audit_ledger import LEDGER_PATH, load_ledger as _read_ledger  # noqa: E402
from laicite.lexicon import ASCII_TOKEN_RE, fold_plain, fold_preserving  # noqa: E402

PACKAGE = Path(__file__).resolve().parent / "laicite"
RULES_DIR = PACKAGE / "audit"
RULE_FILES = {1: "INSTRUCTIONS-tier1.md", 2: "INSTRUCTIONS-tier2.md"}

WINDOW = 500          # chars each side shown to the reader, tier 1
CORE_WINDOW = 400     # chars each side around a core hit, tier 2
FP_WINDOW = 60        # chars each side folded into the tier-1 fingerprint
MAX_CORE_WINDOWS = 6
NEARBY_TOKENS = 80    # the arenas rule
T1_BATCH = 100
T2_BATCH = 40


# ---------------------------------------------------------------------------
# ledger

README = (
            "Verdicts of the model-assisted relevance screen of the Laïcité "
            "dossier (scripts/audit_laicite.py). Identifiers, verdicts, dates, "
            "model and rule hash only: no source text, no reader notes. "
            "members: '<subset>:<o:id>' → tier-2 verdict. occurrences: "
            "fingerprint → tier-1 verdict. rules: hash → tier and file."
)


def load_ledger() -> Dict[str, Any]:
    """The generator's own reader (``laicite.audit_ledger``), so the two never
    disagree about what a ledger is; the readme is re-attached on save."""
    return _read_ledger(LEDGER_PATH)


def save_ledger(ledger: Dict[str, Any]) -> None:
    ledger = {"_readme": README, **{k: ledger[k] for k in ("rules", "members", "occurrences")}}
    ledger["members"] = dict(sorted(ledger["members"].items()))
    ledger["occurrences"] = dict(sorted(ledger["occurrences"].items()))
    # One record per line: a merge then diffs as the rows it added, and the
    # file stays a quarter of the size a field-per-line dump would be.
    lines = ["{", ' "_readme": ' + json.dumps(ledger["_readme"], ensure_ascii=False) + ",",
             ' "rules": ' + json.dumps(ledger["rules"], ensure_ascii=False) + ","]
    for section in ("members", "occurrences"):
        lines.append(f' "{section}": {{')
        items = list(ledger[section].items())
        for i, (key, value) in enumerate(items):
            comma = "," if i < len(items) - 1 else ""
            lines.append(f'  {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)}{comma}')
        lines.append(" }" + ("," if section == "members" else ""))
    lines.append("}")
    LEDGER_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def rule_hash(tier: int) -> str:
    text = (RULES_DIR / RULE_FILES[tier]).read_text(encoding="utf-8")
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def register_rules(ledger: Dict[str, Any]) -> Dict[int, str]:
    out = {}
    for tier, name in RULE_FILES.items():
        h = rule_hash(tier)
        ledger["rules"].setdefault(h, {"tier": tier, "file": f"laicite/audit/{name}",
                                       "first_used": date.today().isoformat()})
        out[tier] = h
    return out


def member_key(subset: str, o_id: str) -> str:
    return f"{subset}:{o_id}"


def hits_fingerprint(forms: List[str]) -> str:
    return hashlib.sha1("|".join(sorted(fold_plain(f) for f in forms)).encode()).hexdigest()[:12]


def occurrence_fingerprint(subset: str, o_id: str, frame: str, field: str,
                           text: str, start: int, end: int) -> str:
    around = fold_plain(text[max(0, start - FP_WINDOW):start]) + "«" \
        + fold_plain(text[start:end]) + "»" + fold_plain(text[end:end + FP_WINDOW])
    around = re.sub(r"\s+", " ", around)
    return hashlib.sha1(f"{subset}|{o_id}|{frame}|{field}|{around}".encode()).hexdigest()[:16]


def fingerprint_from_window(subset: str, o_id: str, frame: str, field: str,
                            window: str) -> str:
    """The same fingerprint recomputed from a batch row's «»-marked window."""
    a, b = window.index("«"), window.index("»")
    around = fold_plain(window[max(0, a - FP_WINDOW):a]) + "«" \
        + fold_plain(window[a + 1:b]) + "»" + fold_plain(window[b + 1:b + 1 + FP_WINDOW])
    around = re.sub(r"\s+", " ", around)
    return hashlib.sha1(f"{subset}|{o_id}|{frame}|{field}|{around}".encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# extract

class AuditGenerator(LaiciteGenerator):
    """The scan, plus the two per-row fields the batches need."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.descriptions: Dict[Any, str] = {}
        self.languages: Dict[Any, str] = {}

    def _observe_source(self, row, subset, rec):
        if rec is not None:
            key = (subset, rec.o_id)
            self.descriptions[key] = str(row.get("descriptionAI") or "").strip()
            self.languages[key] = str(row.get("language") or "")
        super()._observe_source(row, subset, rec)


def clip(text: str, start: int, end: int, pad: int) -> str:
    lo, hi = max(0, start - pad), min(len(text), end + pad)
    return text[lo:start] + "«" + text[start:end] + "»" + text[end:hi]


def token_distance(folded: str, a_end: int, b_start: int) -> int:
    lo, hi = (a_end, b_start) if a_end <= b_start else (b_start, a_end)
    return len(ASCII_TOKEN_RE.findall(folded[lo:hi]))


def route_of(s) -> str:
    """Membership route, from the scan when the generator emits it."""
    r = getattr(s, "membership_route", None)
    if r:
        return r
    if s.is_tagged and s.membership_hits:
        return "tag+text"
    if s.is_tagged:
        return "tag-only"
    return "text>=2" if s.membership_hits >= 2 else "text=1"


def cmd_extract(args: argparse.Namespace) -> None:
    work = Path(args.work_dir)
    (work / "batches").mkdir(parents=True, exist_ok=True)
    (work / "verdicts").mkdir(parents=True, exist_ok=True)
    ledger = load_ledger()
    gen = AuditGenerator(output_dir=work / "_scratch", repo_id=args.repo)
    gen.scan_all()
    core = set(gen.lex.membership_frames)
    frames_wanted = set(args.frames.split(",")) if args.frames else None

    tier1: List[Dict[str, Any]] = []
    tier2: List[Dict[str, Any]] = []
    skipped = Counter()
    for s in gen.scans:
        texts = gen.texts.get((s.subset, s.o_id), {})
        folded = {f: fold_preserving(t) for f, t in texts.items()}
        core_occ = [o for o in s.occurrences if o.frame in core]
        core_by_field = defaultdict(list)
        for o in core_occ:
            core_by_field[o.field].append(o)
        core_forms = [texts[o.field][o.start:o.end] for o in core_occ if o.field in texts]

        if args.tier in ("1", "both"):
            for o in s.occurrences:
                if o.frame in core or o.field not in texts:
                    continue
                if frames_wanted and o.frame not in frames_wanted:
                    continue
                text = texts[o.field]
                near = any(
                    token_distance(folded[o.field], c.end, o.start) <= NEARBY_TOKENS
                    or token_distance(folded[o.field], o.end, c.start) <= NEARBY_TOKENS
                    for c in core_by_field.get(o.field, []))
                if args.near_only and not near and o.frame not in args.full_frames.split(","):
                    continue
                fp = occurrence_fingerprint(s.subset, s.o_id, o.frame, o.field,
                                            text, o.start, o.end)
                if fp in ledger["occurrences"]:
                    skipped["occurrences_judged"] += 1
                    continue
                tier1.append({
                    "subset": s.subset, "id": s.o_id, "title": s.title,
                    "year": s.year, "outlet": s.newspaper, "url": s.iwac_url,
                    "frame": o.frame, "form": text[o.start:o.end],
                    "field": o.field, "near_core_hit": near, "fp": fp,
                    "window": clip(text, o.start, o.end, WINDOW),
                })

        if args.tier in ("2", "both"):
            key = member_key(s.subset, s.o_id)
            fp = hits_fingerprint(core_forms[:MAX_CORE_WINDOWS])
            prior = ledger["members"].get(key)
            if prior and prior.get("hits_fp") == fp:
                skipped["members_judged"] += 1
                continue
            if prior and not args.include_stale:
                skipped["members_stale"] += 1
                continue
            windows = []
            for o in core_occ[:MAX_CORE_WINDOWS]:
                text = texts.get(o.field, "")
                windows.append({"field": o.field, "form": text[o.start:o.end],
                                "text": clip(text, o.start, o.end, CORE_WINDOW)})
            ocr = texts.get("OCR", "")
            tier2.append({
                "subset": s.subset, "id": s.o_id, "title": s.title,
                "year": s.year, "outlet": s.newspaper, "countries": s.countries,
                "language": gen.languages.get((s.subset, s.o_id), ""),
                "url": s.iwac_url, "route": route_of(s),
                "tagged_laicite": s.is_tagged, "core_hits": s.membership_hits,
                "laity_demoted": s.laity_demoted,
                "unresolved_hits": s.unresolved_hits,
                "fulltext_chars": len(ocr), "hits_fp": fp,
                "ai_description": gen.descriptions.get((s.subset, s.o_id), ""),
                "core_windows": windows,
                "opening": ocr[:1500] if not windows else "",
            })

    for old in (work / "batches").glob("*.json"):
        old.unlink()
    manifest: Dict[str, Any] = {"tier1": [], "tier2": [], "skipped": dict(skipped),
                                "rules": {str(t): rule_hash(t) for t in RULE_FILES}}
    by_frame = defaultdict(list)
    for r in tier1:
        by_frame[r["frame"]].append(r)
    for frame, rows in sorted(by_frame.items()):
        rows.sort(key=lambda r: (r["subset"], r["form"].lower(), r["id"]))
        for i in range(0, len(rows), T1_BATCH):
            name = f"t1-{frame}-{i // T1_BATCH + 1:02d}.json"
            (work / "batches" / name).write_text(
                json.dumps(rows[i:i + T1_BATCH], ensure_ascii=False, indent=1),
                encoding="utf-8")
            manifest["tier1"].append({"file": name, "frame": frame,
                                      "rows": len(rows[i:i + T1_BATCH])})
    tier2.sort(key=lambda r: (r["subset"], r["year"] or 0, r["id"]))
    by_subset = defaultdict(list)
    for r in tier2:
        by_subset[r["subset"]].append(r)
    for subset, rows in sorted(by_subset.items()):
        for i in range(0, len(rows), T2_BATCH):
            name = f"t2-{subset}-{i // T2_BATCH + 1:02d}.json"
            (work / "batches" / name).write_text(
                json.dumps(rows[i:i + T2_BATCH], ensure_ascii=False, indent=1),
                encoding="utf-8")
            manifest["tier2"].append({"file": name, "subset": subset,
                                      "rows": len(rows[i:i + T2_BATCH])})
    (work / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"members: {Counter(s.subset for s in gen.scans)}")
    print(f"skipped (already in ledger): {dict(skipped)}")
    print(f"tier 1 rows to judge: {len(tier1)} in {len(manifest['tier1'])} batches; "
          f"tier 2 records to judge: {len(tier2)} in {len(manifest['tier2'])} batches")
    print(f"batches written under {work / 'batches'} — private text, never commit")


# ---------------------------------------------------------------------------
# merge

def cmd_merge(args: argparse.Namespace) -> None:
    work = Path(args.work_dir)
    ledger = load_ledger()
    rules = register_rules(ledger)
    judged_at = args.date or date.today().isoformat()
    added = Counter()
    problems: List[str] = []
    for bpath in sorted((work / "batches").glob("*.json")):
        vpath = work / "verdicts" / bpath.name
        if not vpath.exists():
            problems.append(f"no verdict file for {bpath.name}")
            continue
        rows = json.loads(bpath.read_text(encoding="utf-8"))
        verdicts = json.loads(vpath.read_text(encoding="utf-8"))
        if bpath.name.startswith("t1-"):
            vmap = {(str(v["id"]), v.get("window_index")): v for v in verdicts}
            for i, r in enumerate(rows):
                v = vmap.get((str(r["id"]), i))
                if v is None:
                    problems.append(f"{bpath.name}#{i}: missing verdict")
                    continue
                fp = r.get("fp") or fingerprint_from_window(
                    r["subset"], r["id"], r["frame"], r["field"], r["window"])
                ledger["occurrences"][fp] = {
                    "subset": r["subset"], "id": str(r["id"]), "frame": r["frame"],
                    "form": r["form"], "field": r["field"],
                    "near_core_hit": bool(r.get("near_core_hit")),
                    "sense_ok": bool(v.get("sense_ok")),
                    "religion_state": bool(v.get("religion_state")),
                    "judged_at": judged_at, "model": args.model, "rule": rules[1],
                }
                added["occurrences"] += 1
        else:
            vmap = {str(v["id"]): v for v in verdicts}
            for r in rows:
                v = vmap.get(str(r["id"]))
                if v is None:
                    problems.append(f"{bpath.name}#{r['id']}: missing verdict")
                    continue
                relevant = v.get("relevant", "unassessable")
                if relevant not in ("yes", "no", "unassessable"):
                    problems.append(f"{bpath.name}#{r['id']}: bad relevant={relevant!r}")
                    continue
                forms = [w["form"] for w in r.get("core_windows", [])]
                ledger["members"][member_key(r["subset"], str(r["id"]))] = {
                    "subset": r["subset"], "id": str(r["id"]),
                    "route": r.get("route") or (
                        "tag+text" if r["tagged_laicite"] and r["core_hits"]
                        else "tag-only" if r["tagged_laicite"]
                        else "text>=2" if r["core_hits"] >= 2 else "text=1"),
                    "relevant": relevant,
                    "sense": v.get("laicite_sense", "none"),
                    "hits_fp": r.get("hits_fp") or hits_fingerprint(forms),
                    "judged_at": judged_at, "model": args.model, "rule": rules[2],
                }
                added["members"] += 1
    save_ledger(ledger)
    print(f"ledger: {LEDGER_PATH}")
    print(f"added or updated: {dict(added)}; now {len(ledger['members'])} members, "
          f"{len(ledger['occurrences'])} occurrences")
    for p in problems:
        print("  !", p)
    if problems:
        sys.exit(1)


# ---------------------------------------------------------------------------
# status

def cmd_status(args: argparse.Namespace) -> None:
    ledger = load_ledger()
    members = ledger["members"].values()
    print(f"members judged: {len(ledger['members'])}")
    for subset, c in sorted(Counter(m["subset"] for m in members).items()):
        rel = sum(1 for m in members if m["subset"] == subset and m["relevant"] == "yes")
        print(f"  {subset}: {c} judged, {rel} relevant ({rel / c:.1%})")
    for route, c in sorted(Counter(m["route"] for m in members).items()):
        rel = sum(1 for m in members if m["route"] == route and m["relevant"] == "yes")
        print(f"  route {route}: {c} judged, {rel} relevant ({rel / c:.1%})")
    occ = ledger["occurrences"].values()
    print(f"occurrences judged: {len(ledger['occurrences'])}")
    for frame, c in sorted(Counter(o["frame"] for o in occ).items()):
        ok = sum(1 for o in occ if o["frame"] == frame and o["sense_ok"])
        print(f"  {frame}: {c} judged, sense correct {ok / c:.1%}")
    print(f"rules: {json.dumps(ledger['rules'], indent=1)}")
    current = {t: rule_hash(t) for t in RULE_FILES}
    for t, h in current.items():
        if h not in ledger["rules"]:
            print(f"  ! tier {t} instructions changed since the last merge (hash {h}); "
                  f"verdicts in the ledger were made under an older rule")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    ex = sub.add_parser("extract", help="write batches for unjudged rows")
    ex.add_argument("--work-dir", default=".test-tmp/laicite-audit")
    ex.add_argument("--repo", default=None, help="dataset repo id override")
    ex.add_argument("--tier", choices=["1", "2", "both"], default="both")
    ex.add_argument("--frames", default="", help="tier 1: comma-separated frames to include")
    ex.add_argument("--near-only", action="store_true", default=True,
                    help="tier 1: keep only occurrences within 80 tokens of a core hit "
                         "(except --full-frames); default on")
    ex.add_argument("--all-occurrences", dest="near_only", action="store_false")
    ex.add_argument("--full-frames", default="droit-famille",
                    help="tier 1: frames judged in full regardless of --near-only")
    ex.add_argument("--include-stale", action="store_true",
                    help="tier 2: re-extract members whose core hits changed")
    mg = sub.add_parser("merge", help="fold verdict files into the ledger")
    mg.add_argument("--work-dir", default=".test-tmp/laicite-audit")
    mg.add_argument("--model", required=True, help="model id that produced the verdicts")
    mg.add_argument("--date", default=None, help="judged_at (YYYY-MM-DD), default today")
    sub.add_parser("status", help="what the ledger covers")
    args = parser.parse_args()
    if args.cmd == "extract":
        if args.repo is None:
            from iwac_utils import DATASET_ID
            args.repo = DATASET_ID
        cmd_extract(args)
    elif args.cmd == "merge":
        cmd_merge(args)
    else:
        cmd_status(args)


if __name__ == "__main__":
    main()
