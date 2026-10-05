"""The incremental screen: fingerprints must be stable, a merge must never pair
a verdict with the wrong row, and the ledger must never carry source text."""
import argparse
import hashlib
import json
import re
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import audit_laicite as A  # noqa: E402
from laicite.audit_ledger import load_ledger  # noqa: E402
from laicite.generator import LaiciteGenerator  # noqa: E402
from laicite.lexicon import fold_plain  # noqa: E402
from laicite.scan import SUBSET_FIELDS  # noqa: E402

RUN = "20261005T000000Z-abcdef"


class LaiciteAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.g = LaiciteGenerator(Path(self.tmp.name) / "out")
        guard = patch("laicite.scan.load_dataset_safe",
                      side_effect=AssertionError("tests must not load the dataset"))
        guard.start()
        self.addCleanup(guard.stop)
        self.opts = A.ExtractOptions(core=set(self.g.lex.membership_frames), run=RUN)

    def member(self, o_id="1", subset="articles", **fields):
        row = {"o:id": o_id, "title": "", "OCR": "", "subject": "",
               "OCR_is_public": True, **fields}
        rec = self.g._scan_row(row, subset, SUBSET_FIELDS[subset], "laicite").rec
        self.assertIsNotNone(rec)
        return rec

    # -- fingerprints ------------------------------------------------------

    def test_fingerprint_is_cut_from_the_text_even_around_guillemets(self):
        """French OCR is full of « » — the batch markers. The fingerprint is
        computed from the source text and travels in the batch, so a quoted
        passage can no longer be mis-split when a verdict is merged."""
        text = ("Le préfet a rappelé « la laïcité de l'État ». Les militants "
                "parlent du « divorce » prononcé hier, et de rien d'autre.")
        rec = self.member(OCR=text)
        rows, _ = A.select_tier1([rec], self.g.texts, {"occurrences": {}}, self.opts)
        row = next(r for r in rows if r["frame"] == "droit-famille")
        start = text.index("divorce")
        self.assertEqual(row["fp"], A.occurrence_fingerprint(
            "articles", "1", "droit-famille", "OCR", text, start, start + 7))
        self.assertEqual(row["run"], RUN)
        # The reader's window marks the match inside the source's own
        # guillemets — exactly what a «-search could not take apart.
        self.assertIn("« «divorce» » prononcé", row["window"])

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

    def test_shared_digest_reproduces_the_committed_fingerprints(self):
        """One helper now cuts every hash; the ledger's keys must not move."""
        forms = ["Laïcité", "laïque"]
        legacy = hashlib.sha1("|".join(sorted(fold_plain(f) for f in forms))
                              .encode()).hexdigest()[:12]
        self.assertEqual(A.hits_fingerprint(forms), legacy)
        text = "La laïcité et le divorce."
        around = re.sub(r"\s+", " ", fold_plain(text[0:15]) + "«"
                        + fold_plain(text[15:22]) + "»" + fold_plain(text[22:]))
        legacy_occ = hashlib.sha1(f"articles|1|droit-famille|OCR|{around}"
                                  .encode()).hexdigest()[:16]
        self.assertEqual(A.occurrence_fingerprint(
            "articles", "1", "droit-famille", "OCR", text, 15, 22), legacy_occ)

    def test_hits_fingerprint_folds_case_and_accents(self):
        self.assertEqual(A.hits_fingerprint(["Laïcité", "laïque"]),
                         A.hits_fingerprint(["laicite", "LAIQUE"]))

    # -- selection ---------------------------------------------------------

    def test_tier1_keeps_near_core_occurrences_and_whole_full_frames(self):
        far = " mot" * 120
        rec = self.member(OCR="Laïcité et école coranique." + far
                          + " L'école publique. Le divorce.")
        rows, _ = A.select_tier1([rec], self.g.texts, {"occurrences": {}}, self.opts)
        got = Counter((r["frame"], r["near_core_hit"]) for r in rows)
        # The near `ecole` hit, and `droit-famille` in full; never a core frame.
        self.assertEqual(got, Counter({("ecole", True): 1, ("droit-famille", False): 1}))
        self.opts.near_only = False
        rows, _ = A.select_tier1([rec], self.g.texts, {"occurrences": {}}, self.opts)
        self.assertEqual(Counter(r["frame"] for r in rows),
                         Counter({"ecole": 2, "droit-famille": 1}))

    def test_tier1_skips_judged_and_repeated_passages(self):
        # Longer than the ±60-character fingerprint window on both sides,
        # so the two copies fingerprint identically.
        passage = ("Un long préambule sans rapport avec ce qui suit, vraiment. "
                   "La laïcité et le divorce, puis une longue suite de mots "
                   "sans aucun rapport avec ce qui précède.")
        rec = self.member(OCR=passage + " " + passage)
        rows, skipped = A.select_tier1([rec], self.g.texts, {"occurrences": {}}, self.opts)
        self.assertEqual(len(rows), 1)
        self.assertEqual(skipped["occurrences_repeated"], 1)
        judged = {"occurrences": {rows[0]["fp"]: {}}}
        rows, skipped = A.select_tier1([rec], self.g.texts, judged, self.opts)
        self.assertEqual(rows, [])
        self.assertEqual(skipped["occurrences_judged"], 2)

    def test_tier2_extracts_new_skips_judged_and_gates_stale(self):
        new = self.member("1", OCR="La laïcité.", language="Français | Anglais")
        tag_only = self.member("2", OCR="Un texte sans le mot.", subject="Laïcité")
        rows, _ = A.select_tier2([new, tag_only], self.g.texts,
                                 {"members": {}}, self.opts, {("articles", "1"): "Résumé"})
        by_id = {r["id"]: r for r in rows}
        self.assertEqual(by_id["1"]["route"], "text=1")
        self.assertEqual(by_id["1"]["run"], RUN)
        self.assertEqual(by_id["1"]["language"], "Français | Anglais")
        self.assertEqual(by_id["1"]["ai_description"], "Résumé")
        self.assertEqual(by_id["2"]["route"], "tag-only")
        self.assertEqual(by_id["2"]["opening"], "Un texte sans le mot.")

        judged = {"members": {"articles:1": {"hits_fp": by_id["1"]["hits_fp"]},
                              "articles:2": {"hits_fp": "something-else"}}}
        rows, skipped = A.select_tier2([new, tag_only], self.g.texts, judged, self.opts)
        self.assertEqual(rows, [])
        self.assertEqual(skipped, Counter({"members_judged": 1, "members_stale": 1}))
        self.opts.include_stale = True
        rows, _ = A.select_tier2([new, tag_only], self.g.texts, judged, self.opts)
        self.assertEqual([r["id"] for r in rows], ["2"])

    # -- merge -------------------------------------------------------------

    def t1_rows(self):
        rec = self.member(OCR="La laïcité et le divorce. La laïcité et la polygamie.")
        rows, _ = A.select_tier1([rec], self.g.texts, {"occurrences": {}}, self.opts)
        self.assertEqual(len(rows), 2)
        return rows

    def merge(self, ledger, rows, verdicts, tier=1):
        return A.merge_rows(ledger, rows, verdicts, tier=tier, batch="t-01.json",
                            run=RUN, rule="r", judged_at="2026-10-05", model="m")

    def test_tier1_merge_matches_on_fp_not_position(self):
        rows = self.t1_rows()
        verdicts = [{"fp": r["fp"], "run": RUN, "id": r["id"],
                     "sense_ok": i == 0, "religion_state": True}
                    for i, r in enumerate(rows)][::-1]
        ledger = load_ledger(Path(self.tmp.name) / "none.json")
        added, problems = self.merge(ledger, rows, verdicts)
        self.assertEqual(problems, [])
        self.assertEqual(added["occurrences"], 2)
        self.assertTrue(ledger["occurrences"][rows[0]["fp"]]["sense_ok"])
        self.assertFalse(ledger["occurrences"][rows[1]["fp"]]["sense_ok"])

    def test_tier1_merge_refuses_missing_foreign_and_non_boolean_verdicts(self):
        rows = self.t1_rows()
        ok = {"fp": rows[0]["fp"], "run": RUN, "sense_ok": True, "religion_state": True}
        cases = {
            "missing": [ok],
            "string": [ok, {"fp": rows[1]["fp"], "run": RUN, "sense_ok": "true",
                            "religion_state": True}],
            "other run": [ok, {"fp": rows[1]["fp"], "run": "older",
                               "sense_ok": True, "religion_state": True}],
            "no fp": [ok, {"run": RUN, "sense_ok": True, "religion_state": True}],
        }
        for name, verdicts in cases.items():
            with self.subTest(name):
                _, problems = self.merge({"occurrences": {}}, rows, verdicts)
                self.assertTrue(problems)

    def test_merge_refuses_batch_rows_from_another_run(self):
        rows = self.t1_rows()
        for r in rows:
            r["run"] = "older"
        verdicts = [{"fp": r["fp"], "run": RUN, "sense_ok": True, "religion_state": True}
                    for r in rows]
        ledger = {"occurrences": {}}
        _, problems = self.merge(ledger, rows, verdicts)
        self.assertTrue(problems)
        self.assertEqual(ledger["occurrences"], {})

    def test_tier2_merge_validates_and_records_the_route(self):
        rec = self.member(OCR="La laïcité et la laïcité.")
        rows, _ = A.select_tier2([rec], self.g.texts, {"members": {}}, self.opts)
        ledger = {"members": {}}
        added, problems = self.merge(
            ledger, rows, [{"id": "1", "run": RUN, "relevant": "yes",
                            "laicite_sense": "state"}], tier=2)
        self.assertEqual(problems, [])
        entry = ledger["members"]["articles:1"]
        self.assertEqual((entry["route"], entry["relevant"], entry["sense"]),
                         ("text>=2", "yes", "state"))
        self.assertEqual(entry["hits_fp"], rows[0]["hits_fp"])
        for bad in ({"relevant": "maybe"}, {"laicite_sense": "secular"}, {"run": "older"}):
            with self.subTest(bad=bad):
                verdict = {"id": "1", "run": RUN, "relevant": "no", **bad}
                _, problems = self.merge({"members": {}}, rows, [verdict], tier=2)
                self.assertTrue(problems)

    def work_dir(self, verdicts=None):
        work = Path(self.tmp.name) / "work"
        (work / "batches").mkdir(parents=True)
        (work / "verdicts").mkdir()
        (work / "manifest.json").write_text(json.dumps({"run": RUN}), encoding="utf-8")
        rows = self.t1_rows()
        (work / "batches" / "t1-droit-famille-01.json").write_text(
            json.dumps(rows), encoding="utf-8")
        if verdicts is not None:
            (work / "verdicts" / "t1-droit-famille-01.json").write_text(
                json.dumps(verdicts(rows)), encoding="utf-8")
        return work

    def run_merge(self, work):
        args = argparse.Namespace(work_dir=str(work), model="m", date="2026-10-05")
        empty = load_ledger(Path(self.tmp.name) / "none.json")
        with patch.object(A, "load_ledger", return_value=empty), \
                patch.object(A, "save_ledger") as save, \
                patch.object(A, "register_rules", return_value={1: "r1", 2: "r2"}):
            try:
                A.cmd_merge(args)
            except SystemExit as exc:
                return save, exc.code
        return save, 0

    def test_merge_saves_nothing_when_any_batch_has_a_problem(self):
        # One verdict missing: nothing at all reaches the ledger file.
        save, code = self.run_merge(self.work_dir(lambda rows: [
            {"fp": rows[0]["fp"], "run": RUN, "sense_ok": True, "religion_state": True}]))
        self.assertEqual(code, 1)
        save.assert_not_called()

    def test_merge_saves_a_clean_run(self):
        save, code = self.run_merge(self.work_dir(lambda rows: [
            {"fp": r["fp"], "run": RUN, "sense_ok": True, "religion_state": False}
            for r in rows]))
        self.assertEqual(code, 0)
        save.assert_called_once()
        self.assertEqual(len(save.call_args.args[0]["occurrences"]), 2)

    def test_extract_refuses_to_start_over_leftover_verdicts(self):
        work = self.work_dir(lambda rows: [])
        args = argparse.Namespace(work_dir=str(work), archive_previous=False)
        with patch.object(A, "AuditGenerator",
                          side_effect=AssertionError("must not scan")):
            with self.assertRaises(SystemExit):
                A.cmd_extract(args)
        self.assertTrue((work / "verdicts" / "t1-droit-famille-01.json").exists())

    def test_archive_moves_the_previous_run_aside(self):
        work = self.work_dir(lambda rows: [])
        target = A.archive_previous_run(work)
        self.assertEqual(target, work / "archive" / RUN)
        self.assertTrue((target / "verdicts" / "t1-droit-famille-01.json").exists())
        self.assertTrue((target / "manifest.json").exists())
        self.assertFalse((work / "verdicts").exists())

    # -- the ledger --------------------------------------------------------

    def test_empty_loads_do_not_share_state(self):
        missing = Path(self.tmp.name) / "absent.json"
        first = load_ledger(missing)
        first["members"]["articles:1"] = {"relevant": "yes"}
        first["rules"]["x"] = {}
        self.assertEqual(load_ledger(missing),
                         {"rules": {}, "members": {}, "occurrences": {}})

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
