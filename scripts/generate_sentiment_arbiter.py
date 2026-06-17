#!/usr/bin/env python3
"""
generate_sentiment_arbiter.py
=============================

Aggregate the *arbiter* evaluations from the sibling
``IWAC-sentiment-analysis`` study into a compact
``asset/data/sentiment-arbiter.json`` for the Sentiment Atlas block.

The arbiter is **Gemini 3 Pro** (``gemini-3-pro-preview``, high reasoning)
acting as an independent judge. For every pair of the three rating models
(gemini = Gemini 3 Flash, chatgpt = GPT-5 mini, mistral = Ministral 14B),
the sibling project took the articles where the two models *disagreed
sharply* (≥ 3 points on at least one dimension) and asked the arbiter,
blind to which model was which, to decide whose reading of the polarité,
subjectivité and centralité was more accurate.

Those per-article verdicts are an LLM artefact that lives **only** in the
sibling repo — they cannot be regenerated from the public Hugging Face
dataset without re-running paid Gemini API calls. So this script does not
touch HF: it reads the three ``iwac_arbiter_evaluations_<pair>.json`` files
the sibling already produced and reduces them to per-pair *counts* (no
per-article text), small enough to drop into the page block.

The arbiter files use blind labels ``model_a`` / ``model_b`` whose real
identity is randomised per pair and recorded in each file's metadata
(``arbiter_model_a`` / ``arbiter_model_b``). We map those back to the
canonical model ids (gemini / chatgpt / mistral) so the block JS can label
verdicts with the same display names it uses everywhere else.

Payload shape:

    metadata     — provenance block (+ arbiter_model, pairs found)
    arbiter_model — the judge model id (e.g. gemini-3-pro-preview)
    pairs        — list, one entry per evaluated model pair:
        pair         — "<id>-<id>" as named by the sibling study
        model_a      — model id the arbiter saw as "Model A"
        model_b      — model id the arbiter saw as "Model B"
        n            — number of sharply-disagreeing articles judged
        overall      — {model_a, model_b, both, neither} verdict counts
        by_dimension — {polarity|subjectivity|centrality:
                        {model_a, model_b, both, neither}}
        confidence   — {high, medium, low} counts

Usage
-----
    python scripts/generate_sentiment_arbiter.py
    python scripts/generate_sentiment_arbiter.py --sentiment-repo ../IWAC-sentiment-analysis/ma-visualisation-sentiments/static/data
    python scripts/generate_sentiment_arbiter.py --no-minify -v
"""
from __future__ import annotations

import argparse
import json
import logging
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

from iwac_utils import (
    configure_logging,
    create_metadata_block,
    save_json,
)

# The three model pairs the sibling study evaluates, in a stable order.
PAIRS: List[str] = ["chatgpt-gemini", "chatgpt-mistral", "gemini-mistral"]

# Default location of the sibling study's generated data, relative to the
# module root (both repos live side by side under the same parent).
DEFAULT_SENTIMENT_REPO = (
    "../IWAC-sentiment-analysis/ma-visualisation-sentiments/static/data"
)

# The arbiter files store full display names; map them back to the model
# ids the rest of the module keys on. Tolerant of case / spacing drift.
_NAME_TO_ID = {
    "chatgpt": "chatgpt",
    "gemini": "gemini",
    "mistral": "mistral",
}

VERDICT_KEYS = ("model_a", "model_b", "both", "neither")
DIMENSIONS = ("polarity", "subjectivity", "centrality")
CONFIDENCE_KEYS = ("high", "medium", "low")


def _model_id(name: Any) -> Optional[str]:
    """Map an arbiter display name ('ChatGPT') to a model id ('chatgpt')."""
    if not name:
        return None
    return _NAME_TO_ID.get(str(name).strip().lower())


def _fixed(counter: Counter, keys) -> Dict[str, int]:
    """Project a Counter onto a fixed key set (missing keys → 0)."""
    return {k: int(counter.get(k, 0)) for k in keys}


def build_pair(path: Path) -> Optional[Dict[str, Any]]:
    """Reduce one ``iwac_arbiter_evaluations_<pair>.json`` to counts."""
    logger = logging.getLogger(__name__)
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("  could not read %s (%s) — skipping", path.name, exc)
        return None

    meta = data.get("metadata", {}) or {}
    evals = data.get("evaluations", []) or []
    if not evals:
        logger.warning("  %s has no evaluations — skipping", path.name)
        return None

    model_a = _model_id(meta.get("arbiter_model_a"))
    model_b = _model_id(meta.get("arbiter_model_b"))
    if model_a is None or model_b is None:
        logger.warning(
            "  %s: unrecognized model names %r / %r — skipping",
            path.name, meta.get("arbiter_model_a"), meta.get("arbiter_model_b"),
        )
        return None

    overall: Counter = Counter()
    by_dim: Dict[str, Counter] = {d: Counter() for d in DIMENSIONS}
    confidence: Counter = Counter()

    for ev in evals:
        arb = ev.get("arbiter", {}) or {}
        winner = arb.get("overall_winner")
        if winner in VERDICT_KEYS:
            overall[winner] += 1
        conf = arb.get("confidence_level")
        if conf in CONFIDENCE_KEYS:
            confidence[conf] += 1
        for dim in DIMENSIONS:
            pref = (arb.get(dim, {}) or {}).get("preferred_model")
            if pref in VERDICT_KEYS:
                by_dim[dim][pref] += 1

    return {
        "pair": meta.get("pair") or path.stem.replace("iwac_arbiter_evaluations_", ""),
        "model_a": model_a,
        "model_b": model_b,
        "n": int(len(evals)),
        "overall": _fixed(overall, VERDICT_KEYS),
        "by_dimension": {d: _fixed(by_dim[d], VERDICT_KEYS) for d in DIMENSIONS},
        "confidence": _fixed(confidence, CONFIDENCE_KEYS),
    }


def build_arbiter(repo_dir: Path) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Reading arbiter evaluations from %s", repo_dir)

    pairs_payload: List[Dict[str, Any]] = []
    arbiter_model: Optional[str] = None
    for pair in PAIRS:
        path = repo_dir / f"iwac_arbiter_evaluations_{pair}.json"
        if not path.exists():
            logger.warning("  %s not found — skipping", path.name)
            continue
        entry = build_pair(path)
        if entry is None:
            continue
        # Capture the judge model id once (same across pairs).
        if arbiter_model is None:
            try:
                with path.open("r", encoding="utf-8") as f:
                    arbiter_model = (json.load(f).get("metadata", {}) or {}).get("arbiter_model")
            except (OSError, json.JSONDecodeError):
                pass
        pairs_payload.append(entry)
        logger.info(
            "  %s: %d judged (A=%s, B=%s)",
            entry["pair"], entry["n"], entry["model_a"], entry["model_b"],
        )

    if not pairs_payload:
        raise RuntimeError(
            f"No arbiter evaluation files found under {repo_dir} — "
            "check --sentiment-repo points at the sibling study's static/data."
        )

    total = sum(p["n"] for p in pairs_payload)
    metadata = create_metadata_block(
        total_records=total,
        data_source="IWAC-sentiment-analysis (arbiter evaluations)",
        script="generate_sentiment_arbiter.py",
        script_version="0.1.0",
        arbiter_model=arbiter_model,
        pairs=len(pairs_payload),
    )

    return {
        "metadata": metadata,
        "arbiter_model": arbiter_model,
        "pairs": pairs_payload,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sentiment-repo",
        default=DEFAULT_SENTIMENT_REPO,
        help="Path to the sibling study's static/data dir (default: %(default)s)",
    )
    parser.add_argument(
        "--output",
        default="asset/data/sentiment-arbiter.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Minify the JSON output (default: %(default)s)",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    configure_logging(level=logging.DEBUG if args.verbose else logging.INFO)

    payload = build_arbiter(Path(args.sentiment_repo))

    output_path = Path(args.output)
    save_json(payload, output_path, minify=args.minify)
    logging.getLogger(__name__).info("Wrote %s", output_path)


if __name__ == "__main__":
    main()
