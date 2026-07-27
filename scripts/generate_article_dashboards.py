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
    * ``related_by_entities`` — top-K articles that share the most
                                entities with this one (shared-entity
                                count; up to 3 shared-entity o_ids
                                inlined for the tooltip)
    * ``semantic_neighbors``  — top-K articles by cosine similarity of
                                ``embedding_OCR`` (768-dim Gemini)
    * ``related_scholarship`` — top-K works from the ``references``
                                subset by cosine similarity, across
                                subsets in the one shared embedding
                                space. Absent (not empty) when the
                                references carry no embeddings, which is
                                how the panel knows to elide itself.

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

from iwac_embeddings import build_normalized_matrix
from iwac_utils import (
    DATASET_ID,
    clean_float,
    clean_str,
    configure_logging,
    find_column,
    load_dataset_safe,
    normalize_country,
    normalize_location_name,
    parse_coordinates,
    parse_pipe_separated,
    save_json,
)

# Per-article dashboards are about the NEWSPAPER article as a unit, so
# they don't aggregate other subsets — with one deliberate exception since
# 2026-07. The `references` subset now carries `embedding_OCR` from the
# same `gemini-embedding-2` model as the articles, in the same 768-dim
# space, which makes "which scholarship resembles this newspaper article"
# a plain cosine lookup across the two subsets. That is a question this
# archive is unusually well placed to answer — a press corpus and its own
# secondary literature, in one embedding space — so the bridge is worth
# the extra load.
ARTICLES_SUBSET = "articles"
REFERENCES_SUBSET = "references"

# Sentiment intentionally NOT precomputed here. v0.11.0+ the article
# dashboard renders its sentiment panel server-side from Omeka item
# metadata (iwac:<model><Axis>) via
# `IwacVisualizations\Site\ResourcePageBlockLayout\SentimentExtractor`.
# Reading at render-time keeps the dashboard in sync with editorial
# changes on islam.zmo.de without waiting for a regenerator pass, so
# there's no value in duplicating the data in the JSON.

# Defaults for the related-articles and semantic-neighbour caps. Both
# are CLI-overridable. Twenty related-by-entities articles is plenty
# for a radial outer ring (any more and the network becomes a hairball);
# ten semantic neighbours is the "5–10 closest articles" the user
# explicitly asked for.
DEFAULT_TOP_K_RELATED = 20
DEFAULT_TOP_K_SEMANTIC = 10

# Scholarly works surfaced per article. Kept smaller than the semantic
# neighbour list: only ~423 of 867 references have extracted text, so the
# candidate pool is two orders of magnitude smaller than the article pool
# and a long list would pad itself with weak matches.
DEFAULT_TOP_K_SCHOLARSHIP = 5

# A reference appearing in more than this share of articles' scholarship
# lists is reported as a hub. Chunk-averaged embeddings of long documents
# drift toward the corpus centroid, so a broad survey can end up "most
# similar" to almost everything — a known artefact of averaging, not a
# finding about the survey. This only warns; it does not filter, because
# the right threshold depends on a distribution we can only see once the
# generator has run against the real data.
SCHOLARSHIP_HUB_SHARE = 0.25

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
        top_k_scholarship: int = DEFAULT_TOP_K_SCHOLARSHIP,
        scholarship_min_similarity: float = 0.0,
        minify: bool = True,
    ) -> None:
        self.output_dir = output_dir
        self.limit = limit
        self.repo_id = repo_id
        self.top_k_related = top_k_related
        self.top_k_semantic = top_k_semantic
        self.top_k_scholarship = top_k_scholarship
        self.scholarship_min_similarity = scholarship_min_similarity
        self.minify = minify

        self.index_df: Optional[pd.DataFrame] = None
        self.articles_df: Optional[pd.DataFrame] = None
        self.references_df: Optional[pd.DataFrame] = None
        # (M, 768) L2-normalized reference embeddings + the metadata rows
        # they correspond to, in matrix order.
        self.reference_matrix: Optional[np.ndarray] = None
        self.reference_meta: List[Dict[str, Any]] = []

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

    def load_references(self) -> None:
        """Load the bibliography's embeddings for the cross-corpus lookup.

        Optional by design: a missing subset, a missing column or a pipeline
        that has not embedded the references yet all degrade to "no
        scholarship suggestions" rather than failing the whole 12k-file
        generation run.
        """
        logger.info("Loading references subset for cross-corpus scholarship links...")
        df = load_dataset_safe(
            REFERENCES_SUBSET,
            repo_id=self.repo_id,
            columns=["o:id", "title", "author", "pub_date", "o:resource_class",
                     "doi", "URL", "embedding_OCR"],
        )
        if df is None or df.empty:
            logger.warning("  references subset unavailable — scholarship links skipped")
            return
        if "embedding_OCR" not in df.columns:
            logger.warning("  references subset has no embedding_OCR — scholarship links skipped")
            return

        self.references_df = df
        matrix, valid_rows = build_normalized_matrix(df, "embedding_OCR")
        if matrix.shape[0] == 0:
            logger.warning("  no usable reference embeddings — scholarship links skipped")
            self.reference_matrix = None
            return

        self.reference_matrix = matrix
        self.reference_meta = []
        for row_position in valid_rows:
            row = df.iloc[row_position]
            authors = [a for a in parse_pipe_separated(row.get("author")) if a]
            entry: Dict[str, Any] = {
                "o_id":  clean_str(row.get("o:id")),
                "title": clean_str(row.get("title")),
                "type":  clean_str(row.get("o:resource_class")),
                "date":  clean_str(row.get("pub_date"))[:10],
            }
            if authors:
                entry["authors"] = authors[:3]
            doi = clean_str(row.get("doi"))
            if doi:
                entry["doi"] = doi
            self.reference_meta.append(entry)

        logger.info(
            "  %d of %d references carry a usable embedding",
            matrix.shape[0], len(df),
        )

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
        thumbnail_col = find_column(df, ["thumbnail"])

        if not id_col:
            raise RuntimeError("articles subset has no o:id column")

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
                # Medium-size thumbnail URL (public on islam.zmo.de) —
                # used by the related + semantic cards on the front-end.
                "thumbnail":         clean_str(row.get(thumbnail_col)) if thumbnail_col else "",
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
                        "country":    meta.get("country", ""),
                        "date":       meta.get("pub_date", ""),
                        "thumbnail":  meta.get("thumbnail", ""),
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
    # Cross-corpus scholarship (articles × references, one embedding space)
    # ------------------------------------------------------------------

    def compute_scholarship_neighbors(self) -> Dict[int, List[Dict[str, Any]]]:
        """Top-K scholarly works per article, by cosine similarity.

        Both sides are ``gemini-embedding-2`` vectors of the same
        dimensionality, so the dot product is meaningful across subsets —
        but the two are not symmetric in character, and the panel copy says
        so. An article embeds one short news text; a reference embeds a book
        or thesis whose chunks were averaged, which pulls long documents
        toward the corpus centroid. The consequence to watch for is hub
        formation: a broad survey can come out "most similar" to nearly
        everything. This method reports the share of articles each reference
        appears for and warns above ``SCHOLARSHIP_HUB_SHARE`` rather than
        silently filtering, since the right cut-off depends on a
        distribution only visible once this has run on the real data.
        """
        result: Dict[int, List[Dict[str, Any]]] = {aid: [] for aid in self.target_ids}
        if self.embedding_matrix is None or self.reference_matrix is None:
            return result
        if self.reference_matrix.shape[1] != self.embedding_matrix.shape[1]:
            logger.warning(
                "Embedding dimensionality differs (articles %d, references %d) — "
                "refusing to compare across subsets",
                self.embedding_matrix.shape[1], self.reference_matrix.shape[1],
            )
            return result

        X = self.embedding_matrix
        R = self.reference_matrix
        valid = self.valid_embedding_rows
        N = X.shape[0]
        K = min(self.top_k_scholarship, R.shape[0])
        if K <= 0:
            return result

        row_to_id: Dict[int, int] = {
            row_idx: article_id
            for article_id, row_idx in self.article_row_index.items()
        }

        hits: Counter = Counter()          # reference row -> articles it surfaced for
        similarities: List[float] = []      # top-1 similarity per article, for the log

        for start in range(0, N, KNN_BATCH_SIZE):
            end = min(start + KNN_BATCH_SIZE, N)
            sims = X[start:end] @ R.T       # (B, M) — no self-similarity to mask

            k_eff = min(K, sims.shape[1])
            part_idx = np.argpartition(-sims, k_eff - 1, axis=1)[:, :k_eff]
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
                works: List[Dict[str, Any]] = []
                for rank in range(k_eff):
                    ref_row = int(top_idx[local_i, rank])
                    sim = float(top_sims[local_i, rank])
                    if sim <= 0.0 or sim < self.scholarship_min_similarity:
                        continue
                    meta = self.reference_meta[ref_row]
                    if not meta.get("o_id"):
                        continue
                    works.append(dict(meta, similarity=round(sim, 4)))
                    hits[ref_row] += 1
                if works:
                    result[article_id] = works
                    similarities.append(works[0]["similarity"])

        n_with = sum(1 for v in result.values() if v)
        logger.info(
            "Scholarship links computed for %d/%d articles", n_with, len(result)
        )
        if similarities:
            ordered = sorted(similarities)
            logger.info(
                "  top-1 similarity: median %.3f, p10 %.3f, p90 %.3f, max %.3f "
                "(tune --scholarship-min-similarity from this)",
                ordered[len(ordered) // 2],
                ordered[int(len(ordered) * 0.10)],
                ordered[int(len(ordered) * 0.90)],
                ordered[-1],
            )
        if n_with:
            for ref_row, count in hits.most_common(3):
                share = count / n_with
                if share < SCHOLARSHIP_HUB_SHARE:
                    break
                logger.warning(
                    "  hub reference: '%s' surfaces for %.0f%% of articles — likely an "
                    "artefact of chunk-averaging a long text, not a real affinity",
                    (self.reference_meta[ref_row].get("title") or "?")[:70],
                    share * 100,
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
                "country":      meta.get("country", ""),
                "date":         meta.get("pub_date", ""),
                "thumbnail":    meta.get("thumbnail", ""),
                "shared_count": int(count),
                "shared":       shared_entities.get(other_id, []),
            })
        return results

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
        scholarship: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        meta = self.article_meta[article_id]
        entities, spatial = self.build_entities_list(article_id)
        related = self.compute_related_articles(article_id)

        # Compact article header — feeds the client-side stats panel.
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
            "thumbnail":        meta.get("thumbnail", ""),
        }

        payload = {
            "version":             2,
            "generated_at":        datetime.now(timezone.utc).isoformat(),
            "article":             article_block,
            "entities":            entities,
            "spatial":             spatial,
            "related_by_entities": related,
            "semantic_neighbors":  semantic_neighbours,
        }
        # Omitted rather than emitted empty: the key's absence is how the
        # panel knows to elide itself, which is also the correct state when
        # the references have no embeddings yet.
        if scholarship:
            payload["related_scholarship"] = scholarship
        return payload

    def generate_all(self) -> int:
        """Compute the kNN once up-front, then stream one JSON per
        article. Writing ~12k files at once is I/O-bound — we log
        progress every 500 files so long runs stay interactive.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.build_embedding_matrix()
        semantic_map = self.compute_semantic_neighbors()
        scholarship_map = self.compute_scholarship_neighbors()

        targets = self.target_ids
        if self.limit:
            targets = targets[: self.limit]

        written = 0
        for article_id in targets:
            data = self.build_article_json(
                article_id,
                semantic_neighbours=semantic_map.get(article_id, []),
                scholarship=scholarship_map.get(article_id, []),
            )
            out_path = self.output_dir / f"{article_id}.json"
            save_json(data, out_path, minify=self.minify, log=False)
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
        "--top-k-scholarship",
        type=int,
        default=DEFAULT_TOP_K_SCHOLARSHIP,
        help="Scholarly works (references subset) linked per article "
             "(default: %(default)s; 0 disables the cross-corpus pass)",
    )
    parser.add_argument(
        "--scholarship-min-similarity",
        type=float,
        default=0.0,
        help="Drop scholarship links below this cosine similarity. Default 0 "
             "reports every positive match and logs the similarity "
             "distribution; set a floor once you have seen it (default: %(default)s)",
    )
    parser.add_argument(
        "--minify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Minify the per-article JSON files (default: %(default)s)",
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
        top_k_scholarship=args.top_k_scholarship,
        scholarship_min_similarity=args.scholarship_min_similarity,
        minify=args.minify,
    )

    gen.load_index()
    gen.load_articles()
    if args.top_k_scholarship > 0:
        gen.load_references()
    gen.build_entity_lookup()
    gen.resolve_articles()
    written = gen.generate_all()
    logger.info(f"Finished: {written} article dashboards emitted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
