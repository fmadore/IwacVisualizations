"""Golden output of the data generators on a small synthetic dataset.

The unit tests in this directory check helpers one at a time; nothing
checked what a generator WRITES, so a refactor that changed a key, a rank
or a count in any JSON file the blocks read went unnoticed until it reached
a page. This runs the covered generators exactly as ``run_all.py`` does
(``run_one``, their own CLI) against ``golden_corpus`` — offline, served by
a frame store instead of Hugging Face, with the clock frozen — and compares
every file they write with ``tests/golden/<generator>/``.

An intended change: regenerate and review the diff in the commit.

    UPDATE_GOLDEN=1 python -m unittest tests/python/test_golden.py

Floats are compared at 9 significant digits, so a last-bit difference
between numpy builds or platforms does not count as a change.

Covered: every generator that runs on the numeric stack alone. The four that
need umap-learn or networkx (semantic, periodicals and references
landscapes, entity networks) and the three with their own corpus pipelines
(laicite, albani_sermons, timeline) have tests of their own. on_this_day is
left out because it writes a file for every day of the year.
"""
from __future__ import annotations

import json
import math
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[1]
GOLDEN_DIR = ROOT / "tests" / "golden"
for path in (ROOT / "scripts", TESTS_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import golden_corpus  # noqa: E402
import iwac_utils  # noqa: E402
import run_all  # noqa: E402


def _out(flag: str, name: str, *extra: str) -> Callable[[Path], List[str]]:
    """Argv pointing a generator's output flag into the run directory.

    ``extra`` lowers a threshold set for the real collection's scale (15
    articles per newspaper, 25 per term…), which 24 synthetic articles would
    never reach, leaving an output with nothing in it to protect.
    """
    return lambda out: [flag, str(out / name), *extra]


#: generator → the argv that sends its output into the run directory.
COVERED: Dict[str, Callable[[Path], List[str]]] = {
    "audiovisual_overview": _out("--output", "audiovisual-overview.json"),
    "collection_overview": _out("--output", "collection-overview.json"),
    "wordcloud": _out("--output", "collection-wordcloud.json"),
    "world_map": _out("--output", "collection-map.json"),
    "index_overview": _out("--output", "index-overview.json"),
    "keyword_explorer": _out("--output-dir", "."),
    "lexical_metrics": _out("--output", "lexical-metrics.json", "--min-articles", "3"),
    "periodicals_overview": _out("--output", "periodicals-overview.json"),
    "press_bylines": _out("--output", "press-bylines.json", "--prolific-min", "3"),
    "scary_terms": _out("--output-dir", "."),
    "sentiment_atlas": _out("--output", "sentiment-atlas.json"),
    "spatial_exploration": _out("--output", "spatial-exploration.json"),
    "template_summary": _out("--output", "template-summary.json"),
    "topic_explorer": _out("--output", "topic-explorer.json"),
    "compare_newspapers": _out("--output-dir", "compare-newspapers",
                               "--min-count", "3", "--min-wordcloud-freq", "2"),
    "term_trends": _out("--output-dir", ".", "--min-total", "3"),
    "keyness": _out("--output", "keyness.json", "--min-count", "3", "--min-subject-total", "3"),
    "org_cooccurrence": _out("--output-dir", ".", "--targets", str(TESTS_DIR / "golden_org_targets.json")),
    "corpus_health": _out("--output-dir", "."),
    "reprints": _out("--output-dir", ".", "--threshold", "0.95", "--scan-threshold", "0.93",
                     "--min-jaccard", "0.2"),
    "person_dashboards": _out("--output-dir", "person-dashboards"),
    "entity_dashboards": _out("--output-dir", "entity-dashboards"),
    "article_dashboards": _out("--output-dir", "article-dashboards"),
    "publication_dashboards": _out("--output-dir", "publication-dashboards"),
    "reference_dashboards": _out("--output-dir", "reference-dashboards"),
}

FROZEN_NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


class _FrozenDatetime(datetime):
    """``iwac_utils.generate_timestamp`` reads the clock through this."""

    @classmethod
    def now(cls, tz=None):
        return FROZEN_NOW if tz is None else FROZEN_NOW.astimezone(tz)


class FixtureStore:
    """A frame store (``iwac_frames.FrameStore``'s ``get``) over the corpus.

    Every call hands out its own copy, so a generator that mutates a frame
    cannot change what the next one reads.
    """

    def __init__(self, frames):
        self.frames = frames
        self.requests: List[str] = []

    def get(self, config_name, repo_id=None, token=None, columns=None, required=False):
        self.requests.append(config_name)
        frame = self.frames.get(config_name)
        if frame is None:
            if required or iwac_utils.strict_loads():
                raise RuntimeError(f"The golden corpus has no subset '{config_name}'")
            return None
        if columns is None:
            return frame.copy(deep=True)
        return frame[[c for c in columns if c in frame.columns]].copy(deep=True)


def _normalise(value):
    """JSON with floats cut to 9 significant digits, for comparison only."""
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return repr(value)
        return float(f"{value:.9g}")
    if isinstance(value, list):
        return [_normalise(v) for v in value]
    if isinstance(value, dict):
        return {k: _normalise(v) for k, v in value.items()}
    return value


def _first_difference(expected, actual, where="$"):
    """The JSON path of the first difference, for a readable failure."""
    if type(expected) is not type(actual):
        return f"{where}: {type(expected).__name__} → {type(actual).__name__}"
    if isinstance(expected, dict):
        for key in expected.keys() | actual.keys():
            if key not in actual:
                return f"{where}.{key}: removed"
            if key not in expected:
                return f"{where}.{key}: added"
            found = _first_difference(expected[key], actual[key], f"{where}.{key}")
            if found:
                return found
        if list(expected) != list(actual):
            return f"{where}: key order changed"
        return None
    if isinstance(expected, list):
        if len(expected) != len(actual):
            return f"{where}: {len(expected)} items → {len(actual)}"
        for i, (e, a) in enumerate(zip(expected, actual)):
            found = _first_difference(e, a, f"{where}[{i}]")
            if found:
                return found
        return None
    return None if expected == actual else f"{where}: {expected!r} → {actual!r}"


def run_generator(name: str, out: Path, store: FixtureStore) -> Dict[str, object]:
    """Run one covered generator into ``out``; every JSON it wrote, by path."""
    out.mkdir(parents=True, exist_ok=True)
    previous_store = iwac_utils.set_frame_store(store)
    previous_strict = iwac_utils.set_strict_loads(True)
    previous_datetime = iwac_utils.datetime
    iwac_utils.datetime = _FrozenDatetime
    try:
        run_all.run_one(name, COVERED[name](out))
    finally:
        iwac_utils.datetime = previous_datetime
        iwac_utils.set_strict_loads(previous_strict)
        iwac_utils.set_frame_store(previous_store)
    written = {}
    for path in sorted(out.rglob("*.json")):
        written[path.relative_to(out).as_posix()] = _normalise(json.loads(path.read_text(encoding="utf-8")))
    return written


class GoldenOutputTest(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        cls.frames = golden_corpus.corpus()
        cls.tmp = Path(tempfile.mkdtemp(prefix="iwac-golden-"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_every_covered_generator_is_one_run_all_runs(self):
        self.assertEqual(sorted(set(COVERED) - set(run_all.GENERATORS)), [])

    def test_generators_match_their_golden_output(self):
        update = os.environ.get("UPDATE_GOLDEN") == "1"
        for name in COVERED:
            with self.subTest(generator=name):
                written = run_generator(name, self.tmp / name, FixtureStore(self.frames))
                self.assertTrue(written, f"{name} wrote no JSON")
                golden = GOLDEN_DIR / name
                if update:
                    shutil.rmtree(golden, ignore_errors=True)
                    for rel, data in written.items():
                        target = golden / rel
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n",
                                          encoding="utf-8", newline="\n")
                    continue
                expected = {
                    path.relative_to(golden).as_posix(): json.loads(path.read_text(encoding="utf-8"))
                    for path in sorted(golden.rglob("*.json"))
                } if golden.is_dir() else {}
                self.assertEqual(sorted(expected), sorted(written),
                                 f"{name}: the set of files written changed (UPDATE_GOLDEN=1 to accept)")
                for rel in expected:
                    difference = _first_difference(expected[rel], written[rel])
                    self.assertIsNone(difference,
                                      f"{name}/{rel} differs at {difference} (UPDATE_GOLDEN=1 to accept)")

    def test_no_golden_directory_is_left_without_a_generator(self):
        if not GOLDEN_DIR.is_dir():
            return
        orphans = sorted(p.name for p in GOLDEN_DIR.iterdir() if p.is_dir() and p.name not in COVERED)
        self.assertEqual(orphans, [], "tests/golden holds output of a generator this test no longer runs")


if __name__ == "__main__":
    unittest.main()
