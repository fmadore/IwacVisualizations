"""Geocoded spatial mentions — ``laicite-places.json``.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict

from iwac_utils import generate_timestamp, normalize_location_name



class PlacesMixin:
    """``LaiciteGenerator``'s places half. Mixed in by ``laicite.generator``."""


    def build_places(self) -> Dict[str, Any]:
        """Geocoded places tagged on dossier items (view 10).

        Joins ``spatial`` (a pipe list of ``index.Titre`` values) against the
        index's ``Lieux`` records that carry parseable ``Coordonnées``.
        Counted once per item, like the actors.
        """
        scans = self.scan_all()
        by_name, _ = self._authority_index()
        stats: Dict[int, Dict[str, Any]] = {}
        unresolved: Counter = Counter()

        for s in scans:
            matched: Dict[int, Dict[str, Any]] = {}
            for raw in s.spatial:
                record = by_name.get(normalize_location_name(raw))
                if record is None:
                    unresolved[raw] += 1
                    continue
                if record["type"] == "Lieux" and record["coords"]:
                    matched[record["o_id"]] = record
            for o_id, record in matched.items():
                st = stats.get(o_id)
                if st is None:
                    st = stats[o_id] = {
                        "o_id": o_id,
                        "name": record["name"],
                        "lat": record["coords"][0],
                        "lng": record["coords"][1],
                        "items": 0,
                        "tagged": 0,
                        "by_frame": Counter(),
                        "by_country": Counter(),
                        "by_subset": Counter(),
                        "by_decade": Counter(),
                        "first_year": s.year,
                        "last_year": s.year,
                    }
                st["items"] += 1
                if s.is_tagged:
                    st["tagged"] += 1
                for frame, n in s.frame_counts.items():
                    if n:
                        st["by_frame"][frame] += 1
                for country in s.countries:
                    st["by_country"][country] += 1
                st["by_subset"][s.subset] += 1
                decade = self._decade(s.year)
                if decade:
                    st["by_decade"][decade] += 1
                if s.year:
                    lo, hi = st["first_year"], st["last_year"]
                    st["first_year"] = s.year if lo is None else min(lo, s.year)
                    st["last_year"] = s.year if hi is None else max(hi, s.year)

        places = [{
            "o_id": st["o_id"], "name": st["name"],
            "lat": st["lat"], "lng": st["lng"],
            "items": st["items"], "tagged": st["tagged"],
            "first_year": st["first_year"], "last_year": st["last_year"],
            "by_frame": dict(st["by_frame"]),
            "by_country": dict(st["by_country"]),
            "by_subset": dict(st["by_subset"]),
            "by_decade": dict(st["by_decade"]),
        } for st in stats.values() if st["items"] >= self.min_place_items]
        places.sort(key=lambda p: (-p["items"], p["name"]))

        self.logger.info(
            f"  places: {len(places)} geocoded places clear "
            f"{self.min_place_items} items ({len(unresolved)} spatial strings "
            "unresolved or ungeocoded)")
        return {
            "generated_at": generate_timestamp(),
            "min_items": self.min_place_items,
            "frames": list(self.lex.frames),
            "places": places,
            "unresolved_total": len(unresolved),
            "note": (
                "Places tagged on dossier items, counted once per item. A "
                "place appears only when the index holds coordinates for it, "
                "so this maps what is catalogued, not everything mentioned."
            ),
        }
