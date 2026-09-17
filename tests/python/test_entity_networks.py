"""Edge-construction contract for the Entity Networks global graph.

The pair list mixes cross-type pairs (``personnes-organisations``) with
same-type ones (``personnes-personnes``). The two need different walks —
a full cross product over one bucket would emit self-loops and count
every pair twice — so the arithmetic is pinned here rather than left to
a full generator run against the private dataset.
"""
from __future__ import annotations

import sys
import unittest
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import generate_entity_networks as networks  # noqa: E402


class FakeAggregator:
    """The three attributes ``build_global_network`` actually reads."""

    def __init__(
        self,
        items: Dict[str, Set[int]],
        entities: Dict[int, Dict[str, Any]],
    ) -> None:
        self.item_entities = items
        self.id_to_entity = entities
        self.entity_items: Dict[int, Set[str]] = defaultdict(set)
        for key, refs in items.items():
            for o_id in refs:
                self.entity_items[o_id].add(key)


ENTITIES: Dict[int, Dict[str, Any]] = {
    1:  {"type": "Personnes", "title": "P1"},
    2:  {"type": "Personnes", "title": "P2"},
    3:  {"type": "Personnes", "title": "P3"},
    10: {"type": "Organisations", "title": "O1"},
    11: {"type": "Organisations", "title": "O2"},
    20: {"type": "Lieux", "title": "L1"},
    21: {"type": "Lieux", "title": "L2"},
    30: {"type": "Sujets", "title": "S1"},
    31: {"type": "Sujets", "title": "S2"},
}


class PairParsingTests(unittest.TestCase):
    def test_same_type_pairs_are_accepted(self) -> None:
        self.assertEqual(
            networks.parse_pairs("personnes-personnes,lieux-lieux"),
            [("Personnes", "Personnes"), ("Lieux", "Lieux")],
        )

    def test_unknown_slug_still_rejected(self) -> None:
        with self.assertRaises(ValueError):
            networks.parse_pairs("personnes-bananes")

    def test_defaults_cover_the_three_same_type_axes(self) -> None:
        pairs = networks.parse_pairs(networks.DEFAULT_PAIRS)
        for kind in ("Personnes", "Organisations", "Lieux"):
            self.assertIn((kind, kind), pairs)
        # Subjects tag nearly every item; that pair would dominate the layout.
        self.assertNotIn(("Sujets", "Sujets"), pairs)


class GlobalEdgeTests(unittest.TestCase):
    def build(self, items: Dict[str, Set[int]], weight_min: int = 1) -> Dict[str, Any]:
        agg = FakeAggregator(items, ENTITIES)
        payload = networks.build_global_network(
            agg, networks.parse_pairs(networks.DEFAULT_PAIRS), weight_min)
        labels = [node[1] for node in payload["nodes"]]
        payload["_edges_by_label"] = {
            frozenset((labels[a], labels[b])): w for a, b, w in payload["edges"]
        }
        payload["_labels"] = labels
        return payload

    def test_same_type_neighbours_are_linked(self) -> None:
        out = self.build({"a": {1, 2, 3, 10, 11, 20, 21}})
        edges = out["_edges_by_label"]
        self.assertEqual(edges[frozenset(("P1", "P2"))], 1)
        self.assertEqual(edges[frozenset(("P1", "P3"))], 1)
        self.assertEqual(edges[frozenset(("P2", "P3"))], 1)
        self.assertEqual(edges[frozenset(("O1", "O2"))], 1)
        self.assertEqual(edges[frozenset(("L1", "L2"))], 1)

    def test_no_self_loops_and_no_double_counting(self) -> None:
        # One item, so every pair in it must weigh exactly 1.
        out = self.build({"a": {1, 2, 3, 10, 11, 20, 21}})
        pairs: List[Any] = [(a, b) for a, b, _w in out["edges"]]
        self.assertTrue(all(a != b for a, b in pairs), "self-loop emitted")
        self.assertEqual(len(set(pairs)), len(pairs), "duplicate edge emitted")
        self.assertEqual(
            sorted({w for _a, _b, w in out["edges"]}), [1],
            "a pair was counted more than once per item")

    def test_weights_accumulate_across_items(self) -> None:
        out = self.build({"a": {1, 2}, "b": {1, 2}, "c": {1, 3}})
        edges = out["_edges_by_label"]
        self.assertEqual(edges[frozenset(("P1", "P2"))], 2)
        self.assertEqual(edges[frozenset(("P1", "P3"))], 1)

    def test_subjects_stay_out_of_the_same_type_walk(self) -> None:
        # The two subjects share the item with the two persons, but no
        # configured pair joins subject to subject (nor subject to person),
        # so they drop out as isolated nodes while the persons link.
        out = self.build({"a": {1, 2, 30, 31}})
        self.assertEqual(sorted(out["_labels"]), ["P1", "P2"])
        self.assertEqual(len(out["edges"]), 1)

    def test_cross_type_pairs_still_link(self) -> None:
        out = self.build({"a": {1, 10}})
        self.assertEqual(out["_edges_by_label"][frozenset(("P1", "O1"))], 1)

    def test_pruning_drops_weak_edges_and_isolated_nodes(self) -> None:
        out = self.build({"a": {1, 2}, "b": {1, 2}, "c": {1, 3}}, weight_min=2)
        self.assertEqual(sorted(out["_labels"]), ["P1", "P2"])
        self.assertEqual(len(out["edges"]), 1)


if __name__ == "__main__":
    unittest.main()
