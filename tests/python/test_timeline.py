"""Calendar, editorial preservation, sanitation and publication failure contracts."""
import csv
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from generate_timeline import generate
from iwac_timeline import clean_html, parse_csv, parse_date, safe_url
from validate_data import check_timelines


def sheet(rows):
    stream = io.StringIO()
    keys = list(dict.fromkeys(["Year", "Headline", "Text", "ID"] + [k for row in rows for k in row]))
    writer = csv.DictWriter(stream, fieldnames=keys)
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue()


INTRO = {"Headline": "A history", "Text": "<p>Introduction</p>"}
FIRST = {"ID": "first", "Year": "1970", "End Year": "1980", "Headline": "A range", "Text": "<p>A source.</p>"}
SECOND = {"ID": "second", "Year": "1975", "Month": "4", "Day": "30", "Headline": "A date", "Text": ""}


class TimelineTests(unittest.TestCase):
    def test_precision_and_impossible_dates(self):
        self.assertEqual(parse_date({"Year": "1970"}, ""), {"value": "1970", "precision": "year"})
        self.assertEqual(parse_date({"Year": "2000", "Month": "2", "Day": "29"}, "")["value"], "2000-02-29")
        for row in [{"Year": "1900", "Month": "2", "Day": "29"}, {"Year": "2000", "Day": "1"}, {"Year": "0"}]:
            with self.subTest(row=row), self.assertRaises(ValueError):
                parse_date(row, "")

    def test_authored_order_stable_ids_and_dated_title(self):
        parsed = parse_csv(sheet([INTRO, SECOND, {**FIRST, "Type": "title"}]), "test", "en")
        self.assertEqual([x["id"] for x in parsed["events"]], ["second", "first"])
        self.assertIn("dated", " ".join(parsed["warnings"]))
        changed = parse_csv(sheet([INTRO, {**FIRST, "Headline": "Renamed"}, SECOND]), "test", "fr")
        self.assertEqual({e["id"] for e in changed["events"]}, {e["id"] for e in parsed["events"]})

    def test_html_repair_links_and_script_removal(self):
        warnings = []
        html = clean_html('<blockquote>A quotation<blockquote>', warnings, "text")
        self.assertEqual(html, '<blockquote>A quotation</blockquote>')
        self.assertTrue(warnings)
        dirty = '<p onclick="evil()"><script>evil()</script><a href="javascript:evil()">No</a><a href="/s/westafrica/item/42">Yes</a></p>'
        parsed = parse_csv(sheet([INTRO, {**FIRST, "Text": dirty}]), "test", "en")
        event = parsed["events"][0]
        self.assertNotIn("javascript:", event["textHtml"])
        self.assertNotIn("onclick", event["textHtml"])
        self.assertNotIn("<script", event["textHtml"])
        self.assertIn("https://islam.zmo.de/s/westafrica/item/42", event["textHtml"])
        self.assertEqual(event["relatedResources"], [{"type": "item", "id": 42}])
        with self.assertRaises(ValueError):
            clean_html('<blockquote>one<blockquote>two', [], "text")

    def test_fail_closed_on_unknown_fields_ids_and_urls(self):
        for row in [{**FIRST, "ID": ""}, {**FIRST, "Time": "12:30"}, {**FIRST, "Media": "javascript:evil()"}, {**FIRST, "End Year": "1960"}]:
            with self.subTest(row=row), self.assertRaises(ValueError):
                parse_csv(sheet([INTRO, row]), "test", "en")
        with self.assertRaises(ValueError):
            parse_csv('<html>Sign in</html>', "test", "en")
        with self.assertRaises(ValueError):
            parse_csv(sheet([INTRO, FIRST, FIRST]), "test", "en")
        for url in ['https://user:pass@example.com/a.jpg', 'data:image/png;base64,abc', '//example.com/a.jpg']:
            with self.assertRaises(ValueError):
                safe_url(url)

    def test_catalogue_and_all_sources_validate_before_writing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "timelines"
            config = {"timelines": [{"slug": "test", "sources": {
                locale: {"csvUrl": "https://example.org/sheet.csv"} for locale in ["en", "fr"]}}]}
            for locale in ["en", "fr"]:
                (root / f"test.{locale}.csv").write_text(sheet([INTRO, FIRST, SECOND]))
            generate(config, output, csv_dir=root)
            self.assertEqual(check_timelines(root), [])
            before = {p.name: p.read_bytes() for p in output.glob('*.json')}
            (root / "test.fr.csv").write_text('broken input')
            with self.assertRaises(ValueError):
                generate(config, output, csv_dir=root)
            self.assertEqual(before, {p.name: p.read_bytes() for p in output.glob('*.json')})
            index = json.loads((output / "index.json").read_text())
            index["timelines"][0]["locales"]["en"]["file"] = "../evil.json"
            (output / "index.json").write_text(json.dumps(index))
            self.assertTrue(check_timelines(root))


if __name__ == '__main__':
    unittest.main()
