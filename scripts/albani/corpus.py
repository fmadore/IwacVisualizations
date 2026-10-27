"""The corpus: which recordings, read how, and what each segment is.

**Scope (curator, issue #31): Albani Zaria only.** The corpus is the
``deposited`` audiovisual items whose ``creator`` includes *Muhammad Auwal
Albani Zaria*, matched as a pipe-split value, never as a substring. That
excludes the two francophone radio items (78275, 78278) and anything a
future deposit adds under another preacher's name. There is deliberately no
generic "Hausa sermons" abstraction.

Every recording ends up in exactly one ``status``:

``analysed``       transcript in the current format, parsed
``legacy``         the older Gemini format (15850, 15878): listed, kept out of
                   every statistic until re-transcribed — never half-parsed
``untranscribed``  no transcript yet

Any other unreadable transcript raises ``TranscriptFormatError`` and stops
the run, by instruction: counting markup as Hausa is worse than no bundle.

Two segment-level facts decide what the statistics may count:

* **Language.** The English-only recording (15884) and the ``Haoussa|Anglais``
  ones stay in the listing, but an English segment is kept out of the Hausa
  statistics — segment by segment, by its share of English function words.
* **Mode.** Speaker labels are local to a segment, so they cannot attribute
  words to Albani across a recording; what they can show is where the
  monologue gives way to an exchange (questions and answers, a phone-in, a
  visit). An exchange segment's words are partly a visitor's or a
  questioner's, so the generator publishes a ``monologue`` scope beside
  ``all`` rather than pooling them silently.
"""
from __future__ import annotations

import json
import logging
import math
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from iwac_utils import (
    clean_int, clean_str, extract_year, is_public_flag, parse_pipe_separated,
)

from albani.layers import FORMULA_PREFIX, is_english, label_tokens
from albani.lexicon import Hit, Lexicon
from albani.normalize import Token, tokenize
from albani.transcript import (
    WINDOW_SECONDS, LegacyTranscriptError, Segment, TranscriptFormatError,
    parse_transcript,
)

CREATOR = "Muhammad Auwal Albani Zaria"

COLUMNS = [
    "o:id", "title", "iwac_url", "source_type", "creator", "pub_date",
    "extent", "duration_seconds", "language", "subject", "OCR",
    "OCR_is_public", "iiif_manifest", "is_part_of",
]

ANALYSED, LEGACY, UNTRANSCRIBED = "analysed", "legacy", "untranscribed"
MONOLOGUE, EXCHANGE = "monologue", "exchange"

#: A segment is an exchange when its main speaker says less than this share
#: of its words over at least EXCHANGE_MIN_TURNS turns. A two-turn segment
#: where the second voice says "Na'am" is still a monologue.
EXCHANGE_MAIN_SHARE = 0.85
EXCHANGE_MIN_TURNS = 3

logger = logging.getLogger(__name__)


def is_albani(row: Dict[str, Any]) -> bool:
    """Deposited, and Albani Zaria among the pipe-split creators."""
    if clean_str(row.get("source_type")) != "deposited":
        return False
    return CREATOR in parse_pipe_separated(row.get("creator"))


@dataclass
class TurnScan:
    speaker: str
    start: int
    end: int
    tokens: List[Token]
    labels: List[str]
    hits: List[Hit]
    excluded: List[Hit]


@dataclass
class SegmentScan:
    segment: Segment
    turns: List[TurnScan]
    mode: str
    english: bool

    @property
    def counted(self) -> bool:
        """In the Hausa statistics: every non-English segment."""
        return not self.english

    @property
    def n_tokens(self) -> int:
        return sum(len(t.tokens) for t in self.turns)

    def in_scope(self, scope: str) -> bool:
        return self.counted and (scope == "all" or self.mode == MONOLOGUE)


@dataclass
class Recording:
    o_id: str
    title: str
    url: str
    date: str
    year: Optional[int]
    duration_seconds: Optional[int]
    languages: List[str]
    subjects: List[str]
    series: str
    public: bool
    status: str
    manifest_url: str = ""
    text: str = ""
    segments: List[SegmentScan] = field(default_factory=list)
    media: List[Dict[str, Any]] = field(default_factory=list)
    parts: int = 0

    @property
    def english_only(self) -> bool:
        return bool(self.languages) and all(lang == "Anglais" for lang in self.languages)


def _segment_mode(turns: List[TurnScan]) -> str:
    words: Counter = Counter()
    for turn in turns:
        words[turn.speaker] += len(turn.tokens)
    total = sum(words.values())
    if len(words) < 2 or len(turns) < EXCHANGE_MIN_TURNS or not total:
        return MONOLOGUE
    return EXCHANGE if words.most_common(1)[0][1] / total < EXCHANGE_MAIN_SHARE else MONOLOGUE


def scan_text(text: str, lexicon: Lexicon, english_only: bool = False) -> tuple:
    """Parse and scan one transcript: ``(parts, [SegmentScan])``.

    Raises ``TranscriptFormatError`` (``LegacyTranscriptError`` for the old
    format) — the caller decides which of those is fatal.
    """
    transcript = parse_transcript(text)
    scans: List[SegmentScan] = []
    for segment in transcript.segments:
        turns = []
        for turn in segment.turns:
            tokens = tokenize(text, turn.start, turn.end)
            labels = label_tokens(tokens)
            skip = [lab.startswith(FORMULA_PREFIX) for lab in labels]
            hits, excluded = lexicon.match(tokens, skip)
            turns.append(TurnScan(turn.speaker, turn.start, turn.end, tokens,
                                  labels, hits, excluded))
        seg_tokens = [tok for t in turns for tok in t.tokens]
        english = english_only or is_english(seg_tokens)
        scans.append(SegmentScan(segment, turns, _segment_mode(turns), english))
    return transcript.parts, scans


def build_recording(row: Dict[str, Any], lexicon: Lexicon) -> Recording:
    o_id = clean_str(row.get("o:id"))
    date = clean_str(row.get("pub_date"))
    languages = parse_pipe_separated(row.get("language"))
    rec = Recording(
        o_id=o_id,
        title=clean_str(row.get("title")),
        url=clean_str(row.get("iwac_url")),
        date=date,
        year=extract_year(date) if date else None,
        duration_seconds=clean_int(row.get("duration_seconds")),
        languages=languages,
        subjects=parse_pipe_separated(row.get("subject")),
        series=clean_str(row.get("is_part_of")),
        public=is_public_flag(row.get("OCR_is_public")),
        status=UNTRANSCRIBED,
        manifest_url=clean_str(row.get("iiif_manifest")),
    )
    text = row.get("OCR")
    if not isinstance(text, str) or not text.strip():
        return rec
    try:
        rec.parts, rec.segments = scan_text(text, lexicon, english_only=rec.english_only)
    except LegacyTranscriptError:
        rec.status = LEGACY
        logger.warning(f"  {o_id} {rec.title!r}: older transcript format, kept out "
                       f"of the statistics until it is re-transcribed")
        return rec
    except TranscriptFormatError as exc:
        # Fatal by instruction (issue #31): never count unread markup.
        raise TranscriptFormatError(f"item {o_id} ({rec.title}): {exc}") from exc
    rec.status = ANALYSED
    rec.text = text
    return rec


def fetch_media(rec: Recording, timeout: float = 20.0) -> None:
    """Fill ``rec.media`` from the item's IIIF manifest, one entry a part.

    The k-th ``[Part]`` of a transcript is the k-th video canvas (part
    *numbers* are not contiguous — 15857's are 4, 7, 8, 9). A failure is
    logged and leaves ``media`` empty: the concordance then links the item
    page instead of the 20-minute window, which is a weaker link, not a
    wrong one.
    """
    if not rec.manifest_url:
        return
    try:
        with urllib.request.urlopen(rec.manifest_url, timeout=timeout) as resp:
            manifest = json.load(resp)
    except Exception as exc:  # noqa: BLE001 — any failure degrades the same way
        logger.warning(f"  {rec.o_id}: IIIF manifest unavailable ({exc}); "
                       f"windows will link to the item page")
        return
    media = []
    for canvas in manifest.get("items", []) or []:
        bodies = [b.get("body", {}) for page in canvas.get("items", []) or []
                  for b in page.get("items", []) or []]
        url = next((b.get("id") for b in bodies
                    if isinstance(b, dict) and str(b.get("type", "")).lower() in ("video", "sound")
                    and b.get("id")), None)
        if url is None:
            url = next((b.get("id") for b in bodies if isinstance(b, dict) and b.get("id")), None)
        if url:
            duration = canvas.get("duration")
            media.append({"url": url,
                          "duration": round(float(duration)) if duration else None})
    rec.media = media
    if rec.status == ANALYSED and media and len(media) != rec.parts:
        logger.warning(f"  {rec.o_id}: {rec.parts} transcript parts but {len(media)} "
                       f"media in the manifest; windows will link to the item page")
        rec.media = []
        return
    # A part's window count should follow from its running time. A mismatch
    # is worth a line in the log, not a failed run: the windows are still
    # contiguous and correctly numbered, which the parser has proved.
    for ordinal, item in enumerate(rec.media, start=1):
        expected = math.ceil(item["duration"] / WINDOW_SECONDS) if item.get("duration") else None
        got = max((s.segment.total for s in rec.segments if s.segment.ordinal == ordinal),
                  default=None)
        if expected and got and expected != got and got != 1:
            logger.info(f"  {rec.o_id} part {ordinal}: {got} windows for "
                        f"{item['duration']}s of media (expected {expected})")
