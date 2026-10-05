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
    python scripts/audit_laicite.py merge --work-dir .test-tmp/laicite-audit --model <id>
    python scripts/audit_laicite.py status

The generator reads the ledger at build time and publishes only aggregates
(``laicite-metadata.json`` → ``audit_screen``). Batches and verdicts contain
private full text and must never leave ``.test-tmp`` (gitignored).

Tier 1 rows are keyed by a fingerprint of the folded text ±60 characters
around the match, so a verdict survives a re-scan that shifts offsets and is
invalidated only when the passage itself changes. Tier 2 records carry a
fingerprint of their core-hit forms; a member whose hits changed since it was
judged is reported as *stale* and re-extracted only with ``--include-stale``.

Every extract is a *run* with its own id, stamped on the manifest and on
every batch row. Batch names repeat from run to run (``t1-<frame>-01``), so
``merge`` never trusts a file name: a verdict must echo the row's ``run``,
and a tier-1 verdict its ``fp``, or it is refused. ``extract`` refuses to
start while ``verdicts/`` still holds files from a previous run, and
``merge`` saves nothing when it finds any problem.

Environment
-----------
    HF_TOKEN    required (private full mirror, see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import secrets
import shutil
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from iwac_utils import add_standard_args, clean_str, configure_logging  # noqa: E402
from laicite import LaiciteGenerator  # noqa: E402
from laicite.audit_ledger import LEDGER_PATH, load_ledger as _read_ledger  # noqa: E402
from laicite.lexicon import fold_plain  # noqa: E402
from laicite.scan import NEARBY_TOKENS, membership_route  # noqa: E402

PACKAGE = Path(__file__).resolve().parent / "laicite"
RULES_DIR = PACKAGE / "audit"
RULE_FILES = {1: "INSTRUCTIONS-tier1.md", 2: "INSTRUCTIONS-tier2.md"}

WINDOW = 500          # chars each side shown to the reader, tier 1
CORE_WINDOW = 400     # chars each side around a core hit, tier 2
FP_WINDOW = 60        # chars each side folded into the tier-1 fingerprint
MAX_CORE_WINDOWS = 6
T1_BATCH = 100
T2_BATCH = 40

RELEVANT = ("yes", "no", "unassessable")
SENSES = ("state", "laity", "mixed", "none")


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


def digest(text: str, length: int) -> str:
    """The one hash every fingerprint and rule version is cut from.

    SHA-1 truncated, as it always was — changing it would orphan every
    fingerprint already in the committed ledger.
    """
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:length]


def rule_hash(tier: int) -> str:
    return digest((RULES_DIR / RULE_FILES[tier]).read_text(encoding="utf-8"), 10)


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
    return digest("|".join(sorted(fold_plain(f) for f in forms)), 12)


def occurrence_fingerprint(subset: str, o_id: str, frame: str, field: str,
                           text: str, start: int, end: int) -> str:
    around = fold_plain(text[max(0, start - FP_WINDOW):start]) + "«" \
        + fold_plain(text[start:end]) + "»" + fold_plain(text[end:end + FP_WINDOW])
    around = re.sub(r"\s+", " ", around)
    return digest(f"{subset}|{o_id}|{frame}|{field}|{around}", 16)


def new_run_id() -> str:
    """When the extract ran, plus a random tail so two runs never collide."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}-{secrets.token_hex(3)}"


# ---------------------------------------------------------------------------
# extract

class AuditGenerator(LaiciteGenerator):
    """The scan, plus the AI description the tier-2 batches show as context."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.descriptions: Dict[Any, str] = {}

    def _observe_source(self, row, subset, scanned):
        if scanned.rec is not None:
            key = (subset, scanned.rec.o_id)
            self.descriptions[key] = clean_str(row.get("descriptionAI"))
        super()._observe_source(row, subset, scanned)


@dataclass
class ExtractOptions:
    """What ``select_tier1`` / ``select_tier2`` need besides the scan."""
    #: The lexicon's membership frames — tier 2's evidence, never tier 1's.
    core: Set[str]
    #: This extract's id, stamped on every row.
    run: str
    #: Tier 1: only these frames (None = all annotation frames).
    frames: Optional[Set[str]] = None
    #: Tier 1: keep only occurrences flagged ``near_core`` …
    near_only: bool = True
    #: … except in these frames, which are judged in full.
    full_frames: Set[str] = field(default_factory=lambda: {"droit-famille"})
    #: Tier 2: re-extract members whose core hits changed since judged.
    include_stale: bool = False


def clip(text: str, start: int, end: int, pad: int) -> str:
    lo, hi = max(0, start - pad), min(len(text), end + pad)
    return text[lo:start] + "«" + text[start:end] + "»" + text[end:hi]


def select_tier1(scans: Iterable[Any], texts: Dict[Tuple[str, str], Dict[str, str]],
                 ledger: Dict[str, Any], opts: ExtractOptions
                 ) -> Tuple[List[Dict[str, Any]], Counter]:
    """Annotation-frame occurrences the ledger has not judged yet.

    Proximity is the scan's own ``near_core`` flag — the rule the arenas
    view counts by — never a re-measurement here.
    """
    rows: List[Dict[str, Any]] = []
    skipped: Counter = Counter()
    queued: Set[str] = set()
    for s in scans:
        item_texts = texts.get((s.subset, s.o_id), {})
        for o in s.occurrences:
            if o.frame in opts.core or o.field not in item_texts:
                continue
            if opts.frames and o.frame not in opts.frames:
                continue
            if opts.near_only and not o.near_core and o.frame not in opts.full_frames:
                continue
            text = item_texts[o.field]
            fp = occurrence_fingerprint(s.subset, s.o_id, o.frame, o.field,
                                        text, o.start, o.end)
            if fp in ledger["occurrences"]:
                skipped["occurrences_judged"] += 1
                continue
            if fp in queued:
                # The same passage twice in one item (a repeated page): one
                # verdict covers both, so it is read once.
                skipped["occurrences_repeated"] += 1
                continue
            queued.add(fp)
            rows.append({
                "subset": s.subset, "id": s.o_id, "title": s.title,
                "year": s.year, "outlet": s.newspaper, "url": s.iwac_url,
                "frame": o.frame, "form": text[o.start:o.end],
                "field": o.field, "near_core_hit": o.near_core,
                "fp": fp, "run": opts.run,
                "window": clip(text, o.start, o.end, WINDOW),
            })
    return rows, skipped


def select_tier2(scans: Iterable[Any], texts: Dict[Tuple[str, str], Dict[str, str]],
                 ledger: Dict[str, Any], opts: ExtractOptions,
                 descriptions: Optional[Dict[Tuple[str, str], str]] = None,
                 ) -> Tuple[List[Dict[str, Any]], Counter]:
    """Dossier members the ledger has not judged, or judged on other hits."""
    descriptions = descriptions or {}
    rows: List[Dict[str, Any]] = []
    skipped: Counter = Counter()
    for s in scans:
        item_texts = texts.get((s.subset, s.o_id), {})
        core_occ = [o for o in s.occurrences if o.frame in opts.core]
        core_forms = [item_texts[o.field][o.start:o.end]
                      for o in core_occ if o.field in item_texts]
        key = member_key(s.subset, s.o_id)
        fp = hits_fingerprint(core_forms[:MAX_CORE_WINDOWS])
        prior = ledger["members"].get(key)
        if prior and prior.get("hits_fp") == fp:
            skipped["members_judged"] += 1
            continue
        if prior and not opts.include_stale:
            skipped["members_stale"] += 1
            continue
        windows = []
        for o in core_occ[:MAX_CORE_WINDOWS]:
            text = item_texts.get(o.field, "")
            windows.append({"field": o.field, "form": text[o.start:o.end],
                            "text": clip(text, o.start, o.end, CORE_WINDOW)})
        ocr = item_texts.get("OCR", "")
        rows.append({
            "subset": s.subset, "id": s.o_id, "title": s.title,
            "year": s.year, "outlet": s.newspaper, "countries": s.countries,
            "language": " | ".join(s.extra.get("languages", [])),
            "url": s.iwac_url, "route": s.membership_route,
            "tagged_laicite": s.is_tagged, "core_hits": s.membership_hits,
            "laity_demoted": s.laity_demoted,
            "unresolved_hits": s.unresolved_hits,
            "fulltext_chars": len(ocr), "hits_fp": fp, "run": opts.run,
            "ai_description": descriptions.get((s.subset, s.o_id), ""),
            "core_windows": windows,
            "opening": ocr[:1500] if not windows else "",
        })
    return rows, skipped


def archive_previous_run(work: Path) -> Optional[Path]:
    """Move the last run's batches, verdicts and manifest under ``archive/``."""
    manifest = work / "manifest.json"
    run = ""
    if manifest.exists():
        try:
            run = str(json.loads(manifest.read_text(encoding="utf-8")).get("run") or "")
        except ValueError:
            run = ""
    target = work / "archive" / (run or "pre-run-id-" + new_run_id())
    moved = False
    for name in ("batches", "verdicts", "manifest.json"):
        src = work / name
        if src.exists():
            target.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(target / name))
            moved = True
    return target if moved else None


def cmd_extract(args: argparse.Namespace) -> None:
    work = Path(args.work_dir)
    # Batch names repeat from run to run. A verdict file left behind would
    # sit under the name of a NEW batch with different rows, so a new run
    # never starts on top of one.
    leftover = sorted((work / "verdicts").glob("*.json")) if (work / "verdicts").exists() else []
    if leftover:
        if not args.archive_previous:
            sys.exit(
                f"{work / 'verdicts'} still holds {len(leftover)} verdict file(s) from a "
                f"previous run. Merge them first, then re-run extract with "
                f"--archive-previous to move that run aside.")
        target = archive_previous_run(work)
        print(f"previous run archived under {target}")
    (work / "batches").mkdir(parents=True, exist_ok=True)
    (work / "verdicts").mkdir(parents=True, exist_ok=True)
    ledger = load_ledger()
    gen = AuditGenerator(output_dir=work / "_scratch", repo_id=args.repo)
    gen.scan_all()
    opts = ExtractOptions(
        core=set(gen.lex.membership_frames),
        run=new_run_id(),
        frames=set(args.frames.split(",")) if args.frames else None,
        near_only=args.near_only,
        full_frames={f for f in args.full_frames.split(",") if f},
        include_stale=args.include_stale,
    )
    tier1: List[Dict[str, Any]] = []
    tier2: List[Dict[str, Any]] = []
    skipped: Counter = Counter()
    if args.tier in ("1", "both"):
        tier1, sk = select_tier1(gen.scans, gen.texts, ledger, opts)
        skipped.update(sk)
    if args.tier in ("2", "both"):
        tier2, sk = select_tier2(gen.scans, gen.texts, ledger, opts, gen.descriptions)
        skipped.update(sk)

    indent = None if args.minify else 1
    for old in (work / "batches").glob("*.json"):
        old.unlink()
    manifest: Dict[str, Any] = {"run": opts.run, "tier1": [], "tier2": [],
                                "skipped": dict(skipped),
                                "rules": {str(t): rule_hash(t) for t in RULE_FILES}}
    by_frame = defaultdict(list)
    for r in tier1:
        by_frame[r["frame"]].append(r)
    for frame, rows in sorted(by_frame.items()):
        rows.sort(key=lambda r: (r["subset"], r["form"].lower(), r["id"]))
        for i in range(0, len(rows), T1_BATCH):
            name = f"t1-{frame}-{i // T1_BATCH + 1:02d}.json"
            (work / "batches" / name).write_text(
                json.dumps(rows[i:i + T1_BATCH], ensure_ascii=False, indent=indent),
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
                json.dumps(rows[i:i + T2_BATCH], ensure_ascii=False, indent=indent),
                encoding="utf-8")
            manifest["tier2"].append({"file": name, "subset": subset,
                                      "rows": len(rows[i:i + T2_BATCH])})
    (work / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"run: {opts.run}")
    print(f"members: {Counter(s.subset for s in gen.scans)}")
    print(f"skipped (judged, stale or repeated): {dict(skipped)}")
    print(f"tier 1 rows to judge: {len(tier1)} in {len(manifest['tier1'])} batches; "
          f"tier 2 records to judge: {len(tier2)} in {len(manifest['tier2'])} batches")
    print(f"batches written under {work / 'batches'} — private text, never commit")


# ---------------------------------------------------------------------------
# merge

def merge_rows(ledger: Dict[str, Any], rows: List[Dict[str, Any]], verdicts: Any, *,
               tier: int, batch: str, run: str, rule: str, judged_at: str,
               model: str) -> Tuple[Counter, List[str]]:
    """Fold one batch's verdicts into ``ledger``; return ``(added, problems)``.

    Nothing is matched by position or by file name. A verdict must echo the
    row's ``run`` — so a file written for an earlier extract under the same
    batch name is refused — and a tier-1 verdict its ``fp``, the key it is
    stored under. The ledger is updated in place even when problems are
    found; the caller must not save it then.
    """
    added: Counter = Counter()
    problems: List[str] = []
    stale_rows = sorted({str(r.get("run") or "") for r in rows} - {run})
    if stale_rows:
        problems.append(f"{batch}: batch rows from run(s) {stale_rows}, "
                        f"the manifest is run {run!r} — re-extract")
        return added, problems
    if not isinstance(verdicts, list) or not all(isinstance(v, dict) for v in verdicts):
        problems.append(f"{batch}: the verdict file is not a JSON array of objects")
        return added, problems
    for v in verdicts:
        if v.get("run") != run:
            problems.append(f"{batch}: verdict for id {v.get('id')!r} carries run "
                            f"{v.get('run')!r}, not {run!r} — written for another batch")
            return added, problems

    if tier == 1:
        vmap = {}
        for v in verdicts:
            if not v.get("fp"):
                problems.append(f"{batch}: verdict for id {v.get('id')!r} has no fp")
                continue
            vmap[v["fp"]] = v
        for i, r in enumerate(rows):
            fp = r.get("fp")
            if not fp:
                problems.append(f"{batch}#{i}: batch row has no fp — re-extract")
                continue
            v = vmap.get(fp)
            if v is None:
                problems.append(f"{batch}#{i}: missing verdict (fp {fp})")
                continue
            if "id" in v and str(v["id"]) != str(r["id"]):
                problems.append(f"{batch}#{i}: verdict id {v['id']!r} ≠ row id {r['id']!r}")
                continue
            bad = [k for k in ("sense_ok", "religion_state") if not isinstance(v.get(k), bool)]
            if bad:
                problems.append(f"{batch}#{i}: {', '.join(bad)} must be true or false")
                continue
            ledger["occurrences"][fp] = {
                "subset": r["subset"], "id": str(r["id"]), "frame": r["frame"],
                "form": r["form"], "field": r["field"],
                "near_core_hit": bool(r.get("near_core_hit")),
                "sense_ok": v["sense_ok"],
                "religion_state": v["religion_state"],
                "judged_at": judged_at, "model": model, "rule": rule,
            }
            added["occurrences"] += 1
        return added, problems

    vmap = {str(v.get("id")): v for v in verdicts}
    for r in rows:
        v = vmap.get(str(r["id"]))
        if v is None:
            problems.append(f"{batch}#{r['id']}: missing verdict")
            continue
        relevant = v.get("relevant", "unassessable")
        if relevant not in RELEVANT:
            problems.append(f"{batch}#{r['id']}: bad relevant={relevant!r}")
            continue
        sense = v.get("laicite_sense", "none")
        if sense not in SENSES:
            problems.append(f"{batch}#{r['id']}: bad laicite_sense={sense!r}")
            continue
        if not r.get("hits_fp"):
            problems.append(f"{batch}#{r['id']}: batch row has no hits_fp — re-extract")
            continue
        ledger["members"][member_key(r["subset"], str(r["id"]))] = {
            "subset": r["subset"], "id": str(r["id"]),
            "route": r.get("route") or membership_route(
                bool(r.get("tagged_laicite")), int(r.get("core_hits") or 0)),
            "relevant": relevant,
            "sense": sense,
            "hits_fp": r["hits_fp"],
            "judged_at": judged_at, "model": model, "rule": rule,
        }
        added["members"] += 1
    return added, problems


def cmd_merge(args: argparse.Namespace) -> None:
    work = Path(args.work_dir)
    try:
        run = str(json.loads((work / "manifest.json").read_text(encoding="utf-8"))
                  .get("run") or "")
    except (OSError, ValueError):
        run = ""
    if not run:
        sys.exit(f"{work / 'manifest.json'} is missing or carries no run id — "
                 f"re-run extract; nothing was merged")
    ledger = load_ledger()
    rules = register_rules(ledger)
    judged_at = args.date or date.today().isoformat()
    added: Counter = Counter()
    problems: List[str] = []
    for bpath in sorted((work / "batches").glob("*.json")):
        vpath = work / "verdicts" / bpath.name
        if not vpath.exists():
            problems.append(f"no verdict file for {bpath.name}")
            continue
        tier = 1 if bpath.name.startswith("t1-") else 2
        try:
            rows = json.loads(bpath.read_text(encoding="utf-8"))
            verdicts = json.loads(vpath.read_text(encoding="utf-8"))
        except ValueError as exc:
            problems.append(f"{bpath.name}: unreadable JSON ({exc})")
            continue
        got, found = merge_rows(ledger, rows, verdicts, tier=tier, batch=bpath.name,
                                run=run, rule=rules[tier], judged_at=judged_at,
                                model=args.model)
        added.update(got)
        problems.extend(found)
    if problems:
        for p in problems:
            print("  !", p)
        # All or nothing: a half-merged run would leave the ledger claiming
        # some of a run's verdicts and silently missing the rest.
        print(f"{len(problems)} problem(s); the ledger was NOT saved ({LEDGER_PATH})")
        sys.exit(1)
    save_ledger(ledger)
    print(f"ledger: {LEDGER_PATH}")
    print(f"added or updated: {dict(added)}; now {len(ledger['members'])} members, "
          f"{len(ledger['occurrences'])} occurrences")


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
    # --repo, -v, and --minify, which here writes the batch files compact.
    add_standard_args(ex, minify_default=False)
    ex.add_argument("--tier", choices=["1", "2", "both"], default="both")
    ex.add_argument("--frames", default="", help="tier 1: comma-separated frames to include")
    ex.add_argument("--near-only", action=argparse.BooleanOptionalAction, default=True,
                    help=f"tier 1: keep only occurrences within {NEARBY_TOKENS} tokens of a "
                         f"core hit, except --full-frames (default: %(default)s)")
    ex.add_argument("--all-occurrences", dest="near_only", action="store_false",
                    help="tier 1: same as --no-near-only")
    ex.add_argument("--full-frames", default="droit-famille",
                    help="tier 1: frames judged in full regardless of --near-only")
    ex.add_argument("--include-stale", action="store_true",
                    help="tier 2: re-extract members whose core hits changed")
    ex.add_argument("--archive-previous", action="store_true",
                    help="move a previous run's batches, verdicts and manifest under "
                         "<work-dir>/archive/<run>/ instead of refusing to start")
    mg = sub.add_parser("merge", help="fold verdict files into the ledger")
    mg.add_argument("--work-dir", default=".test-tmp/laicite-audit")
    mg.add_argument("--model", required=True, help="model id that produced the verdicts")
    mg.add_argument("--date", default=None, help="judged_at (YYYY-MM-DD), default today")
    sub.add_parser("status", help="what the ledger covers")
    args = parser.parse_args()
    configure_logging(logging.DEBUG if getattr(args, "verbose", False) else logging.INFO)
    if args.cmd == "extract":
        cmd_extract(args)
    elif args.cmd == "merge":
        cmd_merge(args)
    else:
        cmd_status(args)


if __name__ == "__main__":
    main()
