"""On This Day v2: the day-file row contract and the text rules behind it.

The generator fans out a file per calendar day, so it is not in the golden
run; these tests pin the parts that have regressed or leak: the excerpt's
title-restatement filter and page-marker stripping, the OCR privacy gate
(fail closed), the summary clip, the subject rule, and the 12-field row.
"""
from __future__ import annotations

import sys
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import generate_on_this_day as otd  # noqa: E402
import validate_data as validation  # noqa: E402

LEDE = ("La visite du ministre de l'Enseignement technique et professionnel a permis "
        "de conclure un accord de prêt global avec trois institutions financières, "
        "selon un communiqué publié hier à Abidjan par le cabinet du ministre.")


class ExcerptTitleTests(unittest.TestCase):
    def ocr(self, text, title):
        return otd.excerpt("ocr", text, True, title)

    def test_title_with_different_punctuation_is_dropped(self):
        title = ("Enseignement technique et professionnel. Mission fructueuse du "
                 "ministre Dosso Moussa en Arabie Saoudite : 12 milliards")
        text = ("Enseignement technique et professionnel : Mission fructueuse du "
                "ministre Dosso Moussa en Arabie Saoudite 12 milliards\n" + LEDE)
        self.assertTrue(self.ocr(text, title).startswith("La visite du ministre"))

    def test_markdown_and_split_headline_are_dropped(self):
        title = ("Islam / Yopougon Ananeraie carrefour Sorbonne : 5000 fidèles "
                 "appellent à l'aide")
        text = ("Islam / Yopougon Ananeraie carrefour Sorbonne **5000 fidèles "
                "appellent à l'aide** " + LEDE)
        out = self.ocr(text, title)
        self.assertTrue(out.startswith("La visite"), out)
        self.assertNotIn("**", out)

    def test_deck_after_the_colon_is_dropped(self):
        title = "Pèlerinage 2011 à la Mecque : les premières vagues de pèlerins de retour au pays"
        text = "Les premières vagues de pèlerins de retour au pays " + LEDE
        self.assertTrue(self.ocr(text, title).startswith("La visite"))

    def test_near_match_does_not_eat_the_first_word(self):
        # The OCR dropped a letter of the headline ("départ").
        title = "Hadj 2003 : les premiers départs au compte-gouttes"
        text = "Hadj 2003\nLes premiers départ au compte-gouttes\n\nContrairement à " + LEDE
        self.assertTrue(self.ocr(text, title).startswith("Contrairement à"))

    def test_headline_after_a_kicker_is_dropped(self):
        title = "Tabaski / Abattoir de Port Bouët : le mouton vendu à un prix record"
        text = ("Fête de la tabaski Le mouton plus cher que le bœuf --- Page 2 --- "
                "Tabaski / Abattoir de Port Bouët : le mouton vendu à un prix record "
                + LEDE)
        self.assertTrue(self.ocr(text, title).startswith("La visite"))

    def test_excerpt_that_is_only_the_title_is_empty(self):
        title = "Le Centre Islamique de Lomé désormais opérationnel pour tous les fidèles du pays"
        text = "LE CENTRE ISLAMIQUE DE LOME, désormais opérationnel pour tous les fidèles du pays !"
        self.assertEqual(self.ocr(text, title), "")
        self.assertTrue(otd.restates_title("Le Centre islamique de Lomé désormais opérationnel", title))

    def test_one_letter_opening_word_is_kept(self):
        text = "À trois jours de la fête, " + LEDE
        self.assertTrue(self.ocr(text, "Sans rapport").startswith("À trois jours"))

    def test_excerpt_is_clipped(self):
        out = self.ocr(LEDE * 4, "Sans rapport")
        self.assertLessEqual(len(out), otd.EXCERPT_CHARS + 1)
        self.assertTrue(out.endswith("…"))


class PageMarkerTests(unittest.TestCase):
    def test_page_markers_are_stripped_anywhere(self):
        text = "Premier paragraphe. --- Page 2 --- Suite du texte\n=== Page 13 ===\nfin"
        cleaned = otd.clean_text(text)
        self.assertNotIn("Page", cleaned)
        self.assertEqual(cleaned, "Premier paragraphe. Suite du texte fin")

    def test_no_marker_reaches_an_excerpt(self):
        text = LEDE[:120] + " --- Page 2 --- " + LEDE
        self.assertNotIn("Page 2", otd.excerpt("ocr", text, True, "Sans rapport"))


class PrivacyGateTests(unittest.TestCase):
    def test_gate_fails_closed(self):
        for flag in (None, float("nan"), False, np.False_, "True", 1, pd.NA):
            self.assertEqual(otd.excerpt("ocr", LEDE, flag, "Sans rapport"), "", repr(flag))

    def test_real_true_opens(self):
        for flag in (True, np.True_):
            self.assertTrue(otd.excerpt("ocr", LEDE, flag, "Sans rapport"))

    def test_public_columns_need_no_ocr_flag(self):
        self.assertTrue(otd.excerpt("contents", None, None, "t", contents=LEDE))
        self.assertTrue(otd.excerpt("description", None, None, "t", description=LEDE))

    def test_description_footer_is_cut(self):
        desc = LEDE + "\n------------------------\nFacebook: https://www.facebook.com/x\n#tag"
        out = otd.excerpt("description", None, None, "t", description=desc)
        self.assertNotIn("facebook", out.lower())

    def test_private_fields_cell_shapes(self):
        self.assertEqual(otd.private_set(np.array(["OCR", "thumbnail"])), {"OCR", "thumbnail"})
        self.assertEqual(otd.private_set(None), set())
        self.assertEqual(otd.private_set(float("nan")), set())
        self.assertEqual(otd.private_set([]), set())


class SummaryTests(unittest.TestCase):
    def test_short_summary_is_untouched(self):
        self.assertEqual(otd.summary("  Une  phrase\ncourte. "), "Une phrase courte.")
        self.assertEqual(otd.summary(None), "")
        self.assertEqual(otd.summary(float("nan")), "")

    def test_clipped_at_a_sentence_end(self):
        first = "Le CERFI a organisé une conférence publique sur la Charte de la transition " \
                "à Bobo-Dioulasso, devant plusieurs centaines de fidèles et de responsables."
        text = first + " " + first + " " + first
        out = otd.summary(text)
        self.assertLessEqual(len(out), otd.SUMMARY_CHARS)
        self.assertTrue(out.endswith("."))
        self.assertGreaterEqual(len(out), otd.SUMMARY_MIN_SENTENCE)

    def test_word_boundary_when_no_sentence_fits(self):
        text = " ".join(["mot"] * 200)
        out = otd.summary(text)
        self.assertTrue(out.endswith("…"))
        self.assertLessEqual(len(out), otd.SUMMARY_CHARS + 1)
        self.assertFalse(out[:-1].endswith(" "))


class SubjectRuleTests(unittest.TestCase):
    labels = {"1": "Paix", "2": "CERFI", "3": "Un tel", "4": "Laïcité", "5": "Coran"}

    def test_mid_band_before_rare_before_ubiquitous(self):
        # population 1000: ubiquitous above 50, rare at 1, target sqrt(2*50)=10.
        weight = Counter({"1": 400, "2": 12, "3": 1, "4": 45, "5": 60})
        picked = otd.pick_subjects(["1", "3", "4", "2", "5", "99"], self.labels, weight, 1000)
        self.assertEqual(picked, [["CERFI", 2], ["Laïcité", 4], ["Un tel", 3]])

    def test_ubiquitous_only_when_nothing_else(self):
        weight = Counter({"1": 400, "5": 60})
        self.assertEqual(otd.pick_subjects(["1", "5"], self.labels, weight, 1000),
                         [["Coran", 5], ["Paix", 1]])

    def test_unresolved_and_duplicates_are_skipped(self):
        self.assertEqual(otd.pick_subjects(["99", "2", "2"], self.labels, Counter({"2": 9}), 1000),
                         [["CERFI", 2]])
        self.assertEqual(otd.pick_subjects([], self.labels, Counter(), 1000), [])

    def test_ties_keep_curator_order(self):
        weight = Counter({"2": 10, "4": 10})
        self.assertEqual([s[0] for s in otd.pick_subjects(["4", "2"], self.labels, weight, 1000)],
                         ["Laïcité", "CERFI"])


def _frames():
    base = {"o:id": ["10", "11"], "pub_date": ["1997-11-24", "2001"],
            "title": ["Un titre", "Sans date"], "thumbnail":
            ["https://islam.zmo.de/files/medium/" + "a" * 40 + ".jpg", ""],
            "country": ["Benin|Togo", ""], "subject_ids": ["7|8", ""],
            "item_is_public": [True, True], "private_fields": [np.array([]), np.array([])],
            "hijri_year": [1418.0, None], "hijri_month": [7.0, None], "hijri_day": [23.0, None]}
    articles = pd.DataFrame({**base, "newspaper": ["Togo-Presse", "X"],
                             "OCR": [LEDE, LEDE], "OCR_is_public": [False, True],
                             "descriptionAI": ["Résumé.", ""], "descriptionAI_en": ["Summary.", ""]})
    images = pd.DataFrame({**base, "o:id": ["20", "21"], "creator": ["Photographe", ""],
                           "title": ["Mosquée|Mosque", "x"], "description": ["", ""],
                           "item_is_public": [True, None]})
    index = pd.DataFrame({"o:id": ["7", "8"], "Titre": ["Sujet A", "Notice"],
                          "Type": ["Sujets", otd.AUTHORITY_PLACEHOLDER_TYPE]})
    return {"articles": articles, "images": images, "index": index}


class RowContractTests(unittest.TestCase):
    def collect(self):
        frames = _frames()

        def fake_load(subset, repo_id=None, columns=None, **_):
            frame = frames.get(subset, pd.DataFrame())
            return frame[[c for c in (columns or frame.columns) if c in frame.columns]]

        sources = [s for s in otd.SOURCES if s[0] in ("articles", "images")]
        with patch.object(otd, "load_dataset_safe", fake_load), \
                patch.object(otd, "SOURCES", sources):
            return otd.collect_days("repo")

    def test_rows_have_twelve_fields_in_both_fan_outs(self):
        greg, hij, stats = self.collect()
        self.assertEqual(sorted(greg), ["11-24"])
        self.assertEqual(sorted(hij), ["07-23"])
        for row in greg["11-24"] + hij["07-23"]:
            self.assertEqual(len(row), 12)
        article = greg["11-24"][0]
        self.assertEqual(article, [1997, 10, "Un titre", "Togo-Presse", "a", "a" * 40,
                                   "", 1418, "Bénin", "Résumé.", "Summary.", [["Sujet A", 7]]])
        self.assertIs(type(article[7]), int)

    def test_private_item_is_dropped_and_image_title_is_one_variant(self):
        greg, _, stats = self.collect()
        image = [r for r in greg["11-24"] if r[4] == "i"]
        self.assertEqual(len(image), 1)
        self.assertEqual(image[0][2], "Mosquée")
        self.assertEqual(image[0][3], "Photographe")
        self.assertEqual(stats["type_i"], 1)

    def test_rich_days_are_deterministic(self):
        days = {"01-01": [[1990, 1, "", "", "a", "x", "", 0, "", "", "", []],
                          [2010, 2, "", "", "a", "x", "", 0, "", "", "", []]],
                "01-02": [[1990, 3, "", "", "a", "", "", 0, "", "", "", []]],
                "01-03": [[1990, 4, "", "", "a", "x", "", 0, "", "", "", []]]}
        self.assertEqual(otd.rich_days(days, 0.4), ["01-01", "01-03"])
        self.assertEqual(otd.rich_days(days, 0.4), otd.rich_days(dict(reversed(days.items())), 0.4))


class ValidatorTests(unittest.TestCase):
    sources = {"articles": {"ids": ["1"], "publicOcrIds": ["1"]},
               "audiovisual": {"ids": ["2"], "publicOcrIds": []},
               "documents": {"ids": ["3"], "publicOcrIds": []},
               "images": {"ids": ["4"], "publicOcrIds": []}}

    def check(self, row):
        return validation.check_references("on-this-day/11-24.json", {"items": [row]}, self.sources)

    def test_new_types_resolve_to_their_subsets(self):
        tail = [0, "", "", "", []]
        self.assertFalse(self.check([2020, 2, "t", "s", "v", "", "blurb"] + tail))
        self.assertFalse(self.check([2020, 4, "t", "s", "i", "", ""] + tail))
        self.assertTrue(self.check([2020, 4, "t", "s", "v", "", ""] + tail))

    def test_document_excerpt_needs_public_ocr(self):
        tail = [0, "", "", "", []]
        self.assertTrue(self.check([2020, 3, "t", "s", "d", "", "private text"] + tail))
        self.assertFalse(self.check([2020, 3, "t", "s", "d", "", ""] + tail))


if __name__ == "__main__":
    unittest.main()
