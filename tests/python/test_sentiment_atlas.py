"""The Sentiment Atlas's model-comparison statistics and its generator.

The agreement measures are ports of the sibling IWAC-sentiment-analysis
dashboard's browser code (agreement.ts, consensus.ts, stats.ts); the cases
below pin them to published worked examples, so a "simplification" that
changes a definition fails here rather than shifting every figure in the
atlas by a few hundredths.

The generator runs end to end over a seeded synthetic corpus
(`synthetic_frames`), the same one that produced the browser fixture
`tests/browser/fixtures/data/sentiment-atlas-v4.json`, and the tests assert
the invariants between its sections: every count agrees with the counts it
was derived from.
"""
from __future__ import annotations

import math
import random
import sys
import unittest
from pathlib import Path
from typing import Dict, Tuple
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import generate_collection_overview  # noqa: E402
import generate_sentiment_atlas as atlas  # noqa: E402
import iwac_stats  # noqa: E402
import iwac_utils  # noqa: E402


# --------------------------------------------------------------------------
#  A seeded synthetic corpus
# --------------------------------------------------------------------------

#: Three raters, one of them (the second) systematically more positive and
#: more central, the way Mistral Small 4 reads the real corpus.
FIXTURE_MODELS = ("gpt_5_6_luna", "mistral_small_2603", "deepseek_v4_flash_0731")

_POLARITY_BY_INDEX = {-2: "Très négatif", -1: "Négatif", 0: "Neutre", 1: "Positif", 2: "Très positif"}
_CENTRALITY_BY_SCORE = {1: "Non abordé", 2: "Marginal", 3: "Secondaire", 4: "Central", 5: "Très central"}
_SUBJECTIVITY_BY_SCORE = {v: k for k, v in iwac_utils.SUBJECTIVITE_LABELS.items()}

_PAPERS = (
    ("Sidwaya", "Burkina Faso"), ("L'Observateur Paalga", "Burkina Faso"),
    ("Fraternité Matin", "Côte d'Ivoire"), ("La Nation", "Bénin"),
    ("Togo-Presse", "Togo"), ("Le Sahel", "Niger"),
)
_PLACES = (
    (101, "Ouagadougou", "12.37, -1.53"), (102, "Abidjan", "5.35, -4.0"),
    (103, "Cotonou", "6.37, 2.39"), (104, "Lomé", "6.13, 1.22"),
    (105, "Niamey", "13.51, 2.11"), (106, "La Mecque", "21.42, 39.83"),
)


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def synthetic_frames(n: int = 600, seed: int = 7) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """(articles, index) frames with the HF schema the generator reads.

    Each article has a latent tone, centrality and subjectivity; each model
    reads them with its own noise and bias. A few cells carry the corpus's
    real irregularities: "Non applicable" polarity, a declined subjectivité
    (""), and one model that skipped a handful of articles outright.
    """
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        paper, country = _PAPERS[rng.randrange(len(_PAPERS))]
        year = 1995 + rng.randrange(30)
        tone = rng.choice((-2, -1, 0, 0, 1, 1, 1, 2))
        central = rng.choice((1, 2, 3, 4, 4, 5, 5))
        subj = rng.choice((1, 2, 2, 2, 3, 4, 5))
        places = rng.sample(_PLACES, rng.randrange(0, 3))
        row = {
            "o:id": str(10000 + i),
            "pub_date": f"{year}-{1 + rng.randrange(12):02d}-{1 + rng.randrange(28):02d}",
            "country": country,
            "newspaper": paper,
            "subject": "|".join(rng.sample(("Ramadan", "Hadj", "Laïcité", "Imamat", "Politique"), 2)),
            "spatial": "|".join(p[1] for p in places),
            "lda_topic_id": rng.randrange(4),
            "lda_topic_label": "",
        }
        for m_idx, model in enumerate(FIXTURE_MODELS):
            skipped = m_idx == 2 and i % 97 == 0
            bias = 1 if m_idx == 1 and rng.random() < 0.3 else 0
            noise = rng.choice((-1, 0, 0, 0, 1))
            if skipped:
                pol = cen = sub = ""
            else:
                pol = ("Non applicable" if rng.random() < 0.04
                       else _POLARITY_BY_INDEX[_clamp(tone + noise + bias, -2, 2)])
                cen = _CENTRALITY_BY_SCORE[_clamp(central + rng.choice((-1, 0, 0, 1)) + bias, 1, 5)]
                sub = ("" if rng.random() < 0.03
                       else _SUBJECTIVITY_BY_SCORE[_clamp(subj + rng.choice((-1, 0, 1)), 1, 5)])
            row[f"{model}_polarite"] = pol
            row[f"{model}_centralite_islam_musulmans"] = cen
            row[f"{model}_subjectivite_score"] = sub
        rows.append(row)
    index = pd.DataFrame({
        "o:id": [p[0] for p in _PLACES],
        "Titre": [p[1] for p in _PLACES],
        "Type": ["Lieux"] * len(_PLACES),
        "Titre alternatif": [None] * len(_PLACES),
        "Coordonnées": [p[2] for p in _PLACES],
    })
    return pd.DataFrame(rows), index


def build_fixture(n: int = 600, seed: int = 7) -> Tuple[Dict, Dict]:
    """Run the real generator over the synthetic corpus."""
    articles, index = synthetic_frames(n, seed)

    def fake_load(subset, repo_id=None, token=None, **_):
        return (articles if subset == "articles" else index).copy()

    with patch.object(atlas, "load_dataset_safe", side_effect=fake_load), \
            patch.object(atlas, "MODELS", FIXTURE_MODELS):
        return atlas.build_sentiment_atlas("fixture", None)


# --------------------------------------------------------------------------
#  The statistics
# --------------------------------------------------------------------------

class AgreementStatisticsTests(unittest.TestCase):
    def test_cohens_kappa_matches_the_textbook_two_by_two(self) -> None:
        # po = 0.7; pe = (25·30 + 25·20) / 50² = 0.5; kappa = 0.4.
        self.assertAlmostEqual(iwac_stats.kappa_from_matrix([[20, 5], [10, 15]]), 0.4)
        # With two categories every disagreement is maximal, so the
        # quadratic weights change nothing.
        self.assertAlmostEqual(
            iwac_stats.kappa_from_matrix([[20, 5], [10, 15]], "quadratic"), 0.4)

    def test_weighted_kappa_credits_a_near_miss(self) -> None:
        # Every disagreement is one step: the weighted kappa should see
        # more agreement than the all-or-nothing one does.
        adjacent = [[10, 5, 0], [5, 10, 5], [0, 5, 10]]
        self.assertGreater(iwac_stats.kappa_from_matrix(adjacent, "quadratic"),
                           iwac_stats.kappa_from_matrix(adjacent))

    def test_kappa_is_undefined_not_zero_when_chance_explains_everything(self) -> None:
        self.assertIsNone(iwac_stats.kappa_from_matrix([[9, 0], [0, 0]]))
        self.assertIsNone(iwac_stats.kappa_from_matrix([[0, 0], [0, 0]]))

    def test_fleiss_kappa_reproduces_the_published_example(self) -> None:
        # Fleiss (1971) as worked in most references: 10 items, 14 raters,
        # 5 categories, kappa = 0.210.
        items = [
            [0, 0, 0, 0, 14], [0, 2, 6, 4, 2], [0, 0, 3, 5, 6], [0, 3, 9, 2, 0],
            [2, 2, 8, 1, 1], [7, 7, 0, 0, 0], [3, 2, 6, 3, 0], [2, 5, 3, 2, 2],
            [6, 5, 2, 1, 0], [0, 2, 2, 3, 7],
        ]
        out = iwac_stats.fleiss_kappa(items)
        self.assertEqual(out["n"], 10)
        self.assertAlmostEqual(out["kappa"], 0.20993, places=4)
        self.assertAlmostEqual(out["unanimous"], 0.1)

    def test_fleiss_drops_items_with_a_different_rater_count(self) -> None:
        out = iwac_stats.fleiss_kappa([[3, 0], [0, 3], [2, 0]])
        self.assertEqual(out["n"], 2)

    def test_matrix_agreement_counts_the_diagonal_bands(self) -> None:
        out = iwac_stats.matrix_agreement([[5, 1, 1], [0, 5, 0], [2, 0, 5]])
        self.assertEqual(out["n"], 19)
        self.assertAlmostEqual(out["exact"], 15 / 19)
        self.assertAlmostEqual(out["within_one"], 16 / 19)

    def test_dissent_names_a_lone_dissenter_only(self) -> None:
        self.assertEqual(iwac_stats.classify_dissent([3, 3, 3])["kind"], "unanimous")
        up = iwac_stats.classify_dissent([3, 3, 5])
        self.assertEqual((up["kind"], up["dissenter"], up["direction"], up["spread"]),
                         ("majority", 2, 1, 2))
        down = iwac_stats.classify_dissent([1, 3, 3, 3, 3])
        self.assertEqual((down["dissenter"], down["direction"]), (0, -1))
        # 3–2 and all-different have no lone dissenter.
        self.assertEqual(iwac_stats.classify_dissent([1, 1, 3, 3, 3])["kind"], "split")
        self.assertEqual(iwac_stats.classify_dissent([1, 2, 3])["kind"], "split")

    def test_mean_interval_uses_the_sample_deviation(self) -> None:
        # 1, 2, 3, 4: mean 2.5, s² = 5/3.
        out = iwac_stats.mean_interval(10, 30, 4)
        self.assertAlmostEqual(out["mean"], 2.5)
        self.assertAlmostEqual(out["half"], 1.96 * math.sqrt(5 / 3) / 2)
        self.assertEqual(iwac_stats.mean_interval(3, 9, 1)["half"], 0.0)
        self.assertIsNone(iwac_stats.mean_interval(0, 0, 0)["mean"])


# --------------------------------------------------------------------------
#  The generator, end to end
# --------------------------------------------------------------------------

class SentimentAtlasGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload, cls.places = build_fixture()

    def test_every_model_in_the_frame_is_published(self) -> None:
        self.assertEqual(list(self.payload["models"]), list(FIXTURE_MODELS))
        self.assertEqual(self.payload["places_file"], atlas.PLACES_FILE)

    def test_distribution_sums_to_each_models_rated_count(self) -> None:
        for model, block in self.payload["models"].items():
            with self.subTest(model=model):
                self.assertEqual(sum(block["distribution"]["polarity"]), block["rated"])
                self.assertEqual(len(block["distribution"]["centrality"]), 5)

    def test_reliability_matches_the_legacy_agreement_block(self) -> None:
        legacy = {tuple(e["models"]): e for e in self.payload["agreement"]}
        for pair in self.payload["reliability"]["polarity"]["pairs"]:
            entry = legacy[tuple(pair["models"])]
            self.assertEqual(pair["n"], entry["co_rated"])
            self.assertEqual(pair["exact"], entry["agreement_pct"])
            self.assertEqual(pair["matrix"], entry["matrix"])

    def test_polarity_scale_statistics_leave_not_applicable_out(self) -> None:
        for pair in self.payload["reliability"]["polarity"]["pairs"]:
            graded = sum(sum(row[:5]) for row in pair["matrix"][:5])
            self.assertEqual(pair["n_ordinal"], graded)
            self.assertLess(pair["n_ordinal"], pair["n"])
        for pair in self.payload["reliability"]["centrality"]["pairs"]:
            self.assertEqual(pair["n_ordinal"], pair["n"])

    def test_the_biased_rater_agrees_least(self) -> None:
        pairs = self.payload["reliability"]["centrality"]["pairs"]
        lowest = min(pairs, key=lambda p: p["weighted_kappa"])
        self.assertIn("mistral_small_2603", lowest["models"])

    def test_consensus_counts_partition_the_complete_cases(self) -> None:
        for dim, block in self.payload["consensus"].items():
            with self.subTest(dim=dim):
                lone = sum(d["up"] + d["down"] for d in block["dissent"].values())
                self.assertEqual(block["unanimous"] + block["split"] + lone, block["n"])
                # The skipped articles are not complete cases.
                self.assertLess(block["n"], 600)
        dissent = self.payload["consensus"]["centrality"]["dissent"]["mistral_small_2603"]
        self.assertGreater(dissent["up"], dissent["down"])

    def test_the_common_cohort_never_exceeds_any_models_own(self) -> None:
        trends = self.payload["trends"]
        self.assertEqual(trends["min_count"], atlas.TREND_MIN_COUNT)
        for target in trends["targets"]:
            common = trends["common"][target]
            for model in FIXTURE_MODELS:
                own = trends["available"][target]["n"][model]
                for i, n in enumerate(common["n"]):
                    self.assertLessEqual(n, own[i])
                    self.assertLessEqual(common["k"][model][i], n)

    def test_ranking_rows_clear_the_threshold_and_stay_on_scale(self) -> None:
        ranking = self.payload["ranking"]
        self.assertEqual(ranking["min"], atlas.RANKING_MIN_ARTICLES)
        for model, by_dim in ranking["models"].items():
            for dim, rows in by_dim.items():
                lo, hi = (-2, 2) if dim == "polarity" else (1, 5)
                for idx, n, mean, half in rows:
                    self.assertGreaterEqual(n, atlas.RANKING_MIN_ARTICLES)
                    self.assertTrue(lo <= mean <= hi, (model, dim, mean))
                    self.assertGreater(half, 0)
                    self.assertLess(idx, len(ranking["newspapers"]))

    def test_places_count_mentions_and_average_on_the_ranking_scales(self) -> None:
        places = self.places["places"]
        self.assertTrue(places)
        self.assertEqual(self.places["min_rated"], atlas.PLACE_MIN_RATED)
        counts = [p["n"] for p in places]
        self.assertEqual(counts, sorted(counts, reverse=True))
        for model in FIXTURE_MODELS:
            block = self.places["models"][model]["polarity"]
            self.assertEqual(len(block["n"]), len(places))
            for n, mean, place in zip(block["n"], block["mean"], places):
                self.assertLessEqual(n, place["n"])
                if n:
                    self.assertTrue(-2 <= mean <= 2)
                else:
                    self.assertIsNone(mean)


class NewspaperVolumeTests(unittest.TestCase):
    def test_coverage_rows_carry_their_items_per_year(self) -> None:
        frames = {
            "articles": pd.DataFrame({
                "newspaper": ["Sidwaya", "Sidwaya", "Sidwaya", "La Nation"],
                "pub_date": ["1999-01-01", "1999-05-01", "2003", "nope"],
                "country": ["Burkina Faso"] * 3 + ["Bénin"],
            }),
        }
        out = generate_collection_overview.compute_newspaper_coverage(frames, 1900, 2100)
        rows = {(e["name"], e["type"]): e for e in out["coverage"]}
        self.assertEqual(rows[("Sidwaya", "article")]["by_year"], [[1999, 2], [2003, 1]])
        self.assertEqual(rows[("Sidwaya", "article")]["total"], 3)
        # An undated title has no span to draw at all.
        self.assertNotIn(("La Nation", "article"), rows)


if __name__ == "__main__":
    unittest.main()
