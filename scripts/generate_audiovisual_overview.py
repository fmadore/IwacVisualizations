#!/usr/bin/env python3
"""
generate_audiovisual_overview.py
================================

Generate ``asset/data/audiovisual-overview.json`` for the IwacVisualizations
module's Audiovisual Overview page block — the corpus-level view of the IWAC
``audiovisual`` subset (``bibo:AudioVisualDocument``, class 38).

The subset is **one class holding two populations**, and that split governs
almost everything the block draws:

    * ``deposited``  — archival recordings (template 19): DVD/CD, a real media
                       file, hours long, Nigerian Hausa/Arabic preaching.
    * ``youtube``    — embedded web video (template 23, since 2026-08-12):
                       no file at all, minutes long, francophone Burkinabè,
                       Togolese and Beninese channels.

``source_type`` is the column that tells them apart, and the block leads with
the contrast rather than averaging over it.

**The headline is that items and hours rank the channels differently.** RTB
publishes the most videos and holds the fourth-most runtime; the Togolese
student association AEEMT publishes half as many and holds the most. The same
inversion runs through the countries (Burkina Faso has 20x Nigeria's items and
fewer hours). Every ranking panel therefore ships BOTH measures and lets the
reader switch, defaulting to items.

Payload shape (top-level keys):

    metadata      — standard provenance block (generatedAt timestamp)
    summary       — item / channel / country counts, total runtime, the
                    per-population medians, and the date span
    channels      — per-publisher: items, seconds, median seconds, country,
                    source_type, year span. Sorted by items desc; the JS
                    re-sorts when the reader switches to hours.
    countries     — per-country items + seconds, same dual measure
    durations     — runtime histogram: fixed buckets x source_type
    timeline      — publication year x channel, shaped for C.stackedBar,
                    plus the partial-year marker
    coverage      — which metadata fields this subset actually carries,
                    as present/total pairs (this is where `language` and
                    `subject` belong: completeness bars, not findings)
    recent        — newest items with poster frame, runtime and watch link

Fields deliberately NOT charted, because measuring them showed they cannot
carry a panel (verified 2026-08-25 against 1,771 rows):

    subject      1.5%   creator     2.5%   is_part_of  0.3%
    language     99.9% populated but ~99% a single value, and the non-French
                 tags concentrate in ONE hand-catalogued channel out of ten —
                 it measures cataloguing effort, not speech. Coverage bar only.
    spatial      99.9% populated, 7 distinct values, ~redundant with country
    type / rights / medium / contributor — constants or source_type proxies

Usage:
    python scripts/generate_audiovisual_overview.py
    python scripts/generate_audiovisual_overview.py --top-channels 12 -v
"""

from __future__ import annotations

import argparse
import logging
import os
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median
from typing import Any, Dict, List, Optional

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    add_standard_args,
    canonical_country,
    clean_str,
    create_metadata_block,
    extract_year,
    find_column,
    load_dataset_safe,
    parse_duration_seconds,
    parse_standard_args,
    save_json,
)

logger = logging.getLogger(__name__)

# Channels kept as their own series in the stacked timeline; the rest fold
# into an "Other" band so the legend stays readable.
TOP_CHANNELS_TIMELINE = 6

# Items in the "recently published" strip.
RECENT_ITEMS = 12

# Runtime histogram. Upper bound in seconds, exclusive; the last bucket is
# open-ended. Keys are stable i18n suffixes, not display strings — the JS
# resolves them through `P.t('av_bucket_<key>')`.
DURATION_BUCKETS: List[tuple] = [
    ("lt2m", 120),
    ("2to5m", 300),
    ("5to15m", 900),
    ("15to60m", 3600),
    ("gt1h", None),
]

# Columns the block needs. Projected so OCR text is fetched only as a
# presence flag, never materialized wholesale for 1,771 rows.
COLUMNS = [
    "o:id", "title", "publisher", "country", "pub_date", "duration_seconds",
    "extent", "source_type", "description", "OCR", "subject", "creator",
    "thumbnail", "URL", "iwac_url", "language", "medium", "PDF",
]


# =============================================================================
# Helpers
# =============================================================================

def _seconds(row: pd.Series, dur_col: Optional[str], extent_col: Optional[str]) -> int:
    """
    Runtime in seconds. Prefers the precomputed ``duration_seconds`` column
    and falls back to parsing ISO-8601 ``dcterms:extent`` — deposited rows
    carry whole-minute ``PT45M``, YouTube rows second-precision ``PT6M51S``.
    """
    if dur_col:
        raw = pd.to_numeric(row.get(dur_col), errors="coerce")
        if pd.notna(raw) and raw > 0:
            return int(raw)
    if extent_col:
        parsed = parse_duration_seconds(row.get(extent_col))
        if parsed and parsed > 0:
            return int(parsed)
    return 0


def _bucket_key(seconds: int) -> str:
    for key, upper in DURATION_BUCKETS:
        if upper is None or seconds < upper:
            return key
    return DURATION_BUCKETS[-1][0]


def _present(series: Optional[pd.Series]) -> int:
    """Count rows carrying a non-empty value, treating the string literals
    pandas leaves behind ('None', 'nan') as empty."""
    if series is None:
        return 0
    cleaned = series.map(clean_str)
    return int((cleaned != "").sum())


# =============================================================================
# Panel builders
# =============================================================================

def compute_channels(
    df: pd.DataFrame,
    cols: Dict[str, Optional[str]],
) -> List[Dict[str, Any]]:
    """
    Per-publisher rollup carrying BOTH measures, so the block's channel panel
    can switch between them without a second fetch. ``median_seconds`` is what
    explains the inversion — a channel ranking high on hours and low on items
    is publishing long-form, and the median says so directly.
    """
    grouped: Dict[str, Dict[str, Any]] = {}

    for _, row in df.iterrows():
        name = clean_str(row.get(cols["publisher"])) if cols["publisher"] else ""
        if not name:
            continue
        entry = grouped.setdefault(name, {
            "name": name,
            "items": 0,
            "seconds": 0,
            "_runtimes": [],
            "_countries": Counter(),
            "_sources": Counter(),
            "_years": [],
        })
        entry["items"] += 1
        secs = _seconds(row, cols["duration_seconds"], cols["extent"])
        entry["seconds"] += secs
        if secs > 0:
            entry["_runtimes"].append(secs)

        country = canonical_country(clean_str(row.get(cols["country"]))) if cols["country"] else ""
        if country:
            entry["_countries"][country] += 1
        source = clean_str(row.get(cols["source_type"])) if cols["source_type"] else ""
        if source:
            entry["_sources"][source] += 1
        year = extract_year(row.get(cols["pub_date"])) if cols["pub_date"] else None
        if year:
            entry["_years"].append(year)

    out: List[Dict[str, Any]] = []
    for entry in grouped.values():
        runtimes = entry.pop("_runtimes")
        countries = entry.pop("_countries")
        sources = entry.pop("_sources")
        years = entry.pop("_years")
        entry["median_seconds"] = int(median(runtimes)) if runtimes else 0
        entry["country"] = countries.most_common(1)[0][0] if countries else ""
        entry["source_type"] = sources.most_common(1)[0][0] if sources else ""
        entry["year_min"] = min(years) if years else None
        entry["year_max"] = max(years) if years else None
        out.append(entry)

    out.sort(key=lambda e: (-e["items"], e["name"]))
    return out


def compute_countries(
    df: pd.DataFrame,
    cols: Dict[str, Optional[str]],
) -> List[Dict[str, Any]]:
    """Country rollup, dual measure. ``country`` is single-valued on this
    subset (resolved upstream from item set / spatial / publisher), so this is
    a plain group-by rather than a pipe split."""
    grouped: Dict[str, Dict[str, Any]] = {}
    for _, row in df.iterrows():
        name = canonical_country(clean_str(row.get(cols["country"]))) if cols["country"] else ""
        if not name:
            continue
        entry = grouped.setdefault(name, {"name": name, "items": 0, "seconds": 0})
        entry["items"] += 1
        entry["seconds"] += _seconds(row, cols["duration_seconds"], cols["extent"])
    out = list(grouped.values())
    out.sort(key=lambda e: (-e["items"], e["name"]))
    return out


def compute_durations(
    df: pd.DataFrame,
    cols: Dict[str, Optional[str]],
) -> Dict[str, Any]:
    """
    Runtime histogram, split by population. The two populations occupy almost
    disjoint buckets — that separation IS the finding, so the panel stacks
    them rather than merging into one distribution.
    """
    counts: Dict[str, Counter] = defaultdict(Counter)
    for _, row in df.iterrows():
        secs = _seconds(row, cols["duration_seconds"], cols["extent"])
        if secs <= 0:
            continue
        source = clean_str(row.get(cols["source_type"])) if cols["source_type"] else ""
        counts[source or "unknown"][_bucket_key(secs)] += 1

    keys = [k for k, _ in DURATION_BUCKETS]
    sources = sorted(counts.keys())
    return {
        "buckets": keys,
        "sources": sources,
        "series": {
            source: [int(counts[source].get(k, 0)) for k in keys]
            for source in sources
        },
    }


def compute_timeline(
    df: pd.DataFrame,
    cols: Dict[str, Optional[str]],
    top_channels: int,
) -> Dict[str, Any]:
    """
    Publication year x channel, shaped for ``C.stackedBar``.

    Two honesty rails:
      * the newest year is almost always partial (ingestion is continuous), so
        ``partial_year`` + ``latest_date`` ship with the series and the panel
        says so rather than drawing a cliff;
      * rows with no parseable ``pub_date`` are counted into ``undated``
        instead of being silently dropped.
    """
    per_year: Dict[int, Counter] = defaultdict(Counter)
    undated = 0
    latest_date = ""

    channel_totals = Counter()
    for _, row in df.iterrows():
        name = clean_str(row.get(cols["publisher"])) if cols["publisher"] else ""
        if name:
            channel_totals[name] += 1

    keep = {name for name, _ in channel_totals.most_common(top_channels)}

    for _, row in df.iterrows():
        year = extract_year(row.get(cols["pub_date"])) if cols["pub_date"] else None
        if not year:
            undated += 1
            continue
        raw_date = clean_str(row.get(cols["pub_date"])) if cols["pub_date"] else ""
        if len(raw_date) >= 10 and raw_date > latest_date:
            latest_date = raw_date
        name = clean_str(row.get(cols["publisher"])) if cols["publisher"] else ""
        label = name if name in keep else "__other__"
        per_year[year][label] += 1

    if not per_year:
        return {"years": [], "channels": [], "series": {}, "undated": undated}

    years = sorted(per_year.keys())
    channels = [name for name, _ in channel_totals.most_common(top_channels) if name in keep]
    has_other = any("__other__" in per_year[y] for y in years)
    stack_keys = channels + (["__other__"] if has_other else [])

    return {
        "years": [str(y) for y in years],
        "channels": stack_keys,
        "series": {
            key: [int(per_year[y].get(key, 0)) for y in years]
            for key in stack_keys
        },
        "undated": undated,
        "partial_year": str(years[-1]) if years else "",
        "latest_date": latest_date,
    }


def compute_coverage(
    df: pd.DataFrame,
    cols: Dict[str, Optional[str]],
) -> List[Dict[str, Any]]:
    """
    What this subset actually carries, as present/total pairs.

    This is the honest home for the thin fields. `language` reads 99.9%
    populated and would chart as a single 99% bar; as a completeness row
    beside `subject` at 1.5% it says the true thing — that these are metadata
    surfaces of very different maturity — without inviting a reader to mistake
    a cataloguing artefact for a fact about the sources.
    """
    total = len(df)
    fields = [
        ("description", cols["description"]),
        ("transcription", cols["OCR"]),
        ("pub_date", cols["pub_date"]),
        ("thumbnail", cols["thumbnail"]),
        ("language", cols["language"]),
        ("creator", cols["creator"]),
        ("subject", cols["subject"]),
    ]
    out = []
    for key, col in fields:
        present = _present(df[col]) if col and col in df.columns else 0
        out.append({"key": key, "present": present, "total": total})
    return out


def compute_recent(
    df: pd.DataFrame,
    cols: Dict[str, Optional[str]],
    limit: int,
) -> List[Dict[str, Any]]:
    """
    Newest items, with the poster frame and a watch link.

    The link differs by population and must not be guessed: a YouTube row has
    no media file at all (``PDF`` empty, IIIF manifest zero-canvas), so its
    external ``URL`` is the only playable target; a deposited row has a real
    file. Both always carry ``iwac_url`` as the fallback.
    """
    if not cols["pub_date"]:
        return []

    work = df.copy()
    work["_sort"] = pd.to_datetime(work[cols["pub_date"]], errors="coerce")
    work = work.dropna(subset=["_sort"]).sort_values("_sort", ascending=False).head(limit)

    out = []
    for _, row in work.iterrows():
        source = clean_str(row.get(cols["source_type"])) if cols["source_type"] else ""
        external = clean_str(row.get(cols["URL"])) if cols["URL"] else ""
        media = clean_str(row.get(cols["PDF"])) if cols["PDF"] else ""
        iwac = clean_str(row.get(cols["iwac_url"])) if cols["iwac_url"] else ""
        out.append({
            "id": clean_str(row.get(cols["o:id"])) if cols["o:id"] else "",
            "title": clean_str(row.get(cols["title"])) if cols["title"] else "",
            "channel": clean_str(row.get(cols["publisher"])) if cols["publisher"] else "",
            "country": canonical_country(clean_str(row.get(cols["country"]))) if cols["country"] else "",
            "date": clean_str(row.get(cols["pub_date"])),
            "seconds": _seconds(row, cols["duration_seconds"], cols["extent"]),
            "thumbnail": clean_str(row.get(cols["thumbnail"])) if cols["thumbnail"] else "",
            "source_type": source,
            # Watch target, in preference order. Never assume a file exists.
            "url": external or media or iwac,
            "iwac_url": iwac,
        })
    return out


def compute_summary(
    df: pd.DataFrame,
    cols: Dict[str, Optional[str]],
    channels: List[Dict[str, Any]],
    countries: List[Dict[str, Any]],
    timeline: Dict[str, Any],
) -> Dict[str, Any]:
    """Header figures. Every one is measured, never carried forward from a
    previous run — this subset is still being ingested, so a hardcoded count
    would be stale within days."""
    runtimes_by_source: Dict[str, List[int]] = defaultdict(list)
    total_seconds = 0
    for _, row in df.iterrows():
        secs = _seconds(row, cols["duration_seconds"], cols["extent"])
        total_seconds += secs
        source = clean_str(row.get(cols["source_type"])) if cols["source_type"] else ""
        if secs > 0:
            runtimes_by_source[source or "unknown"].append(secs)

    source_counts = Counter()
    if cols["source_type"]:
        for value in df[cols["source_type"]]:
            source_counts[clean_str(value) or "unknown"] += 1

    years = [int(y) for y in timeline.get("years", []) if y.isdigit()]

    return {
        "items": len(df),
        "seconds": total_seconds,
        "channels": len(channels),
        "countries": len(countries),
        "year_min": min(years) if years else None,
        "year_max": max(years) if years else None,
        "latest_date": timeline.get("latest_date", ""),
        "by_source": [
            {
                "key": source,
                "items": int(count),
                "median_seconds": int(median(runtimes_by_source[source]))
                if runtimes_by_source.get(source) else 0,
                "seconds": int(sum(runtimes_by_source.get(source, []))),
            }
            for source, count in source_counts.most_common()
        ],
    }


# =============================================================================
# Orchestration
# =============================================================================

def build_audiovisual_overview(
    repo_id: str = DATASET_ID,
    token: Optional[str] = None,
    top_channels: int = TOP_CHANNELS_TIMELINE,
    recent_items: int = RECENT_ITEMS,
) -> Dict[str, Any]:
    df = load_dataset_safe("audiovisual", repo_id=repo_id, token=token, columns=COLUMNS)
    if df is None or df.empty:
        logger.error("audiovisual subset unavailable or empty")
        return {"metadata": create_metadata_block(0, data_source=repo_id), "summary": {}}

    logger.info("Loaded %d audiovisual rows", len(df))

    # Resolve columns once. `find_column` tolerates the schema drifting
    # (this subset gained seven columns in a single 2026-08 upload).
    cols: Dict[str, Optional[str]] = {
        name: find_column(df, [name]) for name in COLUMNS
    }
    missing = [k for k, v in cols.items() if v is None]
    if missing:
        logger.warning("Columns absent from the subset, panels will degrade: %s",
                       ", ".join(missing))

    channels = compute_channels(df, cols)
    countries = compute_countries(df, cols)
    durations = compute_durations(df, cols)
    timeline = compute_timeline(df, cols, top_channels)
    coverage = compute_coverage(df, cols)
    recent = compute_recent(df, cols, recent_items)
    summary = compute_summary(df, cols, channels, countries, timeline)

    logger.info(
        "Summary: %d items, %.1f hours, %d channels, %d countries",
        summary["items"], summary["seconds"] / 3600.0,
        summary["channels"], summary["countries"],
    )

    return {
        "metadata": create_metadata_block(len(df), data_source=repo_id),
        "summary": summary,
        "channels": channels,
        "countries": countries,
        "durations": durations,
        "timeline": timeline,
        "coverage": coverage,
        "recent": recent,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--output",
        default="asset/data/audiovisual-overview.json",
        help="Output JSON path, relative to the module root (default: %(default)s)",
    )
    parser.add_argument(
        "--top-channels", type=int, default=TOP_CHANNELS_TIMELINE,
        help="Channels kept as their own timeline series (default: %(default)s)",
    )
    parser.add_argument(
        "--recent-items", type=int, default=RECENT_ITEMS,
        help="Items in the recently-published strip (default: %(default)s)",
    )
    add_standard_args(parser, minify_default=False)
    args = parse_standard_args(parser)

    payload = build_audiovisual_overview(
        repo_id=args.repo,
        token=os.getenv("HF_TOKEN"),
        top_channels=args.top_channels,
        recent_items=args.recent_items,
    )

    output_path = Path(args.output)
    save_json(payload, output_path, minify=args.minify)
    logger.info("Wrote %s", output_path)


if __name__ == "__main__":
    main()
