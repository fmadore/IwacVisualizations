#!/usr/bin/env python3
"""
IWAC Shared Utilities

Common functions used across IWAC data generation scripts.
This module centralizes duplicated code from the generator scripts.

Functions:
- canonical_country: Canonical display form for a country name
- canonicalize_country_field: Apply canonical_country to a (possibly
  pipe-separated) DataFrame cell, preserving the original for None/NaN
- normalize_country: Normalize country values (handles |, ,, ; separators)
- first_country: The first (or first known) canonical country of a cell
- extract_year: Extract year from various date formats
- extract_month_num: Pull the 1–12 month number out of a "YYYY-MM[-DD]" date
- read_hijri_month: The row's stored (hijri_year, hijri_month), or None
- parse_coordinates: Parse "lat, lng" or "lat lng" strings (or tuple/list)
- normalize_location_name: The one name-matching key (NFC, case, whitespace)
- build_entity_index: The index subset as name / id / coordinate lookups
- place_country_resolver: Place title -> the IWAC country it lies in
  (the ``Partie de`` walk), never the countries it is mentioned in
- compute_top_entities: Entities ranked by subject + place tag memberships
- lda_topic_id: An ``lda_topic_id`` cell as a topic id, or None
- dominant: The most common key of a Counter, ties broken by key
- parse_pipe_separated: Parse multivalue fields
- tokenize: Word-cloud tokenizer (lowercase, strip punctuation, drop
  stopwords and short tokens)
- parse_topk: Parse an "id:prob|id:prob|..." LDA mixture cell
- parse_top_words: Split an lda_topic_label chain into its top words
- aggregate_prevalence: Probability-weighted per-year topic prevalence
  from lda_topic_topk, with the captured mass reported un-normalised
- clean_str: Strip-and-cast a DataFrame cell, treating NaN/None as ""
- clean_float: Cast a DataFrame cell to float, or None for garbage
- load_dataset_safe: Load HuggingFace dataset with error handling
- iter_records: Row-wise iteration as plain dicts (the iterrows replacement)
- find_column: Find first matching column in DataFrame
- sentiment_columns: Candidate HF column names for one model x field
- resolve_sentiment_columns: Map canonical model ids onto the sentiment
  columns actually present, warning when a model resolves to nothing
- present_sentiment_models: The subset of those ids that actually resolved,
  for a payload's `models` array
- subjectivite_ordinal: Subjectivite label (or legacy number) -> 1..5
- save_json: Save JSON with mkdir and optional minification
- configure_logging: Standard logging setup
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

try:
    import pandas as pd
except ImportError:
    raise ImportError(
        "Required package not installed. Please run:\n"
        "pip install pandas"
    )


# =============================================================================
# Constants
# =============================================================================

DATASET_ID = "fmadore/islam-west-africa-collection-full"
"""Default Hugging Face dataset ID for IWAC.

Since 2026-07 this is the PRIVATE full mirror (it carries the OCR /
lemma_nostop / embedding columns the generators need; the public repo is a
projection without the full-text columns). Reading it requires a Hugging
Face token: `datasets` picks up the ``HF_TOKEN`` environment variable
automatically — set as a repo secret in CI, or locally via
``$env:HF_TOKEN`` / ``hf auth login``.
"""

IWAC_COUNTRIES = ["Bénin", "Burkina Faso", "Côte d'Ivoire", "Niger", "Nigeria", "Togo"]
"""The six countries the collection covers, in the canonical spellings
:func:`canonical_country` produces and ``asset/geo/iwac-countries.geojson``
keys on.

One list: the spatial generator restated it as ``FOCUS_COUNTRIES`` and four
generators counted a raw ``country`` cell without canonicalising at all, so
"Benin", "Bénin" and "benin" could land in three different buckets of the
same chart.
"""

SUBSETS = ["articles", "audiovisual", "documents", "images", "publications", "references", "index"]
"""Available subsets in the IWAC dataset."""

AUTHORITY_PLACEHOLDER_TYPE = "Notices d'autorité"
"""The index subset flags bibliographic authority placeholders with this
``Type``; entity lookups skip them so they never surface as entities."""


# =============================================================================
# Logging Configuration
# =============================================================================

def configure_logging(level: int = logging.INFO) -> logging.Logger:
    """
    Configure standard logging for IWAC scripts.

    Args:
        level: Logging level (default: logging.INFO)

    Returns:
        Logger instance for the calling module
    """
    logging.basicConfig(
        level=level,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    return logging.getLogger(__name__)


# =============================================================================
# Shared CLI plumbing
# =============================================================================

def add_standard_args(
    parser: "argparse.ArgumentParser",
    minify_default: bool = True,
) -> "argparse.ArgumentParser":
    """
    Attach the CLI flags every generator shares: ``--repo``, ``--minify``
    (BooleanOptionalAction) and ``-v/--verbose``. Generator-specific flags
    stay at the call site; pair with :func:`parse_standard_args` to
    collapse the whole copy-pasted prologue.

    Args:
        parser: The generator's ArgumentParser.
        minify_default: Default for ``--minify`` (heavy fan-outs keep True).

    Returns:
        The same parser, for chaining.
    """
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repository ID (default: %(default)s)",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=minify_default,
        help="Produce compact JSON (no indentation) (default: %(default)s)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    return parser


def parse_standard_args(parser: "argparse.ArgumentParser") -> "argparse.Namespace":
    """``parse_args()`` + ``configure_logging`` keyed on ``-v`` — the
    shared epilogue of every generator's ``main()``."""
    args = parser.parse_args()
    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    return args


# =============================================================================
# Country/Location Normalization
# =============================================================================

# Canonical spellings for country names that ``str.title()`` would mangle —
# notably anything with apostrophes ("Cote D'Ivoire") or accents we want to
# preserve. Keys are lowercased; values are the desired display form.
COUNTRY_DISPLAY_OVERRIDES: Dict[str, str] = {
    "cote d'ivoire":  "Côte d'Ivoire",
    "côte d'ivoire":  "Côte d'Ivoire",
    "cote divoire":   "Côte d'Ivoire",
    "ivory coast":    "Côte d'Ivoire",
    "burkina faso":   "Burkina Faso",
    "benin":          "Bénin",
    "bénin":          "Bénin",
    "niger":          "Niger",
    "nigeria":        "Nigeria",
    "togo":           "Togo",
}


def canonical_country(name: str) -> str:
    """Apply IWAC display overrides on top of ``str.title()``.

    ``str.title()`` re-capitalizes after every non-letter, so
    ``"côte d'ivoire".title() == "Côte D'Ivoire"`` — ugly. This helper
    returns the canonical IWAC spelling for known names and falls back
    to the title-cased input for anything else.
    """
    s = str(name).strip()
    if not s:
        return s
    key = unicodedata.normalize('NFC', s.lower())
    if key in COUNTRY_DISPLAY_OVERRIDES:
        return COUNTRY_DISPLAY_OVERRIDES[key]
    return s.title()


def canonicalize_country_field(value: Any) -> Any:
    """Map a DataFrame country cell to its canonical form.

    Handles the three shapes the cell can take:
      - None / NaN / empty → returned unchanged (so pandas apply() keeps
        the column dtype sane)
      - Pipe-separated string → canonicalized per segment and rejoined
      - Plain string → canonicalized

    Used by every generator that reads the ``country`` / ``countries``
    columns and wants a stable display form before aggregating.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return value
    s = str(value)
    if not s.strip():
        return value
    if "|" in s:
        return "|".join(
            canonical_country(p) for p in s.split("|") if p.strip()
        )
    return canonical_country(s)


def normalize_country(
    value: Any,
    return_list: bool = True,
    unknown_value: str = "Unknown"
) -> Union[List[str], str]:
    """
    Normalize country values to a consistent format.

    Handles:
    - None/NaN values -> returns unknown_value
    - Lists/tuples -> normalizes each element
    - Strings with separators (|, ,, ;, /) -> splits and normalizes

    Args:
        value: The country value to normalize
        return_list: If True, always return a list; if False, return single string
        unknown_value: Value to use for missing/empty data

    Returns:
        List of normalized country names (if return_list=True) or single string

    Examples:
        >>> normalize_country("Benin")
        ["Bénin"]
        >>> normalize_country("benin|togo")
        ["Bénin", "Togo"]
        >>> normalize_country("cote d'ivoire")
        ["Côte d'Ivoire"]
        >>> normalize_country(None)
        ["Unknown"]
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return [unknown_value] if return_list else unknown_value

    if isinstance(value, (list, tuple)):
        countries = [canonical_country(c) for c in value if str(c).strip()]
        result = countries if countries else [unknown_value]
        return result if return_list else (result[0] if len(result) == 1 else ", ".join(result))

    country_str = str(value).strip()
    if not country_str:
        return [unknown_value] if return_list else unknown_value

    # Handle multiple countries separated by common delimiters
    for sep in ["|", ";", ",", "/"]:
        if sep in country_str:
            countries = [canonical_country(c) for c in country_str.split(sep) if c.strip()]
            result = countries if countries else [unknown_value]
            return result if return_list else (result[0] if len(result) == 1 else ", ".join(result))

    result = canonical_country(country_str)
    return [result] if return_list else result


def first_country(value: Any, *, skip_unknown: bool = False) -> str:
    """The canonical first country of a pipe-separated cell, or ``""``.

    Two rules, both deliberate, which is why this is one function with a
    switch rather than two copies that drift:

    * default — the FIRST segment, or ``""`` when that first segment is a
      placeholder (``is_unknown``). An item whose cell opens with
      "Unknown" is filed under no country: the dashboards and the topic /
      template summaries ask "where is this item filed".
    * ``skip_unknown=True`` — the first KNOWN segment. Keyness asks "which
      country corpus does this item join", and an item naming a real
      country after a placeholder joins that country's.

    Splits on ``|`` only — the dataset's one multi-value separator — and
    canonicalises the answer (``canonical_country``), so "Benin" and
    "Bénin" land in one bucket.
    """
    for segment in parse_pipe_separated(value):
        if not is_unknown(segment):
            return canonical_country(segment)
        if not skip_unknown:
            return ""
    return ""


_WHITESPACE_RUN = re.compile(r"\s+")


def normalize_location_name(name: str) -> str:
    """
    The one key every name-to-entity join matches on.

    Applies:
    - Unicode NFC normalization
    - Lowercase conversion
    - Whitespace stripping, and every internal whitespace run collapsed to
      one space

    Both sides of a join must go through this, which is the point of it
    being one function: four generators used to build their own index
    lookups — one raw and case-sensitive, one lowercasing and collapsing
    whitespace without NFC, two through this — so the same tag linked to
    its authority record in one block and not in another.

    Args:
        name: Location name to normalize

    Returns:
        Normalized location name string

    Examples:
        >>> normalize_location_name("  Abidjan  ")
        "abidjan"
        >>> normalize_location_name("Côte d'Ivoire")
        "côte d'ivoire"
        >>> normalize_location_name("Abdoulaye   Wade")
        "abdoulaye wade"
    """
    if not name:
        return ""
    return _WHITESPACE_RUN.sub(" ", unicodedata.normalize('NFC', str(name).strip().lower()))


# =============================================================================
# Date Extraction
# =============================================================================

FULL_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
"""Strict ISO full date (YYYY-MM-DD, anchored) with year/month/day groups.

Strict: rejects year-only / year-month values and anything with a time
suffix. (corpus-health's coverage metric deliberately keeps its looser
prefix match — see generate_corpus_health.py.)"""


# Nearly every date in this dataset is "YYYY", "YYYY-MM" or "YYYY-MM-DD".
# `pd.to_datetime` on a single scalar is a full parser invocation, and
# `extract_year` is called from ~40 sites, several passes deep over 12k
# rows. Matching the ISO shape first answers the common case in
# microseconds and hands everything else to pandas unchanged, so the
# OUTPUT is identical and only the path taken differs.
_ISO_YEAR_RE = re.compile(r"^(\d{4})(?:-\d{2}(?:-\d{2})?)?$")


def extract_year(
    value: Any,
    min_year: int = 1800,
    max_year: int = 2100
) -> Optional[int]:
    """
    Extract year from various date formats.

    Handles:
    - datetime/Timestamp objects
    - Strings in YYYY-MM-DD, YYYY-MM, or YYYY format
    - Integer/float year values

    Args:
        value: Date value to extract year from
        min_year: Minimum valid year (default: 1800)
        max_year: Maximum valid year (default: 2100)

    Returns:
        Year as integer, or None if extraction fails

    Examples:
        >>> extract_year("2023-05-15")
        2023
        >>> extract_year("2023")
        2023
        >>> extract_year(datetime(2023, 5, 15))
        2023
        >>> extract_year("invalid")
        None
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    try:
        # Handle datetime objects
        if isinstance(value, (pd.Timestamp, datetime)):
            year = value.year
            if min_year <= year <= max_year:
                return year
            return None

        # Handle strings
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None

            # ISO first — see _ISO_YEAR_RE.
            iso = _ISO_YEAR_RE.match(value)
            if iso:
                year = int(iso.group(1))
                return year if min_year <= year <= max_year else None

            # Try pandas datetime parsing
            dt = pd.to_datetime(value, errors='coerce')
            if pd.notna(dt):
                year = dt.year
                if min_year <= year <= max_year:
                    return year

            # Try extracting 4-digit year with regex
            year_match = re.search(r'\b(19|20)\d{2}\b', value)
            if year_match:
                year = int(year_match.group())
                if min_year <= year <= max_year:
                    return year

        # Handle numeric values
        elif isinstance(value, (int, float)):
            year = int(value)
            if min_year <= year <= max_year:
                return year

        # Try generic datetime conversion
        dt = pd.to_datetime(value, errors='coerce')
        if pd.notna(dt):
            year = dt.year
            if min_year <= year <= max_year:
                return year

    # Narrowed from a bare `except Exception`. What can actually be raised
    # here is a bad value (ValueError), a type pandas will not take
    # (TypeError), or an out-of-range timestamp (OverflowError) — a bare
    # catch also swallowed a KeyboardInterrupt, or a bug in this function,
    # and returned None as though the date were simply unparseable.
    except (ValueError, TypeError, OverflowError):
        pass

    return None


_MONTH_NUM_PATTERN = re.compile(r"^\d{4}-(\d{2})")


def extract_month_num(date_str: Any) -> Optional[int]:
    """Pull a 1–12 month number out of an ISO-ish ``YYYY-MM[-DD]`` date.

    Returns ``None`` for bare year strings (``"1995"``), empty / NaN
    inputs, or anything where the month segment is not a valid 1–12
    integer.
    """
    if date_str is None or (isinstance(date_str, float) and pd.isna(date_str)):
        return None
    s = str(date_str)
    if not s:
        return None
    m = _MONTH_NUM_PATTERN.match(s)
    if not m:
        return None
    try:
        n = int(m.group(1))
    except (TypeError, ValueError):
        return None
    if 1 <= n <= 12:
        return n
    return None


# The Hijri columns the dataset ships beside ``pub_date``, written
# upstream by ``calculate_hijri_dates.py`` from the Umm al-Qura tables.
# Read, never recomputed: the browser's ICU tables disagree with these on
# ~75% of this collection's pre-2000 days, which at a month-granularity
# grid moved 0.78% of items into the wrong lunar month back when the
# client did the conversion itself.
#
# Present on ``articles``, ``publications``, ``documents``,
# ``audiovisual`` and ``images``. ``references`` is excluded upstream on
# purpose — an academic imprint date has no meaningful lunar reading.
HIJRI_COLUMNS = ("hijri_year", "hijri_month", "hijri_day")


def read_hijri_month(row: Any, cols: Dict[str, Optional[str]]
                     ) -> Optional[Tuple[int, int]]:
    """The row's stored ``(hijri_year, hijri_month)``, or None.

    None means the dataset left the conversion empty, which it does for
    every ``pub_date`` that is not a complete ``YYYY-MM-DD`` — the same
    rows a day-precision extractor already drops.

    Goes through ``int()`` inside the guard rather than trusting the
    column dtype. The pipeline stores them nullable ``int64``, but
    revisions published before its canonical types had ``float64`` on
    several subsets. Pandas widens them to float on read anyway wherever
    a partial date leaves a null, and returns numpy ``int64`` where none
    does. ``int(nan)`` raises ``ValueError``, which is caught here.
    """
    y_col, m_col = cols.get("hijri_year"), cols.get("hijri_month")
    if not y_col or not m_col:
        return None
    try:
        h_year, h_month = int(row.get(y_col)), int(row.get(m_col))
    except (TypeError, ValueError):
        return None
    if not (1 <= h_month <= 12 and h_year > 0):
        return None
    return h_year, h_month


# =============================================================================
# Coordinate Parsing
# =============================================================================

_COORD_PATTERN = re.compile(r'(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)')


def parse_coordinates(value: Any) -> Optional[Tuple[float, float]]:
    """
    Parse coordinates into a (lat, lng) tuple.

    Accepted input shapes:
      - ``"lat, lng"``  — comma-separated string (with or without space)
      - ``"lat lng"``   — whitespace-separated string
      - ``(lat, lng)`` / ``[lat, lng]`` — 2-element tuple or list

    Returns ``None`` for anything that doesn't parse cleanly, or for
    coordinates outside the valid geographic range (|lat| > 90 or
    |lng| > 180).

    Examples:
        >>> parse_coordinates("12.34, -56.78")
        (12.34, -56.78)
        >>> parse_coordinates("12.34 -56.78")
        (12.34, -56.78)
        >>> parse_coordinates((12.34, -56.78))
        (12.34, -56.78)
        >>> parse_coordinates("invalid")
        None
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    if isinstance(value, (tuple, list)) and len(value) == 2:
        try:
            lat = float(value[0])
            lng = float(value[1])
        except (TypeError, ValueError):
            return None
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            return (lat, lng)
        return None

    s = str(value).strip()
    if not s:
        return None

    match = _COORD_PATTERN.search(s)
    if not match:
        return None
    try:
        lat = float(match.group(1))
        lng = float(match.group(2))
    except ValueError:
        return None
    if -90 <= lat <= 90 and -180 <= lng <= 180:
        return (lat, lng)
    return None


# =============================================================================
# Multi-Value Field Parsing
# =============================================================================

def parse_pipe_separated(value: Any) -> List[str]:
    """
    Parse pipe-separated values into a list of trimmed strings.

    Args:
        value: Value to parse (string, list, or None)

    Returns:
        List of trimmed strings (empty list if no valid values)

    Examples:
        >>> parse_pipe_separated("value1|value2|value3")
        ["value1", "value2", "value3"]
        >>> parse_pipe_separated(["a", "b"])
        ["a", "b"]
        >>> parse_pipe_separated(None)
        []
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return []

    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]

    value_str = str(value).strip()
    if not value_str:
        return []

    # Split by pipe and clean
    return [v.strip() for v in value_str.split('|') if v.strip()]


def clean_str(value: Any) -> str:
    """Strip-and-cast a DataFrame cell, treating NaN/None as empty.

    Centralised so every generator agrees on the "empty" rules —
    pandas cells that come back as ``float('nan')`` are common and
    each generator used to reimplement this guard locally.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def clean_float(value: Any) -> Optional[float]:
    """Cast a DataFrame cell to float, or None for NaN / missing / garbage."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def clean_int(value: Any) -> Optional[int]:
    """Cast a DataFrame cell to int, or None for NaN / missing / garbage.

    Integer counterpart of ``clean_float``; several generators carried a
    local ``_int_or_none`` with this exact body.
    """
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


# Matches ISO 8601 durations like ``PT1H30M15S``, ``PT571M``, ``PT2M34S``.
# ``dcterms:extent`` on the audiovisual subset is written in this form for
# both populations — the deposited recordings (``PT571M``) and the YouTube
# cohort (``PT2M34S``).
_ISO8601_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+(?:\.\d+)?)D)?"
    r"(?:T"
    r"(?:(?P<hours>\d+(?:\.\d+)?)H)?"
    r"(?:(?P<minutes>\d+(?:\.\d+)?)M)?"
    r"(?:(?P<seconds>\d+(?:\.\d+)?)S)?"
    r")?$"
)

# Matches ``HH:MM:SS`` or ``MM:SS``.
_HMS_DURATION_RE = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2})$")


def parse_duration_seconds(value: Any) -> Optional[int]:
    """Parse a duration into whole seconds, or None when unparseable.

    Accepts the three shapes the collection actually carries:

    * ISO 8601 — ``PT1H30M15S``, ``PT571M``, ``PT2M34S`` (``dcterms:extent``)
    * ``HH:MM:SS`` / ``MM:SS``
    * a bare number, **read as seconds**

    The bare-number contract is deliberate. An earlier local copy of this
    parser returned numerics unit-agnostically and let the caller guess
    ("median > 500 ⇒ seconds, else minutes"), which turns a corpus of short
    clips into a 60× overcount the moment a numeric column appears: the
    YouTube cohort's median runtime is ~183 s, so that heuristic would have
    read three-minute videos as three-hour ones. Callers that hold a column
    whose unit they know should convert it themselves rather than route it
    through here.

    Returns None (not 0) for garbage, so callers can distinguish "no
    duration recorded" from "zero-length".
    """
    if value is None:
        return None
    try:
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass

    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(float(value))) if value >= 0 else None

    s = str(value).strip()
    if not s:
        return None

    try:
        numeric = float(s)
    except ValueError:
        pass
    else:
        return int(round(numeric)) if numeric >= 0 else None

    m = _ISO8601_DURATION_RE.match(s)
    if m and any(m.group(g) for g in ("days", "hours", "minutes", "seconds")):
        days = float(m.group("days") or 0)
        hours = float(m.group("hours") or 0)
        minutes = float(m.group("minutes") or 0)
        seconds = float(m.group("seconds") or 0)
        return int(round(days * 86400 + hours * 3600 + minutes * 60 + seconds))

    m = _HMS_DURATION_RE.match(s)
    if m:
        hours = float(m.group(1) or 0)
        minutes = float(m.group(2) or 0)
        seconds = float(m.group(3) or 0)
        return int(round(hours * 3600 + minutes * 60 + seconds))

    return None


def is_unknown(value: Any) -> bool:
    """True for empty / 'unknown'-like labels (matches the JS-side P.isUnknown).

    Centralises the local ``_is_unknown`` several generators duplicated. The
    membership set covers the FR/EN placeholders the dataset uses for a missing
    value: unknown / inconnu / n/a / na / none / null / em-dash.
    """
    if value is None:
        return True
    try:
        if bool(pd.isna(value)):
            return True
    except (TypeError, ValueError):
        # Non-scalar containers are not valid labels, but they are not an
        # empty/unknown sentinel either; stringify consistently below.
        pass
    normalized = str(value).strip().lower()
    return normalized == "" or normalized in {
        "unknown", "inconnu", "n/a", "na", "none", "null", "—"
    }


def clean_known_str(value: Any) -> str:
    """``clean_str`` that also blanks the dataset's unknown placeholders.

    ``clean_str`` keeps "Unknown" as a string, which is right for a title
    and wrong for a label that will be counted; this is the counting
    variant (the references generator carried it as ``_clean_text``).
    """
    text = clean_str(value)
    return "" if is_unknown(text) else text


def clean_values(values: Any) -> List[str]:
    """Strip a list of labels and drop the empty and unknown ones.

    The usual companion of ``parse_pipe_separated``: the pipe splitter
    keeps every non-empty segment, this drops the ``Unknown`` / ``n/a``
    placeholders a multi-value cell can carry among real values.
    """
    return [v for v in (str(s).strip() for s in (values or [])) if v and not is_unknown(v)]


def top_n_pipe(rows: Any, field: str, n: Optional[int] = None) -> List[Dict[str, Any]]:
    """Histogram of a pipe-separated column as ``[{name, count}, …]``.

    Every value of every row counts once, unknowns dropped, most common
    first; ``n=None`` keeps every value. Two overview generators carried
    this as ``_top_n_pipe``.
    """
    counter: Counter = Counter()
    for value in rows.get(field, []):
        for v in clean_values(parse_pipe_separated(value)):
            counter[v] += 1
    return [
        {"name": name, "count": int(count)}
        for name, count in counter.most_common(n)
    ]


ENTITY_TYPE_ORDER: Tuple[str, ...] = (
    "Personnes",
    "Organisations",
    "Lieux",
    "Sujets",
    "Événements",
)
"""The five explorable index ``Type`` values, in the module's default order.

The order the shared entities panel (``shared/entities-panel.js``
``DEFAULT_ORDER``) and the dashboards' type filter use. A payload keyed by
type is emitted in this order so two generators feeding the same panel
cannot disagree about it; a block that wants another tab order (the index
overview puts places second) sets it on the client.
"""


def build_entity_index(
    df: Any,
    *,
    types: Optional[Iterable[str]] = None,
    aliases: bool = True,
    keep_row: bool = False,
    on_entity: Optional[Any] = None,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[int, Dict[str, Any]], Dict[int, Tuple[float, float]]]:
    """The index subset as three lookups: name → entity, id → entity, Lieux coordinates.

    The one index lookup. Every generator that joins a tag, a byline or a
    provenance label to its authority record goes through here, so they
    all agree on which names match: four hand-written copies normalised
    keys four ways (raw and case-sensitive, lowercase without NFC, …) and
    the same tag linked in one block and not in the next.

    A name key is ``normalize_location_name`` of the title and, with
    ``aliases``, of every ``Titre alternatif``. **Titles are registered
    before any alias**, so another record's alias can never shadow a
    title; among titles, and among aliases, the first writer wins.
    Authority placeholders (``AUTHORITY_PLACEHOLDER_TYPE``) and rows
    without an id or a title are skipped; a ``Lieux`` row with parseable
    coordinates is recorded for the maps.

    ``types`` keeps only those ``Type`` values (a places-only join passes
    ``{"Lieux"}`` so a person's alias cannot capture a place name).

    The index's ``countries`` column is "countries this entity has been
    MENTIONED in", not "country this place is located in", so no country
    is recorded for a place — see :func:`place_country_resolver`.

    ``keep_row`` keeps the DataFrame row on the info dict (the aggregator's
    header builders read more columns later); ``on_entity(info)`` is called
    for every entity kept, so a caller can pick its targets in the same
    pass. Raises ``RuntimeError`` when the id / title / type columns are
    missing.

    Returns ``(entity_lookup, id_to_entity, lieux)`` — the last keyed by
    o_id with ``(lat, lng)`` values.
    """
    id_col = find_column(df, ["o:id", "id"])
    title_col = find_column(df, ["Titre", "dcterms:title"])
    type_col = find_column(df, ["Type"])
    if not (id_col and title_col and type_col):
        raise RuntimeError(
            f"index subset missing required columns: id={id_col}, title={title_col}, type={type_col}"
        )
    alt_col = find_column(df, ["Titre alternatif", "dcterms:alternative"]) if aliases else None
    coord_col = find_column(df, ["Coordonnées", "coordinates"])
    wanted = (
        {unicodedata.normalize("NFC", t) for t in types} if types is not None else None
    )

    entity_lookup: Dict[str, Dict[str, Any]] = {}
    id_to_entity: Dict[int, Dict[str, Any]] = {}
    lieux: Dict[int, Tuple[float, float]] = {}
    pending_aliases: List[Tuple[Any, Dict[str, Any]]] = []

    for _, row in df.iterrows():
        o_id = row.get(id_col)
        try:
            o_id = int(o_id)
        except (TypeError, ValueError):
            continue

        entity_type = unicodedata.normalize("NFC", clean_str(row.get(type_col)))
        if not entity_type or entity_type == AUTHORITY_PLACEHOLDER_TYPE:
            continue
        if wanted is not None and entity_type not in wanted:
            continue

        title = clean_str(row.get(title_col))
        if not title:
            continue

        info: Dict[str, Any] = {"o_id": o_id, "title": title, "type": entity_type}
        if keep_row:
            info["row"] = row

        key = normalize_location_name(title)
        if key:
            entity_lookup.setdefault(key, info)
        if alt_col:
            pending_aliases.append((row.get(alt_col), info))

        id_to_entity[o_id] = info

        if entity_type == "Lieux" and coord_col:
            coords = parse_coordinates(row.get(coord_col))
            if coords is not None:
                lieux[o_id] = (coords[0], coords[1])

        if on_entity is not None:
            on_entity(info)

    # Second pass, so an alias only ever fills a key no title claimed.
    for raw, info in pending_aliases:
        for alt in parse_pipe_separated(raw):
            alt_key = normalize_location_name(alt)
            if alt_key and alt_key not in entity_lookup:
                entity_lookup[alt_key] = info

    return entity_lookup, id_to_entity, lieux


# =============================================================================
# Place → country (the ``Partie de`` walk)
# =============================================================================

# ``Partie de`` chains are shallow (place → region → country) but guard
# against cycles / malformed data anyway.
MAX_PARTIE_DE_DEPTH = 6


def build_partie_de_lookup(index_df: Optional[pd.DataFrame]) -> Dict[str, str]:
    """Normalized index title → that record's raw ``Partie de`` cell.

    First writer wins; an index without the column gives an empty map, and
    every place then resolves only if it is itself one of the countries.
    """
    out: Dict[str, str] = {}
    if index_df is None or index_df.empty:
        return out
    title_col = find_column(index_df, ["Titre", "dcterms:title"])
    partie_col = find_column(index_df, ["Partie de"])
    if not title_col or not partie_col:
        return out
    for title, parent in zip(index_df[title_col].tolist(), index_df[partie_col].tolist()):
        title = clean_str(title)
        if title:
            out.setdefault(normalize_location_name(title), clean_str(parent))
    return out


def resolve_focus_country(
    title: str,
    partie_de_by_key: Dict[str, str],
    focus_set: Optional[Dict[str, str]] = None,
) -> Optional[str]:
    """Walk the ``Partie de`` chain until a focus country is reached.

    ``partie_de_by_key`` is :func:`build_partie_de_lookup`'s map;
    ``focus_set`` maps normalized country names to their canonical
    spelling (default: :data:`IWAC_COUNTRIES`). The location's own title
    counts too (the six countries are themselves Lieux entries). None when
    the chain ends, loops or leaves the collection's countries — a place in
    France has no IWAC country, and must not be given one.
    """
    if focus_set is None:
        focus_set = {normalize_location_name(c): c for c in IWAC_COUNTRIES}
    seen = set()
    current = title
    for _ in range(MAX_PARTIE_DE_DEPTH):
        key = normalize_location_name(current)
        if not key or key in seen:
            return None
        seen.add(key)
        canon = focus_set.get(normalize_location_name(canonical_country(current)))
        if canon:
            return canon
        parents = parse_pipe_separated(partie_de_by_key.get(key, ""))
        if not parents:
            return None
        current = parents[0]
    return None


def place_country_resolver(
    index_df: Optional[pd.DataFrame],
    countries: Iterable[str] = IWAC_COUNTRIES,
) -> Any:
    """``country_of(place_title) -> Optional[str]`` over one index snapshot.

    THE place → country lookup. The index's ``countries`` column lists the
    countries whose press MENTIONS an entity, so ``countries[0]`` of a place
    is usually "Bénin" — the most-catalogued press — whatever the place is.
    Three generators read it that way; the index overview had already
    dropped it from its own map for exactly that reason. This resolves the
    country the place is located IN, through ``Partie de``, or None when it
    is not in (or under) one of ``countries``.

    Memoized per normalized title, so it is cheap to call per tag.
    """
    partie = build_partie_de_lookup(index_df)
    focus = {normalize_location_name(c): c for c in countries}
    cache: Dict[str, Optional[str]] = {}

    def country_of(title: Any) -> Optional[str]:
        text = clean_str(title)
        key = normalize_location_name(text)
        if not key:
            return None
        if key not in cache:
            cache[key] = resolve_focus_country(text, partie, focus)
        return cache[key]

    return country_of


# =============================================================================
# Top entities by tag membership
# =============================================================================

TAG_FIELDS: Tuple[str, ...] = ("subject", "spatial")
"""The catalogue fields an item is tagged with an index entry through."""


def compute_top_entities(
    index_df: Optional[pd.DataFrame],
    frames: Any,
    top_n: int,
    *,
    types: Iterable[str] = ENTITY_TYPE_ORDER,
    fields: Iterable[str] = TAG_FIELDS,
) -> Dict[str, List[Dict[str, Any]]]:
    """Top ``top_n`` index entries per type, ranked by tagged items.

    ``frequency`` is the number of content items whose ``subject`` or
    ``spatial`` field names the entry — tag membership: each cell is
    pipe-split and stripped, and a value matches an ``index.Titre`` as a
    whole (``normalize_location_name`` on both sides), never as a
    substring. An item counts once per entry however many of its fields
    carry it.

    Not ``index.frequency``: that column counts every role an entity plays
    (``author``, ``creator``, ``publisher`` …), so a journalist ranked on
    their bylines and a newspaper on what it printed, while both panels
    reading this say the counts come from the catalogue's subject and
    place fields. ``first_occurrence`` / ``last_occurrence`` / ``countries``
    describe the same tagged items, so the tooltip and the bar agree.

    ``frames`` is ``{subset: DataFrame}`` (or an iterable of frames); a
    frame without any of ``fields`` contributes nothing. Rows with no
    title never reach the ranking, so ``top_n`` is always ``top_n`` named
    entries. Ties break on the title.

    Returns ``{type: [{o_id, title, frequency, first_occurrence?,
    last_occurrence?, countries?, thumbnail?}, …]}`` in ``types`` order.
    """
    type_order = list(types)
    result: Dict[str, List[Dict[str, Any]]] = {t: [] for t in type_order}
    if index_df is None or index_df.empty:
        return result

    lookup, by_id, _ = build_entity_index(
        index_df, types=type_order, aliases=False, keep_row=True,
    )
    tag_fields = list(fields)
    frame_list = list(frames.values()) if isinstance(frames, dict) else list(frames or [])

    counts: Counter = Counter()
    first: Dict[int, str] = {}
    last: Dict[int, str] = {}
    countries: Dict[int, Counter] = {}

    for df in frame_list:
        if df is None or df.empty:
            continue
        columns = [df[f].tolist() for f in tag_fields if f in df.columns]
        if not columns:
            continue
        n = len(df)
        dates = df["pub_date"].tolist() if "pub_date" in df.columns else [None] * n
        cells = df["country"].tolist() if "country" in df.columns else [None] * n

        for i in range(n):
            matched = set()
            for column in columns:
                for tag in parse_pipe_separated(column[i]):
                    info = lookup.get(normalize_location_name(tag))
                    if info is not None:
                        matched.add(info["o_id"])
            if not matched:
                continue
            date = clean_str(dates[i])[:10]
            dated = extract_year(date) is not None
            item_countries = {
                canonical_country(c) for c in clean_values(parse_pipe_separated(cells[i]))
            }
            for o_id in matched:
                counts[o_id] += 1
                if dated:
                    if o_id not in first or date < first[o_id]:
                        first[o_id] = date
                    if o_id not in last or date > last[o_id]:
                        last[o_id] = date
                if item_countries:
                    countries.setdefault(o_id, Counter()).update(item_countries)

    for entity_type in type_order:
        ranked = sorted(
            (o_id for o_id in counts if by_id[o_id]["type"] == entity_type),
            key=lambda o_id: (-counts[o_id], by_id[o_id]["title"]),
        )[:top_n]
        entries: List[Dict[str, Any]] = []
        for o_id in ranked:
            info = by_id[o_id]
            entry: Dict[str, Any] = {
                "o_id": o_id,
                "title": info["title"],
                "frequency": int(counts[o_id]),
            }
            if o_id in first:
                entry["first_occurrence"] = first[o_id]
                entry["last_occurrence"] = last[o_id]
            if o_id in countries:
                entry["countries"] = [
                    c for c, _ in sorted(countries[o_id].items(), key=lambda kv: (-kv[1], kv[0]))
                ]
            thumb = clean_str(info["row"].get("thumbnail"))
            if thumb:
                entry["thumbnail"] = thumb
            entries.append(entry)
        result[entity_type] = entries
    return result


# =============================================================================
# Small shared parsers
# =============================================================================

def lda_topic_id(value: Any) -> Optional[int]:
    """An ``lda_topic_id`` cell as a topic id, or None.

    The column is stored nullable ``int64`` (``float64`` on revisions before
    the pipeline's canonical types) and reads as ``float64`` in pandas on
    every modelled subset, because the nulls force the widening; a cell may
    also arrive as ``pd.NA`` or a numpy scalar. So it goes through
    ``float`` first, whichever dtype it came in. None for
    NaN / None / garbage and for every negative id: ``-1`` is the
    ``articles`` outlier bucket, and the null-not-``-1`` convention of
    ``publications`` / ``references`` means a negative id there is a change
    of upstream convention that should degrade to "uncovered" rather than
    invent topic -1. A caller that reports the outlier residual separately
    tests for a present value first (``clean_float``) and then for None
    here.

    Read the topic id beside ``lda_model_name``: three subsets carry four
    unrelated numbering schemes, so an id alone names no topic.
    """
    number = clean_float(value)
    if number is None or not math.isfinite(number):
        return None
    topic = int(number)
    return topic if topic >= 0 else None


def dominant(counter: Any, default: Any = None) -> Any:
    """The most common key of a Counter-like mapping, ties broken by key.

    "Which country is this newspaper from" was ``most_common(1)`` in seven
    places, and ``most_common`` breaks a tie on insertion order — the row
    order of whatever snapshot was loaded — so a periodical split evenly
    between two countries could change country from one regeneration to
    the next. The smallest key (compared as a string, so a None key
    cannot raise) wins a tie here, deterministically. Non-positive counts
    are ignored; nothing left means ``default``.
    """
    best = None
    for key, count in counter.items():
        if count <= 0:
            continue
        if best is None or (-count, str(key)) < (-best[1], str(best[0])):
            best = (key, count)
    return default if best is None else best[0]


# =============================================================================
# Text / Tokenization
# =============================================================================

# Basic French stopwords — keep the list compact but cover the biggest
# high-frequency items. Extend here rather than pulling NLTK to avoid a
# runtime dependency. Shared by every generator that builds word clouds
# (collection-wide and per-issue), so the token vocabulary stays
# consistent across visualizations.
FR_STOPWORDS = set("""
a à ai ainsi ais ait alors après as au aucun aucune aussi autant autre autres
aux avait avant avec avoir ayant c ça car ce ceci cela celle celles celui
cent cependant certain certaine certaines certains ces cet cette ceux chacun
chaque chez ci comme comment d dans de depuis des du deux dès donc dont doux
du durant e elle elles en encore entre es est et étant été être eu eux
fait faire fois font h hors i il ils j je l la là laquelle le lequel les
lesquelles lesquels leur leurs lui m ma mais me même mes mien mienne miennes
miens moi moins mon n ne ni nos notre nous nouveau nouveaux nouvelle nouvelles
o on ont ou où oui par parce pas peu peut peuvent plus plusieurs plutôt pour
pourquoi puis qu quand que quel quelle quelles quels qui quoi s sa sans
se sera serait seront ses si sien sienne siennes siens soi soient sois soit
sommes son sont sous suis sur t ta tandis tant te tel telle telles tels tes
toi ton tous tout toute toutes très trois tu un une vais vas vers voici voilà
vos votre vous y
comme cette dans plus mais tout pour être avoir faire dire voir savoir pouvoir vouloir devoir
""".split())

# Additional IWAC-specific noise words that survived the generic list.
CUSTOM_STOPWORDS = set("""
article journal page pages numero numéro nombre date lieu monsieur madame
selon ainsi cependant effet toutefois outre certes ailleurs notamment
""".split())

STOPWORDS = FR_STOPWORDS | CUSTOM_STOPWORDS

# Unicode letter class — catches all accented Latin letters including
# œ, æ, ÿ, ñ that an ASCII-plus-diacritics class would miss. Common French
# words like cœur, sœur, œuvre, bœuf would otherwise fragment into sub-4-char
# tokens and vanish entirely from the counts.
TOKEN_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


def tokenize(text: Any) -> List[str]:
    """Lowercase, strip punctuation, split on whitespace, drop stopwords
    and short (< 4 char) tokens. Non-string input returns an empty list.

    The shared word-cloud tokenizer. Inputs may be raw ``OCR`` (where the
    stopword set does the heavy lifting) or precomputed spaCy lemma
    columns (``lemma_nostop`` / ``lemma_text``), where stopwords are
    already gone and this mostly just splits and length-filters.
    """
    if not isinstance(text, str) or not text:
        return []
    return [
        tok for tok in TOKEN_RE.findall(text.lower())
        if len(tok) >= 4 and tok not in STOPWORDS
    ]


# =============================================================================
# LDA Topic Mixtures
# =============================================================================
#
# Moved here from generate_topic_explorer.py when the periodicals topics
# panels became a second consumer — same reasoning as HIJRI_COLUMNS /
# read_hijri_month in v1.39.0. The distinction these two encode matters
# more on some subsets than others: `publications` measures a mean
# dominant-topic probability of 0.345, so a full periodical issue is a
# genuine mixture and a dominant-label view of it would be wrong about
# two thirds of the time.

def parse_topk(value: Any) -> List[Tuple[int, float]]:
    """Parse an ``lda_topic_topk`` cell into ``[(topic_id, prob), …]``.

    Format is ``"id:prob|id:prob|…"``, descending by probability, written
    by the upstream LDA pass. Entries below the model's
    ``minimum_probability`` are already dropped upstream, so a cell can
    hold fewer than k pairs — never assume exactly three. Malformed
    fragments are skipped rather than guessed at.
    """
    text = clean_str(value)
    if not text:
        return []
    pairs: List[Tuple[int, float]] = []
    for fragment in text.split('|'):
        head, _, tail = fragment.partition(':')
        if not tail:
            continue
        try:
            topic_id = int(head)
            prob = float(tail)
        except (TypeError, ValueError):
            continue
        if topic_id < 0 or not (0.0 <= prob <= 1.0):
            continue
        pairs.append((topic_id, prob))
    return pairs


def parse_top_words(label: str, max_words: int = 10) -> List[str]:
    """Split a ``lda_topic_label`` string into individual top words.

    The labels are written as space- or hyphen-separated chains
    (``"religion - islam - musulman - ..."``) — splitting on either
    one produces a clean word list. Trims surrounding whitespace and
    drops empty fragments.
    """
    if not label:
        return []
    # Replace en-dash / em-dash variants with a hyphen so the split
    # below catches them regardless of source.
    s = (label
         .replace('–', '-')   # en-dash
         .replace('—', '-'))  # em-dash
    # Split on either ' - ' (space-dash-space) or ',' to be defensive
    # about whatever separator the upstream model emitted.
    parts: List[str] = []
    for chunk in s.split(','):
        parts.extend(p.strip() for p in chunk.split(' - ') if p.strip())
    return parts[:max_words] if parts else [s.strip()]


def aggregate_prevalence(
    df: pd.DataFrame,
    columns: Dict[str, Optional[str]],
    labels: Dict[int, str],
) -> Optional[Dict[str, Any]]:
    """Probability-weighted topic prevalence per year, from ``lda_topic_topk``.

    Counting dominant topics answers "how many documents is this topic the
    single best label for". That is a coarse question: a document the model
    splits 0.34 / 0.33 / 0.33 counts fully for one topic and not at all for
    two near-equal others, which makes a genuinely mixed corpus look
    sharper than it is. Weighting by probability mass instead asks "how
    much of the corpus's attention went to this topic", which is the
    quantity a prevalence-over-time claim actually needs.

    **The mass is truncated, and the payload says so rather than hiding
    it.** Only the top *k* topics per document are on the Hub (k=3 by
    default; the full theta matrix is dropped before the push), so the
    per-year masses sum to ``captured_mass`` — typically well under 1.0 —
    not to 1.0. The obvious "fix" of renormalising each document to sum to
    1 would inflate every number by the missing tail and quietly convert a
    known partial measurement into a fake complete one, so it is not done.
    The front end plots the un-normalised stack, which makes the shortfall
    visible as headroom instead of a footnote.

    ``columns`` is the caller's column map, read for ``topic_topk`` and
    ``date`` (same convention as ``read_hijri_month``). Returns None when
    the topk column is absent — a dataset predating the 2026-07 LDA re-run,
    or a subset that was never modelled — so the caller simply keeps
    whatever dominant-topic view it already had.
    """
    topk_col = columns.get('topic_topk')
    date_col = columns.get('date')
    if not topk_col or topk_col not in df.columns:
        return None

    year_docs: Counter = Counter()                    # year → contributing docs
    year_mass: Dict[int, float] = {}                  # year → captured mass
    year_topic: Dict[int, Dict[int, float]] = {}      # year → topic → mass
    topic_mass: Dict[int, float] = {}                 # topic → total mass
    docs = 0
    total_mass = 0.0
    max_k = 0

    for _, row in df.iterrows():
        pairs = parse_topk(row.get(topk_col))
        if not pairs:
            continue
        year = extract_year(row.get(date_col)) if date_col else None
        if year is None:
            continue

        docs += 1
        max_k = max(max_k, len(pairs))
        year_docs[year] += 1
        per_topic = year_topic.setdefault(year, {})
        for topic_id, prob in pairs:
            per_topic[topic_id] = per_topic.get(topic_id, 0.0) + prob
            topic_mass[topic_id] = topic_mass.get(topic_id, 0.0) + prob
            year_mass[year] = year_mass.get(year, 0.0) + prob
            total_mass += prob

    if not docs:
        return None

    years = sorted(year_docs)

    # Every topic gets a series: the front end folds its own long tail into
    # an "Other topics" band, and that band is only exact if it is summing
    # real numbers rather than a pre-truncated remainder.
    series: List[Dict[str, Any]] = []
    for topic_id in sorted(topic_mass, key=lambda t: -topic_mass[t]):
        values = []
        for year in years:
            mass = year_topic.get(year, {}).get(topic_id, 0.0)
            values.append(round(mass / year_docs[year], 4) if year_docs[year] else 0.0)
        series.append({
            'id':    topic_id,
            'label': labels.get(topic_id, f'Topic {topic_id}'),
            'mean':  round(topic_mass[topic_id] / docs, 4),
            'values': values,
        })

    return {
        'years':   years,
        'n_docs':  [int(year_docs[y]) for y in years],
        # Mean total probability mass the top-k pairs account for, per
        # year. The gap to 1.0 is the tail the Hub does not carry.
        'captured_mass': [
            round(year_mass.get(y, 0.0) / year_docs[y], 4) if year_docs[y] else 0.0
            for y in years
        ],
        'series':  series,
        'k_max':   max_k,
        'docs':    docs,
        'mean_captured_mass': round(total_mass / docs, 4),
    }


# =============================================================================
# Dataset Loading
# =============================================================================

def _load_hf_dataset(**kwargs: Any) -> Any:
    """Import the heavyweight Hugging Face client only at the I/O boundary."""
    try:
        from datasets import load_dataset
    except ImportError as exc:
        raise ImportError(
            "Hugging Face dataset client not installed. Please run:\n"
            "pip install datasets huggingface-hub pyarrow"
        ) from exc
    if "revision" not in kwargs:
        kwargs["revision"] = dataset_revision(kwargs["path"], kwargs.get("token"))
    return load_dataset(**kwargs)


# A process-level memo, installed by ``run_all`` and nothing else. When it is
# None (every direct ``python scripts/generate_x.py`` invocation, and the whole
# test suite) ``load_dataset_safe`` does exactly what it always did: one load
# per call, nothing retained. See ``iwac_frames.FrameStore``.
_FRAME_STORE: Any = None
_DATASET_REVISIONS: Dict[str, str] = {}
_WRITTEN_OUTPUTS: set = set()
_EXPECTED_OUTPUTS: set = set()


def expect_item_outputs(directory: Path, ids: Iterable) -> None:
    """Declare eligible item files before rendering, independently of writes."""
    _EXPECTED_OUTPUTS.update(str((directory / f"{item_id}.json").resolve()) for item_id in ids)


def dataset_revision(repo_id: str, token: Optional[str] = None) -> str:
    """Resolve once per process; every subset and cache widening uses this SHA."""
    if repo_id not in _DATASET_REVISIONS:
        pinned = os.environ.get("IWAC_DATASET_REVISION") if repo_id == DATASET_ID else None
        if pinned:
            if not re.fullmatch(r"[0-9a-fA-F]{40}", pinned):
                raise ValueError("IWAC_DATASET_REVISION must be an immutable 40-hex commit SHA")
            _DATASET_REVISIONS[repo_id] = pinned
        else:
            from huggingface_hub import HfApi
            _DATASET_REVISIONS[repo_id] = HfApi(token=token).dataset_info(repo_id).sha
    return _DATASET_REVISIONS[repo_id]



def set_frame_store(store: Any) -> Any:
    """Install (or, with ``None``, remove) the process-level frame memo.

    Returns the previously installed store so a caller can restore it —
    which is what makes this safe to use from a test.
    """
    global _FRAME_STORE
    previous = _FRAME_STORE
    _FRAME_STORE = store
    return previous


def load_dataset_safe(
    config_name: str,
    repo_id: str = DATASET_ID,
    token: Optional[str] = None,
    columns: Optional[List[str]] = None,
    required: bool = False,
) -> Optional[pd.DataFrame]:
    """
    Load a HuggingFace dataset subset with error handling.

    Args:
        config_name: Name of the dataset subset/configuration
        repo_id: HuggingFace dataset repository ID
        token: Optional HuggingFace API token
        columns: Optional column projection. When set, only these columns are
            materialized into the pandas frame — pass it whenever a generator
            needs a handful of scalar fields, so the OCR text and the 768-dim
            embedding columns never get converted to Python objects (the
            pandas conversion, not the download, is where the memory goes).
            Requested columns missing from the subset are skipped with a
            warning rather than failing, so callers can share one list across
            subsets whose schemas differ slightly.
        required: Raise ``RuntimeError`` instead of returning ``None`` (or an
            empty frame) when the subset cannot be loaded. A generator whose
            whole output rests on one subset has nothing sensible to write
            without it — ``generate_wordcloud`` used to write an EMPTY payload
            and exit 0 in that case, which CI would then have published.

    Returns:
        Pandas DataFrame of the dataset, or None if loading fails and the
        subset is not ``required``

    Examples:
        >>> df = load_dataset_safe("articles")
        >>> df = load_dataset_safe("articles", columns=["o:id", "title", "pub_date"])
        >>> df = load_dataset_safe("index", repo_id="fmadore/islam-west-africa-collection")
    """
    store = _FRAME_STORE
    if store is not None:
        return store.get(
            config_name, repo_id=repo_id, token=token,
            columns=columns, required=required,
        )
    return _load_subset_frame(
        config_name, repo_id=repo_id, token=token,
        columns=columns, required=required,
    )


def _load_subset_frame(
    config_name: str,
    repo_id: str = DATASET_ID,
    token: Optional[str] = None,
    columns: Optional[List[str]] = None,
    required: bool = False,
) -> Optional[pd.DataFrame]:
    """The unmemoized load — one download, one pandas conversion, nothing kept.

    :func:`load_dataset_safe` is the door every generator uses; this is what
    is behind it when no :class:`iwac_frames.FrameStore` is installed, and
    what the store itself calls on a miss.
    """
    logger = logging.getLogger(__name__)
    logger.info(f"Loading subset '{config_name}' from {repo_id}...")

    try:
        kwargs = {"path": repo_id, "name": config_name}
        if token:
            kwargs["token"] = token

        dataset = _load_hf_dataset(**kwargs)
        data = dataset["train"]
        if columns:
            keep = [c for c in columns if c in data.column_names]
            missing = sorted(set(columns) - set(keep))
            if missing:
                logger.warning(
                    f"Subset '{config_name}' lacks requested column(s): {missing}"
                )
            data = data.select_columns(keep)
        df = data.to_pandas()
        logger.info(f"Loaded {len(df)} records from '{config_name}'")

    except Exception as e:
        logger.error(f"Error loading subset '{config_name}': {e}")
        msg = str(e).lower()
        if any(hint in msg for hint in ("401", "403", "unauthorized", "gated", "authentication")):
            logger.error(
                f"'{repo_id}' is a PRIVATE dataset (since 2026-07) — a missing "
                "or unscoped token surfaces exactly like this. Set the HF_TOKEN "
                "environment variable (or run `hf auth login`) with a token "
                "that can read the private mirror."
            )
        if required:
            raise RuntimeError(
                f"Required subset '{config_name}' could not be loaded from {repo_id}: {e}"
            ) from e
        return None

    if required and df.empty:
        raise RuntimeError(f"Required subset '{config_name}' from {repo_id} is empty.")
    return df


def find_column(
    df: pd.DataFrame,
    candidates: List[str],
    required: bool = False
) -> Optional[str]:
    """
    Find the first matching column name from a list of candidates.

    Args:
        df: DataFrame to search
        candidates: List of possible column names to try
        required: If True, raise ValueError if no column found

    Returns:
        First matching column name, or None if not found

    Raises:
        ValueError: If required=True and no column found

    Examples:
        >>> find_column(df, ["title", "Title", "dcterms:title"])
        "title"
        >>> find_column(df, ["missing"], required=True)
        ValueError: Required column not found
    """
    for col in candidates:
        if col in df.columns:
            return col

    if required:
        raise ValueError(f"Required column not found. Tried: {candidates}")

    return None


# =============================================================================
# AI sentiment columns
# =============================================================================

# Canonical scale orders. The JS renders stacks and matrix axes in this
# exact order (most positive / most central first), and every generator that
# buckets a sentiment column emits its counts in it. ONE definition: the
# copies that lived in dashboard_aggregator, generate_compare_newspapers and
# generate_sentiment_atlas were identical and had no reason to stay so.
POLARITE_ORDER: Tuple[str, ...] = (
    "Très positif",
    "Positif",
    "Neutre",
    "Négatif",
    "Très négatif",
    "Non applicable",
)
CENTRALITE_ORDER: Tuple[str, ...] = (
    "Très central",
    "Central",
    "Secondaire",
    "Marginal",
    "Non abordé",
)

SENTIMENT_MODELS: Tuple[str, ...] = tuple(
    model["id"] for model in json.loads(
        (Path(__file__).resolve().parents[1] / "config/sentiment-models.json").read_text(encoding="utf-8")
    )["active"]
)
"""Canonical model ids the whole module keys on.

The id **is** the Hugging Face column prefix, and it names the exact model
that produced the annotation. It is also the key in every generated JSON
payload, in the block JS and i18n catalogs, and — camel-cased — in the
Omeka properties ``SentimentExtractor.php`` reads (``iwac:gpt56Luna*``,
``iwac:mistralSmall2603*``, ``iwac:deepseekV4Flash0731*``,
``iwac:gemma431bIt*``, ``iwac:qwen3827b*``).

This is a *wish list*, not a promise that the columns exist. A model
joins the panel on Omeka first and reaches Hugging Face only once the
upstream uploader has been taught it, so an id can sit here resolving to
nothing for a while — ``gemma_4_31b_it`` did, and ``qwen3_8_27b`` was
added the same day its columns landed, so neither is waiting now. Every
generator therefore filters this tuple through
:func:`resolve_sentiment_columns` and emits only the models it actually
found — listing an id in a payload's ``models`` array with no data behind
it hands the block a model picker whose entry draws an empty chart, which
reads as breakage rather than as "not yet".

``qwen3_8_27b`` is the one member whose coverage is *expected* to be
short: its full-corpus pass plus three retry rounds reached 12,098 of the
12,251 eligible articles and the remaining 153 were retired deliberately,
so a gap here is a finding about the model rather than a failed run to
repair. Compare models by proportion, never by raw count.

This replaced the earlier *vendor slot* ids (``gemini`` / ``chatgpt`` /
``mistral``, resolving to the ``gemini_3_flash_preview`` /  ``gpt_5_mini``
/ ``ministral_14b_2512`` columns of the January–February 2026 generation-1
campaign). Those columns still exist on the Hub but are no longer read
here: the vendor slot recorded which *company* ran, not which model, and
the generation-2 campaign of July–August 2026 does not reuse the same
three vendors.
"""

SENTIMENT_FIELD_SUFFIXES: Dict[str, str] = {
    "polarite": "polarite",
    "centralite": "centralite_islam_musulmans",
    "subjectivite": "subjectivite_score",
}
"""Internal field key → HF column suffix, for the scored fields.

Each scored field also has a free-text ``*_justification`` sibling on HF
(e.g. ``gpt_5_6_luna_polarite_justification``). The module does not
aggregate those — the item page renders justifications straight from
Omeka — so they are deliberately absent here.
"""

SUBJECTIVITE_LABELS: Dict[str, int] = {
    "Très objectif": 1,
    "Plutôt objectif": 2,
    "Mixte": 3,
    "Plutôt subjectif": 4,
    "Très subjectif": 5,
}
"""Subjectivité label → ordinal 1-5, matching ``Module::SUBJECTIVITE_ITEMS``.

Generation 2 changed this axis from a NUMBER to a LABEL: the HF column
``{model}_subjectivite_score`` is a string here where generation 1 stored
an ``int64``. Nothing in the column *name* signals that, so every reader
must go through :func:`subjectivite_ordinal` rather than
``pd.to_numeric`` / :func:`clean_float`, which silently coerce the whole
axis to NaN and empty every subjectivity chart in the module.
"""


def subjectivite_ordinal(value: Any) -> Optional[int]:
    """Ordinal 1-5 for a subjectivité value, from a label or a number.

    Accepts the generation-2 French label, the generation-1 numeric score,
    and the empty / NaN values both generations use where the model
    declined to rate (~2-4% of rows even on a "complete" model — never
    infer a score from the presence of a justification).

    Args:
        value: Raw cell from a ``{model}_subjectivite_score`` column

    Returns:
        1 (most objective) … 5 (most subjective), or None

    Examples:
        >>> subjectivite_ordinal("Plutôt objectif")
        2
        >>> subjectivite_ordinal(4)
        4
        >>> subjectivite_ordinal("") is None
        True
    """
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None

    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None

    if text in SUBJECTIVITE_LABELS:
        return SUBJECTIVITE_LABELS[text]

    # Legacy generation-1 numeric score (and the "3" / "3.0" strings a
    # round-tripped JSON cache can produce).
    try:
        level = int(round(float(text)))
    except (TypeError, ValueError):
        return None
    return level if 1 <= level <= 5 else None


def sentiment_columns(model: str, field: str) -> List[str]:
    """Candidate HF column names for one model × field, preferred first.

    Args:
        model: Canonical model id from :data:`SENTIMENT_MODELS`
        field: Field key from :data:`SENTIMENT_FIELD_SUFFIXES`

    Returns:
        Column names to try

    Examples:
        >>> sentiment_columns("gpt_5_6_luna", "polarite")
        ['gpt_5_6_luna_polarite']
    """
    return [f"{model}_{SENTIMENT_FIELD_SUFFIXES[field]}"]


_SENTIMENT_WARNED: set = set()


def resolve_sentiment_columns(
    df: pd.DataFrame,
    models: Optional[Tuple[str, ...]] = None,
    fields: Optional[List[str]] = None,
) -> Dict[str, Dict[str, Optional[str]]]:
    """Resolve the sentiment columns actually present in ``df``.

    A model that resolves to nothing logs a warning rather than failing
    silently — sentiment quietly vanishing from every dashboard is exactly
    how an upstream column rename lands otherwise. Warnings are emitted
    once per process, so this is safe to call inside a per-slice loop.

    Args:
        df: DataFrame to inspect (normally the ``articles`` subset)
        models: Model ids to resolve (default :data:`SENTIMENT_MODELS`)
        fields: Field keys to resolve (default all scored fields)

    Returns:
        ``{model: {field: column_name_or_None}}``

    Examples:
        >>> cols = resolve_sentiment_columns(df)
        >>> cols["gpt_5_6_luna"]["polarite"]
        'gpt_5_6_luna_polarite'
    """
    logger = logging.getLogger(__name__)
    models = models or SENTIMENT_MODELS
    fields = fields or list(SENTIMENT_FIELD_SUFFIXES)

    resolved: Dict[str, Dict[str, Optional[str]]] = {}
    for model in models:
        found = {
            field: find_column(df, sentiment_columns(model, field))
            for field in fields
        }
        if not any(found.values()):
            if model not in _SENTIMENT_WARNED:
                _SENTIMENT_WARNED.add(model)
                logger.warning(
                    f"No sentiment columns found for model '{model}' — tried "
                    f"{[c for f in fields for c in sentiment_columns(model, f)]}. "
                    "Sentiment for this model will be empty in the generated output."
                )
        elif any(v is None for v in found.values()):
            missing = sorted(k for k, v in found.items() if v is None)
            key = (model, tuple(missing))
            if key not in _SENTIMENT_WARNED:
                _SENTIMENT_WARNED.add(key)
                logger.warning(
                    f"Model '{model}' is missing sentiment field(s) {missing}"
                )
        resolved[model] = found
    return resolved


def present_sentiment_models(
    resolved: Dict[str, Dict[str, Optional[str]]],
    models: Optional[Tuple[str, ...]] = None,
) -> List[str]:
    """The models in ``resolved`` that carry at least one real column.

    The counterpart to :func:`resolve_sentiment_columns`, and the thing a
    generator should put in its payload's ``models`` array. Note the trap
    this exists to close: ``resolved[model]`` is a dict of *three None
    values* for a model with no columns, and a non-empty dict is truthy,
    so the obvious ``[m for m in SENTIMENT_MODELS if resolved.get(m)]``
    keeps every model — including the ones with nothing behind them.

    Order follows :data:`SENTIMENT_MODELS`, so the block's model picker
    opens on the same model from one regeneration to the next.

    Args:
        resolved: Output of :func:`resolve_sentiment_columns`
        models: Ids to consider, in order (default :data:`SENTIMENT_MODELS`)

    Returns:
        Model ids with at least one resolved column

    Examples:
        >>> present_sentiment_models({"a": {"polarite": "a_polarite"},
        ...                           "b": {"polarite": None}})
        ['a']
    """
    return [
        model for model in (models or SENTIMENT_MODELS)
        if any((resolved.get(model) or {}).values())
    ]


# =============================================================================
# File I/O
# =============================================================================

def save_json(
    data: Any,
    path: Path,
    minify: bool = False,
    log: bool = True
) -> None:
    """
    Save data to JSON file with automatic directory creation.

    Args:
        data: Data to serialize to JSON
        path: Output file path
        minify: If True, produce compact JSON; if False, pretty-print
        log: If True, log the save operation

    Examples:
        >>> save_json({"key": "value"}, Path("output/data.json"))
        >>> save_json(data, Path("output/data.json"), minify=True)
    """
    logger = logging.getLogger(__name__)

    # Ensure parent directory exists
    path.parent.mkdir(parents=True, exist_ok=True)

    # Write JSON
    with path.open("w", encoding="utf-8") as f:
        if minify:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        else:
            json.dump(data, f, ensure_ascii=False, indent=2)

    _WRITTEN_OUTPUTS.add(str(path.resolve()))
    if log:
        try:
            size_kb = path.stat().st_size / 1024
            logger.info(f"Wrote {path} ({size_kb:.1f} KB)")
        except Exception:
            logger.info(f"Wrote {path}")


def iter_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Iterate a DataFrame row-wise as plain dicts.

    ``for row in iter_records(df)`` replaces ``for _, row in df.iterrows()``
    with no other change at the call site: a dict answers ``row.get(col)``,
    ``row[col]`` and ``col in row`` exactly as a Series does, and those three
    are all this codebase ever asks of a row.

    WHY, AND WHERE IT IS WORTH IT (Tier 8 / P9)
    -------------------------------------------
    ``iterrows`` builds a fresh ``pd.Series`` per row - an index, a dtype
    negotiation and an object allocation for each of the 12k rows in
    ``articles``. ``to_dict("records")`` does the transpose once in pandas'
    own C loop and hands back ordinary dicts.

    **It is not a free win, and the audit's blanket "replace the 55 sites"
    would have been the wrong change.** Measured on a 12k x 46 frame, the
    answer depends entirely on how many columns the loop body reads per row,
    because ``to_dict`` pays its whole cost up front while ``iterrows``
    amortises the Series across the reads:

        1 column read per row   iterrows 0.26s   records 0.30s   (WORSE)
        5                       iterrows 0.32s   records 0.31s   (a wash)
        15                      iterrows 0.49s   records 0.31s   (64%)
        46                      iterrows 1.89s   records 0.65s   (35%)

    So this is for the wide readers - the dashboard aggregator (11 columns),
    the article fan-out (14), the sentiment atlas (10), the laicite scan
    (every text field, per row). The narrow ones - ``aggregate_prevalence``
    reads two columns, the index-subset scans read two or three - were
    converted and then converted BACK, because there they cost more than
    they saved. Where a narrow loop is genuinely hot, the fix is the
    column-list ``zip`` form (see ``_scan_newspapers`` in
    generate_collection_overview.py, 3.4x on the same data), not this.

    It also removes a correctness trap rather than only a cost. ``iterrows``
    collapses each row to ONE dtype, so a frame with any float column
    returns its int columns as floats too. ``to_dict("records")`` keeps each
    column's own dtype.

    The trade is memory: the whole frame becomes dicts at once instead of one
    row at a time. For these frames - already resident, values shared by
    reference - that is bounded. Do not reach for it on something streamed.
    """
    return df.to_dict("records")


def generate_timestamp() -> str:
    """
    Generate ISO format timestamp for metadata.

    Returns:
        ISO format timestamp string with 'Z' suffix

    Examples:
        >>> generate_timestamp()
        "2023-05-15T10:30:00Z"
    """
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def create_metadata_block(
    total_records: int,
    data_source: str = DATASET_ID,
    **extra_fields: Any
) -> Dict[str, Any]:
    """
    Create a standard metadata block for JSON output files.

    Args:
        total_records: Total number of records processed
        data_source: Data source identifier
        **extra_fields: Additional metadata fields

    Returns:
        Dictionary with metadata

    Examples:
        >>> create_metadata_block(1000, countries=["Benin", "Togo"])
        {"totalRecords": 1000, "dataSource": "...", "generatedAt": "...", "countries": [...]}
    """
    metadata = {
        "totalRecords": total_records,
        "dataSource": data_source,
        "generatedAt": generate_timestamp(),
        **extra_fields
    }
    return metadata


# =============================================================================
# Rights flag and accent folding (shared with the Laïcité package)
# =============================================================================
#
# Appended rather than slotted in beside the parsers above: both started life
# in ``scripts/laicite/`` and moved here once a second reader needed them.
# ``laicite.lexicon`` re-exports ``fold_plain`` so its callers are unchanged.

def is_public_flag(value: Any) -> bool:
    """Is this ``OCR_is_public`` cell a published *yes*?

    True only for a real boolean True — Python's or numpy's, which is not a
    subclass of ``bool`` and so fails an ``is True`` test. Everything else is
    False: NaN and None (a missing flag is not a permission), and strings or
    integers, which the column never legitimately holds. The flag gates
    whether private full text may be quoted, so it fails CLOSED: a plain
    ``bool(value)`` would read NaN as public.
    """
    return bool(pd.api.types.is_bool(value) and value)


def fold_plain(text: Any) -> str:
    """Lowercase and strip combining marks — the offset-agnostic fold.

    For lexicon terms, tag comparisons and fingerprints, where only the
    folded string matters. NFD can change the length of the text, so this is
    NOT the fold to cut quotations with; ``laicite.lexicon.fold_preserving``
    keeps a 1:1 character mapping for that. Non-strings fold to ``""``.
    """
    if not isinstance(text, str):
        return ""
    return "".join(
        c for c in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(c) != "Mn"
    )
