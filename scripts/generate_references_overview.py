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
    subjects                   — top-N subject histogram
    treemap                    — country -> type breakdown
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

# Network filter — only keep authors who appear in at least this many edges.
# 864 rows produces a long tail of one-off co-authors that bloats the graph
# without adding any analytical value. Tunable via --network-min-degree.
DEFAULT_NETWORK_MIN_DEGREE = 2


# Local alias for the shared iwac_utils.is_unknown (call sites keep the short name).
_is_unknown = is_unknown


def _clean_list(values: List[str]) -> List[str]:
    return [v for v in (s.strip() for s in values) if v and not _is_unknown(v)]


def _ref_type(row: pd.Series) -> str:
    raw = row.get("o:resource_class") or row.get("type") or ""
    raw = str(raw).strip()
    return raw or "Unknown"


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
    top_n_languages: int,
    top_n_countries: int,
    top_n_types: int,
    network_min_degree: int,
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
    subjects = _top_n_pipe(df, "subject", top_n_subjects)
    treemap = compute_treemap(df)

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
        script_version="0.1.0",
    )

    return {
        "metadata":              metadata,
        "summary":               summary,
        "timeline":              timeline,
        "types":                 types,
        "languages":             languages,
        "countries":             countries,
        "authors":               authors,
        "subjects":              subjects,
        "treemap":               treemap,
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
    parser.add_argument("--top-n-languages", type=int, default=TOP_N_LANGUAGES)
    parser.add_argument("--top-n-countries", type=int, default=TOP_N_COUNTRIES)
    parser.add_argument("--top-n-types",     type=int, default=TOP_N_TYPES)
    parser.add_argument(
        "--network-min-degree", type=int, default=DEFAULT_NETWORK_MIN_DEGREE,
        help="Drop authors whose total collaborators are below this number",
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
        top_n_languages=args.top_n_languages,
        top_n_countries=args.top_n_countries,
        top_n_types=args.top_n_types,
        network_min_degree=args.network_min_degree,
    )

    output_path = Path(args.output)
    save_json(payload, output_path, minify=args.minify)
    logging.getLogger(__name__).info("Wrote %s", output_path)


if __name__ == "__main__":
    main()
