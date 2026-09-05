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
import generate_collection_overview  # noqa: E402
import generate_periodicals_overview  # noqa: E402
import generate_template_summary  # noqa: E402
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

        self.assertEqual(set(resolved), set(iwac_utils.SENTIMENT_MODELS))
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

    def test_present_models_drops_the_all_none_dict(self) -> None:
        # The whole point of the helper: `{...: None}` is truthy, so a
        # plain `if resolved.get(model)` keeps a model with no columns and
        # publishes a picker entry backed by nothing. A model is annotated
        # on Omeka before its Hugging Face column exists, so this is the
        # normal state of affairs mid-campaign, not an error case.
        frame = pd.DataFrame(columns=[
            f"gpt_5_6_luna_{suffix}"
            for suffix in iwac_utils.SENTIMENT_FIELD_SUFFIXES.values()
        ])
        resolved = iwac_utils.resolve_sentiment_columns(
            frame, models=("gpt_5_6_luna", "gemma_4_31b_it"))

        self.assertTrue(all(resolved["gemma_4_31b_it"][f] is None
                            for f in resolved["gemma_4_31b_it"]))
        self.assertEqual(
            iwac_utils.present_sentiment_models(
                resolved, models=("gpt_5_6_luna", "gemma_4_31b_it")),
            ["gpt_5_6_luna"],
        )

    def test_present_models_keeps_the_canonical_order(self) -> None:
        # The block's model picker opens on models[0]; deriving the list
        # from a set would make that jump between regenerations.
        frame = pd.DataFrame(columns=[
            f"{model}_{suffix}"
            for model in iwac_utils.SENTIMENT_MODELS
            for suffix in iwac_utils.SENTIMENT_FIELD_SUFFIXES.values()
        ])
        resolved = iwac_utils.resolve_sentiment_columns(frame)
        self.assertEqual(
            iwac_utils.present_sentiment_models(resolved),
            list(iwac_utils.SENTIMENT_MODELS),
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
            yield "all", getattr(self, "item_keys", ["item-1"])

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
        agg.items_meta = {"item-1": {"pub_date": "2001-04-12"}}

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
        self.assertEqual(graph["over_time"]["entities"][str(person_id)], [[2001, 1]])

    def test_temporal_profile_counts_items_once_and_discloses_undated_items(self) -> None:
        agg = self.MiniAggregator(ROOT, min_cooccurrence=1)
        agg.item_keys = ["item-1", "item-2", "item-3", "item-4"]
        agg.neighbours = {
            "item-1": [2, 2, 3],  # malformed duplicate must count once
            "item-2": [2, 3],
            "item-3": [2],
            "item-4": [3],
        }
        agg.targets = {
            1: {"o_id": 1, "title": "Centre", "type": "Personnes"}
        }
        agg.id_to_entity = {
            2: {"o_id": 2, "title": "Person", "type": "Personnes"},
            3: {"o_id": 3, "title": "Organisation", "type": "Organisations"},
        }
        agg.df = {2: 1, 3: 1}
        agg.n_targets = 10
        agg.items_meta = {
            "item-1": {"pub_date": "1999-03-01"},
            "item-2": {"pub_date": "2001"},
            "item-3": {"pub_date": ""},
            "item-4": {"pub_date": "2006-12"},
        }

        graph = agg.compute_network(1)["by_role"]["all"]
        timeline = graph["over_time"]
        nodes = {node["o_id"]: node for node in graph["nodes"]}

        self.assertEqual(nodes[2]["cooc"], 3)
        self.assertEqual(nodes[3]["cooc"], 3)
        self.assertEqual(timeline["year_min"], 1999)
        self.assertEqual(timeline["year_max"], 2006)
        self.assertEqual(timeline["dated_items"], 3)
        self.assertEqual(timeline["undated_items"], 1)
        self.assertEqual(timeline["entities"]["2"], [[1999, 1], [2001, 1]])
        self.assertEqual(
            timeline["entities"]["3"],
            [[1999, 1], [2001, 1], [2006, 1]],
        )


class DurationParsingTests(unittest.TestCase):
    """`parse_duration_seconds` — the one place runtimes are read.

    The audiovisual subset carries both ISO 8601 `extent` (`PT571M` on the
    deposited recordings, `PT2M34S` on the YouTube cohort) and an explicit
    `duration_seconds` column, and the figures on the homepage hero are
    summed from them.
    """

    def test_iso8601_forms(self) -> None:
        self.assertEqual(iwac_utils.parse_duration_seconds("PT2M34S"), 154)
        self.assertEqual(iwac_utils.parse_duration_seconds("PT571M"), 34260)
        self.assertEqual(iwac_utils.parse_duration_seconds("PT1H30M15S"), 5415)
        self.assertEqual(iwac_utils.parse_duration_seconds("PT45S"), 45)
        self.assertEqual(iwac_utils.parse_duration_seconds("P1DT2H"), 93600)

    def test_clock_forms(self) -> None:
        self.assertEqual(iwac_utils.parse_duration_seconds("2:34"), 154)
        self.assertEqual(iwac_utils.parse_duration_seconds("1:30:15"), 5415)

    def test_bare_numbers_are_seconds_never_minutes(self) -> None:
        # The unit contract that replaced the "median > 500 ⇒ seconds"
        # heuristic. Reading 183 as minutes turns a three-minute video
        # into a three-hour one, and nothing downstream would notice.
        self.assertEqual(iwac_utils.parse_duration_seconds(183), 183)
        self.assertEqual(iwac_utils.parse_duration_seconds("183"), 183)
        self.assertEqual(iwac_utils.parse_duration_seconds(183.4), 183)

    def test_unparseable_is_none_not_zero(self) -> None:
        for value in (None, "", "   ", "PT", "P", "nope", float("nan"), -5, True):
            self.assertIsNone(iwac_utils.parse_duration_seconds(value), value)


def _audiovisual_frame() -> pd.DataFrame:
    """A miniature class-38 corpus: both populations, mixed coverage.

    Deliberately awkward in the ways the real subset is — one row whose
    runtime lives only in `extent`, one with no publisher at all, accents
    and mixed case in a channel name, an empty `source` on every YouTube
    row (dcterms:source is a deposited-media field).
    """
    return pd.DataFrame([
        {"o:id": "1", "title": "Journal", "pub_date": "2025-04-02", "country": "Burkina Faso",
         "publisher": "RTB - Radiodiffusion Télévision du Burkina", "source": "",
         "language": "Français", "thumbnail": "t1.jpg", "medium": "Vidéo sur le web",
         "type": "Enregistrement vidéo", "URL": "https://www.youtube.com/watch?v=a",
         "source_type": "youtube", "duration_seconds": 154, "extent": "PT2M34S"},
        {"o:id": "2", "title": "Débat", "pub_date": "2026-01-15", "country": "Burkina Faso",
         "publisher": "rtb - radiodiffusion télévision du burkina", "source": "",
         "language": "Français", "thumbnail": "t2.jpg", "medium": "Vidéo sur le web",
         "type": "Enregistrement vidéo", "URL": "https://www.youtube.com/watch?v=b",
         "source_type": "youtube", "duration_seconds": 200, "extent": "PT3M20S"},
        {"o:id": "3", "title": "Formation", "pub_date": "2024-06-01", "country": "Burkina Faso",
         "publisher": "L'Autregard", "source": "",
         "language": "Français", "thumbnail": "t3.jpg", "medium": "Vidéo sur le web",
         "type": "Enregistrement vidéo", "URL": "https://www.youtube.com/watch?v=c",
         "source_type": "youtube", "duration_seconds": 0, "extent": "PT10M"},
        {"o:id": "4", "title": "Sermon", "pub_date": "1999-01-01", "country": "Nigeria",
         "publisher": "Daarul Hadeethis Salafiyyah", "source": "Zaria archive",
         "language": "Haoussa|Arabe", "thumbnail": "t4.jpg", "medium": "DVD",
         "type": "Enregistrement vidéo", "URL": "",
         "source_type": "deposited", "duration_seconds": 34260, "extent": "PT571M"},
        {"o:id": "5", "title": "Sans éditeur", "pub_date": "2020", "country": "Bénin",
         "publisher": "", "source": "", "language": "Français", "thumbnail": "",
         "medium": "CD", "type": "", "URL": "", "source_type": "deposited",
         "duration_seconds": 60, "extent": "PT1M"},
    ])


class TemplateSummaryAudiovisualTests(unittest.TestCase):
    """The source-aware precompute behind the minimal-item block.

    Assertions are invariants, not counts: this subset went from 47 rows
    to four figures in one afternoon, and every number frozen into a test
    was stale within hours.
    """

    def setUp(self) -> None:
        self.summary = generate_template_summary.build_subset_summary(
            "audiovisual", _audiovisual_frame()
        )

    def test_populations_partition_the_subset(self) -> None:
        by_source = self.summary["by_source_type"]
        self.assertEqual(set(by_source), {"youtube", "deposited"})
        self.assertEqual(
            sum(slice_["total"] for slice_ in by_source.values()),
            self.summary["total"],
        )

    def test_publisher_slices_fold_case_and_keep_a_display_label(self) -> None:
        channels = self.summary["by_publisher"]
        key = "rtb - radiodiffusion télévision du burkina"
        self.assertIn(key, channels)
        # Both spellings of the channel land in one slice…
        self.assertEqual(channels[key]["total"], 2)
        # …and the slice keeps a raw form to display.
        self.assertEqual(
            channels[key]["label"],
            "RTB - Radiodiffusion Télévision du Burkina",
        )
        # A row with no publisher belongs to no channel, so the slices
        # sum to less than the subset rather than inventing a bucket.
        self.assertLess(
            sum(slice_["total"] for slice_ in channels.values()),
            self.summary["total"],
        )

    def test_each_publisher_slice_names_its_population(self) -> None:
        channels = self.summary["by_publisher"]
        self.assertEqual(channels["l'autregard"]["source_type"], "youtube")
        self.assertEqual(channels["daarul hadeethis salafiyyah"]["source_type"], "deposited")

    def test_medium_is_not_a_facet(self) -> None:
        # DVD / CD / "Vidéo sur le web" name the carrier, not the source.
        self.assertNotIn("by_medium", self.summary)

    def test_runtime_falls_back_from_seconds_to_iso_extent(self) -> None:
        duration = self.summary["duration"]
        self.assertEqual(duration["count"], self.summary["total"])
        # Row 3 has duration_seconds == 0 and only `extent: PT10M`.
        self.assertEqual(duration["total_seconds"], 154 + 200 + 600 + 34260 + 60)
        self.assertEqual(duration["median_seconds"], 200)

    def test_cards_carry_what_the_strip_renders(self) -> None:
        card = next(c for c in self.summary["top_items"] if c["o_id"] == 1)
        self.assertEqual(card["publisher"], "RTB - Radiodiffusion Télévision du Burkina")
        self.assertEqual(card["duration"], 154)
        self.assertEqual(card["country"], "Burkina Faso")
        # `type` is an i18n token, not the French free text, or an English
        # page prints "Enregistrement vidéo" on every card.
        self.assertEqual(card["type"], "audiovisual")
        # The watch target rides along for any consumer that wants it…
        self.assertEqual(card["url"], "https://www.youtube.com/watch?v=a")
        # …while fields nothing reads stay off the card — 30 of these
        # ship per slice, times a slice per channel.
        for absent in ("medium", "extent", "source_type", "URL"):
            self.assertNotIn(absent, card)
        # dcterms:source is only present where the record actually has one.
        deposited = next(c for c in self.summary["top_items"] if c["o_id"] == 4)
        self.assertEqual(deposited["source"], "Zaria archive")
        self.assertNotIn("source", card)

    def test_older_snapshots_degrade_to_whole_subset(self) -> None:
        # A bundle generated before the mapper added source_type/publisher
        # must still produce the whole-subset context the block falls
        # back to, rather than raising or emitting empty facets.
        legacy = _audiovisual_frame().drop(
            columns=["source_type", "publisher", "URL", "duration_seconds"]
        )
        summary = generate_template_summary.build_subset_summary("audiovisual", legacy)
        self.assertEqual(summary["total"], 5)
        self.assertNotIn("by_source_type", summary)
        self.assertNotIn("by_publisher", summary)
        # `extent` alone still yields runtime figures.
        self.assertEqual(summary["duration"]["count"], 5)


class CollectionOverviewAudiovisualTests(unittest.TestCase):
    """The `audiovisual_minutes` KPI on the homepage hero."""

    def test_prefers_explicit_seconds_and_backfills_from_extent(self) -> None:
        df = _audiovisual_frame()
        expected = (154 + 200 + 600 + 34260 + 60) / 60.0
        self.assertAlmostEqual(
            generate_collection_overview._audiovisual_duration_minutes(df),
            expected,
            places=4,
        )

    def test_iso_extent_alone_gives_the_same_answer(self) -> None:
        df = _audiovisual_frame()
        self.assertAlmostEqual(
            generate_collection_overview._audiovisual_duration_minutes(
                df.drop(columns=["duration_seconds"])
            ),
            generate_collection_overview._audiovisual_duration_minutes(df),
            places=4,
        )

    def test_empty_and_missing_frames_are_zero(self) -> None:
        self.assertEqual(generate_collection_overview._audiovisual_duration_minutes(None), 0.0)
        self.assertEqual(
            generate_collection_overview._audiovisual_duration_minutes(pd.DataFrame()), 0.0
        )


if __name__ == "__main__":
    unittest.main()


class SharedHelperTests(unittest.TestCase):
    """The helpers v1.63.0 hoisted out of the generators that each carried a copy."""

    def test_clean_known_str_blanks_the_placeholders_clean_str_keeps(self) -> None:
        self.assertEqual(iwac_utils.clean_str(" Unknown "), "Unknown")
        self.assertEqual(iwac_utils.clean_known_str(" Unknown "), "")
        self.assertEqual(iwac_utils.clean_known_str(np.nan), "")
        self.assertEqual(iwac_utils.clean_known_str(" Bénin "), "Bénin")

    def test_clean_values_drops_empty_and_unknown_segments(self) -> None:
        self.assertEqual(iwac_utils.clean_values([" Bénin ", "", "n/a", "Togo", None]), ["Bénin", "Togo"])
        self.assertEqual(iwac_utils.clean_values(None), [])

    def test_top_n_pipe_counts_every_value_of_every_row(self) -> None:
        rows = pd.DataFrame({"country": ["Bénin|Togo", "Togo", "Unknown|Togo", np.nan, "Bénin"]})
        self.assertEqual(
            iwac_utils.top_n_pipe(rows, "country"),
            [{"name": "Togo", "count": 3}, {"name": "Bénin", "count": 2}],
        )
        self.assertEqual(iwac_utils.top_n_pipe(rows, "country", 1), [{"name": "Togo", "count": 3}])
        self.assertEqual(iwac_utils.top_n_pipe(rows, "missing"), [])

    def test_timeline_series_orders_the_stack_three_ways(self) -> None:
        pairs = [(1961, "Togo"), (1960, "Bénin"), (1961, "Bénin"), (1960, "Niger"), (1962, "Togo")]
        by_count = iwac_stats.build_timeline_series(pairs, order="count", totals=True)
        self.assertEqual(by_count["years"], [1960, 1961, 1962])
        # Bénin and Togo tie on two items: alphabetical breaks it.
        self.assertEqual(by_count["countries"], ["Bénin", "Togo", "Niger"])
        self.assertEqual(by_count["series"]["Togo"], [0, 1, 1])
        self.assertEqual(by_count["totals"], [2, 2, 1])
        self.assertEqual(
            iwac_stats.build_timeline_series(pairs, order="alpha")["countries"],
            ["Bénin", "Niger", "Togo"],
        )
        # most_common keeps the first-seen order among ties: Togo before Bénin.
        self.assertEqual(
            iwac_stats.build_timeline_series(pairs, order="most_common")["countries"],
            ["Togo", "Bénin", "Niger"],
        )
        explicit = iwac_stats.build_timeline_series(pairs, order=["Niger", "Mali", "Togo"])
        self.assertEqual(explicit["countries"], ["Niger", "Togo"])
        self.assertNotIn("totals", explicit)

    def test_timeline_series_empty_result_keeps_the_shape(self) -> None:
        self.assertEqual(iwac_stats.build_timeline_series([]), {"years": [], "countries": [], "series": {}})
        self.assertEqual(
            iwac_stats.build_timeline_series([], totals=True),
            {"years": [], "countries": [], "series": {}, "totals": []},
        )

    def test_entity_index_skips_placeholders_and_indexes_aliases_and_places(self) -> None:
        df = pd.DataFrame({
            "o:id": [1, 2, 3, "x", 5],
            "Titre": ["Abdoulaye Wade", "Cotonou", "Placeholder", "No id", ""],
            "Type": ["Personnes", "Lieux", iwac_utils.AUTHORITY_PLACEHOLDER_TYPE, "Personnes", "Sujets"],
            "Titre alternatif": ["Wade, Abdoulaye|A. Wade", None, None, None, None],
            "Coordonnées": [None, "6.37, 2.39", None, None, None],
        })
        seen = []
        lookup, by_id, lieux = iwac_utils.build_entity_index(df, on_entity=lambda info: seen.append(info["o_id"]))
        self.assertEqual(sorted(by_id), [1, 2])
        self.assertEqual(seen, [1, 2])
        self.assertIs(lookup[iwac_utils.normalize_location_name("A. Wade")], by_id[1])
        self.assertIs(lookup[iwac_utils.normalize_location_name("Cotonou")], by_id[2])
        self.assertEqual(lieux, {2: (6.37, 2.39)})
        self.assertNotIn("row", by_id[1])
        with_rows = iwac_utils.build_entity_index(df, keep_row=True)[1]
        self.assertEqual(with_rows[1]["row"]["Titre"], "Abdoulaye Wade")

    def test_entity_index_names_the_missing_columns(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "index subset missing required columns"):
            iwac_utils.build_entity_index(pd.DataFrame({"o:id": [1]}))
