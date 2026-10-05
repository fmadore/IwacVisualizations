"""Reader for the committed relevance-screen ledger.

``audit_ledger.json`` is written by ``scripts/audit_laicite.py`` and holds one
verdict per dossier member (and per judged occurrence) from the model-assisted
screen. This module only *reads* it, and only ever to aggregate: the ledger is
a screen, not human validation, and nothing here may promote it into one.

The loader is deliberately forgiving. The ledger is an optional sidecar — a
checkout without it, a test that never writes one, or a hand-truncated file
must all leave the generator producing its bundles, with an empty aggregate
rather than an exception.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

LEDGER_PATH = Path(__file__).with_name("audit_ledger.json")

EMPTY_LEDGER: Dict[str, Any] = {"rules": {}, "members": {}, "occurrences": {}}


def empty_ledger() -> Dict[str, Any]:
    """A fresh empty ledger. Each call builds new section dicts: a shallow
    copy of ``EMPTY_LEDGER`` would hand every caller the SAME nested dicts,
    so one merge writing into an empty load would write into the next."""
    return {key: {} for key in EMPTY_LEDGER}


def load_ledger(path: Path = LEDGER_PATH) -> Dict[str, Any]:
    """The ledger, or an empty one when it is absent or unreadable."""
    try:
        with Path(path).open(encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError):
        return empty_ledger()
    if not isinstance(raw, dict):
        return empty_ledger()
    return {
        key: (raw.get(key) if isinstance(raw.get(key), dict) else {})
        for key in EMPTY_LEDGER
    }
