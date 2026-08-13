#!/usr/bin/env python3
"""
IWAC Dashboard Aggregation Core

Shared loading / lookup / resolution / aggregation logic for the
per-resource dashboard generators (``generate_person_dashboards.py``
and ``generate_entity_dashboards.py``). Both scripts emit the same
JSON section shapes — summary, timeline, newspapers, countries,
network, locations, topics, sentiment, heatmap, cooccurrence — so the
compute pipeline lives here once and the two generators only override
where they genuinely diverge:

- **Role iteration** (the main override point): persons facet every
  section by role (``all`` / ``subject`` / ``creator`` / ``editor``)
  while non-person entities wrap a single flat result in
  ``by_role.all``. Subclasses express this through ``_role_slices()``,
  which yields ``(role_name, item_keys)`` pairs; every ``compute_*``
  method builds its ``{"by_role": {...}}`` envelope from those slices.
- **Per-item entity storage**: persons keep a role → [o_id, ...] dict
  per item (plus a separate ``item_spatial`` table), entities collapse
  subject + spatial into one set. Subclasses bridge their shape via
  ``_register_item()`` / ``_item_neighbor_ids()`` /
  ``_item_location_ids()`` / ``_iter_target_items()``.
- **Target selection**: which index rows become dashboard targets
  (``_is_target()``) and what they are called in logs
  (``_target_label()``).

Class:
- DashboardAggregator: Template-method base class for dashboard
  generators

Hooks subclasses must implement:
- _is_target: Whether an index ``Type`` value is a dashboard target
- _target_label: Human label for targets in log messages
- _register_item: Store one resolved content item in the
  subclass-specific indexes
- _log_resolve_summary: Log the post-resolution summary line(s)
- _role_slices: Yield (role, item_keys) pairs for one target
- _item_neighbor_ids: Deduplicated co-occurring entity ids for one item
- _item_location_ids: Lieux ids associated with one item
- _iter_target_items: Yield (target_id, item_keys) pairs for the
  document-frequency pass

Shared methods:
- load_index / load_content: HF subset loading
- build_entity_lookup: Normalized-name → index row tables
- resolve_items: Per-item metadata + entity-reference extraction
- build_document_frequency: IDF denominator table for the network
- compute_summary / compute_timeline / compute_newspapers /
  compute_countries / compute_locations / compute_topics /
  compute_sentiment / compute_heatmap / compute_cooccurrence /
  compute_network: Per-target dashboard sections
- compute_sections: The ten sections above in canonical JSON order
"""

from __future__ import annotations

import logging
import math
from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, Iterator, List, Optional, Set, Tuple

import pandas as pd

from iwac_utils import (
    DATASET_ID,
    HIJRI_COLUMNS,
    SENTIMENT_MODELS,
    clean_str,
    extract_month_num,
    extract_year,
    find_column,
    load_dataset_safe,
    normalize_country,
    normalize_location_name,
    parse_coordinates,
    parse_pipe_separated,
    read_hijri_month,
    resolve_sentiment_columns,
    subjectivite_ordinal,
)

# Messages propagate to the root handlers installed by
# ``iwac_utils.configure_logging`` (the format carries no logger name,
# so output is indistinguishable from the generators' own messages).
logger = logging.getLogger(__name__)


# =============================================================================
# Constants shared by the dashboard generators
# =============================================================================

# Content subsets that can reference an entity. ``index`` is loaded
# separately (authority). ``documents`` and ``audiovisual`` are too
# small to justify the join cost and are intentionally excluded.
CONTENT_SUBSETS = ["articles", "publications", "references"]

# Subject field per subset — columns containing pipe-separated lists of
# entity names the item is "about". Subsets where a field is missing or
# blank are silently skipped.
SUBJECT_FIELDS = {
    "articles":     "subject",
    "publications": "subject",
    "references":   "subject",
}

# Spatial coverage field — multivalue, pipe-separated, contains place
# names that may or may not match an index Lieux entry.
SPATIAL_FIELDS = {
    "articles":     "spatial",
    "publications": "spatial",
    "references":   "spatial",
}

# Sentiment + LDA columns only exist on the articles subset. Items
# from publications/references contribute to mention counts but are
# silently skipped by the sentiment / topics / heatmap aggregators.
#
# SENTIMENT_MODELS holds the canonical model ids the emitted JSON keys on,
# which are also the HF column prefixes; resolve_sentiment_columns checks
# they are actually present in the loaded snapshot.

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

# Subjectivité arrives as a French label and is normalised to its 1..5
# ordinal by iwac_utils.subjectivite_ordinal. The segmentedBar panel
# treats the stops as named categories so the same {name, count} shape as
# polarité/centralité works unchanged.
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

# Top cap per target, per role slice, for the neighbor network panel.
TOP_N_NEIGHBORS = 50

# Authority types offered by the Associated entities panel's shared filter.
# Keep this order aligned with shared/entity-graph.js TYPE_SLOTS (minus the
# centre): the JSON keys are raw index ``Type`` values, while the client owns
# their translated display labels and palette slots.
NETWORK_ENTITY_TYPES = (
    "Personnes",
    "Organisations",
    "Lieux",
    "Sujets",
    "Événements",
)

# Minimum co-occurrence between two NEIGHBOURS before the network draws an
# edge between them. The ego edges (target → neighbour) are the panel's
# primary layer and keep their own DEFAULT_MIN_COOCCURRENCE floor; this
# governs the second layer, which exists to give the graph structure the
# ego edges cannot have.
#
# Before v1.28 the panel emitted ONLY ego edges, so every dashboard's
# network was a star: fifty spokes around one hub, no triangles, nothing
# for a layout to reveal beyond "these fifty things are near this one
# thing". A force layout has no information to work with there — the
# picture is a ring whatever the physics. With neighbour↔neighbour edges
# the same fifty entities separate into the clusters they actually form
# (a town, its imams, and the association they founded pull together and
# away from an unrelated national controversy), which is the question a
# reader brings to an entity page in the first place.
#
# 2 rather than 1: a single shared item between two neighbours is usually
# the target's own item, which links them trivially and would draw the
# complete graph on the top-N — every pair connected, i.e. no structure
# again, at 1,225 edges.
MIN_NEIGHBOUR_LINK = 2

# Cap on the second layer. Sized so the cross edges stay a texture the eye
# reads through rather than a mesh it reads instead; the ego edges are at
# most TOP_N_NEIGHBORS, so this keeps the two layers within ~4x.
MAX_NEIGHBOUR_LINKS = 200

# Max articles attached to each location in the map popup. Bounded
# because popular targets in large cities accumulate hundreds of
# mentions, and the popup only paginates a few per page anyway.
LOCATION_ARTICLES_CAP = 30


# =============================================================================
# Base class
# =============================================================================

class DashboardAggregator:
    """Shared pipeline for per-resource dashboard generators.

    Subclasses configure ``ROLE_FIELDS`` (which content columns map to
    which role) and implement the hooks listed in the module docstring.
    The pipeline order is::

        load_index() → load_content() → build_entity_lookup()
        → resolve_items() → build_document_frequency()
        → compute_sections(target_id) per target
    """

    # role name → {subset: column}. Iteration order defines both the
    # per-item resolution order and the role-list order in the output.
    ROLE_FIELDS: Dict[str, Dict[str, str]] = {"subject": SUBJECT_FIELDS}

    EMPTY_SUMMARY = {
        "total_mentions": 0,
        "year_min": None,
        "year_max": None,
        "newspapers_count": 0,
        "countries_count": 0,
    }

    def __init__(
        self,
        output_dir,
        limit: Optional[int] = None,
        repo_id: str = DATASET_ID,
        min_cooccurrence: int = DEFAULT_MIN_COOCCURRENCE,
        minify: bool = True,
    ) -> None:
        self.output_dir = output_dir
        self.limit = limit
        self.repo_id = repo_id
        self.min_cooccurrence = min_cooccurrence
        self.minify = minify

        self.index_df: Optional[pd.DataFrame] = None
        self.content_dfs: Dict[str, pd.DataFrame] = {}

        # Built by build_entity_lookup / resolve_items
        self.entity_lookup: Dict[str, Dict[str, Any]] = {}   # name_key -> entity info
        self.id_to_entity: Dict[int, Dict[str, Any]] = {}    # o_id -> entity info (reverse index)
        self.lieux_rows: Dict[int, Tuple[float, float]] = {}  # lieu o_id -> (lat, lng)
        self.targets: Dict[int, Dict[str, Any]] = {}          # o_id -> info, dashboard targets only
        # item_key -> subclass-shaped entity references (see _register_item)
        self.item_entities: Dict[str, Any] = {}
        self.items_meta: Dict[str, Dict[str, Any]] = {}       # item_key -> {o_id, pub_date, newspaper, country, subset, ...}
        self.df: Dict[int, int] = {}  # document frequency for TF-IDF
        self.n_targets: int = 0      # denominator for IDF

    # ------------------------------------------------------------------
    # Subclass hooks
    # ------------------------------------------------------------------

    def _is_target(self, entity_type: str) -> bool:
        """Whether an index ``Type`` value selects a dashboard target."""
        raise NotImplementedError

    def _target_label(self) -> str:
        """Plural noun used for targets in the lookup log line."""
        raise NotImplementedError

    def _cache_header_columns(self, df: pd.DataFrame) -> None:
        """Cache extra index columns the subclass header builder needs."""

    def _register_item(
        self,
        item_key: str,
        roles: Dict[str, List[int]],
        spatial_pairs: List[Tuple[str, Optional[Dict[str, Any]]]],
    ) -> None:
        """Store one resolved item in the subclass-specific indexes.

        ``roles`` maps each ``ROLE_FIELDS`` role to the entity o_ids
        matched in that column (encounter order, duplicates kept).
        ``spatial_pairs`` carries every ``dcterms:spatial`` name with
        its matched entity info (or ``None`` for free-form names).
        """
        raise NotImplementedError

    def _log_resolve_summary(self) -> None:
        """Log the post-``resolve_items`` summary line(s)."""
        raise NotImplementedError

    def _role_slices(self, target_id: int) -> Iterator[Tuple[str, Iterable[str]]]:
        """Yield ``(role_name, item_keys)`` pairs for one target.

        The yielded item-key iterable's order is preserved by every
        ``compute_*`` aggregator (it drives Counter insertion order and
        therefore tie-breaking in ``most_common``).
        """
        raise NotImplementedError

    def _item_neighbor_ids(self, item_key: str, exclude: int) -> Iterable[int]:
        """Deduplicated co-occurring entity o_ids for one item.

        ``exclude`` (the dashboard target) is skipped. Order drives
        Counter insertion order in the network / chord builders.
        """
        raise NotImplementedError

    def _item_location_ids(self, item_key: str) -> Iterable[int]:
        """Geocoded Lieux o_ids associated with one item (no dups)."""
        raise NotImplementedError

    def _iter_target_items(self) -> Iterator[Tuple[int, Iterable[str]]]:
        """Yield ``(target_id, item_keys)`` for the document-frequency pass."""
        raise NotImplementedError

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
    # Entity lookup + target filter
    # ------------------------------------------------------------------

    def build_entity_lookup(self) -> None:
        """Normalized-name → index row, o_id → index row, Lieux coords.

        Built once so per-target compute loops can do O(1) lookups
        instead of walking ``self.index_df`` again on every call. Also
        populates ``self.targets`` via the ``_is_target`` hook.
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

        self._cache_header_columns(df)

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

            if entity_type == "Lieux" and coord_col:
                coords = parse_coordinates(row.get(coord_col))
                if coords is not None:
                    # Note: index.countries is "countries this entity has
                    # been MENTIONED in", not "country this place is
                    # located in", so we deliberately do not record a
                    # country for the place. The frontend popup just
                    # shows the place name + count.
                    self.lieux_rows[o_id] = (coords[0], coords[1])

            if self._is_target(entity_type):
                self.targets[o_id] = info

        self.n_targets = len(self.targets)
        logger.info(
            f"Entity lookup built: {len(self.entity_lookup)} name keys, "
            f"{self.n_targets} {self._target_label()}, {len(self.lieux_rows)} geocoded places"
        )

    # ------------------------------------------------------------------
    # Per-item entity resolution
    # ------------------------------------------------------------------

    def resolve_items(self) -> None:
        """Walk each content row, extract metadata + entity references.

        Per row this builds ``self.items_meta[item_key]`` (shared shape)
        and hands the resolved role / spatial entity matches to the
        subclass through ``_register_item`` — persons keep role buckets
        and a separate spatial table, entities collapse everything into
        one set per item.
        """
        for subset, df in self.content_dfs.items():
            id_col = find_column(df, ["o:id", "id"])
            if not id_col:
                logger.warning(f"{subset}: no o:id column, skipping")
                continue

            role_cols: Dict[str, Optional[str]] = {}
            for role, field_map in self.ROLE_FIELDS.items():
                col = field_map.get(subset)
                if col and col not in df.columns:
                    col = None
                role_cols[role] = col

            spatial_col = find_column(df, [
                SPATIAL_FIELDS.get(subset, "spatial"),
                "spatial",
                "dcterms:spatial",
                "Couverture spatiale",
            ])

            date_col = find_column(df, ["pub_date", "dcterms:date"])
            # Lunar dates are READ, never derived — see read_hijri_month.
            # Absent on `references` by design (an academic imprint date
            # has no meaningful lunar reading), so these resolve to None
            # there and the Hijri grid skips those items exactly as it
            # skips a partial date.
            hijri_cols = {c: find_column(df, [c]) for c in HIJRI_COLUMNS}
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
            sentiment_cols: Dict[str, Dict[str, Optional[str]]] = (
                resolve_sentiment_columns(df) if subset == "articles" else
                {model: {} for model in SENTIMENT_MODELS}
            )

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
                    "hijri": read_hijri_month(row, hijri_cols),
                }
                for model in SENTIMENT_MODELS:
                    cols = sentiment_cols[model]
                    pol_c, cen_c = cols.get("polarite"), cols.get("centralite")
                    subj_c = cols.get("subjectivite")
                    meta[f"{model}_polarite"]     = clean_str(row.get(pol_c)) if pol_c  else ""
                    meta[f"{model}_centralite"]   = clean_str(row.get(cen_c)) if cen_c  else ""
                    # Label, not a number, since generation 2 — clean_float
                    # would swallow the whole axis silently.
                    meta[f"{model}_subjectivite"] = (
                        subjectivite_ordinal(row.get(subj_c)) if subj_c else None
                    )
                self.items_meta[item_key] = meta

                roles: Dict[str, List[int]] = {role: [] for role in self.ROLE_FIELDS}
                for role, col in role_cols.items():
                    if not col:
                        continue
                    for name in parse_pipe_separated(row.get(col)):
                        entity = self.entity_lookup.get(normalize_location_name(name))
                        if entity:
                            roles[role].append(entity["o_id"])

                # Resolve spatial coverage names independently — these
                # are place names, not entity references, but we look
                # them up in the same name → entity index so subclasses
                # can geocode them.
                spatial_pairs: List[Tuple[str, Optional[Dict[str, Any]]]] = []
                if spatial_col:
                    for name in parse_pipe_separated(row.get(spatial_col)):
                        spatial_pairs.append(
                            (name, self.entity_lookup.get(normalize_location_name(name)))
                        )

                self._register_item(item_key, roles, spatial_pairs)

        self._log_resolve_summary()

    @staticmethod
    def _first_country(value: Any) -> str:
        countries = normalize_country(value, return_list=True)
        if isinstance(countries, list) and countries:
            first = countries[0].strip()
            return first if first and first.lower() != "unknown" else ""
        return ""

    # ------------------------------------------------------------------
    # TF-IDF document frequency — computed once across all targets
    # ------------------------------------------------------------------

    def build_document_frequency(self) -> None:
        """df[entity_o_id] = number of targets whose item set touches it.

        Computed once up front so the per-target network builder can
        look up the IDF component in O(1). IDF reflects how broadly
        each co-occurring entity is shared across the targets of
        interest, so very common neighbors (e.g. "Islam") get
        penalized.
        """
        for target_id, item_keys in self._iter_target_items():
            touched: Set[int] = set()
            for item_key in item_keys:
                for o_id in self._item_neighbor_ids(item_key, target_id):
                    touched.add(o_id)
            for o_id in touched:
                self.df[o_id] = self.df.get(o_id, 0) + 1
        logger.info(f"Document frequency: {len(self.df)} distinct entities")

    # ------------------------------------------------------------------
    # Per-target aggregates — every section is faceted through
    # _role_slices so persons get all/subject/creator/editor buckets
    # and entities get a single by_role.all wrapper.
    # ------------------------------------------------------------------

    def compute_summary(self, target_id: int) -> Dict[str, Any]:
        by_role: Dict[str, Any] = {}
        for role, item_keys in self._role_slices(target_id):
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

    def compute_timeline(self, target_id: int) -> Dict[str, Any]:
        """Year × country stacked series, mirrors C.timeline shape."""
        by_role: Dict[str, Any] = {}
        for role, item_keys in self._role_slices(target_id):
            year_country: Counter = Counter()
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

    def compute_newspapers(self, target_id: int, top_n: int = 15) -> Dict[str, Any]:
        by_role: Dict[str, Any] = {}
        for role, item_keys in self._role_slices(target_id):
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

    def compute_countries(self, target_id: int) -> Dict[str, Any]:
        by_role: Dict[str, Any] = {}
        for role, item_keys in self._role_slices(target_id):
            counter: Counter = Counter()
            for key in item_keys:
                c = self.items_meta.get(key, {}).get("country") or ""
                if c:
                    counter[c] += 1
            entries = [{"name": name, "count": count} for name, count in counter.most_common()]
            by_role[role] = entries
        return {"by_role": by_role}

    def compute_locations(self, target_id: int) -> Dict[str, Any]:
        """Geographic places associated with this target, per role.

        Each place is counted once per item, regardless of how many
        sources (subject / creator / editor / spatial) surfaced it —
        the ``_item_location_ids`` hook owns that dedup. For every
        location we also emit an ``articles`` list (title / publisher /
        date / o_id) capped at ``LOCATION_ARTICLES_CAP`` so the
        front-end popup can render a paginated article browser.
        ``self.lieux_rows`` is precomputed in ``build_entity_lookup``.
        """
        by_role: Dict[str, Any] = {}
        for role, item_keys in self._role_slices(target_id):
            loc_counter: Counter = Counter()
            loc_items: Dict[int, List[str]] = {}
            for key in item_keys:
                for o_id in self._item_location_ids(key):
                    loc_counter[o_id] += 1
                    loc_items.setdefault(o_id, []).append(key)
            entries = []
            for o_id, count in loc_counter.most_common():
                lat, lng = self.lieux_rows[o_id]
                info = self.id_to_entity.get(o_id, {})
                articles = self._build_location_articles(loc_items.get(o_id, []))
                entries.append({
                    "o_id": o_id,
                    "name": info.get("title", f"#{o_id}"),
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

    def compute_topics(self, target_id: int) -> Dict[str, Any]:
        """Top LDA topic labels for items mentioning this target.

        Articles are the only subset with LDA fields; publications and
        references contribute to the mention count but not the topic
        bar. Each item counts once toward exactly one label.
        """
        by_role: Dict[str, Any] = {}
        for role, item_keys in self._role_slices(target_id):
            counter: Counter = Counter()
            for key in item_keys:
                label = self.items_meta.get(key, {}).get("lda_label") or ""
                if label:
                    counter[label] += 1
            entries = [
                {"label": label, "count": count}
                for label, count in counter.most_common(TOP_N_TOPICS)
            ]
            by_role[role] = entries
        return {"by_role": by_role}

    def compute_sentiment(self, target_id: int) -> Dict[str, Any]:
        """Polarité / centralité / subjectivité counts for the 3 AI models.

        Returns a structure the JS panel can flip between models without
        re-fetching. Categories are forced into IWAC display order so
        the stacked bar segments stay consistent.
        """
        by_role: Dict[str, Any] = {}
        for role, item_keys in self._role_slices(target_id):
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
                        # Already the 1..5 ordinal (subjectivite_ordinal
                        # ran at read time), so it is both the value the
                        # average is taken over and its own bucket.
                        sub_values.append(float(sub))
                        sub_counter[str(sub)] += 1
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

    @staticmethod
    def _month_grid(
        buckets: Dict[Tuple[int, int], int],
        axis_years: Set[int],
    ) -> Dict[str, Any]:
        """Fold (year, month) counts into an ECharts year × month grid.

        The year axis is filled to a contiguous min..max run rather than
        listing only the years that carry items: a category axis of
        [1975, 2011] would render a 36-year silence as one column step
        and read as continuous coverage.
        """
        if not axis_years:
            return {"years": [], "months": list(range(1, 13)), "cells": [], "items": 0}
        years = list(range(min(axis_years), max(axis_years) + 1))
        year_index = {y: i for i, y in enumerate(years)}
        return {
            "years": years,
            "months": list(range(1, 13)),
            "cells": [
                [year_index[y], m - 1, count]
                for (y, m), count in buckets.items()
            ],
            "items": sum(buckets.values()),
        }

    def compute_heatmap(self, target_id: int) -> Dict[str, Any]:
        """Year × month mention counts as ECharts heatmap cells, twice.

        The Gregorian grid stays at the top level of each role slice,
        where it has always been; the lunar one is a nested ``hijri``
        key. That split is what lets the panel treat the Hijri view as a
        question about the data rather than about the module version —
        a bundle generated before this existed simply carries no
        ``hijri`` key and the facet is not offered.

        The Gregorian y-axis spans the FULL year range (min..max
        inclusive) of items mentioning this target — same range the
        "Years" summary card shows — so the two panels stay consistent
        even when most dates are YYYY-only. Cells only populate for
        items with a parseable YYYY-MM date; gap years render as an
        empty row.

        **The two grids have different denominators, on purpose.** A
        lunar month straddles two Gregorian ones, so upstream converts
        only complete ``YYYY-MM-DD`` dates and leaves the rest null —
        and ``references`` is excluded from the conversion entirely.
        The Gregorian grid, by contrast, counts anything with a
        resolvable ``YYYY-MM``. Each grid therefore carries its own
        ``items`` total so the panel can state the gap instead of
        letting a reader compare two grids that silently count
        different corpora.
        """
        by_role: Dict[str, Any] = {}
        for role, item_keys in self._role_slices(target_id):
            buckets: Dict[Tuple[int, int], int] = Counter()
            hijri_buckets: Dict[Tuple[int, int], int] = Counter()
            all_years: Set[int] = set()  # any year we can extract (YYYY or finer)
            hijri_years: Set[int] = set()
            for key in item_keys:
                meta = self.items_meta.get(key, {})

                lunar = meta.get("hijri")
                if lunar:
                    hijri_buckets[lunar] += 1
                    hijri_years.add(lunar[0])

                date = meta.get("pub_date") or ""
                year = extract_year(date)
                if year is None:
                    continue
                all_years.add(year)
                month = extract_month_num(date)
                if month is None:
                    continue  # still count the year on the axis, just no cell
                buckets[(year, month)] += 1

            slice_out = self._month_grid(buckets, all_years)
            # Omitted rather than emitted empty: the renderer offers the
            # facet on presence, and an empty grid would advertise a view
            # with nothing in it.
            if hijri_buckets:
                slice_out["hijri"] = self._month_grid(hijri_buckets, hijri_years)
            by_role[role] = slice_out
        return {"by_role": by_role}

    def compute_cooccurrence(self, target_id: int) -> Dict[str, Any]:
        """Pairwise cooccurrence matrix among the top N neighbours.

        Distinct from the network panel: that one is ego-centric (this
        target at the centre, weights = TF-IDF to the target). This is
        pair-wise — for each item the target is in, every PAIR of other
        entities in that item gets one count. The result is a symmetric
        matrix the chord builder can render. Neighbours are picked by
        raw co-occurrence with the target (not by TF-IDF) so the chord
        nodes are the ones the user is most likely to recognise.
        """
        by_role: Dict[str, Any] = {}
        for role, item_keys in self._role_slices(target_id):
            neighbour_counter: Counter = Counter()
            for key in item_keys:
                for o_id in self._item_neighbor_ids(key, target_id):
                    neighbour_counter[o_id] += 1
            top = [o_id for o_id, _ in neighbour_counter.most_common(TOP_N_COOCCURRENCE)]
            if not top:
                by_role[role] = {"names": [], "matrix": []}
                continue
            index = {o_id: i for i, o_id in enumerate(top)}
            top_set = set(top)
            n = len(top)
            matrix = [[0] * n for _ in range(n)]
            for key in item_keys:
                here = sorted(
                    o_id for o_id in set(self._item_neighbor_ids(key, target_id))
                    if o_id in top_set
                )
                for i in range(len(here)):
                    for j in range(i + 1, len(here)):
                        a, b = index[here[i]], index[here[j]]
                        matrix[a][b] += 1
                        matrix[b][a] += 1
            names = [
                self.id_to_entity.get(o_id, {}).get("title", f"#{o_id}")
                for o_id in top
            ]
            by_role[role] = {"names": names, "matrix": matrix}
        return {"by_role": by_role}

    def compute_network(self, target_id: int) -> Dict[str, Any]:
        """TF-IDF ranked neighbor graph and temporal profile, per role.

        Nodes[0] is the target itself (type='center', score=null).
        Neighbors are scored as ``cooc * log(N / df_x)`` and sorted by
        score descending. The legacy root graph keeps the top
        ``TOP_N_NEIGHBORS`` overall; additive ``by_type`` graphs each take
        their own top N from the COMPLETE scored pool. That distinction is
        essential: filtering the already-truncated overall top 50 would mean
        "persons that happened to make the mixed top 50", not "top persons".

        Two layers of edges:

        - **ego** (``kind='ego'``) — target → neighbour, weighted by the
          TF-IDF score. The panel's primary statement.
        - **cross** (``kind='cross'``) — neighbour ↔ neighbour, weighted by
          how many of the target's items mention both. Emitted since v1.28;
          see ``MIN_NEIGHBOUR_LINK`` for why a star was the wrong shape.

        Consumers must treat ``kind`` as optional: dashboards generated
        before v1.28 carry ego edges only and no ``kind`` field at all.

        Payload v4 adds one ``over_time`` object to the role's root graph.
        It stores sparse per-year item counts for the union of nodes exposed
        by the mixed and type-specific top-50 rankings. Keeping it beside the
        variants avoids repeating the same temporal series up to six times.
        Counts remain item-level: one item contributes at most once to one
        neighbour in one year, regardless of duplicate metadata values.
        """
        target_info = self.targets[target_id]
        by_role: Dict[str, Any] = {}

        for role, item_keys in self._role_slices(target_id):
            # Materialised once: the cross-edge pass below needs a second
            # walk over the same items, and _role_slices may hand back a
            # one-shot iterable.
            item_keys = list(item_keys)
            cooc: Counter = Counter()
            cooc_by_year: Dict[int, Counter] = defaultdict(Counter)
            dated_items = 0
            for key in item_keys:
                # Hooks promise a deduplicated iterable, but enforcing that
                # contract here protects the temporal counts from malformed
                # pipe fields without changing first-encounter tie-breaking.
                neighbours = list(dict.fromkeys(
                    self._item_neighbor_ids(key, target_id)
                ))
                for o_id in neighbours:
                    cooc[o_id] += 1

                year = extract_year(
                    self.items_meta.get(key, {}).get("pub_date") or ""
                )
                if year is None:
                    continue
                dated_items += 1
                for o_id in neighbours:
                    cooc_by_year[o_id][year] += 1

            # Filter + score
            scored: List[Dict[str, Any]] = []
            for o_id, count in cooc.items():
                if count < self.min_cooccurrence:
                    continue
                df_x = max(self.df.get(o_id, 1), 1)
                if df_x >= self.n_targets:
                    continue  # everyone has it, it's noise
                idf = math.log(self.n_targets / df_x)
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

            # The root stays byte-shape compatible with pre-v1.44 clients.
            # New clients discover ``by_type`` and can switch to a correctly
            # ranked single-type graph without another request.
            root_graph = self._build_network_graph(
                target_id,
                target_info,
                item_keys,
                scored[:TOP_N_NEIGHBORS],
            )
            ranked_by_type = {
                entity_type: [
                    node for node in scored
                    if node["type"] == entity_type
                ][:TOP_N_NEIGHBORS]
                for entity_type in NETWORK_ENTITY_TYPES
            }
            root_graph["by_type"] = {
                entity_type: self._build_network_graph(
                    target_id,
                    target_info,
                    item_keys,
                    ranked_by_type[entity_type],
                )
                for entity_type in NETWORK_ENTITY_TYPES
            }

            # A type-specific top 50 can contain nodes outside the mixed top
            # 50. Emit the union so every filter has its complete history,
            # while retaining scored order for deterministic JSON output.
            temporal_ids = {
                node["o_id"]
                for node in scored[:TOP_N_NEIGHBORS]
            }
            for type_nodes in ranked_by_type.values():
                temporal_ids.update(node["o_id"] for node in type_nodes)
            root_graph["over_time"] = self._build_network_timeline(
                item_keys,
                scored,
                temporal_ids,
                cooc_by_year,
                dated_items,
            )

            by_role[role] = root_graph

        return {"by_role": by_role}

    def _build_network_graph(
        self,
        target_id: int,
        target_info: Dict[str, Any],
        item_keys: List[str],
        scored: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Assemble one already-ranked network slice.

        Kept separate from :meth:`compute_network` so the mixed graph and the
        five type-specific variants share exactly the same node/edge contract.
        ``scored`` is not copied: callers select and cap it before entering.
        """
        nodes: List[Dict[str, Any]] = [{
            "o_id": target_id,
            "title": target_info["title"],
            "type": "center",
            "cooc": None,
            "score": None,
        }]
        nodes.extend(scored)

        edges: List[Dict[str, Any]] = [{
            "source": target_id,
            "target": node["o_id"],
            "weight": node["score"],
            "cooc": node["cooc"],
            "kind": "ego",
        } for node in scored]
        edges.extend(
            self._neighbour_edges(
                target_id,
                item_keys,
                {node["o_id"] for node in scored},
            )
        )
        return {"nodes": nodes, "edges": edges}

    def _build_network_timeline(
        self,
        item_keys: List[str],
        scored: List[Dict[str, Any]],
        kept: Set[int],
        cooc_by_year: Dict[int, Counter],
        dated_items: int,
    ) -> Dict[str, Any]:
        """Sparse year counts for the associated-entity temporal matrix.

        ``year_min`` / ``year_max`` describe the focal record's complete
        dated item span, rather than only years in which a currently visible
        neighbour occurs. This keeps empty periods honest and makes the time
        view line up with the dashboard's mentions timeline. Undated items
        are reported explicitly so their absence from the matrix is visible.
        """
        years = [
            year
            for key in item_keys
            if (year := extract_year(
                self.items_meta.get(key, {}).get("pub_date") or ""
            )) is not None
        ]
        entities: Dict[str, List[List[int]]] = {}
        for node in scored:
            o_id = node["o_id"]
            if o_id not in kept:
                continue
            yearly = cooc_by_year.get(o_id, {})
            entities[str(o_id)] = [
                [int(year), int(count)]
                for year, count in sorted(yearly.items())
            ]

        return {
            "year_min": min(years) if years else None,
            "year_max": max(years) if years else None,
            "dated_items": dated_items,
            "undated_items": max(0, len(item_keys) - dated_items),
            "entities": entities,
        }

    def _neighbour_edges(
        self,
        target_id: int,
        item_keys: List[str],
        kept: Set[int],
    ) -> List[Dict[str, Any]]:
        """Neighbour ↔ neighbour co-occurrence edges among ``kept``.

        Same pairwise counting as ``compute_cooccurrence`` (each of the
        target's items contributes one count to every pair of other
        entities it mentions), restricted to the nodes the network kept
        and to pairs above ``MIN_NEIGHBOUR_LINK``.

        Sorted by weight then by id pair, so a regeneration of unchanged
        data produces a byte-identical file — the fan-out writes one JSON
        per item and a churning diff there is expensive.
        """
        if len(kept) < 2:
            return []

        pair_counts: Counter = Counter()
        for key in item_keys:
            here = sorted(
                o_id for o_id in set(self._item_neighbor_ids(key, target_id))
                if o_id in kept
            )
            for i in range(len(here)):
                for j in range(i + 1, len(here)):
                    pair_counts[(here[i], here[j])] += 1

        pairs = [
            (pair, count)
            for pair, count in pair_counts.items()
            if count >= MIN_NEIGHBOUR_LINK
        ]
        pairs.sort(key=lambda item: (-item[1], item[0]))

        return [{
            "source": pair[0],
            "target": pair[1],
            "weight": count,
            "cooc": count,
            "kind": "cross",
        } for pair, count in pairs[:MAX_NEIGHBOUR_LINKS]]

    # ------------------------------------------------------------------
    # Section assembly
    # ------------------------------------------------------------------

    def compute_sections(self, target_id: int) -> Dict[str, Any]:
        """All ten dashboard sections in canonical JSON key order."""
        return {
            "summary":       self.compute_summary(target_id),
            "timeline":      self.compute_timeline(target_id),
            "newspapers":    self.compute_newspapers(target_id),
            "countries":     self.compute_countries(target_id),
            "network":       self.compute_network(target_id),
            "locations":     self.compute_locations(target_id),
            "topics":        self.compute_topics(target_id),
            "sentiment":     self.compute_sentiment(target_id),
            "heatmap":       self.compute_heatmap(target_id),
            "cooccurrence":  self.compute_cooccurrence(target_id),
        }
