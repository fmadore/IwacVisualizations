"""Edge-construction contract for the Entity Networks global graph.

The pair list mixes cross-type pairs (``personnes-organisations``) with
same-type ones (``personnes-personnes``). The two need different walks —
a full cross product over one bucket would emit self-loops and count
every pair twice — so the arithmetic is pinned here rather than left to
a full generator run against the private dataset.
"""
from __future__ import annotations

import math
import sys
import unittest
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple
from unittest.mock import patch

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

    def test_defaults_cover_the_same_type_axes(self) -> None:
        pairs = networks.parse_pairs(networks.DEFAULT_PAIRS)
        for kind in ("Personnes", "Organisations", "Lieux", "Sujets"):
            self.assertIn((kind, kind), pairs)

    def test_subjects_link_to_every_type(self) -> None:
        # Until v2.4 a subject linked to events only, so every neighbour of
        # "Hadj" was an event and readers could not see why.
        pairs = {frozenset(p) for p in networks.parse_pairs(networks.DEFAULT_PAIRS)}
        for kind in networks.TYPE_ORDER:
            self.assertIn(frozenset(("Sujets", kind)), pairs)

    def test_a_pair_is_unordered_and_kept_once(self) -> None:
        # Both spellings of one pair, and a repeat, are ONE pair: the walk
        # folds a cross pair into a (min, max) edge, so listing it twice
        # used to count every one of those edges twice.
        pairs = networks.parse_pairs(
            "personnes-organisations,organisations-personnes,"
            "lieux-evenements,personnes-organisations"
        )
        self.assertEqual(
            pairs,
            [("Personnes", "Organisations"), ("Événements", "Lieux")],
        )

    def test_a_mirrored_pair_list_draws_the_same_weights(self) -> None:
        items = {"a": {1, 10}, "b": {1, 10, 11}}
        agg = FakeAggregator(items, ENTITIES)
        with patch.object(networks, "compute_layout", stub_layout):
            once = networks.build_global_network(
                agg, networks.parse_pairs("personnes-organisations"), 1)
            twice = networks.build_global_network(
                agg, networks.parse_pairs(
                    "personnes-organisations,organisations-personnes"), 1)
        self.assertEqual(once["edges"], twice["edges"])
        self.assertEqual(sorted({w for _a, _b, w in twice["edges"]}), [1, 2])


def stub_layout(
    nodes: List[int],
    edges: Dict[Tuple[int, int], int],
) -> Dict[int, Tuple[float, float]]:
    """Stand in for ``compute_layout``. Positions are irrelevant to every
    assertion here, and the real one imports networkx — a generator
    dependency the lint job deliberately does not install (see
    tests/python/requirements.txt)."""
    return {o_id: (0.0, 0.0) for o_id in nodes}


class GlobalEdgeTests(unittest.TestCase):
    def build(self, items: Dict[str, Set[int]], weight_min: int = 1) -> Dict[str, Any]:
        agg = FakeAggregator(items, ENTITIES)
        with patch.object(networks, "compute_layout", stub_layout):
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

    def test_subjects_link_to_each_other_and_to_people(self) -> None:
        out = self.build({"a": {1, 2, 30, 31}})
        edges = out["_edges_by_label"]
        self.assertEqual(sorted(out["_labels"]), ["P1", "P2", "S1", "S2"])
        self.assertEqual(edges[frozenset(("S1", "S2"))], 1)
        self.assertEqual(edges[frozenset(("S1", "P1"))], 1)
        self.assertEqual(len(out["edges"]), 6)  # all 4 choose 2

    def test_a_pair_outside_the_list_stays_unlinked(self) -> None:
        # Persons and places are not a configured pair: sharing an item
        # links each to nothing, so both drop out as isolated nodes.
        out = self.build({"a": {1, 20}})
        self.assertEqual(out["_labels"], [])

    def test_cross_type_pairs_still_link(self) -> None:
        out = self.build({"a": {1, 10}})
        self.assertEqual(out["_edges_by_label"][frozenset(("P1", "O1"))], 1)

    def test_pruning_drops_weak_edges_and_isolated_nodes(self) -> None:
        out = self.build({"a": {1, 2}, "b": {1, 2}, "c": {1, 3}}, weight_min=2)
        self.assertEqual(sorted(out["_labels"]), ["P1", "P2"])
        self.assertEqual(len(out["edges"]), 1)


class LayoutFrameTests(unittest.TestCase):
    """`normalise_positions` decides what the opening view shows. Fitted to
    the extremes, one straggler shrank 2,852 nodes into the bottom 15% of
    the canvas (2026-11); these pin the fix without importing networkx."""

    def grid(self, n: int = 20) -> Dict[int, Tuple[float, float]]:
        return {i * n + j: (float(i), float(j)) for i in range(n) for j in range(n)}

    def test_everything_lands_inside_the_unit_square(self) -> None:
        pos = self.grid()
        pos[-1] = (500.0, -900.0)
        out = networks.normalise_positions(pos)
        for x, y in out.values():
            self.assertLessEqual(abs(x), 1.0)
            self.assertLessEqual(abs(y), 1.0)

    def test_a_straggler_does_not_set_the_scale(self) -> None:
        pos = self.grid()
        before = networks.normalise_positions(dict(pos))
        pos[-1] = (9.5, 10_000.0)  # one node far above everything else
        after = networks.normalise_positions(pos)
        # The core keeps its frame: the corner nodes barely move.
        for o_id in (0, 19, 380, 399):
            self.assertAlmostEqual(after[o_id][0], before[o_id][0], places=1)
            self.assertAlmostEqual(after[o_id][1], before[o_id][1], places=1)
        # The straggler sits in the rim, past the core and inside the frame.
        self.assertGreater(after[-1][1], networks.LAYOUT_CORE_EXTENT)
        self.assertLessEqual(after[-1][1], 1.0)

    def test_the_core_is_centred_and_keeps_its_aspect_ratio(self) -> None:
        # A 2:1 rectangle: x fills the frame, y half of it, both centred.
        pos = {i: (float(i % 41) * 2.0, float(i // 41)) for i in range(41 * 41)}
        out = networks.normalise_positions(pos)
        xs = [p[0] for p in out.values()]
        ys = [p[1] for p in out.values()]
        self.assertAlmostEqual(min(xs) + max(xs), 0.0, places=6)
        self.assertAlmostEqual(min(ys) + max(ys), 0.0, places=6)
        self.assertAlmostEqual((max(xs) - min(xs)) / (max(ys) - min(ys)), 2.0, delta=0.05)

    def test_layout_weights_are_dampened_and_ordered(self) -> None:
        weights = [2, 3, 10, 425, 2937]
        damped = [networks.layout_weight(w) for w in weights]
        self.assertEqual(damped, sorted(damped))
        self.assertLess(damped[-1] / damped[0], 10)  # was 1,468× raw

    def test_one_layout_unit_is_the_same_length_on_both_axes(self) -> None:
        lng, _ = networks.to_pseudo_lnglat(1.0, 0.0)
        self.assertAlmostEqual(math.radians(lng), networks.LAYOUT_MERC_EXTENT, places=6)


if __name__ == "__main__":
    unittest.main()
