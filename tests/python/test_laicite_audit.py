"""The incremental screen: fingerprints must be stable across the two ways
they are computed, and the ledger must never carry source text."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import audit_laicite as A  # noqa: E402


class LaiciteAuditTests(unittest.TestCase):
    def test_occurrence_fingerprint_matches_window_recomputation(self):
        text = "Le préfet a rappelé la laïcité de l'État. Les militants parlent de " \
               "leur divorce avec le PDCI, consommé depuis longtemps, et de rien d'autre."
        start = text.index("divorce"); end = start + len("divorce")
        direct = A.occurrence_fingerprint("articles", "1", "droit-famille", "OCR",
                                          text, start, end)
        window = A.clip(text, start, end, A.WINDOW)
        self.assertEqual(direct, A.fingerprint_from_window(
            "articles", "1", "droit-famille", "OCR", window))

    def test_fingerprint_survives_offset_shift_but_not_passage_change(self):
        base = ("Dans la commune, le tribunal de première instance a tranché hier : "
                "le divorce est prononcé par le juge selon le code de la famille.")
        start = base.index("divorce"); end = start + 7
        a = A.occurrence_fingerprint("articles", "1", "droit-famille", "OCR", base, start, end)
        prefix = "PREAMBULE. " * 8   # further away than the ±60-char fingerprint window
        shifted = prefix + base
        b = A.occurrence_fingerprint("articles", "1", "droit-famille", "OCR",
                                     shifted, start + len(prefix), end + len(prefix))
        self.assertEqual(a, b)
        changed = base.replace("juge", "cadi")
        c = A.occurrence_fingerprint("articles", "1", "droit-famille", "OCR", changed, start, end)
        self.assertNotEqual(a, c)

    def test_hits_fingerprint_folds_case_and_accents(self):
        self.assertEqual(A.hits_fingerprint(["Laïcité", "laïque"]),
                         A.hits_fingerprint(["laicite", "LAIQUE"]))

    def test_ledger_carries_no_source_text(self):
        if not A.LEDGER_PATH.exists():
            self.skipTest("no ledger in this checkout")
        ledger = json.loads(A.LEDGER_PATH.read_text(encoding="utf-8"))
        allowed_member = {"subset", "id", "route", "relevant", "sense", "hits_fp",
                          "judged_at", "model", "rule"}
        allowed_occ = {"subset", "id", "frame", "form", "field", "near_core_hit",
                       "sense_ok", "religion_state", "judged_at", "model", "rule"}
        for m in ledger["members"].values():
            self.assertTrue(set(m) <= allowed_member, m)
            self.assertIn(m["relevant"], ("yes", "no", "unassessable"))
        for o in ledger["occurrences"].values():
            self.assertTrue(set(o) <= allowed_occ, o)
            self.assertLess(len(o["form"]), 60)
        for h in ledger["rules"]:
            self.assertEqual(len(h), 10)

    def test_rule_hash_tracks_instruction_text(self):
        for tier in (1, 2):
            self.assertEqual(len(A.rule_hash(tier)), 10)
            self.assertTrue((A.RULES_DIR / A.RULE_FILES[tier]).exists())


if __name__ == "__main__":
    unittest.main()
