#!/usr/bin/env python3
"""Run every data generator in one interpreter, sharing the loaded subsets.

**What this replaces.** ``regenerate-data.yml`` used to carry its own
``gens=(…)`` array and start 31 interpreters in a bash loop. Each one paid
its own imports, and — because a subset load lives and dies inside a
process — the seven Hugging Face subsets were converted to pandas about
ninety times per run, ``articles`` roughly twenty-six of them. The v1.59.0
Hugging Face cache removed the *downloads*; the conversions, which
``load_dataset_safe`` itself documents as where the memory goes, stayed.

This runner does two things and nothing else:

1. installs an :class:`iwac_frames.FrameStore` so that every
   ``load_dataset_safe`` call in every generator is served from one frame
   per subset, widened on demand;
2. imports each generator module and calls its ``main()`` with the flags CI
   would have passed on the command line.

The generators are untouched. Running one directly still works exactly as
before — no store is installed, so nothing is shared and nothing is kept.

**GENERATORS is the order CI runs.** It was the workflow's ``gens`` array;
the workflow now calls this file, so the order lives in one place that
``pyflakes`` and the import check can both see. The ordering is not
arbitrary: cheap metadata generators come first so a schema break surfaces
in the first minute, and the four UMAP fits sit late, after the frames they
share have already been paid for.

Usage::

    python scripts/run_all.py                     # everything, CI defaults
    python scripts/run_all.py --only laicite      # one generator
    python scripts/run_all.py --skip article_dashboards --skip laicite
    python scripts/run_all.py --list              # names, in order
    python scripts/run_all.py --no-share          # one process, no memo
"""
from __future__ import annotations

import argparse
import importlib
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import List, Sequence

# Run from anywhere: the generators write CWD-relative paths, so the runner
# also makes the repo root the working directory (see `main`).
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import iwac_utils  # noqa: E402
from iwac_frames import FrameStore  # noqa: E402


GENERATORS: List[str] = [
    "audiovisual_overview",
    "collection_overview",
    "wordcloud",
    "world_map",
    "index_overview",
    "keyword_explorer",
    "entity_networks",
    "lexical_metrics",
    "on_this_day",
    "periodicals_overview",
    "periodicals_landscape",
    "press_bylines",
    "references_overview",
    "scary_terms",
    "semantic_landscape",
    "sentiment_atlas",
    "spatial_exploration",
    "template_summary",
    "topic_explorer",
    "compare_newspapers",
    "article_dashboards",
    "person_dashboards",
    "entity_dashboards",
    "publication_dashboards",
    "org_cooccurrence",
    "term_trends",
    "reprints",
    "corpus_health",
    "keyness",
    "reference_dashboards",
    "laicite",
]
"""Every generator CI runs, in the order it runs them."""


# Holding every subset wide at once is the one shape that could cost more
# memory than it saves, so the store is bounded. Four covers the real access
# pattern — nearly every generator reads `articles` and `index`, plus at most
# a couple of others — and keeps those two resident across the whole run while
# the rest rotate. `--max-subsets 0` lifts the bound; eviction is not lossy,
# an evicted subset is simply reloaded on next use.
DEFAULT_MAX_SUBSETS = 4


def module_name(name: str) -> str:
    """``laicite`` → ``generate_laicite``."""
    return f"generate_{name}"


def run_one(name: str, argv: Sequence[str]) -> None:
    """Import a generator and call its ``main()`` under the given argv."""
    mod = importlib.import_module(module_name(name))
    if not hasattr(mod, "main"):
        raise RuntimeError(f"{module_name(name)}.py has no main() to call")
    saved = sys.argv
    sys.argv = [f"{module_name(name)}.py", *argv]
    try:
        mod.main()
    finally:
        sys.argv = saved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", action="append", metavar="NAME",
                        help="Run only this generator (repeatable)")
    parser.add_argument("--skip", action="append", metavar="NAME", default=[],
                        help="Skip this generator (repeatable)")
    parser.add_argument("--list", action="store_true",
                        help="Print the generator order and exit")
    parser.add_argument("--no-share", action="store_true",
                        help="One process, but no frame memo — for A/B timing")
    parser.add_argument("--max-subsets", type=int, default=DEFAULT_MAX_SUBSETS,
                        metavar="N",
                        help="Subsets held at once, 0 for unbounded "
                             "(default: %(default)s)")
    parser.add_argument("--continue-on-error", action="store_true",
                        help="Keep going after a failure and report at the end. "
                             "CI does NOT pass this: a partial build must never "
                             "be published.")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Set log level to DEBUG")
    parser.add_argument("passthrough", nargs="*", metavar="-- ARG",
                        help="Arguments forwarded verbatim to every generator "
                             "(e.g. `-- --repo other/dataset`)")
    args = parser.parse_args()

    if args.list:
        for name in GENERATORS:
            print(name)
        return 0

    named = set(args.only or []) | set(args.skip)
    unknown = sorted(named - set(GENERATORS))
    if unknown:
        parser.error(f"unknown generator(s): {', '.join(unknown)}")

    selected = [n for n in (args.only or GENERATORS) if n not in set(args.skip)]

    iwac_utils.configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    logger = logging.getLogger("run_all")

    # Generators write CWD-relative output paths (asset/data/…), so the runner
    # anchors the working directory the same way the workflow's `cd` did.
    os.chdir(SCRIPTS_DIR.parent)

    store = None if args.no_share else FrameStore(max_subsets=args.max_subsets)
    previous = iwac_utils.set_frame_store(store)

    # Only the complete, default-output run produces publication evidence.
    publication = selected == GENERATORS and not args.passthrough
    proof_dir = SCRIPTS_DIR.parent / ".iwac-build"
    proof_path = proof_dir / "provenance.json"
    proof_path.unlink(missing_ok=True)
    sources = {}
    receipts = {}
    failures: List[str] = []
    started = time.monotonic()
    try:
        if publication:
            for subset in iwac_utils.SUBSETS:
                frame = iwac_utils.load_dataset_safe(subset, columns=["o:id", "OCR_is_public"], required=True)
                ids = frame["o:id"].astype(str)
                public = frame["OCR_is_public"].fillna(False).eq(True) if "OCR_is_public" in frame else None
                sources[subset] = {"ids": ids.tolist(), "publicOcrIds": ids[public].tolist() if public is not None else []}
        for name in selected:
            logger.info("::group::generate_%s", name)
            t0 = time.monotonic()
            try:
                iwac_utils._WRITTEN_OUTPUTS.clear()
                iwac_utils._EXPECTED_OUTPUTS.clear()
                run_one(name, args.passthrough)
                missing = iwac_utils._EXPECTED_OUTPUTS - iwac_utils._WRITTEN_OUTPUTS
                if missing:
                    raise ValueError(f"Eligible outputs were not written: {sorted(missing)}")
                if publication:
                    receipts[name] = sorted(Path(p).relative_to(SCRIPTS_DIR.parent / "asset/data").as_posix()
                                            for p in iwac_utils._WRITTEN_OUTPUTS)
            except Exception as exc:                       # noqa: BLE001
                failures.append(name)
                logger.error("generate_%s FAILED: %s", name, exc, exc_info=True)
                if not args.continue_on_error:
                    logger.info("::endgroup::")
                    raise
            finally:
                logger.info("generate_%s took %.1fs", name, time.monotonic() - t0)
                logger.info("::endgroup::")
    finally:
        iwac_utils.set_frame_store(previous)
        if store is not None:
            s = store.stats()
            logger.info(
                "FrameStore: %d load(s), %d served from cache, %d widening(s); "
                "holding %s",
                s["loads"], s["hits"], s["widenings"],
                ", ".join(s["held"]) or "nothing",
            )
        logger.info("%d generator(s) in %.1fs",
                    len(selected), time.monotonic() - started)

    if failures:
        logger.error("failed: %s", ", ".join(failures))
        return 1
    if publication:
        proof = {"sources": sources, "revisions": iwac_utils._DATASET_REVISIONS,
                 "outputs": receipts, "configuration": vars(args)}
        proof_dir.mkdir(exist_ok=True)
        proof_path.write_text(json.dumps(proof), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
