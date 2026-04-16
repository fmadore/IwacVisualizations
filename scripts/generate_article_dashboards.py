#!/usr/bin/env python3
"""
generate_article_dashboards.py
==============================

Generate one JSON file per newspaper article in the IWAC ``articles``
subset under ``asset/data/article-dashboards/{o_id}.json``. Articles are
Omeka items whose resource template is ``bibo:Article`` (template id 8
on islam.zmo.de). Each file drives the IwacVisualizations
``articleDashboard`` resource-page block.

The per-article JSON holds everything the front-end needs to render
without any further network calls:

    * ``article``             — compact metadata (title, newspaper,
                                country, pub_date, language, lexical
                                metrics, LDA topic label)
    * ``entities``            — index entries resolved from the
                                article's ``subject`` + ``spatial``
                                fields (o_id / title / type)
    * ``spatial``             — subset of entities with parseable
                                coordinates, for the mini MapLibre map
    * ``sentiment``           — 3-model (Gemini / ChatGPT / Mistral)
                                sentiment reshaped to the same
                                ``{polarite, centralite, subjectivite}``
                                bucket-histogram contract the person /
                                entity sentiment panel already reads.
                                For a single article this is ``count=1``
                                in the bucket that model picked, 0
                                elsewhere.
    * ``related_by_entities`` — top-K articles that share the most
                                entities with this one (shared-entity
                                count; up to 3 shared-entity o_ids
                                inlined for the tooltip)
    * ``semantic_neighbors``  — top-K articles by cosine similarity of
                                ``embedding_OCR`` (768-dim Gemini)

The 3-layer "context" graph the UI renders (center article + inner
ring of entities + outer ring of related articles) is built CLIENT-SIDE
from ``entities`` + ``related_by_entities`` at render time — keeping
it out of the JSON saves ~3 KB per file.

Usage
-----
    python scripts/generate_article_dashboards.py
    python scripts/generate_article_dashboards.py --limit 5
    python scripts/generate_article_dashboards.py --top-k-semantic 10 --top-k-related 20
"""
from __future__ import annotations

import argparse
import logging
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np
import pandas as pd

from iwac_utils import (
    DATASET_ID,
    clean_float,
    clean_str,
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

# Only one subset is relevant here — articles. Per-article dashboards
# intentionally don't aggregate publications / references; they are
# about the NEWSPAPER article as a unit.
ARTICLES_SUBSET = "articles"

# Sentiment axes that exist on the articles subset. Mirrors the person
# + entity dashboard generators so the shared sentiment.js panel reads
# the same shape unchanged.
SENTIMENT_MODELS = ("gemini", "chatgpt", "mistral")
SENTIMENT_FIELDS = {
    "polarite":     "{model}_polarite",
    "centralite":   "{model}_centralite_islam_musulmans",
    "subjectivite": "{model}_subjectivite_score",
}

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
SUBJECTIVITE_BUCKETS = ["1", "2", "3", "4", "5"]

# Defaults for the related-articles and semantic-neighbour caps. Both
# are CLI-overridable. Twenty related-by-entities articles is plenty
# for a radial outer ring (any more and the network becomes a hairball);
# ten semantic neighbours is the "5–10 closest articles" the user
# explicitly asked for.
DEFAULT_TOP_K_RELATED = 20
DEFAULT_TOP_K_SEMANTIC = 10

# Shared-entity ids recorded inline per related article, for the tooltip
# "shares N entities: Djiguiba Cissé, Côte d'Ivoire, Hadj …". More than
# three would bloat the JSON without being readable in a tooltip.
SHARED_ENTITIES_SAMPLE_SIZE = 3

# Batch size for the kNN pass. 500 × 12,287 float32 = ~24 MB per batch,
# well inside cache on any reasonable dev machine but small enough to
# stream through rather than allocating a 144 M × 4 B = 576 MB square.
KNN_BATCH_SIZE = 500

# The index subset flags rows with Type == "Notices d'autorité" as
# bibliographic authority placeholders — we skip them when building the
# name lookup so they never appear as "entities" of an article.
AUTHORITY_PLACEHOLDER_TYPE = "Notices d'autorité"

logger: Optional[logging.Logger] = None


class ArticleDashboardGenerator:
    """Builds one JSON per article in the IWAC ``articles`` subset."""

    def __init__(
        self,
        output_dir: Path,
        limit: Optional[int] = None,
        repo_id: str = DATASET_ID,
        top_k_related: int = DEFAULT_TOP_K_RELATED,
        top_k_semantic: int = DEFAULT_TOP_K_SEMANTIC,
    ) -> None:
        self.output_dir = output_dir
        self.limit = limit
        self.repo_id = repo_id
        self.top_k_related = top_k_related
        self.top_k_semantic = top_k_semantic

        self.index_df: Optional[pd.DataFrame] = None
        self.articles_df: Optional[pd.DataFrame] = None

        # Built in later steps
        self.entity_lookup: Dict[str, Dict[str, Any]] = {}   # normalized name -> entity info
        self.id_to_entity: Dict[int, Dict[str, Any]] = {}     # entity o_id -> info
        self.lieux_coords: Dict[int, Tuple[float, float]] = {}  # Lieu o_id -> (lat, lng)

        # Article resolution. Keyed by article o_id (int), not by
        # subset-prefixed item_key — there's only one subset here.
        self.article_meta: Dict[int, Dict[str, Any]] = {}
        self.article_entities: Dict[int, Set[int]] = {}
        self.entity_articles: Dict[int, Set[int]] = {}

        # Article-o_id -> row index in self.articles_df, used to slice
        # into the embedding matrix for kNN.
        self.article_row_index: Dict[int, int] = {}
        self.embedding_matrix: Optional[np.ndarray] = None  # (N, 768) float32, L2-normalized
        self.valid_embedding_rows: Optional[np.ndarray] = None  # bool mask over articles_df

        # Target article ids, in deterministic order (articles_df row order).
        self.target_ids: List[int] = []

    # ------------------------------------------------------------------
    # Loaders
    # ------------------------------------------------------------------

    def load_index(self) -> None:
        logger.info("Loading index subset...")
        self.index_df = load_dataset_safe("index", repo_id=self.repo_id)
        if self.index_df is None or self.index_df.empty:
            raise RuntimeError("index subset returned empty — aborting")
        logger.info(f"  {len(self.index_df)} index entries")

    def load_articles(self) -> None:
        logger.info("Loading articles subset (includes embedding_OCR)...")
        self.articles_df = load_dataset_safe(ARTICLES_SUBSET, repo_id=self.repo_id)
        if self.articles_df is None or self.articles_df.empty:
            raise RuntimeError("articles subset returned empty — aborting")
        logger.info(f"  {len(self.articles_df)} articles")

    # ------------------------------------------------------------------
    # Entity lookup — ported from EntityDashboardGenerator.build_entity_lookup
    # ------------------------------------------------------------------

    def build_entity_lookup(self) -> None:
        """Populate ``entity_lookup`` (name -> entity info), ``id_to_entity``,
        and ``lieux_coords``. Same rules as entity_dashboards: NFC-normalize
        the title, also index every ``Titre alternatif`` alias, cache Lieu
        coordinates for the spatial map.
        """
        df = self.index_df
        id_col = find_column(df, ["o:id", "id"])
        title_col = find_column(df, ["Titre", "dcterms:title"])
        type_col = find_column(df, ["Type"])
        if not (id_col and title_col and type_col):
            raise RuntimeError(
                f"index subset missing required columns: id={id_col}, "
                f"title={title_col}, type={type_col}"
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
            if not entity_type or entity_type == AUTHORITY_PLACEHOLDER_TYPE:
                continue

            title = str(row.get(title_col) or "").strip()
            if not title:
                continue

            info = {"o_id": o_id, "title": title, "type": entity_type}

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
                    self.lieux_coords[o_id] = (coords[0], coords[1])

        logger.info(
            f"Entity lookup: {len(self.entity_lookup)} name keys, "
            f"{len(self.id_to_entity)} entities, {len(self.lieux_coords)} geocoded places"
        )

    # ------------------------------------------------------------------
    # Article metadata + entity resolution
    # ------------------------------------------------------------------

    def resolve_articles(self) -> None:
        """For every article row: cache a small metadata dict and resolve
        ``subject`` + ``spatial`` into a set of index entity o_ids. Also
        record each article's positional row index so the kNN step can
        slice into the embedding matrix.
        """
        df = self.articles_df

        id_col        = find_column(df, ["o:id", "id"])
        title_col     = find_column(df, ["Titre", "dcterms:title", "title"])
        date_col      = find_column(df, ["pub_date", "dcterms:date"])
        country_col   = find_column(df, ["country", "countries"])
        newspaper_col = find_column(df, ["newspaper", "dcterms:publisher", "source"])
        language_col  = find_column(df, ["language", "dcterms:language"])
        subject_col   = find_column(df, ["subject", "dcterms:subject"])
        spatial_col   = find_column(df, ["spatial", "dcterms:spatial", "Couverture spatiale"])
        nb_mots_col   = find_column(df, ["nb_mots", "word_count"])
        richesse_col  = find_column(df, ["Richesse_Lexicale_OCR", "lexical_richness"])
        lisibilite_col= find_column(df, ["Lisibilite_OCR", "readability"])
        nb_pages_col  = find_column(df, ["nb_pages", "pages"])
        lda_label_col = find_column(df, ["lda_topic_label", "lda_topic"])

        if not id_col:
            raise RuntimeError("articles subset has no o:id column")

        # Resolve sentiment column names ONCE; re-resolving per row would
        # be wasteful and makes missing columns silently degrade to empty
        # buckets with no retry cost at row time.
        sentiment_cols: Dict[str, Dict[str, Optional[str]]] = {}
        for model in SENTIMENT_MODELS:
            sentiment_cols[model] = {}
            for axis, template in SENTIMENT_FIELDS.items():
                col = template.format(model=model)
                sentiment_cols[model][axis] = col if col in df.columns else None

        for row_idx, row in df.iterrows():
            raw_id = row.get(id_col)
            try:
                article_id = int(raw_id)
            except (TypeError, ValueError):
                continue

            self.article_row_index[article_id] = int(row_idx)

            self.article_meta[article_id] = {
                "o_id":              article_id,
                "title":             clean_str(row.get(title_col)) if title_col else "",
                "pub_date":          clean_str(row.get(date_col))[:10] if date_col else "",
                "country":           self._first_country(row.get(country_col)) if country_col else "",
                "newspaper":         clean_str(row.get(newspaper_col)) if newspaper_col else "",
                "language":          clean_str(row.get(language_col)) if language_col else "",
                "word_count":        self._coerce_int(row.get(nb_mots_col)) if nb_mots_col else None,
                "lexical_richness":  self._coerce_float(row.get(richesse_col)) if richesse_col else None,
                "readability":       self._coerce_float(row.get(lisibilite_col)) if lisibilite_col else None,
                "nb_pages":          self._coerce_int(row.get(nb_pages_col)) if nb_pages_col else None,
                "lda_label":         clean_str(row.get(lda_label_col)) if lda_label_col else "",
                # Sentiment captured raw per model — reshape later.
                "_sentiment_raw":    self._pick_sentiment(row, sentiment_cols),
            }

            refs: Set[int] = set()
            if subject_col:
                for name in parse_pipe_separated(row.get(subject_col)):
                    entity = self.entity_lookup.get(normalize_location_name(name))
                    if entity:
                        refs.add(entity["o_id"])
            if spatial_col:
                for name in parse_pipe_separated(row.get(spatial_col)):
                    entity = self.entity_lookup.get(normalize_location_name(name))
                    if entity:
                        refs.add(entity["o_id"])

            if refs:
                self.article_entities[article_id] = refs
                for entity_id in refs:
                    self.entity_articles.setdefault(entity_id, set()).add(article_id)

        self.target_ids = list(self.article_meta.keys())
        logger.info(
            f"Resolved {len(self.article_meta)} articles; "
            f"{len(self.article_entities)} carry at least one entity; "
            f"{len(self.entity_articles)} distinct entities observed"
        )

    @staticmethod
    def _first_country(value: Any) -> str:
        countries = normalize_country(value, return_list=True)
        if isinstance(countries, list) and countries:
            first = countries[0].strip()
            return first if first and first.lower() != "unknown" else ""
        return ""

    @staticmethod
    def _coerce_int(value: Any) -> Optional[int]:
        f = clean_float(value)
        return int(f) if f is not None else None

    @staticmethod
    def _coerce_float(value: Any) -> Optional[float]:
        f = clean_float(value)
        return round(f, 4) if f is not None else None

    @staticmethod
    def _pick_sentiment(
        row: pd.Series,
        sentiment_cols: Dict[str, Dict[str, Optional[str]]],
    ) -> Dict[str, Dict[str, Any]]:
        """Capture the 3-model sentiment tuple for one article.

        Returns::

            {
                "gemini":  {"polarite": "Positif", "centralite": "Très central",
                            "subjectivite": 3.0},
                "chatgpt": {...},
                "mistral": {...},
            }

        Missing columns collapse to empty strings / None so the reshape
        step can tell "not rated" apart from "rated but with no value".
        """
        out: Dict[str, Dict[str, Any]] = {}
        for model, cols in sentiment_cols.items():
            polarite     = clean_str(row.get(cols["polarite"]))      if cols["polarite"]     else ""
            centralite   = clean_str(row.get(cols["centralite"]))    if cols["centralite"]   else ""
            subjectivite = clean_float(row.get(cols["subjectivite"])) if cols["subjectivite"] else None
            out[model] = {
                "polarite":     polarite,
                "centralite":   centralite,
                "subjectivite": subjectivite,
            }
        return out

    # ------------------------------------------------------------------
    # Semantic kNN (embedding_OCR cosine similarity)
    # ------------------------------------------------------------------

    def build_embedding_matrix(self) -> None:
        """Stack ``embedding_OCR`` into an (N, 768) float32 matrix and
        L2-normalize rows. Rows with missing / all-zero / wrong-dim
        embeddings are flagged in ``valid_embedding_rows`` so the kNN
        step can skip them cleanly and emit an empty neighbour list
        instead of garbage.
        """
        df = self.articles_df
        embed_col = find_column(df, ["embedding_OCR", "embedding"])
        if not embed_col:
            logger.warning(
                "No embedding_OCR column in articles subset — "
                "semantic neighbours will be empty for every article."
            )
            self.embedding_matrix = None
            self.valid_embedding_rows = np.zeros(len(df), dtype=bool)
            return

        N = len(df)
        dim: Optional[int] = None
        rows: List[np.ndarray] = []
        valid = np.zeros(N, dtype=bool)

        for i, value in enumerate(df[embed_col].values):
            vec = self._coerce_embedding(value)
            if vec is None:
                rows.append(np.zeros(1, dtype=np.float32))  # placeholder, replaced below
                continue
            if dim is None:
                dim = len(vec)
            elif len(vec) != dim:
                # Dimension mismatch — skip this row (shouldn't happen
                # on the curated dataset, but defensive anyway)
                rows.append(np.zeros(1, dtype=np.float32))
                continue
            rows.append(vec)
            valid[i] = True

        if dim is None:
            logger.warning("embedding_OCR column contained no usable vectors")
            self.embedding_matrix = None
            self.valid_embedding_rows = valid
            return

        # Replace placeholders with zero vectors of the right dimension.
        # Zero vectors have norm 0; we L2-normalize with a safe fallback
        # that leaves them zero, so their cosine similarity to anything
        # is 0 and they never surface as neighbours.
        X = np.zeros((N, dim), dtype=np.float32)
        for i, vec in enumerate(rows):
            if valid[i] and len(vec) == dim:
                X[i] = vec

        norms = np.linalg.norm(X, axis=1, keepdims=True)
        # Avoid divide-by-zero on invalid rows; they stay all-zero.
        safe_norms = np.where(norms == 0.0, 1.0, norms)
        X = X / safe_norms
        # But re-zero the rows that were invalid, so dot products are zero.
        X[~valid] = 0.0

        self.embedding_matrix = X
        self.valid_embedding_rows = valid
        logger.info(
            f"Embedding matrix: {N} rows × {dim} dims, "
            f"{int(valid.sum())} valid, "
            f"{N - int(valid.sum())} missing/invalid"
        )

    @staticmethod
    def _coerce_embedding(value: Any) -> Optional[np.ndarray]:
        """Coerce a raw embedding cell to a float32 numpy vector.

        Datasets library returns list[float] for sequence columns, but
        older parquet reads may yield numpy arrays directly. Handle
        both without casting a known-good vector twice.
        """
        if value is None:
            return None
        if isinstance(value, np.ndarray):
            if value.size == 0 or not np.isfinite(value).all():
                return None
            return value.astype(np.float32, copy=False)
        if isinstance(value, (list, tuple)):
            if not value:
                return None
            try:
                arr = np.asarray(value, dtype=np.float32)
            except (TypeError, ValueError):
                return None
            if arr.size == 0 or not np.isfinite(arr).all():
                return None
            return arr
        # Unknown type (e.g. pandas NaN float) → treat as missing.
        return None

    def compute_semantic_neighbors(self) -> Dict[int, List[Dict[str, Any]]]:
        """Top-K cosine neighbours per valid row, computed in batches.

        Returns dict keyed by article o_id mapping to a list of neighbour
        dicts ``[{"o_id", "title", "newspaper", "date", "similarity"}]``.
        Invalid rows (no embedding) get an empty list.
        """
        result: Dict[int, List[Dict[str, Any]]] = {aid: [] for aid in self.target_ids}
        if self.embedding_matrix is None:
            return result

        X = self.embedding_matrix
        valid = self.valid_embedding_rows
        N = X.shape[0]
        K = self.top_k_semantic

        # Row index -> article id (reverse map to turn neighbour row
        # indices back into article o_ids at the end)
        row_to_id: Dict[int, int] = {
            row_idx: article_id
            for article_id, row_idx in self.article_row_index.items()
        }

        for start in range(0, N, KNN_BATCH_SIZE):
            end = min(start + KNN_BATCH_SIZE, N)
            batch = X[start:end]                 # (B, 768)
            sims = batch @ X.T                   # (B, N)

            # Zero out self-similarity for every row in the batch
            for local_i in range(end - start):
                global_i = start + local_i
                sims[local_i, global_i] = -np.inf

            # argpartition is O(N) per row and gives the indices of the
            # top-K (unordered); then a tiny sort within K lands them
            # in descending similarity order for display.
            # Guard against N < K (shouldn't happen on 12k rows, but
            # keeps the logic safe on tiny smoke-test runs).
            k_eff = min(K, sims.shape[1] - 1)
            if k_eff <= 0:
                continue
            part_idx = np.argpartition(-sims, k_eff, axis=1)[:, :k_eff]
            part_sims = np.take_along_axis(sims, part_idx, axis=1)
            order = np.argsort(-part_sims, axis=1)
            top_idx = np.take_along_axis(part_idx, order, axis=1)
            top_sims = np.take_along_axis(part_sims, order, axis=1)

            for local_i in range(end - start):
                global_i = start + local_i
                if not valid[global_i]:
                    continue
                article_id = row_to_id.get(global_i)
                if article_id is None:
                    continue
                neighbours: List[Dict[str, Any]] = []
                for rank in range(k_eff):
                    neigh_row = int(top_idx[local_i, rank])
                    sim = float(top_sims[local_i, rank])
                    if sim <= 0.0 or not valid[neigh_row]:
                        continue
                    neigh_id = row_to_id.get(neigh_row)
                    if neigh_id is None:
                        continue
                    meta = self.article_meta.get(neigh_id)
                    if not meta:
                        continue
                    neighbours.append({
                        "o_id":       neigh_id,
                        "title":      meta.get("title", ""),
                        "newspaper":  meta.get("newspaper", ""),
                        "date":       meta.get("pub_date", ""),
                        "similarity": round(sim, 4),
                    })
                result[article_id] = neighbours

            if (start // KNN_BATCH_SIZE) % 5 == 0:
                logger.info(
                    f"  kNN batch {start // KNN_BATCH_SIZE + 1} / "
                    f"{(N + KNN_BATCH_SIZE - 1) // KNN_BATCH_SIZE}"
                )

        n_with_neighbours = sum(1 for v in result.values() if v)
        logger.info(
            f"Semantic neighbours computed for {n_with_neighbours}/{len(result)} articles"
        )
        return result

    # ------------------------------------------------------------------
    # Related-by-shared-entities
    # ------------------------------------------------------------------

    def compute_related_articles(self, article_id: int) -> List[Dict[str, Any]]:
        """Top K other articles ranked by number of entities they share
        with ``article_id``. Each result carries the shared count plus
        up to ``SHARED_ENTITIES_SAMPLE_SIZE`` shared-entity o_ids so the
        UI tooltip can list "shares: X, Y, Z".
        """
        entities_here = self.article_entities.get(article_id, set())
        if not entities_here:
            return []

        # For each entity of this article, every OTHER article mentioning
        # that entity gets one "share point". Most expensive step in the
        # generator but still O(Σ_e |articles_for_e|) ≈ linear in total
        # mentions, which is bounded.
        shared_counter: Counter = Counter()
        shared_entities: Dict[int, List[int]] = {}
        for entity_id in entities_here:
            for other_id in self.entity_articles.get(entity_id, ()):
                if other_id == article_id:
                    continue
                shared_counter[other_id] += 1
                bucket = shared_entities.setdefault(other_id, [])
                if len(bucket) < SHARED_ENTITIES_SAMPLE_SIZE:
                    bucket.append(entity_id)

        top = shared_counter.most_common(self.top_k_related)
        results: List[Dict[str, Any]] = []
        for other_id, count in top:
            meta = self.article_meta.get(other_id)
            if not meta:
                continue
            results.append({
                "o_id":         other_id,
                "title":        meta.get("title", ""),
                "newspaper":    meta.get("newspaper", ""),
                "date":         meta.get("pub_date", ""),
                "shared_count": int(count),
                "shared":       shared_entities.get(other_id, []),
            })
        return results

    # ------------------------------------------------------------------
    # Sentiment reshape — mirror the aggregated histogram contract
    # ------------------------------------------------------------------

    @staticmethod
    def _reshape_sentiment(raw: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        """Turn a single article's 3-model raw sentiment into the same
        bucket-histogram shape that the aggregate panel expects.

        For each model, emit ``count=1`` in the one bucket this article
        landed in, 0 elsewhere. Missing values simply don't populate any
        bucket, so the panel renders an empty state.
        """
        by_model: Dict[str, Any] = {}
        for model in SENTIMENT_MODELS:
            slice_raw = raw.get(model, {}) or {}
            polarite = slice_raw.get("polarite") or ""
            centralite = slice_raw.get("centralite") or ""
            subjectivite = slice_raw.get("subjectivite")

            # Build each histogram with count=1 in the matching bucket,
            # 0 elsewhere. Preserves the canonical IWAC ordering.
            pol_hist = [
                {"name": name, "count": 1 if name == polarite else 0}
                for name in POLARITE_ORDER
            ]
            # Drop trailing zero buckets on polarite/centralite for
            # parity with the aggregate generator's trimming. Keeps the
            # JSON compact while leaving the panel's render logic
            # unchanged.
            while pol_hist and pol_hist[-1]["count"] == 0 and pol_hist[-1]["name"] not in (polarite,):
                pol_hist.pop()

            cen_hist = [
                {"name": name, "count": 1 if name == centralite else 0}
                for name in CENTRALITE_ORDER
            ]
            while cen_hist and cen_hist[-1]["count"] == 0 and cen_hist[-1]["name"] not in (centralite,):
                cen_hist.pop()

            sub_bucket = None
            if subjectivite is not None:
                sub_bucket = str(max(1, min(5, int(round(float(subjectivite))))))
            sub_hist = [
                {"name": name, "count": 1 if name == sub_bucket else 0}
                for name in SUBJECTIVITE_BUCKETS
            ]

            rated = bool(polarite or centralite or subjectivite is not None)
            by_model[model] = {
                "polarite":         pol_hist,
                "centralite":       cen_hist,
                "subjectivite":     sub_hist,
                "subjectivite_avg": (round(float(subjectivite), 2) if subjectivite is not None else None),
                "rated_articles":   1 if rated else 0,
            }
        return {
            "models":          list(SENTIMENT_MODELS),
            "by_model":        by_model,
            "articles_total":  1,
        }

    # ------------------------------------------------------------------
    # Spatial pins + entities list for the network
    # ------------------------------------------------------------------

    def build_entities_list(self, article_id: int) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Return (entities, spatial_pins) for the article.

        ``entities`` is the full list of resolved index entries (o_id,
        title, type) used to build the inner ring of the context graph.
        ``spatial_pins`` is the subset of those that are Lieux with
        parseable coordinates — consumed by the mini MapLibre panel.
        """
        entities: List[Dict[str, Any]] = []
        spatial: List[Dict[str, Any]] = []
        seen: Set[int] = set()

        for entity_id in self.article_entities.get(article_id, ()):
            if entity_id in seen:
                continue
            seen.add(entity_id)
            info = self.id_to_entity.get(entity_id)
            if not info:
                continue
            entities.append({
                "o_id":  entity_id,
                "title": info["title"],
                "type":  info["type"],
            })
            if entity_id in self.lieux_coords:
                lat, lng = self.lieux_coords[entity_id]
                spatial.append({
                    "o_id": entity_id,
                    "name": info["title"],
                    "lat":  lat,
                    "lng":  lng,
                })

        # Sort entities by type then title so the network has a
        # deterministic inner ring order — easier to debug and makes
        # screenshots stable between runs.
        entities.sort(key=lambda e: (e["type"], e["title"]))
        spatial.sort(key=lambda s: s["name"])
        return entities, spatial

    # ------------------------------------------------------------------
    # Per-article assembly + fan-out
    # ------------------------------------------------------------------

    def build_article_json(
        self,
        article_id: int,
        semantic_neighbours: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        meta = self.article_meta[article_id]
        entities, spatial = self.build_entities_list(article_id)
        related = self.compute_related_articles(article_id)
        sentiment = self._reshape_sentiment(meta.get("_sentiment_raw") or {})

        # Compact article header — the raw sentiment stash is stripped
        # out; it was only used during reshape.
        article_block = {
            "o_id":             meta["o_id"],
            "title":            meta.get("title", ""),
            "newspaper":        meta.get("newspaper", ""),
            "country":          meta.get("country", ""),
            "pub_date":         meta.get("pub_date", ""),
            "language":         meta.get("language", ""),
            "word_count":       meta.get("word_count"),
            "lexical_richness": meta.get("lexical_richness"),
            "readability":      meta.get("readability"),
            "nb_pages":         meta.get("nb_pages"),
            "lda_label":        meta.get("lda_label", ""),
        }

        return {
            "version":             1,
            "generated_at":        datetime.now(timezone.utc).isoformat(),
            "article":             article_block,
            "entities":            entities,
            "spatial":             spatial,
            "sentiment":           sentiment,
            "related_by_entities": related,
            "semantic_neighbors":  semantic_neighbours,
        }

    def generate_all(self) -> int:
        """Compute the kNN once up-front, then stream one JSON per
        article. Writing ~12k files at once is I/O-bound — we log
        progress every 500 files so long runs stay interactive.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.build_embedding_matrix()
        semantic_map = self.compute_semantic_neighbors()

        targets = self.target_ids
        if self.limit:
            targets = targets[: self.limit]

        written = 0
        for article_id in targets:
            data = self.build_article_json(
                article_id,
                semantic_neighbours=semantic_map.get(article_id, []),
            )
            out_path = self.output_dir / f"{article_id}.json"
            save_json(data, out_path, minify=True, log=False)
            written += 1
            if written % 500 == 0:
                logger.info(f"  {written} article JSONs written")
        logger.info(f"Done — {written} article JSONs written to {self.output_dir}")
        return written


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "asset" / "data" / "article-dashboards",
        help="Where to write per-article JSON files (default: %(default)s)",
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
        help="Only process the first N articles (smoke test). 0 or unset = all.",
    )
    parser.add_argument(
        "--top-k-related",
        type=int,
        default=DEFAULT_TOP_K_RELATED,
        help="Related-by-entities cap per article (default: %(default)s)",
    )
    parser.add_argument(
        "--top-k-semantic",
        type=int,
        default=DEFAULT_TOP_K_SEMANTIC,
        help="Semantic-neighbours cap per article (default: %(default)s)",
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

    gen = ArticleDashboardGenerator(
        output_dir=args.output_dir,
        limit=args.limit if args.limit and args.limit > 0 else None,
        repo_id=args.repo,
        top_k_related=args.top_k_related,
        top_k_semantic=args.top_k_semantic,
    )

    gen.load_index()
    gen.load_articles()
    gen.build_entity_lookup()
    gen.resolve_articles()
    written = gen.generate_all()
    logger.info(f"Finished: {written} article dashboards emitted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
