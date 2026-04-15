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
    clean_float,
    clean_str,
    configure_logging,
    extract_month_num,
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
# Editor is a separate role from creator (author). Only the references
# subset distinguishes editors — bibliographic entries for edited volumes
# list the editor in ``editor`` and the chapter/book author in ``author``.
EDITOR_FIELDS = {
    "references": "editor",
}

# Canonical role ordering. Every per-role aggregator iterates this tuple
# so adding a role is a one-line change here plus a persons_items init
# update. ``"all"`` is the union across subject/creator/editor item sets.
ROLES: Tuple[str, ...] = ("all", "subject", "creator", "editor")

# Spatial coverage field — multivalue, pipe-separated, contains place
# names that may or may not match an index Lieux entry. The previous
# implementation only looked at SUBJECT and CREATOR entities and filtered
# those that happened to be Lieux, which silently dropped every place
# named only in `dcterms:spatial`.
SPATIAL_FIELDS = {
    "articles":     "spatial",
    "publications": "spatial",
    "references":   "spatial",
}

# Sentiment + LDA columns only exist on the articles subset. Items
# from publications/references contribute to mention counts but are
# silently skipped by the sentiment / topics / heatmap aggregators.
SENTIMENT_MODELS = ("gemini", "chatgpt", "mistral")
SENTIMENT_FIELDS = {
    "polarite":     "{model}_polarite",
    "centralite":   "{model}_centralite_islam_musulmans",
    "subjectivite": "{model}_subjectivite_score",
}

# Polarité ordering — kept as the canonical IWAC scale so the chart
# segments always render in this order regardless of dataset row order.
POLARITE_ORDER = [
    "Très positif",
    "Positif",
    "Neutre",
    "Négatif",
    "Très négatif",
    "Non applicable",
]
CENTRALITE_ORDER = [
    "Très central",
    "Central",
    "Secondaire",
    "Marginal",
    "Non abordé",
]

# Subjectivité scores are integers 1..5 in the IWAC dataset. The
# segmentedBar panel treats these as named categories so the same
# {name, count} shape as polarité/centralité works unchanged.
SUBJECTIVITE_BUCKETS = ["1", "2", "3", "4", "5"]

# How many top entities to keep in the cooccurrence chord matrix. The
# chord layout becomes unreadable above ~15 nodes.
TOP_N_COOCCURRENCE = 15

# How many LDA topics to keep in the topics horizontal bar.
TOP_N_TOPICS = 12

# Minimum co-occurrence before a neighbor qualifies for the network.
# Singletons produce noisy TF-IDF scores. Overridable via
# --min-cooccurrence on the CLI.
DEFAULT_MIN_COOCCURRENCE = 2

# Top cap per person, per role slice.
TOP_N_NEIGHBORS = 50

# Max articles attached to each location in the map popup. Bounded
# because popular persons in large cities accumulate hundreds of
# mentions, and the popup only paginates a few per page anyway.
LOCATION_ARTICLES_CAP = 30

# Omeka resource template id for ``Personnes`` on islam.zmo.de.
PERSON_TEMPLATE_TYPE = "Personnes"

# Module-level logger. Populated by ``main()`` via ``global logger``.
logger: Optional[logging.Logger] = None


class PersonDashboardGenerator:
    """Builds one JSON per Person in the index subset."""

    def __init__(
        self,
        output_dir: Path,
        limit: Optional[int] = None,
        repo_id: str = DATASET_ID,
        min_cooccurrence: int = DEFAULT_MIN_COOCCURRENCE,
    ) -> None:
        self.output_dir = output_dir
        self.limit = limit
        self.repo_id = repo_id
        self.min_cooccurrence = min_cooccurrence

        self.index_df: Optional[pd.DataFrame] = None
        self.content_dfs: Dict[str, pd.DataFrame] = {}

        # Built in later tasks
        self.entity_lookup: Dict[str, Dict[str, Any]] = {}
        self.id_to_entity: Dict[int, Dict[str, Any]] = {}  # o_id -> entity info (reverse index)
        self.lieux_rows: Dict[int, Tuple[float, float]] = {}  # o_id -> (lat, lng)
        self.persons: Dict[int, Dict[str, Any]] = {}
        self.item_entities: Dict[str, Dict[str, List[int]]] = {}  # item_key -> {'subject': [o_id, ...], 'creator': [...], 'editor': [...]}
        # item_key -> set of Lieux o_ids parsed from the dcterms:spatial field.
        # Kept separate from item_entities because spatial coverage isn't a
        # "role" of the entity, it's a property of the item.
        self.item_spatial: Dict[str, Set[int]] = {}
        self.items_meta: Dict[str, Dict[str, Any]] = {}           # item_key -> {o_id, pub_date, newspaper, country, subset}
        self.persons_items: Dict[int, Dict[str, Set[str]]] = defaultdict(
            lambda: {"subject": set(), "creator": set(), "editor": set()}
        )
        self.df: Dict[int, int] = {}  # document frequency for TF-IDF
        self.n_persons: int = 0

        # Cached column names for _build_person_header — populated in build_entity_lookup
        self.prenom_col: Optional[str] = None
        self.nom_col: Optional[str] = None
        self.genre_col: Optional[str] = None

    # ------------------------------------------------------------------
    # Loaders
    # ------------------------------------------------------------------

    def load_index(self) -> None:
        logger.info("Loading index subset...")
        self.index_df = load_dataset_safe("index", repo_id=self.repo_id)
        if self.index_df is None or self.index_df.empty:
            raise RuntimeError("index subset returned empty — aborting")
        logger.info(f"  {len(self.index_df)} index entries")

    def load_content(self) -> None:
        for subset in CONTENT_SUBSETS:
            logger.info(f"Loading content subset: {subset}")
            df = load_dataset_safe(subset, repo_id=self.repo_id)
            if df is None or df.empty:
                logger.warning(f"  {subset} returned empty — continuing")
                continue
            self.content_dfs[subset] = df
            logger.info(f"  {len(df)} rows")

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

        self.prenom_col = find_column(df, ["Prénom", "foaf:firstName"])
        self.nom_col = find_column(df, ["Nom", "foaf:lastName"])
        self.genre_col = find_column(df, ["Genre", "foaf:gender"])

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
                    # Note: index.countries is "countries this entity has
                    # been MENTIONED in", not "country this place is
                    # located in", so we deliberately do not record a
                    # country for the place. The frontend popup just
                    # shows the place name + count.
                    self.lieux_rows[o_id] = (coords[0], coords[1])

        self.n_persons = len(self.persons)
        logger.info(
            f"Entity lookup built: {len(self.entity_lookup)} name keys, "
            f"{self.n_persons} persons, {len(self.lieux_rows)} geocoded places"
        )

    # ------------------------------------------------------------------
    # Per-item entity resolution
    # ------------------------------------------------------------------

    def resolve_items(self) -> None:
        """Walk each content row and extract entity o_ids by role.

        Populates:
          - self.item_entities[item_key] = {"subject": [o_id...], "creator": [o_id...]}
          - self.item_spatial[item_key]  = {lieu_o_id, ...}  (parsed from dcterms:spatial)
          - self.items_meta[item_key]    = {o_id, pub_date, newspaper, country, subset}
          - self.persons_items[person_o_id] = {"subject": {item_key,...}, "creator": {...}}
        """
        spatial_hits = 0
        spatial_misses = 0

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
            editor_col = EDITOR_FIELDS.get(subset)
            if editor_col and editor_col not in df.columns:
                editor_col = None
            spatial_col = find_column(df, [
                SPATIAL_FIELDS.get(subset, "spatial"),
                "spatial",
                "dcterms:spatial",
                "Couverture spatiale",
            ])

            date_col = find_column(df, ["pub_date", "dcterms:date"])
            country_col = find_column(df, ["country", "countries"])
            # Title column — the locations map popup (map.js) needs it
            # to render an article list per location. Fall through the
            # usual IWAC alias ladder.
            title_col = find_column(df, ["Titre", "dcterms:title", "title"])
            # References are books/edited volumes — the per-item "outlet"
            # lives in ``publisher``, not ``newspaper``. Other subsets keep
            # the newspaper-first fallback chain.
            if subset == "references":
                newspaper_col = find_column(df, ["publisher", "dcterms:publisher"])
            else:
                newspaper_col = find_column(df, ["newspaper", "dcterms:publisher", "source"])

            # Sentiment + LDA columns only exist on the articles subset.
            # On other subsets these resolve to None and the
            # corresponding aggregators silently skip the item.
            lda_label_col = find_column(df, ["lda_topic_label", "lda_topic"])
            sentiment_cols: Dict[str, Dict[str, Optional[str]]] = {}
            for model in SENTIMENT_MODELS:
                sentiment_cols[model] = {
                    k: (tpl.format(model=model) if tpl.format(model=model) in df.columns else None)
                    for k, tpl in SENTIMENT_FIELDS.items()
                }

            for _, row in df.iterrows():
                raw_id = row.get(id_col)
                try:
                    item_o_id = int(raw_id)
                except (TypeError, ValueError):
                    continue
                item_key = f"{subset}:{item_o_id}"

                meta: Dict[str, Any] = {
                    "o_id": item_o_id,
                    "subset": subset,
                    "title": str(row.get(title_col) or "").strip() if title_col else "",
                    "pub_date": str(row.get(date_col) or "").strip() if date_col else "",
                    "country": self._first_country(row.get(country_col)) if country_col else "",
                    "newspaper": str(row.get(newspaper_col) or "").strip() if newspaper_col else "",
                    "lda_label": clean_str(row.get(lda_label_col)) if lda_label_col else "",
                }
                for model in SENTIMENT_MODELS:
                    cols = sentiment_cols[model]
                    meta[f"{model}_polarite"]     = clean_str(row.get(cols["polarite"]))     if cols["polarite"]     else ""
                    meta[f"{model}_centralite"]   = clean_str(row.get(cols["centralite"]))   if cols["centralite"]   else ""
                    meta[f"{model}_subjectivite"] = clean_float(row.get(cols["subjectivite"])) if cols["subjectivite"] else None
                self.items_meta[item_key] = meta

                roles: Dict[str, List[int]] = {"subject": [], "creator": [], "editor": []}

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

                if editor_col:
                    for name in parse_pipe_separated(row.get(editor_col)):
                        entity = self.entity_lookup.get(normalize_location_name(name))
                        if entity:
                            roles["editor"].append(entity["o_id"])

                self.item_entities[item_key] = roles

                # Parse spatial coverage independently — these are place
                # names, not entity references, but we look them up in the
                # same name → entity index so we can geocode them.
                if spatial_col:
                    seen_spatial: Set[int] = set()
                    for name in parse_pipe_separated(row.get(spatial_col)):
                        entity = self.entity_lookup.get(normalize_location_name(name))
                        if entity and entity["o_id"] in self.lieux_rows:
                            seen_spatial.add(entity["o_id"])
                            spatial_hits += 1
                        elif name.strip():
                            spatial_misses += 1
                    if seen_spatial:
                        self.item_spatial[item_key] = seen_spatial

                for role_name, o_ids in roles.items():
                    for o_id in o_ids:
                        if o_id in self.persons:
                            self.persons_items[o_id][role_name].add(item_key)

        logger.info(
            f"Resolved {len(self.item_entities)} items; "
            f"{sum(1 for p in self.persons_items if self.persons_items[p]['subject'] or self.persons_items[p]['creator'] or self.persons_items[p]['editor'])} "
            f"persons have at least one mention"
        )
        logger.info(
            f"Spatial coverage: {spatial_hits} matched to Lieux entries, "
            f"{spatial_misses} unmatched (free-form place names not in IWAC index)"
        )

    @staticmethod
    def _first_country(value: Any) -> str:
        countries = normalize_country(value, return_list=True)
        if isinstance(countries, list) and countries:
            first = countries[0].strip()
            return first if first and first.lower() != "unknown" else ""
        return ""

    # ------------------------------------------------------------------
    # Per-person aggregates
    # ------------------------------------------------------------------

    EMPTY_SUMMARY = {
        "total_mentions": 0,
        "year_min": None,
        "year_max": None,
        "newspapers_count": 0,
        "countries_count": 0,
    }

    def _items_for_role(
        self, person_o_id: int, role: str
    ) -> List[str]:
        """Return item_keys for this person + role. 'all' = union."""
        if role == "all":
            return sorted(
                self.persons_items[person_o_id]["subject"]
                | self.persons_items[person_o_id]["creator"]
                | self.persons_items[person_o_id]["editor"]
            )
        return sorted(self.persons_items[person_o_id][role])

    def compute_summary(self, person_o_id: int) -> Dict[str, Any]:
        by_role: Dict[str, Dict[str, Any]] = {}
        for role in ROLES:
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
            }
        return {"by_role": by_role}

    def compute_timeline(self, person_o_id: int) -> Dict[str, Any]:
        """Year × country stacked series, mirrors C.timeline shape."""
        by_role: Dict[str, Any] = {}
        for role in ROLES:
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
        for role in ROLES:
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
                    "references": 0,
                    "country": meta.get("country") or "",
                    "year_min": None,
                    "year_max": None,
                })
                s["total"] += 1
                if meta.get("subset") == "articles":
                    s["articles"] += 1
                elif meta.get("subset") == "publications":
                    s["publications"] += 1
                elif meta.get("subset") == "references":
                    s["references"] += 1
                y = extract_year(meta.get("pub_date"))
                if y is not None:
                    s["year_min"] = y if s["year_min"] is None else min(s["year_min"], y)
                    s["year_max"] = y if s["year_max"] is None else max(s["year_max"], y)
            entries = sorted(stats.values(), key=lambda e: e["total"], reverse=True)[:top_n]
            by_role[role] = entries
        return {"by_role": by_role}

    def compute_countries(self, person_o_id: int) -> Dict[str, Any]:
        by_role: Dict[str, Any] = {}
        for role in ROLES:
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
        """Aggregate places associated with this person, per role.

        Pulls Lieux from three sources for every item the person touches:
          1. The item's ``dcterms:spatial`` field (primary source — these
             are explicitly tagged places, parsed in ``resolve_items``)
          2. Any ``subject`` entity that happens to be a Lieux record
          3. Any ``creator`` entity that happens to be a Lieux record

        Each place is counted once per item, regardless of how many of
        the three sources surfaced it. For every location we also emit
        an ``articles`` list (title / publisher / date / o_id) capped
        at ``LOCATION_ARTICLES_CAP`` so the front-end popup can render a
        paginated article browser. ``self.lieux_rows`` is precomputed
        in ``build_entity_lookup`` (o_id → (lat, lng, country)).
        """
        by_role: Dict[str, Any] = {}
        for role in ROLES:
            item_keys = self._items_for_role(person_o_id, role)
            loc_counter: Counter = Counter()
            loc_items: Dict[int, List[str]] = {}
            for key in item_keys:
                roles = self.item_entities.get(key, {})
                seen_here: Set[int] = set(self.item_spatial.get(key, set()))
                for entity_o_id in roles.get("subject", []) + roles.get("creator", []) + roles.get("editor", []):
                    if entity_o_id in self.lieux_rows:
                        seen_here.add(entity_o_id)
                for entity_o_id in seen_here:
                    loc_counter[entity_o_id] += 1
                    loc_items.setdefault(entity_o_id, []).append(key)
            entries = []
            for entity_o_id, count in loc_counter.most_common():
                lat, lng = self.lieux_rows[entity_o_id]
                info = self.id_to_entity.get(entity_o_id, {})
                articles = self._build_location_articles(loc_items.get(entity_o_id, []))
                entries.append({
                    "o_id": entity_o_id,
                    "name": info.get("title", f"#{entity_o_id}"),
                    "lat": lat,
                    "lng": lng,
                    "count": count,
                    "articles": articles,
                })
            by_role[role] = entries
        return {"by_role": by_role}

    def _build_location_articles(self, item_keys: List[str]) -> List[Dict[str, Any]]:
        """Build the per-location article list for the map popup.

        Newest items first (string sort on ``pub_date`` works for the
        ``YYYY-MM-DD`` format used across every content subset), capped
        at ``LOCATION_ARTICLES_CAP``. Articles without a title are
        silently dropped — they'd render as empty rows in the popup.
        """
        snippets: List[Dict[str, Any]] = []
        for key in item_keys:
            meta = self.items_meta.get(key)
            if not meta:
                continue
            title = (meta.get("title") or "").strip()
            if not title:
                continue
            snippets.append({
                "o_id": meta.get("o_id"),
                "subset": meta.get("subset"),
                "title": title,
                "publisher": (meta.get("newspaper") or "").strip(),
                "date": (meta.get("pub_date") or "").strip(),
            })
        snippets.sort(key=lambda s: s.get("date") or "", reverse=True)
        return snippets[:LOCATION_ARTICLES_CAP]

    # ------------------------------------------------------------------
    # Topic mix (LDA) — articles only
    # ------------------------------------------------------------------

    def compute_topics(self, person_o_id: int) -> Dict[str, Any]:
        """Top LDA topic labels for items mentioning this person.

        Articles are the only subset with LDA fields; publications and
        references contribute to the mention count but not the topic
        bar. Each item counts once toward exactly one label.
        """
        by_role: Dict[str, Any] = {}
        for role in ROLES:
            counter: Counter = Counter()
            for key in self._items_for_role(person_o_id, role):
                label = self.items_meta.get(key, {}).get("lda_label") or ""
                if label:
                    counter[label] += 1
            entries = [
                {"label": label, "count": count}
                for label, count in counter.most_common(TOP_N_TOPICS)
            ]
            by_role[role] = entries
        return {"by_role": by_role}

    # ------------------------------------------------------------------
    # Sentiment — articles only, faceted by AI model
    # ------------------------------------------------------------------

    def compute_sentiment(self, person_o_id: int) -> Dict[str, Any]:
        """Polarité / centralité / subjectivité counts for the 3 AI models.

        Returns a structure the JS panel can flip between models without
        re-fetching. Categories are forced into IWAC display order so
        the stacked bar segments stay consistent.
        """
        by_role: Dict[str, Any] = {}
        for role in ROLES:
            item_keys = self._items_for_role(person_o_id, role)
            by_model: Dict[str, Any] = {}
            articles_total = 0
            for key in item_keys:
                if self.items_meta.get(key, {}).get("subset") == "articles":
                    articles_total += 1
            for model in SENTIMENT_MODELS:
                pol_counter: Counter = Counter()
                cen_counter: Counter = Counter()
                sub_counter: Counter = Counter()
                sub_values: List[float] = []
                rated = 0
                for key in item_keys:
                    meta = self.items_meta.get(key, {})
                    if meta.get("subset") != "articles":
                        continue
                    pol = meta.get(f"{model}_polarite") or ""
                    cen = meta.get(f"{model}_centralite") or ""
                    sub = meta.get(f"{model}_subjectivite")
                    if pol:
                        pol_counter[pol] += 1
                    if cen:
                        cen_counter[cen] += 1
                    if sub is not None:
                        sub_values.append(float(sub))
                        # Bucket into integer 1..5 (IWAC domain).
                        bucket = max(1, min(5, int(round(float(sub)))))
                        sub_counter[str(bucket)] += 1
                    if pol or cen or sub is not None:
                        rated += 1
                # Force the canonical ordering even when categories are absent
                pol_ordered = [{"name": n, "count": pol_counter.get(n, 0)} for n in POLARITE_ORDER]
                cen_ordered = [{"name": n, "count": cen_counter.get(n, 0)} for n in CENTRALITE_ORDER]
                sub_ordered = [{"name": n, "count": sub_counter.get(n, 0)} for n in SUBJECTIVITE_BUCKETS]
                # Drop trailing all-zero categories (visual noise) but keep
                # the canonical order in between.
                while pol_ordered and pol_ordered[-1]["count"] == 0:
                    pol_ordered.pop()
                while cen_ordered and cen_ordered[-1]["count"] == 0:
                    cen_ordered.pop()
                by_model[model] = {
                    "polarite": pol_ordered,
                    "centralite": cen_ordered,
                    "subjectivite": sub_ordered,
                    "subjectivite_avg": (
                        round(sum(sub_values) / len(sub_values), 2)
                        if sub_values else None
                    ),
                    "rated_articles": rated,
                }
            by_role[role] = {
                "models": list(SENTIMENT_MODELS),
                "by_model": by_model,
                "articles_total": articles_total,
            }
        return {"by_role": by_role}

    # ------------------------------------------------------------------
    # Year × month heatmap
    # ------------------------------------------------------------------

    def compute_heatmap(self, person_o_id: int) -> Dict[str, Any]:
        """Year × month mention counts as ECharts heatmap cells.

        The y-axis spans the FULL year range (min..max inclusive) of
        items mentioning this person — same range the "Years" summary
        card shows — so the two panels stay consistent even when most
        dates are YYYY-only. Cells only populate for items with a
        parseable YYYY-MM date; gap years render as an empty row.
        """
        by_role: Dict[str, Any] = {}
        for role in ROLES:
            buckets: Dict[Tuple[int, int], int] = Counter()
            all_years: Set[int] = set()  # any year we can extract (YYYY or finer)
            for key in self._items_for_role(person_o_id, role):
                date = self.items_meta.get(key, {}).get("pub_date") or ""
                year = extract_year(date)
                if year is None:
                    continue
                all_years.add(year)
                month = extract_month_num(date)
                if month is None:
                    continue  # still count the year on the axis, just no cell
                buckets[(year, month)] += 1
            if not all_years:
                by_role[role] = {"years": [], "months": list(range(1, 13)), "cells": []}
                continue
            # Full contiguous range so empty years render as blank rows.
            years = list(range(min(all_years), max(all_years) + 1))
            year_index = {y: i for i, y in enumerate(years)}
            cells = [
                [year_index[y], m - 1, count]
                for (y, m), count in buckets.items()
            ]
            by_role[role] = {
                "years": years,
                "months": list(range(1, 13)),
                "cells": cells,
            }
        return {"by_role": by_role}

    # ------------------------------------------------------------------
    # Pairwise cooccurrence chord
    # ------------------------------------------------------------------

    def compute_cooccurrence(self, person_o_id: int) -> Dict[str, Any]:
        """Pairwise cooccurrence matrix among the top N neighbours.

        Distinct from the existing network panel: that one is ego-
        centric (this person at the centre, weights = TF-IDF to the
        person). This is pair-wise — for each item the person is in,
        every PAIR of other entities in that item gets one count. The
        result is a symmetric matrix the chord builder can render.
        """
        by_role: Dict[str, Any] = {}
        for role in ROLES:
            item_keys = self._items_for_role(person_o_id, role)
            # Pick the N most-frequent neighbours (by raw co-occurrence
            # with the person, not by TF-IDF) so the chord nodes are the
            # ones the user is most likely to recognise.
            neighbour_counter: Counter = Counter()
            for key in item_keys:
                roles = self.item_entities.get(key, {})
                seen: Set[int] = set()
                for o_id in roles.get("subject", []) + roles.get("creator", []) + roles.get("editor", []):
                    if o_id != person_o_id and o_id not in seen:
                        seen.add(o_id)
                        neighbour_counter[o_id] += 1
            top = [o_id for o_id, _ in neighbour_counter.most_common(TOP_N_COOCCURRENCE)]
            top_set = set(top)
            if not top:
                by_role[role] = {"names": [], "matrix": []}
                continue
            index = {o_id: i for i, o_id in enumerate(top)}
            n = len(top)
            matrix = [[0] * n for _ in range(n)]
            for key in item_keys:
                roles = self.item_entities.get(key, {})
                here: Set[int] = set()
                for o_id in roles.get("subject", []) + roles.get("creator", []) + roles.get("editor", []):
                    if o_id in top_set:
                        here.add(o_id)
                ids = sorted(here)
                for i in range(len(ids)):
                    for j in range(i + 1, len(ids)):
                        a, b = index[ids[i]], index[ids[j]]
                        matrix[a][b] += 1
                        matrix[b][a] += 1
            names = [
                self.id_to_entity.get(o_id, {}).get("title", f"#{o_id}")
                for o_id in top
            ]
            by_role[role] = {"names": names, "matrix": matrix}
        return {"by_role": by_role}

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
            for item_key in role_items["subject"] | role_items["creator"] | role_items["editor"]:
                roles = self.item_entities.get(item_key, {})
                for o_id in roles.get("subject", []) + roles.get("creator", []) + roles.get("editor", []):
                    if o_id != person_o_id:
                        touched.add(o_id)
            for o_id in touched:
                self.df[o_id] = self.df.get(o_id, 0) + 1
        logger.info(f"Document frequency: {len(self.df)} distinct entities")

    def compute_network(self, person_o_id: int) -> Dict[str, Any]:
        """TF-IDF ranked neighbor graph, per role.

        Nodes[0] is the person themselves (type='center', score=null).
        Neighbors are sorted by TF-IDF score descending, capped at
        ``TOP_N_NEIGHBORS``.
        """
        person_info = self.persons[person_o_id]
        by_role: Dict[str, Any] = {}

        for role in ROLES:
            item_keys = self._items_for_role(person_o_id, role)
            cooc: Counter = Counter()
            for key in item_keys:
                roles = self.item_entities.get(key, {})
                seen_here: Set[int] = set()
                for o_id in roles.get("subject", []) + roles.get("creator", []) + roles.get("editor", []):
                    if o_id == person_o_id:
                        continue
                    if o_id in seen_here:
                        continue
                    seen_here.add(o_id)
                    cooc[o_id] += 1

            # Filter + score
            scored: List[Dict[str, Any]] = []
            for o_id, count in cooc.items():
                if count < self.min_cooccurrence:
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

    # ------------------------------------------------------------------
    # Per-person JSON assembly + fan-out
    # ------------------------------------------------------------------

    def _build_person_header(self, person_info: Dict[str, Any]) -> Dict[str, Any]:
        """Extract the handful of person-scoped fields that the header
        card needs (the block PHTML reads most fields from the Omeka
        representation directly; this is for JS-side labels only)."""
        row = person_info["row"]
        prenom_col = self.prenom_col
        nom_col = self.nom_col
        genre_col = self.genre_col

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

        return {
            "version": 2,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "person":        self._build_person_header(person_info),
            "summary":       self.compute_summary(person_o_id),
            "timeline":      self.compute_timeline(person_o_id),
            "newspapers":    self.compute_newspapers(person_o_id),
            "countries":     self.compute_countries(person_o_id),
            "network":       self.compute_network(person_o_id),
            "locations":     self.compute_locations(person_o_id),
            "topics":        self.compute_topics(person_o_id),
            "sentiment":     self.compute_sentiment(person_o_id),
            "heatmap":       self.compute_heatmap(person_o_id),
            "cooccurrence":  self.compute_cooccurrence(person_o_id),
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
            save_json(data, out_path, minify=True, log=False)
            written += 1
            if written % 100 == 0:
                logger.info(f"  {written} person JSONs written")
        logger.info(f"Done — {written} person JSONs written to {self.output_dir}")
        return written


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "asset" / "data" / "person-dashboards",
        help="Where to write per-person JSON files (default: %(default)s)",
    )
    parser.add_argument(
        "--repo",
        default=DATASET_ID,
        help="Hugging Face dataset repo id (default: %(default)s)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N persons (smoke test). 0 or unset = all.",
    )
    parser.add_argument(
        "--min-cooccurrence",
        type=int,
        default=DEFAULT_MIN_COOCCURRENCE,
        help="Minimum co-occurrence count for a neighbor to qualify for the network panel (default: %(default)s)",
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
        repo_id=args.repo,
        min_cooccurrence=args.min_cooccurrence,
    )

    gen.load_index()
    gen.load_content()
    gen.build_entity_lookup()
    gen.resolve_items()

    gen.build_document_frequency()
    written = gen.generate_all()
    logger.info(f"Finished: {written} person dashboards emitted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
