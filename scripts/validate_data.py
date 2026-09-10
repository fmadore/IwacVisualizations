#!/usr/bin/env python3
"""Check that a generated `asset/data/` tree matches what the front end reads.

**Why this exists (Tier 8 / P10).** The output contract was convention, not
contract. Four metadata idioms coexisted, ``script_version`` was
hand-maintained in seven files and read by nothing, and the only thing
standing between a generator quietly changing a payload's shape and a blank
panel on the live site was the "Package archive" step's ``test -s`` — which
proves a file is non-empty and nothing else. A bundle can be 400 KB of valid
JSON with the one key its panel reads renamed.

**What it checks.** A floor, not a schema:

1. every expected file exists, parses, and is not an empty container;
2. every payload carries a metadata block — ``metadata`` or ``_meta`` — with a
   ``generatedAt``/``generated_at`` timestamp in the ``…Z`` form
   :func:`iwac_utils.generate_timestamp` produces (three fan-outs emitted
   ``+00:00`` until this tier);
3. the top-level keys the JavaScript actually reads are present, per bundle.

The table below is mirrored BY HAND from the consuming JS, which is the honest
description of it: it is a regression net for the shapes that exist today, not
a generated schema. A missing entry means a bundle is unchecked beyond (1) and
(2); a wrong entry fails CI loudly, which is the failure mode to prefer.

Usage::

    python scripts/validate_data.py                  # check asset/data
    python scripts/validate_data.py --dir some/dir
    python scripts/validate_data.py --self-test      # prove it can fail
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

#: bundle path (relative to the data dir) → top-level keys its panel reads.
#:
#: Read off the orchestrators in `asset/js/charts/`. Where a panel tolerates a
#: missing key (an optional sidecar, a section added after a bundle shipped),
#: the key is NOT listed — this is what must be there for the block to render
#: at all.
#: WRITTEN BY HAND, AND CORRECTED BY ITS FIRST REAL RUN. Three of the 55
#: keys below were wrong on contact with actual output - `index-overview`
#: wanted `stats`/`entities` where the generator emits `summary`/
#: `top_entities`, and `spatial-exploration` wanted `places` where it emits
#: `locations`. The other 52 were right, and the run proved it: this
#: validator reports EVERY problem rather than stopping at the first, so one
#: red run is a complete audit of the table.
#:
#: That is the reason it reports everything, and the reason a new row here
#: is not trustworthy until a regeneration has run against it. A wrong row
#: fails safe - the archive is not published and the previous one stands -
#: but it fails the whole build, so add rows from the generator's payload
#: dict rather than from what the front end looks like it reads.
REQUIRED_KEYS: Dict[str, Tuple[str, ...]] = {
    "collection-overview.json":       ("summary", "timeline", "countries", "treemap"),
    "collection-wordcloud.json":      ("global",),
    "collection-map.json":            ("locations", "country_counts"),
    "index-overview.json":            ("summary", "top_entities"),
    "keyword-explorer-metadata.json": ("countries", "newspapers", "year_range"),
    "references-overview.json":       ("summary",),
    "scary-terms-metadata.json":      ("term_families", "countries", "year_range"),
    "scary-terms-temporal.json":      (),          # a bare year -> counts map
    "topic-explorer.json":            ("topics", "metadata"),
    "spatial-exploration.json":       ("locations", "focus_countries"),
    "entity-networks-global.json":    ("nodes", "edges"),
    "entity-networks-spatial.json":   ("nodes", "edges"),
    "periodicals-overview.json":      ("summary", "runs", "holdings"),
    "audiovisual-overview.json":      ("summary", "channels", "timeline"),
    "laicite-metadata.json":          ("subsets", "frames", "frame_order", "totals"),
    "laicite-trends.json":            ("years", "families", "global"),
    "sentiment-atlas.json":           ("models", "years", "summary"),
    "semantic-landscape.json":        ("points", "topics"),
    "periodicals-landscape.json":     ("points",),
    "lexical-metrics.json":           (),
    "corpus-health.json":             ("subsets",),
    "press-bylines.json":             ("summary", "by_year", "top"),
    "press-reprints.json":            ("stats", "newspapers", "pairs"),
    "org-cooccurrence.json":          ("orgs", "matrices"),
    "keyness.json":                   (),
    "template-summary.json":          (),
    "term-trends-index.json":         ("years", "terms", "totals"),
}

#: Bundles whose metadata is INLINE at the top level — `generated_at` beside
#: the data rather than inside a `metadata` block. Four idioms coexist (P10);
#: this validator accepts all of them rather than forcing a payload change
#: that every consuming panel would have to be re-read for. What it will not
#: accept is a bundle with no timestamp at all, or one in the `+00:00` form
#: three fan-outs emitted until this tier.

#: Bundles that are a bare map — `{"1961": {...}, "1962": {...}}` — and so
#: have nowhere to put a timestamp that would not read as another entry.
#: Their provenance lives in the sibling metadata bundle the same block
#: fetches; the exemption is named rather than inferred, so a bundle that
#: grows an envelope loses the exemption by being deleted from this list.
NO_ENVELOPE = ("scary-terms-temporal.json",)

#: Directories that must contain at least one JSON file (the per-item fan-outs).
REQUIRED_FANOUT = (
    "article-dashboards", "person-dashboards", "entity-dashboards",
    "publication-dashboards", "reference-dashboards", "on-this-day",
    "term-trends", "compare-newspapers",
)

#: The two hand-curated sidecars ride in from the checkout, not a generator.
COMMITTED = ("scary-terms-events.json", "laicite-events.json")

TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T[\d:.]+Z$")


def metadata_of(payload: Any) -> Optional[dict]:
    """The payload's metadata block under either of the two names it uses."""
    if not isinstance(payload, dict):
        return None
    for key in ("metadata", "_meta"):
        block = payload.get(key)
        if isinstance(block, dict):
            return block
    return None


def timestamp_of(payload: Any) -> Optional[str]:
    """The payload's generation timestamp, under any of the four idioms.

    `create_metadata_block` writes `metadata.generatedAt`; the entity
    networks, on-this-day and spatial bundles use `_meta`; thirteen
    generators write `generated_at` inline at the top level. All three are
    accepted — forcing one shape would mean re-reading every consuming panel
    — but a bundle with no timestamp at all is not.
    """
    if not isinstance(payload, dict):
        return None
    block = metadata_of(payload)
    if block:
        stamp = block.get("generatedAt") or block.get("generated_at")
        if stamp:
            return str(stamp)
    stamp = payload.get("generatedAt") or payload.get("generated_at")
    return str(stamp) if stamp else None


def check_payload(name: str, payload: Any) -> List[str]:
    """Problems with one parsed bundle. Empty list means it passes."""
    problems: List[str] = []

    if payload is None or payload == {} or payload == []:
        problems.append(f"{name}: parsed as an empty payload")
        return problems

    stamp = timestamp_of(payload)
    if stamp is None and name not in NO_ENVELOPE:
        problems.append(f"{name}: no generation timestamp anywhere in the payload")
    elif stamp is not None:
        if not TIMESTAMP.match(str(stamp)):
            problems.append(
                f"{name}: generatedAt {stamp!r} is not the Z form "
                "iwac_utils.generate_timestamp() produces"
            )

    for key in REQUIRED_KEYS.get(name, ()):
        if not isinstance(payload, dict) or key not in payload:
            problems.append(f"{name}: missing top-level {key!r}, which the block reads")
        elif not isinstance(payload[key], (dict, list)):
            problems.append(f"{name}: {key!r} must be an object or array")
    return problems


def read_json(path: Path) -> Any:
    def invalid(value):
        raise ValueError(f"Non-finite JSON number: {value}")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=invalid)


def reference_population(sources: dict) -> tuple:
    return ({str(i) for subset in sources.values() for i in subset["ids"]},
            {str(i) for subset in sources.values() for i in subset["publicOcrIds"]})


def check_references(name: str, payload: Any, sources: dict, population=None) -> List[str]:
    """Validate public-text gates and links against the pinned source population."""
    errors = []
    all_ids, public_ids = population if population is not None else reference_population(sources)

    def walk(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ("o_id", "o:id") and child is not None and str(child) not in all_ids:
                    errors.append(f"{name}: unknown item {child}")
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(payload)
    if name.startswith("on-this-day/") and isinstance(payload, dict):
        for row in payload.get("items", []):
            if not isinstance(row, list) or len(row) < 7:
                errors.append(f"{name}: invalid day row")
            elif row[4] == "a" and row[6] and str(row[1]) not in public_ids:
                errors.append(f"{name}: non-public OCR excerpt for {row[1]}")
    if name.startswith("laicite-concordance-") and isinstance(payload, dict):
        items = payload.get("items", [])
        for row in payload.get("rows", []):
            index = row.get("i")
            if not isinstance(index, int) or not 0 <= index < len(items):
                errors.append(f"{name}: invalid concordance item index")
            elif row.get("d") == "OCR" and str(items[index]["o"]) not in public_ids:
                errors.append(f"{name}: non-public OCR concordance")
    return errors


def write_manifest(data_dir: Path, provenance: Path) -> None:
    proof = read_json(provenance)
    from run_all import GENERATORS
    if set(proof["outputs"]) != set(GENERATORS):
        raise ValueError("Publication requires a complete generator run")
    expected = {name for names in proof["outputs"].values() for name in names} | set(COMMITTED)
    actual = {p.relative_to(data_dir).as_posix() for p in data_dir.rglob("*.json")
              if p.name != "manifest.json"}
    if expected != actual:
        raise ValueError(f"Output receipts differ: missing={sorted(expected - actual)}, unexpected={sorted(actual - expected)}")
    files = {}
    population = reference_population(proof["sources"])
    for name in sorted(expected):
        path = data_dir / name
        payload = read_json(path)
        errors = check_references(name, payload, proof["sources"], population)
        if errors:
            raise ValueError("\n".join(errors))
        files[name] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                       "bytes": path.stat().st_size, "schema": name.split("/")[0],
                       "records": len(payload) if isinstance(payload, list) else None}
    manifest = {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "buildId": os.environ.get("GITHUB_SHA", "local"),
                "sourceRevisions": proof["revisions"], "configuration": proof["configuration"],
                "generators": proof["outputs"], "files": files}
    (data_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True), encoding="utf-8")


def validate(data_dir: Path) -> List[str]:
    problems: List[str] = []

    # All sidecars and all per-item files must parse, not just named aggregates.
    for path in data_dir.rglob("*.json"):
        try:
            value = read_json(path)
            if not isinstance(value, (dict, list)):
                problems.append(f"{path}: expected an object or array")
        except (ValueError, UnicodeError) as exc:
            problems.append(f"{path}: invalid JSON ({exc})")

    for name in sorted(REQUIRED_KEYS):
        path = data_dir / name
        if not path.is_file():
            problems.append(f"{name}: missing")
            continue
        if path.stat().st_size == 0:
            problems.append(f"{name}: empty file")
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            problems.append(f"{name}: not valid JSON ({exc})")
            continue
        problems.extend(check_payload(name, payload))

    for name in COMMITTED:
        path = data_dir / name
        if not path.is_file() or path.stat().st_size == 0:
            problems.append(f"{name}: missing or empty (committed sidecar)")

    for name in REQUIRED_FANOUT:
        directory = data_dir / name
        if not directory.is_dir():
            problems.append(f"{name}/: missing")
        elif not any(directory.rglob("*.json")):
            problems.append(f"{name}/: no JSON files")

    return problems


def self_test() -> List[str]:
    """Prove the checks can fail — the same contract check-*.js scripts keep."""
    failures: List[str] = []

    good = {"metadata": {"generatedAt": "2026-09-07T05:00:00Z"}, "summary": {},
            "timeline": {}, "countries": [], "treemap": {}}
    if check_payload("collection-overview.json", good):
        failures.append("a well-formed payload was rejected")

    cases = [
        ("an empty payload", {}),
        ("no metadata block", {k: v for k, v in good.items() if k != "metadata"}),
        ("a +00:00 timestamp", {**good, "metadata": {"generatedAt": "2026-09-07T05:00:00+00:00"}}),
        ("no generatedAt", {**good, "metadata": {"totalRecords": 1}}),
        ("a missing required key", {k: v for k, v in good.items() if k != "timeline"}),
    ]
    for label, payload in cases:
        if not check_payload("collection-overview.json", payload):
            failures.append(f"{label} was accepted")

    # `_meta` is the other spelling and must pass.
    if check_payload("entity-networks-global.json",
                     {"_meta": {"generatedAt": "2026-09-07T05:00:00Z"},
                      "nodes": [], "edges": []}):
        failures.append("the `_meta` spelling was rejected")

    with tempfile.TemporaryDirectory() as tmp:
        if not validate(Path(tmp)):
            failures.append("an empty directory was accepted")

    return failures


def main() -> int:
    # The tick and cross below are UTF-8; a Windows console defaults to cp1252
    # and raises on them, which would turn a PASSING check into a traceback.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", default="asset/data",
                        help="Directory to validate (default: %(default)s)")
    parser.add_argument("--self-test", action="store_true",
                        help="Check that the checks can fail, and exit")
    parser.add_argument("--write-manifest", action="store_true")
    parser.add_argument("--provenance", default=".iwac-build/provenance.json")
    args = parser.parse_args()

    failures = self_test()
    if failures:
        print("✗ validate_data: self-test failed — the checks cannot be trusted\n")
        for f in failures:
            print(f"  {f}")
        return 1
    if args.self_test:
        print("✓ validate_data: self-test passed")
        return 0

    problems = validate(Path(args.dir))
    if problems:
        print(f"\n✗ validate_data: {len(problems)} problem(s) in {args.dir}\n")
        for p in problems:
            print(f"  {p}")
        print(
            "\n  The front end reads these keys; a bundle that parses but has "
            "lost one\n  renders an empty panel with no error. Nothing is "
            "published until this passes.\n"
        )
        return 1

    if args.write_manifest:
        write_manifest(Path(args.dir), Path(args.provenance))
    print(f"✓ validate_data: {len(REQUIRED_KEYS)} bundles, "
          f"{len(REQUIRED_FANOUT)} fan-outs, metadata and required keys present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
