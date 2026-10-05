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
        # A test that reaches the real loader would download the private
        # mirror. Fail instead; a test that needs rows patches its own.
        guard = patch("laicite.scan.load_dataset_safe",
                      side_effect=AssertionError("tests must not load the dataset"))
        guard.start()
        self.addCleanup(guard.stop)

    def row(self, **fields):
        return {"o:id": "1", "title": "", "OCR": "", "subject": "",
                "OCR_is_public": True, "nb_mots": 9999, **fields}

    def scan_row(self, subset="articles", **fields):
        """The whole RowScan: the record, the parsed metadata, broad hits."""
        return self.g._scan_row(self.row(**fields), subset,
                                SUBSET_FIELDS[subset], "laicite")

    def scan(self, subset="articles", **fields):
        return self.scan_row(subset, **fields).rec

    def use(self, *scans):
        """Hand the builders a finished scan without loading anything."""
        self.g.scans = list(scans)
        self.g._scanned = True

    def observe(self, subset="articles", **fields):
        """Run one row through both halves of the scan, as scan_all does."""
        row = self.row(**fields)
        scanned = self.g._scan_row(row, subset, SUBSET_FIELDS[subset], "laicite")
        self.g._observe_source(row, subset, scanned)
        if scanned.rec is not None:
            self.g.scans.append(scanned.rec)
        self.g._scanned = True
        return scanned

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
        self.use(rec)
        corpus = self.g.build_corpora()["by_subset"]["articles"]
        self.assertEqual(corpus["words"], 4)
        self.assertEqual(corpus["per_10k"], 2500)

    def test_rights_gate_keeps_title_but_withholds_private_full_text(self):
        rec = self.scan(title="Laïcité", OCR="Laïcité et liberté religieuse.",
                        OCR_is_public=False)
        self.use(rec)
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
            self.observe(**{"o:id": str(number)}, title=title, OCR=ocr, country=country,
                         pub_date="2020", OCR_is_public=False)
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

    def test_trends_bundle_is_the_coverage_cells_alone(self):
        """The timeline reads `research` and nothing else; the retired frame
        series must not creep back. Scholarship stays a separate subset in
        the cells, never pooled with the primary sources."""
        self.observe(OCR="Laïcité", pub_date="2020")
        self.observe("references", **{"o:id": "2"}, OCR="Laïcité", pub_date="2020")
        trends = self.g.build_trends()
        self.assertEqual(set(trends), {"generated_at", "research"})
        cells = trends["research"]["cells"]
        self.assertEqual({c["subset"] for c in cells}, {"articles", "references"})
        self.assertEqual(trends["research"]["minimum_cell"], 5)
        self.assertEqual(trends["research"]["method_version"], "source-text-v4")
        self.assertFalse(hasattr(self.g, "build_countries"))

    def test_seasonality_uses_same_population_for_both_calendars(self):
        self.use(self.scan(OCR="Laïcité", pub_date="2020-02-01", hijri_month=6),
                 self.scan(OCR="Laïcité", pub_date="2020-02"))
        bundle = self.g.build_seasonality()
        season = bundle["by_subset"]["articles"]
        self.assertEqual(sum(season["gregorian"]), 1)
        self.assertEqual(sum(season["hijri"]), 1)
        # The rate floor ships with the bundle, from the constant the
        # coverage cells and the arenas shares also use.
        self.assertEqual(bundle["minimum_cell"], self.g.build_arenas()["minimum_cell"])
        self.assertEqual(bundle["minimum_cell"], 5)

    # -- the September 2026 relevance audit ------------------------------

    def test_bare_heritage_is_not_family_law(self):
        """38% sense precision over 487 hits, so the bare word is retired.

        Accent folding made it match `heritage` too; what it actually
        caught was colonial legacy, political legacy, the hadith on the
        prophets' héritage and a newspaper named L'Héritage.
        """
        for text in ["Laïcité et héritage colonial.",
                     "Laïcité. Un héritage.",
                     "Laicite and the colonial heritage."]:
            with self.subTest(text=text):
                self.assertNotIn("droit-famille",
                                 self.scan(OCR=text).frame_counts)
        for text in ["Laïcité et part d'héritage.",
                     "Laïcité : le droit à l'héritage.",
                     "Laïcité et partage de l’héritage.",
                     "Laïcité et héritage en islam."]:
            with self.subTest(text=text):
                self.assertEqual(
                    self.scan(OCR=text).frame_counts["droit-famille"], 1)

    def test_metaphorical_divorce_is_excluded_by_right_context(self):
        """`not_followed_by` — the political divorce, not the family one."""
        for text in ["Laïcité : le divorce entre l'État et l'église.",
                     "Laïcité. Son divorce avec le parti."]:
            with self.subTest(text=text):
                self.assertNotIn("droit-famille",
                                 self.scan(OCR=text).frame_counts)
        # Only the immediately following token is blocked, and only as a
        # whole word. `divorcé` folds onto `divorce` and still counts;
        # `divorcée` does not, and never did — it is not a listed form.
        for text in ["Laïcité : le divorce est prononcé.",
                     "Laïcité et le divorce, entre autres sujets.",
                     "Laïcité : un divorce entretenu.",
                     "Laïcité : il est divorcé."]:
            with self.subTest(text=text):
                self.assertEqual(
                    self.scan(OCR=text).frame_counts["droit-famille"], 1)

    def test_membership_route_records_how_each_item_got_in(self):
        cases = {
            "tag+text": dict(OCR="Laïcité.", subject="Laïcité"),
            "tag-only": dict(OCR="Un texte.", subject="Laïcité"),
            "text>=2": dict(OCR="Laïcité et laïcité."),
            "text=1": dict(OCR="Laïcité."),
        }
        for route, fields in cases.items():
            with self.subTest(route=route):
                self.assertEqual(self.scan(**fields).membership_route, route)

    def test_title_hit_is_recorded_separately_from_the_route(self):
        titled = self.scan(title="Laïcité au Bénin", OCR="Un texte.")
        self.assertTrue(titled.title_hit)
        self.assertEqual(titled.membership_route, "text=1")
        self.assertFalse(self.scan(title="Un débat", OCR="Laïcité.").title_hit)
        # An annotation frame in the title is not a core hit.
        self.assertFalse(self.scan(title="Le divorce",
                                   OCR="Laïcité.").title_hit)

    def test_concordance_items_carry_strength_attributes(self):
        self.use(self.scan(title="Laïcité", OCR="Laïcité.", subject="Laïcité"))
        index, bundles = self.g.build_concordance()
        entry = bundles["articles"]["items"][0]
        self.assertEqual(entry["s"], "tag+text")
        self.assertEqual(entry["h"], 1)
        self.assertNotIn("b", entry)
        self.assertEqual(set("otuycngshb"), set(index["item_keys"]))

    def test_metadata_membership_routes_sum_across_subsets(self):
        self.use(
            self.scan(OCR="Laïcité.", subject="Laïcité"),
            self.scan(OCR="Laïcité et laïcité."),
            self.scan(title="Laïcité", OCR="Un texte."),
            self.scan("documents", OCR="Un texte.", subject="Laïcité"),
        )
        routes = self.g.build_metadata()["membership_routes"]
        self.assertEqual(routes["articles"],
                         {"tag+text": 1, "text>=2": 1, "text=1": 1,
                          "tag-only": 0, "title_hit": 1, "bib_only": 0})
        self.assertEqual(routes["documents"]["tag-only"], 1)
        self.assertEqual(routes["all"]["tag-only"], 1)
        self.assertEqual(
            sum(routes["all"][r] for r in
                ("tag+text", "text>=2", "text=1", "tag-only")),
            len(self.g.scans))
        # Every scanned subset is present, plus the `all` roll-up.
        self.assertEqual(set(routes), set(SUBSET_FIELDS) | {"all"})

    def test_bibliography_only_hits_are_flagged_in_scholarship(self):
        """A cited title is not a statement — measured at 6/6 on the audit."""
        body = "Un chapitre d'histoire religieuse au Dahomey. " * 40
        end_matter = ("\nBibliographie\n"
                      "Koné, A. (1998). La voie africaine de la laïcité, "
                      "pp. 12-34.\n")
        cited = self.scan("references", OCR=body + end_matter)
        self.assertEqual(cited.membership_route, "text=1")
        self.assertTrue(cited.bib_only)

        # A hit in the argument itself is never bibliography-only, even
        # when the same reference list is present.
        argued = self.scan("references",
                           OCR="La laïcité y est débattue. " + body + end_matter)
        self.assertFalse(argued.bib_only)
        # Neither is a title hit, nor the curator's tag.
        self.assertFalse(self.scan("references", title="Laïcité",
                                   OCR=body + end_matter).bib_only)
        self.assertFalse(self.scan("references", subject="Laïcité",
                                   OCR=body + end_matter).bib_only)
        # Never computed outside the scholarly subset: press copy ends with
        # a date far too often for the tail rule to mean anything there.
        self.assertFalse(self.scan(OCR=body + end_matter).bib_only)

    def test_validation_worklist_carries_the_route(self):
        self.observe(title="Laïcité", pub_date="2020", OCR_is_public=False,
                     iwac_url="https://islam.zmo.de/s/westafrica/item/1")
        self.observe(**{"o:id": "2"}, title="Autre", OCR="Un texte.",
                     pub_date="2020", OCR_is_public=False)
        by_id = {r["id"]: r for r in self.g.validation_sample()}
        self.assertEqual(by_id["1"]["route"], "text=1")
        self.assertEqual(by_id["2"]["route"], "")

    def test_audit_screen_aggregates_the_ledger_over_the_current_scan(self):
        kept = self.scan(OCR="Laïcité.", subject="Laïcité")
        kept.o_id = "11"
        other = self.scan(OCR="Laïcité et laïcité.")
        other.o_id = "22"
        self.use(kept, other)
        ledger = {
            "rules": {"r2": {"tier": 2}, "r1": {"tier": 1}},
            "members": {
                # The stored route is deliberately stale: the aggregate
                # must read the route off the current scan instead.
                "articles:11": {"subset": "articles", "id": "11",
                                "route": "text=1", "relevant": "yes",
                                "judged_at": "2026-09-14",
                                "model": "claude-sonnet-5", "rule": "r2"},
                "articles:22": {"subset": "articles", "id": "22",
                                "route": "text>=2", "relevant": "no",
                                "judged_at": "2026-09-14",
                                "model": "claude-sonnet-5", "rule": "r2"},
                # No longer selected by the lexicon — simply not counted.
                "articles:99": {"subset": "articles", "id": "99",
                                "route": "text=1", "relevant": "yes",
                                "judged_at": "2026-09-14",
                                "model": "claude-sonnet-5", "rule": "r2"},
            },
            "occurrences": {},
        }
        with patch("laicite.overview.load_ledger", return_value=ledger):
            screen = self.g.build_metadata()["audit_screen"]
        self.assertEqual(screen["members_total"], 2)
        self.assertEqual(screen["members_judged"], 2)
        self.assertEqual(screen["relevant"], 1)
        self.assertEqual(screen["model"], "claude-sonnet-5")
        self.assertEqual(screen["judged_at"], "2026-09-14")
        self.assertEqual(screen["rule_version"], "r2")
        self.assertEqual(screen["by_route"]["tag+text"],
                         {"judged": 1, "relevant": 1})
        self.assertEqual(screen["by_route"]["text>=2"],
                         {"judged": 1, "relevant": 0})
        self.assertEqual(screen["by_route"]["text=1"],
                         {"judged": 0, "relevant": 0})
        self.assertEqual(screen["by_subset"]["articles"],
                         {"judged": 2, "relevant": 1})

    def test_audit_screen_survives_a_missing_ledger(self):
        self.use(self.scan(OCR="Laïcité."))
        with patch("laicite.overview.load_ledger",
                   return_value={"rules": {}, "members": {}, "occurrences": {}}):
            screen = self.g.build_metadata()["audit_screen"]
        self.assertEqual(screen["members_judged"], 0)
        self.assertEqual(screen["rule_version"], "")
        self.assertEqual(set(screen["by_route"]),
                         {"tag+text", "text>=2", "text=1", "tag-only"})

    # -- the October 2026 pipeline review --------------------------------

    def test_per_item_cap_gives_every_frame_a_line_first(self):
        """100 hits of one frame must not crowd out three minority frames."""
        items = ["laicite"] * 100 + ["ecole"] * 3 + ["droit-famille"] * 2 + ["separation"]
        sample = self.g._sample_every_stratum(items, 6, key=lambda x: x)
        self.assertEqual(len(sample), 6)
        self.assertEqual(set(sample), {"laicite", "ecole", "droit-famille", "separation"})
        # The two spare slots follow the population: both to the big frame.
        self.assertEqual(sample.count("laicite"), 3)
        # More frames than slots: six distinct frames, one line each.
        many = [f"f{i}" for i in range(8) for _ in range(5)]
        self.assertEqual(len(set(self.g._sample_every_stratum(many, 6, key=lambda x: x))), 6)
        # The subset-level sampler stays proportional: a thin stratum may
        # legitimately get nothing there.
        proportional = self.g._sample_across(items, 6, key=lambda x: x)
        self.assertEqual(proportional.count("laicite"), 6)

    def test_concordance_keeps_a_minority_frame_inside_a_long_item(self):
        text = "La laïcité. " * 30 + "La séparation de l'État."
        self.use(self.scan(OCR=text))
        _, bundles = self.g.build_concordance()
        frames = [r["f"] for r in bundles["articles"]["rows"]]
        self.assertEqual(len(frames), 6)   # PER_ITEM_SNIPPET_CAP["articles"]
        self.assertIn("separation", frames)

    def test_near_core_boundary_is_exactly_eighty_tokens(self):
        """Measured between the first tokens of the two matches."""
        at = self.scan(OCR="Laïcité " + "mot " * 79 + "divorce.")
        past = self.scan(OCR="Laïcité " + "mot " * 80 + "divorce.")
        divorce = next(o for o in at.occurrences if o.frame == "droit-famille")
        self.assertTrue(divorce.near_core)
        self.assertEqual(at.nearby_frame_counts, {"droit-famille": 1})
        self.assertFalse(next(o for o in past.occurrences
                              if o.frame == "droit-famille").near_core)
        self.assertEqual(past.nearby_frame_counts, {})
        # The arenas view counts by the same flag and says which window.
        self.use(self.scan(OCR="Laïcité " + "mot " * 79 + "divorce.", pub_date="2020"),
                 self.scan(OCR="Laïcité " + "mot " * 80 + "divorce.", pub_date="2020"))
        arenas = self.g.build_arenas()
        self.assertEqual(arenas["context_window"], 80)
        self.assertEqual(arenas["global"]["droit-famille"], [1])
        self.assertEqual(arenas["global_totals"], [2])

    def test_a_row_without_a_country_is_excluded_from_matched_strata(self):
        self.g._sentiment_cols = {"test": {"polarite": "rating"}}
        self.observe(**{"o:id": "1"}, title="Laïcité", country="Bénin",
                     newspaper="A", pub_date="2020", rating="Négatif")
        self.observe(**{"o:id": "2"}, title="Autre", country="Bénin",
                     newspaper="A", pub_date="2020", rating="Neutre")
        # No country: not matched in an ("Unknown",) stratum of its own, and
        # its control twin likewise contributes nothing.
        self.observe(**{"o:id": "3"}, title="Laïcité", newspaper="A",
                     pub_date="2020", rating="Positif")
        self.observe(**{"o:id": "4"}, title="Autre", newspaper="A",
                     pub_date="2020", rating="Positif")
        self.assertEqual([r["countries"] for r in self.g.source_records],
                         [["Bénin"], ["Bénin"], [], []])
        result = self.g._matched_sentiment("test")["polarite"]
        self.assertEqual(result["eligible"], 2)
        self.assertEqual(result["matched"], 1)
        self.assertEqual(result["dossier"], {"Négatif": 1})
        self.assertEqual(result["weighted_controls"], {"Neutre": 1.0})
        self.assertNotIn("Unknown", {c["country"] for c in self.g.build_research()["cells"]})

    def test_row_metadata_is_parsed_once_with_one_set_of_rules(self):
        meta = self.g._row_meta({
            "o:id": "7", "country": float("nan"), "hijri_month": 13,
            "author": "Ali | Ali | Awa", "language": "Français | Anglais",
            "iwac_url": "https://islam.zmo.de/s/westafrica/item/7",
            "newspaper": float("nan"), "OCR_is_public": float("nan"),
        })
        self.assertEqual(meta.countries, [])
        self.assertIsNone(meta.hijri_month)
        self.assertEqual(meta.authors, ["Ali", "Awa"])
        self.assertEqual(meta.languages, ["Français", "Anglais"])
        self.assertEqual(meta.newspaper, "")
        self.assertFalse(meta.ocr_public)
        self.assertEqual(self.g._row_meta({"hijri_month": 9.0}).hijri_month, 9)

    def test_missing_rights_flag_fails_closed(self):
        """NaN used to read as public through bool(); it must withhold."""
        import numpy as np
        rec = self.scan(title="Laïcité", OCR="Laïcité et liberté religieuse.",
                        OCR_is_public=float("nan"))
        self.assertFalse(rec.ocr_public)
        self.use(rec)
        _, bundles = self.g.build_concordance()
        self.assertEqual({r["d"] for r in bundles["articles"]["rows"]}, {"title"})
        self.assertTrue(self.scan(OCR="Laïcité.", OCR_is_public=np.bool_(True)).ocr_public)
        self.observe(OCR="Laïcité.", OCR_is_public=np.bool_(True))
        self.assertTrue(self.g.source_records[-1]["public_fulltext"])

    def test_broad_hits_come_from_the_scan_and_precede_disambiguation(self):
        scanned = self.observe(OCR="De simples laïcs et la laïcité.")
        self.assertEqual(scanned.broad_hits["OCR"], 2)
        record = self.g.source_records[-1]
        self.assertEqual((record["fulltext_hits"], record["broad_fulltext_hits"]), (1, 2))
        laity = self.observe(**{"o:id": "2"}, OCR="De simples laïcs.")
        self.assertIsNone(laity.rec)
        self.assertEqual(self.g.source_records[-1]["broad_fulltext_hits"], 1)

    def test_fold_preserving_matches_the_per_character_original(self):
        import unicodedata
        from laicite.lexicon import fold_preserving

        def original(text):
            out = []
            for ch in text:
                if ch in "’‘ʼ":
                    ch = "'"
                decomposed = unicodedata.normalize("NFD", ch)
                out.append((decomposed[0] if decomposed else ch).lower())
            return "".join(out)

        text = ("L’État LAÏQUE, lʼÉcole « laïcité » — Œuvre, cœur, naïve, "
                "ÉLÈVES À l’ÉCOLE FRANCO-ARABE, été, İ, ß, ﬁn, ½, "
                "‘citation’")
        self.assertEqual(fold_preserving(text), original(text))
        self.assertEqual(len(fold_preserving(text)), len(text))

    def test_research_cells_are_built_once_and_shipped_in_trends(self):
        self.use(self.scan(OCR="Laïcité", pub_date="2020"))
        research = self.g.build_research()
        self.assertIs(self.g.build_research(), research)
        self.assertIs(self.g.build_trends()["research"], research)

    def test_an_empty_dossier_is_scanned_only_once(self):
        empty = pd.DataFrame({"o:id": ["1"], "title": ["Autre"], "OCR": ["Un texte."],
                              "OCR_is_public": [True], "source_type": ["youtube"]})
        with patch("laicite.scan.load_dataset_safe", return_value=empty) as load:
            self.assertEqual(self.g.scan_all(), [])
            self.g.scan_all()
        self.assertEqual(load.call_count, len(SUBSET_FIELDS))
        self.assertEqual(len(self.g.source_records), len(SUBSET_FIELDS))

    def test_dropped_extra_fields_stay_dropped(self):
        ref = self.scan("references", OCR="Laïcité.", abstract="Un résumé.",
                        language="Anglais")
        self.assertEqual(set(ref.extra), {"author", "resource_class", "languages"})
        video = self.scan("audiovisual", title="Laïcité", URL="https://youtu.be/x")
        self.assertEqual(set(video.extra), {"languages"})

    def test_byline_share_cannot_exceed_one(self):
        """A byline repeated inside one record counts once on both sides."""
        self.observe(OCR="Laïcité.", author="Awa | Awa")
        self.observe(**{"o:id": "2"}, OCR="Autre chose.", author="Awa")
        self.g.min_byline_items = 1
        top = self.g.build_bylines()["top"]
        self.assertEqual(top, [dict(top[0], count=1, corpus_articles=2, dossier_share=0.5)])

    def test_collocates_are_sliced_per_single_language(self):
        self.g._entities = set()
        self.g.min_collocate_count = 2
        self.g.min_document_frequency = 2
        filler = " ".join(["commerce marche cuisine football"] * 15)
        docs = [("Français", "Laïcité citoyenneté démocratie. ")] * 4 + [
            ("Anglais | Français", "Laïcité citoyenneté démocratie. "),
            ("Anglais", "Secularism shapes politics. "),
            ("", "Laïcité citoyenneté démocratie. "),
        ]
        self.use(*[self.scan(**{"o:id": str(i)}, OCR=lead + filler, language=lang)
                   for i, (lang, lead) in enumerate(docs)])
        by_language = self.g.build_collocates()["by_language"]
        # One key per language, never a label combination; the English
        # slice has nothing that clears the floors, so it is not shipped
        # as an empty list.
        self.assertEqual(set(by_language), {"Français"})
        # The bilingual item counts in the French slice too.
        democratie = next(e for e in by_language["Français"] if e["token"] == "democratie")
        self.assertEqual(democratie["documents"], 5)

    def test_reuse_evidence_compares_two_public_texts(self):
        text = "Le communiqué du ministère sur la laïcité est repris mot pour mot."
        a = self.scan(title="Laïcité", OCR=text)
        b = self.scan(**{"o:id": "2"}, title="Laïcité", OCR=text + " Fin.")
        check = self.g._reuse_evidence(a, b)
        self.assertEqual(check["status"], "compared")
        self.assertEqual(check["excerpt_a"], text)
        self.assertGreater(check["sequence_ratio"], 0.9)
        self.assertGreater(check["fivegram_jaccard"], 0.8)
        untexted = self.scan(**{"o:id": "3"}, title="Laïcité")
        self.assertEqual(self.g._reuse_evidence(a, untexted), {"status": "missing"})

    def test_circulation_compares_texts_only_for_listed_pairs(self):
        import numpy as np
        scans = [self.scan(**{"o:id": str(i)}, title="Laïcité", OCR="Laïcité.",
                           newspaper=f"Journal {i}", pub_date="2020")
                 for i in range(3)]
        self.g._member_vectors = (np.ones((3, 4), dtype=np.float32) / 2.0, scans)
        with patch("laicite.circulation.CIRCULATION_MAX_LISTED", 1), \
                patch.object(self.g, "_reuse_evidence",
                             return_value={"status": "compared"}) as check:
            bundle = self.g.build_circulation()
        self.assertEqual(bundle["total_pairs"], 3)
        self.assertEqual(bundle["listed"], 1)
        self.assertEqual(check.call_count, 1)
        self.assertEqual(bundle["pairs"][0]["text_check"], {"status": "compared"})
        self.assertNotIn("_scans", bundle["pairs"][0])
        self.assertEqual(bundle["reprinted_items"], 3)


if __name__ == "__main__":
    unittest.main()
