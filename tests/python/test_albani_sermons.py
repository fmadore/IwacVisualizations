"""The Albani Zaria sermons generator (issue #31): parser, folding, layers,
lexicon, corpus scope and the rights boundary.

``tests/fixtures/albani/current-format.txt`` is built from sentences of item
15889 (*Ziyarar 'Yan Uwa Daga Gombe*, a public transcript) set in a two-part
frame, so one small file exercises every shape the current markup has: the
part banners, numbered windows ending in ``–end``, a short part with no
segment header, ``[Speaker unknown]`` and a two-voice exchange.
``legacy-format.txt`` is the opening of 15878 (*Shari'a*), still in the older
format the parser must refuse.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from albani import normalize as N  # noqa: E402
from albani import layers as L  # noqa: E402
from albani.corpus import (  # noqa: E402
    ANALYSED, EXCHANGE, LEGACY, MONOLOGUE, UNTRANSCRIBED, is_albani,
)
from albani.generator import GLOSSES_PATH, AlbaniSermonsGenerator, RightsError, load_glosses  # noqa: E402
from albani.lexicon import Lexicon  # noqa: E402
from albani.transcript import (  # noqa: E402
    LegacyTranscriptError, TranscriptFormatError, parse_transcript, window_label,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "albani"
CURRENT = (FIXTURES / "current-format.txt").read_text(encoding="utf-8")
LEGACY_TEXT = (FIXTURES / "legacy-format.txt").read_text(encoding="utf-8")
CREATOR = "Muhammad Auwal Albani Zaria"


def frame(*rows):
    base = {"o:id": "1", "title": "T", "iwac_url": "https://x/item/1",
            "source_type": "deposited", "creator": CREATOR, "pub_date": "",
            "extent": "", "duration_seconds": 1200, "language": "Haoussa|Arabe",
            "subject": "", "OCR": "", "OCR_is_public": True,
            "iiif_manifest": "", "is_part_of": ""}
    return pd.DataFrame([{**base, **row} for row in rows])


def generator(df, **kw):
    tmp = tempfile.TemporaryDirectory()
    gen = AlbaniSermonsGenerator(Path(tmp.name), frame=df, fetch_manifests=False, **kw)
    gen._tmp = tmp
    return gen


class ParserTests(unittest.TestCase):
    def test_parses_every_shape_of_the_current_format(self):
        tr = parse_transcript(CURRENT)
        self.assertEqual(tr.parts, 2)
        shapes = [(s.part, s.ordinal, s.index, s.total, s.start_seconds, s.end_seconds,
                   s.explicit) for s in tr.segments]
        self.assertEqual(shapes, [
            (1, 1, 1, 2, 0, 1200, True),
            (1, 1, 2, 2, 1200, None, True),
            # Part 2 is shorter than a window: one implicit 1/1 segment.
            (2, 2, 1, 1, 0, None, False),
        ])
        self.assertEqual([t.speaker for t in tr.segments[1].turns], ["spk:0", "spk:1", "spk:0"])
        self.assertEqual([t.speaker for t in tr.segments[2].turns], ["spk:0", "unknown"])

    def test_turn_offsets_cut_the_original_text_and_never_the_markup(self):
        tr = parse_transcript(CURRENT)
        for _, turn in tr.turns():
            text = CURRENT[turn.start:turn.end]
            self.assertTrue(text.strip())
            self.assertNotIn("[Speaker", text)
            self.assertNotIn("[Segment", text)
            self.assertNotIn("=====", text)
        self.assertEqual(CURRENT[tr.segments[1].turns[1].start:tr.segments[1].turns[1].end],
                         "Na'am.")

    def test_a_single_file_transcript_needs_no_part_header(self):
        text = "[Segment 1/1 | 00:00:00–end]\n[Speaker seg1-spk:0]\nmatasa sun zo\n"
        tr = parse_transcript(text)
        self.assertEqual((tr.parts, len(tr.segments), tr.segments[0].part), (1, 1, 1))

    def test_part_numbers_need_only_increase(self):
        # 15857's four videos are Parts 4, 7, 8, 9.
        bar = "=" * 60
        text = "\n".join([bar, "[Part 4]", bar, "[Speaker spk:0]", "a",
                          bar, "[Part 7]", bar, "[Speaker spk:0]", "b"])
        tr = parse_transcript(text)
        self.assertEqual([(s.part, s.ordinal) for s in tr.segments], [(4, 1), (7, 2)])
        with self.assertRaises(TranscriptFormatError):
            parse_transcript(text.replace("[Part 7]", "[Part 3]"))

    def test_the_legacy_format_is_refused_by_name(self):
        with self.assertRaises(LegacyTranscriptError):
            parse_transcript(LEGACY_TEXT)
        # Any one legacy marker is enough, even inside a current-looking file.
        with self.assertRaises(LegacyTranscriptError):
            parse_transcript(CURRENT + "\n[00:00:18] Speaker 1: Ya ayyuha\n")

    def test_an_elision_mark_alone_on_its_line_is_text(self):
        for mark in ("[…]", "[...]"):
            with self.subTest(mark):
                text = CURRENT.replace("[Speaker seg1-spk:0]\n",
                                       "[Speaker seg1-spk:0]\n" + mark + "\n", 1)
                self.assertNotEqual(text, CURRENT)
                parse_transcript(text)

    def test_anything_else_fails_loudly(self):
        broken = {
            "unknown marker": CURRENT.replace("[Speaker seg1-spk:0]", "[Narrator]"),
            "text before a turn": "matasa\n" + CURRENT,
            "segment gap": CURRENT.replace("[Segment 2/2 | 00:20:00–end]",
                                           "[Segment 2/2 | 00:40:00–end]"),
            "wrong segment speaker": CURRENT.replace("[Speaker seg2-spk:1]",
                                                     "[Speaker seg1-spk:1]"),
            "missing final window": CURRENT.replace("[Segment 2/2 | 00:20:00–end]",
                                                    "[Segment 2/3 | 00:20:00–00:40:00]"),
            "hyphen for en dash": CURRENT.replace("00:00:00–00:20:00", "00:00:00-00:20:00"),
            "stray banner": CURRENT.replace("[Speaker unknown]", "=" * 60 + "\n[Speaker unknown]"),
            "empty": "   \n",
        }
        for why, text in broken.items():
            with self.subTest(why), self.assertRaises(TranscriptFormatError) as ctx:
                parse_transcript(text)
            self.assertNotIsInstance(ctx.exception, LegacyTranscriptError)

    def test_a_window_is_labelled_as_a_window(self):
        tr = parse_transcript(CURRENT)
        self.assertEqual([window_label(s) for s in tr.segments],
                         ["00:00–00:20", "00:20–end", "00:00–end"])

    def test_ten_minute_windows_are_joined_into_twenty_minute_segments(self):
        # Part 4 of 15878 (the November 2026 re-transcription) is cut every
        # ten minutes; the block counts and links 20-minute segments.
        text = "\n".join(
            "[Segment {i}/5 | {s}–{e}]\n[Speaker seg{i}-spk:0]\nmatasa {i}".format(
                i=i, s="00:{:02d}:00".format((i - 1) * 10) if i < 7 else "01:00:00",
                e="00:{:02d}:00".format(i * 10) if i < 5 else "end")
            for i in range(1, 6))
        tr = parse_transcript(text)
        self.assertEqual([window_label(s) for s in tr.segments],
                         ["00:00–00:20", "00:20–00:40", "00:40–end"])
        self.assertEqual([(s.index, s.total) for s in tr.segments], [(1, 3), (2, 3), (3, 3)])
        self.assertEqual([text[t.start:t.end] for t in tr.segments[0].turns],
                         ["matasa 1", "matasa 2"])
        # Ten minutes is the only other window: a part keeps the one it opens with.
        with self.assertRaises(TranscriptFormatError):
            parse_transcript(text.replace("[Segment 2/5 | 00:10:00–00:20:00]",
                                          "[Segment 2/5 | 00:10:00–00:30:00]"))
        with self.assertRaises(TranscriptFormatError):
            parse_transcript(CURRENT.replace("00:00:00–00:20:00", "00:00:00–00:15:00"))


class NormalizeTests(unittest.TestCase):
    def test_fold_unhooks_and_unifies_apostrophes(self):
        self.assertEqual(N.fold("Ɗalibai"), "dalibai")
        self.assertEqual(N.fold("ƙasa"), "kasa")
        self.assertEqual(N.fold("ƴan"), "'yan")
        self.assertEqual(N.fold("Shari’ah"), "shari'ah")
        self.assertEqual(N.fold("ḥadīth"), "hadith")
        self.assertEqual(N.fold("“matasa”"), "matasa")
        self.assertEqual(N.fold("'Dimokuradiyya'"), "dimokuradiyya")

    def test_match_key_merges_spelling_variants_but_not_apostrophe_pairs(self):
        self.assertEqual(N.match_key("qur'ani"), N.match_key("kur'ani"))
        self.assertEqual(N.match_key("tarbiyya"), N.match_key("tarbiya"))
        self.assertEqual(N.match_key("shari'ah"), N.match_key("shari'a"))
        # 'ya'ya (offspring) is not yaya (how).
        self.assertNotEqual(N.match_key("'ya'ya"), N.match_key("yaya"))
        # Protected geminate minimal pairs: Makka (Mecca) is not stopword maka,
        # Arabic haqqa is not Hausa haka, babba ("big") is not baba ("father").
        self.assertNotEqual(N.match_key("makka"), N.match_key("maka"))
        self.assertNotEqual(N.match_key("makkah"), N.match_key("maka"))
        self.assertNotEqual(N.match_key("haqqa"), N.match_key("haka"))
        self.assertNotEqual(N.match_key("babba"), N.match_key("baba"))

    def test_tokens_keep_offsets_into_the_original(self):
        text = "Ɗaliban makarantar — 'yan mata [inaudible] sun zo."
        toks = N.tokenize(text)
        self.assertEqual([t.surface for t in toks],
                         ["daliban", "makarantar", "'yan", "mata", "sun", "zo"])
        for tok in toks:
            self.assertEqual(N.fold(text[tok.start:tok.end]), tok.surface)

    def test_the_join_rule_merges_split_forms(self):
        joined = N.tokenize("su kan su")
        self.assertEqual([t.surface for t in joined], ["su", "kansu"])
        self.assertEqual(joined[1].key, N.tokenize("kansu")[0].key)

    def test_surface_table_shows_the_commonest_spelling(self):
        table = N.SurfaceTable()
        table.add(N.tokenize("tarbiyya tarbiyya tarbiya"))
        self.assertEqual(table.display(N.match_key("tarbiya")), "tarbiyya")


class LayerTests(unittest.TestCase):
    def labels(self, text):
        return L.label_tokens(N.tokenize(text))

    def test_a_formula_is_one_unit(self):
        labels = self.labels("Annabi sallallahu alaihi wa sallam ya ce")
        self.assertEqual(labels, ["ha"] + ["fx:salawat"] * 4 + ["ha", "ha"])

    def test_a_recited_verse_is_arabic_and_the_hausa_around_it_is_not(self):
        text = ("sai yace ya ayyuhallazina amanuttaqullaha haqqa tuqatihi wa la "
                "tamutunna illa wa antum muslimun to wannan shine abin da yake nufi")
        labels = self.labels(text)
        words = [t.surface for t in N.tokenize(text)]
        arabic = [w for w, lab in zip(words, labels) if lab == "ar"]
        self.assertIn("tuqatihi", arabic)
        self.assertIn("muslimun", arabic)
        for hausa in ("sai", "wannan", "shine", "nufi"):
            self.assertEqual(labels[words.index(hausa)], "ha", hausa)

    def test_arabic_loans_in_hausa_sentences_stay_hausa(self):
        labels = self.labels("Malam ya yi da'awa akan addini da shari'a a cikin ilimi")
        self.assertEqual(set(labels), {"ha"})

    def test_english_segments_are_spotted_without_hausa_homographs(self):
        english = N.tokenize("we thank you for this and we pray that the people of Ghana are safe")
        hausa = N.tokenize("to in an so a cikin wannan magana mun gode da zuwan ku")
        self.assertTrue(L.is_english(english))
        self.assertFalse(L.is_english(hausa))

    def test_english_code_switching_is_never_classified_as_arabic(self):
        labels = self.labels("sai ya ce the secret of thinktwice with that people")
        self.assertNotIn("ar", labels)

    def test_shared_stopwords_are_neutral_in_the_layer_classifier(self):
        res = L.resources()
        overlap = res.hausa_cues & res.arabic_cues
        self.assertEqual(overlap, set())


class LexiconTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = Lexicon.load()

    def test_the_published_stopword_list_stays_verbatim_and_loaded(self):
        # Bashir, Bichi & Adamu (2024), Table 3: corpus-specific additions go
        # in `hausa`, never into the published list.
        import json
        data = json.loads(L.RESOURCES_PATH.read_text(encoding="utf-8"))
        published = data["hausa_bashir_2024"]
        self.assertEqual((len(published), len(set(published))), (76, 76))
        res = L.resources()
        for word in published:
            self.assertIn(N.match_key(N.fold(word)), res.hausa_stop, word)

    def test_no_stopword_removes_research_vocabulary(self):
        res = L.resources()
        overlap = self.lex.single_word_keys() & (res.hausa_stop | res.arabic_stop)
        self.assertEqual(overlap, set())

    def test_every_entry_is_well_formed(self):
        for entry in self.lex.entries:
            with self.subTest(entry.id):
                self.assertTrue(entry.variants)
                self.assertTrue(entry.gloss_en and entry.gloss_fr)
                self.assertIn(entry.layer, ("ha", "ar"))
        self.assertEqual(self.lex.status, "seed")

    def hits(self, text):
        tokens = N.tokenize(text)
        hits, excluded = self.lex.match(tokens)
        return [h.entry.id for h in hits], [h.entry.id for h in excluded]

    def test_the_longest_variant_wins_inside_a_category(self):
        hits, _ = self.hits("'yan siyasa da siyasa")
        self.assertEqual(hits, ["yan_siyasa", "siyasa"])

    def test_the_divine_epithet_is_not_the_emir(self):
        hits, excluded = self.hits("Allah Maɗaukakin Sarki ya taimaki sarkin Zazzau")
        self.assertEqual(hits, ["sarki"])
        self.assertEqual(excluded, ["sarki"])
        hits, excluded = self.hits("Allah Madaukakin Sarki")
        self.assertEqual((hits, excluded), ([], ["sarki"]))
        # ASR-split epithet and tsarki ("ritual purity") mis-transcription.
        for phrase in ("Allah ma daukakin sarki", "Allah madaukin sarki", "cikakken sarki"):
            with self.subTest(phrase=phrase):
                self.assertEqual(self.hits(phrase), ([], ["sarki"]))

    def test_exclude_after_drops_boko_haram_and_kwaya_daya(self):
        self.assertEqual(self.hits("akidar boko haram da makarantar boko"),
                         (["makaranta", "boko"], ["boko"]))
        self.assertEqual(self.hits("hadisi ƙwaya ɗaya da sha ƙwaya"),
                         (["kwaya"], ["kwaya"]))

    def test_spoken_hausa_variants_match_their_entries(self):
        hits, _ = self.hits("ilmi da shuwagabanni a makarantan nan")
        self.assertEqual(hits, ["ilimi", "shugaba", "makaranta"])

    def test_hausa_entries_do_not_match_inside_arabic_citations(self):
        tokens = N.tokenize(
            "li annal haqqa wahid wa maza ba'dal haqqi illad dalal wa antum muslimun")
        labels = L.label_tokens(tokens)
        hits, _ = self.lex.match(tokens, layers=labels)
        self.assertNotIn("hakki", [h.entry.id for h in hits])

    def test_hooked_and_unhooked_spellings_both_match(self):
        self.assertEqual(self.hits("ɗalibai dalibai")[0], ["dalibai", "dalibai"])
        self.assertEqual(self.hits("zaɓe zabe")[0], ["zabe", "zabe"])

    def test_ambiguous_entries_stay_out_of_pooled_statistics(self):
        by_id = self.lex.by_id()
        for eid in ("kasa", "kwaya", "jamiyya"):
            self.assertFalse(by_id[eid].pooled, eid)
        self.assertTrue(by_id["matasa"].pooled)

    def test_a_formula_word_cannot_start_a_match(self):
        tokens = N.tokenize("matasa")
        hits, _ = self.lex.match(tokens, [True])
        self.assertEqual(hits, [])


class CorpusTests(unittest.TestCase):
    def test_scope_is_a_pipe_split_creator_on_deposited_items(self):
        self.assertTrue(is_albani({"source_type": "deposited", "creator": CREATOR}))
        self.assertTrue(is_albani({"source_type": "deposited",
                                   "creator": CREATOR + "|Imam Kabir Kotono"}))
        self.assertFalse(is_albani({"source_type": "youtube", "creator": CREATOR}))
        self.assertFalse(is_albani({"source_type": "deposited",
                                    "creator": "Friends of " + CREATOR}))

    def test_each_recording_gets_one_status(self):
        gen = generator(frame(
            {"o:id": "1", "OCR": CURRENT},
            {"o:id": "2", "OCR": LEGACY_TEXT},
            {"o:id": "3", "OCR": ""},
            {"o:id": "4", "OCR": CURRENT, "creator": "Someone else"},
        ))
        self.assertEqual({r.o_id: r.status for r in gen.load()},
                         {"1": ANALYSED, "2": LEGACY, "3": UNTRANSCRIBED})

    def test_an_unreadable_transcript_stops_the_run(self):
        gen = generator(frame({"o:id": "9", "OCR": "[Narrator]\nmatasa\n"}))
        with self.assertRaises(TranscriptFormatError) as ctx:
            gen.load()
        self.assertIn("item 9", str(ctx.exception))

    def test_exchange_segments_are_kept_separable(self):
        talk = " ".join(["matasa sun zo wurin malam"] * 6)
        text = "\n".join([
            "[Segment 1/2 | 00:00:00–00:20:00]", "[Speaker seg1-spk:0]", talk,
            "[Segment 2/2 | 00:20:00–end]",
            "[Speaker seg2-spk:0]", talk, "[Speaker seg2-spk:1]", talk,
            "[Speaker seg2-spk:0]", talk,
        ])
        gen = generator(frame({"o:id": "1", "OCR": text}))
        rec = gen.load()[0]
        self.assertEqual([s.mode for s in rec.segments], [MONOLOGUE, EXCHANGE])
        lex = gen.build_lexicon()
        matasa = next(e for e in lex["entries"] if e["id"] == "matasa")
        self.assertEqual(matasa["n"], {"all": 24, MONOLOGUE: 6})

    def test_the_score_has_one_cell_per_segment_in_scope(self):
        talk = " ".join(["matasa sun zo wurin malam"] * 6)
        text = "\n".join([
            "[Segment 1/2 | 00:00:00–00:20:00]", "[Speaker seg1-spk:0]", talk,
            "[Segment 2/2 | 00:20:00–end]",
            "[Speaker seg2-spk:0]", talk, "[Speaker seg2-spk:1]", talk,
            "[Speaker seg2-spk:0]", talk,
        ])
        gen = generator(frame({"o:id": "1", "OCR": text}))
        scopes = gen.build_overlap()["scopes"]
        cells = scopes["all"]["grid"]
        self.assertEqual([(c["k"], c["md"], c["y"]) for c in cells],
                         [(0, MONOLOGUE, 6), (1, EXCHANGE, 18)])
        self.assertEqual(cells[1]["s"], 1200)
        self.assertIsNone(cells[1]["e"])
        # The exchange segment leaves the monologue score, by position.
        self.assertEqual([c["k"] for c in scopes[MONOLOGUE]["grid"]], [0])

    def test_every_gloss_is_complete_and_folds_to_one_key(self):
        raw = json.loads(GLOSSES_PATH.read_text(encoding="utf-8"))["entries"]
        for word, gloss in raw.items():
            with self.subTest(word=word):
                self.assertTrue(gloss["en"].strip() and gloss["fr"].strip())
        status, glosses = load_glosses()
        self.assertEqual(status, "draft")
        # Spelling variants share an entry: addini and adini fold together.
        self.assertIn(N.match_key("addini"), glosses)
        self.assertEqual(glosses[N.match_key("adini")]["fr"], "religion")
        # Hooked keys fold through fold() as well as match_key().
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "glosses.json"
            p.write_text(json.dumps({"status": "draft", "entries": {
                "Ɗalibai": {"en": "students", "fr": "étudiants"},
            }}), encoding="utf-8")
            _, loaded = load_glosses(p)
            self.assertIn(N.match_key(N.fold("ɗalibai")), loaded)

    def test_overlapping_cross_category_hits_count_once_and_do_not_self_link(self):
        # Each occurrence sits in its own turn so the only pair within the
        # window is the overlapping "tsarin mulki" / "mulki" span itself.
        text = "\n".join(
            ["[Segment 1/1 | 00:00:00–end]"]
            + ["[Speaker seg1-spk:0]\ntsarin mulki na gaskiya"] * 6
        )
        gen = generator(frame({"o:id": "1", "OCR": text}))
        lex = gen.build_lexicon()
        # Six occurrences of "tsarin mulki" trigger both constitution and rule,
        # yet the theme total counts each span once, not twelve times.
        self.assertEqual(lex["by_recording"]["all"][0]["themes"]["politics"], 6)
        net = gen.build_network()
        links = {(l["source"], l["target"]) for l in net["scopes"]["all"]["politics"]["links"]}
        self.assertNotIn(("e:mulki", "e:tsarin_mulki"), links)
        self.assertNotIn(("e:tsarin_mulki", "e:mulki"), links)

    def test_concordance_excludes_english_segments(self):
        gen = generator(frame({"o:id": "1", "OCR": CURRENT, "language": "Anglais"}))
        conc = gen.build_concordance("youth")
        self.assertEqual((conc["items"], conc["rows"], conc["counts"]), ([], [], {}))

    def test_entities_count_once_per_span_and_never_on_the_merged_key(self):
        entities = {"status": "draft", "entities": [
            {"id": "mecca", "type": "place", "group": "holy", "label_en": "Mecca",
             "label_fr": "La Mecque", "aliases": ["makka"], "lat": 21.4, "lon": 39.8},
            {"id": "daurawa", "type": "person", "group": "nigeria", "label_en": "Aminu Daurawa",
             "label_fr": "Aminu Daurawa", "aliases": ["aminu daurawa", "malam aminu daurawa"]},
            {"id": "pdp", "type": "org", "group": "state", "label_en": "PDP", "label_fr": "PDP",
             "full_en": "Peoples Democratic Party", "full_fr": "Parti démocratique populaire",
             "aliases": ["pdp"]},
        ]}
        text = "\n".join([
            "[Segment 1/1 | 00:00:00–end]", "[Speaker seg1-spk:0]",
            # "maka" (for you) shares Makka's merged key and must not count.
            "Na faɗa maka cewa malam Aminu Daurawa ya je Makka, Aminu Daurawa kuma, ba PDP ba.",
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "entities.json"
            path.write_text(json.dumps(entities), encoding="utf-8")
            with patch("albani.generator.ENTITIES_PATH", path):
                out = generator(frame({"o:id": "1", "OCR": text})).build_entities()
        rows = {e["id"]: e for e in out["entities"]}
        self.assertEqual(rows["mecca"]["n"]["all"], 1)
        self.assertEqual(rows["daurawa"]["n"]["all"], 2)
        self.assertEqual(rows["daurawa"]["top"][0]["s"], 0)
        self.assertNotIn("aliases", rows["mecca"])
        # An acronym travels with its expansion; a plain name has none.
        self.assertEqual(rows["pdp"]["full_fr"], "Parti démocratique populaire")
        self.assertNotIn("full_en", rows["mecca"])

    def test_every_curated_entity_is_well_formed(self):
        from albani.generator import ENTITIES_PATH
        data = json.loads(ENTITIES_PATH.read_text(encoding="utf-8"))
        ids = [e["id"] for e in data["entities"]]
        self.assertEqual(len(ids), len(set(ids)))
        for e in data["entities"]:
            with self.subTest(e["id"]):
                self.assertIn(e["type"], ("person", "place", "org"))
                self.assertTrue(e["label_en"] and e["label_fr"] and e["aliases"])
                if "lat" in e:
                    self.assertTrue(-90 <= e["lat"] <= 90 and -180 <= e["lon"] <= 180)
                # An acronym is spelled out in both languages or not at all.
                self.assertEqual("full_en" in e, "full_fr" in e)
                if "full_en" in e:
                    self.assertTrue(e["full_en"] and e["full_fr"])

    def test_formula_counts_split_by_recording(self):
        gen = generator(frame({"o:id": "1", "OCR": CURRENT}, {"o:id": "2", "OCR": CURRENT}))
        for f in gen.build_vocabulary()["scopes"]["all"]["formulae"]:
            self.assertEqual(sum(f["by"].values()), f["n"])
            self.assertEqual(len(f["by"]), f["r"])

    def test_an_english_recording_is_listed_but_not_counted(self):
        gen = generator(frame({"o:id": "1", "OCR": CURRENT, "language": "Anglais"}))
        meta = gen.build_metadata()
        self.assertEqual(meta["recordings"][0]["en"], 3)
        self.assertEqual(meta["totals"]["words"], 0)


class RightsTests(unittest.TestCase):
    def build(self, public):
        gen = generator(frame({"o:id": "1", "OCR": CURRENT, "OCR_is_public": public}))
        return gen, gen.build_all()

    def test_private_transcripts_feed_aggregates_but_never_the_concordance(self):
        gen, bundles = self.build(public=False)
        for theme in ("youth", "politics"):
            conc = bundles[f"concordance-{theme}.json"]
            self.assertEqual((conc["items"], conc["rows"]), ([], []))
        matasa = next(e for e in bundles["lexicon.json"]["entries"] if e["id"] == "matasa")
        self.assertEqual(matasa["n"]["all"], 1)
        self.assertEqual(bundles["concordance-youth.json"]["counts"]["matasa"]["withheld"], 1)
        gen.check_rights(bundles)   # the real payloads pass

    def test_public_transcripts_are_quoted_with_their_window(self):
        _, bundles = self.build(public=True)
        rows = bundles["concordance-politics.json"]["rows"]
        sarki = [r for r in rows if r["e"] == "sarki"]
        # Sarkin Zazzau, in the short second part — never the divine epithet.
        self.assertEqual(len(sarki), 1)
        self.assertEqual((sarki[0]["p"], sarki[0]["w"], sarki[0]["s"]), (2, 1, 0))
        self.assertNotIn("x", sarki[0])
        # The match is its own element: the spaces either side of it are the
        # only thing keeping "zo. Sarkin Zazzau" from reading "zo.SarkinZazzau".
        self.assertEqual((sarki[0]["l"][-1], sarki[0]["m"], sarki[0]["r"][0]), (" ", "Sarkin", " "))
        for row in rows:
            self.assertEqual(row["l"], row["l"].lstrip())
            self.assertEqual(row["r"], row["r"].rstrip())

    def test_the_guard_refuses_a_private_phrase_in_an_aggregate(self):
        gen, bundles = self.build(public=False)
        bundles["vocabulary.json"]["leak"] = "kuna kallon mu da sauraron mu"
        with self.assertRaises(RightsError):
            gen.check_rights(bundles)
        bundles["vocabulary.json"]["leak"] = "kallon mu da"   # three words: allowed
        gen.check_rights(bundles)

    def test_the_guard_refuses_a_private_item_in_a_concordance(self):
        gen, bundles = self.build(public=False)
        bundles["concordance-youth.json"]["items"].append({"o": "1"})
        with self.assertRaises(RightsError):
            gen.check_rights(bundles)

    def test_overlap_passages_are_rights_gated(self):
        gen_priv, bundles_priv = self.build(public=False)
        self.assertEqual(bundles_priv["overlap.json"]["passages"]["items"], [])
        self.assertEqual(bundles_priv["overlap.json"]["passages"]["rows"], [])
        self.assertGreater(bundles_priv["overlap.json"]["passages"]["withheld"], 0)
        gen_priv.check_rights(bundles_priv)
        bundles_priv["overlap.json"]["passages"]["items"].append({"o": "1"})
        with self.assertRaises(RightsError):
            gen_priv.check_rights(bundles_priv)
        gen_pub, bundles_pub = self.build(public=True)
        # "matasa" meets both "'yan siyasa" and "Sarkin" within 10 tokens.
        self.assertEqual(len(bundles_pub["overlap.json"]["passages"]["rows"]), 2)
        gen_pub.check_rights(bundles_pub)

    def test_rhetoric_passages_are_rights_gated(self):
        gen_priv, bundles_priv = self.build(public=False)
        rhet_priv = bundles_priv["rhetoric.json"]
        self.assertEqual(rhet_priv["passages"]["items"], [])
        self.assertEqual(rhet_priv["passages"]["rows"], [])
        self.assertGreater(sum(c["withheld"] for c in rhet_priv["passages"]["counts"].values()), 0)
        gen_priv.check_rights(bundles_priv)
        rhet_priv["passages"]["items"].append({"o": "1"})
        with self.assertRaises(RightsError):
            gen_priv.check_rights(bundles_priv)
        gen_pub, bundles_pub = self.build(public=True)
        self.assertGreater(len(bundles_pub["rhetoric.json"]["passages"]["rows"]), 0)
        gen_pub.check_rights(bundles_pub)


class RhetoricTests(unittest.TestCase):
    def test_detects_tier1_schemes_and_tier2_candidates(self):
        from albani.layers import resources
        from albani.rhetoric import analyze_turn, classify_genre

        res = resources()
        sample = (
            "Ya ku matasa! Muna buƙatar sarakuna masu adalci. "
            "Muna buƙatar matasa masu manufa. "
            "Me ya sa aka bar yara a titi? Wallahi babu shakka wannan kuskure ne! "
            "Sai ya ce masa tafi ka nemi ilimi. Sai suka ce masa mun ji. "
            "Kamar yadda Hausawa sukan ce a karin magana, haba ƙarya ne!"
        )
        hits, _, _ = analyze_turn(sample, res)
        devices = {h.device for h in hits}
        self.assertIn("anaphora", devices)
        self.assertIn("vocative", devices)
        self.assertIn("rhetorical_question", devices)
        self.assertIn("oath_emphasis", devices)
        self.assertIn("dialogue", devices)
        self.assertIn("simile_exemplum", devices)
        self.assertIn("proverb_idiom", devices)
        self.assertIn("polemic_irony", devices)

        self.assertEqual(classify_genre("Khudubobin Juma'a vol. 2"), "khutba")
        self.assertEqual(classify_genre("Adabul Mufrad #9-12"), "commentary")
        self.assertEqual(classify_genre("Hirar Tarho a D.I.V."), "interview")
        self.assertEqual(classify_genre("Gurbacewar Tarbiyyah"), "lecture")

    def test_style_review_sheet_and_csv_import_round_trip(self):
        from albani.propose_style_candidates import import_review_csv

        tmp = Path(tempfile.mkdtemp())
        csv_path = tmp / "style-review.csv"
        ann_path = tmp / "rhetoric_annotations.json"
        gen = generator(frame({"o:id": "1", "OCR": CURRENT, "OCR_is_public": True}))
        gen.run(style_review_sheet=csv_path)
        self.assertTrue(csv_path.exists())
        text = csv_path.read_text(encoding="utf-8-sig")
        self.assertIn("matched_text", text)
        # Mark the first data row as accepted and import back into JSON.
        lines = text.splitlines()
        self.assertGreaterEqual(len(lines), 2)
        lines[1] = lines[1][:-2] + "accept,oath_emphasis,Checked by specialist"
        csv_path.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")
        count = import_review_csv(csv_path, ann_path)
        self.assertEqual(count, 1)
        data = json.loads(ann_path.read_text(encoding="utf-8"))
        self.assertEqual(data["status"], "validated")
        self.assertEqual(len(data["annotations"]), 1)
        self.assertEqual(data["annotations"][0]["device"], "oath_emphasis")


class PeriodTests(unittest.TestCase):
    def test_a_date_that_straddles_the_split_is_left_out(self):
        gen = generator(frame({"o:id": "1"}), period_split="2009-07-01")
        self.assertEqual(gen._period("2009-06-13"), "before")
        self.assertEqual(gen._period("2009-07"), "after")
        self.assertEqual(gen._period("2011"), "after")
        self.assertIsNone(gen._period("2009"))
        self.assertIsNone(gen._period(""))
        gen = generator(frame({"o:id": "1"}), period_split="2009-07-15")
        self.assertIsNone(gen._period("2009-07"))


class NoDatasetTests(unittest.TestCase):
    def test_tests_never_reach_the_hub(self):
        with patch("albani.generator.load_dataset_safe",
                   side_effect=AssertionError("tests must not load the dataset")):
            gen = generator(frame({"o:id": "1", "OCR": CURRENT}))
            self.assertEqual(len(gen.load()), 1)


if __name__ == "__main__":
    unittest.main()
