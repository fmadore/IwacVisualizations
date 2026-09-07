"""The UMAP map of the press half — ``laicite-semantic.json``.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from iwac_embeddings import coerce_embedding
from iwac_utils import generate_timestamp, load_dataset_safe

from laicite.scan import ItemScan


# -----------------------------------------------------------------------
# Semantic map (issue #19 C)
# -----------------------------------------------------------------------
# Smaller neighbourhood than the 12k-article Semantic Landscape block's
# default: at ~1,300 points, n_neighbors=15 starts smoothing away exactly
# the local structure a small map exists to show. Same reasoning, same
# values as the references-overview landscape.
SEMANTIC_N_NEIGHBORS = 10
SEMANTIC_MIN_DIST = 0.15
SEMANTIC_MIN_POINTS = 30
SEMANTIC_TITLE_LEN = 60


class SemanticMixin:
    """``LaiciteGenerator``'s semantic half. Mixed in by ``laicite.generator``."""


    @staticmethod
    def _empty_semantic(reason: str, embedded: int = 0, total: int = 0
                        ) -> Dict[str, Any]:
        """Empty-state contract, same shape as a populated bundle.

        The panel is optional and UMAP is this script's only optional
        dependency; a dossier refresh must not fail because it is
        missing. Same convention as
        ``generate_references_overview._empty_landscape``.
        """
        return {
            "generated_at": generate_timestamp(),
            "frames": [],
            "countries": [],
            "decades": [],
            "points": {
                "o_id": [], "x": [], "y": [], "title": [],
                "frame": [], "country": [], "decade": [], "year": [],
            },
            "meta": {
                "embedded": int(embedded),
                "total": int(total),
                "reason": reason,
                "subsets": ["articles"],
                "umap": None,
            },
        }

    def _member_embeddings(self) -> Tuple[Any, List[ItemScan]]:
        """``(X, scans)`` — unit-normalised vectors for dossier articles.

        Loaded once and cached: two views need it (the semantic map and
        circulation) and the column is 768 floats a row.

        Read HERE rather than in the main scan because ``SUBSET_COLUMNS``
        is deliberately narrow — the pandas conversion of an embedding
        column, not the download, is where the memory goes. A second
        two-column read filtered straight down to dossier members costs
        less than carrying the column through the whole scan.

        ``X[k]`` is the vector of ``scans[k]``, so callers index the two
        together and never need the DataFrame again.
        """
        if self._member_vectors is not None:
            return self._member_vectors

        import numpy as np

        empty = (np.zeros((0, 0), dtype=np.float32), [])
        members = {s.o_id: s for s in self.scan_all() if s.subset == "articles"}
        if not members:
            self._member_vectors = empty
            return empty

        df = load_dataset_safe(
            "articles", repo_id=self.repo_id,
            columns=["o:id", "embedding_OCR"],
        )
        if df is None or "embedding_OCR" not in df.columns:
            self.logger.warning(
                "articles carries no embedding_OCR — the semantic map and "
                "circulation views will render their empty states")
            self._member_vectors = empty
            return empty

        vectors: List[Any] = []
        scans: List[ItemScan] = []
        dim: Optional[int] = None
        for _, row in df.iterrows():
            scan = members.get(str(row.get("o:id") or "").strip())
            if scan is None:
                continue
            vec = coerce_embedding(row.get("embedding_OCR"))
            if vec is None:
                continue
            if dim is None:
                dim = len(vec)
            elif len(vec) != dim:
                continue
            vectors.append(vec)
            scans.append(scan)

        if not vectors:
            self._member_vectors = empty
            return empty

        X = np.vstack(vectors)
        norms = np.linalg.norm(X, axis=1, keepdims=True)
        X = X / np.where(norms == 0.0, 1.0, norms)
        self.logger.info(
            "  embeddings: %d of %d dossier articles carry a usable vector",
            len(scans), len(members))
        self._member_vectors = (X, scans)
        return self._member_vectors

    def build_semantic(self) -> Dict[str, Any]:
        """2-D UMAP projection of the dossier's press half.

        Two jobs. It is a discovery view — discourse clusters that cut
        across the hand-crafted frames — and a robustness check on the
        frame taxonomy itself: if the embedding clusters do not roughly
        recover the curated frames, that is worth knowing before anyone
        publishes the arena counts from the arenas view.

        **`articles` only, and the panel says so.** This is a constraint
        of the data, not a shortcut:

        * ``articles`` carry ``embedding_OCR`` — a vector of the text.
        * ``publications`` carry ``embedding_tableOfContents`` and no
          ``embedding_OCR``. It is the same 768-dim gemini space, so the
          arithmetic would work, which is exactly the trap: a magazine's
          contents page and an article's body are different objects, and
          co-projecting them would place a periodical by its index rather
          than by what it argues. This block's own rule is that no bundle
          sums across subsets without labelling it; silently mixing two
          kinds of vector would break that rule invisibly.
        * ``documents`` carry no embedding at all.
        * ``references`` do carry ``embedding_OCR``, but they are
          scholarship *about* the sources rather than sources, which is
          why every temporal facet in this block already excludes them.
          They keep their own axis in the bibliography view.

        So the map covers the press, ``meta.subsets`` names it, and
        ``meta.embedded`` / ``meta.total`` carry the denominators.
        """
        total = sum(1 for s in self.scan_all() if s.subset == "articles")
        if total < SEMANTIC_MIN_POINTS:
            return self._empty_semantic("too_few_items", 0, total)

        try:
            import umap  # type: ignore
        except ImportError:
            self.logger.warning(
                "umap-learn is not installed — the semantic map panel will "
                "render its empty state (pip install umap-learn)")
            return self._empty_semantic("umap_not_installed", 0, total)

        X, scans = self._member_embeddings()
        embedded = len(scans)
        if embedded < SEMANTIC_MIN_POINTS:
            return self._empty_semantic(
                "missing_embedding_column" if embedded == 0 else "too_few_embeddings",
                embedded, total)

        records: List[Dict[str, Any]] = []
        keep: List[int] = []
        for k, scan in enumerate(scans):
            # Every point is a click-through to /item/<id>, so a row
            # without a usable Omeka id has nowhere to link.
            try:
                point_id = int(scan.o_id)
            except (TypeError, ValueError):
                continue
            title = scan.title
            if len(title) > SEMANTIC_TITLE_LEN:
                title = title[: SEMANTIC_TITLE_LEN - 1].rstrip() + "…"
            keep.append(k)
            records.append({
                "o_id": point_id,
                "title": title,
                "frame": self._dominant_annotation_frame(scan),
                "country": scan.countries[0] if scan.countries else "",
                "year": scan.year,
                "decade": self._decade(scan.year) or "",
            })

        embedded = len(records)
        if embedded < SEMANTIC_MIN_POINTS:
            return self._empty_semantic("too_few_embeddings", embedded, total)
        X = X[keep]

        neighbors = max(2, min(SEMANTIC_N_NEIGHBORS, embedded - 1))
        self.logger.info(
            "  semantic map: UMAP over %d of %d dossier articles "
            "(n_neighbors=%d, metric=cosine)",
            embedded, total, neighbors)
        reducer = umap.UMAP(
            n_components=2,
            n_neighbors=neighbors,
            min_dist=SEMANTIC_MIN_DIST,
            metric="cosine",
            random_state=42,
        )
        coords = reducer.fit_transform(X)

        def _table(key: str, sort_key: Any) -> Tuple[List[str], Dict[str, int]]:
            names = sorted({r[key] for r in records if r[key]}, key=sort_key)
            return names, {name: i for i, name in enumerate(names)}

        frame_names, frame_index = _table("frame", lambda v: v.lower())
        country_names, country_index = _table("country", lambda v: v.lower())
        decade_names, decade_index = _table("decade", lambda v: v)

        points: Dict[str, List[Any]] = {
            "o_id": [], "x": [], "y": [], "title": [],
            "frame": [], "country": [], "decade": [], "year": [],
        }
        for i, record in enumerate(records):
            points["o_id"].append(record["o_id"])
            points["x"].append(round(float(coords[i, 0]), 2))
            points["y"].append(round(float(coords[i, 1]), 2))
            points["title"].append(record["title"])
            points["frame"].append(frame_index.get(record["frame"], -1))
            points["country"].append(country_index.get(record["country"], -1))
            points["decade"].append(decade_index.get(record["decade"], -1))
            points["year"].append(record["year"])

        return {
            "generated_at": generate_timestamp(),
            "frames": frame_names,
            "countries": country_names,
            "decades": decade_names,
            "points": points,
            "meta": {
                "embedded": embedded,
                "total": total,
                "reason": "",
                "subsets": ["articles"],
                "umap": {
                    "n_neighbors": neighbors,
                    "min_dist": SEMANTIC_MIN_DIST,
                    "metric": "cosine",
                    "random_state": 42,
                },
            },
        }
