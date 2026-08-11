"""Focused behavioral tests for the shared generator contracts."""
from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import dashboard_aggregator  # noqa: E402
import generate_topic_explorer  # noqa: E402
import iwac_embeddings  # noqa: E402
import iwac_stats  # noqa: E402
import iwac_utils  # noqa: E402


class UtilityContractTests(unittest.TestCase):
    def test_pure_helpers_do_not_load_the_datasets_client(self) -> None:
        self.assertNotIn("datasets", sys.modules)

    def test_dataset_boundary_reports_the_missing_client(self) -> None:
        with patch.dict(sys.modules, {"datasets": None}):
            with self.assertRaisesRegex(ImportError, "dataset client not installed"):
                iwac_utils._load_hf_dataset(path="example/private", name="articles")

    def test_country_and_pipe_normalization(self) -> None:
        self.assertEqual(iwac_utils.canonical_country("cote d'ivoire"), "Côte d'Ivoire")
        self.assertEqual(
            iwac_utils.canonicalize_country_field("benin|burkina faso"),
            "Bénin|Burkina Faso",
        )
        self.assertEqual(
            iwac_utils.parse_pipe_separated(" Ramadan | Islam || "),
            ["Ramadan", "Islam"],
        )

    def test_unknown_contract_is_trimmed_and_bilingual(self) -> None:
        for value in (None, np.nan, "", " Unknown ", "inconnu", "N/A", "na", "none", "null", "—"):
            self.assertTrue(iwac_utils.is_unknown(value), value)
        for value in (0, False, "Bénin"):
            self.assertFalse(iwac_utils.is_unknown(value), value)

    def test_coordinates_enforce_geographic_ranges(self) -> None:
        self.assertEqual(iwac_utils.parse_coordinates("12.34, -56.78"), (12.34, -56.78))
        self.assertIsNone(iwac_utils.parse_coordinates("91, 0"))
        self.assertIsNone(iwac_utils.parse_coordinates("not coordinates"))

    def test_sentiment_resolver_binds_every_model_to_its_own_columns(self) -> None:
        # Both annotation generations ship on the Hub. Resolving must pick
        # the generation-2 columns the module now reads and never fall
        # back onto a generation-1 column that happens to be present.
        frame = pd.DataFrame(columns=[
            "gpt_5_mini_polarite",
            "ministral_14b_2512_polarite",
            *[
                f"{model}_{suffix}"
                for model in iwac_utils.SENTIMENT_MODELS
                for suffix in iwac_utils.SENTIMENT_FIELD_SUFFIXES.values()
            ],
        ])
        resolved = iwac_utils.resolve_sentiment_columns(frame)

        self.assertEqual(
            set(resolved),
            {"gpt_5_6_luna", "mistral_small_2603", "deepseek_v4_flash_0731"},
        )
        self.assertEqual(resolved["gpt_5_6_luna"]["polarite"], "gpt_5_6_luna_polarite")
        self.assertEqual(
            resolved["deepseek_v4_flash_0731"]["centralite"],
            "deepseek_v4_flash_0731_centralite_islam_musulmans",
        )
        self.assertEqual(
            resolved["mistral_small_2603"]["subjectivite"],
            "mistral_small_2603_subjectivite_score",
        )

    def test_sentiment_resolver_reports_a_model_with_no_columns(self) -> None:
        resolved = iwac_utils.resolve_sentiment_columns(
            pd.DataFrame(columns=["title"]),
            models=("gpt_5_6_luna",),
        )
        self.assertEqual(
            resolved["gpt_5_6_luna"],
            {"polarite": None, "centralite": None, "subjectivite": None},
        )

    def test_subjectivite_ordinal_reads_labels_and_legacy_numbers(self) -> None:
        # Generation 2 stores a French label where generation 1 stored an
        # int; both must land on the same 1-5 scale, and anything the
        # model declined to rate must stay None rather than becoming 0.
        self.assertEqual(iwac_utils.subjectivite_ordinal("Très objectif"), 1)
        self.assertEqual(iwac_utils.subjectivite_ordinal("Plutôt objectif"), 2)
        self.assertEqual(iwac_utils.subjectivite_ordinal("Mixte"), 3)
        self.assertEqual(iwac_utils.subjectivite_ordinal("Plutôt subjectif"), 4)
        self.assertEqual(iwac_utils.subjectivite_ordinal("Très subjectif"), 5)
        self.assertEqual(iwac_utils.subjectivite_ordinal(4), 4)
        self.assertEqual(iwac_utils.subjectivite_ordinal("2.0"), 2)
        for empty in (None, "", "   ", np.nan, "nan", "Non abordé", 0, 6):
            self.assertIsNone(iwac_utils.subjectivite_ordinal(empty), empty)

    def test_dataset_projection_avoids_materializing_heavy_columns(self) -> None:
        class Split:
            def __init__(self, frame: pd.DataFrame):
                self.frame = frame
                self.column_names = list(frame.columns)

            def select_columns(self, columns):
                return Split(self.frame[list(columns)])

            def to_pandas(self):
                return self.frame.copy()

        dataset = {"train": Split(pd.DataFrame({"o:id": [1], "OCR": ["large"]}))}
        with patch.object(iwac_utils, "_load_hf_dataset", return_value=dataset):
            projected = iwac_utils.load_dataset_safe("articles", columns=["o:id", "missing"])
        self.assertEqual(list(projected.columns), ["o:id"])


class EmbeddingTests(unittest.TestCase):
    def test_embedding_cells_must_be_flat_and_finite(self) -> None:
        self.assertIsNone(iwac_embeddings.coerce_embedding([[1.0, 2.0]]))
        self.assertIsNone(iwac_embeddings.coerce_embedding([1.0, math.inf]))
        np.testing.assert_array_equal(
            iwac_embeddings.coerce_embedding([1, 2]),
            np.asarray([1, 2], dtype=np.float32),
        )

    def test_single_row_has_no_self_neighbour(self) -> None:
        matrix = np.asarray([[1.0, 0.0]], dtype=np.float32)
        self.assertEqual(iwac_embeddings.top_k_cosine(matrix, [0], 5), [[]])

    def test_top_k_excludes_self_and_sorts_descending(self) -> None:
        matrix = np.asarray([[1.0, 0.0], [0.8, 0.6], [0.0, 1.0]], dtype=np.float32)
        result = iwac_embeddings.top_k_cosine(matrix, [0, 1, 2], 2)
        self.assertEqual([idx for idx, _score in result[0]], [1, 2])
        self.assertNotIn(0, [idx for idx, _score in result[0]])

    def test_invalid_batch_size_fails_fast(self) -> None:
        matrix = np.eye(2, dtype=np.float32)
        with self.assertRaises(ValueError):
            iwac_embeddings.top_k_cosine(matrix, [0, 1], 1, batch_size=0)
        with self.assertRaises(ValueError):
            list(iwac_embeddings.pairs_above_threshold(matrix, 0.5, batch_size=0))


class StatisticsTests(unittest.TestCase):
    def test_dunning_g2_uses_the_complete_two_by_two_table(self) -> None:
        score = iwac_stats.dunning_g2(100, 10, 1000, 1000)
        self.assertAlmostEqual(score, 89.75977375846583)
        self.assertAlmostEqual(
            iwac_stats.dunning_g2(10, 100, 1000, 1000),
            -score,
        )
        self.assertLess(iwac_stats.dunning_g2(0, 10, 1000, 1000), 0)

    def test_dunning_g2_scores_equal_rates_as_no_keyness(self) -> None:
        self.assertAlmostEqual(iwac_stats.dunning_g2(10, 10, 1000, 1000), 0.0)

    def test_dunning_g2_rejects_counts_outside_their_corpus(self) -> None:
        # A caller bug must surface, not become a p-value of 1.0 in the BH
        # family. Kept in step with IWAC-Hugging-Face's keyness_bursts.py.
        for a, b, total_a, total_b in [
            (10, 10, 0, 1000),      # empty corpus A
            (10, 10, 1000, 0),      # empty corpus B
            (10, 10, -1000, 1000),  # negative total
            (-1, 10, 1000, 1000),   # negative count
            (10, -1, 1000, 1000),
            (1001, 10, 1000, 1000),  # count exceeds its corpus
            (10, 1001, 1000, 1000),
        ]:
            with self.subTest(a=a, b=b, total_a=total_a, total_b=total_b):
                with self.assertRaises(ValueError):
                    iwac_stats.dunning_g2(a, b, total_a, total_b)

    def test_benjamini_hochberg_adjustment_is_aligned_and_monotone(self) -> None:
        adjusted = iwac_stats.bh_adjust([0.01, 0.04, 0.03])
        np.testing.assert_allclose(adjusted, [0.03, 0.04, 0.04])

    def test_contiguous_years_keeps_corpus_gaps_explicit(self) -> None:
        self.assertEqual(iwac_stats.contiguous_years([2001, 1999]), [1999, 2000, 2001])


class TopicExplorerTests(unittest.TestCase):
    def test_hijri_months_are_read_from_stored_dataset_columns(self) -> None:
        row = pd.Series({"hy": 1445, "hm": 9})
        self.assertEqual(
            generate_topic_explorer.read_hijri_month(
                row,
                {"hijri_year": "hy", "hijri_month": "hm"},
            ),
            (1445, 9),
        )
        row["hm"] = 13
        self.assertIsNone(
            generate_topic_explorer.read_hijri_month(
                row,
                {"hijri_year": "hy", "hijri_month": "hm"},
            )
        )

    def test_hijri_reader_rejects_the_nulls_partial_dates_leave(self) -> None:
        # Only a complete YYYY-MM-DD converts upstream, so the normal
        # miss is a NaN in a float64 column — not a missing column.
        cols = {"hijri_year": "hy", "hijri_month": "hm"}
        self.assertIsNone(
            iwac_utils.read_hijri_month(pd.Series({"hy": float("nan"), "hm": 9.0}), cols)
        )
        # ...and a float-typed hit still reads as an int pair.
        self.assertEqual(
            iwac_utils.read_hijri_month(pd.Series({"hy": 1445.0, "hm": 9.0}), cols),
            (1445, 9),
        )
        # References carry no such columns at all.
        self.assertIsNone(
            iwac_utils.read_hijri_month(pd.Series({"hy": 1445}), {"hijri_year": None})
        )


class DashboardHeatmapTests(unittest.TestCase):
    def test_month_grid_fills_gap_years_and_totals_its_own_items(self) -> None:
        grid = dashboard_aggregator.DashboardAggregator._month_grid(
            {(1999, 1): 2, (2001, 12): 3},
            {1999, 2000, 2001},
        )
        # A category axis of [1999, 2001] would render the silent year as
        # one column step and read as continuous coverage.
        self.assertEqual(grid["years"], [1999, 2000, 2001])
        self.assertEqual(sorted(grid["cells"]), [[0, 0, 2], [2, 11, 3]])
        # The panel subtracts these two totals to state the Hijri view's
        # smaller denominator, so it has to count items and not cells.
        self.assertEqual(grid["items"], 5)

    def test_empty_slice_is_a_grid_shape_not_none(self) -> None:
        grid = dashboard_aggregator.DashboardAggregator._month_grid({}, set())
        self.assertEqual(grid["years"], [])
        self.assertEqual(grid["cells"], [])
        self.assertEqual(grid["items"], 0)
        self.assertEqual(grid["months"], list(range(1, 13)))


if __name__ == "__main__":
    unittest.main()
