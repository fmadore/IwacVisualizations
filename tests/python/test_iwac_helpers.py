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

    def test_sentiment_resolver_prefers_current_model_specific_names(self) -> None:
        frame = pd.DataFrame(columns=[
            "gpt_5_mini_polarite",
            "chatgpt_polarite",
            "gpt_5_mini_centralite_islam_musulmans",
            "gpt_5_mini_subjectivite_score",
        ])
        resolved = iwac_utils.resolve_sentiment_columns(
            frame,
            models=("chatgpt",),
        )
        self.assertEqual(resolved["chatgpt"]["polarite"], "gpt_5_mini_polarite")
        self.assertEqual(
            resolved["chatgpt"]["centralite"],
            "gpt_5_mini_centralite_islam_musulmans",
        )

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


if __name__ == "__main__":
    unittest.main()
