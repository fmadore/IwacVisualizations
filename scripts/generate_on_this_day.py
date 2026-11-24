#!/usr/bin/env python3
"""
generate_on_this_day.py
=======================

Generate the ``asset/data/on-this-day/`` fan-out for the IwacVisualizations
module's On This Day page block: for every calendar day, the items published
on that day across the collection's decades — in **both** calendars.

Sources: five subsets, each a row ``type`` (see SOURCES) — ``articles``
(``a``), ``publications`` (``p``, Islamic-periodical issues), ``audiovisual``
(``v``), ``documents`` (``d``) and ``images`` (``i``). Only rows whose
``pub_date`` carries a full, valid ``YYYY-MM-DD`` date participate — ~99 % of
articles do; bare years and month precision are skipped. Every one of the 366
Gregorian days is covered by the current dataset, so the client block
practically never renders empty.

Output
------
    on-this-day/{MM-DD}.json      Gregorian, one file per calendar day::

        {
          "day": "07-29", "v": 2,
          "items": [[year, o_id, title, source, type, thumb, excerpt,
                     hYear, country, summaryFr, summaryEn, subjects], ...]
        }

    on-this-day/h/{MM-DD}.json    Hijri (Umm al-Qura), one file per lunar
                                  day — the same items rebucketed by their
                                  stored Hijri date, in the same row shape::

        {"day": "02-15", "v": 2, "calendar": "islamic-umalqura", "items": [...]}

      Rows are compact positional arrays, year-ascending. Indices 0–6 kept
      their meaning from version 1 (an old client reads by position), so new
      fields are only ever appended.

      0 ``year``      **Gregorian** in both files — the almanac figure the
                      block prints, and a year a reader can place.
      1 ``o_id``      Omeka item id (int).
      2 ``title``     For images, the first of its pipe-separated language
                      variants.
      3 ``source``    A short attribution: the newspaper / periodical title
                      (``a``, ``p``), the publishing channel or broadcaster
                      (``v``: ``publisher``), the issuing body (``d``:
                      ``author``), the photographer (``i``: ``creator``).
                      First value of a multi-valued cell; ``""`` if none.
      4 ``type``      ``a`` article, ``p`` periodical issue, ``v``
                      audiovisual, ``d`` document, ``i`` image.
      5 ``thumb``     The **Omeka storage id only** (the 40-hex basename of
                      ``/files/medium/{id}.jpg``); the client rebuilds the
                      derivative size its layout wants. ``""`` when there is
                      no primary media — every layout must survive it.
      6 ``excerpt``   A ~280-character second line: for an article or a
                      document, the lede hunted out of its OCR (**public OCR
                      only**, see Privacy); for a periodical issue, its table
                      of contents; for a recording or a photo, its
                      ``description`` (a photo's French caption variant).
                      ``""`` wherever nothing is worth printing.
      7 ``hYear``     Hijri year (int), in both fan-outs; ``0`` when unknown.
      8 ``country``   Canonical country (``iwac_utils.first_country``), ``""``.
      9 ``summaryFr`` / 10 ``summaryEn``  The AI summary (``descriptionAI`` /
                      ``descriptionAI_en``), clipped to ~300 characters at a
                      sentence end. Only ``articles`` and ``documents`` have
                      them; ``""`` elsewhere.
      11 ``subjects`` Up to three ``[label, index_o_id]`` pairs, the item's
                      most specific linked subjects (see SUBJECT RULE).

    on-this-day/metadata.json     dir-level provenance for both fan-outs
                                  (per-file ``_meta`` blocks would cost more
                                  than the payloads), the per-type counts,
                                  and ``rich``: the Gregorian day keys a
                                  "random date" button should draw from.

Where the Hijri dates come from
-------------------------------
They are **read**, not computed. The dataset ships ``hijri_year`` /
``hijri_month`` / ``hijri_day`` beside ``pub_date``, written upstream by
``post-processing/calculate_hijri_dates.py`` from the Umm al-Qura tables,
and populated for every complete ``YYYY-MM-DD`` — which is the only case
this script keeps anyway. This script used to re-derive them locally with
the same ``hijridate`` library, which agreed with the stored values on all
13,464 fully-dated rows but only *by construction*: it held as long as two
repositories happened to pin compatible versions of one library. Reading
the column makes the agreement structural instead, and drops this repo's
only ``hijridate`` dependency.

Why ``hYear`` is stored rather than re-derived in the browser
------------------------------------------------------------
Both sides name the same calendar, but they do not implement it the same
way: the Umm al-Qura tables behind the stored columns run throughout, while
the ICU tables behind the browser's ``Intl`` fall back to a tabular
approximation for older dates. Measured across this collection's range they
disagree on **~42 % of pre-2000 dates** (1960s–1990s) and on **none from
2000 on**.

So the client must not re-convert an item's ``pub_date`` to label it — it
would print a date one day off from the file the item is filed under. It
converts only *today* (post-2000, where the two agree) to pick the day
file, and renders each item's date as today's Hijri day-and-month plus the
``hYear`` written here. Bucketing keeps the more accurate dates; the label
stays consistent with its bucket.

Privacy
-------
An article's or a document's ``excerpt`` is cut from ``OCR``, and this
script reads the **private** full mirror where ``OCR`` is populated for
every row regardless of source visibility. The day files are served
publicly, so an OCR excerpt is emitted **only** when the row's
``OCR_is_public`` flag is a real boolean True — the same per-value gate
``publish_public.py`` applies to the public dataset. Never relax this: it is
the one field in this fan-out that can carry full text.

The other text fields follow the public projection's per-row rule instead:
a field is blanked when the row's ``private_fields`` names its source
column (``descriptionAI``, ``subject_ids``, ``thumbnail``, ``description``),
and a row whose item is not public (``item_is_public``) is skipped. The AI
summaries are **not** content columns: the public dataset carries them on
every private-OCR article (measured 2026-11-24: 9,169 of 9,169), so they
need no OCR gate. ``tableOfContents`` (periodicals) and ``description``
(recordings, photos) are public columns likewise.

SUBJECT RULE
------------
Candidates are the row's ``subject_ids`` that resolve to an ``index``
record (labels from ``index.Titre``; the placeholder type "Notices
d'autorité" is skipped). Each candidate's weight is the number of fan-out
items carrying it. A subject carried by more than ``UBIQUITOUS_SHARE`` of
the items (Paix, Prière, Terrorisme, Hadj, …) says little about any one of
them, and a subject carried by ``RARE_MAX`` item(s) or fewer may be a
stray link; so candidates sort in three bands — mid-frequency, then rare,
then ubiquitous. Inside the mid band the one nearest (on a log scale) to
the band's geometric middle comes first: a named organisation or a
recurring figure, rather than a one-off name or a near-ubiquitous theme.
The other two bands sort by ascending weight. Ties keep the curator's own
order. The first ``MAX_SUBJECTS`` win.

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
import difflib
import logging
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from iwac_utils import (
    AUTHORITY_PLACEHOLDER_TYPE,
    FULL_DATE_RE,
    add_standard_args,
    clean_str,
    create_metadata_block,
    expect_item_outputs,
    first_country,
    fold_plain,
    is_public_flag,
    load_dataset_safe,
    parse_pipe_separated,
    parse_standard_args,
    read_hijri,
    save_json,
)

logger = logging.getLogger(__name__)

# Day-file format version, written into every file as "v". 2 appended
# hYear … subjects (indices 7–11) and put hYear in the Gregorian files too.
FORMAT_VERSION = 2

# Subset -> (type flag, source column, excerpt mode, has AI summary).
#
# Excerpt modes:
#   "ocr"         lede hunt over OCR, gated on OCR_is_public (articles,
#                 documents).
#   "contents"    the issue's tableOfContents, as-is. Periodicals draw on it
#                 ONLY, never on OCR: an issue's OCR is the whole magazine,
#                 whose opening is masthead, front matter or an advert
#                 column, and the lede hunt duly returns the first
#                 grammatical French it meets — on Islam Info a private
#                 school's enrolment advert. Roughly 30 % of issues carry a
#                 table of contents; the rest get no second line.
#   "description" dcterms:description — a YouTube blurb or a curator note on
#                 recordings, a caption on the rare photo that has one. Its
#                 link and hashtag footer is cut off.
#
# Audiovisual dates are the publication date of the recording, which for the
# YouTube population (~99 % of the subset) is the channel's upload date —
# still "published on this day", which is what the block says. Their OCR (a
# transcription on ~3 % of rows) is not used.
SOURCES = [
    ("articles", "a", "newspaper", "ocr", True),
    ("publications", "p", "newspaper", "contents", False),
    ("audiovisual", "v", "publisher", "description", False),
    ("documents", "d", "author", "ocr", True),
    ("images", "i", "creator", "description", False),
]
TYPE_FLAGS = [flag for _, flag, *_ in SOURCES]

COLUMNS = ["pub_date", "o:id", "title", "thumbnail", "country", "subject_ids",
           "item_is_public", "private_fields", "hijri_year", "hijri_month", "hijri_day"]
MODE_COLUMNS = {"ocr": ["OCR", "OCR_is_public"], "contents": ["tableOfContents"],
                "description": ["description"]}
SUMMARY_COLUMNS = ["descriptionAI", "descriptionAI_en"]


def source_columns(source_col: str, mode: str, has_summary: bool) -> List[str]:
    """The projection one SOURCES row reads (no warnings for absent columns)."""
    return (COLUMNS + [source_col] + MODE_COLUMNS[mode]
            + (SUMMARY_COLUMNS if has_summary else []))

# The Hijri columns the dataset ships beside `pub_date`. Stored nullable
# int64 (float64 in pandas wherever a subset has a null, and on revisions
# before the pipeline's canonical types), so `read_hijri` casts each cell;
# populated exactly where `pub_date` is a complete YYYY-MM-DD — which is
# also the only case this script keeps.
HIJRI_COLUMNS = ("hijri_year", "hijri_month", "hijri_day")

# Omeka derivative URL -> storage id. Every derivative is a JPEG whatever the
# original was, so the client can rebuild `/files/{size}/{id}.jpg` for any of
# large / medium / square from this one token. Anything that does not match
# (an off-site URL, Omeka's generic audio/video placeholder) is dropped
# rather than stored as a full URL: a layout that cannot rebuild the other
# sizes is worse than one with no image.
THUMB_RE = re.compile(
    r"/files/(?:large|medium|square|original)/([0-9a-f]{16,64})\.\w+$", re.I
)

# Target excerpt length. The lead layout shows three to four lines; the
# others clamp in CSS. Past this it is invisible weight in a file that ships
# on the homepage.
EXCERPT_CHARS = 280

# Below this the text is a caption fragment or a failed scan, not a lede.
EXCERPT_MIN_CHARS = 40

# AI summaries: clipped at the last sentence end inside SUMMARY_CHARS, as
# long as that keeps at least SUMMARY_MIN_SENTENCE of it; otherwise on a
# word boundary with an ellipsis.
SUMMARY_CHARS = 300
SUMMARY_MIN_SENTENCE = 120

# Subject selection (see SUBJECT RULE in the module docstring).
MAX_SUBJECTS = 3
UBIQUITOUS_SHARE = 0.05
RARE_MAX = 1

# Share of Gregorian days listed in metadata.json `rich`.
RICH_SHARE = 0.4

# Leading noise on newspaper OCR: page furniture, section rules, stray
# punctuation runs before the first real word.
LEAD_NOISE_RE = re.compile(r"^[\W\d_]+", re.UNICODE)

WS_RE = re.compile(r"\s+")

# Page separators the OCR pipeline writes between pages of a multi-page
# article (`--- Page 2 ---`), wherever they fall in the text.
PAGE_MARKER_RE = re.compile(r"[-=—_*#]{2,}\s*Page\s*\d+\s*[-=—_*#]{2,}", re.I)

# Markdown emphasis the OCR model sometimes leaves around a deck.
MARKDOWN_RE = re.compile(r"\*\*|__|^#+\s+", re.M)

# Description footers: a rule line, or a line carrying a link, an @handle
# or a hashtag, ends the prose part of a YouTube blurb.
FOOTER_LINE_RE = re.compile(r"^\s*[-=_*•.]{4,}\s*$|https?://|www\.|@\w|#\w")

# Title pieces are split on these before the restatement filter (a deck
# after a colon is often what the OCR opens with).
TITLE_SPLIT_RE = re.compile(r"\s*(?:[:|/.?!«»\"“”]|\s[-–—]\s)\s*")

# How far into the OCR the lede hunt gives up. Past this the page is all
# furniture (a periodical's front matter, a classifieds column) and there is
# no sentence to find.
LEDE_SEARCH_CHARS = 600

# How far into the (normalised) text the full title is looked for. A deck or
# kicker before the headline is common; past this a match is coincidence.
TITLE_SEARCH_CHARS = 300

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


def private_set(value: Any) -> Set[str]:
    """A ``private_fields`` cell (numpy array, list, or empty) as a set."""
    if value is None or isinstance(value, (str, float)):
        return set(parse_pipe_separated(value)) if isinstance(value, str) else set()
    try:
        return {clean_str(v) for v in value if clean_str(v)}
    except TypeError:
        return set()


# ---------------------------------------------------------------------------
# Text normalisation for the title-restatement filter
# ---------------------------------------------------------------------------

def _norm_map(text: str) -> Tuple[str, List[int]]:
    """Folded letters and digits of ``text``, with each one's source offset.

    Punctuation, whitespace and markdown fall away, so a headline set as
    ``Enseignement technique. Mission…`` in the title and ``Enseignement
    technique : Mission…`` in the OCR normalise to the same string; the
    offsets let a match on the normalised form be cut from the original.
    Folding is per character, so a ligature or a decomposed accent keeps its
    mapping.
    """
    chars: List[str] = []
    offsets: List[int] = []
    for i, c in enumerate(text):
        for f in fold_plain(c):
            if f.isalnum():
                chars.append(f)
                offsets.append(i)
    return "".join(chars), offsets


def norm(text: str) -> str:
    return _norm_map(text)[0]


def _title_pieces(title: str) -> List[str]:
    """The normalised title and its contiguous runs of segments, longest first.

    ``Pèlerinage 2011 à la Mecque : les premières vagues…`` yields the whole
    title, then ``pelerinage2011alamecque`` and ``lespremieresvagues…`` —
    the OCR often opens on the deck after the colon alone.
    """
    segments = [norm(s) for s in TITLE_SPLIT_RE.split(title)]
    segments = [s for s in segments if s]
    pieces = {"".join(segments[i:j + 1])
              for i in range(len(segments)) for j in range(i, len(segments))}
    return sorted((p for p in pieces if len(p) >= 12), key=lambda p: (-len(p), p))


def _match_end(head: str, piece: str) -> int:
    """Length of ``head`` that restates ``piece``; 0 when it does not.

    Exact, or near-exact on a long piece (an OCR typo in the headline:
    ``départ`` for ``départs``). A near match ends where the last matching
    block ends, not at ``len(piece)`` — a dropped letter would otherwise
    pull the first letter of the story into the cut.
    """
    if head == piece:
        return len(piece)
    if len(piece) < 25:
        return 0
    matcher = difflib.SequenceMatcher(None, head, piece, autojunk=False)
    if matcher.ratio() < 0.9:
        return 0
    blocks = [b for b in matcher.get_matching_blocks() if b.size]
    return blocks[-1].a + blocks[-1].size if blocks else 0


def strip_title(text: str, title: str) -> str:
    """Drop a restatement of ``title`` from the head of ``text``.

    Two passes, both on the punctuation-insensitive form (``_norm_map``):

    1. the whole title anywhere in the first ``TITLE_SEARCH_CHARS`` — a
       kicker or deck often precedes the headline, and what follows the
       headline is the story;
    2. at the head, repeatedly, the longest title piece that matches —
       a headline split differently from the curator's title.

    The cut falls just after the last matched character in the original.
    """
    if not title or not text:
        return text
    normalised, offsets = _norm_map(text)
    full = norm(title)
    if len(full) >= 15:
        at = normalised.find(full, 0, TITLE_SEARCH_CHARS + len(full))
        if at != -1:
            text = _cut_after(text, offsets[at + len(full) - 1])
            normalised, offsets = _norm_map(text)

    pieces = _title_pieces(title)
    changed = True
    while changed and normalised:
        changed = False
        for piece in pieces:
            end = _match_end(normalised[:len(piece)], piece)
            if end:
                text = _cut_after(text, offsets[end - 1])
                normalised, offsets = _norm_map(text)
                changed = True
                break
    return text


def _cut_after(text: str, last: int) -> str:
    """``text`` after offset ``last``, finishing the word a fuzzy match ended in."""
    rest = text[last + 1:]
    if rest[:1].isalnum() and text[last].isalnum():
        space = rest.find(" ")
        rest = rest[space:] if space != -1 else ""
    return rest


def restates_title(snippet: str, title: str) -> bool:
    """Is what is left mostly the title again?"""
    a, b = norm(snippet.rstrip("…")), norm(title)
    if not a or not b:
        return False
    if a in b:
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def clean_text(value: Any) -> str:
    """Page markers and markdown out, whitespace collapsed."""
    text = PAGE_MARKER_RE.sub(" ", clean_str(value))
    text = MARKDOWN_RE.sub("", text)
    return WS_RE.sub(" ", text).strip()


# ---------------------------------------------------------------------------
# Lede hunt
# ---------------------------------------------------------------------------

def _opens_a_sentence(word: str) -> bool:
    """
    Could a sentence plausibly start on this word?

    Rejects the all-caps fragments that column scans open with — a masthead,
    a deck, the ``HUIT MOIS D...`` tail of a headline running into the story.
    Anything carrying a lowercase letter qualifies, which is every ordinary
    word, capitalised or not — and so does a one-letter word, or every lede
    opening on ``À trois jours de…`` lost its first word.
    """
    letters = [c for c in word if c.isalpha()]
    return len(letters) == 1 or any(c.islower() for c in letters)


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


def _lede(text: str) -> str:
    """Walk word by word to the first prose window within the search budget."""
    words = text.split(" ")
    offset = 0
    for i, word in enumerate(words):
        if offset > LEDE_SEARCH_CHARS:
            break
        if _opens_a_sentence(word) and _is_prose(words[i:i + LEDE_WINDOW]):
            return text[offset:]
        offset += len(word) + 1
    return ""


def _description_prose(value: Any) -> str:
    """The prose head of a description: everything above its link footer."""
    kept = []
    for line in clean_str(value).splitlines():
        if FOOTER_LINE_RE.search(line):
            break
        kept.append(line)
    return clean_text("\n".join(kept))


def excerpt(mode: str, ocr: Any, is_public: Any, title: str,
            contents: Any = None, description: Any = None) -> str:
    """
    A ~280-character second line for the item, or '' when there is none worth
    printing.

    ``mode`` is the subset's excerpt source (see SOURCES). ``"contents"``
    takes the issue's ``tableOfContents`` as-is — a public column, no gate.
    ``"description"`` takes the prose head of ``description`` — public too
    (the caller blanks it when ``private_fields`` names it). ``"ocr"`` runs
    the lede hunt, and only when ``is_public`` is a real True: that is the
    privacy gate described in the module docstring, not an optimisation,
    because the fan-out is world-readable and this script reads the private
    mirror.

    Column-scanned newspapers rarely begin with the story: the OCR opens with
    the headline (which the block already prints directly above), a masthead,
    a production stamp, or an advert column, and multi-page articles carry
    ``--- Page N ---`` separators. So this strips the separators, drops a
    restatement of the title (``strip_title``), then walks forward to the
    first window that reads as prose and starts there. When no such window
    turns up inside ``LEDE_SEARCH_CHARS`` the item gets no excerpt at all — on
    a homepage a missing line is unremarkable and a line of scanner debris is
    not.
    """
    if mode == "contents":
        summary = clean_text(contents)
        return _clip(summary) if len(summary) >= EXCERPT_MIN_CHARS else ""

    if mode == "description":
        text = LEAD_NOISE_RE.sub("", strip_title(_description_prose(description), title)).strip()
        if len(text) < EXCERPT_MIN_CHARS or restates_title(text, title):
            return ""
        return _clip(text)

    # Fails CLOSED: only a real boolean True opens the text. `bool(nan)` is
    # True, so the old `bool(is_public)` read a missing flag as public.
    if not is_public_flag(is_public):
        return ""
    text = clean_text(ocr)
    if not text:
        return ""

    text = LEAD_NOISE_RE.sub("", strip_title(text, title)).strip()
    if len(text) < EXCERPT_MIN_CHARS:
        return ""

    text = LEAD_NOISE_RE.sub("", _lede(text)).strip()
    if len(text) < EXCERPT_MIN_CHARS:
        return ""
    clipped = _clip(text)
    return "" if restates_title(clipped, title) else clipped


def _clip(text: str, limit: int = EXCERPT_CHARS) -> str:
    """Trim to ``limit`` on a word boundary, with an ellipsis if cut."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:.-—–") + "…"


_SENTENCE_END_RE = re.compile(r"[.!?…](?:[»\"”)\]]*)(?=\s|$)")


def summary(value: Any) -> str:
    """An AI summary, whitespace-collapsed and clipped to ~SUMMARY_CHARS.

    Cut after the last sentence end that fits, provided that keeps at least
    SUMMARY_MIN_SENTENCE characters; else on a word boundary, with an
    ellipsis. ``""`` when absent.
    """
    text = WS_RE.sub(" ", clean_str(value)).strip()
    if len(text) <= SUMMARY_CHARS:
        return text
    ends = [m.end() for m in _SENTENCE_END_RE.finditer(text, 0, SUMMARY_CHARS + 1)
            if m.end() <= SUMMARY_CHARS]
    if ends and ends[-1] >= SUMMARY_MIN_SENTENCE:
        return text[:ends[-1]].strip()
    return _clip(text, SUMMARY_CHARS)


# ---------------------------------------------------------------------------
# Subjects
# ---------------------------------------------------------------------------

def load_subject_labels(repo_id: str) -> Dict[str, str]:
    """index ``o:id`` (string) -> ``Titre``, placeholders left out."""
    idx = load_dataset_safe("index", repo_id=repo_id, columns=["o:id", "Titre", "Type"])
    if idx is None or idx.empty:
        raise RuntimeError("Could not load the index subset")
    labels = {}
    for oid, titre, kind in zip(idx["o:id"], idx["Titre"], idx["Type"]):
        oid, titre = clean_str(oid), clean_str(titre)
        if oid and titre and clean_str(kind) != AUTHORITY_PLACEHOLDER_TYPE:
            labels[oid] = titre
    return labels


def pick_subjects(ids: Sequence[str], labels: Dict[str, str], weight: Counter,
                  population: int, limit: int = MAX_SUBJECTS) -> List[List[Any]]:
    """The ``limit`` most specific resolvable subjects (SUBJECT RULE)."""
    ubiquitous = UBIQUITOUS_SHARE * population
    # Geometric middle of the mid-frequency band: the weight a subject is
    # "most mid-frequency" at.
    target = math.sqrt((RARE_MAX + 1) * max(ubiquitous, RARE_MAX + 1))
    seen: List[str] = []
    for sid in ids:
        if sid in labels and sid not in seen:
            seen.append(sid)

    def key(pair):
        order, sid = pair
        w = weight.get(sid, 0)
        band = 2 if w > ubiquitous else (1 if w <= RARE_MAX else 0)
        distance = abs(math.log(max(w, 1) / target)) if band == 0 else w
        return (band, round(distance, 9), order)

    ranked = sorted(enumerate(seen), key=key)[:limit]
    return [[labels[sid], int(sid) if sid.isdigit() else sid] for _, sid in ranked]


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------

def _first(value: Any) -> str:
    values = parse_pipe_separated(value)
    return values[0] if values else ""


def collect_rows(repo_id: str) -> Tuple[List[Dict[str, Any]], Counter, Dict[str, int]]:
    """Every fully-dated public item, as a dict, before subject selection."""
    records: List[Dict[str, Any]] = []
    weight: Counter = Counter()
    stats: Dict[str, int] = Counter()

    for subset, flag, source_col, mode, has_summary in SOURCES:
        logger.info("Loading %s subset...", subset)
        df = load_dataset_safe(subset, repo_id=repo_id,
                               columns=source_columns(source_col, mode, has_summary))
        if df is None or df.empty:
            raise RuntimeError(f"Could not load the {subset} subset")
        logger.info("  %d rows", len(df))
        absent = [c for c in HIJRI_COLUMNS + ("item_is_public",) if c not in df.columns]
        if absent:
            logger.warning("%s carries no %s.", subset, ", ".join(absent))

        def col(name):
            return df[name] if name in df.columns else [None] * len(df)

        kept = 0
        for (pub_date, oid_raw, title_raw, source_raw, thumb_raw, ocr_raw, pub_ok,
             contents_raw, desc_raw, ai_fr, ai_en, country_raw, subj_raw,
             item_public, private_raw, hy, hm, hd) in zip(
                col("pub_date"), col("o:id"), col("title"), col(source_col),
                col("thumbnail"), col("OCR"), col("OCR_is_public"),
                col("tableOfContents"), col("description"), col("descriptionAI"),
                col("descriptionAI_en"), col("country"), col("subject_ids"),
                col("item_is_public"), col("private_fields"),
                col("hijri_year"), col("hijri_month"), col("hijri_day")):
            m = FULL_DATE_RE.match(clean_str(pub_date))
            if not m:
                continue
            year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if not valid_day(year, month, day):
                continue
            # A private item is dropped from the public dataset outright;
            # it does not reach a public day file either. Fails closed.
            if not is_public_flag(item_public):
                stats["private_item"] += 1
                continue
            o_id = clean_str(oid_raw)
            # Photos carry their title and caption as pipe-separated
            # language variants (French first); keep one.
            title = _first(title_raw) if flag == "i" else clean_str(title_raw)
            if flag == "i":
                desc_raw = _first(desc_raw)
            if not o_id or not title:
                continue
            private = private_set(private_raw)

            def public(column, value):
                return "" if column in private else value

            subject_ids = [] if "subject_ids" in private else parse_pipe_separated(subj_raw)
            weight.update(set(subject_ids))
            hijri = read_hijri(hy, hm, hd)
            if hijri is None:
                stats["hijri_missing"] += 1

            records.append({
                "greg": f"{month:02d}-{day:02d}",
                "hij": f"{hijri[1]:02d}-{hijri[2]:02d}" if hijri else None,
                "subject_ids": subject_ids,
                "row": [
                    year,
                    int(o_id) if o_id.isdigit() else o_id,
                    title,
                    _first(source_raw),
                    flag,
                    thumb_id(public("thumbnail", thumb_raw)),
                    excerpt(mode, ocr_raw, pub_ok, title, contents_raw,
                            public("description", desc_raw)),
                    hijri[0] if hijri else 0,
                    first_country(country_raw),
                    summary(public("descriptionAI", ai_fr)) if has_summary else "",
                    summary(public("descriptionAI_en", ai_en)) if has_summary else "",
                ],
            })
            kept += 1
        stats[f"type_{flag}"] = kept
        logger.info("  %d fully-dated items kept", kept)
    return records, weight, stats


def collect_days(repo_id: str, hijri: bool = True
                 ) -> Tuple[Dict[str, List[List[Any]]], Dict[str, List[List[Any]]], Dict[str, int]]:
    """Bucket every fully-dated item by its Gregorian and Hijri MM-DD."""
    records, weight, stats = collect_rows(repo_id)
    labels = load_subject_labels(repo_id)
    greg: Dict[str, List[List[Any]]] = defaultdict(list)
    hij: Dict[str, List[List[Any]]] = defaultdict(list)
    for rec in records:
        row = rec["row"] + [pick_subjects(rec["subject_ids"], labels, weight, len(records))]
        greg[rec["greg"]].append(row)
        if hijri and rec["hij"]:
            hij[rec["hij"]].append(row)
        for i, field in ((5, "thumb"), (6, "excerpt"), (9, "summary"), (11, "subjects")):
            if row[i]:
                stats[field] += 1

    logger.info("Per type: %s", ", ".join(f"{f}={stats[f'type_{f}']}" for f in TYPE_FLAGS))
    logger.info("Thumbnails: %d · excerpts: %d · summaries: %d · with subjects: %d",
                stats["thumb"], stats["excerpt"], stats["summary"], stats["subjects"])
    if stats["hijri_missing"]:
        logger.warning(
            "%d fully-dated items carry no Hijri date and are absent from the "
            "Hijri fan-out (hYear 0). The dataset populates hijri_* for every "
            "complete YYYY-MM-DD, so this means the snapshot predates a "
            "pipeline run rather than the dates being unconvertible.",
            stats["hijri_missing"])
    return greg, hij, stats


def rich_days(days: Dict[str, List[List[Any]]], share: float = RICH_SHARE) -> List[str]:
    """Day keys worth landing on from a "random date" button.

    Score = items with a scan × distinct decades: a day needs both pictures
    and range to make a good almanac page, and the product punishes a day
    that has only one. The top ``share`` of days by score (ties by key) are
    returned sorted.
    """
    def score(rows):
        scans = sum(1 for r in rows if r[5])
        decades = len({r[0] // 10 for r in rows})
        return scans * decades
    ranked = sorted(days, key=lambda d: (-score(days[d]), d))
    return sorted(ranked[:math.ceil(len(ranked) * share)])


def write_fanout(days: Dict[str, List[List[Any]]], out_dir: Path,
                 minify: bool, extra: Optional[Dict[str, Any]] = None) -> int:
    """Write one day file per key, year-ascending. Returns the item total."""
    expect_item_outputs(out_dir, days)
    total = 0
    for day_key in sorted(days):
        items = sorted(days[day_key], key=lambda r: (r[0], str(r[1])))
        total += len(items)
        payload: Dict[str, Any] = {"day": day_key, "v": FORMAT_VERSION}
        if extra:
            payload.update(extra)
        payload["items"] = items
        save_json(payload, out_dir / f"{day_key}.json", minify=minify, log=False)
    return total


def _spread(days: Dict[str, Iterable[Any]]) -> Dict[str, int]:
    counts = [len(v) for v in days.values()]
    return {
        "days": len(days),
        "minPerDay": min(counts) if counts else 0,
        "maxPerDay": max(counts) if counts else 0,
    }


ROW_COLUMNS = ["year", "o_id", "title", "source", "type(a|p|v|d|i)",
               "thumb(storage id)", "excerpt(public OCR / contents / description)",
               "hYear(0 = unknown)", "country", "summaryFr(descriptionAI)",
               "summaryEn(descriptionAI_en)", "subjects([label, index o_id] ×≤3)"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[2])
    parser.add_argument("--output-dir", default="asset/data/on-this-day",
                        help="Fan-out directory (default: asset/data/on-this-day)")
    parser.add_argument("--no-hijri", dest="hijri", action="store_false",
                        help="Skip the Umm al-Qura fan-out (the block then "
                             "hides its calendar toggle)")
    add_standard_args(parser)
    args = parse_standard_args(parser)

    greg, hij, stats = collect_days(args.repo, hijri=args.hijri)
    out_dir = Path(args.output_dir)

    greg_total = write_fanout(greg, out_dir, args.minify)
    hij_total = write_fanout(hij, out_dir / "h", args.minify,
                             extra={"calendar": "islamic-umalqura"}) if args.hijri else 0

    save_json(
        {"_meta": create_metadata_block(
            total_records=greg_total,
            version=FORMAT_VERSION,
            columns=ROW_COLUMNS,
            types={f: stats[f"type_{f}"] for f in TYPE_FLAGS},
            gregorian=_spread(greg),
            hijri=_spread(hij) if args.hijri else None,
        ), "rich": rich_days(greg)},
        out_dir / "metadata.json", minify=args.minify,
    )
    logger.info("Wrote %d Gregorian day files (%d items)%s to %s",
                len(greg), greg_total,
                f" and {len(hij)} Hijri day files ({hij_total} items)" if args.hijri else "",
                out_dir)


if __name__ == "__main__":
    main()
