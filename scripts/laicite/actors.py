"""Co-occurring persons and organisations — ``laicite-actors.json``.

Joined against the ``index`` authority records, so an actor is a curated
entity with an o:id rather than a string that happened to be capitalised.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from iwac_utils import (
    generate_timestamp,
    normalize_location_name,
    parse_coordinates,
    parse_pipe_separated,
)



class ActorsMixin:
    """``LaiciteGenerator``'s actors half. Mixed in by ``laicite.generator``."""


    @staticmethod
    def _decade(year: Optional[int]) -> Optional[str]:
        return f"{year // 10 * 10}s" if year else None

    def _authority_index(self) -> Tuple[Dict[str, Dict[str, Any]], int]:
        """``normalized name → authority record`` over EVERY index type.

        Every type is indexed, not only the ones a caller wants, so that a
        subject string resolving to a ``Sujets`` record counts as resolved
        rather than landing in the unresolved list. Otherwise "unresolved"
        would be dominated by *Laïcité*, *Paix*, *Politique* — the research
        vocabulary, which is catalogued and simply is not an actor.
        """
        df = self._index_records()
        if df is None:
            return {}, 0
        by_name: Dict[str, Dict[str, Any]] = {}
        count = 0
        aliases: List[Tuple[str, Dict[str, Any]]] = []
        for _, row in df.iterrows():
            title = str(row.get("Titre") or "").strip()
            if not title:
                continue
            try:
                o_id = int(row["o:id"])
            except (TypeError, ValueError, KeyError):
                continue
            record = {
                "o_id": o_id,
                "name": title,
                "type": str(row.get("Type") or "").strip(),
                "coords": parse_coordinates(row.get("Coordonnées")),
            }
            count += 1
            by_name[normalize_location_name(title)] = record
            for alt in parse_pipe_separated(row.get("Titre alternatif")):
                key = normalize_location_name(alt)
                if key:
                    aliases.append((key, record))
        # Aliases are applied after every canonical title, so an alternative
        # title can never shadow another record's real one.
        for key, record in aliases:
            by_name.setdefault(key, record)
        return by_name, count

    def build_actors(self) -> Dict[str, Any]:
        """Who is speaking laïcité, and when (issue #14, view 7).

        Joins each dossier item's ``subject`` list against the IWAC index
        and keeps the records that are *actors*: persons, organisations and
        curated events. ``Sujets`` are excluded here — not because they are
        noise (the repo's CLAUDE.md is explicit that they are not) but
        because they answer a different question, and the frame legend and
        the arenas view already answer it.

        Counted once per item: an organisation named three times in one
        article is one item's worth of evidence, not three.
        """
        scans = self.scan_all()
        by_name, indexed = self._authority_index()
        actor_types = {"Personnes", "Organisations", "Événements"}

        stats: Dict[int, Dict[str, Any]] = {}
        unresolved: Counter = Counter()
        for s in scans:
            decade = self._decade(s.year)
            matched: Dict[int, Dict[str, Any]] = {}
            for raw in s.subjects:
                record = by_name.get(normalize_location_name(raw))
                if record is None:
                    unresolved[raw] += 1
                    continue
                if record["type"] in actor_types:
                    matched[record["o_id"]] = record
            for o_id, record in matched.items():
                st = stats.get(o_id)
                if st is None:
                    st = stats[o_id] = {
                        "o_id": o_id,
                        "name": record["name"],
                        "type": record["type"],
                        "items": 0,
                        "tagged": 0,
                        "by_decade": Counter(),
                        "by_country": Counter(),
                        "by_subset": Counter(),
                        "first_year": s.year,
                        "last_year": s.year,
                    }
                st["items"] += 1
                if s.is_tagged:
                    st["tagged"] += 1
                if decade:
                    st["by_decade"][decade] += 1
                for country in s.countries:
                    st["by_country"][country] += 1
                st["by_subset"][s.subset] += 1
                if s.year:
                    lo, hi = st["first_year"], st["last_year"]
                    st["first_year"] = s.year if lo is None else min(lo, s.year)
                    st["last_year"] = s.year if hi is None else max(hi, s.year)

        kept = [st for st in stats.values() if st["items"] >= self.min_actor_items]
        kept.sort(key=lambda st: (-st["items"], st["name"]))
        decades = sorted({d for st in kept for d in st["by_decade"]})

        actors = [{
            "o_id": st["o_id"],
            "name": st["name"],
            "type": st["type"],
            "items": st["items"],
            "tagged": st["tagged"],
            "first_year": st["first_year"],
            "last_year": st["last_year"],
            "by_decade": [st["by_decade"].get(d, 0) for d in decades],
            "by_country": dict(st["by_country"]),
            "by_subset": dict(st["by_subset"]),
        } for st in kept]

        self.logger.info(
            f"  actors: {len(actors)} of {len(stats)} authority records clear "
            f"{self.min_actor_items} items ({indexed} index records joined, "
            f"{len(unresolved)} subject strings unresolved)")
        return {
            "generated_at": generate_timestamp(),
            "min_items": self.min_actor_items,
            "types": sorted(actor_types),
            "decades": decades,
            "actors": actors,
            "index_records": indexed,
            "unresolved": [
                {"name": name, "count": n}
                for name, n in unresolved.most_common(20)
            ],
            "unresolved_total": len(unresolved),
            "note": (
                "Curated authority records co-occurring with the dossier's "
                "items, counted once per item. Subject headings are excluded: "
                "they are catalogued research vocabulary, not actors."
            ),
        }
