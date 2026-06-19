#!/usr/bin/env python3
"""
generate_references_overview.py
================================

Generate ``asset/data/references-overview.json`` for the IwacVisualizations
module's References Overview page block.

Replaces the old client-side path that paged through the Hugging Face
datasets-server ``/rows`` endpoint at runtime — every visit triggered ~9
parallel HTTP fetches and a full client-side aggregation pass over 864 rows.
The block now loads a single precomputed JSON instead, and the block JS
just renders the panels.

Payload shape (top-level keys):

    metadata                   — standard provenance block
    summary                    — counts + time span + author / publisher / etc.
    timeline                   — references per year, stacked by type
    types                      — top-N type histogram (English-translatable
                                 keys; the JS calls P.t('ref_type_<x>') so
                                 the labels switch with the active locale)
    languages                  — top-N language histogram (raw French keys
                                 so the JS can call P.t('lang_<x>'))
    countries                  — top-N country histogram
    authors                    — top-N author histogram
    publishers                 — top-N publisher histogram
    publisher_countries        — country-faceted publisher rankings
    subjects                   — top-N subject histogram
    treemap                    — country -> type breakdown
    provenance_map             — geocoded reference-origin points
    subject_cooccurrence       — { nodes, edges, meta } subject graph
    author_collaborations      — { nodes, edges } graph of co-authoring +
                                 author-editor links, used by the new
                                 ``Author collaborations`` network panel

Usage
-----
    python scripts/generate_references_overview.py
    python scripts/generate_references_overview.py --output asset/data/references-overview.json
    python scripts/generate_references_overview.py --top-n 15

Environment
-----------
    HF_TOKEN   Optional Hugging Face access token (public dataset).
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    canonicalize_country_field,
    configure_logging,
    create_metadata_block,
    extract_year,
    is_unknown,
    load_dataset_safe,
    parse_coordinates,
    parse_pipe_separated,
    save_json,
)

SUBSET = "references"

# Top-N caps for the various ranking panels. Match the historical numbers
# the block JS used so the output is visually identical to the old live-fetch.
TOP_N_AUTHORS = 15
TOP_N_SUBJECTS = 15
TOP_N_LANGUAGES = 10
TOP_N_COUNTRIES = 10
TOP_N_TYPES = 10
TOP_N_PUBLISHERS = 15

# Network filter — only keep authors who appear in at least this many edges.
# 864 rows produces a long tail of one-off co-authors that bloats the graph
# without adding any analytical value. Tunable via --network-min-degree.
DEFAULT_NETWORK_MIN_DEGREE = 2

# Subject co-occurrence edge filter. The references subset is small, so the
# default keeps one-off pairings visible; consumers can tune upward.
DEFAULT_SUBJECT_NETWORK_MIN_WEIGHT = 1

PROVENANCE_PUBLICATION_LIMIT = 50
PROVENANCE_COLUMNS = ("provenance", "Provenance", "place", "Place", "lieu", "Lieu")


# Local alias for the shared iwac_utils.is_unknown (call sites keep the short name).
_is_unknown = is_unknown


def _clean_list(values: List[str]) -> List[str]:
    return [v for v in (s.strip() for s in values) if v and not _is_unknown(v)]


def _clean_text(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    return "" if _is_unknown(text) else text


def _clean_unique_list(values: List[str]) -> List[str]:
    seen: set = set()
    result: List[str] = []
    for value in _clean_list(values):
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _ref_type(row: pd.Series) -> str:
    raw = row.get("o:resource_class") or row.get("type") or ""
    raw = str(raw).strip()
    return raw or "Unknown"


def _reference_id(row: pd.Series, fallback_index: Any) -> str:
    for field in ("o:id", "identifier", "id"):
        value = _clean_text(row.get(field))
        if value:
            return value
    return f"ref:{fallback_index}"


def _reference_title(row: pd.Series) -> str:
    for field in ("title", "o:title"):
        value = _clean_text(row.get(field))
        if value:
            return value
    return "Untitled"


def _first_pipe_value(row: pd.Series, field: str) -> str:
    values = _clean_unique_list(parse_pipe_separated(row.get(field)))
    return values[0] if values else ""


def _lookup_key(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _subject_id(label: str) -> str:
    digest = hashlib.sha1(label.encode("utf-8")).hexdigest()[:10]
    return f"subject:{digest}"


def _publication_record(row: pd.Series, fallback_index: Any) -> Dict[str, Any]:
    record: Dict[str, Any] = {
        "id": _reference_id(row, fallback_index),
        "title": _reference_title(row),
        "type": _ref_type(row),
    }
    o_id = _clean_text(row.get("o:id"))
    if o_id:
        record["o_id"] = o_id
    date = _clean_text(row.get("pub_date"))
    if date:
        record["date"] = date
    publisher = _first_pipe_value(row, "publisher")
    if publisher:
        record["publisher"] = publisher
    authors = _clean_unique_list(parse_pipe_separated(row.get("author")))
    if authors:
        record["authors"] = authors[:5]
    return record


# ---------------------------------------------------------------------------
#  Aggregations
# ---------------------------------------------------------------------------

def compute_summary(rows: pd.DataFrame) -> Dict[str, Any]:
    authors: set = set()
    publishers: set = set()
    languages: set = set()
    countries: set = set()
    types: set = set()
    year_min: Optional[int] = None
    year_max: Optional[int] = None

    for _, row in rows.iterrows():
        for a in _clean_list(parse_pipe_separated(row.get("author"))):
            authors.add(a)
        for p in _clean_list(parse_pipe_separated(row.get("publisher"))):
            publishers.add(p)
        for l in _clean_list(parse_pipe_separated(row.get("language"))):
            languages.add(l)
        for c in _clean_list(parse_pipe_separated(row.get("country"))):
            countries.add(c)
        types.add(_ref_type(row))
        year = extract_year(row.get("pub_date"))
        if year is not None:
            year_min = year if year_min is None else min(year_min, year)
            year_max = year if year_max is None else max(year_max, year)

    return {
        "total":      int(len(rows)),
        "authors":    len(authors),
        "publishers": len(publishers),
        "languages":  len(languages),
        "countries":  len(countries),
        "types":      len(types),
        "year_min":   year_min,
        "year_max":   year_max,
    }


def compute_timeline(rows: pd.DataFrame) -> Dict[str, Any]:
    """Per-year × type matrix shaped to feed C.timeline directly.

    Note: the type names are kept *raw* (French source values like
    "Article de revue"). The JS panel translates them via
    ``P.t('ref_type_' + name)`` at render time so the labels track the
    active locale. The "countries" key in the returned dict is
    misleadingly named — C.timeline expects the field to hold the
    stack-series categories, which here are reference types.
    """
    by_year_type: Dict[int, Counter] = defaultdict(Counter)
    type_totals: Counter = Counter()
    seen_years: set = set()

    for _, row in rows.iterrows():
        year = extract_year(row.get("pub_date"))
        if year is None:
            continue
        type_label = _ref_type(row)
        by_year_type[year][type_label] += 1
        type_totals[type_label] += 1
        seen_years.add(year)

    if not seen_years:
        return {"years": [], "countries": [], "series": {}}

    years = sorted(seen_years)
    types_sorted = [t for t, _ in type_totals.most_common()]
    series: Dict[str, List[int]] = {}
    for t in types_sorted:
        series[t] = [int(by_year_type[y].get(t, 0)) for y in years]

    return {
        "years":     years,
        "countries": types_sorted,  # naming kept for C.timeline compat
        "series":    series,
    }


def _top_n_pipe(rows: pd.DataFrame, field: str, n: int) -> List[Dict[str, Any]]:
    counter: Counter = Counter()
    for value in rows.get(field, []):
        for v in _clean_list(parse_pipe_separated(value)):
            counter[v] += 1
    return [
        {"name": name, "count": int(count)}
        for name, count in counter.most_common(n)
    ]


def compute_type_distribution(rows: pd.DataFrame, n: int) -> List[Dict[str, Any]]:
    counter: Counter = Counter()
    for _, row in rows.iterrows():
        counter[_ref_type(row)] += 1
    return [
        {"name": name, "count": int(count)}
        for name, count in counter.most_common(n)
    ]


def compute_publisher_rankings(
    rows: pd.DataFrame,
    n: int,
    country_filter: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Top publishers, optionally limited to references tagged with a country."""
    publisher_refs: Dict[str, set] = defaultdict(set)
    publisher_types: Dict[str, Counter] = defaultdict(Counter)
    publisher_years: Dict[str, List[int]] = defaultdict(list)

    for fallback_index, row in rows.iterrows():
        if country_filter:
            countries = set(_clean_unique_list(parse_pipe_separated(row.get("country"))))
            if country_filter not in countries:
                continue

        publishers = _clean_unique_list(parse_pipe_separated(row.get("publisher")))
        if not publishers:
            continue

        ref_id = _reference_id(row, fallback_index)
        ref_type = _ref_type(row)
        year = extract_year(row.get("pub_date"))
        for publisher in publishers:
            if ref_id in publisher_refs[publisher]:
                continue
            publisher_refs[publisher].add(ref_id)
            publisher_types[publisher][ref_type] += 1
            if year is not None:
                publisher_years[publisher].append(year)

    entries: List[Dict[str, Any]] = []
    for publisher, ref_ids in publisher_refs.items():
        years = publisher_years.get(publisher, [])
        entry: Dict[str, Any] = {
            "name":  publisher,
            "count": int(len(ref_ids)),
            "types": [
                {"name": name, "count": int(count)}
                for name, count in publisher_types[publisher].most_common()
            ],
        }
        if years:
            entry["earliest_year"] = int(min(years))
            entry["latest_year"] = int(max(years))
        entries.append(entry)

    entries.sort(key=lambda item: (-item["count"], item["name"]))
    return entries[:n]


def compute_publisher_countries(rows: pd.DataFrame, n: int) -> Dict[str, List[Dict[str, Any]]]:
    countries: set = set()
    for value in rows.get("country", []):
        countries.update(_clean_unique_list(parse_pipe_separated(value)))

    return {
        country: compute_publisher_rankings(rows, n, country_filter=country)
        for country in sorted(countries)
    }


def compute_treemap(rows: pd.DataFrame) -> Dict[str, Any]:
    """Country → type tree consumed by C.treemap."""
    by_country: Dict[str, Counter] = defaultdict(Counter)
    for _, row in rows.iterrows():
        type_label = _ref_type(row)
        for country in _clean_list(parse_pipe_separated(row.get("country"))):
            by_country[country][type_label] += 1

    children = []
    for country, type_counts in by_country.items():
        type_children = [
            {"name": t, "value": int(c)}
            for t, c in type_counts.most_common()
        ]
        children.append({
            "name":     country,
            "value":    int(sum(type_counts.values())),
            "children": type_children,
        })
    children.sort(key=lambda c: -c["value"])
    return {"name": "References", "children": children}


# ---------------------------------------------------------------------------
#  Provenance map
# ---------------------------------------------------------------------------

def _empty_provenance_map(reason: str, source_field: Optional[str] = None) -> Dict[str, Any]:
    return {
        "locations": [],
        "bounds": None,
        "meta": {
            "totalLocations": 0,
            "totalPublications": 0,
            "matchedPublications": 0,
            "maxCount": 0,
            "sourceField": source_field,
            "reason": reason,
        },
    }


def build_coordinate_lookup(index_rows: Optional[pd.DataFrame]) -> Dict[str, Dict[str, Any]]:
    if index_rows is None or index_rows.empty:
        return {}

    lookup: Dict[str, Dict[str, Any]] = {}
    for _, row in index_rows.iterrows():
        coordinates = parse_coordinates(row.get("Coordonnées"))
        title = _clean_text(row.get("Titre") or row.get("title") or row.get("o:title"))
        if not coordinates or not title:
            continue

        lat, lng = coordinates
        entry: Dict[str, Any] = {
            "name": title,
            "lat": float(lat),
            "lng": float(lng),
        }
        o_id = _clean_text(row.get("o:id"))
        if o_id:
            entry["o_id"] = o_id
        entity_type = _clean_text(row.get("Type"))
        if entity_type:
            entry["type"] = entity_type

        labels = [title] + _clean_unique_list(parse_pipe_separated(row.get("Titre alternatif")))
        for label in labels:
            key = _lookup_key(label)
            if key and key not in lookup:
                lookup[key] = entry

    return lookup


def compute_provenance_map(
    rows: pd.DataFrame,
    coord_lookup: Dict[str, Dict[str, Any]],
    source_field: Optional[str],
    publication_limit: int = PROVENANCE_PUBLICATION_LIMIT,
) -> Dict[str, Any]:
    if not source_field:
        return _empty_provenance_map("missing_provenance_field")
    if not coord_lookup:
        return _empty_provenance_map("missing_coordinate_lookup", source_field)

    aggregates: Dict[str, Dict[str, Any]] = {}
    total_with_provenance = 0
    matched_publications: set = set()
    unmatched: Counter = Counter()

    for fallback_index, row in rows.iterrows():
        places = _clean_unique_list(parse_pipe_separated(row.get(source_field)))
        if not places:
            continue

        total_with_provenance += 1
        ref_id = _reference_id(row, fallback_index)
        publication = _publication_record(row, fallback_index)
        ref_type = _ref_type(row)
        year = extract_year(row.get("pub_date"))
        matched_row = False

        for place in places:
            match = coord_lookup.get(_lookup_key(place))
            if not match:
                unmatched[place] += 1
                continue

            matched_row = True
            key = match["name"]
            aggregate = aggregates.setdefault(key, {
                "name": match["name"],
                "lat": match["lat"],
                "lng": match["lng"],
                "o_id": match.get("o_id"),
                "_pub_ids": set(),
                "_types": Counter(),
                "_years": [],
                "publications": [],
            })
            if ref_id not in aggregate["_pub_ids"]:
                aggregate["_pub_ids"].add(ref_id)
                aggregate["_types"][ref_type] += 1
                if year is not None:
                    aggregate["_years"].append(year)
                if len(aggregate["publications"]) < publication_limit:
                    aggregate["publications"].append(publication)

        if matched_row:
            matched_publications.add(ref_id)

    if not aggregates:
        result = _empty_provenance_map("no_matching_coordinates", source_field)
        result["meta"]["totalPublications"] = int(total_with_provenance)
        result["meta"]["unmatchedLocations"] = [
            {"name": name, "count": int(count)}
            for name, count in unmatched.most_common(20)
        ]
        return result

    locations: List[Dict[str, Any]] = []
    for aggregate in aggregates.values():
        years = aggregate["_years"]
        location: Dict[str, Any] = {
            "name": aggregate["name"],
            "lat": aggregate["lat"],
            "lng": aggregate["lng"],
            "count": int(len(aggregate["_pub_ids"])),
            "types": [
                {"name": name, "count": int(count)}
                for name, count in aggregate["_types"].most_common()
            ],
            "publications": aggregate["publications"],
        }
        if aggregate.get("o_id"):
            location["o_id"] = aggregate["o_id"]
        if years:
            location["earliestYear"] = int(min(years))
            location["latestYear"] = int(max(years))
        locations.append(location)

    locations.sort(key=lambda item: (-item["count"], item["name"]))
    max_count = max(location["count"] for location in locations)
    for location in locations:
        location["countNorm"] = round(location["count"] / max_count, 4) if max_count else 0

    bounds = {
        "north": max(location["lat"] for location in locations),
        "south": min(location["lat"] for location in locations),
        "east": max(location["lng"] for location in locations),
        "west": min(location["lng"] for location in locations),
    }

    return {
        "locations": locations,
        "bounds": bounds,
        "meta": {
            "totalLocations": int(len(locations)),
            "totalPublications": int(total_with_provenance),
            "matchedPublications": int(len(matched_publications)),
            "maxCount": int(max_count),
            "sourceField": source_field,
            "unmatchedLocations": [
                {"name": name, "count": int(count)}
                for name, count in unmatched.most_common(20)
            ],
        },
    }


# ---------------------------------------------------------------------------
#  Subject co-occurrence network
# ---------------------------------------------------------------------------

def compute_subject_cooccurrence(rows: pd.DataFrame, min_weight: int) -> Dict[str, Any]:
    subject_counts: Counter = Counter()
    edge_weights: Dict[Tuple[str, str], int] = defaultdict(int)
    edge_refs: Dict[Tuple[str, str], List[str]] = defaultdict(list)

    for fallback_index, row in rows.iterrows():
        subjects = _clean_unique_list(parse_pipe_separated(row.get("subject")))
        if not subjects:
            continue

        ref_id = _reference_id(row, fallback_index)
        for subject in subjects:
            subject_counts[subject] += 1

        for source, target in combinations(sorted(subjects), 2):
            key = (source, target)
            edge_weights[key] += 1
            if len(edge_refs[key]) < 100:
                edge_refs[key].append(ref_id)

    degree: Counter = Counter()
    strength: Counter = Counter()
    filtered_edges = {
        key: weight
        for key, weight in edge_weights.items()
        if weight >= min_weight
    }
    for (source, target), weight in filtered_edges.items():
        degree[source] += 1
        degree[target] += 1
        strength[source] += weight
        strength[target] += weight

    participating_subjects = set(degree)
    sorted_subjects = sorted(
        participating_subjects,
        key=lambda subject: (-strength[subject], -subject_counts[subject], subject),
    )
    id_by_subject = {subject: _subject_id(subject) for subject in sorted_subjects}

    nodes = [
        {
            "id": id_by_subject[subject],
            "type": "subject",
            "label": subject,
            "name": subject,
            "count": int(subject_counts[subject]),
            "value": int(subject_counts[subject]),
            "degree": int(degree[subject]),
            "strength": int(strength[subject]),
            "labelPriority": int(index),
        }
        for index, subject in enumerate(sorted_subjects)
    ]

    edges = [
        {
            "source": id_by_subject[source],
            "target": id_by_subject[target],
            "sourceLabel": source,
            "targetLabel": target,
            "type": "subject-subject",
            "weight": int(weight),
            "referenceIds": edge_refs[(source, target)],
        }
        for (source, target), weight in filtered_edges.items()
        if source in id_by_subject and target in id_by_subject
    ]
    edges.sort(key=lambda edge: (-edge["weight"], edge["sourceLabel"], edge["targetLabel"]))

    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "totalSubjects": int(len(subject_counts)),
            "totalNodes": int(len(nodes)),
            "totalEdges": int(len(edges)),
            "minWeight": int(min_weight),
            "maxWeight": int(max(filtered_edges.values()) if filtered_edges else 0),
        },
    }


# ---------------------------------------------------------------------------
#  Author collaboration network
# ---------------------------------------------------------------------------

def compute_author_collaborations(
    rows: pd.DataFrame,
    min_degree: int,
) -> Dict[str, Any]:
    """Build a co-authorship + author-editor graph.

    Two edge types:
      - ``coauthor``   between every pair of authors that appear in the
                       same ``author`` field (pipe-separated)
      - ``author_editor`` between every author and every editor that
                       appear together on the same record (when the
                       record has both ``author`` and ``editor``)

    Edges are merged across records: weight = number of co-occurring
    references, with a per-edge ``types`` set so a single pair that
    collaborates as both co-authors and as author/editor surfaces the
    dual relationship.

    To keep the graph readable we drop nodes whose total degree (number
    of distinct collaborators) is strictly below ``min_degree``.

    Returned shape (consumed by a new C.collaborationNetwork panel in
    chart-options.js):

        {
            "nodes": [
                { "id": str, "name": str, "value": int, "kind": "author" }
            ],
            "edges": [
                { "source": str, "target": str, "weight": int,
                  "type": "coauthor" | "author_editor" | "both" }
            ]
        }
    """
    # Use a tuple key (sorted pair) so we don't duplicate (a,b)/(b,a).
    edge_weights: Dict[Tuple[str, str], int] = defaultdict(int)
    edge_types: Dict[Tuple[str, str], set] = defaultdict(set)
    node_records: Counter = Counter()  # count of references each person appears on

    for _, row in rows.iterrows():
        authors = _clean_list(parse_pipe_separated(row.get("author")))
        editors = _clean_list(parse_pipe_separated(row.get("editor")))

        for a in authors:
            node_records[a] += 1
        for e in editors:
            node_records[e] += 1

        # Co-author pairs (i < j to keep edges undirected).
        for a, b in combinations(sorted(set(authors)), 2):
            key = (a, b)
            edge_weights[key] += 1
            edge_types[key].add("coauthor")

        # Author-editor pairs — every author × every editor on the same row.
        # Skip self-loops where the same person is both author and editor.
        for a in set(authors):
            for e in set(editors):
                if a == e:
                    continue
                key = tuple(sorted((a, e)))
                edge_weights[key] += 1
                edge_types[key].add("author_editor")

    # Degree-based pruning — drop low-connectivity nodes after edges are
    # built so we don't accidentally orphan their collaborators.
    degree: Counter = Counter()
    for (a, b) in edge_weights:
        degree[a] += 1
        degree[b] += 1
    keep = {n for n, d in degree.items() if d >= min_degree}

    nodes = [
        {
            "id":    name,
            "name":  name,
            "value": int(node_records.get(name, 0)),
            "kind":  "author",
        }
        for name in sorted(keep, key=lambda n: -node_records.get(n, 0))
    ]
    edges = []
    for (a, b), weight in edge_weights.items():
        if a not in keep or b not in keep:
            continue
        types = edge_types[(a, b)]
        if "coauthor" in types and "author_editor" in types:
            edge_type = "both"
        elif "coauthor" in types:
            edge_type = "coauthor"
        else:
            edge_type = "author_editor"
        edges.append({
            "source": a,
            "target": b,
            "weight": int(weight),
            "type":   edge_type,
        })

    edges.sort(key=lambda e: -e["weight"])

    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
#  Top-level builder
# ---------------------------------------------------------------------------

def build_references_overview(
    repo_id: str,
    token: Optional[str],
    top_n_authors: int,
    top_n_subjects: int,
    top_n_publishers: int,
    top_n_languages: int,
    top_n_countries: int,
    top_n_types: int,
    network_min_degree: int,
    subject_network_min_weight: int,
) -> Dict[str, Any]:
    logger = logging.getLogger(__name__)
    logger.info("Loading IWAC references subset from %s", repo_id)

    df = load_dataset_safe(SUBSET, repo_id=repo_id, token=token)
    if df is None or df.empty:
        raise RuntimeError("Failed to load references subset — aborting")

    if "country" in df.columns:
        df["country"] = df["country"].apply(canonicalize_country_field)

    logger.info("  %d reference rows loaded", len(df))

    summary = compute_summary(df)
    timeline = compute_timeline(df)
    types = compute_type_distribution(df, top_n_types)
    languages = _top_n_pipe(df, "language", top_n_languages)
    countries = _top_n_pipe(df, "country", top_n_countries)
    authors = _top_n_pipe(df, "author", top_n_authors)
    publishers = compute_publisher_rankings(df, top_n_publishers)
    publisher_countries = compute_publisher_countries(df, top_n_publishers)
    subjects = _top_n_pipe(df, "subject", top_n_subjects)
    treemap = compute_treemap(df)

    provenance_field = next((field for field in PROVENANCE_COLUMNS if field in df.columns), None)
    coord_lookup: Dict[str, Dict[str, Any]] = {}
    if provenance_field:
        logger.info("Loading IWAC index subset for provenance geocoding")
        index_df = load_dataset_safe("index", repo_id=repo_id, token=token)
        coord_lookup = build_coordinate_lookup(index_df)
        logger.info("  %d geocoded authority labels available", len(coord_lookup))
    else:
        logger.info("No provenance field found in references subset; provenance map will use empty-state contract")
    provenance_map = compute_provenance_map(df, coord_lookup, provenance_field)

    logger.info(
        "Building subject co-occurrence graph (min_weight=%d)",
        subject_network_min_weight,
    )
    subject_cooccurrence = compute_subject_cooccurrence(
        df,
        min_weight=subject_network_min_weight,
    )
    logger.info(
        "  subject graph: %d nodes, %d edges",
        len(subject_cooccurrence["nodes"]),
        len(subject_cooccurrence["edges"]),
    )

    logger.info("Building author collaboration network (min_degree=%d)", network_min_degree)
    collaborations = compute_author_collaborations(df, min_degree=network_min_degree)
    logger.info(
        "  graph: %d nodes, %d edges",
        len(collaborations["nodes"]),
        len(collaborations["edges"]),
    )

    metadata = create_metadata_block(
        total_records=summary["total"],
        data_source=repo_id,
        script="generate_references_overview.py",
        script_version="0.2.0",
    )

    return {
        "metadata":              metadata,
        "summary":               summary,
        "timeline":              timeline,
        "types":                 types,
        "languages":             languages,
        "countries":             countries,
        "authors":               authors,
        "publishers":            publishers,
        "publisher_countries":    publisher_countries,
        "subjects":              subjects,
        "treemap":               treemap,
        "provenance_map":         provenance_map,
        "subject_cooccurrence":   subject_cooccurrence,
        "author_collaborations": collaborations,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repository ID",
    )
    parser.add_argument(
        "--output",
        default="asset/data/references-overview.json",
        help="Output JSON path, relative to the module root",
    )
    parser.add_argument("--top-n-authors",   type=int, default=TOP_N_AUTHORS)
    parser.add_argument("--top-n-subjects",  type=int, default=TOP_N_SUBJECTS)
    parser.add_argument("--top-n-publishers", type=int, default=TOP_N_PUBLISHERS)
    parser.add_argument("--top-n-languages", type=int, default=TOP_N_LANGUAGES)
    parser.add_argument("--top-n-countries", type=int, default=TOP_N_COUNTRIES)
    parser.add_argument("--top-n-types",     type=int, default=TOP_N_TYPES)
    parser.add_argument(
        "--network-min-degree", type=int, default=DEFAULT_NETWORK_MIN_DEGREE,
        help="Drop authors whose total collaborators are below this number",
    )
    parser.add_argument(
        "--subject-network-min-weight",
        type=int,
        default=DEFAULT_SUBJECT_NETWORK_MIN_WEIGHT,
        help="Drop subject co-occurrence edges below this weight",
    )
    parser.add_argument("--minify", action=argparse.BooleanOptionalAction,
                        default=False,
                        help="Produce compact JSON (no indentation) (default: %(default)s)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    configure_logging(level=logging.DEBUG if args.verbose else logging.INFO)

    repo_id = args.repo
    token = os.getenv("HF_TOKEN")

    payload = build_references_overview(
        repo_id=repo_id,
        token=token,
        top_n_authors=args.top_n_authors,
        top_n_subjects=args.top_n_subjects,
        top_n_publishers=args.top_n_publishers,
        top_n_languages=args.top_n_languages,
        top_n_countries=args.top_n_countries,
        top_n_types=args.top_n_types,
        network_min_degree=args.network_min_degree,
        subject_network_min_weight=args.subject_network_min_weight,
    )

    output_path = Path(args.output)
    save_json(payload, output_path, minify=args.minify)
    logging.getLogger(__name__).info("Wrote %s", output_path)


if __name__ == "__main__":
    main()
