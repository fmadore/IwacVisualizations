#!/usr/bin/env python3
"""
generate_on_this_day.py
=======================

Generate the ``asset/data/on-this-day/`` fan-out for the IwacVisualizations
module's On This Day page block: for every calendar day, the items published
on that day across the collection's decades — in **both** calendars.

Sources: the ``articles`` (newspaper articles) and ``publications``
(Islamic-periodical issues) subsets. Only rows whose ``pub_date`` carries a
full, valid ``YYYY-MM-DD`` date participate — ~99 % of articles do; bare
years and month precision are skipped. Every one of the 366 Gregorian days
is covered by the current dataset (5–91 items each), so the client block
practically never renders empty.

Output
------
    on-this-day/{MM-DD}.json      Gregorian, one file per calendar day::

        {
          "day": "07-29",
          "items": [[year, o_id, title, source, type, thumb, excerpt], ...]
        }

    on-this-day/h/{MM-DD}.json    Hijri (Umm al-Qura), one file per lunar
                                  day — the same items rebucketed by the
                                  Hijri date their ``pub_date`` converts to,
                                  with the Hijri year appended::

        {
          "day": "02-15", "calendar": "islamic-umalqura",
          "items": [[year, o_id, title, source, type, thumb, excerpt, hYear], ...]
        }

      ``year`` stays **Gregorian** in both files — it is the almanac figure
      the block prints, and a Gregorian year is what a reader can place.
      ``hYear`` carries the Hijri year for the date line. ``type`` is ``"a"``
      (article) or ``"p"`` (periodical issue); ``source`` is the newspaper /
      periodical title. Items are compact positional arrays, year-ascending.

      ``thumb`` is the **Omeka storage id only** (the 40-hex basename of
      ``/files/medium/{id}.jpg``); the client rebuilds whichever derivative
      size its layout wants. ``""`` when the item has no primary media —
      about 56 % of fully-dated articles, so every layout must survive it.

      ``excerpt`` is a ~130-character second line: for an article, the lede
      hunted out of its OCR; for a periodical issue, its table of contents.
      ``""`` wherever neither yields something worth printing.

    on-this-day/metadata.json     dir-level provenance for both fan-outs
                                  (per-file ``_meta`` blocks would cost more
                                  than the payloads).

Why ``hYear`` is stored rather than re-derived in the browser
------------------------------------------------------------
Both sides name the same calendar, but they do not implement it the same
way: ``hijridate`` uses the Umm al-Qura tables throughout, while the ICU
tables behind the browser's ``Intl`` fall back to a tabular approximation
for older dates. Measured across this collection's range they disagree on
**~42 % of pre-2000 dates** (1960s–1990s) and on **none from 2000 on**.

So the client must not re-convert an item's ``pub_date`` to label it — it
would print a date one day off from the file the item is filed under. It
converts only *today* (post-2000, where the two agree) to pick the day
file, and renders each item's date as today's Hijri day-and-month plus the
``hYear`` written here. Bucketing keeps the more accurate converter; the
label stays consistent with its bucket.

Privacy
-------
An article's ``excerpt`` is cut from ``OCR``, and this script reads the
**private** full mirror where ``OCR`` is populated for every row regardless
of source visibility. The day files are served publicly, so an excerpt is
emitted **only** when the row's ``OCR_is_public`` flag is true — the same
per-value gate ``publish_public.py`` applies to the public dataset. Never
relax this: it is the one field in this fan-out that can carry full text.
(``tableOfContents``, the periodical path, is a public column and needs no
gate.)

Stale-file note: regeneration overwrites the day files in place; CI builds
from a clean checkout so orphans cannot ship. If you regenerate locally
after a dataset shrink, clear the directory first.

Usage
-----
    python scripts/generate_on_this_day.py
    python scripts/generate_on_this_day.py --output-dir asset/data/on-this-day --no-minify -v
    python scripts/generate_on_this_day.py --no-hijri       # Gregorian only

Environment
-----------
    HF_TOKEN   Hugging Face access token — required, the default dataset is
               the private full mirror (see iwac_utils.DATASET_ID).
"""
from __future__ import annotations

import argparse
import logging
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from hijridate import Gregorian

from iwac_utils import (
    FULL_DATE_RE,
    add_standard_args,
    clean_str,
    create_metadata_block,
    load_dataset_safe,
    parse_standard_args,
    save_json,
)

logger = logging.getLogger(__name__)

# Subset name -> (single-char type flag, where its excerpt comes from). Both
# subsets carry a clean `newspaper` column (for publications it is the
# periodical title).
#
# Periodicals draw on `tableOfContents` ONLY, never on OCR. An issue's OCR is
# the whole magazine, so its opening is masthead, front matter or an advert
# column — there is no lede to find, and the lede hunt below duly returns the
# first grammatical French it meets, which on Islam Info is a private
# school's enrolment advert. Roughly 30 % of issues carry a table of
# contents; the rest simply get no second line, which is what the block is
# built to absorb.
SOURCES = [
    ("articles", "a", "ocr"),
    ("publications", "p", "contents"),
]

COLUMNS = ["pub_date", "o:id", "title", "newspaper",
           "thumbnail", "OCR", "OCR_is_public", "tableOfContents"]

# Omeka derivative URL -> storage id. Every derivative is a JPEG whatever the
# original was, so the client can rebuild `/files/{size}/{id}.jpg` for any of
# large / medium / square from this one token. Anything that does not match
# (an off-site URL, a renamed derivative path) is dropped rather than stored
# as a full URL: a layout that cannot rebuild the other sizes is worse than
# one with no image.
THUMB_RE = re.compile(
    r"/files/(?:large|medium|square|original)/([0-9a-f]{16,64})\.\w+$", re.I
)

# Target excerpt length. The block clamps to two lines at every layout width,
# so anything past ~140 characters is invisible weight in a file that ships
# on the homepage.
EXCERPT_CHARS = 130

# Below this the OCR is a caption fragment or a failed scan, not a lede.
EXCERPT_MIN_CHARS = 40

# Leading noise on newspaper OCR: page furniture, section rules, stray
# punctuation runs before the first real word.
LEAD_NOISE_RE = re.compile(r"^[\W\d_]+", re.UNICODE)

WS_RE = re.compile(r"\s+")

# How far into the OCR the lede hunt gives up. Past this the page is all
# furniture (a periodical's front matter, a classifieds column) and there is
# no sentence to find.
LEDE_SEARCH_CHARS = 600

# Prose window: how many words are examined when deciding whether the text
# at a given offset is running prose or page furniture.
LEDE_WINDOW = 12


def valid_day(year: int, month: int, day: int) -> bool:
    """Cheap calendar sanity: rejects month 00/13+, day 00/32+, absurd years."""
    if not (1800 <= year <= 2100):
        return False
    if not (1 <= month <= 12):
        return False
    days_in_month = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return 1 <= day <= days_in_month[month - 1]


def thumb_id(value: Any) -> str:
    """Storage id from an Omeka derivative URL; '' when there is no usable one."""
    m = THUMB_RE.search(clean_str(value))
    return m.group(1).lower() if m else ""


def _fold(text: str) -> str:
    """Accent- and case-folded, for comparing an OCR head against a title."""
    return "".join(
        c for c in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(c) != "Mn"
    )


def _opens_a_sentence(word: str) -> bool:
    """
    Could a sentence plausibly start on this word?

    Rejects the all-caps fragments that column scans open with — a masthead,
    a deck, the ``HUIT MOIS D...`` tail of a headline running into the story.
    Anything carrying a lowercase letter qualifies, which is every ordinary
    word, capitalised or not.
    """
    letters = [c for c in word if c.isalpha()]
    return bool(letters) and any(c.islower() for c in letters)


def _is_prose(words: List[str]) -> bool:
    """
    Does this run of words read as running prose rather than page furniture?

    Three cheap signals, each aimed at a failure this fan-out actually hit:
    digits (phone numbers in an advert column, a production stamp such as
    ``Mise en page 1 29/07/20 19:38 Pagel``), shouting (mastheads and decks
    set in caps), and tokens with no letters at all (a rules-and-numbers
    table). A lede fails none of them.

    Deliberately NOT a minimum word length: French prose is full of two- and
    one-letter function words (``à la``, ``de``, ``du``, ``au``, ``le``), and
    an earlier `len(w) > 2` rule scored real ledes as furniture and cut them
    mid-sentence.
    """
    joined = "".join(words)
    if not joined:
        return False

    letters = [c for c in joined if c.isalpha()]
    if len(letters) < 30:
        return False
    if sum(c.isdigit() for c in joined) / len(joined) > 0.15:
        return False
    if sum(c.isupper() for c in letters) / len(letters) > 0.35:
        return False

    lettered = [w for w in words if any(c.isalpha() for c in w)]
    return len(lettered) >= len(words) * 0.75


def excerpt(mode: str, ocr: Any, is_public: Any, title: str,
            contents: Any = None) -> str:
    """
    A ~130-character second line for the item, or '' when there is none worth
    printing.

    ``mode`` is the subset's excerpt source (see SOURCES). ``"contents"``
    takes the issue's ``tableOfContents`` as-is and stops there — that column
    is public, so it needs no gate. ``"ocr"`` runs the lede hunt below, and
    only when ``is_public`` is true: that is the privacy gate described in the
    module docstring, not an optimisation, because the fan-out is
    world-readable and this script reads the private mirror.

    Column-scanned newspapers rarely begin with the story: the OCR opens with
    the headline (which the block already prints directly above), a masthead,
    a production stamp, or an advert column. So this drops a leading
    restatement of the title, then walks forward to the first window that
    reads as prose and starts there. When no such window turns up inside
    ``LEDE_SEARCH_CHARS`` the item gets no excerpt at all — on a homepage a
    missing line is unremarkable and a line of scanner debris is not.
    """
    if mode == "contents":
        summary = WS_RE.sub(" ", clean_str(contents)).strip()
        return _clip(summary) if len(summary) >= EXCERPT_MIN_CHARS else ""

    if not bool(is_public):
        return ""
    text = WS_RE.sub(" ", clean_str(ocr)).strip()
    if not text:
        return ""

    # The headline usually opens the OCR; showing it twice wastes both lines.
    folded_title = _fold(title).strip()
    if folded_title and len(folded_title) > 8:
        folded = _fold(text)
        if folded.startswith(folded_title):
            text = text[len(folded_title):]

    text = LEAD_NOISE_RE.sub("", text).strip()
    if len(text) < EXCERPT_MIN_CHARS:
        return ""

    # Walk word by word to the first prose window within the search budget.
    words = text.split(" ")
    start = None
    offset = 0
    for i, word in enumerate(words):
        if offset > LEDE_SEARCH_CHARS:
            break
        if _opens_a_sentence(word) and _is_prose(words[i:i + LEDE_WINDOW]):
            start = offset
            break
        offset += len(word) + 1
    if start is None:
        return ""

    text = LEAD_NOISE_RE.sub("", text[start:]).strip()
    if len(text) < EXCERPT_MIN_CHARS:
        return ""
    return _clip(text)


def _clip(text: str) -> str:
    """Trim to EXCERPT_CHARS on a word boundary, with an ellipsis if cut."""
    if len(text) <= EXCERPT_CHARS:
        return text
    cut = text[:EXCERPT_CHARS]
    space = cut.rfind(" ")
    if space > EXCERPT_CHARS * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:.-—–") + "…"


def to_hijri(year: int, month: int, day: int) -> Optional[Tuple[int, int, int]]:
    """
    Umm al-Qura (year, month, day), or None when the date falls outside the
    converter's tabulated range.

    The collection runs 1961–2025, comfortably inside 1343–1500 AH
    (1925–2077), so None here means a bad date got past `valid_day` rather
    than a real limitation — skip the row instead of failing the run.
    """
    try:
        h = Gregorian(year, month, day).to_hijri()
        return h.year, h.month, h.day
    except (ValueError, OverflowError) as exc:
        logger.debug("Hijri conversion failed for %04d-%02d-%02d: %s",
                     year, month, day, exc)
        return None


def collect_days(repo_id: str, hijri: bool = True
                 ) -> Tuple[Dict[str, List[List[Any]]], Dict[str, List[List[Any]]]]:
    """Bucket every fully-dated article / issue by its Gregorian and Hijri MM-DD."""
    greg: Dict[str, List[List[Any]]] = defaultdict(list)
    hij: Dict[str, List[List[Any]]] = defaultdict(list)
    stats = {"thumb": 0, "excerpt": 0, "hijri_failed": 0}

    for subset, type_flag, excerpt_mode in SOURCES:
        logger.info("Loading %s subset...", subset)
        df = load_dataset_safe(subset, repo_id=repo_id, columns=COLUMNS)
        if df is None or df.empty:
            raise RuntimeError(f"Could not load the {subset} subset")
        logger.info("  %d rows", len(df))

        kept = 0
        # Column-wise zip instead of iterrows: no per-row Series build on
        # a 12k-row frame. The projection above guarantees only existing
        # columns land in the frame, so guard each with a None fallback.
        def col(name):
            return df[name] if name in df.columns else [None] * len(df)

        for (pub_date, oid_raw, title_raw, newspaper_raw, thumb_raw, ocr_raw,
             pub_ok, contents_raw) in zip(
                col("pub_date"), col("o:id"), col("title"), col("newspaper"),
                col("thumbnail"), col("OCR"), col("OCR_is_public"),
                col("tableOfContents")):
            m = FULL_DATE_RE.match(clean_str(pub_date))
            if not m:
                continue
            year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if not valid_day(year, month, day):
                continue
            o_id = clean_str(oid_raw)
            title = clean_str(title_raw)
            if not o_id or not title:
                continue

            thumb = thumb_id(thumb_raw)
            snippet = excerpt(excerpt_mode, ocr_raw, pub_ok, title, contents_raw)
            if thumb:
                stats["thumb"] += 1
            if snippet:
                stats["excerpt"] += 1

            row = [
                year,
                int(o_id) if o_id.isdigit() else o_id,
                title,
                clean_str(newspaper_raw),
                type_flag,
                thumb,
                snippet,
            ]
            greg[f"{month:02d}-{day:02d}"].append(row)

            if hijri:
                converted = to_hijri(year, month, day)
                if converted is None:
                    stats["hijri_failed"] += 1
                else:
                    h_year, h_month, h_day = converted
                    hij[f"{h_month:02d}-{h_day:02d}"].append(row + [h_year])
            kept += 1
        logger.info("  %d fully-dated items kept", kept)

    logger.info("Thumbnails: %d · public-OCR excerpts: %d%s",
                stats["thumb"], stats["excerpt"],
                f" · Hijri conversions failed: {stats['hijri_failed']}"
                if stats["hijri_failed"] else "")
    return greg, hij


def write_fanout(days: Dict[str, List[List[Any]]], out_dir: Path,
                 minify: bool, extra: Optional[Dict[str, Any]] = None) -> int:
    """Write one day file per key, year-ascending. Returns the item total."""
    total = 0
    for day_key in sorted(days):
        items = sorted(days[day_key], key=lambda r: (r[0], str(r[1])))
        total += len(items)
        payload = {"day": day_key}
        if extra:
            payload.update(extra)
        payload["items"] = items
        save_json(payload, out_dir / f"{day_key}.json", minify=minify, log=False)
    return total


def _spread(days: Dict[str, List[List[Any]]]) -> Dict[str, int]:
    counts = [len(v) for v in days.values()]
    return {
        "days": len(days),
        "minPerDay": min(counts) if counts else 0,
        "maxPerDay": max(counts) if counts else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[2])
    parser.add_argument("--output-dir", default="asset/data/on-this-day",
                        help="Fan-out directory (default: asset/data/on-this-day)")
    parser.add_argument("--no-hijri", dest="hijri", action="store_false",
                        help="Skip the Umm al-Qura fan-out (the block then "
                             "hides its calendar toggle)")
    add_standard_args(parser)
    args = parse_standard_args(parser)

    greg, hij = collect_days(args.repo, hijri=args.hijri)
    out_dir = Path(args.output_dir)

    greg_total = write_fanout(greg, out_dir, args.minify)
    hij_total = write_fanout(hij, out_dir / "h", args.minify,
                             extra={"calendar": "islamic-umalqura"}) if args.hijri else 0

    save_json(
        {"_meta": create_metadata_block(
            total_records=greg_total,
            columns=["year", "o_id", "title", "source", "type(a|p)",
                     "thumb(storage id)", "excerpt(public OCR only)"],
            hijriColumns=["…", "hYear"] if args.hijri else None,
            gregorian=_spread(greg),
            hijri=_spread(hij) if args.hijri else None,
        )},
        out_dir / "metadata.json", minify=args.minify,
    )
    logger.info("Wrote %d Gregorian day files (%d items)%s to %s",
                len(greg), greg_total,
                f" and {len(hij)} Hijri day files ({hij_total} items)" if args.hijri else "",
                out_dir)


if __name__ == "__main__":
    main()
