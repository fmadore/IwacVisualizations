#!/usr/bin/env python3
"""Import the committed timeline CSVs (content/timelines/) into the IWAC data release."""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from iwac_timeline import IDENTIFIER, SOURCE_PATH, parse_csv, source_hash, validate_timeline
from iwac_utils import add_standard_args, parse_standard_args, save_json, generate_timestamp

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config/timelines.json"
MAX_CSV_BYTES = 4 * 1024 * 1024
logger = logging.getLogger(__name__)


def generate(config: dict, output: Path, minify: bool = True, root: Path = ROOT) -> dict:
    bundles = []
    index = {"schemaVersion": 1, "metadata": {"generatedAt": generate_timestamp()}, "timelines": []}
    seen = set()
    for spec in config["timelines"]:
        slug = spec["slug"]
        if not IDENTIFIER.fullmatch(slug) or slug in seen:
            raise ValueError("Invalid or duplicate timeline slug")
        seen.add(slug)
        entry = {"slug": slug, "locales": {}}
        event_ids = None
        for locale, source in spec["sources"].items():
            # The sources are committed files, never a network read: an edit is
            # a reviewed commit, and a rebuild is reproducible from the tree.
            path = source["csv"]
            if path != f"content/timelines/{slug}.{locale}.csv" or not SOURCE_PATH.fullmatch(path):
                raise ValueError(f"{slug}/{locale}: the source must be content/timelines/{slug}.{locale}.csv")
            raw = (root / path).read_bytes()
            if len(raw) > MAX_CSV_BYTES:
                raise ValueError(f"{path} exceeds 4 MiB")
            payload = parse_csv(raw.decode("utf-8-sig"), slug, locale)
            payload["metadata"] = {
                "generatedAt": index["metadata"]["generatedAt"],
                "source": {"path": path, "sha256": source_hash(raw)},
            }
            validate_timeline(payload)
            ids = {e["id"] for e in payload["events"]}
            if event_ids is not None and ids != event_ids:
                logger.warning("%s: translations have different event IDs; review the editorial differences", slug)
            event_ids = ids
            for warning in payload["warnings"]:
                logger.warning("%s/%s: %s", slug, locale, warning)
            filename = f"{slug}.{locale}.json"
            entry["locales"][locale] = {"file": filename, "title": payload["title"]["headline"],
                                        "eventCount": len(payload["events"]), "page": source.get("page")}
            bundles.append((filename, payload))
        if not entry["locales"]:
            raise ValueError(f"{slug}: no source locales")
        index["timelines"].append(entry)
    if not bundles:
        raise ValueError("No timelines configured")
    # Validate EVERY source before writing anything. Publication remains the
    # responsibility of run_all + validate_data + the immutable archive job.
    for filename, payload in bundles:
        save_json(payload, output / filename, minify=minify)
    save_json(index, output / "index.json", minify=minify)
    # A removed source must not leave an orphan in a reused working tree.
    expected = {name for name, _ in bundles} | {"index.json"}
    for path in output.glob("*.json"):
        if path.name not in expected:
            path.unlink()
    return index


def main():
    parser = add_standard_args(argparse.ArgumentParser(description=__doc__))
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument("--output", type=Path, default=ROOT / "asset/data/timelines")
    args = parse_standard_args(parser)
    # --repo is retained for run_all's common CLI, but this generator never
    # reads Hugging Face; the authoritative sources are content/timelines/*.csv.
    generate(json.loads(args.config.read_text(encoding="utf-8")), args.output, args.minify)


if __name__ == "__main__":
    main()
