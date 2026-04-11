# Person Resource Page Block — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-person Omeka resource-page block (`personDashboard`) that renders an 8-panel ECharts + MapLibre dashboard for any item whose resource template is `Personnes` (template ID 5) on <https://islam.zmo.de>. The block is driven by one precomputed JSON per person (~1,400 files) generated from the Hugging Face dataset, surfaces creator-vs-subject as a global facet bar, and features a TF-IDF distinctiveness-weighted neighbors network.

**Architecture:** Precompute path. One Python generator (`scripts/generate_person_dashboards.py`) reads the `articles`/`publications`/`references`/`index` HF subsets and fans out one JSON per `Personnes` row. The Omeka block renders the header card server-side from the item representation, then hands off to a thin JS orchestrator (`asset/js/charts/person-dashboard.js`) that fetches the JSON, builds the layout, and delegates each panel to its own IIFE module under `asset/js/charts/person-dashboard/`. All panels reuse the existing shared primitives (`panels.js`, `chart-options.js`, `facet-buttons.js`, `maplibre.js`) except the neighbor network, which adds one new shared builder `C.network`.

**Tech Stack:** PHP 8 (Omeka S block layout), vanilla JS (IIFE modules, no bundler), ECharts 6 + MapLibre GL 5 (already CDN-loaded in `Module.php`), Python 3 (`datasets`, `pandas`, math) for the generator.

**Spec reference:** [`docs/superpowers/specs/2026-04-11-person-resource-block-design.md`](../specs/2026-04-11-person-resource-block-design.md)

**Verification philosophy:** This module has no automated tests. Each task's verification is either (a) run a Python script and inspect the JSON output, (b) load the block in a browser and verify visual behavior, or (c) grep for expected strings/symbols. Commit after each task that passes verification.

---

## File map

**New files:**

```
src/Site/ResourcePageBlockLayout/PersonDashboard.php
view/common/resource-page-block-layout/person-dashboard.phtml
asset/js/charts/person-dashboard.js
asset/js/charts/person-dashboard/stats.js
asset/js/charts/person-dashboard/facet.js
asset/js/charts/person-dashboard/timeline.js
asset/js/charts/person-dashboard/newspapers.js
asset/js/charts/person-dashboard/countries.js
asset/js/charts/person-dashboard/network.js
asset/js/charts/person-dashboard/map.js
scripts/generate_person_dashboards.py
asset/data/person-dashboards/.gitkeep               # directory placeholder
asset/data/person-dashboards/{o_id}.json            # 1,400 files emitted by the generator
```

**Modified files:**

```
config/module.config.php                          # register 'personDashboard' block layout
asset/js/charts/shared/chart-options.js            # add C.network
asset/js/iwac-i18n.js                              # new EN+FR keys (person.* + entity_type_*)
asset/css/iwac-visualizations.css                  # .iwac-vis-person-* classes
language/template.pot                              # new PHP translate() strings
language/fr.po                                     # French translations
README.md                                          # mention the block
ROADMAP.md                                         # mark partial progress on per-entity blocks
scripts/README.md                                  # document the new generator
```

**NOT modified:** `Module.php`. The item controller already attaches the i18n / theme / core / shared primitives bundle via `addAssets()`. The block's PHTML enqueues the panel-specific scripts the same way `linked-items-dashboard.phtml` does today.

---

## Phase 1 — Python generator

### Task 1: Skeleton, CLI, and dataset loaders

**Files:**
- Create: `scripts/generate_person_dashboards.py`

This task stands up the generator with argument parsing, dataset loading for all four HF subsets, and a reusable class scaffold. No aggregation yet — just `main()` loads everything and logs row counts.

- [ ] **Step 1: Create the file skeleton**

Path: `scripts/generate_person_dashboards.py`

```python
#!/usr/bin/env python3
"""
generate_person_dashboards.py
=============================

Generate one JSON file per Person in the IWAC ``index`` subset under
``asset/data/person-dashboards/{o_id}.json``. Each file contains the
data for the IwacVisualizations ``personDashboard`` resource-page
block: summary counts, mentions timeline (year x country), top
newspapers, countries breakdown, TF-IDF ranked neighbor network, and
locations map — each faceted by role (all / subject / creator).

Follows the patterns from ``iwac-dashboard/scripts/generate_entity_spatial.py``
(entity name normalization + join) and the existing
``scripts/generate_collection_overview.py`` (CLI, logging, HF loader,
save_json).

Usage
-----
    python scripts/generate_person_dashboards.py
    python scripts/generate_person_dashboards.py --limit 5
    python scripts/generate_person_dashboards.py --output-dir asset/data/person-dashboards
"""
from __future__ import annotations

import argparse
import logging
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    configure_logging,
    extract_year,
    find_column,
    load_dataset_safe,
    normalize_country,
    normalize_location_name,
    parse_coordinates,
    parse_pipe_separated,
    save_json,
)

# Content subsets that can reference a Person. ``index`` is loaded
# separately (authority). ``documents`` and ``audiovisual`` are too
# small to justify the join cost and are intentionally excluded.
CONTENT_SUBSETS = ["articles", "publications", "references"]

# Role assigned to each (subset, field) pair when resolving an entity.
# Subsets where a field is missing or blank are silently skipped.
SUBJECT_FIELDS = {
    "articles":     "subject",
    "publications": "subject",
    "references":   "subject",
}
CREATOR_FIELDS = {
    "articles":     "author",
    "publications": "author",
    "references":   "author",
}

# Minimum co-occurrence before a neighbor qualifies for the network.
# Singletons produce noisy TF-IDF scores.
MIN_COOCCURRENCE = 2

# Top cap per person, per role slice.
TOP_N_NEIGHBORS = 50

# Omeka resource template id for ``Personnes`` on islam.zmo.de.
PERSON_TEMPLATE_TYPE = "Personnes"


class PersonDashboardGenerator:
    """Builds one JSON per Person in the index subset."""

    def __init__(self, output_dir: Path, limit: Optional[int] = None) -> None:
        self.output_dir = output_dir
        self.limit = limit

        self.index_df: Optional[pd.DataFrame] = None
        self.content_dfs: Dict[str, pd.DataFrame] = {}

        # Built in later tasks
        self.entity_lookup: Dict[str, Dict[str, Any]] = {}
        self.id_to_entity: Dict[int, Dict[str, Any]] = {}  # o_id -> entity info (reverse index)
        self.lieux_rows: Dict[int, Tuple[float, float, str]] = {}  # o_id -> (lat, lng, country)
        self.persons: Dict[int, Dict[str, Any]] = {}
        self.item_entities: Dict[str, Dict[str, List[int]]] = {}  # item_key -> {'subject': [o_id, ...], 'creator': [...]}
        self.items_meta: Dict[str, Dict[str, Any]] = {}           # item_key -> {o_id, pub_date, newspaper, country, subset}
        self.persons_items: Dict[int, Dict[str, Set[str]]] = defaultdict(
            lambda: {"subject": set(), "creator": set()}
        )
        self.df: Dict[int, int] = {}  # document frequency for TF-IDF
        self.n_persons: int = 0

    # ------------------------------------------------------------------
    # Loaders
    # ------------------------------------------------------------------

    def load_index(self) -> None:
        logger.info("Loading index subset...")
        self.index_df = load_dataset_safe(DATASET_ID, "index")
        if self.index_df is None or self.index_df.empty:
            raise RuntimeError("index subset returned empty — aborting")
        logger.info(f"  {len(self.index_df)} index entries")

    def load_content(self) -> None:
        for subset in CONTENT_SUBSETS:
            logger.info(f"Loading content subset: {subset}")
            df = load_dataset_safe(DATASET_ID, subset)
            if df is None or df.empty:
                logger.warning(f"  {subset} returned empty — continuing")
                continue
            self.content_dfs[subset] = df
            logger.info(f"  {len(df)} rows")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "asset" / "data" / "person-dashboards",
        help="Where to write per-person JSON files (default: %(default)s)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N persons (smoke test). 0 or unset = all.",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Set log level to DEBUG",
    )
    return parser


def main() -> int:
    args = build_arg_parser().parse_args()
    global logger
    logger = configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    gen = PersonDashboardGenerator(
        output_dir=args.output_dir,
        limit=args.limit if args.limit and args.limit > 0 else None,
    )

    gen.load_index()
    gen.load_content()

    logger.info("Skeleton run complete — aggregation stages will be added in later tasks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the skeleton — verify dataset loading works**

Run: `cd /home/fmadore/projects/IwacVisualizations && python3 scripts/generate_person_dashboards.py --limit 5`

Expected log output (truncated):

```
Loading index subset...
  4697 index entries
Loading content subset: articles
  12287 rows
Loading content subset: publications
  1501 rows
Loading content subset: references
  864 rows
Skeleton run complete — aggregation stages will be added in later tasks
```

If this fails with a missing-column error, that's fine to defer; if it fails with `ImportError` or dataset-load errors, fix before proceeding.

- [ ] **Step 3: Commit**

```bash
git add scripts/generate_person_dashboards.py
git commit -m "person block: generator skeleton + HF loaders"
```

---

### Task 2: Entity lookup, person filter, per-item entity resolution

**Files:**
- Modify: `scripts/generate_person_dashboards.py`

Adds the build-once lookup tables: normalized-name → index entity, `o:id` → Person row, and per-item resolved entity lists (by role). This is the join core.

- [ ] **Step 1: Add `build_entity_lookup` method to `PersonDashboardGenerator`**

Insert the following method (under the Loaders section, above `main`):

```python
    # ------------------------------------------------------------------
    # Entity lookup + person filter
    # ------------------------------------------------------------------

    def build_entity_lookup(self) -> None:
        """Normalized-name → index row, o_id → index row, and Lieux coord table.

        Built once so per-person compute loops can do O(1) lookups
        instead of walking self.index_df again on every call.
        """
        df = self.index_df

        id_col = find_column(df, ["o:id", "id"])
        title_col = find_column(df, ["Titre", "dcterms:title"])
        type_col = find_column(df, ["Type"])
        if not (id_col and title_col and type_col):
            raise RuntimeError(
                f"index subset missing required columns: id={id_col}, title={title_col}, type={type_col}"
            )
        alt_col = find_column(df, ["Titre alternatif", "dcterms:alternative"])
        coord_col = find_column(df, ["Coordonnées", "coordinates"])

        for _, row in df.iterrows():
            o_id = row.get(id_col)
            try:
                o_id = int(o_id)
            except (TypeError, ValueError):
                continue

            entity_type = str(row.get(type_col) or "").strip()
            if not entity_type or entity_type == "Notices d'autorité":
                continue

            title = str(row.get(title_col) or "").strip()
            if not title:
                continue

            info = {
                "o_id": o_id,
                "title": title,
                "type": entity_type,
                "row": row,
            }
            key = normalize_location_name(title)
            if key:
                self.entity_lookup.setdefault(key, info)

            if alt_col:
                for alt in parse_pipe_separated(row.get(alt_col)):
                    alt_key = normalize_location_name(alt)
                    if alt_key and alt_key not in self.entity_lookup:
                        self.entity_lookup[alt_key] = info

            self.id_to_entity[o_id] = info

            if entity_type == PERSON_TEMPLATE_TYPE:
                self.persons[o_id] = info

            if entity_type == "Lieux" and coord_col:
                coords = parse_coordinates(row.get(coord_col))
                if coords is not None:
                    country_list = parse_pipe_separated(row.get("countries"))
                    country = country_list[0] if country_list else ""
                    self.lieux_rows[o_id] = (coords[0], coords[1], country)

        self.n_persons = len(self.persons)
        logger.info(
            f"Entity lookup built: {len(self.entity_lookup)} name keys, "
            f"{self.n_persons} persons, {len(self.lieux_rows)} geocoded places"
        )
```

- [ ] **Step 2: Add `resolve_items` method that walks every content row**

Insert directly after `build_entity_lookup`:

```python
    # ------------------------------------------------------------------
    # Per-item entity resolution
    # ------------------------------------------------------------------

    def resolve_items(self) -> None:
        """Walk each content row and extract entity o_ids by role.

        Populates:
          - self.item_entities[item_key] = {"subject": [o_id...], "creator": [o_id...]}
          - self.items_meta[item_key]    = {o_id, pub_date, newspaper, country, subset}
          - self.persons_items[person_o_id] = {"subject": {item_key,...}, "creator": {...}}
        """
        for subset, df in self.content_dfs.items():
            id_col = find_column(df, ["o:id", "id"])
            if not id_col:
                logger.warning(f"{subset}: no o:id column, skipping")
                continue

            subject_col = SUBJECT_FIELDS.get(subset)
            if subject_col and subject_col not in df.columns:
                subject_col = None
            creator_col = CREATOR_FIELDS.get(subset)
            if creator_col and creator_col not in df.columns:
                creator_col = None

            date_col = find_column(df, ["pub_date", "dcterms:date"])
            country_col = find_column(df, ["country", "countries"])
            newspaper_col = find_column(df, ["newspaper", "dcterms:publisher", "source"])

            for _, row in df.iterrows():
                raw_id = row.get(id_col)
                try:
                    item_o_id = int(raw_id)
                except (TypeError, ValueError):
                    continue
                item_key = f"{subset}:{item_o_id}"

                self.items_meta[item_key] = {
                    "o_id": item_o_id,
                    "subset": subset,
                    "pub_date": str(row.get(date_col) or "").strip() if date_col else "",
                    "country": self._first_country(row.get(country_col)) if country_col else "",
                    "newspaper": str(row.get(newspaper_col) or "").strip() if newspaper_col else "",
                }

                roles: Dict[str, List[int]] = {"subject": [], "creator": []}

                if subject_col:
                    for name in parse_pipe_separated(row.get(subject_col)):
                        entity = self.entity_lookup.get(normalize_location_name(name))
                        if entity:
                            roles["subject"].append(entity["o_id"])

                if creator_col:
                    for name in parse_pipe_separated(row.get(creator_col)):
                        entity = self.entity_lookup.get(normalize_location_name(name))
                        if entity:
                            roles["creator"].append(entity["o_id"])

                self.item_entities[item_key] = roles

                for role_name, o_ids in roles.items():
                    for o_id in o_ids:
                        if o_id in self.persons:
                            self.persons_items[o_id][role_name].add(item_key)

        logger.info(
            f"Resolved {len(self.item_entities)} items; "
            f"{sum(1 for p in self.persons_items if self.persons_items[p]['subject'] or self.persons_items[p]['creator'])} "
            f"persons have at least one mention"
        )

    @staticmethod
    def _first_country(value: Any) -> str:
        countries = normalize_country(value, return_list=True)
        if isinstance(countries, list) and countries:
            first = countries[0].strip()
            return first if first and first.lower() != "unknown" else ""
        return ""
```

- [ ] **Step 3: Wire the new methods into `main`**

Find the `gen.load_content()` line in `main` and append:

```python
    gen.build_entity_lookup()
    gen.resolve_items()
```

- [ ] **Step 4: Run the smoke test — verify counts**

Run: `python3 scripts/generate_person_dashboards.py --limit 5`

Expected log output includes:

```
Entity lookup built: <N> name keys, <M> persons        # M should be ~1400
Resolved <K> items; <P> persons have at least one mention   # P should be > 100
```

If `M` is 0, `Type` column resolution failed — grep the index schema. If `P` is 0, entity name matching is broken — compare to `iwac-dashboard/scripts/generate_entity_spatial.py` normalization.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate_person_dashboards.py
git commit -m "person block: entity lookup + per-item role resolution"
```

---

### Task 3: Per-person aggregates (summary, timeline, newspapers, countries, locations)

**Files:**
- Modify: `scripts/generate_person_dashboards.py`

Adds the five straightforward aggregation functions: summary counters, year × country stacked timeline, top newspapers, countries bar, and locations map markers. All five produce a `by_role` mapping with `all`, `subject`, `creator` keys.

- [ ] **Step 1: Add the aggregation helpers under a new section**

Insert the following methods on the `PersonDashboardGenerator` class, after `resolve_items`:

```python
    # ------------------------------------------------------------------
    # Per-person aggregates
    # ------------------------------------------------------------------

    EMPTY_SUMMARY = {
        "total_mentions": 0,
        "year_min": None,
        "year_max": None,
        "newspapers_count": 0,
        "countries_count": 0,
        "neighbors_count": 0,
    }

    def _items_for_role(
        self, person_o_id: int, role: str
    ) -> List[str]:
        """Return item_keys for this person + role. 'all' = union."""
        if role == "all":
            return sorted(
                self.persons_items[person_o_id]["subject"]
                | self.persons_items[person_o_id]["creator"]
            )
        return sorted(self.persons_items[person_o_id][role])

    def compute_summary(self, person_o_id: int) -> Dict[str, Any]:
        by_role: Dict[str, Dict[str, Any]] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            if not item_keys:
                by_role[role] = dict(self.EMPTY_SUMMARY)
                continue
            years: List[int] = []
            newspapers: Set[str] = set()
            countries: Set[str] = set()
            for key in item_keys:
                meta = self.items_meta.get(key, {})
                y = extract_year(meta.get("pub_date"))
                if y is not None:
                    years.append(y)
                if meta.get("newspaper"):
                    newspapers.add(meta["newspaper"])
                if meta.get("country"):
                    countries.add(meta["country"])
            by_role[role] = {
                "total_mentions": len(item_keys),
                "year_min": min(years) if years else None,
                "year_max": max(years) if years else None,
                "newspapers_count": len(newspapers),
                "countries_count": len(countries),
                "neighbors_count": 0,  # filled in after network is built
            }
        return {"by_role": by_role}

    def compute_timeline(self, person_o_id: int) -> Dict[str, Any]:
        """Year × country stacked series, mirrors C.timeline shape."""
        by_role: Dict[str, Any] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            year_country: Dict[Tuple[int, str], int] = Counter()
            countries: Set[str] = set()
            years_seen: Set[int] = set()
            for key in item_keys:
                meta = self.items_meta.get(key, {})
                y = extract_year(meta.get("pub_date"))
                c = meta.get("country") or ""
                if y is None or not c:
                    continue
                year_country[(y, c)] += 1
                countries.add(c)
                years_seen.add(y)
            if not years_seen:
                by_role[role] = {"years": [], "countries": [], "series": {}}
                continue
            years = sorted(years_seen)
            countries_sorted = sorted(countries)
            series = {
                c: [year_country.get((y, c), 0) for y in years]
                for c in countries_sorted
            }
            by_role[role] = {
                "years": years,
                "countries": countries_sorted,
                "series": series,
            }
        return {"by_role": by_role}

    def compute_newspapers(self, person_o_id: int, top_n: int = 15) -> Dict[str, Any]:
        by_role: Dict[str, Any] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            stats: Dict[str, Dict[str, Any]] = {}
            for key in item_keys:
                meta = self.items_meta.get(key, {})
                name = meta.get("newspaper")
                if not name:
                    continue
                s = stats.setdefault(name, {
                    "name": name,
                    "total": 0,
                    "articles": 0,
                    "publications": 0,
                    "country": meta.get("country") or "",
                    "year_min": None,
                    "year_max": None,
                })
                s["total"] += 1
                if meta.get("subset") == "articles":
                    s["articles"] += 1
                elif meta.get("subset") == "publications":
                    s["publications"] += 1
                y = extract_year(meta.get("pub_date"))
                if y is not None:
                    s["year_min"] = y if s["year_min"] is None else min(s["year_min"], y)
                    s["year_max"] = y if s["year_max"] is None else max(s["year_max"], y)
            entries = sorted(stats.values(), key=lambda e: e["total"], reverse=True)[:top_n]
            by_role[role] = entries
        return {"by_role": by_role}

    def compute_countries(self, person_o_id: int) -> Dict[str, Any]:
        by_role: Dict[str, Any] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            counter: Counter = Counter()
            for key in item_keys:
                c = self.items_meta.get(key, {}).get("country") or ""
                if c:
                    counter[c] += 1
            entries = [{"name": name, "count": count} for name, count in counter.most_common()]
            by_role[role] = entries
        return {"by_role": by_role}

    def compute_locations(self, person_o_id: int) -> Dict[str, Any]:
        """Join mentioned Lieux entities to their Coordonnées.

        ``self.lieux_rows`` is precomputed in ``build_entity_lookup``
        (o_id → (lat, lng, country)). ``self.id_to_entity`` gives the
        O(1) title lookup.
        """
        by_role: Dict[str, Any] = {}
        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            loc_counter: Counter = Counter()
            for key in item_keys:
                roles = self.item_entities.get(key, {})
                seen_here: Set[int] = set()
                for entity_o_id in roles.get("subject", []) + roles.get("creator", []):
                    if entity_o_id not in self.lieux_rows:
                        continue
                    if entity_o_id in seen_here:
                        continue
                    seen_here.add(entity_o_id)
                    loc_counter[entity_o_id] += 1
            entries = []
            for entity_o_id, count in loc_counter.most_common():
                lat, lng, country = self.lieux_rows[entity_o_id]
                info = self.id_to_entity.get(entity_o_id, {})
                entries.append({
                    "o_id": entity_o_id,
                    "name": info.get("title", f"#{entity_o_id}"),
                    "lat": lat,
                    "lng": lng,
                    "country": country,
                    "count": count,
                })
            by_role[role] = entries
        return {"by_role": by_role}
```

- [ ] **Step 2: Commit (no run yet — wired in next task)**

```bash
git add scripts/generate_person_dashboards.py
git commit -m "person block: summary/timeline/newspapers/countries/locations aggregators"
```

---

### Task 4: TF-IDF neighbor network + fan-out writer

**Files:**
- Modify: `scripts/generate_person_dashboards.py`

Builds document frequency once, computes TF-IDF scores per person, caps at 50 neighbors, and writes the full per-person JSON. Wires everything into `main`.

- [ ] **Step 1: Add `build_document_frequency` method**

Insert on `PersonDashboardGenerator`, after `compute_locations`:

```python
    # ------------------------------------------------------------------
    # TF-IDF document frequency — computed once across all persons
    # ------------------------------------------------------------------

    def build_document_frequency(self) -> None:
        """df[entity_o_id] = number of Persons whose item set touches it.

        Computed once up front so the per-person network builder can
        look up the IDF component in O(1).
        """
        for person_o_id, role_items in self.persons_items.items():
            touched: Set[int] = set()
            for item_key in role_items["subject"] | role_items["creator"]:
                roles = self.item_entities.get(item_key, {})
                for o_id in roles.get("subject", []) + roles.get("creator", []):
                    if o_id != person_o_id:
                        touched.add(o_id)
            for o_id in touched:
                self.df[o_id] = self.df.get(o_id, 0) + 1
        logger.info(f"Document frequency: {len(self.df)} distinct entities")
```

- [ ] **Step 2: Add `compute_network` method**

Insert right after `build_document_frequency`:

```python
    def compute_network(self, person_o_id: int) -> Dict[str, Any]:
        """TF-IDF ranked neighbor graph, per role.

        Nodes[0] is the person themselves (type='center', score=null).
        Neighbors are sorted by TF-IDF score descending, capped at
        ``TOP_N_NEIGHBORS``.
        """
        person_info = self.persons[person_o_id]
        by_role: Dict[str, Any] = {}

        for role in ("all", "subject", "creator"):
            item_keys = self._items_for_role(person_o_id, role)
            cooc: Counter = Counter()
            for key in item_keys:
                roles = self.item_entities.get(key, {})
                seen_here: Set[int] = set()
                for o_id in roles.get("subject", []) + roles.get("creator", []):
                    if o_id == person_o_id:
                        continue
                    if o_id in seen_here:
                        continue
                    seen_here.add(o_id)
                    cooc[o_id] += 1

            # Filter + score
            scored: List[Dict[str, Any]] = []
            for o_id, count in cooc.items():
                if count < MIN_COOCCURRENCE:
                    continue
                df_x = max(self.df.get(o_id, 1), 1)
                if df_x >= self.n_persons:
                    continue  # everyone has it, it's noise
                idf = math.log(self.n_persons / df_x)
                score = count * idf
                if score <= 0:
                    continue
                entity = self.id_to_entity.get(o_id)
                if not entity:
                    continue
                scored.append({
                    "o_id": o_id,
                    "title": entity["title"],
                    "type": entity["type"],
                    "cooc": count,
                    "score": round(score, 4),
                })

            scored.sort(key=lambda e: e["score"], reverse=True)
            scored = scored[:TOP_N_NEIGHBORS]

            nodes: List[Dict[str, Any]] = [{
                "o_id": person_o_id,
                "title": person_info["title"],
                "type": "center",
                "cooc": None,
                "score": None,
            }]
            nodes.extend(scored)

            edges: List[Dict[str, Any]] = [{
                "source": person_o_id,
                "target": n["o_id"],
                "weight": n["score"],
                "cooc": n["cooc"],
            } for n in scored]

            by_role[role] = {"nodes": nodes, "edges": edges}

        return {"by_role": by_role}
```

- [ ] **Step 3: Add the `build_person_json` + `generate_all` + `_build_person_header` orchestration methods**

Insert right after `compute_network`:

```python
    # ------------------------------------------------------------------
    # Per-person JSON assembly + fan-out
    # ------------------------------------------------------------------

    def _build_person_header(self, person_info: Dict[str, Any]) -> Dict[str, Any]:
        """Extract the handful of person-scoped fields that the header
        card needs (the block PHTML reads most fields from the Omeka
        representation directly; this is for JS-side labels only)."""
        row = person_info["row"]
        prenom_col = find_column(self.index_df, ["Prénom", "foaf:firstName"])
        nom_col = find_column(self.index_df, ["Nom", "foaf:lastName"])
        genre_col = find_column(self.index_df, ["Genre", "foaf:gender"])

        countries = parse_pipe_separated(row.get("countries"))
        first = str(row.get("first_occurrence") or "").strip() or None
        last = str(row.get("last_occurrence") or "").strip() or None

        return {
            "o_id": person_info["o_id"],
            "title": person_info["title"],
            "prenom": str(row.get(prenom_col) or "").strip() if prenom_col else "",
            "nom": str(row.get(nom_col) or "").strip() if nom_col else "",
            "genre": str(row.get(genre_col) or "").strip() if genre_col else "",
            "countries": countries,
            "first_occurrence": first,
            "last_occurrence": last,
        }

    def build_person_json(self, person_o_id: int) -> Dict[str, Any]:
        person_info = self.persons[person_o_id]

        summary = self.compute_summary(person_o_id)
        timeline = self.compute_timeline(person_o_id)
        newspapers = self.compute_newspapers(person_o_id)
        countries = self.compute_countries(person_o_id)
        network = self.compute_network(person_o_id)
        locations = self.compute_locations(person_o_id)

        # Backfill neighbors_count into summary now that network exists
        for role in ("all", "subject", "creator"):
            nodes = network["by_role"][role]["nodes"]
            summary["by_role"][role]["neighbors_count"] = max(0, len(nodes) - 1)

        return {
            "version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "person": self._build_person_header(person_info),
            "summary": summary,
            "timeline": timeline,
            "newspapers": newspapers,
            "countries": countries,
            "network": network,
            "locations": locations,
        }

    def generate_all(self) -> int:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        targets = list(self.persons_items.keys())
        if self.limit:
            targets = targets[: self.limit]

        written = 0
        for person_o_id in targets:
            if person_o_id not in self.persons:
                continue
            data = self.build_person_json(person_o_id)
            out_path = self.output_dir / f"{person_o_id}.json"
            save_json(data, out_path)
            written += 1
            if written % 100 == 0:
                logger.info(f"  {written} person JSONs written")
        logger.info(f"Done — {written} person JSONs written to {self.output_dir}")
        return written
```

- [ ] **Step 4: Wire the full pipeline into `main`**

Replace the end of `main()` (the "Skeleton run complete" log line) with:

```python
    gen.build_entity_lookup()
    gen.resolve_items()
    gen.build_document_frequency()
    written = gen.generate_all()
    logger.info(f"Finished: {written} person dashboards emitted")
    return 0
```

- [ ] **Step 5: Smoke-test with --limit 5**

Run: `rm -rf asset/data/person-dashboards/*.json && python3 scripts/generate_person_dashboards.py --limit 5`

Expected log tail:

```
Document frequency: <N> distinct entities
Finished: 5 person dashboards emitted
```

Expected filesystem state:

```bash
$ ls asset/data/person-dashboards/
1057.json  (and four others)
```

- [ ] **Step 6: Inspect one file to verify the JSON shape**

Run: `python3 -c "import json; d = json.load(open('asset/data/person-dashboards/1057.json')); print(list(d.keys())); print('roles:', list(d['summary']['by_role'].keys())); print('all mentions:', d['summary']['by_role']['all']['total_mentions']); print('neighbors:', d['summary']['by_role']['all']['neighbors_count']); print('first 3 nodes:', d['network']['by_role']['all']['nodes'][:3])"`

Expected output resembles:

```
['version', 'generated_at', 'person', 'summary', 'timeline', 'newspapers', 'countries', 'network', 'locations']
roles: ['all', 'subject', 'creator']
all mentions: <positive number, typically 50-300>
neighbors: <>= 0, typically 5-50>
first 3 nodes: [{'o_id': 1057, ..., 'type': 'center', ...}, {'o_id': ..., 'type': 'Organisations', ...}, ...]
```

If item 1057 isn't in the `--limit 5` slice, swap the filename for whichever exists. If `neighbors` is 0 everywhere, check that `MIN_COOCCURRENCE = 2` isn't filtering out everything (step through by dumping `df`).

- [ ] **Step 7: Commit**

```bash
git add scripts/generate_person_dashboards.py
git commit -m "person block: TF-IDF network + per-person JSON fan-out"
```

---

## Phase 2 — New shared chart builder

### Task 5: `C.network` — force-layout neighbor graph

**Files:**
- Modify: `asset/js/charts/shared/chart-options.js`

Adds one new builder at the end of the file, matching the style of `C.entities` and `C.treemap` (factory function returning a plain ECharts option object — no theme colors hardcoded, since the registered IWAC theme supplies them).

- [ ] **Step 1: Append `C.network` to the file**

Open `asset/js/charts/shared/chart-options.js`, scroll to the closing `})();` on the last line, and insert the following block **immediately before** that closing IIFE footer:

```javascript
    /* ----------------------------------------------------------------- */
    /*  Entity neighbor network (force-directed graph)                    */
    /* ----------------------------------------------------------------- */

    /**
     * Force-layout graph for a center entity + its top-N neighbors.
     *
     * Expected shape (produced by the Python generator):
     *   graph = {
     *     nodes: [
     *       { o_id, title, type, cooc, score }   // nodes[0] is the center
     *       ...
     *     ],
     *     edges: [
     *       { source, target, weight, cooc }
     *       ...
     *     ]
     *   }
     *
     * @param {Object} graph
     * @param {Object} [opts]
     * @param {number} [opts.maxLabelLength=24]   Middle-ellipsis cutoff
     * @param {Object} [opts.typeColors]          { typeName: hex }
     */
    C.network = function (graph, opts) {
        opts = opts || {};
        var maxLen = opts.maxLabelLength || 24;
        var nodes = (graph && graph.nodes) || [];
        var edges = (graph && graph.edges) || [];

        var palette = (ns.getPalette && ns.getPalette())
            || ['#d97706', '#2563eb', '#059669', '#9333ea', '#dc2626', '#0891b2'];
        var TYPE_COLORS = {
            'center':        palette[0],
            'Personnes':     palette[1],
            'Organisations': palette[2],
            'Lieux':         palette[3],
            'Sujets':        palette[4],
            '\u00c9v\u00e9nements': palette[5]
        };
        if (opts.typeColors) {
            for (var k in opts.typeColors) {
                if (Object.prototype.hasOwnProperty.call(opts.typeColors, k)) {
                    TYPE_COLORS[k] = opts.typeColors[k];
                }
            }
        }

        function truncate(name) {
            if (!name || name.length <= maxLen) return name || '';
            var head = Math.floor((maxLen - 1) / 2);
            var tail = maxLen - 1 - head;
            return name.slice(0, head) + '\u2026' + name.slice(-tail);
        }

        var scores = nodes.map(function (n) { return n.score || 0; });
        var maxScore = Math.max.apply(null, scores.concat([1]));
        var weights = edges.map(function (e) { return e.weight || 0; });
        var maxWeight = Math.max.apply(null, weights.concat([1]));

        var graphNodes = nodes.map(function (n, idx) {
            var isCenter = n.type === 'center';
            var normScore = isCenter ? 1 : Math.max(0, Math.min(1, (n.score || 0) / maxScore));
            var symbolSize = isCenter ? 46 : 14 + Math.sqrt(normScore) * 26;
            return {
                id: String(n.o_id),
                name: truncate(n.title || ''),
                fullTitle: n.title || '',
                entityType: n.type,
                o_id: n.o_id,
                cooc: n.cooc,
                score: n.score,
                symbolSize: symbolSize,
                itemStyle: { color: TYPE_COLORS[n.type] || palette[idx % palette.length] },
                fixed: isCenter,
                x: isCenter ? 0 : undefined,
                y: isCenter ? 0 : undefined,
                label: { show: true, position: 'right', formatter: '{b}' }
            };
        });

        var graphEdges = edges.map(function (e) {
            var normWeight = Math.max(0, Math.min(1, (e.weight || 0) / maxWeight));
            return {
                source: String(e.source),
                target: String(e.target),
                value: e.weight,
                cooc: e.cooc,
                lineStyle: {
                    width: 1 + Math.sqrt(normWeight) * 4,
                    opacity: 0.55
                }
            };
        });

        var uniqueTypes = {};
        nodes.forEach(function (n) { if (n.type && n.type !== 'center') uniqueTypes[n.type] = true; });
        var legendData = Object.keys(uniqueTypes).map(function (type) {
            return {
                name: t('entity_type_' + type),
                itemStyle: { color: TYPE_COLORS[type] }
            };
        });

        return {
            tooltip: {
                trigger: 'item',
                formatter: function (p) {
                    if (p.dataType === 'node') {
                        var data = p.data || {};
                        var lines = ['<strong>' + esc(data.fullTitle || '') + '</strong>'];
                        if (data.entityType && data.entityType !== 'center') {
                            lines.push(t('entity_type_' + data.entityType));
                        }
                        if (data.cooc != null) {
                            lines.push(t('mentions_count', { count: fmt(data.cooc) }));
                        }
                        if (data.score != null) {
                            lines.push(t('Distinctiveness score') + ': ' + fmt(Math.round(data.score * 10) / 10));
                        }
                        return lines.join('<br>');
                    }
                    if (p.dataType === 'edge') {
                        var e = p.data || {};
                        return t('mentions_count', { count: fmt(e.cooc || 0) });
                    }
                    return '';
                }
            },
            legend: legendData.length ? [{
                data: legendData,
                top: 4,
                itemWidth: 12,
                itemHeight: 10
            }] : [],
            series: [{
                type: 'graph',
                layout: 'force',
                roam: true,
                draggable: true,
                focusNodeAdjacency: true,
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: { width: 3 }
                },
                force: {
                    repulsion: 180,
                    edgeLength: [40, 120],
                    gravity: 0.05
                },
                data: graphNodes,
                links: graphEdges,
                cursor: 'pointer'
            }]
        };
    };
```

- [ ] **Step 2: Sanity-check the edit — the file should still end with `})();`**

Run: `tail -5 asset/js/charts/shared/chart-options.js`

Expected:

```
    };
})();
```

If the closing `})();` is missing or duplicated, undo and retry. The `C.network` block must sit **before** the last `})();`.

- [ ] **Step 3: Grep-test that `C.network` is exported**

Run: `grep -n "C.network = function" asset/js/charts/shared/chart-options.js`

Expected: one line, around line ~780.

- [ ] **Step 4: Commit**

```bash
git add asset/js/charts/shared/chart-options.js
git commit -m "shared: C.network force-graph builder for entity neighbors"
```

---

## Phase 3 — PHP wiring

### Task 6: `PersonDashboard` block layout + module registration

**Files:**
- Create: `src/Site/ResourcePageBlockLayout/PersonDashboard.php`
- Modify: `config/module.config.php`

- [ ] **Step 1: Create `PersonDashboard.php`**

Path: `src/Site/ResourcePageBlockLayout/PersonDashboard.php`

```php
<?php
namespace IwacVisualizations\Site\ResourcePageBlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;
use Omeka\Site\ResourcePageBlockLayout\ResourcePageBlockLayoutInterface;

class PersonDashboard implements ResourcePageBlockLayoutInterface
{
    /**
     * Omeka resource template id for the ``Personnes`` template on
     * islam.zmo.de. The block renders nothing when attached to items
     * from any other template, so admins can safely leave it on the
     * global item template config without breaking non-person pages.
     */
    const PERSONS_TEMPLATE_ID = 5;

    public function getLabel(): string
    {
        return 'Person dashboard'; // @translate
    }

    public function getCompatibleResourceNames(): array
    {
        return ['items'];
    }

    public function render(PhpRenderer $view, AbstractResourceEntityRepresentation $resource): string
    {
        $template = $resource->resourceTemplate();
        if (!$template || (int) $template->id() !== self::PERSONS_TEMPLATE_ID) {
            return '';
        }
        return $view->partial('common/resource-page-block-layout/person-dashboard', [
            'resource' => $resource,
        ]);
    }
}
```

- [ ] **Step 2: Register the block in `config/module.config.php`**

Open `config/module.config.php`. Find the `resource_page_block_layouts` block:

```php
    'resource_page_block_layouts' => [
        'invokables' => [
            'knowledgeGraph' => Site\ResourcePageBlockLayout\KnowledgeGraph::class,
            'itemSetDashboard' => Site\ResourcePageBlockLayout\ItemSetDashboard::class,
            'linkedItemsDashboard' => Site\ResourcePageBlockLayout\LinkedItemsDashboard::class,
        ],
    ],
```

Replace it with:

```php
    'resource_page_block_layouts' => [
        'invokables' => [
            'knowledgeGraph' => Site\ResourcePageBlockLayout\KnowledgeGraph::class,
            'itemSetDashboard' => Site\ResourcePageBlockLayout\ItemSetDashboard::class,
            'linkedItemsDashboard' => Site\ResourcePageBlockLayout\LinkedItemsDashboard::class,
            'personDashboard' => Site\ResourcePageBlockLayout\PersonDashboard::class,
        ],
    ],
```

- [ ] **Step 3: Grep-test both additions**

Run: `grep -n "personDashboard" config/module.config.php src/Site/ResourcePageBlockLayout/PersonDashboard.php`

Expected:

```
config/module.config.php:<line>:            'personDashboard' => Site\ResourcePageBlockLayout\PersonDashboard::class,
src/Site/ResourcePageBlockLayout/PersonDashboard.php:<line>:class PersonDashboard implements ResourcePageBlockLayoutInterface
```

- [ ] **Step 4: Commit**

```bash
git add src/Site/ResourcePageBlockLayout/PersonDashboard.php config/module.config.php
git commit -m "person block: register PersonDashboard resource-page block layout"
```

---

### Task 7: `person-dashboard.phtml` — server-side header card + async container

**Files:**
- Create: `view/common/resource-page-block-layout/person-dashboard.phtml`

- [ ] **Step 1: Create the PHTML**

Path: `view/common/resource-page-block-layout/person-dashboard.phtml`

```php
<?php
/**
 * Person Dashboard resource page block.
 *
 * Renders the static header card server-side from the Omeka item
 * representation, then an async container that the JS orchestrator
 * (person-dashboard.js) fills with 7 dynamic panels by fetching
 * asset/data/person-dashboards/{o_id}.json.
 *
 * Assets: the item controller already enqueues i18n / theme / core /
 * panels.js / chart-options.js / facet-buttons.js / maplibre.js /
 * table.js / pagination.js via Module::addAssets(). This template
 * enqueues only the block-specific orchestrator + panel modules.
 *
 * @var \Laminas\View\Renderer\PhpRenderer $this
 * @var \Omeka\Api\Representation\ItemRepresentation $resource
 */

// Shared primitives that aren't on the default item-controller bundle.
// Module::addAssets() currently attaches i18n/theme/core; panel-specific
// shared primitives are enqueued here in load order.
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/panels.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/chart-options.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/pagination.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/table.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/facet-buttons.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/shared/maplibre.js', 'IwacVisualizations'));

// Person panel modules (self-registering IIFEs)
$this->headScript()->appendFile($this->assetUrl('js/charts/person-dashboard/stats.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/person-dashboard/facet.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/person-dashboard/timeline.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/person-dashboard/newspapers.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/person-dashboard/countries.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/person-dashboard/network.js', 'IwacVisualizations'));
$this->headScript()->appendFile($this->assetUrl('js/charts/person-dashboard/map.js', 'IwacVisualizations'));

// Orchestrator — must load LAST
$this->headScript()->appendFile($this->assetUrl('js/charts/person-dashboard.js', 'IwacVisualizations'));

$siteSlug = $this->currentSite()->slug();
$escape = $this->plugin('escapeHtml');
$escapeAttr = $this->plugin('escapeHtmlAttr');

// -------- Header card data, read straight from the Omeka representation --------

$title = (string) $resource->displayTitle();

// Primary thumbnail, square — falls back to medium if square unavailable
$thumbUrl = $resource->thumbnailDisplayUrl('square') ?: $resource->thumbnailDisplayUrl('medium');

// Short description (dcterms:description) — first language-matching value wins,
// else the first value in any language.
$description = '';
foreach ($resource->value('dcterms:description', ['all' => true, 'default' => []]) as $value) {
    $description = (string) $value;
    if ($description !== '') break;
}

// Gender (foaf:gender) — item link label or literal string.
$gender = '';
$genderValue = $resource->value('foaf:gender');
if ($genderValue) {
    $gender = (string) $genderValue->displayTitle() ?: (string) $genderValue;
}

// Wikidata URI — dcterms:identifier value that starts with the wikidata host.
$wikidata = '';
foreach ($resource->value('dcterms:identifier', ['all' => true, 'default' => []]) as $value) {
    $s = (string) $value;
    if (strpos($s, 'wikidata.org') !== false) {
        $wikidata = $s;
        break;
    }
}

// Affiliations — linked items via dcterms:isPartOf.
$affiliations = [];
foreach ($resource->value('dcterms:isPartOf', ['all' => true, 'default' => []]) as $value) {
    $linked = $value->valueResource();
    if ($linked) {
        $affiliations[] = [
            'title' => (string) $linked->displayTitle(),
            'url'   => $linked->url(),
        ];
    }
}
?>

<div class="iwac-vis-block iwac-vis-person"
     data-item-id="<?= $escapeAttr($resource->id()) ?>"
     data-base-path="<?= $escapeAttr($this->basePath()) ?>"
     data-site-base="<?= $escapeAttr($this->basePath() . '/s/' . $siteSlug) ?>">

    <div class="iwac-vis-person-header">
        <?php if ($thumbUrl): ?>
            <img class="iwac-vis-person-header__avatar"
                 src="<?= $escapeAttr($thumbUrl) ?>"
                 alt="<?= $escapeAttr($title) ?>">
        <?php endif; ?>

        <div class="iwac-vis-person-header__body">
            <h2 class="iwac-vis-person-header__name"><?= $escape($title) ?></h2>

            <?php if ($gender !== ''): ?>
                <span class="iwac-vis-person-header__gender"><?= $escape($gender) ?></span>
            <?php endif; ?>

            <?php if ($description !== ''): ?>
                <p class="iwac-vis-person-header__bio"><?= $escape($description) ?></p>
            <?php endif; ?>

            <?php if ($wikidata !== '' || $affiliations): ?>
                <div class="iwac-vis-person-header__meta">
                    <?php if ($wikidata !== ''): ?>
                        <a class="iwac-vis-person-header__chip"
                           href="<?= $escapeAttr($wikidata) ?>"
                           rel="noopener"
                           target="_blank"><?= $this->translate('Wikidata') ?></a>
                    <?php endif; ?>
                    <?php foreach ($affiliations as $aff): ?>
                        <a class="iwac-vis-person-header__chip"
                           href="<?= $escapeAttr($aff['url']) ?>"><?= $escape($aff['title']) ?></a>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>
    </div>

    <div class="iwac-vis-loading iwac-vis-person__loading">
        <div class="iwac-vis-spinner"></div>
        <span><?= $this->translate('Loading dashboard') ?>&hellip;</span>
    </div>
</div>
```

- [ ] **Step 2: Grep-test the partial path**

Run: `grep -n "iwac-vis-person" view/common/resource-page-block-layout/person-dashboard.phtml | head -5`

Expected: 4+ hits.

- [ ] **Step 3: Commit**

```bash
git add view/common/resource-page-block-layout/person-dashboard.phtml
git commit -m "person block: PHTML with server-side header card + asset enqueue"
```

---

## Phase 4 — JS orchestrator + panel modules

### Task 8: Orchestrator + `stats.js` + `facet.js`

**Files:**
- Create: `asset/js/charts/person-dashboard.js`
- Create: `asset/js/charts/person-dashboard/stats.js`
- Create: `asset/js/charts/person-dashboard/facet.js`

Three related files bundled into one task because they're tiny and tightly coupled — the orchestrator holds facet state and the summary stats reader subscribes to it.

- [ ] **Step 1: Create the orchestrator**

Path: `asset/js/charts/person-dashboard.js`

```javascript
/**
 * IWAC Visualizations — Person Dashboard block (orchestrator)
 *
 * Thin controller: fetches asset/data/person-dashboards/{o_id}.json,
 * builds the layout skeleton, wires up the global role facet, and
 * delegates each panel's render to its dedicated module under
 * asset/js/charts/person-dashboard/.
 *
 * Panel render order:
 *   1. (Header card is rendered server-side in the PHTML — skipped here)
 *   2. Summary stats row        → stats.js
 *   3. Global role facet bar    → facet.js
 *   4. Mentions timeline        (reuses C.timeline via timeline.js)
 *   5. Top newspapers           (C.newspaper via newspapers.js)
 *   6. Countries breakdown      (C.horizontalBar via countries.js)
 *   7. Neighbors network        (C.network via network.js)
 *   8. Locations map            (createIwacMap via map.js)
 */
(function () {
    'use strict';

    var ns = window.IWACVis;
    if (!ns || !ns.panels || !ns.chartOptions) {
        console.warn('IWACVis person dashboard: missing panels or chartOptions — check script load order');
        return;
    }
    var P = ns.panels;

    function buildLayout(container, data, facet) {
        container.querySelector('.iwac-vis-person__loading') &&
            container.querySelector('.iwac-vis-person__loading').remove();

        var body = P.el('div', 'iwac-vis-person__body');
        container.appendChild(body);

        // 2. Summary stats row
        var statsHost = P.el('div', 'iwac-vis-person__stats');
        body.appendChild(statsHost);

        // 3. Facet bar
        var facetHost = P.el('div', 'iwac-vis-person__facet');
        body.appendChild(facetHost);

        // 4–8. Charts grid
        var grid = P.buildChartsGrid();
        grid.classList.add('iwac-vis-person__grid');
        body.appendChild(grid);

        var timelinePanel   = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Mentions'));
        var newspapersPanel = P.buildPanel('iwac-vis-panel',                      P.t('Top newspapers'));
        var countriesPanel  = P.buildPanel('iwac-vis-panel',                      P.t('Countries covered'));
        var networkPanel    = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Associated entities'));
        var mapPanel        = P.buildPanel('iwac-vis-panel iwac-vis-panel--wide', P.t('Locations mentioned'));

        [timelinePanel, newspapersPanel, countriesPanel, networkPanel, mapPanel]
            .forEach(function (p) { grid.appendChild(p.panel); });

        return {
            stats: statsHost,
            facetHost: facetHost,
            timeline: timelinePanel,
            newspapers: newspapersPanel,
            countries: countriesPanel,
            network: networkPanel,
            map: mapPanel
        };
    }

    function initDashboard(container) {
        var itemId = container.dataset.itemId;
        if (!itemId) return;

        var ctx = {
            basePath: container.dataset.basePath || '',
            siteBase: container.dataset.siteBase || '',
            itemId: itemId
        };
        var url = ctx.basePath + '/modules/IwacVisualizations/asset/data/person-dashboards/' + itemId + '.json';

        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var pd = ns.personDashboard || {};
                var facet = pd.facet ? pd.facet.create('all') : { role: 'all', subscribe: function () {}, set: function () {} };

                var h = buildLayout(container, data, facet);

                if (pd.stats)      pd.stats.render(h.stats, data, facet);
                if (pd.facet)      pd.facet.render(h.facetHost, data, facet);
                if (pd.timeline)   pd.timeline.render(h.timeline, data, facet);
                if (pd.newspapers) pd.newspapers.render(h.newspapers, data, facet, ctx);
                if (pd.countries)  pd.countries.render(h.countries, data, facet);
                if (pd.network)    pd.network.render(h.network, data, facet, ctx);
                if (pd.map)        pd.map.render(h.map, data, facet, ctx);
            })
            .catch(function (err) {
                console.error('IWACVis person dashboard:', err);
                var loading = container.querySelector('.iwac-vis-person__loading');
                if (loading) loading.remove();
                container.appendChild(P.el('div', 'iwac-vis-error', P.t('Failed to load')));
            });
    }

    function init() {
        if (typeof echarts === 'undefined') {
            console.warn('IWACVis person dashboard: ECharts not loaded');
            return;
        }
        var containers = document.querySelectorAll('.iwac-vis-person');
        for (var i = 0; i < containers.length; i++) {
            initDashboard(containers[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
```

- [ ] **Step 2: Create `stats.js`**

Path: `asset/js/charts/person-dashboard/stats.js`

```javascript
/**
 * IWAC Visualizations — Person Dashboard: summary stats row
 *
 * 5 cards: total mentions, year range, newspapers, countries, neighbors.
 * Subscribes to the role facet and rebuilds when the role changes.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P) {
        console.warn('IWACVis.person-dashboard/stats: missing panels');
        return;
    }

    function buildCards(slice) {
        var range = (slice.year_min && slice.year_max)
            ? slice.year_min + '\u2013' + slice.year_max
            : '\u2014';
        var cards = P.el('div', 'iwac-vis-overview-summary');

        function card(value, labelKey) {
            var c = P.el('div', 'iwac-vis-summary-card');
            c.appendChild(P.el('div', 'iwac-vis-summary-card__value',
                typeof value === 'number' ? P.formatNumber(value) : String(value || '\u2014')));
            c.appendChild(P.el('div', 'iwac-vis-summary-card__label', P.t(labelKey)));
            cards.appendChild(c);
        }

        card(slice.total_mentions, 'Total mentions');
        card(range, 'Period covered_short');
        card(slice.newspapers_count, 'Newspapers');
        card(slice.countries_count, 'Countries');
        card(slice.neighbors_count, 'Neighbors');
        return cards;
    }

    function render(host, data, facet) {
        var summary = (data && data.summary && data.summary.by_role) || {};
        host.innerHTML = '';
        host.appendChild(buildCards(summary[facet.role] || {}));

        facet.subscribe(function (role) {
            host.innerHTML = '';
            host.appendChild(buildCards(summary[role] || {}));
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.stats = { render: render };
})();
```

- [ ] **Step 3: Create `facet.js`**

Path: `asset/js/charts/person-dashboard/facet.js`

```javascript
/**
 * IWAC Visualizations — Person Dashboard: global role facet bar
 *
 * Exposes a tiny observable (`facet.role`, `facet.subscribe`,
 * `facet.set`) that every panel imports. The visual facet bar
 * is rendered via P.buildFacetButtons for styling consistency.
 *
 * Hides a role button if the matching summary slice has zero
 * mentions — avoids surfacing dead tabs for persons who only
 * ever appear as subject or only ever as creator.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.buildFacetButtons) {
        console.warn('IWACVis.person-dashboard/facet: missing panels / buildFacetButtons');
        return;
    }

    function create(initialRole) {
        var state = { role: initialRole || 'all' };
        var subscribers = [];
        return {
            get role() { return state.role; },
            set: function (role) {
                if (role === state.role) return;
                state.role = role;
                subscribers.forEach(function (fn) { fn(role); });
            },
            subscribe: function (fn) { subscribers.push(fn); }
        };
    }

    function render(host, data, facet) {
        var summary = (data && data.summary && data.summary.by_role) || {};
        var roles = [];
        // "All" is always shown when there's any data at all.
        if (summary.all && summary.all.total_mentions > 0) {
            roles.push({ key: 'all', label: P.t('All roles') });
        }
        if (summary.subject && summary.subject.total_mentions > 0) {
            roles.push({ key: 'subject', label: P.t('As subject') });
        }
        if (summary.creator && summary.creator.total_mentions > 0) {
            roles.push({ key: 'creator', label: P.t('As creator') });
        }
        if (roles.length <= 1) {
            // Only 0 or 1 role available → hide the bar entirely
            return;
        }

        var bar = P.buildFacetButtons({
            facets: roles,
            activeKey: facet.role,
            onChange: function (evt) { facet.set(evt.facet); }
        });
        host.appendChild(bar.root);
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.facet = { create: create, render: render };
})();
```

- [ ] **Step 4: Grep-test that all three files registered with `IWACVis.personDashboard`**

Run: `grep -rn "ns.personDashboard" asset/js/charts/person-dashboard*.js asset/js/charts/person-dashboard/ 2>/dev/null`

Expected: 3 hits (orchestrator doesn't register, only reads).

- [ ] **Step 5: Commit**

```bash
git add asset/js/charts/person-dashboard.js asset/js/charts/person-dashboard/stats.js asset/js/charts/person-dashboard/facet.js
git commit -m "person block: orchestrator + stats + facet panels"
```

---

### Task 9: `timeline.js`

**Files:**
- Create: `asset/js/charts/person-dashboard/timeline.js`

- [ ] **Step 1: Create the file**

Path: `asset/js/charts/person-dashboard/timeline.js`

```javascript
/**
 * IWAC Visualizations — Person Dashboard: mentions timeline
 *
 * Year × country stacked bar. Reuses C.timeline. Subscribes to the
 * role facet and reruns setOption when the role changes.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.person-dashboard/timeline: missing deps');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.timeline && data.timeline.by_role) || {};

        function currentSlice() {
            var slice = byRole[facet.role] || { years: [], countries: [], series: {} };
            return slice;
        }

        function hasData(slice) {
            return slice.years && slice.years.length > 0;
        }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var slice = currentSlice();
            if (hasData(slice)) {
                instance.setOption(C.timeline(slice), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData(currentSlice()) && !chart) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                var slice = currentSlice();
                if (hasData(slice)) {
                    chart.setOption(C.timeline(slice), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.timeline = { render: render };
})();
```

- [ ] **Step 2: Commit**

```bash
git add asset/js/charts/person-dashboard/timeline.js
git commit -m "person block: timeline panel (year x country)"
```

---

### Task 10: `newspapers.js`

**Files:**
- Create: `asset/js/charts/person-dashboard/newspapers.js`

- [ ] **Step 1: Create the file**

Path: `asset/js/charts/person-dashboard/newspapers.js`

```javascript
/**
 * IWAC Visualizations — Person Dashboard: top newspapers panel
 *
 * Horizontal bar with year range tooltip. Reuses C.newspaper.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.person-dashboard/newspapers: missing deps');
        return;
    }

    function render(panelEl, data, facet, ctx) {
        var byRole = (data && data.newspapers && data.newspapers.by_role) || {};

        function currentEntries() {
            return (byRole[facet.role] || []).slice(0, 15);
        }

        function hasData() { return currentEntries().length > 0; }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData()) {
                instance.setOption(C.newspaper(currentEntries()), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData() && !chart) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                if (hasData()) {
                    chart.setOption(C.newspaper(currentEntries()), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.newspapers = { render: render };
})();
```

- [ ] **Step 2: Commit**

```bash
git add asset/js/charts/person-dashboard/newspapers.js
git commit -m "person block: top newspapers panel"
```

---

### Task 11: `countries.js`

**Files:**
- Create: `asset/js/charts/person-dashboard/countries.js`

- [ ] **Step 1: Create the file**

Path: `asset/js/charts/person-dashboard/countries.js`

```javascript
/**
 * IWAC Visualizations — Person Dashboard: countries breakdown panel
 *
 * Horizontal bar. Reuses C.horizontalBar.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C) {
        console.warn('IWACVis.person-dashboard/countries: missing deps');
        return;
    }

    function render(panelEl, data, facet) {
        var byRole = (data && data.countries && data.countries.by_role) || {};

        function currentEntries() {
            return (byRole[facet.role] || []).slice(0, 10);
        }

        function hasData() { return currentEntries().length > 0; }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            if (hasData()) {
                instance.setOption(C.horizontalBar(currentEntries(), { nameKey: 'name', valueKey: 'count' }), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData() && !chart) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                if (hasData()) {
                    chart.setOption(C.horizontalBar(currentEntries(), { nameKey: 'name', valueKey: 'count' }), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.countries = { render: render };
})();
```

- [ ] **Step 2: Commit**

```bash
git add asset/js/charts/person-dashboard/countries.js
git commit -m "person block: countries panel"
```

---

### Task 12: `network.js`

**Files:**
- Create: `asset/js/charts/person-dashboard/network.js`

- [ ] **Step 1: Create the file**

Path: `asset/js/charts/person-dashboard/network.js`

```javascript
/**
 * IWAC Visualizations — Person Dashboard: neighbors network panel
 *
 * Force-directed graph of TF-IDF ranked associated entities, color-
 * coded by index.Type. Reuses C.network. Click a node to navigate to
 * the corresponding Omeka item page.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    var C = ns.chartOptions;
    if (!P || !C || !C.network) {
        console.warn('IWACVis.person-dashboard/network: missing deps (need C.network)');
        return;
    }

    function render(panelEl, data, facet, ctx) {
        var byRole = (data && data.network && data.network.by_role) || {};

        function currentGraph() {
            return byRole[facet.role] || { nodes: [], edges: [] };
        }

        function hasData(g) { return g && g.nodes && g.nodes.length > 1; }

        var chart = ns.registerChart(panelEl.chart, function (el, instance) {
            var g = currentGraph();
            if (hasData(g)) {
                instance.setOption(C.network(g), true);
            } else {
                instance.clear();
            }
        });

        if (!hasData(currentGraph()) && !chart) {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-empty', P.t('No data available')));
        }

        if (chart) {
            chart.on('click', function (params) {
                if (params.dataType !== 'node') return;
                var node = params.data || {};
                if (node.entityType === 'center') return;
                if (node.o_id && ctx && ctx.siteBase) {
                    window.location.href = ctx.siteBase + '/item/' + node.o_id;
                }
            });
        }

        facet.subscribe(function () {
            if (chart && !chart.isDisposed()) {
                var g = currentGraph();
                if (hasData(g)) {
                    chart.setOption(C.network(g), true);
                } else {
                    chart.clear();
                }
            }
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.network = { render: render };
})();
```

- [ ] **Step 2: Commit**

```bash
git add asset/js/charts/person-dashboard/network.js
git commit -m "person block: neighbors network panel"
```

---

### Task 13: `map.js`

**Files:**
- Create: `asset/js/charts/person-dashboard/map.js`

- [ ] **Step 1: Create the file**

Path: `asset/js/charts/person-dashboard/map.js`

```javascript
/**
 * IWAC Visualizations — Person Dashboard: locations map panel
 *
 * MapLibre bubble map of places mentioned alongside this person.
 * Reuses createIwacMap + createIwacPopup for theme-aware basemaps.
 */
(function () {
    'use strict';

    var ns = window.IWACVis = window.IWACVis || {};
    var P = ns.panels;
    if (!P || !P.createIwacMap) {
        console.warn('IWACVis.person-dashboard/map: missing deps (need createIwacMap)');
        return;
    }

    function featuresFrom(locations) {
        return {
            type: 'FeatureCollection',
            features: (locations || [])
                .filter(function (l) { return l.count > 0; })
                .map(function (l) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
                        properties: {
                            name: l.name,
                            country: l.country || '',
                            count: l.count
                        }
                    };
                })
        };
    }

    function render(panelEl, data, facet) {
        if (typeof maplibregl === 'undefined') {
            panelEl.chart.appendChild(P.el('div', 'iwac-vis-error', P.t('Map library unavailable')));
            return;
        }

        var byRole = (data && data.locations && data.locations.by_role) || {};

        // Pre-compute the max count across ALL roles so circle radius is
        // stable when the facet changes (otherwise the scale jumps).
        var maxCount = 1;
        ['all', 'subject', 'creator'].forEach(function (role) {
            (byRole[role] || []).forEach(function (l) {
                if (l.count > maxCount) maxCount = l.count;
            });
        });

        var mapContainer = P.el('div', 'iwac-vis-map');
        panelEl.chart.appendChild(mapContainer);

        var map = P.createIwacMap(mapContainer, {
            center: [2, 10],
            zoom: 3.2,
            onStyleReady: function (m) {
                if (!m.getSource('person-locations')) {
                    m.addSource('person-locations', {
                        type: 'geojson',
                        data: featuresFrom(byRole[facet.role])
                    });
                }
                if (!m.getLayer('person-location-circles')) {
                    m.addLayer({
                        id: 'person-location-circles',
                        type: 'circle',
                        source: 'person-locations',
                        paint: {
                            'circle-radius': [
                                'interpolate', ['linear'], ['get', 'count'],
                                1, 3,
                                maxCount, 24
                            ],
                            'circle-color': '#d97706',
                            'circle-opacity': 0.75,
                            'circle-stroke-width': 1.5,
                            'circle-stroke-color': '#78350f'
                        }
                    });
                }

                m.on('click', 'person-location-circles', function (e) {
                    var f = e.features && e.features[0];
                    if (!f) return;
                    P.createIwacPopup({ closeButton: true, closeOnClick: true })
                        .setLngLat(f.geometry.coordinates)
                        .setHTML(
                            '<strong>' + P.escapeHtml(f.properties.name) + '</strong><br>' +
                            (f.properties.country ? P.escapeHtml(f.properties.country) + '<br>' : '') +
                            P.formatNumber(Number(f.properties.count)) + ' ' + P.t('Mentions').toLowerCase()
                        )
                        .addTo(m);
                });
                m.on('mouseenter', 'person-location-circles', function () { m.getCanvas().style.cursor = 'pointer'; });
                m.on('mouseleave', 'person-location-circles', function () { m.getCanvas().style.cursor = ''; });
            }
        });

        facet.subscribe(function () {
            if (!map) return;
            var src = map.getSource('person-locations');
            if (src) src.setData(featuresFrom(byRole[facet.role]));
        });
    }

    ns.personDashboard = ns.personDashboard || {};
    ns.personDashboard.map = { render: render };
})();
```

- [ ] **Step 2: Grep-test all 7 panel modules**

Run: `ls asset/js/charts/person-dashboard/`

Expected: 7 files —

```
countries.js
facet.js
map.js
network.js
newspapers.js
stats.js
timeline.js
```

- [ ] **Step 3: Commit**

```bash
git add asset/js/charts/person-dashboard/map.js
git commit -m "person block: locations map panel"
```

---

## Phase 5 — i18n, CSS, translations

### Task 14: i18n keys + CSS

**Files:**
- Modify: `asset/js/iwac-i18n.js`
- Modify: `asset/css/iwac-visualizations.css`

- [ ] **Step 1: Add the new JS translation keys**

Open `asset/js/iwac-i18n.js`. Find the English dictionary opening (`en: { ... }`). Locate a reasonable insertion point — directly after the existing "Collection overview — summary labels" section. Add these keys inside the `en` block:

```javascript
            // Person dashboard — labels + panels
            'Mentions': 'Mentions',
            'Total mentions': 'Total mentions',
            'Neighbors': 'Neighbors',
            'Newspapers': 'Newspapers',
            'All roles': 'All roles',
            'As subject': 'As subject',
            'As creator': 'As creator',
            'Associated entities': 'Associated entities',
            'Locations mentioned': 'Locations mentioned',
            'Top newspapers': 'Top newspapers',
            'Countries covered': 'Countries covered',
            'Period covered_short': 'Years',
            'Distinctiveness score': 'Distinctiveness score',
            'Affiliations': 'Affiliations',
            'Wikidata': 'Wikidata',
            'Map library unavailable': 'Map library unavailable',

            // Entity type labels (used by C.network legend + tooltips)
            'entity_type_Personnes': 'Persons',
            'entity_type_Organisations': 'Organizations',
            'entity_type_Lieux': 'Places',
            'entity_type_Sujets': 'Subjects',
            'entity_type_\u00c9v\u00e9nements': 'Events',
```

Now find the French dictionary (`fr: { ... }`) and add the matching keys:

```javascript
            // Person dashboard — labels + panels
            'Mentions': 'Mentions',
            'Total mentions': 'Mentions totales',
            'Neighbors': 'Voisins',
            'Newspapers': 'Journaux',
            'All roles': 'Tous les r\u00f4les',
            'As subject': 'Comme sujet',
            'As creator': 'Comme cr\u00e9ateur',
            'Associated entities': 'Entit\u00e9s associ\u00e9es',
            'Locations mentioned': 'Lieux mentionn\u00e9s',
            'Top newspapers': 'Journaux les plus fr\u00e9quents',
            'Countries covered': 'Pays couverts',
            'Period covered_short': 'Ann\u00e9es',
            'Distinctiveness score': 'Indice de sp\u00e9cificit\u00e9',
            'Affiliations': 'Affiliations',
            'Wikidata': 'Wikidata',
            'Map library unavailable': 'Biblioth\u00e8que de cartes indisponible',

            // Entity type labels (used by C.network legend + tooltips)
            'entity_type_Personnes': 'Personnes',
            'entity_type_Organisations': 'Organisations',
            'entity_type_Lieux': 'Lieux',
            'entity_type_Sujets': 'Sujets',
            'entity_type_\u00c9v\u00e9nements': '\u00c9v\u00e9nements',
```

- [ ] **Step 2: Add CSS for the person block**

Open `asset/css/iwac-visualizations.css`. Append this block at the very end of the file:

```css
/* =========================================================================
 * Person Dashboard — header card + layout
 * ========================================================================= */

.iwac-vis-person {
    display: block;
}

.iwac-vis-person__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 1rem);
}

.iwac-vis-person-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4, 1rem);
    padding: var(--space-4, 1rem);
    background: var(--surface-raised, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: var(--radius-md, 8px);
    margin-bottom: var(--space-4, 1rem);
}

.iwac-vis-person-header__avatar {
    flex: 0 0 auto;
    width: 96px;
    height: 96px;
    object-fit: cover;
    border-radius: var(--radius-md, 8px);
    border: 1px solid var(--border, #e5e7eb);
}

.iwac-vis-person-header__body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
}

.iwac-vis-person-header__name {
    margin: 0;
    font-size: var(--text-xl, 1.25rem);
    color: var(--ink, #111827);
}

.iwac-vis-person-header__gender {
    display: inline-block;
    align-self: flex-start;
    padding: 0 var(--space-2, 0.5rem);
    border-radius: 999px;
    background: var(--surface, #f3f4f6);
    color: var(--muted, #6b7280);
    font-size: var(--text-sm, 0.875rem);
}

.iwac-vis-person-header__bio {
    margin: 0;
    color: var(--ink-light, #374151);
    font-size: var(--text-sm, 0.875rem);
    line-height: 1.5;
}

.iwac-vis-person-header__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2, 0.5rem);
    margin-top: var(--space-2, 0.5rem);
}

.iwac-vis-person-header__chip {
    display: inline-block;
    padding: 2px var(--space-2, 0.5rem);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 999px;
    background: var(--surface, #f9fafb);
    color: var(--primary, #d97706);
    font-size: var(--text-xs, 0.75rem);
    text-decoration: none;
    transition: background 120ms ease;
}

.iwac-vis-person-header__chip:hover {
    background: var(--surface-raised, #fff);
}

.iwac-vis-person__stats {
    margin-bottom: var(--space-3, 0.75rem);
}

.iwac-vis-person__facet {
    margin-bottom: var(--space-3, 0.75rem);
}

@media (max-width: 640px) {
    .iwac-vis-person-header {
        flex-direction: column;
    }
    .iwac-vis-person-header__avatar {
        width: 72px;
        height: 72px;
    }
}
```

- [ ] **Step 3: Grep-test keys landed in both dicts**

Run: `grep -n "Distinctiveness score" asset/js/iwac-i18n.js`

Expected: 2 matches (one in `en`, one in `fr`).

Run: `grep -n "iwac-vis-person-header__chip" asset/css/iwac-visualizations.css`

Expected: 2 matches (declaration + hover).

- [ ] **Step 4: Commit**

```bash
git add asset/js/iwac-i18n.js asset/css/iwac-visualizations.css
git commit -m "person block: i18n keys + CSS header card styles"
```

---

### Task 15: PHP translation strings (.pot + fr.po)

**Files:**
- Modify: `language/template.pot`
- Modify: `language/fr.po`

Only two server-rendered strings come from the Person block: the block layout label (`'Person dashboard'`) and the loading message (`'Loading dashboard'`, already present in `fr.po`). Only the new label needs a new entry.

- [ ] **Step 1: Add the new msgid/msgstr to `fr.po`**

Open `language/fr.po`. Find the `# Block layout labels` section (near the top, right after the header). After the existing `msgid "Compare Projects"` stanza, append:

```
msgid "Person dashboard"
msgstr "Tableau de bord de la personne"
```

- [ ] **Step 2: Rebuild the .mo file (optional but convention)**

Run: `msgfmt language/fr.po -o language/fr.mo 2>&1 || echo "msgfmt not installed — .mo will be rebuilt on next PO edit"`

If msgfmt is unavailable, continue — the translation still lives in fr.po.

- [ ] **Step 3: Update `template.pot` if it exists**

Run: `test -f language/template.pot && echo exists || echo missing`

If it exists, open it and append an empty stanza:

```
msgid "Person dashboard"
msgstr ""
```

If it's missing, skip — the collection-overview plan didn't maintain it strictly either.

- [ ] **Step 4: Commit**

```bash
git add language/fr.po language/fr.mo language/template.pot 2>/dev/null
git commit -m "person block: French translation for block layout label"
```

---

## Phase 6 — Documentation

### Task 16: README + ROADMAP + scripts README

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `scripts/README.md`

- [ ] **Step 1: Add the Person block to README.md's "Features" section**

Open `README.md`. Find the "### Knowledge Graph, Linked Items Dashboard, Item Set Dashboard, Compare Projects" section and **replace** its "Not yet implemented" note with this updated block:

```markdown
### Person dashboard (resource-page block) — precomputed

Per-Person resource-page block that renders when attached to an item
whose resource template is `Personnes` (template ID 5). Shows:

- **Header card** (server-rendered) — thumbnail, name, gender badge,
  bio (`dcterms:description`), Wikidata chip, affiliation chips
  (`dcterms:isPartOf`)
- **Summary stats row** — total mentions, year range, newspapers,
  countries, neighbors count
- **Global role facet** — `All / As subject / As creator` — re-filters
  every panel below with no refetch
- **Mentions timeline** — year × country stacked bar
- **Top newspapers** — horizontal bar with year-range tooltip
- **Countries covered** — horizontal bar
- **Associated entities network** — TF-IDF ranked force graph, nodes
  colored by index `Type` (Persons / Orgs / Places / Subjects /
  Events), click → Omeka entity page
- **Locations mentioned map** — MapLibre bubbles from mentioned
  `Lieux` entities, sized by count

Data comes from one JSON per person under
`asset/data/person-dashboards/{o_id}.json`, generated by
`scripts/generate_person_dashboards.py` using the `articles`,
`publications`, `references`, and `index` HF subsets. Neighbor ranking
uses TF-IDF (`score = cooc × log(N_persons / df)`) with
`min_cooccurrence = 2` and a top-50 cap, so distinctive relationships
outrank ubiquitous ones.

### Knowledge Graph, Linked Items Dashboard, Item Set Dashboard, Compare Projects

**Not yet implemented for IWAC.** Placeholder PHTMLs exist so Omeka
recognizes the block layouts, but they render a loading spinner only.
```

- [ ] **Step 2: Mark partial progress on the per-entity roadmap item**

Open `ROADMAP.md`. Find the "Next up" section. Replace the "Per-entity page block" and "Per-entity dashboard" bullets with:

```markdown
- [x] **Per-Person resource-page block** (2026-04-11) — precomputed,
      TF-IDF neighbor network, global creator/subject facet,
      MapLibre locations map. See
      `scripts/generate_person_dashboards.py` and
      `asset/js/charts/person-dashboard.js`.
- [ ] **Per-Organisation / Lieux / Sujets / Événements resource-page
      blocks** — reuse the Person skeleton (generator + orchestrator
      + `C.network`). One new block layout class per Type.
```

- [ ] **Step 3: Document the new generator in `scripts/README.md`**

Open `scripts/README.md`. Append a new section at the end:

```markdown
## generate_person_dashboards.py

Produces one JSON per Person in the `index` subset, consumed by the
`personDashboard` resource-page block. Output goes to
`asset/data/person-dashboards/{o_id}.json`.

```bash
python3 scripts/generate_person_dashboards.py              # all persons (~1,400 files)
python3 scripts/generate_person_dashboards.py --limit 5    # smoke test
python3 scripts/generate_person_dashboards.py -v           # debug logging
```

Neighbor ranking is TF-IDF (`score = cooc × log(N_persons / df)`) with
a minimum co-occurrence floor of 2 and a top-50 cap per role slice,
so distinctive relationships outrank globally-common entities.

The generator joins back into content subsets via string-match on
`subject` (role: `subject`) and `author` (role: `creator`) fields
using the same Unicode normalization as
`iwac-dashboard/scripts/generate_entity_spatial.py`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md ROADMAP.md scripts/README.md
git commit -m "docs: document person dashboard block + generator"
```

---

## Phase 7 — End-to-end verification

### Task 17: Full dataset run + manual browser test

**Files:** None modified.

- [ ] **Step 1: Run the full generator**

Run: `python3 scripts/generate_person_dashboards.py`

Expected (final log line):

```
Finished: <N> person dashboards emitted
```

where `N` is the count of Persons with at least one mention, typically 800–1,400.

- [ ] **Step 2: Sanity-check the Idriss Koudouss Koné file**

Run: `python3 -c "import json; d = json.load(open('asset/data/person-dashboards/1057.json')); s = d['summary']['by_role']['all']; print('mentions:', s['total_mentions']); print('year range:', s['year_min'], '-', s['year_max']); print('neighbors:', s['neighbors_count']); nw = d['network']['by_role']['all']; print('top 5 neighbors:'); [print(' ', n['title'], '(', n['type'], ')', 'score=', n.get('score')) for n in nw['nodes'][1:6]]"`

Expected:

- `mentions` is a positive integer (typically 100–300)
- `year_range` spans at least a decade
- `neighbors` is > 0 and <= 50
- Top neighbors are **not** the most globally-common entities
  ("Islam", "Côte d'Ivoire", etc.) but distinctive ones like
  "Conseil National Islamique", other Imams, specific mosques

If the top neighbors are all ubiquitous, the TF-IDF filter isn't
working — go back and verify `df` is populated and `MIN_COOCCURRENCE`
is applied.

- [ ] **Step 3: Load the block in a browser**

Manually:

1. Activate the module in **Admin > Modules** if not already active.
2. In **Admin > Sites > {your site} > Theme > Resource Pages**, add
   the "Person dashboard" block to the Item resource page config.
3. Visit <https://your-site.local/s/islam-west-africa-collection/item/1057>.
4. Verify:
   - Header card shows Idriss Koudouss Koné with thumbnail,
     gender badge, bio, Wikidata chip, affiliation chips.
   - 5 summary cards render below the header.
   - Facet bar (`All / As subject / As creator`) appears above the
     grid. Clicking `As creator` dims most panels because Koné is
     rarely an author; clicking back to `All` restores them.
   - Timeline shows year × country stacked bars.
   - Top newspapers bar is populated, hover shows year range tooltip.
   - Countries bar is populated.
   - Network graph shows Koné at center with colored neighbors by
     type. Click a neighbor node → navigates to that entity's item
     page.
   - Map shows markers for mentioned places in West Africa.
5. Toggle light/dark theme — every chart and the map basemap swap
   correctly.
6. Switch language to French (URL under `/s/{slug-fr}`) — all labels
   render in French, no English fallbacks visible.
7. Visit a non-Person item (e.g. an article item). The Person block
   should render nothing (empty, no error).

- [ ] **Step 4: Final commit — data files**

```bash
git add asset/data/person-dashboards/
git commit -m "person block: precomputed dashboard JSONs (v1 full run)"
```

Note: the per-person JSON files are version-controlled the same way
`collection-overview.json` and `collection-map.json` are — manual
developer-run regeneration on HF dataset updates (~monthly).

- [ ] **Step 5: Sign off**

If all verification passes, the feature is complete. If any step
fails, **do not mark done** — open an issue describing the failure
and fix or defer before closing the plan.

---

## Self-review checklist

Before marking any task complete, re-verify:

- [ ] **Spec §4 panel list (8 panels)** — all implemented? Header (PHTML
  T7), stats (T8), facet (T8), timeline (T9), newspapers (T10),
  countries (T11), network (T12), map (T13) ✓
- [ ] **Spec §5 TF-IDF** — `score = cooc × log(N/df)`, `min_cooc = 2`,
  top 50 — implemented in T4 `compute_network` ✓
- [ ] **Spec §6 global facet** — subscribe pattern, no refetch,
  hides empty role buttons — implemented in T8 `facet.js` ✓
- [ ] **Spec §7 JSON shape** — `by_role` on every panel, center node
  as `nodes[0]` — implemented in T3 + T4 ✓
- [ ] **Spec §8 file layout** — matches the file map above ✓
- [ ] **Spec §8.4 template gate** — template ID 5 check, renders
  empty for non-Person items — implemented in T6 ✓
- [ ] **Spec §9 C.network** — force layout, type colors from palette,
  person pinned, adjacency emphasis, click → item — implemented in
  T5 + T12 ✓
- [ ] **Spec §10 TF-IDF location for role** — `articles.subject` →
  subject, `references.author` → creator — implemented in T2 ✓
- [ ] **Spec §11 i18n keys** — every listed key added in T14 ✓
- [ ] **Spec §12 CSS** — all `.iwac-vis-person-*` classes added in T14 ✓
- [ ] **Spec §13 edge cases** — non-Person item returns `''`,
  empty slices render placeholder, missing JSON → error state,
  missing Wikidata / affiliations gracefully hidden — covered by
  T6, T7, T8, orchestrator error path ✓
- [ ] **Spec §14 testing plan** — T17 executes every step ✓
- [ ] **Spec §15 roadmap impact** — T16 updates ROADMAP.md ✓

If any row is unchecked at final review, fix before handing off.
