"""Strict parser for the Albani Zaria transcript markup.

Every transcript in the current pipeline has this shape (``bibo:content``,
e.g. item 15889)::

    ============================================================
    [Part 1]                                  one per media file; optional
    ============================================================  when there is only one
    [Segment 1/8 | 00:00:00–00:20:00]         fixed windows, en dash, last "…–end"
    [Speaker seg1-spk:0]                      diarisation label, local to the segment
    Masu kallon mu da sauraron mu …

Two variations are part of the format, not exceptions to it:

* A part shorter than one window has **no segment header**: its turns are
  labelled ``[Speaker spk:K]`` straight after ``[Part N]``. It parses as one
  implicit segment, ``1/1 | 00:00:00–end``.
* ``[Speaker unknown]`` is a turn the diariser could not attribute. It may
  stand wherever a speaker label may.

The parser is strict by instruction (curator, issue #31): anything else is a
``TranscriptFormatError``, never a best-effort parse. An unread line of
markup would otherwise be counted as Hausa, and *segment*, *speaker* and
*spk* would become the corpus's top words. The older Gemini format (items
15850 and 15878 until they are re-transcribed — per-turn ``[hh:mm:ss]``
times that reset each segment, ``[Segment N]`` without a total) is detected
first and raised as ``LegacyTranscriptError``, a subclass, so the generator
can keep those two out of the statistics by name while any OTHER failure
still stops the run.

Offsets are kept into the original text, so a concordance line is cut out of
the transcript exactly as it was written.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

#: The length of one window, in seconds. Asserted, not assumed: a segment
#: whose start is not ``(n - 1) × WINDOW_SECONDS`` is a format error.
WINDOW_SECONDS = 20 * 60

_BANNER = re.compile(r"^=+$")
_PART = re.compile(r"^\[Part (\d+)\]$")
_SEGMENT = re.compile(
    r"^\[Segment (\d+)/(\d+) \| (\d{2}):(\d{2}):(\d{2})–"
    r"(?:(\d{2}):(\d{2}):(\d{2})|end)\]$")
_SPEAKER = re.compile(r"^\[Speaker (?:seg(\d+)-spk:(\d+)|spk:(\d+)|unknown)\]$")

# The older Gemini pass. Any one of these anywhere marks the whole
# transcript as the legacy format.
_LEGACY = (
    re.compile(r"^Transcription of: "),
    re.compile(r"^Generated using: "),
    re.compile(r"^\[Segment \d+\]$"),
    re.compile(r"^\[\d{2}:\d{2}:\d{2}\] "),
)

# A whole line in square brackets that none of the patterns above claimed:
# an unknown marker. Inline brackets inside a text line (``[…]``, the ASR's
# elision mark) are text, and the tokenizer skips them.
_WHOLE_LINE_MARKER = re.compile(r"^\[[^\]]*\]$")


class TranscriptFormatError(ValueError):
    """The text is not in the transcript format. Never half-parse it."""


class LegacyTranscriptError(TranscriptFormatError):
    """The older per-turn-time format, awaiting re-transcription."""


@dataclass
class Turn:
    """One speaker turn: a label and the span of its text in the original."""

    speaker: str          # "spk:0", "spk:1", … or "unknown"
    start: int            # offset of the first text character
    end: int              # offset just past the last text character


@dataclass
class Segment:
    """One window of one media file — the "document" for the statistics."""

    part: int             # the [Part N] label
    ordinal: int          # 1-based position of that part: the k-th media file
    index: int            # 1-based
    total: int
    start_seconds: int
    end_seconds: Optional[int]   # None for the "…–end" window
    explicit: bool               # False for a short part's implicit window
    turns: List[Turn] = field(default_factory=list)


@dataclass
class Transcript:
    parts: int            # how many parts (media files)
    segments: List[Segment]

    def turns(self):
        for segment in self.segments:
            for turn in segment.turns:
                yield segment, turn


def _seconds(h: str, m: str, s: str) -> int:
    return int(h) * 3600 + int(m) * 60 + int(s)


def is_legacy(text: str) -> bool:
    """True when ``text`` is in the older Gemini format."""
    for line in text.splitlines():
        line = line.strip()
        if any(p.match(line) for p in _LEGACY):
            return True
    return False


def parse_transcript(text: str) -> Transcript:
    """Parse ``text`` or raise ``TranscriptFormatError`` naming the line."""
    if not isinstance(text, str) or not text.strip():
        raise TranscriptFormatError("empty transcript")
    if is_legacy(text):
        raise LegacyTranscriptError(
            "older per-turn-time format (Transcription of / Generated using / "
            "[hh:mm:ss] Speaker N:); awaiting re-transcription")

    segments: List[Segment] = []
    part = 0                 # current part number, 0 before the first
    ordinal = 0              # its position: the media file it transcribes
    saw_part_header = False
    segment: Optional[Segment] = None
    turn: Optional[Turn] = None
    prev_marker = ""         # the previous non-blank line's kind, for banners
    pending_banner = False   # a banner seen, waiting for its [Part N]

    def fail(lineno: int, why: str) -> None:
        raise TranscriptFormatError(f"line {lineno}: {why}")

    def close_part(lineno: int) -> None:
        part_segments = [s for s in segments if s.part == part]
        if not part_segments:
            if part:
                fail(lineno, f"part {part} has no speaker turns")
            return
        last = part_segments[-1]
        if last.explicit and (last.index != last.total or last.end_seconds is not None):
            fail(lineno, f"part {part} stops at segment {last.index}/{last.total} "
                         f"without its final '–end' window")

    offset = 0
    for lineno, raw_line in enumerate(text.splitlines(keepends=True), start=1):
        line_start = offset
        offset += len(raw_line)
        line = raw_line.rstrip("\r\n")
        stripped = line.strip()
        if not stripped:
            continue

        if _BANNER.match(stripped):
            # A banner frames a part header — above it or below it — and
            # nothing else. One anywhere else is a format change.
            if prev_marker == "part":
                prev_marker = "banner-after"
                continue
            if pending_banner:
                fail(lineno, "two banners without a [Part N] between them")
            pending_banner = True
            prev_marker = "banner"
            continue
        if pending_banner and not _PART.match(stripped):
            fail(lineno, "banner not followed by a [Part N] header")

        m = _PART.match(stripped)
        if m:
            number = int(m.group(1))
            if not saw_part_header and segments:
                fail(lineno, "[Part N] header after untitled content")
            # Increasing, not contiguous: 15857's four videos are Parts 4, 7,
            # 8 and 9 (the number appears to count the item's media, images
            # included). The k-th part is the k-th video in the IIIF manifest,
            # which is what `ordinal` is for.
            if number <= part:
                fail(lineno, f"part {number} follows part {part}")
            close_part(lineno)
            part = number
            ordinal += 1
            saw_part_header = True
            segment = None
            turn = None
            pending_banner = False
            prev_marker = "part"
            continue

        if part == 0:
            # A single-file transcript carries no [Part] header at all.
            part = 1
            ordinal = 1

        m = _SEGMENT.match(stripped)
        if m:
            index, total = int(m.group(1)), int(m.group(2))
            start = _seconds(m.group(3), m.group(4), m.group(5))
            end = (_seconds(m.group(6), m.group(7), m.group(8))
                   if m.group(6) is not None else None)
            previous = segment if segment is not None and segment.part == part else None
            if previous is not None and not previous.explicit:
                fail(lineno, "segment header in a part that already has unsegmented turns")
            expected = previous.index + 1 if previous else 1
            if index != expected:
                fail(lineno, f"segment {index} where {expected} was expected")
            if previous and total != previous.total:
                fail(lineno, f"segment total changes from {previous.total} to {total}")
            if index > total:
                fail(lineno, f"segment {index} of {total}")
            if start != (index - 1) * WINDOW_SECONDS:
                fail(lineno, f"segment {index} starts at {start}s, not "
                             f"{(index - 1) * WINDOW_SECONDS}s")
            if previous and previous.end_seconds != start:
                fail(lineno, "segment windows are not contiguous")
            if end is None and index != total:
                fail(lineno, f"'–end' on segment {index} of {total}")
            if end is not None and (index == total or end != start + WINDOW_SECONDS):
                fail(lineno, f"segment {index}/{total} ends at {end}s")
            segment = Segment(part, ordinal, index, total, start, end, explicit=True)
            segments.append(segment)
            turn = None
            prev_marker = "segment"
            continue

        m = _SPEAKER.match(stripped)
        if m:
            seg_no, seg_spk, bare_spk = m.group(1), m.group(2), m.group(3)
            current = segment if segment is not None and segment.part == part else None
            if seg_no is not None:
                if current is None or not current.explicit:
                    fail(lineno, "segment-local speaker outside a segment")
                if int(seg_no) != current.index:
                    fail(lineno, f"speaker of segment {seg_no} inside segment {current.index}")
                speaker = f"spk:{seg_spk}"
            elif bare_spk is not None:
                if current is not None and current.explicit:
                    fail(lineno, "unsegmented speaker label inside a segment")
                speaker = f"spk:{bare_spk}"
            else:
                speaker = "unknown"
            if current is None:
                # A part shorter than one window: one implicit segment.
                segment = Segment(part, ordinal, 1, 1, 0, None, explicit=False)
                segments.append(segment)
                current = segment
            turn = Turn(speaker, -1, -1)
            current.turns.append(turn)
            prev_marker = "speaker"
            continue

        if _WHOLE_LINE_MARKER.match(stripped):
            fail(lineno, f"unknown marker {stripped[:60]!r}")

        # A text line. It belongs to the open turn; text with no turn open is
        # either a format change or untitled preamble, and both are errors.
        if turn is None:
            fail(lineno, "text outside a speaker turn")
        lead = len(line) - len(line.lstrip())
        text_start = line_start + lead
        text_end = line_start + len(line.rstrip())
        if turn.start < 0:
            turn.start = text_start
        turn.end = text_end
        prev_marker = "text"

    if pending_banner:
        fail(lineno, "banner at the end of the transcript")
    close_part(lineno)
    if not segments:
        raise TranscriptFormatError("no segments or speaker turns")
    for seg in segments:
        # Drop turns with no text (a label followed directly by the next
        # label); they carry no words, and an offset of -1 would slice wrong.
        seg.turns = [t for t in seg.turns if t.start >= 0]
    return Transcript(parts=ordinal, segments=segments)


def window_label(segment: Segment) -> str:
    """``"00:40–01:00"`` / ``"02:20–end"`` — the window, never a quote time."""
    def hm(seconds: int) -> str:
        return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}"
    end = hm(segment.end_seconds) if segment.end_seconds is not None else "end"
    return f"{hm(segment.start_seconds)}–{end}"
