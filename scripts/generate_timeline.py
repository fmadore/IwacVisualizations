#!/usr/bin/env python3
"""Import published TimelineJS sheets into the standard IWAC data release."""
from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from iwac_timeline import IDENTIFIER, parse_csv, safe_url, source_hash, validate_timeline
from iwac_utils import add_standard_args, parse_standard_args, save_json, generate_timestamp

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config/timelines.json"
MAX_CSV_BYTES = 4 * 1024 * 1024
logger = logging.getLogger(__name__)


def fetch_csv(url: str) -> bytes:
    """Bounded anonymous reads. Never publish an error page as an empty exhibit."""
    safe_url(url)
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "IWAC-Timeline/1.0", "Accept": "text/csv"})
            with urlopen(request, timeout=30) as response:
                raw = response.read(MAX_CSV_BYTES + 1)
            if len(raw) > MAX_CSV_BYTES:
                raise ValueError("Timeline CSV exceeds 4 MiB")
            return raw
        except (HTTPError, URLError, TimeoutError) as exc:
            if isinstance(exc, HTTPError) and exc.code not in {429, 500, 502, 503, 504}:
                raise
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise RuntimeError("Unreachable")


def generate(config: dict, output: Path, minify: bool = True, csv_dir: Path | None = None) -> dict:
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
            raw = ((csv_dir / f"{slug}.{locale}.csv").read_bytes() if csv_dir
                   else fetch_csv(source["csvUrl"]))
            payload = parse_csv(raw.decode("utf-8-sig"), slug, locale, spec.get("legacyIds"))
            payload["metadata"] = {
                "generatedAt": index["metadata"]["generatedAt"],
                "source": {"url": source["csvUrl"], "sha256": source_hash(raw)},
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
    parser.add_argument("--csv-dir", type=Path, help="Offline inputs named <slug>.<locale>.csv")
    args = parse_standard_args(parser)
    # --repo is retained for run_all's common CLI, but this generator never
    # reads Hugging Face; the authoritative sources are the published sheets.
    generate(json.loads(args.config.read_text(encoding="utf-8")), args.output, args.minify, args.csv_dir)


if __name__ == "__main__":
    main()
