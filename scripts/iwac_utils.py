#!/usr/bin/env python3
"""
IWAC Shared Utilities

Common functions used across IWAC data generation scripts.
This module centralizes duplicated code from the 17 generator scripts.

Functions:
- normalize_country: Normalize country values (handles |, ,, ; separators)
- extract_year: Extract year from various date formats
- extract_month: Extract YYYY-MM from date values
- parse_coordinates: Parse "lat, lng" strings
- normalize_location_name: Unicode NFC normalization for matching
- parse_pipe_separated: Parse multivalue fields
- load_dataset_safe: Load HuggingFace dataset with error handling
- find_column: Find first matching column in DataFrame
- save_json: Save JSON with mkdir and optional minification
- configure_logging: Standard logging setup
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    from datasets import load_dataset as hf_load_dataset
    import pandas as pd
except ImportError:
    raise ImportError(
        "Required packages not installed. Please run:\n"
        "pip install datasets pandas huggingface-hub pyarrow"
    )


# =============================================================================
# Constants
# =============================================================================

DATASET_ID = "fmadore/islam-west-africa-collection"
"""Default Hugging Face dataset ID for IWAC."""

SUBSETS = ["articles", "audiovisual", "documents", "publications", "references", "index"]
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
# Country/Location Normalization
# =============================================================================

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
        ["Benin"]
        >>> normalize_country("benin|togo")
        ["Benin", "Togo"]
        >>> normalize_country(None)
        ["Unknown"]
        >>> normalize_country("Benin", return_list=False)
        "Benin"
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return [unknown_value] if return_list else unknown_value

    if isinstance(value, (list, tuple)):
        countries = [str(c).strip().title() for c in value if str(c).strip()]
        result = countries if countries else [unknown_value]
        return result if return_list else (result[0] if len(result) == 1 else ", ".join(result))

    country_str = str(value).strip()
    if not country_str:
        return [unknown_value] if return_list else unknown_value

    # Handle multiple countries separated by common delimiters
    for sep in ["|", ";", ",", "/"]:
        if sep in country_str:
            countries = [c.strip().title() for c in country_str.split(sep) if c.strip()]
            result = countries if countries else [unknown_value]
            return result if return_list else (result[0] if len(result) == 1 else ", ".join(result))

    result = country_str.title()
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

def parse_coordinates(coord_str: str) -> Optional[Tuple[float, float]]:
    """
    Parse coordinates from a string.

    Expected formats: "lat, lng" or "lat,lng"

    Args:
        coord_str: Coordinate string to parse

    Returns:
        Tuple of (latitude, longitude) or None if parsing fails

    Examples:
        >>> parse_coordinates("12.34, -56.78")
        (12.34, -56.78)
        >>> parse_coordinates("12.34,-56.78")
        (12.34, -56.78)
        >>> parse_coordinates("invalid")
        None
    """
    if not coord_str or pd.isna(coord_str):
        return None

    coord_str = str(coord_str).strip()
    if not coord_str:
        return None

    # Try common formats: "lat, lng" or "lat,lng"
    match = re.match(r'^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$', coord_str)
    if match:
        try:
            lat = float(match.group(1))
            lng = float(match.group(2))
            # Validate coordinate ranges
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                return (lat, lng)
        except ValueError:
            pass

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
# Dataset Loading
# =============================================================================

def load_dataset_safe(
    config_name: str,
    repo_id: str = DATASET_ID,
    token: Optional[str] = None
) -> Optional[pd.DataFrame]:
    """
    Load a HuggingFace dataset subset with error handling.

    Args:
        config_name: Name of the dataset subset/configuration
        repo_id: HuggingFace dataset repository ID
        token: Optional HuggingFace API token

    Returns:
        Pandas DataFrame of the dataset, or None if loading fails

    Examples:
        >>> df = load_dataset_safe("articles")
        >>> df = load_dataset_safe("index", repo_id="fmadore/islam-west-africa-collection")
    """
    logger = logging.getLogger(__name__)
    logger.info(f"Loading subset '{config_name}' from {repo_id}...")

    try:
        kwargs = {"path": repo_id, "name": config_name}
        if token:
            kwargs["token"] = token

        dataset = hf_load_dataset(**kwargs)
        df = dataset["train"].to_pandas()
        logger.info(f"Loaded {len(df)} records from '{config_name}'")
        return df

    except Exception as e:
        logger.error(f"Error loading subset '{config_name}': {e}")
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
