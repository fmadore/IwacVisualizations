"""generate_collection_overview: what the golden test cannot show on its
own corpus, where every content item is dated and the dated and exact
counts agree.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parents[1]
for path in (ROOT / "scripts", TESTS_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import golden_corpus  # noqa: E402
import generate_collection_overview as overview  # noqa: E402


def _summary(frames):
    subset_summaries = {name: overview.compute_subset_summary(df) for name, df in frames.items()}
    timeline = overview.compute_timeline(frames, 1900, 2100)
    return overview.compute_summary(
        subset_summaries, frames, timeline,
        overview.compute_country_distribution(frames),
        overview.compute_languages_faceted(frames, top_n=10),
        overview.compute_newspapers(frames, top_n=15, year_min=1900, year_max=2100),
    )


class TypeTotalsTests(unittest.TestCase):
    def test_every_type_has_an_exact_total_that_counts_undated_items(self):
        frames = golden_corpus.corpus()
        # An undated record of each of the three types that used to be read
        # off `types_over_time`, which counts dated items only.
        for subset in ("publications", "documents", "audiovisual"):
            frames[subset].loc[frames[subset].index[0], "pub_date"] = ""
        summary = _summary(frames)
        types = overview.compute_types_over_time(frames, 1900, 2100)["series_global"]

        for key, subset, type_key in (("publications_count", "publications", "publication"),
                                      ("documents_count", "documents", "document"),
                                      ("audiovisual_count", "audiovisual", "audiovisual")):
            self.assertEqual(summary[key], len(frames[subset]))
            self.assertEqual(sum(types[type_key]), len(frames[subset]) - 1)

        # The six type totals account for every item.
        self.assertEqual(
            summary["articles"] + summary["publications_count"] + summary["documents_count"]
            + summary["audiovisual_count"] + summary["references_count"] + summary["photographs"],
            summary["total_items"],
        )

    def test_a_missing_subset_reads_zero_not_absent(self):
        frames = golden_corpus.corpus()
        del frames["documents"]
        self.assertEqual(_summary(frames)["documents_count"], 0)


if __name__ == "__main__":
    unittest.main()
