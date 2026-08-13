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
import generate_periodicals_overview  # noqa: E402
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


class TopicMixtureTests(unittest.TestCase):
    """Contracts for the shared lda_topic_topk helpers.

    These moved out of generate_topic_explorer when the periodicals
    topics panels became a second consumer. They matter more on
    `publications` than on `articles`: mean dominant-topic probability
    there is 0.345, so the mixture is the measurement and a dominant
    label would misdescribe most issues.
    """

    COLUMNS = {"topic_topk": "lda_topic_topk", "date": "pub_date"}

    def test_topk_parser_skips_malformed_pairs_rather_than_guessing(self) -> None:
        self.assertEqual(
            iwac_utils.parse_topk("14:0.2749|16:0.1160|11:0.0890"),
            [(14, 0.2749), (16, 0.1160), (11, 0.0890)],
        )
        # Fewer than k pairs is normal: entries below the model's
        # minimum_probability are dropped upstream.
        self.assertEqual(iwac_utils.parse_topk("3:0.5"), [(3, 0.5)])
        # Junk, a bare id, an outlier id and an out-of-range prob all drop
        # out; the survivors are still returned.
        self.assertEqual(
            iwac_utils.parse_topk("x:y|7|-1:0.4|2:1.4|5:0.3"),
            [(5, 0.3)],
        )
        self.assertEqual(iwac_utils.parse_topk(float("nan")), [])

    def test_prevalence_is_absent_rather_than_faked_without_the_column(self) -> None:
        df = pd.DataFrame({"pub_date": ["1998-03-01"]})
        self.assertIsNone(iwac_utils.aggregate_prevalence(df, self.COLUMNS, {}))
        # Present but empty is the same answer, not a zero-filled bundle.
        df["lda_topic_topk"] = [""]
        self.assertIsNone(iwac_utils.aggregate_prevalence(df, self.COLUMNS, {}))

    def test_truncated_mass_is_reported_not_renormalised(self) -> None:
        # Two 1998 issues capturing 0.6 and 0.5 of their mass. Renormalising
        # each to 1.0 would inflate every series and turn a known partial
        # measurement into a fake complete one.
        df = pd.DataFrame({
            "pub_date": ["1998-03-01", "1998-09-01"],
            "lda_topic_topk": ["0:0.4|1:0.2", "0:0.5"],
        })
        out = iwac_utils.aggregate_prevalence(df, self.COLUMNS, {0: "islam"})
        self.assertEqual(out["years"], [1998])
        self.assertEqual(out["n_docs"], [2])
        self.assertAlmostEqual(out["captured_mass"][0], 0.55)
        self.assertAlmostEqual(out["mean_captured_mass"], 0.55)
        # The stack sums to the captured mass, leaving the tail as visible
        # headroom rather than closing the gap.
        self.assertAlmostEqual(
            sum(s["values"][0] for s in out["series"]), 0.55
        )

    def test_every_topic_in_the_mixture_scores_not_just_the_dominant_one(self) -> None:
        df = pd.DataFrame({
            "pub_date": ["1998-03-01", "1998-09-01"],
            "lda_topic_topk": ["0:0.4|1:0.2", "0:0.5"],
        })
        out = iwac_utils.aggregate_prevalence(df, self.COLUMNS, {0: "islam"})
        by_id = {s["id"]: s for s in out["series"]}
        # Topic 1 is never any issue's dominant label; a dominant-topic
        # count would score it zero. Its runner-up mass still counts.
        self.assertAlmostEqual(by_id[1]["mean"], 0.1)
        self.assertAlmostEqual(by_id[0]["mean"], 0.45)
        # Unlabelled topics get a placeholder rather than an empty legend.
        self.assertEqual(by_id[0]["label"], "islam")
        self.assertEqual(by_id[1]["label"], "Topic 1")
        self.assertEqual(out["k_max"], 2)

    def test_undated_rows_are_skipped_by_the_per_year_aggregation(self) -> None:
        df = pd.DataFrame({
            "pub_date": ["1998-03-01", ""],
            "lda_topic_topk": ["0:0.4", "0:0.9"],
        })
        out = iwac_utils.aggregate_prevalence(df, self.COLUMNS, {})
        self.assertEqual(out["docs"], 1)
        self.assertAlmostEqual(out["series"][0]["mean"], 0.4)


class PeriodicalsTopicsTests(unittest.TestCase):
    """Contracts for the Periodicals Overview topic-mixture section."""

    @staticmethod
    def _frame(**overrides) -> pd.DataFrame:
        data = {
            "o:id": ["101", "102", "103", "104"],
            "title": ["Issue 1", "Issue 2", "Issue 3", "Arabic issue"],
            "newspaper": ["Al Islam", "Al Islam", "La Voix", "Al Manar"],
            "issue": ["12", "13", "4", "1"],
            "pub_date": ["1998-03-01", "1998-09-01", "2001-06-04", "1999-01-01"],
            "thumbnail": ["t1", "t2", "t3", None],
            # float64 with a NaN, exactly as the subset arrives.
            "lda_topic_id": [14.0, 16.0, 14.0, float("nan")],
            "lda_topic_prob": [0.2749, 0.31, 0.40, float("nan")],
            "lda_topic_label": ["islam - religion", "ecole - laicite", "islam - religion", None],
            "lda_topic_topk": [
                "14:0.2749|16:0.1160|11:0.0890", "16:0.31|14:0.12", "14:0.40|11:0.09", None,
            ],
            "lda_model_name": ["lda_model_publications"] * 3 + [None],
        }
        data.update(overrides)
        return pd.DataFrame(data)

    def test_unmodelled_issues_are_null_not_outliers(self) -> None:
        # publications follows the references convention: an issue without
        # usable OCR is null, NOT -1. Treating a null as topic -1 would
        # invent a topic; counting it as modelled would overstate coverage.
        out = generate_periodicals_overview.compute_topics(self._frame(), items_per_topic=5)
        self.assertEqual(out["coverage"], {
            "modelled": 3, "total": 4, "share": 0.75, "reason": "",
        })
        self.assertNotIn(-1, [t["id"] for t in out["topics"]])

    def test_an_outlier_sentinel_would_degrade_to_uncovered(self) -> None:
        # If upstream ever switched publications to the articles convention,
        # -1 must read as "no topic" rather than becoming topic -1.
        self.assertIsNone(generate_periodicals_overview._topic_id(-1.0))
        self.assertIsNone(generate_periodicals_overview._topic_id(float("nan")))
        self.assertEqual(generate_periodicals_overview._topic_id(14.0), 14)

    def test_representative_issues_rank_on_the_topics_own_share(self) -> None:
        out = generate_periodicals_overview.compute_topics(self._frame(), items_per_topic=5)
        by_id = {t["id"]: t for t in out["topics"]}

        # Topic 16 is dominant for issue 102 (0.31) and a runner-up in
        # issue 101 (0.116). Ranking on lda_topic_prob would return only
        # the issue it won; the runner-up must still surface.
        shares = [(i["o_id"], i["share"], i["is_dominant"]) for i in by_id[16]["items"]]
        self.assertEqual(shares, [("102", 0.31, True), ("101", 0.116, False)])

        # Topic 11 never wins an issue, so a dominant-topic count scores it
        # zero — yet it carries real mass across two issues.
        self.assertEqual(by_id[11]["dominant_count"], 0)
        self.assertEqual(by_id[11]["issues"], 2)
        self.assertAlmostEqual(by_id[11]["mass"], 0.179)

    def test_one_periodical_cannot_fill_the_representative_grid(self) -> None:
        # Measured on the live data, 8 of 20 topics returned ten issues of
        # a single title — a theme spanning many periodicals rendered as
        # if it belonged to one magazine.
        df = self._frame(
            **{
                "o:id": ["1", "2", "3", "4"],
                "newspaper": ["Al Islam", "Al Islam", "Al Islam", "La Voix"],
                "lda_topic_topk": ["14:0.9", "14:0.8", "14:0.7", "14:0.1"],
                "lda_topic_id": [14.0] * 4,
                "lda_topic_prob": [0.9, 0.8, 0.7, 0.1],
                "lda_topic_label": ["islam - religion"] * 4,
                "lda_model_name": ["lda_model_publications"] * 4,
            }
        )
        out = generate_periodicals_overview.compute_topics(
            df, items_per_topic=3, items_per_periodical=2,
        )
        items = out["topics"][0]["items"]
        # The 0.1 issue outranks Al Islam's third despite a far lower
        # share, because the cap has already spent that title's budget.
        self.assertEqual([i["o_id"] for i in items], ["1", "2", "4"])
        self.assertEqual(out["topics"][0]["periodicals"], 2)

    def test_the_cap_never_shrinks_a_single_periodical_theme(self) -> None:
        # A theme genuinely carried by one title must still fill its grid,
        # or the cap would punish a real finding.
        df = self._frame(
            **{
                "o:id": ["1", "2", "3", "4"],
                "newspaper": ["Al Islam"] * 4,
                "lda_topic_topk": ["14:0.9", "14:0.8", "14:0.7", "14:0.6"],
                "lda_topic_id": [14.0] * 4,
                "lda_topic_prob": [0.9, 0.8, 0.7, 0.6],
                "lda_topic_label": ["islam - religion"] * 4,
                "lda_model_name": ["lda_model_publications"] * 4,
            }
        )
        out = generate_periodicals_overview.compute_topics(
            df, items_per_topic=4, items_per_periodical=2,
        )
        items = out["topics"][0]["items"]
        self.assertEqual([i["o_id"] for i in items], ["1", "2", "3", "4"])
        self.assertEqual(out["topics"][0]["periodicals"], 1)

    def test_the_dominant_gap_is_carried_not_hidden(self) -> None:
        # issues vs dominant_count is the evidence for reading mixtures at
        # all; collapsing them would make the panel's framing unfalsifiable.
        out = generate_periodicals_overview.compute_topics(self._frame(), items_per_topic=5)
        by_id = {t["id"]: t for t in out["topics"]}
        self.assertEqual((by_id[14]["issues"], by_id[14]["dominant_count"]), (3, 2))
        self.assertEqual((by_id[16]["issues"], by_id[16]["dominant_count"]), (2, 1))

    def test_topics_rank_by_mass_and_report_the_truncated_total(self) -> None:
        out = generate_periodicals_overview.compute_topics(self._frame(), items_per_topic=5)
        self.assertEqual([t["id"] for t in out["topics"]], [14, 16, 11])
        # Three modelled issues capturing 0.4799 + 0.43 + 0.49 of their mass.
        self.assertAlmostEqual(out["captured_mass"], 0.4666, places=4)
        self.assertLess(out["captured_mass"], 1.0)
        # Surfaced from the data, not hardcoded — this is the number the
        # whole mixture treatment rests on.
        self.assertAlmostEqual(out["mean_dominant_prob"], 0.3283, places=4)
        self.assertEqual(out["models"], ["lda_model_publications"])
        self.assertEqual(out["source_field"], "OCR")

    def test_a_snapshot_without_topics_renders_a_reason_not_a_crash(self) -> None:
        df = self._frame().drop(columns=["lda_topic_topk"])
        out = generate_periodicals_overview.compute_topics(df, items_per_topic=5)
        self.assertEqual(out["topics"], [])
        self.assertIsNone(out["prevalence"])
        self.assertEqual(out["coverage"]["reason"], "no lda_topic_topk column")
        # Empty state must be the same shape as a populated one, or the
        # panel has to branch on key presence.
        populated = generate_periodicals_overview.compute_topics(self._frame(), items_per_topic=5)
        self.assertEqual(set(out), set(populated))


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


class DashboardNetworkTests(unittest.TestCase):
    class MiniAggregator(dashboard_aggregator.DashboardAggregator):
        def _role_slices(self, _target_id):
            yield "all", ["item-1"]

        def _item_neighbor_ids(self, item_key, _exclude):
            return self.neighbours[item_key]

    def test_type_rankings_use_the_full_pool_not_the_mixed_top_fifty(self) -> None:
        agg = self.MiniAggregator(ROOT, min_cooccurrence=1)
        target_id = 1
        organisation_ids = list(range(100, 151))  # 51 ties, inserted first
        person_id = 999
        agg.neighbours = {"item-1": organisation_ids + [person_id]}
        agg.targets = {
            target_id: {"o_id": target_id, "title": "Centre", "type": "Personnes"}
        }
        agg.id_to_entity = {
            **{
                o_id: {"o_id": o_id, "title": f"Organisation {o_id}", "type": "Organisations"}
                for o_id in organisation_ids
            },
            person_id: {"o_id": person_id, "title": "Person outside mixed top 50", "type": "Personnes"},
        }
        agg.df = {o_id: 1 for o_id in organisation_ids + [person_id]}
        agg.n_targets = 100

        graph = agg.compute_network(target_id)["by_role"]["all"]
        mixed_ids = {node["o_id"] for node in graph["nodes"]}
        person_ids = {node["o_id"] for node in graph["by_type"]["Personnes"]["nodes"]}

        # Root shape/cap stays compatible with older clients: centre + top 50.
        self.assertEqual(len(graph["nodes"]), 51)
        self.assertNotIn(person_id, mixed_ids)
        # The Persons filter answers "top persons", not "persons among that
        # mixed top 50", so the tied person remains discoverable.
        self.assertEqual(person_ids, {target_id, person_id})
        self.assertEqual(
            list(graph["by_type"]),
            list(dashboard_aggregator.NETWORK_ENTITY_TYPES),
        )


if __name__ == "__main__":
    unittest.main()
