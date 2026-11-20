"""The corpus-health sentiment meters follow config/sentiment-models.json.

The generator used to carry its own six (id, label) pairs, so a model
retired from the registry raised ``KeyError`` in CI and a new one was left
out of the panel without a word. These tests rotate the registry under the
generator and check the panel follows it.
"""
from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import generate_corpus_health as health  # noqa: E402
import iwac_utils  # noqa: E402

REGISTRY = json.loads((ROOT / "config/sentiment-models.json").read_text(encoding="utf-8"))


class SentimentRegistryTests(unittest.TestCase):
    def test_names_cover_exactly_the_active_models(self) -> None:
        self.assertEqual(tuple(iwac_utils.SENTIMENT_MODEL_NAMES), iwac_utils.SENTIMENT_MODELS)
        self.assertEqual(iwac_utils.SENTIMENT_MODEL_NAMES,
                         {m["id"]: m["name"] for m in REGISTRY["active"]})

    def test_generator_lists_no_model_by_hand(self) -> None:
        source = (ROOT / "scripts/generate_corpus_health.py").read_text(encoding="utf-8")
        ids = set(iwac_utils.SENTIMENT_MODELS) | set(REGISTRY["labels"])
        found = sorted(i for i in ids if re.search(rf"\b{re.escape(i)}\b", source))
        self.assertEqual(found, [], "model ids belong in config/sentiment-models.json")

    def test_meters_follow_a_rotated_registry(self) -> None:
        # The snapshot still carries a retired model's column and already
        # carries a new one; the registry has swapped one for the other.
        df = pd.DataFrame({
            "retired_model_polarite": ["Positif", "Neutre", ""],
            "new_model_polarite": ["Positif", "", None],
        })
        with patch.object(health, "SENTIMENT_MODELS", ("new_model", "unpushed_model")), \
                patch.object(health, "SENTIMENT_MODEL_NAMES",
                             {"new_model": "New Model 1", "unpushed_model": "Unpushed"}):
            metrics = health.sentiment_metrics(df, len(df))
        self.assertEqual(metrics, [{"label": "Sentiment — New Model 1", "covered": 1, "total": 3}])

    def test_live_registry_labels(self) -> None:
        df = pd.DataFrame({f"{m}_polarite": ["Positif"] for m in iwac_utils.SENTIMENT_MODELS})
        labels = [m["label"] for m in health.sentiment_metrics(df, 1)]
        self.assertEqual(labels, [f"Sentiment — {m['name']}" for m in REGISTRY["active"]])


if __name__ == "__main__":
    unittest.main()
