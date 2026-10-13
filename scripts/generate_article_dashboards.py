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
                                ``embedding_OCR`` (768-dim
                                ``google/embeddinggemma-2``), read from
                                the dataset's own ``related_articles``
                                lists rather than recomputed; computed
                                here only for rows upstream left without
                                a list
    * ``related_scholarship`` — top-K works from the ``references``
                                subset by cosine similarity between
                                this article's text and each work's
                                ``embedding_abstract``, in the one
                                shared embedding space. Only works with
                                an abstract can appear. Absent (not
                                empty) when the
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
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

import numpy as np
import pandas as pd

from iwac_embeddings import (
    EMBEDDING_COLUMNS,
    RELATED_COLUMN,
    build_normalized_matrix,
    coerce_embedding,
    parse_related,
    rank_neighbours,
)
from iwac_utils import (
    expect_item_outputs,
    add_standard_args,
    DATASET_ID,
    build_entity_index,
    clean_float,
    clean_str,
    configure_logging,
    find_column,
    first_country,
    iter_records,
    load_dataset_safe,
    normalize_location_name,
    parse_pipe_separated,
    save_json,
)

# Per-article dashboards are about the NEWSPAPER article as a unit, so
# they don't aggregate other subsets — with one deliberate exception since
# 2026-07. The `references` subset carries an embedding from the same
# model as the articles (`google/embeddinggemma-2` since 2026-10-13), in
# the same 768-dim space, which makes "which scholarship resembles this
# newspaper article" a plain cosine lookup across the two subsets. Since
# that date the reference side embeds title + abstract
# (`embedding_abstract`) rather than full text: an article's text against
# a work's abstract is still a same-space comparison, and an abstract is
# a better summary of what a work argues than an average of its chunks. That is a question this
# archive is unusually well placed to answer — a press corpus and its own
# secondary literature, in one embedding space — so the bridge is worth
# the extra load.
ARTICLES_SUBSET = "articles"
REFERENCES_SUBSET = "references"
REFERENCES_EMBEDDING = EMBEDDING_COLUMNS[REFERENCES_SUBSET]

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
# explicitly asked for, and also the length of upstream's
# `related_articles` lists — a larger cap lengthens only the lists
# computed here, never the precomputed ones.
DEFAULT_TOP_K_RELATED = 20
DEFAULT_TOP_K_SEMANTIC = 10

# Scholarly works surfaced per article. Kept smaller than the semantic
# neighbour list: only ~442 of 867 references have an abstract, so the
# candidate pool is two orders of magnitude smaller than the article pool
# and a long list would pad itself with weak matches.
DEFAULT_TOP_K_SCHOLARSHIP = 5

# A reference appearing in more than this share of articles' scholarship
# lists is reported as a hub. The Gemini-era vectors embedded each work's
# full text, and chunk-averaged embeddings of long documents drift toward
# the corpus centroid, so a broad survey could end up "most similar" to
# almost everything. Abstracts are short and should hub less, but a
# general-audience abstract can still sit near the centroid, so the check
# and the correction stay. Since v1.24.1 the centering correction below is
# supposed to prevent this, so a warning here now means the correction was
# not strong enough rather than that no correction exists.
SCHOLARSHIP_HUB_SHARE = 0.25

# Strength of the hubness penalty: each reference's score is reduced by
# this multiple of its mean cosine across the whole article corpus. 1.0 is
# full centering, which is what the literature uses and what the planted-hub
# test needs to displace a hub while leaving specialists on top. 0 disables
# the correction, restoring the raw-cosine behaviour of v1.24.0.
SCHOLARSHIP_HUBNESS_WEIGHT = 1.0

# Shared-entity ids recorded inline per related article, for the tooltip
# "shares N entities: Djiguiba Cissé, Côte d'Ivoire, Hadj …". More than
# three would bloat the JSON without being readable in a tooltip.
SHARED_ENTITIES_SAMPLE_SIZE = 3

# Batch size for the kNN passes (the fallback neighbours and the
# scholarship scan). 500 × 16,715 float32 = ~33 MB per batch, small
# enough to stream through rather than allocating the ~1.1 GB square.
KNN_BATCH_SIZE = 500

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
        scholarship_hubness_weight: float = SCHOLARSHIP_HUBNESS_WEIGHT,
        minify: bool = True,
    ) -> None:
        self.output_dir = output_dir
        self.limit = limit
        self.repo_id = repo_id
        self.top_k_related = top_k_related
        self.top_k_semantic = top_k_semantic
        self.top_k_scholarship = top_k_scholarship
        self.scholarship_min_similarity = scholarship_min_similarity
        self.scholarship_hubness_weight = scholarship_hubness_weight
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
                     "doi", "URL", REFERENCES_EMBEDDING],
        )
        if df is None or df.empty:
            logger.warning("  references subset unavailable — scholarship links skipped")
            return
        if REFERENCES_EMBEDDING not in df.columns:
            logger.warning("  references subset has no %s — scholarship links skipped",
                           REFERENCES_EMBEDDING)
            return

        self.references_df = df
        matrix, valid_rows = build_normalized_matrix(df, REFERENCES_EMBEDDING)
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
        and ``lieux_coords`` — ``iwac_utils.build_entity_index``, the same
        pass the entity dashboards make.
        """
        self.entity_lookup, self.id_to_entity, self.lieux_coords = build_entity_index(self.index_df)
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

        # `df.index`, not `enumerate`: `article_row_index` is read back
        # against the frame, so it must hold the LABEL iterrows used to
        # yield, which is only the position while the index is a range.
        for row_idx, row in zip(df.index, iter_records(df)):
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
                "country":           first_country(row.get(country_col)) if country_col else "",
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
    def _coerce_int(value: Any) -> Optional[int]:
        f = clean_float(value)
        return int(f) if f is not None else None

    @staticmethod
    def _coerce_float(value: Any) -> Optional[float]:
        f = clean_float(value)
        return round(f, 4) if f is not None else None


    # ------------------------------------------------------------------
    # Semantic neighbours (upstream related_articles, kNN fallback)
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
            vec = coerce_embedding(value)
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

    def semantic_neighbor_card(self, neigh_id: int, similarity: float) -> Optional[Dict[str, Any]]:
        """One ``semantic_neighbors`` entry, or None when ``neigh_id`` is not
        an article in this snapshot."""
        meta = self.article_meta.get(neigh_id)
        if not meta:
            return None
        return {
            "o_id":       neigh_id,
            "title":      meta.get("title", ""),
            "newspaper":  meta.get("newspaper", ""),
            "country":    meta.get("country", ""),
            "date":       meta.get("pub_date", ""),
            "thumbnail":  meta.get("thumbnail", ""),
            "similarity": round(similarity, 4),
        }

    def read_related_articles(self) -> Tuple[Dict[int, List[Dict[str, Any]]], List[int]]:
        """Neighbour cards from upstream's ``related_articles`` column.

        Returns ``(lists, pending)``: the cards for every article whose cell
        holds a list, and the ids of the articles whose cell is empty, which
        ``compute_semantic_neighbors`` fills in. Upstream's order is kept
        as it is: it is the dataset's published ranking, by the rule the
        MCP server's ``get_similar_items`` also ranks by (score, then
        string o:id), and a recomputation here can differ from it on
        near-ties at float32 precision.
        """
        df = self.articles_df
        if RELATED_COLUMN not in df.columns:
            logger.warning(
                "articles subset has no %s column — every neighbour list is "
                "computed in process", RELATED_COLUMN,
            )
            return {}, list(self.target_ids)

        cells = df[RELATED_COLUMN]
        lists: Dict[int, List[Dict[str, Any]]] = {}
        pending: List[int] = []
        dangling = 0
        for article_id in self.target_ids:
            pairs = parse_related(cells.at[self.article_row_index[article_id]],
                                  exclude=article_id)
            if not pairs:
                pending.append(article_id)
                continue
            cards: List[Dict[str, Any]] = []
            for neigh_id, similarity in pairs:
                card = self.semantic_neighbor_card(neigh_id, similarity)
                if card is None:
                    dangling += 1
                    continue
                cards.append(card)
                if len(cards) == self.top_k_semantic:
                    break
            lists[article_id] = cards

        if dangling:
            # Upstream nulls the column on any membership change, so a list
            # naming a missing article means it was pushed with
            # --preserve-derived or read across revisions.
            logger.warning(
                "  %d related_articles entries name articles missing from this "
                "snapshot and were dropped", dangling,
            )
        return lists, pending

    def compute_semantic_neighbors(
        self, article_ids: Optional[Sequence[int]] = None,
    ) -> Dict[int, List[Dict[str, Any]]]:
        """Top-K cosine neighbours over ``embedding_OCR``, for the articles
        upstream left without a ``related_articles`` list (default: every
        article).

        The fallback is what keeps the panel filled between an upstream
        push that clears the column and the ``related_articles.py --push``
        that refills it. It follows upstream's rules, so its lists match
        the ones it stands in for: neighbours come from articles with a
        usable vector, the article itself is excluded, and ties are ordered
        by string o:id. Articles without a vector get an empty list.
        """
        ids = list(self.target_ids if article_ids is None else article_ids)
        result: Dict[int, List[Dict[str, Any]]] = {aid: [] for aid in ids}
        if self.embedding_matrix is None or not ids:
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
        # A row can be a neighbour only if it has a vector and an id.
        eligible = np.zeros(N, dtype=bool)
        for row_idx in row_to_id:
            eligible[row_idx] = valid[row_idx]
        tie_keys = np.array([str(row_to_id.get(i, "")) for i in range(N)])

        rows = [self.article_row_index[aid] for aid in ids
                if eligible[self.article_row_index[aid]]]
        n_batches = (len(rows) + KNN_BATCH_SIZE - 1) // KNN_BATCH_SIZE
        for batch_no, start in enumerate(range(0, len(rows), KNN_BATCH_SIZE)):
            batch_rows = np.asarray(rows[start:start + KNN_BATCH_SIZE])
            sims = X[batch_rows] @ X.T                         # (B, N)
            sims[:, ~eligible] = -np.inf
            sims[np.arange(len(batch_rows)), batch_rows] = -np.inf   # self

            for local_i, global_i in enumerate(batch_rows):
                neighbours: List[Dict[str, Any]] = []
                for neigh_row in rank_neighbours(sims[local_i], K, tie_keys):
                    card = self.semantic_neighbor_card(
                        row_to_id[int(neigh_row)], float(sims[local_i, neigh_row]))
                    if card is not None:
                        neighbours.append(card)
                result[row_to_id[int(global_i)]] = neighbours

            if batch_no % 5 == 0:
                logger.info(f"  kNN batch {batch_no + 1} / {n_batches}")

        return result

    def semantic_neighbors(self) -> Dict[int, List[Dict[str, Any]]]:
        """``semantic_neighbors`` per article: upstream's list where the cell
        holds one, the in-process kNN where it is empty."""
        lists, pending = self.read_related_articles()
        computed = self.compute_semantic_neighbors(pending) if pending else {}
        result = {**lists, **computed}
        logger.info(
            "Semantic neighbours: %d articles from %s, %d computed in process "
            "(%d of those have a list), %d without",
            len(lists), RELATED_COLUMN, len(computed),
            sum(1 for v in computed.values() if v),
            sum(1 for v in result.values() if not v),
        )
        return result

    # ------------------------------------------------------------------
    # Cross-corpus scholarship (articles × references, one embedding space)
    # ------------------------------------------------------------------

    def compute_scholarship_neighbors(self) -> Dict[int, List[Dict[str, Any]]]:
        """Top-K scholarly works per article, hubness-corrected.

        Both sides are ``google/embeddinggemma-2`` vectors of the same
        dimensionality, so the dot product is meaningful across subsets —
        but the two are not symmetric in character. An article embeds one
        news text; a reference embeds its title and abstract. Before
        2026-10 the reference side was a book or thesis whose chunks were
        averaged, which pulls long documents toward the corpus centroid,
        and the first run against the real data showed exactly the
        predicted failure: one interview surfaced for 38% of all articles
        and a survey for 32%, an artefact of averaging rather than an
        affinity anyone would recognise. Abstracts remove most of that
        averaging, but the correction below is cheap and still guards
        against a broad abstract that sits near everything.

        A similarity floor cannot fix that, and this method used to suggest
        one. A hub is close to *everything* by construction — those two sat
        inside a distribution whose median top-1 was 0.691 on the Gemini
        vectors; EmbeddingGemma 2 scores run higher still — so any
        threshold high enough to exclude them would first delete the
        legitimate matches. The correction has to be relative to how
        popular a reference is overall, not absolute.

        The correction is **global mean centering**: each reference is
        penalised by its mean cosine across the whole article corpus::

            score(a, r) = cos(a, r) − w · mean_over_all_articles cos(·, r)

        The first attempt here used CSLS (Conneau et al. 2017), which
        penalises by the mean cosine to a reference's *k nearest* articles.
        Testing showed that does nothing for this problem: a genuine
        specialist's ten nearest articles are all in its own tight cluster,
        so its local density is as high as the hub's and both get penalised
        equally — the top pick changed for zero articles. What separates a
        hub from a specialist is not how close its closest neighbours are
        but how close *everything* is, which only the global mean sees. A
        specialist that matches a third of the corpus and nothing else
        carries a small penalty; a work adjacent to all of it carries a
        large one.

        Global centering is the standard treatment for exactly this
        (Dinu & Baroni's globally-corrected retrieval; Suzuki et al. on
        hubness in high-dimensional spaces), and it degrades gracefully:
        where no specialist matches an article at all, the hub still wins,
        which is the right answer rather than a gap.

        The **displayed** number stays the raw cosine, and the selected
        works are re-sorted by it, so the badge means what a reader takes
        it to mean and the cards descend monotonically. The correction
        decides *which* works appear, not what the percentage says.
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
        M = R.shape[0]
        K = min(self.top_k_scholarship, M)
        if K <= 0:
            return result

        row_to_id: Dict[int, int] = {
            row_idx: article_id
            for article_id, row_idx in self.article_row_index.items()
        }

        # (M, N) raw cosine. 423 x 12,356 float32 is ~21 MB — small enough
        # to hold whole, which the hubness term needs anyway: it is a
        # statistic over each reference's entire row.
        sims = R @ X.T

        # Invalid articles are all-zero rows in X, so their columns are
        # already 0 and cannot win a top-k. They must still be excluded
        # from the hubness average, or a corpus with many un-embedded
        # articles would drag every reference's mean toward zero and
        # flatten the correction.
        valid_cols = np.asarray(valid, dtype=bool)
        n_valid_cols = int(valid_cols.sum())
        if n_valid_cols == 0:
            return result

        weight = float(self.scholarship_hubness_weight)
        if weight > 0.0:
            # Mean cosine of each reference across the whole article corpus.
            hubness = sims[:, valid_cols].mean(axis=1)              # (M,)
        else:
            hubness = np.zeros(M, dtype=sims.dtype)

        corrected = sims - weight * hubness[:, None]

        hits: Counter = Counter()           # reference row -> articles it surfaced for
        similarities: List[float] = []      # top-1 RAW cosine per article, for the log
        displaced = 0                       # picks the correction changed

        for start in range(0, N, KNN_BATCH_SIZE):
            end = min(start + KNN_BATCH_SIZE, N)
            block_corrected = corrected[:, start:end]   # (M, B)
            block_raw = sims[:, start:end]

            k_eff = min(K, M)
            part_idx = np.argpartition(-block_corrected, k_eff - 1, axis=0)[:k_eff, :]

            for local_i in range(end - start):
                global_i = start + local_i
                if not valid[global_i]:
                    continue
                article_id = row_to_id.get(global_i)
                if article_id is None:
                    continue

                candidates = []
                for ref_row in part_idx[:, local_i]:
                    ref_row = int(ref_row)
                    raw = float(block_raw[ref_row, local_i])
                    if raw <= 0.0 or raw < self.scholarship_min_similarity:
                        continue
                    meta = self.reference_meta[ref_row]
                    if not meta.get("o_id"):
                        continue
                    candidates.append((ref_row, raw))
                if not candidates:
                    continue

                # Display order is by the raw cosine the badge shows, so the
                # cards descend monotonically; the correction has already
                # done its work in choosing *which* candidates got here.
                candidates.sort(key=lambda pair: -pair[1])
                works = []
                for ref_row, raw in candidates:
                    works.append(dict(self.reference_meta[ref_row],
                                      similarity=round(raw, 4)))
                    hits[ref_row] += 1

                # Did the correction change the pick? Compare against the
                # uncorrected argmax for this article.
                if int(np.argmax(block_raw[:, local_i])) != candidates[0][0]:
                    displaced += 1

                result[article_id] = works
                similarities.append(works[0]["similarity"])

        n_with = sum(1 for v in result.values() if v)
        logger.info(
            "Scholarship links computed for %d/%d articles", n_with, len(result)
        )
        logger.info(
            "  hubness correction (global centering, w=%.2f): reference penalties "
            "span %.3f–%.3f; top pick differs from the uncorrected one for %d articles",
            weight, float(hubness.min()), float(hubness.max()), displaced,
        )
        if similarities:
            ordered = sorted(similarities)
            logger.info(
                "  top-1 raw cosine: median %.3f, p10 %.3f, p90 %.3f, max %.3f",
                ordered[len(ordered) // 2],
                ordered[int(len(ordered) * 0.10)],
                ordered[int(len(ordered) * 0.90)],
                ordered[-1],
            )
        if n_with:
            top_share = 0.0
            for ref_row, count in hits.most_common(3):
                share = count / n_with
                top_share = max(top_share, share)
                if share < SCHOLARSHIP_HUB_SHARE:
                    break
                logger.warning(
                    "  hub reference SURVIVED the correction: '%s' still surfaces for "
                    "%.0f%% of articles — consider raising --scholarship-hubness-weight",
                    (self.reference_meta[ref_row].get("title") or "?")[:70],
                    share * 100,
                )
            most_common = hits.most_common(1)
            if most_common:
                logger.info(
                    "  most-surfaced reference now appears for %.0f%% of articles "
                    "(warn threshold %.0f%%)",
                    (most_common[0][1] / n_with) * 100, SCHOLARSHIP_HUB_SHARE * 100,
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

        # No per-item `generated_at`: nothing reads it, and a stamp in each of
        # ~17k fan-out files made every build differ from the last in every
        # file, content unchanged. The build's time is the manifest's.
        payload = {
            "version":             2,
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
        """Resolve the neighbour lists once up-front, then stream one JSON
        per article. Writing ~12k files at once is I/O-bound — we log
        progress every 500 files so long runs stay interactive.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.build_embedding_matrix()
        semantic_map = self.semantic_neighbors()
        scholarship_map = self.compute_scholarship_neighbors()

        targets = self.target_ids
        if self.limit:
            targets = targets[: self.limit]

        expect_item_outputs(self.output_dir, targets)
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
    add_standard_args(parser, minify_default=True)
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
        help="Semantic-neighbours cap per article (default: %(default)s). "
             "Upstream's related_articles lists hold 10, so a larger cap "
             "lengthens only the lists computed in process",
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
        help="Drop scholarship links below this raw cosine. Rarely the right "
             "knob — a hub reference is close to everything, so a floor deletes "
             "genuine matches before it touches the hub; use "
             "--scholarship-hubness-weight for that (default: %(default)s)",
    )
    parser.add_argument(
        "--scholarship-hubness-weight",
        type=float,
        default=SCHOLARSHIP_HUBNESS_WEIGHT,
        help="Strength of the hubness penalty: a reference's score drops by "
             "this multiple of its mean cosine over all articles, so works "
             "adjacent to the whole corpus stop winning everywhere. "
             "0 disables it (default: %(default)s)",
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
        scholarship_hubness_weight=args.scholarship_hubness_weight,
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
