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
- extract_year: Extract year from various date formats
- extract_month: Extract YYYY-MM from date values
- extract_month_num: Pull the 1–12 month number out of a "YYYY-MM[-DD]" date
- read_hijri_month: The row's stored (hijri_year, hijri_month), or None
- parse_coordinates: Parse "lat, lng" or "lat lng" strings (or tuple/list)
- normalize_location_name: Unicode NFC normalization for matching
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
- find_column: Find first matching column in DataFrame
- sentiment_columns: Candidate HF column names for one model x field
- resolve_sentiment_columns: Map canonical model ids onto the sentiment
  columns actually present, warning when a model resolves to nothing
- subjectivite_ordinal: Subjectivite label (or legacy number) -> 1..5
- save_json: Save JSON with mkdir and optional minification
- configure_logging: Standard logging setup
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

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

SUBSETS = ["articles", "audiovisual", "documents", "images", "publications", "references", "index"]
"""Available subsets in the IWAC dataset."""


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


# Backwards-compatible alias — several generators still import the
# underscored name. New code should use ``canonical_country``.
_canonical_country = canonical_country


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
        countries = [_canonical_country(c) for c in value if str(c).strip()]
        result = countries if countries else [unknown_value]
        return result if return_list else (result[0] if len(result) == 1 else ", ".join(result))

    country_str = str(value).strip()
    if not country_str:
        return [unknown_value] if return_list else unknown_value

    # Handle multiple countries separated by common delimiters
    for sep in ["|", ";", ",", "/"]:
        if sep in country_str:
            countries = [_canonical_country(c) for c in country_str.split(sep) if c.strip()]
            result = countries if countries else [unknown_value]
            return result if return_list else (result[0] if len(result) == 1 else ", ".join(result))

    result = _canonical_country(country_str)
    return [result] if return_list else result


def normalize_location_name(name: str) -> str:
    """
    Normalize a location name for matching.

    Applies:
    - Unicode NFC normalization
    - Lowercase conversion
    - Whitespace stripping

    Args:
        name: Location name to normalize

    Returns:
        Normalized location name string

    Examples:
        >>> normalize_location_name("  Abidjan  ")
        "abidjan"
        >>> normalize_location_name("Côte d'Ivoire")
        "côte d'ivoire"
    """
    if not name:
        return ""
    return unicodedata.normalize('NFC', str(name).strip().lower())


# =============================================================================
# Date Extraction
# =============================================================================

FULL_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
"""Strict ISO full date (YYYY-MM-DD, anchored) with year/month/day groups."""


def is_full_date(value: Any) -> bool:
    """True when a cell is a complete, day-precise ISO date.

    Strict: rejects year-only / year-month values and anything with a
    time suffix. (corpus-health's coverage metric deliberately keeps its
    looser prefix match — see generate_corpus_health.py.)
    """
    return bool(FULL_DATE_RE.match(clean_str(value)))


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

    except Exception:
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
    column dtype: these are stored ``int64`` on most subsets but
    ``float64`` on ``articles``, and pandas widens the rest to float on
    read anyway because the partial dates leave nulls. ``int(nan)``
    raises ``ValueError``, which is caught here.
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


def extract_month(value: Any) -> Optional[str]:
    """
    Extract year-month (YYYY-MM) from various date formats.

    Args:
        value: Date value to extract month from

    Returns:
        String in "YYYY-MM" format, or None if extraction fails

    Examples:
        >>> extract_month("2023-05-15")
        "2023-05"
        >>> extract_month(datetime(2023, 5, 15))
        "2023-05"
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    try:
        # Handle datetime objects
        if isinstance(value, (pd.Timestamp, datetime)):
            return value.strftime('%Y-%m')

        # Handle strings
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None

            # Try parsing with pandas
            dt = pd.to_datetime(value, errors='coerce')
            if pd.notna(dt):
                return dt.strftime('%Y-%m')

        # Try generic conversion
        dt = pd.to_datetime(value, errors='coerce')
        if pd.notna(dt):
            return dt.strftime('%Y-%m')

    except Exception:
        pass

    return None


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


def parse_multi_value(value: Any, separators: str = "|;,/") -> List[str]:
    """
    Parse multi-value field using multiple possible separators.

    Args:
        value: Value to parse
        separators: String of separator characters to try

    Returns:
        List of trimmed strings

    Examples:
        >>> parse_multi_value("a|b|c")
        ["a", "b", "c"]
        >>> parse_multi_value("a,b,c")
        ["a", "b", "c"]
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return []

    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]

    value_str = str(value).strip()
    if not value_str:
        return []

    # Try each separator
    for sep in separators:
        if sep in value_str:
            return [v.strip() for v in value_str.split(sep) if v.strip()]

    return [value_str]


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
    return load_dataset(**kwargs)


def load_dataset_safe(
    config_name: str,
    repo_id: str = DATASET_ID,
    token: Optional[str] = None,
    columns: Optional[List[str]] = None,
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

    Returns:
        Pandas DataFrame of the dataset, or None if loading fails

    Examples:
        >>> df = load_dataset_safe("articles")
        >>> df = load_dataset_safe("articles", columns=["o:id", "title", "pub_date"])
        >>> df = load_dataset_safe("index", repo_id="fmadore/islam-west-africa-collection")
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
        return df

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
        return None


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

SENTIMENT_MODELS: Tuple[str, ...] = (
    "gpt_5_6_luna",
    "mistral_small_2603",
    "deepseek_v4_flash_0731",
)
"""Canonical model ids the whole module keys on.

The id **is** the Hugging Face column prefix, and it names the exact model
that produced the annotation. It is also the key in every generated JSON
payload, in the block JS and i18n catalogs, and — camel-cased — in the
Omeka properties ``SentimentExtractor.php`` reads (``iwac:gpt56Luna*``,
``iwac:mistralSmall2603*``, ``iwac:deepseekV4Flash0731*``).

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

    if log:
        try:
            size_kb = path.stat().st_size / 1024
            logger.info(f"Wrote {path} ({size_kb:.1f} KB)")
        except Exception:
            logger.info(f"Wrote {path}")


def copy_to_build(
    src_path: Path,
    build_dir: Path = Path("build/data")
) -> bool:
    """
    Copy a file to the build directory if it exists.

    Args:
        src_path: Source file path
        build_dir: Build directory path

    Returns:
        True if file was copied, False otherwise
    """
    logger = logging.getLogger(__name__)

    if not build_dir.exists():
        return False

    dst_path = build_dir / src_path.name
    try:
        dst_path.write_bytes(src_path.read_bytes())
        logger.info(f"Copied {src_path.name} to {build_dir}")
        return True
    except Exception as e:
        logger.warning(f"Failed to copy to build: {e}")
        return False


# =============================================================================
# Metadata Generation
# =============================================================================

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
