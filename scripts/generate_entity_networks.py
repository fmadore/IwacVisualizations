#!/usr/bin/env python3
"""
generate_entity_networks.py
============================

Generate the two precomputed JSON files behind the "Entity Networks"
page block:

    asset/data/entity-networks-global.json
    asset/data/entity-networks-spatial.json

**Global network** — cross-type co-occurrence between index entities.
For every content item (articles, publications, references via the
shared ``DashboardAggregator`` resolution pipeline) and every
configured type pair, each (A, B) entity pair appearing in the same
item adds 1 to that edge's weight. Edges below ``--min-cooccurrence``
are pruned, isolated nodes dropped. Node positions are computed HERE
with networkx ForceAtlas2 and baked into the payload as lng/lat
pseudo-coordinates (inverse Web-Mercator projection of the layout
plane), so the client renders the graph with MapLibre GL at zero
layout cost — no client-side force simulation, no layout jank.

**Spatial network** — co-mention network between geocoded places: two
Lieux are linked when they appear in the same item's subject/spatial
references. Nodes carry their real coordinates; the client draws the
edges over the regular basemap.

Both payloads are deliberately slim: nodes and edges are compact
arrays (column order documented in ``_meta.columns``) and edges do NOT
carry per-edge item id lists — the block links out to the entity item
pages instead.

Usage
-----
    python scripts/generate_entity_networks.py
    python scripts/generate_entity_networks.py --min-cooccurrence 3 -v
    python scripts/generate_entity_networks.py --pairs "personnes-organisations,lieux-evenements"
"""
from __future__ import annotations

import argparse
import logging
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Set, Tuple

from dashboard_aggregator import DashboardAggregator
from iwac_utils import DATASET_ID, configure_logging, create_metadata_block, save_json

logger = logging.getLogger(__name__)

# Index Type vocabulary (canonical) keyed by the ASCII slugs used in
# the --pairs CLI flag.
TYPE_SLUGS: Dict[str, str] = {
    "personnes":     "Personnes",
    "organisations": "Organisations",
    "evenements":    "Événements",
    "sujets":        "Sujets",
    "lieux":         "Lieux",
}

# Node type order in the payload — the client maps these to palette
# slots and filter chips by index.
TYPE_ORDER = ["Personnes", "Organisations", "Événements", "Sujets", "Lieux"]

# Default cross-type pairs, mirroring IWAC-spatial-overview's
# build_networks.py: events act as connective tissue between every
# other type, plus the person↔organisation affiliation axis. Same-type
# and subject↔person-style pairs are excluded on purpose — subjects
# co-occur with nearly everything and would melt the graph into hair.
DEFAULT_PAIRS = (
    "personnes-organisations,"
    "personnes-evenements,"
    "organisations-evenements,"
    "sujets-evenements,"
    "lieux-evenements"
)

DEFAULT_MIN_COOCCURRENCE = 2

# How many nodes get a label-priority rank low enough to render at the
# default zoom (MapLibre's symbol collision handles the rest).
TOP_LABELS = 60

# Inverse-Mercator vertical extent of the abstract layout, in Mercator
# radians. ±2.2 rad ≈ ±77.6° latitude — far enough from the poles that
# MapLibre renders comfortably, wide enough to use the canvas.
LAYOUT_MERC_EXTENT = 2.2
# Horizontal extent in degrees of longitude (Mercator x is linear in
# longitude, so this is safe to set independently).
LAYOUT_LNG_EXTENT = 140.0


class NetworkAggregator(DashboardAggregator):
    """Thin DashboardAggregator subclass: we only need its loading +
    entity-resolution pipeline (index lookup incl. ``Titre alternatif``
    aliases, per-item subject/spatial resolution). Every index entity
    type is a potential node; per item we store the deduplicated set of
    referenced entity ids."""

    def __init__(self, repo_id: str = DATASET_ID) -> None:
        super().__init__(output_dir=Path("."), repo_id=repo_id)
        self.entity_items: Dict[int, Set[str]] = defaultdict(set)

    def _is_target(self, entity_type: str) -> bool:
        return entity_type in TYPE_ORDER

    def _target_label(self) -> str:
        return "network entities"

    def _register_item(
        self,
        item_key: str,
        roles: Dict[str, List[int]],
        spatial_pairs: List[Tuple[str, Optional[Dict[str, Any]]]],
    ) -> None:
        refs: Set[int] = set()
        for o_ids in roles.values():
            refs.update(o_ids)
        for _name, entity in spatial_pairs:
            if entity:
                refs.add(entity["o_id"])
        if refs:
            self.item_entities[item_key] = refs
            for o_id in refs:
                self.entity_items[o_id].add(item_key)

    def _log_resolve_summary(self) -> None:
        logger.info(
            "Resolved %d items; %d entities referenced at least once",
            len(self.item_entities),
            sum(1 for keys in self.entity_items.values() if keys),
        )

    # The per-target dashboard hooks are never exercised by this script.
    def _role_slices(self, target_id: int) -> Iterator[Tuple[str, Iterable[str]]]:
        raise NotImplementedError

    def _item_neighbor_ids(self, item_key: str, exclude: int) -> Iterable[int]:
        raise NotImplementedError

    def _item_location_ids(self, item_key: str) -> Iterable[int]:
        raise NotImplementedError

    def _iter_target_items(self) -> Iterator[Tuple[int, Iterable[str]]]:
        raise NotImplementedError


def parse_pairs(raw: str) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for chunk in raw.split(","):
        chunk = chunk.strip().lower()
        if not chunk:
            continue
        parts = chunk.split("-")
        if len(parts) != 2 or parts[0] not in TYPE_SLUGS or parts[1] not in TYPE_SLUGS:
            raise ValueError(
                f"Bad --pairs entry {chunk!r}; use slugs {sorted(TYPE_SLUGS)} as 'a-b'"
            )
        a, b = TYPE_SLUGS[parts[0]], TYPE_SLUGS[parts[1]]
        if a == b:
            raise ValueError(f"Same-type pair {chunk!r} is not supported")
        pairs.append((a, b))
    if not pairs:
        raise ValueError("--pairs resolved to an empty list")
    return pairs


def compute_layout(
    nodes: List[int],
    edges: Dict[Tuple[int, int], int],
) -> Dict[int, Tuple[float, float]]:
    """ForceAtlas2 positions (Fruchterman-Reingold fallback), rescaled
    to [-1, 1] on both axes."""
    import networkx as nx

    graph = nx.Graph()
    graph.add_nodes_from(nodes)
    for (a, b), weight in edges.items():
        graph.add_edge(a, b, weight=weight)

    if hasattr(nx, "forceatlas2_layout"):
        logger.info("Computing ForceAtlas2 layout (%d nodes, %d edges)...",
                    graph.number_of_nodes(), graph.number_of_edges())
        pos = nx.forceatlas2_layout(
            graph, max_iter=300, scaling_ratio=2.0,
            strong_gravity=True, weight="weight", seed=42,
        )
    else:  # very old networkx
        logger.info("ForceAtlas2 unavailable — falling back to spring layout")
        pos = nx.spring_layout(graph, weight="weight", seed=42)

    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    x_span = (x_max - x_min) or 1.0
    y_span = (y_max - y_min) or 1.0
    # Preserve the layout's aspect ratio inside the unit square so
    # clusters aren't stretched anisotropically.
    scale = 2.0 / max(x_span, y_span)
    x_off = (x_min + x_max) / 2.0
    y_off = (y_min + y_max) / 2.0
    # float() casts strip numpy scalar types (forceatlas2_layout returns
    # numpy arrays) so the payload stays json.dump-serializable.
    return {
        o_id: (float((p[0] - x_off) * scale), float((p[1] - y_off) * scale))
        for o_id, p in pos.items()
    }


def to_pseudo_lnglat(x: float, y: float) -> Tuple[float, float]:
    """Map layout coords in [-1, 1] to lng/lat through the inverse
    Web-Mercator projection. MapLibre's forward projection then
    reproduces the layout plane exactly, so on-screen geometry is
    isometric to the ForceAtlas2 output at every zoom."""
    lng = x * LAYOUT_LNG_EXTENT
    lat = math.degrees(math.atan(math.sinh(y * LAYOUT_MERC_EXTENT)))
    return round(lng, 4), round(lat, 4)


def build_global_network(
    agg: NetworkAggregator,
    pairs: List[Tuple[str, str]],
    weight_min: int,
) -> Dict[str, Any]:
    pair_set = {frozenset(p) for p in pairs}

    edge_weights: Dict[Tuple[int, int], int] = Counter()
    for refs in agg.item_entities.values():
        if len(refs) < 2:
            continue
        by_type: Dict[str, List[int]] = defaultdict(list)
        for o_id in refs:
            info = agg.id_to_entity.get(o_id)
            if info:
                by_type[info["type"]].append(o_id)
        for type_a, type_b in pairs:
            for a in by_type.get(type_a, ()):  # cross-type only: a != b always
                for b in by_type.get(type_b, ()):
                    edge_weights[(a, b) if a < b else (b, a)] += 1

    pruned = {pair: w for pair, w in edge_weights.items() if w >= weight_min}
    logger.info("Global edges: %d raw, %d at weight >= %d",
                len(edge_weights), len(pruned), weight_min)

    degree: Counter = Counter()
    strength: Counter = Counter()
    for (a, b), w in pruned.items():
        degree[a] += 1
        degree[b] += 1
        strength[a] += w
        strength[b] += w

    node_ids = sorted(degree)
    positions = compute_layout(node_ids, pruned)

    # Label priority: rank by the same hubs-first score the source app
    # used (degree×3 + mentions); the client feeds the rank into
    # MapLibre's symbol-sort-key so collision keeps the top labels.
    counts = {o_id: len(agg.entity_items.get(o_id, ())) for o_id in node_ids}
    ranked = sorted(node_ids, key=lambda o: -(degree[o] * 3 + counts[o]))
    label_rank = {o_id: rank for rank, o_id in enumerate(ranked)}

    index_of = {o_id: i for i, o_id in enumerate(node_ids)}
    nodes: List[List[Any]] = []
    for o_id in node_ids:
        info = agg.id_to_entity[o_id]
        lng, lat = to_pseudo_lnglat(*positions[o_id])
        nodes.append([
            o_id,
            info["title"],
            TYPE_ORDER.index(info["type"]),
            counts[o_id],
            degree[o_id],
            strength[o_id],
            lng,
            lat,
            label_rank[o_id],
        ])

    edges = sorted(
        ([index_of[a], index_of[b], w] for (a, b), w in pruned.items()),
        key=lambda e: -e[2],
    )

    type_counts = Counter(TYPE_ORDER[n[2]] for n in nodes)
    logger.info("Global network: %d nodes (%s), %d edges",
                len(nodes),
                ", ".join(f"{t}={type_counts.get(t, 0)}" for t in TYPE_ORDER),
                len(edges))

    return {
        "_meta": create_metadata_block(
            total_records=len(nodes),
            columns={
                "nodes": ["o_id", "label", "type_index", "count",
                          "degree", "strength", "lng", "lat", "label_rank"],
                "edges": ["source_index", "target_index", "weight"],
            },
            weight_min=weight_min,
            weight_max=max(pruned.values()) if pruned else 0,
            top_labels=TOP_LABELS,
            pairs=["%s-%s" % (a, b) for a, b in pairs],
            total_edges=len(edges),
        ),
        "types": TYPE_ORDER,
        "nodes": nodes,
        "edges": edges,
    }


def build_spatial_network(agg: NetworkAggregator, weight_min: int) -> Dict[str, Any]:
    edge_weights: Dict[Tuple[int, int], int] = Counter()
    for refs in agg.item_entities.values():
        geo = sorted(o_id for o_id in refs if o_id in agg.lieux_rows)
        for i in range(len(geo)):
            for j in range(i + 1, len(geo)):
                edge_weights[(geo[i], geo[j])] += 1

    pruned = {pair: w for pair, w in edge_weights.items() if w >= weight_min}
    logger.info("Spatial edges: %d raw, %d at weight >= %d",
                len(edge_weights), len(pruned), weight_min)

    degree: Counter = Counter()
    for (a, b), w in pruned.items():
        degree[a] += 1
        degree[b] += 1

    node_ids = sorted(degree)
    index_of = {o_id: i for i, o_id in enumerate(node_ids)}

    nodes: List[List[Any]] = []
    w_, s_, e_, n_ = 180.0, 90.0, -180.0, -90.0
    for o_id in node_ids:
        lat, lng = agg.lieux_rows[o_id]
        info = agg.id_to_entity[o_id]
        nodes.append([
            o_id,
            info["title"],
            round(lng, 5),
            round(lat, 5),
            len(agg.entity_items.get(o_id, ())),
            degree[o_id],
        ])
        w_, e_ = min(w_, lng), max(e_, lng)
        s_, n_ = min(s_, lat), max(n_, lat)

    edges = sorted(
        ([index_of[a], index_of[b], w] for (a, b), w in pruned.items()),
        key=lambda e: -e[2],
    )

    logger.info("Spatial network: %d nodes, %d edges", len(nodes), len(edges))

    return {
        "_meta": create_metadata_block(
            total_records=len(nodes),
            columns={
                "nodes": ["o_id", "label", "lng", "lat", "count", "degree"],
                "edges": ["source_index", "target_index", "weight"],
            },
            weight_min=weight_min,
            weight_max=max(pruned.values()) if pruned else 0,
            total_edges=len(edges),
        ),
        "nodes": nodes,
        "edges": edges,
        "bounds": [round(w_, 3), round(s_, 3), round(e_, 3), round(n_, 3)] if nodes else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DATASET_ID, help="Hugging Face dataset repository ID")
    parser.add_argument("--output-dir", default="asset/data")
    parser.add_argument(
        "--min-cooccurrence", type=int, default=DEFAULT_MIN_COOCCURRENCE,
        help="Minimum co-occurrence weight for an edge to survive (default: %(default)s)",
    )
    parser.add_argument(
        "--spatial-min-cooccurrence", type=int, default=None,
        help="Override for the spatial network (defaults to --min-cooccurrence)",
    )
    parser.add_argument(
        "--pairs", default=DEFAULT_PAIRS,
        help="Comma-separated cross-type pairs as ASCII slugs (default: %(default)s)",
    )
    parser.add_argument(
        "--minify", action=argparse.BooleanOptionalAction, default=True,
        help="Produce compact JSON (default: %(default)s)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Set log level to DEBUG")
    args = parser.parse_args()

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)
    pairs = parse_pairs(args.pairs)
    spatial_min = (
        args.spatial_min_cooccurrence
        if args.spatial_min_cooccurrence is not None
        else args.min_cooccurrence
    )

    agg = NetworkAggregator(repo_id=args.repo)
    agg.load_index()
    agg.load_content()
    agg.build_entity_lookup()
    agg.resolve_items()

    global_net = build_global_network(agg, pairs, args.min_cooccurrence)
    spatial_net = build_spatial_network(agg, spatial_min)

    module_root = Path(__file__).resolve().parent.parent
    output_dir = Path(args.output_dir)
    if not output_dir.is_absolute():
        output_dir = module_root / output_dir

    save_json(global_net, output_dir / "entity-networks-global.json", minify=args.minify)
    save_json(spatial_net, output_dir / "entity-networks-spatial.json", minify=args.minify)


if __name__ == "__main__":
    main()
