"""Regression cases from the Laïcité source-text audit."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from laicite.generator import LaiciteGenerator  # noqa: E402
from laicite.scan import SUBSET_FIELDS  # noqa: E402


class LaiciteMethodologyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.g = LaiciteGenerator(Path(self.tmp.name))

    def scan(self, subset="articles", **fields):
        row = {"o:id": "1", "title": "", "OCR": "", "subject": "",
               "OCR_is_public": True, "nb_mots": 9999, **fields}
        return self.g._scan_row(row, subset, SUBSET_FIELDS[subset], "laicite")

    def test_descriptions_never_select_or_annotate_sources(self):
        for subset in SUBSET_FIELDS:
            with self.subTest(subset=subset):
                self.assertIsNone(self.scan(
                    subset, descriptionAI="laïcité", abstract="laïcité",
                    tableOfContents="laïcité", description="laïcité"))
                rec = self.scan(subset, OCR="Laïcité", descriptionAI="divorce",
                                abstract="divorce", tableOfContents="divorce")
                self.assertEqual(rec.frame_counts, {"laicite": 1})

    def test_typographic_apostrophes_preserve_original_excerpt(self):
        text = "Laïcité et séparation de l’État."
        rec = self.scan(OCR=text)
        occ = next(o for o in rec.occurrences if o.frame == "separation")
        self.assertEqual(text[occ.start:occ.end], "séparation de l’État")

    def test_schooling_does_not_lose_overlap_with_membership(self):
        rec = self.scan(OCR="Une école laïque.")
        self.assertTrue(rec.said)
        self.assertEqual(rec.frame_counts, {"laicite": 1, "ecole": 1})

    def test_political_succession_and_crosswords_are_not_family_law(self):
        for text in ["Laïcité et succession d’Abû Bakr.",
                     "Laïcité. MOTS CROISÉS : Succession-Suif-Tabaski."]:
            self.assertNotIn("droit-famille", self.scan(OCR=text).frame_counts)
        self.assertEqual(self.scan(OCR="Laïcité et droits de succession.")
                         .frame_counts["droit-famille"], 1)

    def test_density_counts_exactly_the_searchable_tokens(self):
        rec = self.scan(title="Laïcité", OCR="Un texte bref.",
                        descriptionAI="Un long résumé non compté.")
        self.g.scans = [rec]
        corpus = self.g.build_corpora()["by_subset"]["articles"]
        self.assertEqual(corpus["words"], 4)
        self.assertEqual(corpus["per_10k"], 2500)

    def test_rights_gate_keeps_title_but_withholds_private_full_text(self):
        rec = self.scan(title="Laïcité", OCR="Laïcité et liberté religieuse.",
                        OCR_is_public=False)
        self.g.scans = [rec]
        _, bundles = self.g.build_concordance()
        self.assertEqual([r["d"] for r in bundles["articles"]["rows"]], ["title"])

    def test_youtube_title_and_tag_membership_without_transcripts(self):
        self.assertIsNotNone(self.scan("audiovisual", title="Laïcité au Bénin"))
        tagged = self.scan("audiovisual", title="Une conférence", subject="Laïcité")
        self.assertFalse(tagged.said)
        self.assertIsNone(self.scan("audiovisual", title="Une conférence",
                                   description="Un débat sur la laïcité"))

    def test_youtube_population_and_transcript_coverage(self):
        videos = pd.DataFrame([
            {"o:id": "1", "source_type": "youtube", "title": "Laïcité", "OCR": "",
             "OCR_is_public": False},
            {"o:id": "2", "source_type": "youtube", "title": "Conférence", "OCR": "Laïcité",
             "OCR_is_public": True},
            {"o:id": "3", "source_type": "deposited", "title": "Laïcité", "OCR": "Laïcité",
             "OCR_is_public": True},
        ])
        with patch("laicite.scan.load_dataset_safe", side_effect=lambda subset, **kw:
                   videos if subset == "audiovisual" else pd.DataFrame()):
            meta = self.g.build_metadata()
        self.assertEqual(meta["subsets"]["audiovisual"]["corpus_size"], 2)
        self.assertEqual(meta["subsets"]["audiovisual"]["members_with_fulltext"], 1)
        self.assertEqual(meta["subsets"]["audiovisual"]["corpus_with_fulltext"], 1)
        self.assertEqual(len(meta["video_items"]), 2)

    def test_ambiguous_senses_need_positive_context(self):
        for text in ["De simples laïcs.", "Une langue séculière.", "Un bras séculier.", "Un mouvement laïque."]:
            self.assertIsNone(self.scan(OCR=text))
        self.assertIsNotNone(self.scan(OCR="Une école laïque."))
        self.assertIsNotNone(self.scan(OCR="Secularism and secularization."))

    def test_local_categories_do_not_join_distant_passages(self):
        near = self.scan(OCR="Laïcité et divorce.")
        far = self.scan(OCR="Laïcité. " + "texte " * 100 + "divorce.")
        self.assertEqual(near.nearby_frame_counts.get("droit-famille"), 1)
        self.assertNotIn("droit-famille", far.nearby_frame_counts)
        self.assertIn("droit-famille", far.frame_counts)

    def test_proportional_sampler_keeps_population_weights(self):
        items = ["large"] * 90 + ["small"] * 10
        sample = self.g._sample_across(items, 20, key=lambda x: x)
        self.assertEqual(sample.count("large"), 18)
        self.assertEqual(sample.count("small"), 2)

    def test_coverage_includes_negative_and_missing_text_rows(self):
        for number, title, ocr, country in [
            (1, "Laïcité", "", "Bénin | Togo"),
            (2, "Autre", "Un texte.", "Bénin"),
            (3, "", "", "Bénin"),
        ]:
            row = {"o:id": str(number), "title": title, "OCR": ocr, "country": country,
                   "pub_date": "2020", "OCR_is_public": False}
            rec = self.g._scan_row(row, "articles", SUBSET_FIELDS["articles"], "laicite")
            self.g._observe_source(row, "articles", rec)
            if rec:
                self.g.scans.append(rec)
        cells = self.g.build_research()["cells"]
        all_country = next(c for c in cells if c["country"] == "")
        self.assertEqual(all_country["records"], 3)
        self.assertEqual(all_country["union_available"], 2)
        self.assertEqual(all_country["fulltext_available"], 1)
        self.assertEqual(all_country["title_matches"], 1)
        self.assertEqual(all_country["public_fulltext"], 0)

    def test_matched_baseline_uses_property_specific_complements(self):
        self.g._sentiment_cols = {"test": {"polarite": "rating"}}
        def r(selected, year):
            return {"selected": selected, "countries": ["Bénin"], "outlet": "A", "year": year}
        self.g._sentiment_source_rows = [
            (r(True, 2020), {"rating": "Positif"}),
            (r(True, 2021), {"rating": "Négatif"}),
            (r(False, 2020), {"rating": "Neutre"}),
            (r(False, 2020), {"rating": "Neutre"}),
            (r(False, 2021), {"rating": ""}),
        ]
        result = self.g._matched_sentiment("test")["polarite"]
        self.assertEqual(result["matched"], 1)
        self.assertEqual(result["eligible"], 2)
        self.assertEqual(result["control_items"], 2)
        self.assertEqual(result["weighted_controls"], {"Neutre": 1.0})

    def test_reuse_withheld_text_never_returns_excerpts(self):
        a = self.scan(title="Laïcité", OCR="Texte privé", OCR_is_public=False)
        b = self.scan(title="Laïcité", OCR="Autre texte")
        self.assertEqual(self.g._reuse_evidence(a, b), {"status": "not_public"})

    def test_temporal_global_excludes_scholarship(self):
        a = self.scan(OCR="Laïcité", pub_date="2020")
        b = self.scan("references", OCR="Laïcité", pub_date="2020")
        self.g.scans = [a, b]
        self.assertEqual(self.g.build_trends()["global"]["laicite"], [1])

    def test_seasonality_uses_same_population_for_both_calendars(self):
        self.g.scans = [self.scan(OCR="Laïcité", pub_date="2020-02-01", hijri_month=6),
                        self.scan(OCR="Laïcité", pub_date="2020-02")]
        season = self.g.build_seasonality()["by_subset"]["articles"]
        self.assertEqual(sum(season["gregorian"]), 1)
        self.assertEqual(sum(season["hijri"]), 1)


if __name__ == "__main__":
    unittest.main()
